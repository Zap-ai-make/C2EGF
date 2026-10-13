/**
 * importChampsAgent.mjs — compléter un champ des fiches clients existantes.
 *
 * PUR : aucune I/O, aucun Firebase, aucun tableur. `executerImportAgent.mjs`
 * apporte les lignes du fichier et les fiches de la base ; ce module ne fait que
 * décider, ligne par ligne. Même séparation que `fusionClients.mjs`, et pour la
 * même raison : une décision qui écrit en production doit pouvoir être éprouvée
 * cas par cas sans base ni fichier.
 *
 * DEUX CHAMPS IMPORTABLES, UNE SEULE MÉCANIQUE
 * ────────────────────────────────────────────
 * Ce module ne connaît ni les numéros ni les noms de commerciaux : il reçoit une
 * DESCRIPTION de champ (`champsImportables.mjs`) et applique la même mécanique —
 * retrouver la fiche par son code, détecter les répétitions, refuser d'écraser.
 * Ce qui diffère entre « Numéro agent » et « Agent commercial » est écrit là-bas,
 * et seulement là-bas.
 *
 * TROIS CHAMPS DISTINCTS, ET ILS NE SE CONFONDENT JAMAIS
 * ──────────────────────────────────────────────────────
 *   · Code agent       — 7 chiffres en général. Sert à RETROUVER la fiche.
 *   · Numéro agent     — 8 chiffres.
 *   · Numéro personnel — le téléphone du commerçant. JAMAIS touché, jamais lu
 *                        comme un numéro agent. C'est une colonne piège : un
 *                        fichier qui la contient ne doit pas la voir prise pour
 *                        l'autre, d'où le refus explicite dans `trouverColonnes`.
 *
 * ⚠ CE MODULE NE FAIT JAMAIS
 *   · créer une fiche — un code inconnu est signalé, pas inséré ;
 *   · rapprocher par le nom — seul le code agent identifie, à l'exact ;
 *   · écraser une valeur — une case déjà remplie autrement est un CONFLIT ;
 *   · effacer quoi que ce soit, `orange` et `numeroPersonnel` compris.
 */

import { plier } from './doublonsClients.mjs'
import { champsAgent } from '../../src/utils/agentFields.js'
import { CHAMP_NUMERO, COLONNE_CODE } from './champsImportables.mjs'

export {
  COLONNE_CODE,
  COLONNE_NUMERO,
  COLONNE_INTERDITE,
  COLONNE_COMMERCIAL,
  LONGUEUR_NUMERO,
  CHAMP_NUMERO,
  CHAMP_COMMERCIAL,
  CHAMPS,
  champParCle,
  normaliserNumeroAgent,
  normaliserAgentCommercial,
  indexerCommerciaux,
  alignerSurLaBase,
} from './champsImportables.mjs'

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

/**
 * Les fiches de la base rangées par code agent.
 *
 * ⚠ LE CODE EST LU PAR `champsAgent`, LA FONCTION DE L'ÉCRAN. Une fiche d'avant
 *   la séparation porte son identifiant dans `orange` ; `champsAgent` la range à
 *   la lecture, par la longueur. Réécrire cette règle ici ferait deux vérités, et
 *   l'import chercherait dans une base que la boutique ne voit pas.
 *
 *   Conséquence voulue : une fiche dont `orange` fait 8 chiffres est rangée comme
 *   un NUMÉRO agent, pas un code. Elle n'est donc pas trouvable par code.
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
 * L'en-tête d'une colonne, réduit à ses MOTS — pour que la même intention écrite
 * de six façons différentes soit reconnue une fois.
 *
 * ⚠ CE QU'ON TOLÈRE EST GRATUIT ; CE QU'ON REFUSE EST ESSENTIEL. La raison d'être
 *   de la stricte comparaison, c'est d'empêcher qu'un « Numéro personnel » soit
 *   pris pour un « Numéro agent » : deux champs distincts, tous deux à huit
 *   chiffres, donc une confusion qu'aucun contrôle de longueur ne rattraperait.
 *
 *   Or le style du séparateur n'a RIEN à voir avec ce risque. « numeroAgent »,
 *   « numero_agent » et « Numéro agent » désignent sans ambiguïté la même chose,
 *   et les refuser ne protégeait de rien — ça obligeait seulement celui qui
 *   fabrique le fichier à deviner une convention. Vu le 2026-10-12 : un fichier
 *   produit avec les NOMS DE CHAMPS du code (`codeAgent`, `numeroAgent`) au lieu
 *   des intitulés de l'écran était rejeté, alors qu'il était parfaitement juste.
 *
 *   On normalise donc camelCase, tiret bas, tiret, point, et on retire une
 *   annotation entre parenthèses (« Code agent (7 chiffres) »). Après ça, la
 *   comparaison reste EXACTE — jamais par inclusion, qui ferait passer
 *   « Ancien numéro agent » pour « Numéro agent ».
 */
