/**
 * importNumerosAgent.mjs — compléter le « Numéro agent » des fiches existantes.
 *
 * PUR : aucune I/O, aucun Firebase, aucun tableur. `scripts/importerNumerosAgent.mjs`
 * apporte les lignes du fichier et les fiches de la base ; ce module ne fait que
 * décider, ligne par ligne. Même séparation que `fusionClients.mjs`, et pour la
 * même raison : une décision qui écrit en production doit pouvoir être éprouvée
 * cas par cas sans base ni fichier.
 *
 * TROIS CHAMPS DISTINCTS, ET ILS NE SE CONFONDENT JAMAIS
 * ──────────────────────────────────────────────────────
 *   · Code agent       — 7 chiffres en général. Sert à RETROUVER la fiche.
 *   · Numéro agent     — 8 chiffres. C'est ce qu'on AJOUTE.
 *   · Numéro personnel — le téléphone du commerçant. JAMAIS touché, jamais lu
 *                        comme un numéro agent. C'est une colonne piège : un
 *                        fichier qui la contient ne doit pas la voir prise pour
 *                        l'autre, d'où le refus explicite dans `trouverColonnes`.
 *
 * ⚠ CE MODULE NE FAIT JAMAIS
 *   · créer une fiche — un code inconnu est signalé, pas inséré ;
 *   · rapprocher par le nom — seul le code agent identifie, à l'exact ;
 *   · écraser une valeur — un numéro déjà présent et différent est un CONFLIT ;
 *   · effacer quoi que ce soit, `orange` et `numeroPersonnel` compris.
 */

import { champsAgent } from '../../src/utils/agentFields.js'
import { plier } from './doublonsClients.mjs'

/** Les intitulés du formulaire, à la lettre. */
export const COLONNE_CODE = 'Code agent'
export const COLONNE_NUMERO = 'Numéro agent'
export const COLONNE_INTERDITE = 'Numéro personnel'

/** La longueur d'un numéro agent, reprise de l'application. */
export const LONGUEUR_NUMERO = 8

export const STATUTS = Object.freeze({
  A_COMPLETER: 'a-completer',
  INCHANGE: 'inchange',
  CONFLIT: 'conflit',
  NUMERO_IGNORE: 'numero-ignore',
  INTROUVABLE: 'introuvable',
  ZERO_AMBIGU: 'zero-ambigu',
  CODE_REPETE: 'code-repete',
  PLUSIEURS_CLIENTS: 'plusieurs-clients',
})

/** Le seul statut qui écrit. */
const ECRIT = new Set([STATUTS.A_COMPLETER])

const texte = (valeur) => (valeur === null || valeur === undefined ? '' : String(valeur))

/**
 * Le code agent d'une ligne de fichier : du TEXTE, zéros initiaux compris.
 *
 * ⚠ AUCUN REMPLISSAGE À L'AVEUGLE ICI, contrairement au numéro. Le numéro est
 *   validé par sa longueur (8) ; le code n'a aucune longueur garantie — la base
 *   en contient de 1 à 10 chiffres. Compléter un code sans vérification le ferait
 *   pointer vers la fiche d'un autre commerce.
 *
 *   Le zéro mangé par Excel est rattrapé autrement, par `resoudreCode` : en
 *   cherchant la variante dans la BASE, et seulement si elle est unique.
 */
export const normaliserCodeAgent = (valeur) => texte(valeur).trim()

/** Ce qui sépare visiblement deux numéros dans une même case. */
const SEPARATEURS = /[/,;|]|\bet\b|\bou\b|\n/i

