/**
 * importerNumerosAgent.mjs — compléter le « Numéro agent » des fiches existantes.
 *
 * APERÇU PAR DÉFAUT. Sans `--execute`, ce script ne touche à rien : il lit le
 * fichier, lit la base, et décrit ligne par ligne ce qui se passerait.
 *
 * CE QU'IL FAIT, ET RIEN D'AUTRE
 * ──────────────────────────────
 *   · retrouve la fiche par CORRESPONDANCE EXACTE du code agent, zéros compris ;
 *   · remplit le numéro agent SEULEMENT s'il est vide ;
 *   · ne crée aucune fiche, ne rapproche jamais par le nom ;
 *   · n'efface rien — `numeroPersonnel` et l'ancien `orange` restent intacts ;
 *   · signale conflits, codes introuvables, codes répétés et codes ambigus.
 *
 * LES QUATRE VERROUS POUR ÉCRIRE EN PRODUCTION
 * ────────────────────────────────────────────
 *   1. --execute
 *   2. --allow-production
 *   3. AKAYIS_ALLOW_AGENT_IMPORT='true'
 *   4. le projectId tapé au clavier, sur un vrai terminal
 *
 * ⚠ LE VERROU 3 EST PROPRE À CETTE OPÉRATION. Déverrouiller une fusion de
 *   clients ne doit pas déverrouiller un import, et réciproquement.
 *
 * L'ANNULATION
 * ────────────
 * Chaque exécution écrit une sauvegarde contenant, pour chaque fiche touchée,
 * l'état EXACT d'avant — y compris le fait que les clés existaient ou non.
 * `--annuler=<dossier>` le remet en place, et refuse de toucher une fiche
 * modifiée depuis l'import.
 *
 * Usage :
 *   node scripts/importerNumerosAgent.mjs --dossier=numeros-agent
 *   node scripts/importerNumerosAgent.mjs --fichier=numeros.xlsx
 *   node scripts/importerNumerosAgent.mjs --fichier=lot1.xlsx --fichier=lot2.xlsx
 *   node scripts/importerNumerosAgent.mjs --fichier=numeros.csv --csv=apercu.csv
 *   node scripts/importerNumerosAgent.mjs --fichier=numeros.xlsx --execute --allow-production
 *   node scripts/importerNumerosAgent.mjs --annuler=backups/import-numeros-… --execute --allow-production
 *
 * Options :
 *   --dossier=    tous les tableurs d'un dossier, triés par nom. LE PLUS SIMPLE
 *                 quand les 15 000 lignes arrivent découpées en lots.
 *   --fichier=    le .xlsx ou .csv à lire. RÉPÉTABLE, ou séparé par des virgules :
 *                 les lots sont réunis avant la planification, pour qu'un code
 *                 présent dans deux fichiers soit vu comme répété.
 *   --feuille=    la feuille du classeur à lire (défaut : la première)
 *   --csv=        écrit l'aperçu COMPLET dans un CSV (16 000 lignes ne se lisent pas au terminal)
 *   --annuler=    remet en place une sauvegarde d'import
 *   --backup-dir= où écrire la sauvegarde (défaut : backups/import-numeros-<horodatage>)
 *   --taille-lot= nombre d'écritures par lot (défaut : 400, maximum 450)
 */

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { resolveResetProject, PRODUCTION_PROJECT_ID } from './lib/assertResetProject.mjs'
import { echouerAvecAide } from './lib/aideIdentifiants.mjs'
import { analyserCsv, lireClasseur } from './lib/lireTableur.mjs'
import {
  planifierImport, trouverColonnes, STATUTS, COLONNE_CODE, COLONNE_NUMERO,
} from './lib/importNumerosAgent.mjs'

const argv = process.argv.slice(2)
const valeur = (prefixe, defaut) => {
  const trouve = argv.find((a) => a.startsWith(prefixe))
  return trouve ? trouve.slice(prefixe.length) : defaut
}