export const normaliserEntete = (valeur) => plier(
  String(valeur ?? '')
    .replace(/\([^)]*\)/g, ' ')
    // Le découpage du camelCase se fait AVANT le passage en minuscules, sinon il
    // n'y a plus de majuscule sur laquelle couper.
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' '),
)

/**
 * Les deux colonnes attendues, trouvées dans les en-têtes réels du fichier.
 *
 * Le rapprochement se fait sur l'en-tête normalisé (voir `normaliserEntete`).
 *
 * ⚠ « NUMÉRO PERSONNEL » N'EST JAMAIS « NUMÉRO AGENT ». Ce sont les deux colonnes
 *   les plus faciles à confondre, et les confondre écrirait le téléphone du
 *   commerçant dans sa case numéro agent — sur des milliers de fiches, sans
 *   qu'aucune règle de longueur ne s'en plaigne. C'est cette distinction-là que
 *   la comparaison exacte protège, et elle survit à toute normalisation de style.
 *
 * @param {string[]} entetes
 * @param {object}   champ   la description du champ à remplir
 * @returns {{code: string, valeur: string}|{erreur: string}}
 */
export function trouverColonnes(entetes = [], champ = CHAMP_NUMERO) {
  const vus = entetes.map((e) => ({ brut: e, plie: normaliserEntete(e) }))
  const chercher = (attendu) => vus.filter((v) => v.plie === normaliserEntete(attendu))

  for (const [attendu, role] of [[COLONNE_CODE, 'code'], [champ.colonne, 'valeur']]) {
    const trouves = chercher(attendu)
    if (trouves.length === 0) {
      const interdite = champ.colonneInterdite ? chercher(champ.colonneInterdite) : []
      const indice = role === 'valeur' && interdite.length > 0
        ? `\nLe fichier contient « ${interdite[0].brut} » : ce n'est PAS le ${champ.libelle},`
          + " ce sont deux champs distincts et aucun des deux ne remplace l'autre."
        : ''
      return {
        erreur: `Colonne « ${attendu} » absente.\nEn-têtes lus : ${entetes.map((e) => `« ${e} »`).join(', ') || '(aucun)'}${indice}`,
      }
    }
    if (trouves.length > 1) {
      return { erreur: `Colonne « ${attendu} » présente ${trouves.length} fois. Ambiguïté : fichier refusé.` }
    }
  }

  return { code: chercher(COLONNE_CODE)[0].brut, valeur: chercher(champ.colonne)[0].brut }
}

/**
 * Les colonnes de valeur reconnues parmi les en-têtes, pour deviner quel champ un
 * fichier vient remplir.
 *
 * ⚠ DEVINER N'EST PERMIS QUE SI LA RÉPONSE EST UNIQUE. Un fichier qui porte les
 *   deux colonnes ne dit pas lequel des deux champs il vient remplir : c'est à
 *   l'opérateur de trancher avec `--champ=`, pas au script de choisir.
 */
export function champsPresents(entetes = [], champs = []) {
  const plies = new Set(entetes.map(normaliserEntete))
  return champs.filter((champ) => plies.has(normaliserEntete(champ.colonne)))
}

/** Le nom affichable d'une fiche, pour l'aperçu. */
const nomDe = (fiche) => `${fiche?.nom ?? ''} ${fiche?.prenom ?? ''}`.trim() || '(sans nom)'

/**
 * Ce que l'import ferait, ligne par ligne — et rien de plus.
 *
 * @param {Array<{ligne: number, code: string, valeur: string, fichier?: string,
 *                codeNumerique?: boolean, valeurNumerique?: boolean}>} lignes
 * @param {Array<object>} fiches  les fiches de `globalClients`
 * @param {object}        champ   la description du champ à remplir
 */