/**
 * Le numéro agent d'une ligne, ou le motif du refus.
 *
 * @param valeur           la case, telle que le tableur l'a rendue
 * @param celluleNumerique Excel a-t-il stocké cette case comme un NOMBRE ?
 * @returns {{numero: string, zerosRestitues: number}|{refus: string, detail: string}}
 *
 * ⚠ POURQUOI LES ESPACES INTÉRIEURS DISPARAISSENT AUSSI. La consigne dit « retire
 *   les espaces autour ». Mais « 01 23 45 67 » est UN numéro écrit avec des
 *   espaces, et le refuser rejetterait une saisie parfaitement lisible. Les
 *   enlever tous est sans risque parce que la LONGUEUR tranche ensuite : deux
 *   numéros collés par un espace (« 1234567 7654321 ») font 14 chiffres et sont
 *   refusés. L'espace ne peut donc pas servir à faire passer un multiple.
 *
 * ⚠ LE CAS MULTIPLE EST RÉEL. La base contient « 06629924/55772628 » et
 *   « 07796503/66553459/75928339 » dans des champs de numéro. Un tel contenu ne
 *   désigne pas un numéro agent : on l'ignore plutôt que d'en choisir un.
 *
 * ⚠ LA DISSYMÉTRIE TEXTE / NOMBRE EST VOULUE, et c'est elle qui rend Excel sûr.
 *   Une case TEXTE contient ce que la boutique a écrit : sept chiffres se
 *   complètent (la consigne le dit), six chiffres sont une erreur de saisie et
 *   sont REFUSÉS. Une case NOMBRE, elle, a traversé Excel : ses zéros de tête ont
 *   pu être mangés par le tableur, et comme la cible fait exactement huit
 *   chiffres, les restituer n'invente rien — « 234567 » dans une case nombre ne
 *   peut avoir été que « 00234567 ». Chaque restitution est comptée et affichée.
 */
export function normaliserNumeroAgent(valeur, celluleNumerique = false) {
  const brut = texte(valeur).trim()
  if (brut === '') return { refus: 'vide', detail: 'case vide' }

  // ⚠ LA CELLULE QU'EXCEL A CONVERTIE EN DATE, reconnue AVANT le test « plusieurs
  //   numéros ». Sans ce cas, « 23/01/2026 » était refusé pour la bonne raison
  //   (on n'écrit rien) mais avec le mauvais motif : « plusieurs numéros »,
  //   envoyant la boutique chercher une barre de séparation dans une case qui
  //   n'en avait jamais eu. Un refus doit dire ce qui s'est réellement passé.
  //
  //   Le cas arrive aussi en CSV : un fichier exporté depuis un classeur où la
  //   conversion a déjà eu lieu porte la date, pas le code. Le contrôle est donc
  //   ici, dans la normalisation, et non dans la lecture du classeur.
  if (/^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}$/.test(brut)) {
    return {
      refus: 'date',
      detail: `« ${brut} » est une date : le tableur a converti la saisie.`
        + ' Reformater la colonne en TEXTE dans le classeur et réexporter.',
    }
  }

  if (SEPARATEURS.test(brut)) {
    return { refus: 'multiple', detail: `plusieurs numéros : « ${brut} »` }
  }

  const sansEspaces = brut.replace(/\s+/g, '')
  if (!/^\d+$/.test(sansEspaces)) {
    return { refus: 'non-numerique', detail: `caractères non numériques : « ${brut} »` }
  }

  if (sansEspaces.length > LONGUEUR_NUMERO) {
    return { refus: 'longueur', detail: `${sansEspaces.length} chiffres au lieu de ${LONGUEUR_NUMERO} : « ${brut} »` }
  }

  // Une case NOMBRE se complète jusqu'à huit ; une case TEXTE, seulement de sept.
  const complementAutorise = celluleNumerique || sansEspaces.length === LONGUEUR_NUMERO - 1
  if (sansEspaces.length < LONGUEUR_NUMERO && !complementAutorise) {
    return {
      refus: 'longueur',
      detail: `${sansEspaces.length} chiffres au lieu de ${LONGUEUR_NUMERO} : « ${brut} »`
        + ' (case texte : non complétée, car son contenu est celui qui a été saisi)',
    }
  }

  return {
    numero: sansEspaces.padStart(LONGUEUR_NUMERO, '0'),
    zerosRestitues: LONGUEUR_NUMERO - sansEspaces.length,
  }
}

/**
 * Les fiches de la base rangées par code agent.
 *
 * ⚠ LE CODE EST LU PAR `champsAgent`, LA FONCTION DE L'ÉCRAN. Une fiche d'avant
 *   la séparation porte son identifiant dans `orange` ; `champsAgent` la range à
 *   la lecture, par la longueur. Réécrire cette règle ici ferait deux vérités, et
 *   l'import chercherait dans une base que la boutique ne voit pas.
 *
 *   Conséquence voulue : une fiche dont `orange` fait 8 chiffres est rangée comme
 *   un NUMÉRO agent, pas un code. Elle n'est donc pas trouvable par code — et
 *   c'est juste, puisqu'elle a déjà un numéro.
 */