const execute = argv.includes('--execute')
const allowProductionFlag = argv.includes('--allow-production')
// ⚠ PLUSIEURS FICHIERS, ET CE N'EST PAS UN CONFORT. `valeur()` ne rend que la
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
const dossierSource = valeur('--dossier=', null)
const feuilleVoulue = valeur('--feuille=', null)
const csvSortie = valeur('--csv=', null)
const dossierAnnulation = valeur('--annuler=', null)
const backupDirArg = valeur('--backup-dir=', null)
const TAILLE_LOT = Math.min(Number(valeur('--taille-lot=', '400')) || 400, 450)

const echouer = (message) => {
  console.error('')
  console.error(message)
  process.exit(1)
}

const nombre = (n) => Number(n).toLocaleString('fr-FR')
const titre = (texte) => {
  console.log('')
  console.log(texte)
  console.log('─'.repeat(texte.length))
}

/**
 * ⚠ UN DOSSIER PLUTÔT QU'UNE LISTE, PARCE QUE QUINZE MILLE LIGNES ARRIVENT
 *   DÉCOUPÉES EN LOTS.
 *
 *   Taper `--fichier=` autant de fois qu'il y a de fichiers n'est pas une
 *   réponse : c'est long, et surtout un fichier oublié ne se voit pas — l'import
 *   réussirait, le bilan serait cohérent, et quelques centaines de fiches
 *   resteraient vides sans que rien ne le dise. Désigner le DOSSIER supprime la
 *   question : ce qui est dedans est traité.
 *
 * ⚠ LES FICHIERS DE VERROU D'EXCEL SONT ÉCARTÉS. Un classeur ouvert dans Excel
 *   crée à côté de lui un `~$classeur.xlsx` : un fichier de quelques octets, au
 *   nom et à l'extension d'un vrai classeur, mais qui n'en est pas un. Le lire
 *   ferait échouer l'import au milieu du dossier, pour une raison introuvable.
 *   Les noms commençant par `~$` sont donc ignorés, et comptés à part.
 *
 * ⚠ L'ORDRE EST ALPHABÉTIQUE, ET IL DOIT L'ÊTRE. Sans tri, l'ordre dépend du
 *   système de fichiers : deux exécutions pourraient numéroter les lignes
 *   autrement, et l'aperçu ne décrirait plus ce que `--execute` va faire.
 */
const EXTENSIONS_TABLEUR = new Set(['.xlsx', '.xlsm', '.xls', '.csv', '.txt'])
let fichiers = fichiersNommes

if (dossierSource) {
  if (fichiersNommes.length > 0) {
    echouer('--dossier et --fichier s\'excluent : désigner le dossier, ou les fichiers un par un.')
  }
  let entrees
  try {
    entrees = await readdir(dossierSource)
  } catch (error) {
    echouer(`Dossier illisible : ${dossierSource}\n  (${error.message})`)
  }

  const verrous = entrees.filter((e) => e.startsWith('~$'))
  fichiers = entrees
    .filter((e) => !e.startsWith('~$') && EXTENSIONS_TABLEUR.has(extname(e).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }))
    .map((e) => join(dossierSource, e))

  titre(`DOSSIER : ${dossierSource}`)
  if (fichiers.length === 0) {
    echouer(
      `Aucun tableur dans ${dossierSource}.\n`
      + `Extensions reconnues : ${[...EXTENSIONS_TABLEUR].join(', ')}.`,
    )
  }
  console.log(`${nombre(fichiers.length)} fichier(s) à traiter, dans cet ordre :`)
  for (const f of fichiers) console.log(`  ${f}`)
  if (verrous.length > 0) {
    console.log('')
    console.log(`⚠ ${nombre(verrous.length)} fichier(s) de verrou Excel ignoré(s) : ${verrous.join(', ')}`)
    console.log('  Ce sont des fichiers temporaires créés par un classeur OUVERT.')
    console.log('  Fermer Excel avant de lancer l\'import évite toute surprise.')
  }
}

if (fichiers.length === 0 && !dossierAnnulation) {
  echouer(
    'Rien à faire. Trois façons de désigner les données :\n'
    + '  --dossier=<dossier>   tous les tableurs du dossier (le plus simple)\n'
    + '  --fichier=<fichier>   répétable, ou séparé par des virgules\n'
    + '  --annuler=<dossier>   remet en place une sauvegarde d\'import\n'
    + `\nChaque fichier doit porter deux colonnes : « ${COLONNE_CODE} » et « ${COLONNE_NUMERO} ».`,
  )
}
if ((fichiers.length > 0 || dossierSource) && dossierAnnulation) {
  echouer('--fichier et --annuler s\'excluent : importer ou annuler, pas les deux.')
}