export function planifierImport(lignes = [], fiches = [], champ = CHAMP_NUMERO) {
  const parCode = indexerParCodeAgent(fiches)
  const longueurs = longueursDeCode(parCode)
  // Ce que la base doit fournir avant de normaliser : rien pour un numéro, les
  // orthographes déjà en place pour un agent commercial.
  const contexte = champ.contexte(fiches)

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
      // `fichier` voyage avec la ligne : quand plusieurs lots sont réunis, « L42 »
      // tout seul ne désigne rien — il y a une ligne 42 dans chaque fichier.
      fichier: brute.fichier ?? '',
      ligne: brute.ligne,
      code,
      nom: '',
      actuel: '',
      propose: '',
      ajuste: false,
      zerosCode: 0,
      codeUtilise: code,
    }

    if (!code) {
      resultats.push({ ...base, statut: STATUTS.NUMERO_IGNORE, detail: 'code agent vide' })
      continue
    }

    const lue = champ.normaliser(brute.valeur, Boolean(brute.valeurNumerique), contexte)
    if (lue.refus) {
      resultats.push({ ...base, statut: STATUTS.NUMERO_IGNORE, detail: lue.detail })
      continue
    }
    base.propose = lue.valeur
    base.ajuste = Boolean(lue.ajuste)
    base.nouveau = Boolean(lue.nouveau)
    base.concurrentes = lue.concurrentes ?? null

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
          + " Si la colonne est en TEXTE, c'est le fichier qui porte un code tronqué ;"
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
    const actuelBrut = champ.lire(fiche)
    base.nom = nomDe(fiche)
    base.actuel = actuelBrut
    base.zerosCode = r.zerosRestitues
    const zeroCode = r.zerosRestitues > 0
      ? `code « ${code} » → « ${r.code} », ${r.zerosRestitues} zéro(s) restitué(s) depuis la base`
      : ''

    if (actuelBrut !== '') {
      if (champ.memeValeur(actuelBrut, lue.valeur)) {
        resultats.push({
          ...base,
          statut: STATUTS.INCHANGE,
          fiche,
          detail: [actuelBrut === lue.valeur ? '' : `déjà présent, écrit « ${actuelBrut} »`, zeroCode]
            .filter(Boolean).join(' · '),
        })
      } else {
        resultats.push({
          ...base,
          statut: STATUTS.CONFLIT,
          fiche,
          detail: [`la fiche porte déjà « ${actuelBrut} », le fichier propose « ${lue.valeur} »`, zeroCode]
            .filter(Boolean).join(' · '),
        })
      }
      continue
    }

    resultats.push({
      ...base,
      statut: STATUTS.A_COMPLETER,
      fiche,
      detail: [zeroCode, lue.note].filter(Boolean).join(' · '),
    })
  }

  return {
    lignes: resultats,
    bilan: compterBilan(resultats),
    ecritures: ecrituresDe(resultats, champ),
  }
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

  // Les ajustements ne sont pas un seau : ce sont des lignes qui s'écrivent, mais
  // que la boutique doit avoir VUES avant d'écrire, parce que le script y a
  // changé quelque chose — un zéro restitué, une orthographe alignée.
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
    ajustements: {
      codes: aEcrire.filter((r) => (r.zerosCode ?? 0) > 0).length,
      valeurs: aEcrire.filter((r) => r.ajuste).length,
    },
  }
}

/**
 * Les écritures à faire, et l'état d'AVANT de chacune.
 *
 * ⚠ `avant` NOTE LA PRÉSENCE DES CLÉS, pas seulement leur valeur. Pour l'import
 *   de numéros, annuler en remettant `codeAgent: ''` au lieu de SUPPRIMER la clé
 *   laisserait la fiche en mode « rangée puis vidée exprès » : son `orange` ne
 *   serait plus lu, et l'annulation aurait causé le dégât qu'elle venait réparer.
 *   La règle vaut pour tout champ : on restitue l'ABSENCE autant que la valeur.
 *
 * ⚠ LA FORME DE `avant` A CHANGÉ LE 2026-10-13 pour accueillir un second champ :
 *   `avant.champs` est maintenant une table clé → { present, valeur }. Les
 *   sauvegardes écrites avant cette date portent `codeAgentPresent` et consorts à
 *   plat ; `executerImportAgent.mjs` sait lire les deux, afin qu'un import déjà
 *   passé en production reste annulable.
 */
export function ecrituresDe(resultats = [], champ = CHAMP_NUMERO) {
  return resultats
    .filter((r) => ECRIT.has(r.statut) && r.fiche)
    .map((r) => {
      const maj = champ.champsAEcrire(r.fiche, r.propose)
      const avant = {}
      for (const cle of Object.keys(maj)) {
        avant[cle] = {
          present: Object.prototype.hasOwnProperty.call(r.fiche, cle),
          valeur: r.fiche[cle] ?? null,
        }
      }
      return {
        id: r.fiche.id,
        storeId: r.fiche.registeredStoreId ?? null,
        nom: r.nom,
        maj,
        avant: { champs: avant },
      }
    })
}