export function indexerParCodeAgent(fiches = []) {
  const parCode = new Map()
  for (const fiche of fiches) {
    const { codeAgent } = champsAgent(fiche)
    if (!codeAgent) continue
    if (!parCode.has(codeAgent)) parCode.set(codeAgent, [])
    parCode.get(codeAgent).push(fiche)
  }
  return parCode
}

/** Les longueurs de code qui existent réellement en base, croissantes. */
export const longueursDeCode = (parCode) => [...new Set([...parCode.keys()].map((c) => c.length))]
  .sort((a, b) => a - b)

/**
 * ⚠ LE ZÉRO QU'EXCEL A MANGÉ, RETROUVÉ DANS LA BASE PLUTÔT QUE DEVINÉ.
 *
 *   Une case NOMBRE a perdu ses zéros de tête dans le fichier lui-même : aucune
 *   lecture ne les récupère. Mais on n'a pas besoin de les deviner — la base les
 *   connaît. On complète donc le code jusqu'aux longueurs QUI EXISTENT en base,
 *   et on ne retient la variante que si elle est UNIQUE.
 *
 *   · exact trouvé            → c'est lui, le remplissage ne s'applique pas ;
 *   · une seule variante      → c'est le même code, on le dit et on continue ;
 *   · plusieurs variantes     → AMBIGU, on s'arrête (« 0123456 » et « 00123456 »
 *                               existent tous les deux : choisir serait tirer au
 *                               sort sur la fiche d'un commerce) ;
 *   · aucune                  → introuvable, comme avant.
 *
 * ⚠ CE RATTRAPAGE NE S'APPLIQUE QU'AUX CASES NOMBRE. Sur une case TEXTE,
 *   « 123456 » est ce que la boutique a écrit : le compléter serait corriger une
 *   saisie, pas réparer un dégât du tableur.
 */
export function resoudreCode(code, parCode, longueurs = longueursDeCode(parCode)) {
  if (parCode.has(code)) return { code, zerosRestitues: 0 }

  const variantes = longueurs
    .filter((longueur) => longueur > code.length)
    .map((longueur) => code.padStart(longueur, '0'))
    .filter((variante) => parCode.has(variante))

  if (variantes.length === 1) {
    return { code: variantes[0], zerosRestitues: variantes[0].length - code.length }
  }
  if (variantes.length > 1) return { ambigu: variantes }
  return { introuvable: true }
}

/**
 * Les deux colonnes attendues, trouvées dans les en-têtes réels du fichier.
 *
 * Le rapprochement se fait sur l'en-tête PLIÉ (sans accents, sans casse, espaces
 * réduits) : « Numero agent », « NUMÉRO AGENT  » et « Numéro Agent » sont le même
 * intitulé mal tapé, et refuser le fichier pour ça n'aiderait personne.
 *
 * ⚠ MAIS « NUMÉRO PERSONNEL » N'EST PAS « NUMÉRO AGENT ». Ce sont les deux
 *   colonnes les plus faciles à confondre, et les confondre écrirait le téléphone
 *   du commerçant dans sa case numéro agent — sur des milliers de fiches, sans
 *   qu'aucune règle de longueur ne s'en plaigne (les deux font 8 chiffres). Le
 *   rapprochement est donc EXACT après pliage, jamais par inclusion.
 *
 * @returns {{code: string, numero: string}|{erreur: string}}
 */