// ════════════════════════════════════════════════════════════════════════════
// LECTURE DU FICHIER — AVANT TOUTE CHOSE, ET SANS AUCUN IDENTIFIANT
// ════════════════════════════════════════════════════════════════════════════
//
// ⚠ L'ORDRE EST UNE CORRECTION, PAS UN DÉTAIL. Cette lecture venait APRÈS le
//   contrôle des identifiants : savoir si un fichier était bien formé exigeait
//   donc un accès à la production. Celui qui FABRIQUE le fichier n'a pas cet
//   accès — et c'est précisément lui qui a besoin de la réponse. Résultat : le
//   fichier faisait l'aller-retour, et le seul diagnostic disponible était
//   « ça refuse ».
//
//   Le fichier est local, le contrôle est local : il passe donc en premier. Un
//   fichier mal formé est désormais refusé sans Firebase, sans identifiants, et
//   avec les en-têtes réellement lus sous les yeux.
let lignes = []
let tableurs = []

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

  const colonnes = trouverColonnes(tableur.entetes)
  if (colonnes.erreur) echouer(`${chemin} :\n${colonnes.erreur}`)
  console.log(`Colonnes retenues : code = « ${colonnes.code} », numéro = « ${colonnes.numero} »`)

  // `numeriques` dit, case par case, si le tableur l'a stockée comme un NOMBRE —
  // donc si ses zéros de tête ont pu être mangés. C'est ce qui autorise
  // `resoudreCode` à les restituer depuis la base au lieu de les deviner.
  const ajout = tableur.lignes.map((ligne, index) => ({
    fichier: chemin,
    ligne: index + 2, // +2 : l'en-tête est la ligne 1, et les tableurs comptent de 1
    code: ligne[colonnes.code],
    numero: ligne[colonnes.numero],
    codeNumerique: Boolean(tableur.numeriques?.[index]?.[colonnes.code]),
    numeroNumerique: Boolean(tableur.numeriques?.[index]?.[colonnes.numero]),
  }))

  const numeriques = ajout.filter((l) => l.codeNumerique || l.numeroNumerique).length
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
  console.log('dans deux fichiers est donc vu comme répété, et aucun des deux n\'est écrit.')
}

if (lignes.length === 0 && !dossierAnnulation) {
  echouer('Aucune ligne de données dans le ou les fichiers fournis.')
}

// ── Identifiants ────────────────────────────────────────────────────────────
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
    + 'Ce script n\'écrit que dans la production de ce dépôt ou un projet demo-*.',
  )
}

// ── Verrou 4 : la confirmation au clavier ───────────────────────────────────
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
    ? 'ANNULATION d\'un import de numéros agent'
    : 'MISE À JOUR du numéro agent de fiches clients'
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
      actorScript: 'scripts/importerNumerosAgent.mjs',
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

