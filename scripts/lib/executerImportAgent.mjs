/**
 * executerImportAgent.mjs — le déroulé commun aux imports de champs clients.
 *
 * APERÇU PAR DÉFAUT. Sans `--execute`, rien n'est touché : on lit le ou les
 * fichiers, on lit la base, et on décrit ligne par ligne ce qui se passerait.
 *
 * UN SEUL DÉROULÉ POUR DEUX IMPORTS, ET CE N'EST PAS DE L'ÉCONOMIE
 * ────────────────────────────────────────────────────────────────
 * Les verrous, la sauvegarde relue depuis le disque, les lots de 400 avec leur
 * journal dans le même batch, l'annulation qui refuse de toucher une fiche
 * modifiée depuis : c'est la partie dangereuse, et elle est identique que l'on
 * remplisse un numéro ou un nom de commercial. En avoir deux copies voudrait
 * dire corriger deux fois chaque défaut qu'on y trouvera — et n'en corriger
 * qu'une le jour où on l'oublie. Ce qui diffère vit dans `champsImportables.mjs`.
 *
 * LES QUATRE VERROUS POUR ÉCRIRE EN PRODUCTION
 * ────────────────────────────────────────────
 *   1. --execute
 *   2. --allow-production
 *   3. AKAYIS_ALLOW_AGENT_IMPORT='true'
 *   4. le projectId tapé au clavier, sur un vrai terminal
 *
 * ⚠ LE VERROU 3 EST PROPRE À CES IMPORTS. Déverrouiller une fusion de clients ne
 *   doit pas déverrouiller un import, et réciproquement.
 *
 * L'ANNULATION
 * ────────────
 * Chaque exécution écrit une sauvegarde contenant, pour chaque fiche touchée,
 * l'état EXACT d'avant — y compris le fait que les clés existaient ou non.
 * `--annuler=<dossier>` le remet en place, et refuse de toucher une fiche
 * modifiée depuis l'import.
 */

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { resolveResetProject, PRODUCTION_PROJECT_ID } from './assertResetProject.mjs'
import { echouerAvecAide } from './aideIdentifiants.mjs'
import { analyserCsv, lireClasseur } from './lireTableur.mjs'
import {
  planifierImport, trouverColonnes, champsPresents, STATUTS, COLONNE_CODE,
} from './importChampsAgent.mjs'
import { CHAMPS } from './champsImportables.mjs'

/**
 * Ce qu'un `--dossier=` ramasse tout seul. `--fichier=` accepte en plus `.txt`
 * (voir la lecture plus bas, qui dispatche sur l'extension).
 *
 * ⚠ `.txt` EN EST EXCLU, ALORS QU'IL RESTE LISIBLE PAR `--fichier=`. Un dossier
 *   de livraison contient des notes : « Lire_avant_import.txt » a vraiment été
 *   livré à côté des quinze classeurs. Le lire comme un tableur fait échouer tout
 *   l'import sur un fichier qui n'a jamais prétendu en être un. Désigner un `.txt`
 *   à la main reste possible — là, c'est une intention, pas une trouvaille.
 */
const EXTENSIONS_RAMASSEES = new Set(['.xlsx', '.xlsm', '.xls', '.csv'])

const nombre = (n) => Number(n).toLocaleString('fr-FR')

const LIBELLES = {
  [STATUTS.A_COMPLETER]: 'à mettre à jour',
  [STATUTS.INCHANGE]: 'inchangée',
  [STATUTS.CONFLIT]: 'CONFLIT',
  [STATUTS.NUMERO_IGNORE]: 'valeur ignorée',
  [STATUTS.INTROUVABLE]: 'introuvable',
  [STATUTS.ZERO_AMBIGU]: 'ZÉRO AMBIGU',
  [STATUTS.CODE_REPETE]: 'code répété',
  [STATUTS.PLUSIEURS_CLIENTS]: 'plusieurs fiches',
}

/**
 * @param {object} champ la description du champ à remplir (`champsImportables.mjs`)
 */