export function trouverColonnes(entetes = []) {
  const vus = entetes.map((e) => ({ brut: e, plie: plier(e) }))
  const chercher = (attendu) => vus.filter((v) => v.plie === plier(attendu))

  for (const [attendu, nom] of [[COLONNE_CODE, 'code'], [COLONNE_NUMERO, 'numéro']]) {
    const trouves = chercher(attendu)
    if (trouves.length === 0) {
      const personnel = chercher(COLONNE_INTERDITE)
      const indice = nom === 'numéro' && personnel.length > 0
        ? `\nLe fichier contient « ${personnel[0].brut} » : ce n'est PAS le numéro agent,`
          + ' ce sont deux champs distincts et aucun des deux ne remplace l\'autre.'
        : ''
      return {
        erreur: `Colonne « ${attendu} » absente.\nEn-têtes lus : ${entetes.map((e) => `« ${e} »`).join(', ') || '(aucun)'}${indice}`,
      }
    }
    if (trouves.length > 1) {
      return { erreur: `Colonne « ${attendu} » présente ${trouves.length} fois. Ambiguïté : fichier refusé.` }
    }
  }

  return { code: chercher(COLONNE_CODE)[0].brut, numero: chercher(COLONNE_NUMERO)[0].brut }
}

/** Le nom affichable d'une fiche, pour l'aperçu. */
const nomDe = (fiche) => `${fiche?.nom ?? ''} ${fiche?.prenom ?? ''}`.trim() || '(sans nom)'

/**
 * Ce que l'import ferait, ligne par ligne — et rien de plus.
 *
 * @param {Array<{ligne: number, code: string, numero: string,
 *                codeNumerique?: boolean, numeroNumerique?: boolean}>} lignes
 * @param {Array<object>} fiches  les fiches de `globalClients`
 */