// ════════════════════════════════════════════════════════════════════════════
// ANNULATION
// ════════════════════════════════════════════════════════════════════════════
if (dossierAnnulation) {
  titre('ANNULATION D\'UN IMPORT')
  let sauvegarde
  try {
    sauvegarde = JSON.parse(await readFile(join(dossierAnnulation, 'ecritures.json'), 'utf8'))
  } catch (error) {
    echouer(`Sauvegarde illisible : ${join(dossierAnnulation, 'ecritures.json')}\n  (${error.message})`)
  }
  console.log(`${nombre(sauvegarde.length)} fiche(s) à remettre dans leur état d'avant.`)

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
    if (String(actuel.numeroAgent ?? '') !== String(ecriture.maj.numeroAgent)) {
      modifiees.push(`${ecriture.id} : numéro agent « ${actuel.numeroAgent ?? ''} » ≠ « ${ecriture.maj.numeroAgent} » écrit par l'import`)
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
  const champsDAnnulation = (ecriture) => ({
    codeAgent: ecriture.avant.codeAgentPresent ? ecriture.avant.codeAgent : FieldValue.delete(),
    numeroAgent: ecriture.avant.numeroAgentPresent ? ecriture.avant.numeroAgent : FieldValue.delete(),
  })

  let remises = 0
  const incidents = []
  for (const { storeId, lot } of enLots(aRemettre)) {
    try {
      await appliquerLot(lot, storeId, champsDAnnulation, 'AGENT_IMPORT_REVERTED', dossierAnnulation)
      remises += lot.length
    } catch (error) {
      incidents.push(`lot de ${lot.length} fiche(s) (${storeId ?? 'sans boutique'}) : ${error.message}`)
    }
  }

  titre('RÉSULTAT')
  console.log(`${nombre(remises)} fiche(s) remise(s) dans leur état d'avant`)
  console.log(`${nombre(modifiees.length)} fiche(s) laissée(s) en place (modifiées depuis)`)
  if (incidents.length > 0) {
    console.log('')
    console.log(`⚠ ${nombre(incidents.length)} lot(s) en échec :`)
    for (const incident of incidents) console.log(`  ✗ ${incident}`)
    console.log('Chaque lot est un batch : ceux-ci sont restés INTACTS. Le script est relançable.')
  }
  process.exit(incidents.length > 0 ? 1 : 0)
}

// ════════════════════════════════════════════════════════════════════════════
// IMPORT
// ════════════════════════════════════════════════════════════════════════════
titre('LECTURE DE LA BASE')
const snap = await db.collection('globalClients').get()
const fiches = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
console.log(`${nombre(fiches.length)} fiche(s) lue(s) dans globalClients.`)

const plan = planifierImport(lignes, fiches)
const { bilan } = plan

// ── L'aperçu ────────────────────────────────────────────────────────────────
titre('APERÇU')
console.log(`${nombre(bilan.total)} ligne(s) du fichier :`)
console.log('')
console.log(`  À METTRE À JOUR : ${nombre(bilan.misAJour)}  — numéro agent vide, numéro valide`)
console.log(`  INCHANGÉES      : ${nombre(bilan.inchanges)}  — le même numéro est déjà en place`)
console.log(`  EN CONFLIT      : ${nombre(bilan.conflits)}  — un AUTRE numéro est en place, jamais écrasé`)
console.log(`  IGNORÉES        : ${nombre(bilan.ignores)}`)
console.log(`      ${nombre(bilan.detailIgnores.numeroIgnore)}  numéro vide, invalide ou multiple`)
console.log(`      ${nombre(bilan.detailIgnores.introuvable)}  code agent introuvable en base`)
console.log(`      ${nombre(bilan.detailIgnores.zeroAmbigu)}  zéro mangé par le tableur, restitution AMBIGUË`)
console.log(`      ${nombre(bilan.detailIgnores.codeRepete)}  code répété dans le fichier`)
console.log(`      ${nombre(bilan.detailIgnores.plusieursClients)}  code porté par plusieurs fiches`)

// ⚠ LES RESTITUTIONS DE ZÉRO SE LISENT AVANT D'ÉCRIRE, PAS APRÈS. Ce sont les
//   seules lignes où le script a complété une donnée du fichier : elles
//   s'écrivent, mais la boutique doit les avoir vues. `--csv` en donne la liste.
if (bilan.zerosRestitues.codes > 0 || bilan.zerosRestitues.numeros > 0) {
  console.log('')
  console.log('Zéros de tête restitués (le tableur les avait mangés) :')
  console.log(`  ${nombre(bilan.zerosRestitues.codes)} code(s) agent retrouvé(s) par une correspondance UNIQUE en base`)
  console.log(`  ${nombre(bilan.zerosRestitues.numeros)} numéro(s) agent complété(s) jusqu'à 8 chiffres`)
}

const LIBELLES = {
  [STATUTS.A_COMPLETER]: 'à mettre à jour',
  [STATUTS.INCHANGE]: 'inchangée',
  [STATUTS.CONFLIT]: 'CONFLIT',
  [STATUTS.NUMERO_IGNORE]: 'numéro ignoré',
  [STATUTS.INTROUVABLE]: 'introuvable',
  [STATUTS.ZERO_AMBIGU]: 'ZÉRO AMBIGU',
  [STATUTS.CODE_REPETE]: 'code répété',
  [STATUTS.PLUSIEURS_CLIENTS]: 'plusieurs fiches',
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
montrer('⚠ CONFLITS — un numéro différent est déjà en place (jamais écrasé) :', parStatut(STATUTS.CONFLIT), 200)
montrer('⚠ ZÉRO AMBIGU — plusieurs codes de la base correspondent (rien n’est écrit) :', parStatut(STATUTS.ZERO_AMBIGU), 50)
montrer(
  'Zéros restitués — à relire avant d’écrire :',
  parStatut(STATUTS.A_COMPLETER).filter((l) => (l.zerosCode ?? 0) > 0 || (l.zerosRestitues ?? 0) > 0),
  25,
)
montrer('Codes introuvables en base :', parStatut(STATUTS.INTROUVABLE), 15)
montrer('Codes portés par plusieurs fiches :', parStatut(STATUTS.PLUSIEURS_CLIENTS), 15)
montrer('Codes répétés dans le fichier :', parStatut(STATUTS.CODE_REPETE), 15)
montrer('Numéros ignorés :', parStatut(STATUTS.NUMERO_IGNORE), 15)
montrer('Exemples de mises à jour :', parStatut(STATUTS.A_COMPLETER), 10)

if (csvSortie) {
  const csv = (v) => String(v ?? '').replace(/[;\r\n]/g, ' ')
  const entetes = `fichier;ligne;statut;${COLONNE_CODE} du fichier;${COLONNE_CODE} retenu;nom;numero agent actuel;numero agent propose;detail`
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
  console.log('Pour appliquer, voir l\'en-tête du script : quatre verrous.')
  process.exit(0)
}

if (plan.ecritures.length === 0) {
  titre('RIEN À FAIRE')
  console.log('Aucune ligne à mettre à jour. La base est déjà conforme au fichier.')
  process.exit(0)
}

// ── Sauvegarde, puis RELECTURE, puis vérification ───────────────────────────
const horodatage = new Date().toISOString().replace(/[:.]/g, '-')
const backupDir = backupDirArg ?? join('backups', `import-numeros-${horodatage}`)

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
  script: 'scripts/importerNumerosAgent.mjs',
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
  if (sauvee.avant?.codeAgentPresent === undefined || sauvee.avant?.numeroAgentPresent === undefined) {
    manques.push(`fiche ${ecriture.id} : état d'avant incomplet, annulation impossible`)
  }
}
if (manques.length > 0) {
  console.error('ABANDON : la sauvegarde ne permettrait pas d\'annuler :')
  for (const manque of manques.slice(0, 20)) console.error(`  ✗ ${manque}`)
  echouer('Aucune écriture effectuée.')
}
console.log(`Relu : ${nombre(relues.length)} écriture(s), état d'avant complet. L'import peut écrire.`)

// ── Écriture, par lots ──────────────────────────────────────────────────────
titre('MISE À JOUR')
const lots = enLots(plan.ecritures)
console.log(`${nombre(plan.ecritures.length)} fiche(s) en ${nombre(lots.length)} lot(s) de ${TAILLE_LOT} au plus ...`)

let misAJour = 0
const incidents = []
for (const { storeId, lot } of lots) {
  try {
    await appliquerLot(lot, storeId, (e) => e.maj, 'AGENT_NUMBER_IMPORTED', backupDir)
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
if (bilan.zerosRestitues.codes > 0 || bilan.zerosRestitues.numeros > 0) {
  console.log(`dont zéros restitués : ${nombre(bilan.zerosRestitues.codes)} code(s), ${nombre(bilan.zerosRestitues.numeros)} numéro(s)`)
}
console.log('')
console.log(`Sauvegarde : ${backupDir}`)
console.log(`Pour annuler : node scripts/importerNumerosAgent.mjs --annuler=${backupDir} --execute --allow-production`)
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
console.log('sont désormais « inchangées ». C\'est vérifiable avec un simple aperçu.')