export async function executerImportAgent(champ) {
  const argv = process.argv.slice(2)
  const valeurArg = (prefixe, defaut) => {
    const trouve = argv.find((a) => a.startsWith(prefixe))
    return trouve ? trouve.slice(prefixe.length) : defaut
  }

  const execute = argv.includes('--execute')
  const allowProductionFlag = argv.includes('--allow-production')
  // ⚠ PLUSIEURS FICHIERS, ET CE N'EST PAS UN CONFORT. `valeurArg()` ne rend que la
  //   PREMIÈRE occurrence : passer « --fichier=a --fichier=b » aurait lu `a` et
  //   ignoré `b` EN SILENCE. Pire, traiter deux fichiers en deux exécutions
  //   séparées empêche de voir qu'un même code agent figure dans les deux — deux
  //   écritures sur la même fiche, dont la seconde écrase la première. Les lots
  //   doivent donc être réunis AVANT la planification, pour que la détection des
  //   répétitions porte sur l'ensemble.
  const fichiersNommes = argv
    .filter((a) => a.startsWith('--fichier='))
    .flatMap((a) => a.slice('--fichier='.length).split(','))
    .map((f) => f.trim())
    .filter(Boolean)
  const dossierSource = valeurArg('--dossier=', null)
  const feuilleVoulue = valeurArg('--feuille=', null)
  const csvSortie = valeurArg('--csv=', null)
  const dossierAnnulation = valeurArg('--annuler=', null)
  const backupDirArg = valeurArg('--backup-dir=', null)
  const TAILLE_LOT = Math.min(Number(valeurArg('--taille-lot=', '400')) || 400, 450)

  const echouer = (message) => {
    console.error('')
    console.error(message)
    process.exit(1)
  }

  const titre = (texte) => {
    console.log('')
    console.log(texte)
    console.log('─'.repeat(texte.length))
  }

  titre(`IMPORT : ${champ.colonne.toUpperCase()}`)
  console.log(`Colonnes attendues : « ${COLONNE_CODE} » (retrouve la fiche) et « ${champ.colonne} » (ce qu'on ajoute).`)

  // ══════════════════════════════════════════════════════════════════════════
  // QUELS FICHIERS
  // ══════════════════════════════════════════════════════════════════════════
  //
  // ⚠ UN DOSSIER PLUTÔT QU'UNE LISTE, PARCE QUE QUINZE MILLE LIGNES ARRIVENT
  //   DÉCOUPÉES EN LOTS. Taper `--fichier=` autant de fois qu'il y a de fichiers
  //   n'est pas une réponse : c'est long, et surtout un fichier oublié ne se voit
  //   pas — l'import réussirait, le bilan serait cohérent, et quelques centaines
  //   de fiches resteraient vides sans que rien ne le dise.
  //
  // ⚠ LES FICHIERS DE VERROU D'EXCEL SONT ÉCARTÉS. Un classeur ouvert dans Excel
  //   crée à côté de lui un `~$classeur.xlsx` : un fichier de quelques octets, au
  //   nom et à l'extension d'un vrai classeur, mais qui n'en est pas un.
  //
  // ⚠ L'ORDRE EST ALPHABÉTIQUE, ET IL DOIT L'ÊTRE. Sans tri, l'ordre dépend du
  //   système de fichiers : deux exécutions pourraient numéroter les lignes
  //   autrement, et l'aperçu ne décrirait plus ce que `--execute` va faire.
  let fichiers = fichiersNommes

  if (dossierSource) {
    if (fichiersNommes.length > 0) {
      echouer("--dossier et --fichier s'excluent : désigner le dossier, ou les fichiers un par un.")
    }
    let entrees
    try {
      entrees = await readdir(dossierSource)
    } catch (error) {
      echouer(`Dossier illisible : ${dossierSource}\n  (${error.message})`)
    }

    const verrous = entrees.filter((e) => e.startsWith('~$'))
    const retenus = entrees
      .filter((e) => !e.startsWith('~$') && EXTENSIONS_RAMASSEES.has(extname(e).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }))
    fichiers = retenus.map((e) => join(dossierSource, e))
    const ecartes = entrees.filter((e) => !e.startsWith('~$') && !retenus.includes(e))

    titre(`DOSSIER : ${dossierSource}`)
    if (fichiers.length === 0) {
      echouer(
        `Aucun tableur dans ${dossierSource}.\n`
        + `Extensions ramassées : ${[...EXTENSIONS_RAMASSEES].join(', ')}.\n`
        + 'Un fichier à l\'extension inhabituelle se désigne à la main : --fichier=<chemin>',
      )
    }
    console.log(`${nombre(fichiers.length)} fichier(s) à traiter, dans cet ordre :`)
    for (const f of fichiers) console.log(`  ${f}`)
    if (verrous.length > 0) {
      console.log('')
      console.log(`⚠ ${nombre(verrous.length)} fichier(s) de verrou Excel ignoré(s) : ${verrous.join(', ')}`)
      console.log('  Ce sont des fichiers temporaires créés par un classeur OUVERT.')
      console.log("  Fermer Excel avant de lancer l'import évite toute surprise.")
    }
    // ⚠ CE QUI N'EST PAS LU EST DIT. Un fichier écarté en silence, c'est la
    //   question « est-ce que mes 15 000 lignes y sont toutes ? » sans réponse.
    if (ecartes.length > 0) {
      console.log('')
      console.log(`${nombre(ecartes.length)} fichier(s) NON lu(s) (extension non ramassée) :`)
      for (const e of ecartes.slice(0, 20)) console.log(`  ${e}`)
      if (ecartes.length > 20) console.log(`  … et ${nombre(ecartes.length - 20)} autre(s).`)
      console.log('  Si l\'un d\'eux porte des données à importer : --fichier=<chemin>')
    }
  }

  if (fichiers.length === 0 && !dossierAnnulation) {
    echouer(
      'Rien à faire. Trois façons de désigner les données :\n'
      + '  --dossier=<dossier>   tous les tableurs du dossier (le plus simple)\n'
      + '  --fichier=<fichier>   répétable, ou séparé par des virgules\n'
      + "  --annuler=<dossier>   remet en place une sauvegarde d'import\n"
      + `\nChaque fichier doit porter deux colonnes : « ${COLONNE_CODE} » et « ${champ.colonne} ».`,
    )
  }
  if ((fichiers.length > 0 || dossierSource) && dossierAnnulation) {
    echouer("--fichier et --annuler s'excluent : importer ou annuler, pas les deux.")
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LECTURE DU FICHIER — AVANT TOUTE CHOSE, ET SANS AUCUN IDENTIFIANT
  // ══════════════════════════════════════════════════════════════════════════
  //
  // ⚠ L'ORDRE EST UNE CORRECTION, PAS UN DÉTAIL. Cette lecture venait APRÈS le
  //   contrôle des identifiants : savoir si un fichier était bien formé exigeait
  //   donc un accès à la production. Celui qui FABRIQUE le fichier n'a pas cet
  //   accès — et c'est précisément lui qui a besoin de la réponse. Résultat : le
  //   fichier faisait l'aller-retour, et le seul diagnostic disponible était
  //   « ça refuse ».
  let lignes = []
  const tableurs = []

  for (const chemin of fichiers) {
    const extension = extname(chemin).toLowerCase()
    let tableur
    try {
      if (extension === '.xlsx' || extension === '.xlsm' || extension === '.xls') {
        tableur = await lireClasseur(await readFile(chemin), feuilleVoulue)
      } else if (extension === '.csv' || extension === '.txt') {
        tableur = analyserCsv(await readFile(chemin, 'utf8'))
      } else {
        echouer(`Extension non reconnue : « ${extension || '(aucune)'} » pour ${chemin}.\nAttendu .xlsx ou .csv.`)
      }
    } catch (error) {
      echouer(`Fichier illisible : ${chemin}\n  (${error.message})`)
    }
    if (tableur.erreur) echouer(`${chemin} : ${tableur.erreur}`)

    titre(`FICHIER : ${chemin}`)
    // ⚠ ON DIT QUELLE FEUILLE A ÉTÉ LUE, ET QUELLES AUTRES EXISTENT. Un classeur
    //   de travail en a souvent plusieurs ; lire la première sans le dire ferait
    //   croire à un fichier vide alors que les données sont dans la suivante.
    if (tableur.feuilles?.length > 1) {
      const autres = tableur.feuilles.filter((f) => f !== tableur.feuille)
      console.log(`Feuille lue : « ${tableur.feuille} »`)
      console.log(`  ⚠ ${tableur.feuilles.length} feuilles dans le classeur. Non lues : ${autres.map((f) => `« ${f} »`).join(', ')}.`)
      console.log('    Pour en lire une autre : --feuille=<nom>')
    } else if (tableur.feuille) {
      console.log(`Feuille lue : « ${tableur.feuille} »`)
    }
    if (tableur.separateur) console.log(`Séparateur : « ${tableur.separateur} »`)
    console.log(`En-têtes : ${tableur.entetes.map((e) => `« ${e} »`).join(', ') || '(aucun)'}`)
    console.log(`Lignes de données : ${nombre(tableur.lignes.length)}`)

    const colonnes = trouverColonnes(tableur.entetes, champ)
    if (colonnes.erreur) {
      // ⚠ DIRE QUEL SCRIPT LIRAIT CE FICHIER. Un fichier d'agents commerciaux
      //   passé à l'import de numéros est juste — il est seulement donné au
      //   mauvais script. Sans cette phrase, le refus dit « colonne absente » et
      //   laisse chercher une faute d'orthographe dans un en-tête correct.
      const autres = champsPresents(
        tableur.entetes,
        Object.values(CHAMPS).filter((c) => c.cle !== champ.cle),
      )
      const redirection = autres.length > 0
        ? `\n\nCe fichier porte « ${autres[0].colonne} ». Pour le traiter :\n`
          + `  node ${autres[0].script} ${argv.join(' ')}`
        : ''
      // ⚠ L'INTRUS DANS UN DOSSIER DE LIVRAISON. Quand d'autres fichiers du même
      //   lot ont, eux, les bonnes colonnes, le problème n'est presque jamais une
      //   faute d'en-tête : c'est un fichier qui n'est pas un fichier d'import —
      //   un CSV de vérification, une note. On abandonne quand même : écarter
      //   l'intrus tout seul risquerait d'écarter en silence un vrai lot mal
      //   nommé, et de laisser des centaines de fiches vides sans le dire.
      const intrus = tableurs.length > 0 && autres.length === 0
        ? `\n\n${nombre(tableurs.length)} fichier(s) déjà lu(s) ont bien les deux colonnes.`
          + " Si celui-ci n'est pas un fichier d'import (CSV de vérification, note),"
          + ' le sortir du dossier et relancer.'
        : ''
      echouer(`${chemin} :\n${colonnes.erreur}${redirection}${intrus}`)
    }
    console.log(`Colonnes retenues : code = « ${colonnes.code} », ${champ.libelleCourt} = « ${colonnes.valeur} »`)

    // `numeriques` dit, case par case, si le tableur l'a stockée comme un NOMBRE —
    // donc si ses zéros de tête ont pu être mangés. C'est ce qui autorise
    // `resoudreCode` à les restituer depuis la base au lieu de les deviner.
    const ajout = tableur.lignes.map((ligne, index) => ({
      fichier: chemin,
      ligne: index + 2, // +2 : l'en-tête est la ligne 1, et les tableurs comptent de 1
      code: ligne[colonnes.code],
      valeur: ligne[colonnes.valeur],
      codeNumerique: Boolean(tableur.numeriques?.[index]?.[colonnes.code]),
      valeurNumerique: Boolean(tableur.numeriques?.[index]?.[colonnes.valeur]),
    }))

    const numeriques = ajout.filter((l) => l.codeNumerique || l.valeurNumerique).length
    if (numeriques > 0) {
      console.log('')
      console.log(`⚠ ${nombre(numeriques)} ligne(s) ont au moins une case stockée en NOMBRE par le tableur.`)
      console.log('  Leurs zéros de tête ont pu être mangés. Ils seront restitués depuis la base')
      console.log('  quand la correspondance est UNIQUE, et signalés sinon. Formater les deux')
      console.log('  colonnes en TEXTE dans le classeur évite la question entièrement.')
    }

    lignes = lignes.concat(ajout)
    tableurs.push({ chemin, lignes: ajout.length })
  }

  if (fichiers.length > 1) {
    titre('LES FICHIERS RÉUNIS')
    for (const t of tableurs) console.log(`  ${nombre(t.lignes)} ligne(s)  ${t.chemin}`)
    console.log(`  ${nombre(lignes.length)} ligne(s) au total`)
    console.log('')
    console.log('Les lots sont réunis AVANT la planification : un même code agent présent')
    console.log("dans deux fichiers est donc vu comme répété, et aucun des deux n'est écrit.")
  }

  if (lignes.length === 0 && !dossierAnnulation) {
    echouer('Aucune ligne de données dans le ou les fichiers fournis.')
  }

  // ── Identifiants ──────────────────────────────────────────────────────────
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  let serviceAccount = null

  if (serviceAccountPath) {
    try {
      serviceAccount = JSON.parse(await readFile(serviceAccountPath, 'utf8'))
    } catch (error) {
      echouerAvecAide(`Identifiants illisibles :\n  ${serviceAccountPath}\n  (${error.message})`)
    }
  } else if (!process.env.GCLOUD_PROJECT) {
    echouerAvecAide('Ni GOOGLE_APPLICATION_CREDENTIALS ni GCLOUD_PROJECT ne sont définis.')
  }

  let projectId
  let isProduction
  try {
    ;({ projectId, isProduction } = resolveResetProject({
      serviceAccount,
      envProjectId: process.env.GCLOUD_PROJECT,
      execute,
      allowProductionFlag,
      // ⚠ Variable PROPRE à l'import : voir l'en-tête, verrou 3.
      envAllowProductionReset: process.env.AKAYIS_ALLOW_AGENT_IMPORT,
    }))
  } catch (error) {
    echouerAvecAide(`Projet refusé : ${error.message}`)
  }

  if (!isProduction && !projectId.startsWith('demo-')) {
    echouer(
      `Projet refusé : « ${projectId} ».\n`
      + "Ce script n'écrit que dans la production de ce dépôt ou un projet demo-*.",
    )
  }

  // ── Verrou 4 : la confirmation au clavier ─────────────────────────────────
  if (execute && isProduction) {
    if (!process.stdin.isTTY) {
      echouer(
        'REFUS : écrire en PRODUCTION exige une confirmation tapée au clavier.\n'
        + "Le flux d'entrée n'est pas un terminal (pipe, CI). Opération bloquée.",
      )
    }
    const { createInterface } = await import('node:readline/promises')
    const rl = createInterface({ input: process.stdin, output: process.stderr })
    const quoi = dossierAnnulation
      ? `ANNULATION d'un import de ${champ.libelle}`
      : `MISE À JOUR du ${champ.libelle} de fiches clients`
    const reponse = await rl.question(
      `ATTENTION : ${quoi} en PRODUCTION.\n`
      + `Tapez exactement le projectId (${PRODUCTION_PROJECT_ID}) pour confirmer : `,
    )
    rl.close()
    if (reponse.trim() !== PRODUCTION_PROJECT_ID) {
      echouer('Confirmation invalide. Aucune écriture effectuée.')
    }
  }

  initializeApp({ credential: serviceAccount ? cert(serviceAccount) : applicationDefault() })
  const db = getFirestore()

  console.log(`Projet : ${projectId}${isProduction ? '  (PRODUCTION)' : ''}`)
  console.log(`Mode   : ${execute ? '⚠ EXECUTE — la base va être modifiée' : 'aperçu (aucune écriture)'}`)

  /**
   * Les écritures d'un lot, appliquées dans UN batch avec leur journal d'audit.
   *
   * ⚠ LE JOURNAL EST DANS LE MÊME BATCH QUE LES ÉCRITURES QU'IL DÉCRIT. Écrit à
   *   part, il pourrait manquer alors que les fiches ont changé — ou l'inverse. Les
   *   identifiants restent dans le lot (≤ 450) pour que le document du journal ne
   *   puisse pas dépasser la taille maximale d'un document Firestore.
   */
  async function appliquerLot(lot, storeId, champsDe, action, backupDir) {
    const batch = db.batch()
    for (const ecriture of lot) {
      batch.update(db.doc(`globalClients/${ecriture.id}`), champsDe(ecriture))
    }
    if (storeId) {
      batch.set(db.collection(`clients/${storeId}/auditLogs`).doc(), {
        action,
        actorUid: null,
        actorRole: 'script',
        actorScript: champ.script,
        fiches: lot.map((e) => e.id),
        nombreFiches: lot.length,
        sauvegarde: backupDir,
        createdAt: FieldValue.serverTimestamp(),
      })
    }
    await batch.commit()
  }

  /** Les écritures groupées par boutique, puis découpées en lots. */
  function enLots(ecritures) {
    const parBoutique = new Map()
    for (const ecriture of ecritures) {
      const cle = ecriture.storeId ?? ''
      if (!parBoutique.has(cle)) parBoutique.set(cle, [])
      parBoutique.get(cle).push(ecriture)
    }

    const lots = []
    for (const [storeId, liste] of parBoutique) {
      for (let i = 0; i < liste.length; i += TAILLE_LOT) {
        lots.push({ storeId: storeId || null, lot: liste.slice(i, i + TAILLE_LOT) })
      }
    }
    return lots
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ANNULATION
  // ══════════════════════════════════════════════════════════════════════════
  if (dossierAnnulation) {
    titre("ANNULATION D'UN IMPORT")
    let sauvegarde
    try {
      sauvegarde = JSON.parse(await readFile(join(dossierAnnulation, 'ecritures.json'), 'utf8'))
    } catch (error) {
      echouer(`Sauvegarde illisible : ${join(dossierAnnulation, 'ecritures.json')}\n  (${error.message})`)
    }
    console.log(`${nombre(sauvegarde.length)} fiche(s) à remettre dans leur état d'avant.`)

    // ⚠ UNE SAUVEGARDE D'UN AUTRE CHAMP EST REFUSÉE ICI. Les deux imports écrivent
    //   dans la même collection et laissent des dossiers voisins ; pointer celui du
    //   mauvais script supprimerait des clés que ce script n'a jamais écrites.
    const clesVues = new Set(sauvegarde.flatMap((e) => Object.keys(e?.maj ?? {})))
    const etrangeres = [...clesVues].filter((c) => !champ.clesEcrites.includes(c))
    if (etrangeres.length > 0) {
      const bonChamp = Object.values(CHAMPS).find((c) => etrangeres.every((k) => c.clesEcrites.includes(k)))
      echouer(
        `Cette sauvegarde n'a pas été écrite par cet import.\n`
        + `  Elle touche : ${[...clesVues].join(', ')}\n`
        + `  Ce script annule : ${champ.clesEcrites.join(', ')}\n`
        + (bonChamp ? `\nPour l'annuler :\n  node ${bonChamp.script} ${argv.join(' ')}` : ''),
      )
    }

    /**
     * L'état d'avant, quelle que soit la forme de la sauvegarde.
     *
     * ⚠ LA FORME À PLAT EST CELLE D'AVANT LE 2026-10-13, et les sauvegardes des
     *   imports DÉJÀ PASSÉS EN PRODUCTION la portent. Les lire reste la seule
     *   façon d'annuler ces imports-là : la compatibilité n'est pas décorative.
     */
    const etatAvant = (ecriture) => {
      if (ecriture?.avant?.champs) return ecriture.avant.champs
      const plat = ecriture?.avant ?? {}
      const reconstruit = {}
      for (const cle of Object.keys(ecriture?.maj ?? {})) {
        reconstruit[cle] = { present: Boolean(plat[`${cle}Present`]), valeur: plat[cle] ?? null }
      }
      return reconstruit
    }

    // ⚠ ON NE REMET PAS EN PLACE À L'AVEUGLE. Si une fiche a été modifiée depuis
    //   l'import — par la boutique, à l'écran —, la valeur en base n'est plus celle
    //   que l'import avait écrite. L'annuler écraserait une saisie humaine, qui est
    //   toujours plus récente et plus juste que ce que le script avait mis.
    const aRemettre = []
    const modifiees = []
    for (const ecriture of sauvegarde) {
      const snap = await db.doc(`globalClients/${ecriture.id}`).get()
      if (!snap.exists) { modifiees.push(`${ecriture.id} : fiche supprimée depuis`); continue }
      const actuel = snap.data()
      const divergence = Object.entries(ecriture.maj)
        .find(([cle, attendu]) => String(actuel[cle] ?? '') !== String(attendu))
      if (divergence) {
        const [cle, attendu] = divergence
        modifiees.push(`${ecriture.id} : ${cle} « ${actuel[cle] ?? ''} » ≠ « ${attendu} » écrit par l'import`)
        continue
      }
      aRemettre.push(ecriture)
    }

    console.log(`  ${nombre(aRemettre.length)} inchangée(s) depuis l'import → annulables`)
    console.log(`  ${nombre(modifiees.length)} modifiée(s) depuis → LAISSÉES EN PLACE`)
    if (modifiees.length > 0) {
      for (const ligne of modifiees.slice(0, 15)) console.log(`    · ${ligne}`)
      if (modifiees.length > 15) console.log(`    … et ${nombre(modifiees.length - 15)} autre(s).`)
    }

    if (!execute) {
      titre('APERÇU — AUCUNE ÉCRITURE')
      console.log('Ajouter --execute --allow-production pour annuler réellement.')
      process.exit(0)
    }

    // ⚠ SUPPRIMER LA CLÉ, ET NON L'ÉCRIRE VIDE. `champsAgent` décide qu'une fiche
    //   est « rangée » par la PRÉSENCE des clés. Remettre `codeAgent: ''` sur une
    //   fiche qui n'avait aucune des deux clés la laisserait en mode « rangée puis
    //   vidée exprès » : son `orange` ne serait plus lu, et le code agent
    //   disparaîtrait de l'écran. L'annulation aurait causé le dégât.
    const champsDAnnulation = (ecriture) => {
      const avant = etatAvant(ecriture)
      const champsEcrits = {}
      for (const [cle, etat] of Object.entries(avant)) {
        champsEcrits[cle] = etat.present ? etat.valeur : FieldValue.delete()
      }
      return champsEcrits
    }

    let remises = 0
    const incidentsAnnulation = []
    for (const { storeId, lot } of enLots(aRemettre)) {
      try {
        await appliquerLot(lot, storeId, champsDAnnulation, champ.actionAnnulation, dossierAnnulation)
        remises += lot.length
      } catch (error) {
        incidentsAnnulation.push(`lot de ${lot.length} fiche(s) (${storeId ?? 'sans boutique'}) : ${error.message}`)
      }
    }

    titre('RÉSULTAT')
    console.log(`${nombre(remises)} fiche(s) remise(s) dans leur état d'avant`)
    console.log(`${nombre(modifiees.length)} fiche(s) laissée(s) en place (modifiées depuis)`)
    if (incidentsAnnulation.length > 0) {
      console.log('')
      console.log(`⚠ ${nombre(incidentsAnnulation.length)} lot(s) en échec :`)
      for (const incident of incidentsAnnulation) console.log(`  ✗ ${incident}`)
      console.log('Chaque lot est un batch : ceux-ci sont restés INTACTS. Le script est relançable.')
    }
    process.exit(incidentsAnnulation.length > 0 ? 1 : 0)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // IMPORT
  // ══════════════════════════════════════════════════════════════════════════
  titre('LECTURE DE LA BASE')
  const snap = await db.collection('globalClients').get()
  const fiches = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  console.log(`${nombre(fiches.length)} fiche(s) lue(s) dans globalClients.`)

  const plan = planifierImport(lignes, fiches, champ)
  const { bilan } = plan

  // ── L'aperçu ──────────────────────────────────────────────────────────────
  titre('APERÇU')
  console.log(`${nombre(bilan.total)} ligne(s) du fichier :`)
  console.log('')
  console.log(`  À METTRE À JOUR : ${nombre(bilan.misAJour)}  — ${champ.libelle} vide, valeur du fichier retenue`)
  console.log(`  INCHANGÉES      : ${nombre(bilan.inchanges)}  — la même valeur est déjà en place`)
  console.log(`  EN CONFLIT      : ${nombre(bilan.conflits)}  — une AUTRE valeur est en place, jamais écrasée`)
  console.log(`  IGNORÉES        : ${nombre(bilan.ignores)}`)
  console.log(`      ${nombre(bilan.detailIgnores.numeroIgnore)}  ${champ.libelle} vide, invalide ou multiple`)
  console.log(`      ${nombre(bilan.detailIgnores.introuvable)}  code agent introuvable en base`)
  console.log(`      ${nombre(bilan.detailIgnores.zeroAmbigu)}  zéro mangé par le tableur, restitution AMBIGUË`)
  console.log(`      ${nombre(bilan.detailIgnores.codeRepete)}  code répété dans le fichier`)
  console.log(`      ${nombre(bilan.detailIgnores.plusieursClients)}  code porté par plusieurs fiches`)

  // ⚠ LES AJUSTEMENTS SE LISENT AVANT D'ÉCRIRE, PAS APRÈS. Ce sont les seules
  //   lignes où le script a changé une donnée du fichier : elles s'écrivent, mais
  //   la boutique doit les avoir vues. `--csv` en donne la liste complète.
  if (bilan.ajustements.codes > 0 || bilan.ajustements.valeurs > 0) {
    console.log('')
    console.log('Ce que le script a ajusté depuis la base :')
    console.log(`  ${nombre(bilan.ajustements.codes)} code(s) agent retrouvé(s) par une correspondance UNIQUE`)
    console.log(`  ${nombre(bilan.ajustements.valeurs)} valeur(s) de « ${champ.colonne} » ajustée(s)`)
  }

  const parStatut = (statut) => plan.lignes.filter((l) => l.statut === statut)

  const plusieurs = fichiers.length > 1
  const montrer = (entete, liste, maximum) => {
    if (liste.length === 0) return
    console.log('')
    console.log(entete)
    for (const l of liste.slice(0, maximum)) {
      const ou = plusieurs && l.fichier ? `${l.fichier} ` : ''
      console.log(`  ${ou}L${l.ligne}  ${l.code}  ${l.nom || '—'}`)
      console.log(`        actuel « ${l.actuel} » → proposé « ${l.propose} »  [${LIBELLES[l.statut]}]`)
      if (l.detail) console.log(`        ${l.detail}`)
    }
    if (liste.length > maximum) console.log(`  … et ${nombre(liste.length - maximum)} autre(s).`)
  }

  // Les conflits en ENTIER : ce sont les seuls qui demandent une décision, et en
  // cacher un derrière un « … et 12 autres » le ferait passer inaperçu.
  montrer('⚠ CONFLITS — une valeur différente est déjà en place (jamais écrasée) :', parStatut(STATUTS.CONFLIT), 200)
  montrer('⚠ ZÉRO AMBIGU — plusieurs codes de la base correspondent (rien n’est écrit) :', parStatut(STATUTS.ZERO_AMBIGU), 50)
  montrer(
    champ.titreAjustements,
    parStatut(STATUTS.A_COMPLETER).filter((l) => (l.zerosCode ?? 0) > 0 || l.ajuste),
    25,
  )
  montrer('Codes introuvables en base :', parStatut(STATUTS.INTROUVABLE), 15)
  montrer('Codes portés par plusieurs fiches :', parStatut(STATUTS.PLUSIEURS_CLIENTS), 15)
  montrer('Codes répétés dans le fichier :', parStatut(STATUTS.CODE_REPETE), 15)
  montrer(`Valeurs de « ${champ.colonne} » ignorées :`, parStatut(STATUTS.NUMERO_IGNORE), 15)
  montrer('Exemples de mises à jour :', parStatut(STATUTS.A_COMPLETER), 10)

  // ⚠ LA RÉPARTITION, PARCE QU'UNE FAUTE DE FRAPPE DANS UN NOM NE SE VOIT PAS
  //   LIGNE PAR LIGNE. Sur quinze mille lignes, « OUEDRAGO S. » écrit une fois à
  //   la place de « OUEDRAOGO S. » passe tous les contrôles de forme : c'est un
  //   nom valide. Il ne se trahit qu'au regroupement, où il apparaît comme un
  //   commercial de plus, avec une fiche au compteur.
  if (champ.cle === 'commercial') {
    const aEcrire = parStatut(STATUTS.A_COMPLETER)
    const compte = new Map()
    for (const l of aEcrire) compte.set(l.propose, (compte.get(l.propose) || 0) + 1)
    const classes = [...compte.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))

    if (classes.length > 0) {
      console.log('')
      console.log(`RÉPARTITION — ${nombre(classes.length)} commercial(aux) distinct(s) parmi les lignes à écrire :`)
      for (const [nom, n] of classes.slice(0, 40)) {
        console.log(`  ${String(nombre(n)).padStart(6)}  ${nom}`)
      }
      if (classes.length > 40) console.log(`  … et ${nombre(classes.length - 40)} autre(s). Liste complète : --csv`)
    }

    const nouveaux = [...new Set(aEcrire.filter((l) => l.nouveau).map((l) => l.propose))]
      .sort((a, b) => a.localeCompare(b, 'fr'))
    if (nouveaux.length > 0) {
      console.log('')
      console.log(`⚠ ${nombre(nouveaux.length)} nom(s) que la base ne porte sur AUCUNE fiche aujourd'hui :`)
      for (const nom of nouveaux.slice(0, 40)) console.log(`  ${nom}  (${nombre(compte.get(nom) ?? 0)} fiche(s))`)
      if (nouveaux.length > 40) console.log(`  … et ${nombre(nouveaux.length - 40)} autre(s).`)
      console.log('  Un nouveau commercial est normal. Une FAUTE DE FRAPPE apparaît ici aussi,')
      console.log('  et nulle part ailleurs : relire cette liste est le seul contrôle qui la voit.')
    }
  }

  if (csvSortie) {
    const csv = (v) => String(v ?? '').replace(/[;\r\n]/g, ' ')
    const entetes = `fichier;ligne;statut;${COLONNE_CODE} du fichier;${COLONNE_CODE} retenu;nom;`
      + `${champ.colonne} actuel;${champ.colonne} propose;detail`
    const corps = plan.lignes.map((l) => [
      csv(l.fichier), l.ligne, LIBELLES[l.statut], csv(l.code), csv(l.codeUtilise), csv(l.nom),
      csv(l.actuel), csv(l.propose), csv(l.detail),
    ].join(';'))
    // BOM : sans lui, Excel ouvre les accents en charabia.
    await writeFile(csvSortie, '﻿' + [entetes, ...corps].join('\r\n'), 'utf8')
    console.log('')
    console.log(`Aperçu complet écrit dans ${csvSortie} (${nombre(corps.length)} ligne(s)).`)
  }

  if (!execute) {
    titre('APERÇU — AUCUNE ÉCRITURE')
    console.log('Aucune fiche modifiée, aucune sauvegarde créée.')
    console.log("Pour appliquer, voir l'en-tête du script : quatre verrous.")
    process.exit(0)
  }

  if (plan.ecritures.length === 0) {
    titre('RIEN À FAIRE')
    console.log('Aucune ligne à mettre à jour. La base est déjà conforme au fichier.')
    process.exit(0)
  }

  // ── Sauvegarde, puis RELECTURE, puis vérification ─────────────────────────
  const horodatage = new Date().toISOString().replace(/[:.]/g, '-')
  const backupDir = backupDirArg ?? join('backups', `${champ.prefixeSauvegarde}-${horodatage}`)

  try {
    const existant = await readdir(backupDir)
    if (existant.length > 0) echouer(`ABANDON : ${backupDir} existe déjà et n'est pas vide.`)
  } catch { /* le dossier n'existe pas : c'est le cas normal */ }

  await mkdir(backupDir, { recursive: true })
  titre('SAUVEGARDE')
  console.log(`Vers ${backupDir} ...`)

  await writeFile(join(backupDir, 'ecritures.json'), JSON.stringify(plan.ecritures, null, 2), 'utf8')
  await writeFile(join(backupDir, 'manifest.json'), JSON.stringify({
    projectId,
    champ: champ.cle,
    colonne: champ.colonne,
    script: champ.script,
    argv,
    fichiers,
    creeLe: new Date().toISOString(),
    bilan,
    ecritures: plan.ecritures.length,
  }, null, 2), 'utf8')

  // ⚠ RELECTURE DEPUIS LE DISQUE, comme pour la fusion. Vérifier la variable en
  //   mémoire ne prouve rien : ce qu'il faut savoir, c'est que le FICHIER est
  //   lisible et complet, parce que c'est lui qui servira à annuler.
  const relues = JSON.parse(await readFile(join(backupDir, 'ecritures.json'), 'utf8'))
  const manques = []
  if (relues.length !== plan.ecritures.length) {
    manques.push(`${relues.length} écriture(s) relue(s) pour ${plan.ecritures.length} prévue(s)`)
  }
  const parId = new Map(relues.map((e) => [e.id, e]))
  for (const ecriture of plan.ecritures) {
    const sauvee = parId.get(ecriture.id)
    if (!sauvee) { manques.push(`fiche absente de la sauvegarde : ${ecriture.id}`); continue }
    // La PRÉSENCE des clés est ce qui rend l'annulation fidèle : sans elle, on
    // remettrait une chaîne vide là où il n'y avait pas de champ du tout.
    for (const cle of Object.keys(ecriture.maj)) {
      if (typeof sauvee.avant?.champs?.[cle]?.present !== 'boolean') {
        manques.push(`fiche ${ecriture.id} : état d'avant de « ${cle} » incomplet, annulation impossible`)
      }
    }
  }
  if (manques.length > 0) {
    console.error("ABANDON : la sauvegarde ne permettrait pas d'annuler :")
    for (const manque of manques.slice(0, 20)) console.error(`  ✗ ${manque}`)
    echouer('Aucune écriture effectuée.')
  }
  console.log(`Relu : ${nombre(relues.length)} écriture(s), état d'avant complet. L'import peut écrire.`)

  // ── Écriture, par lots ────────────────────────────────────────────────────
  titre('MISE À JOUR')
  const lots = enLots(plan.ecritures)
  console.log(`${nombre(plan.ecritures.length)} fiche(s) en ${nombre(lots.length)} lot(s) de ${TAILLE_LOT} au plus ...`)

  let misAJour = 0
  const incidents = []
  for (const { storeId, lot } of lots) {
    try {
      await appliquerLot(lot, storeId, (e) => e.maj, champ.action, backupDir)
      misAJour += lot.length
      if (lots.length > 1) process.stdout.write(`\r  ${nombre(misAJour)} / ${nombre(plan.ecritures.length)}`)
    } catch (error) {
      incidents.push(`lot de ${lot.length} fiche(s) (${storeId ?? 'sans boutique'}) : ${error.message}`)
    }
  }
  if (lots.length > 1) process.stdout.write('\n')

  titre('BILAN')
  console.log(`MIS À JOUR  : ${nombre(misAJour)} fiche(s)`)
  console.log(`INCHANGÉS   : ${nombre(bilan.inchanges)}`)
  console.log(`IGNORÉS     : ${nombre(bilan.ignores)}`)
  console.log(`EN CONFLIT  : ${nombre(bilan.conflits)}  (aucun écrasé)`)
  if (bilan.ajustements.codes > 0 || bilan.ajustements.valeurs > 0) {
    console.log(`dont ajustés depuis la base : ${nombre(bilan.ajustements.codes)} code(s), ${nombre(bilan.ajustements.valeurs)} valeur(s)`)
  }
  console.log('')
  console.log(`Sauvegarde : ${backupDir}`)
  console.log(`Pour annuler : node ${champ.script} --annuler=${backupDir} --execute --allow-production`)
  if (incidents.length > 0) {
    console.log('')
    console.log(`⚠ ${nombre(incidents.length)} lot(s) en échec :`)
    for (const incident of incidents) console.log(`  ✗ ${incident}`)
    console.log('Chaque lot est un batch : ceux-ci sont restés INTACTS, les autres sont')
    console.log('complets. Relancer le script reprend exactement ce qui manque.')
    process.exit(1)
  }
  console.log('')
  console.log('Relancer le même fichier ne changera plus rien : les fiches complétées')
  console.log("sont désormais « inchangées ». C'est vérifiable avec un simple aperçu.")
}