export function planifierImport(lignes = [], fiches = []) {
  const parCode = indexerParCodeAgent(fiches)
  const longueurs = longueursDeCode(parCode)

  // ⚠ LES RÉPÉTITIONS SE COMPTENT AVANT DE DÉCIDER, et sur le code RÉSOLU : deux
  //   lignes portant « 123456 » et « 0123456 » désignent la même fiche dès que le
  //   zéro est restitué, et c'est donc bien une répétition. Les compter sur le
  //   code brut laisserait passer deux écritures sur la même fiche, dont la
  //   seconde écraserait la première — exactement ce que « sans doublon » exclut.
  const resolu = new Map()
  const resoudre = (brute) => {
    const code = normaliserCodeAgent(brute.code)
    if (!code) return null
    const cle = `${code}|${brute.codeNumerique ? 'n' : 's'}`
    if (!resolu.has(cle)) {
      resolu.set(cle, brute.codeNumerique ? resoudreCode(code, parCode, longueurs) : (
        parCode.has(code) ? { code, zerosRestitues: 0 } : { introuvable: true }
      ))
    }
    return { code, ...resolu.get(cle) }
  }

  const occurrences = new Map()
  for (const brute of lignes) {
    const r = resoudre(brute)
    // On ne compte que les codes qui désignent une fiche : deux lignes
    // introuvables partageant un code n'ont pas besoin qu'on leur dise
    // « répété », « introuvable » est la réponse la plus utile des deux.
    if (!r || r.ambigu || r.introuvable) continue
    occurrences.set(r.code, (occurrences.get(r.code) || 0) + 1)
  }

  const resultats = []

  for (const brute of lignes) {
    const code = normaliserCodeAgent(brute.code)
    const base = {
      ligne: brute.ligne, code, nom: '', actuel: '', propose: '', zerosRestitues: 0, codeUtilise: code,
    }

    if (!code) {
      resultats.push({ ...base, statut: STATUTS.NUMERO_IGNORE, detail: 'code agent vide' })
      continue
    }

    const numero = normaliserNumeroAgent(brute.numero, Boolean(brute.numeroNumerique))
    if (numero.refus) {
      resultats.push({ ...base, statut: STATUTS.NUMERO_IGNORE, detail: numero.detail })
      continue
    }
    base.propose = numero.numero
    base.zerosRestitues = numero.zerosRestitues

    const r = resoudre(brute)

    if (r.ambigu) {
      resultats.push({
        ...base,
        statut: STATUTS.ZERO_AMBIGU,
        detail: `le tableur a mangé le ou les zéros de tête, et ${r.ambigu.length} codes de la base`
          + ` correspondent : ${r.ambigu.join(', ')}. Reformater la colonne en TEXTE et réexporter.`,
      })
      continue
    }

    if (r.introuvable) {
      // Sur une case TEXTE, on ne rattrape rien — mais on peut tout de même DIRE
      // qu'une variante zéro-complétée existe, pour que la boutique sache quoi
      // corriger dans son fichier.
      const variantes = longueurs
        .filter((l) => l > code.length)
        .map((l) => code.padStart(l, '0'))
        .filter((v) => parCode.has(v))
      const indice = variantes.length > 0
        ? ` — mais ${variantes.map((v) => `« ${v} »`).join(' et ')} existe(nt) en base.`
          + ' Si la colonne est en TEXTE, c\'est le fichier qui porte un code tronqué ;'
          + ' la reformater en TEXTE puis réexporter règle les deux cas.'
        : ''
      resultats.push({ ...base, statut: STATUTS.INTROUVABLE, detail: `aucune fiche avec ce code${indice}` })
      continue
    }

    base.codeUtilise = r.code
    const candidates = parCode.get(r.code)

    if (occurrences.get(r.code) > 1) {
      resultats.push({
        ...base,
        statut: STATUTS.CODE_REPETE,
        detail: `code présent ${occurrences.get(r.code)} fois dans le fichier`
          + (r.zerosRestitues > 0 ? ` (après restitution du zéro : « ${r.code} »)` : ''),
      })
      continue
    }

    if (candidates.length > 1) {
      resultats.push({
        ...base,
        nom: candidates.map(nomDe).join(' · '),
        statut: STATUTS.PLUSIEURS_CLIENTS,
        detail: `${candidates.length} fiches portent ce code : ${candidates.map((f) => f.id).join(', ')}`,
      })
      continue
    }

    const fiche = candidates[0]
    const actuelBrut = champsAgent(fiche).numeroAgent
    base.nom = nomDe(fiche)
    base.actuel = actuelBrut
    const zeroCode = r.zerosRestitues > 0
      ? `code « ${code} » → « ${r.code} », ${r.zerosRestitues} zéro(s) restitué(s) depuis la base`
      : ''

    if (actuelBrut !== '') {
      // ⚠ COMPARAISON SUR LA FORME NORMALISÉE, PAS SUR LA CHAÎNE BRUTE. Sinon un
      //   espace résiduel ou un zéro manquant en base ferait un « conflit » là où
      //   il n'y a qu'une écriture différente du même numéro — et la boutique
      //   partirait vérifier à la main des centaines de faux problèmes.
      const actuel = normaliserNumeroAgent(actuelBrut)
      if (!actuel.refus && actuel.numero === numero.numero) {
        resultats.push({
          ...base,
          statut: STATUTS.INCHANGE,
          fiche,
          detail: [actuelBrut === numero.numero ? '' : `déjà présent, écrit « ${actuelBrut} »`, zeroCode]
            .filter(Boolean).join(' · '),
        })
      } else {
        resultats.push({
          ...base,
          statut: STATUTS.CONFLIT,
          fiche,
          detail: [`la fiche porte déjà « ${actuelBrut} », le fichier propose « ${numero.numero} »`, zeroCode]
            .filter(Boolean).join(' · '),
        })
      }
      continue
    }

    const zeroNumero = numero.zerosRestitues > 0
      ? `numéro complété de ${numero.zerosRestitues} zéro(s) de tête`
      : ''
    resultats.push({
      ...base,
      statut: STATUTS.A_COMPLETER,
      fiche,
      zerosRestitues: numero.zerosRestitues,
      zerosCode: r.zerosRestitues,
      detail: [zeroCode, zeroNumero].filter(Boolean).join(' · '),
    })
  }

  return { lignes: resultats, bilan: compterBilan(resultats), ecritures: ecrituresDe(resultats) }
}

/**
 * Les quatre seaux du bilan, et leur détail.
 *
 * ⚠ LES QUATRE SEAUX COUVRENT 100 % DES LIGNES, et `total` le vérifie. Un bilan
 *   dont les parts ne font pas le tout laisse croire qu'on a tout vu alors qu'une
 *   catégorie a été oubliée en silence.
 */
export function compterBilan(resultats = []) {
  const parStatut = Object.fromEntries(Object.values(STATUTS).map((s) => [s, 0]))
  for (const r of resultats) parStatut[r.statut] += 1

  const ignores = parStatut[STATUTS.NUMERO_IGNORE]
    + parStatut[STATUTS.INTROUVABLE]
    + parStatut[STATUTS.ZERO_AMBIGU]
    + parStatut[STATUTS.CODE_REPETE]
    + parStatut[STATUTS.PLUSIEURS_CLIENTS]

  // Les restitutions de zéro ne sont pas un seau : ce sont des lignes qui
  // s'écrivent, mais que la boutique doit avoir VUES avant d'écrire.
  const aEcrire = resultats.filter((r) => r.statut === STATUTS.A_COMPLETER)

  return {
    total: resultats.length,
    misAJour: parStatut[STATUTS.A_COMPLETER],
    inchanges: parStatut[STATUTS.INCHANGE],
    conflits: parStatut[STATUTS.CONFLIT],
    ignores,
    detailIgnores: {
      numeroIgnore: parStatut[STATUTS.NUMERO_IGNORE],
      introuvable: parStatut[STATUTS.INTROUVABLE],
      zeroAmbigu: parStatut[STATUTS.ZERO_AMBIGU],
      codeRepete: parStatut[STATUTS.CODE_REPETE],
      plusieursClients: parStatut[STATUTS.PLUSIEURS_CLIENTS],
    },
    zerosRestitues: {
      codes: aEcrire.filter((r) => (r.zerosCode ?? 0) > 0).length,
      numeros: aEcrire.filter((r) => (r.zerosRestitues ?? 0) > 0).length,
    },
  }
}

/**
 * Les écritures à faire, et l'état d'AVANT de chacune.
 *
 * ⚠ ON ÉCRIT LES DEUX CHAMPS, PAS SEULEMENT LE NUMÉRO. C'est le point le plus
 *   dangereux de tout cet import, et il ne se voit pas.
 *
 *   `champsAgent` décide qu'une fiche est « déjà rangée » par la PRÉSENCE des
 *   clés `codeAgent`/`numeroAgent`, pas par leur valeur. Une fiche d'avant la
 *   séparation n'a aucune des deux : son identifiant est lu depuis `orange`.
 *   Écrire `numeroAgent` tout seul y ferait apparaître une clé — et dès lors
 *   l'application cesserait de lire `orange`, donc LE CODE AGENT DISPARAÎTRAIT
 *   DE L'ÉCRAN. Sur 15 000 fiches, un import censé ajouter une information en
 *   aurait effacé une autre, sans erreur et sans compteur.
 *
 *   On écrit donc le code tel que `champsAgent` le lit AUJOURD'HUI, en même temps
 *   que le numéro. La fiche se retrouve rangée pour de bon, ce que
 *   `agentFields.js` annonce déjà comme l'effet de « la première modification ».
 *   `orange` n'est pas touché : rien n'est effacé, et l'annulation reste possible.
 *
 * ⚠ LE CODE ÉCRIT VIENT DE LA FICHE, JAMAIS DU FICHIER. Même quand un zéro a été
 *   restitué pour retrouver la fiche, c'est `champsAgent(fiche).codeAgent` qui
 *   est écrit — la base est la référence. Recopier le code du fichier ferait
 *   entrer dans la fiche la version tronquée par le tableur.
 *
 * ⚠ `avant` NOTE LA PRÉSENCE DES CLÉS, pas seulement leur valeur. Annuler en
 *   remettant `codeAgent: ''` au lieu de SUPPRIMER la clé laisserait la fiche en
 *   mode « rangée puis vidée exprès » : son `orange` ne serait plus lu, et
 *   l'annulation aurait causé le dégât qu'elle venait réparer.
 */
export function ecrituresDe(resultats = []) {
  return resultats
    .filter((r) => ECRIT.has(r.statut) && r.fiche)
    .map((r) => ({
      id: r.fiche.id,
      storeId: r.fiche.registeredStoreId ?? null,
      nom: r.nom,
      maj: {
        codeAgent: champsAgent(r.fiche).codeAgent,
        numeroAgent: r.propose,
      },
      avant: {
        codeAgentPresent: Object.prototype.hasOwnProperty.call(r.fiche, 'codeAgent'),
        numeroAgentPresent: Object.prototype.hasOwnProperty.call(r.fiche, 'numeroAgent'),
        codeAgent: r.fiche.codeAgent ?? null,
        numeroAgent: r.fiche.numeroAgent ?? null,
      },
    }))
}
