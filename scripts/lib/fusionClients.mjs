/**
 * fusionClients.mjs — décider qui survit, ce qui se reporte, ce qui se supprime.
 *
 * PUR : aucune I/O, aucun Firebase. Le script `scripts/fusionnerClients.mjs`
 * apporte les données et exécute ; ce module ne fait que trancher. C'est la même
 * séparation que pour `assertResetProject`, et pour la même raison : une
 * décision qui supprime des fiches en production doit pouvoir être éprouvée
 * sans base, cas par cas.
 *
 * LA RÈGLE, ET SEULEMENT ELLE
 * ───────────────────────────
 * Deux fiches se fusionnent si elles partagent leur IDENTIFIANT AGENT — le code
 * d'abord, le numéro seulement à défaut. Ni le nom, ni le téléphone : l'audit du
 * 2026-10-11 a montré que douze fiches « CISSE ADAMA » sur un même téléphone
 * sont douze commerces, chacun avec son code. Le regroupement est fait en amont
 * par la règle `agent` de `doublonsClients.mjs` ; ce module reçoit les grappes.
 *
 * TROIS LOTS, PARCE QUE TROIS SITUATIONS
 * ──────────────────────────────────────
 *   A. Noms identiques, et les perdantes ne portent AUCUNE opération.
 *      On supprime, rien à déplacer. 113 grappes sur la base réelle.
 *
 *   B. Même identifiant, mais il faut déplacer ou compléter quelque chose :
 *      soit des opérations sont attachées à une perdante (repointage), soit le
 *      nom est écrit différemment selon les fiches (report du nom le plus
 *      complet). Vu en production : « ILBOUDO T.ALAYE », « ILBOUDO TONGONOMA
 *      ALAYE », « ILBOUDO T ALAYE » — un nom, trois orthographes, 18 opérations.
 *
 *   C. Les noms ne partagent AUCUN mot, mais deux fiches de la grappe portent un
 *      nom STRICTEMENT identique : ce doublon-là se fusionne, l'intruse reste.
 *
 *   D. Les noms ne partagent AUCUN mot, et la boutique tranche quand même.
 *      ⚠ CE LOT N'EST PAS UNE RÈGLE, C'EST UNE DÉCISION. Le 2026-10-12, après
 *        l'arbitrage des 175 grappes restantes, la boutique a demandé de les
 *        réduire à une fiche chacune : « fusionne comme tu veux, prends un des
 *        deux noms ». L'arbitrage avait montré pourquoi c'est tenable — 0
 *        succession sur 175, des écarts d'orthographe (KOANDA / KAONDA), et
 *        174 grappes sur 175 à cheval sur plusieurs boutiques, ce qui désigne
 *        le garde-fou manquant à la saisie et non un changement de titulaire.
 *        Le code l'applique ; il ne le déduit pas.
 */

import { surplusDeNoms, motsDe, nomComplet, remplissage } from './doublonsClients.mjs'

/**
 * Les champs qu'on complète sur la survivante depuis une perdante.
 *
 * ⚠ JAMAIS D'ÉCRASEMENT : on ne remplit que ce qui est VIDE chez la survivante.
 *   Sans cette limite, fusionner pourrait remplacer un téléphone à jour par
 *   celui d'une fiche abandonnée — une « fusion » qui dégrade la donnée qu'elle
 *   prétend consolider.
 *
 *   Les champs d'identité agent n'y sont pas : ils sont identiques dans toute la
 *   grappe par construction, c'est ce qui l'a formée.
 */
export const CHAMPS_COMPLETABLES = Object.freeze(['numeroPersonnel'])

const vide = (valeur) => String(valeur ?? '').trim() === ''

/**
 * La fiche au nom le plus complet de la grappe.
 *
 * ⚠ C'EST CE CHOIX QUI PRÉSERVE LES ANNOTATIONS. La boutique écrit des consignes
 *   dans le nom : « SOUBEIGA INOUSSA INTERDIT », « … PAS DE DEPOT », « … PAS DE
 *   CREDIT ». Le nom le plus complet est celui qui les porte. Garder le nom le
 *   plus court lèverait l'interdiction en silence — c'est le seul endroit de
 *   toute la fusion où une information peut disparaître sans qu'aucun compteur
 *   ne le signale.
 *
 * Le plus de mots d'abord, puis la chaîne la plus longue, puis l'id : il faut un
 * ordre TOTAL, sinon deux exécutions sur les mêmes données ne choisissent pas la
 * même fiche et le dry-run ne décrit plus ce que `--execute` va faire.
 */
export function choisirNomLePlusComplet(membres = []) {
  return [...membres].sort((a, b) => {
    const parMots = motsDe(b).size - motsDe(a).size
    if (parMots !== 0) return parMots

    const longueur = `${b.nom ?? ''}${b.prenom ?? ''}`.trim().length
      - `${a.nom ?? ''}${a.prenom ?? ''}`.trim().length
    if (longueur !== 0) return longueur

    return String(a.id).localeCompare(String(b.id))
  })[0]
}

/**
 * Le nom de `candidate` en dit-il STRICTEMENT plus que celui de `tenante` ?
 *
 * Plus de mots, ou — à nombre de mots égal — une écriture plus développée.
 * Deux orthographes de même composition et de même longueur ne se départagent
 * pas : la réponse est alors `false`, et c'est le nom en place qui reste.
 */
export function enDitPlus(candidate, tenante) {
  const mots = motsDe(candidate).size - motsDe(tenante).size
  if (mots !== 0) return mots > 0
  return nomComplet(candidate).length > nomComplet(tenante).length
}

/**
 * Le plan d'une grappe : qui reste, qui part, ce qui se recopie avant.
 *
 * `null` pour une grappe du lot C — elle n'a pas de plan, c'est le but.
 *
 * ⚠ LA SURVIVANTE EST LA PLUS RÉFÉRENCÉE, PAS LA PLUS COMPLÈTE. Garder la fiche
 *   la plus riche obligerait à repointer davantage d'opérations, et chaque
 *   repointage est une écriture de plus qui peut échouer. Une fiche riche mais
 *   orpheline se recopie ; une opération rattachée au vide ne se retrouve pas.
 *   Le nom, lui, se reporte — donc rien n'est perdu à garder la plus utilisée.
 */
/**
 * L'ordre de survie : la plus référencée, puis la plus remplie, puis l'id.
 *
 * L'id ne départage rien de métier — il est là pour que l'ordre soit TOTAL, donc
 * reproductible : sans lui, deux exécutions sur les mêmes données pourraient
 * désigner deux survivantes différentes, et le dry-run cesserait de décrire ce
 * que `--execute` va faire.
 */
function classerParSurvie(membres, references) {
  const refDe = (membre) => references.get(membre.id) || 0
  return [...membres].sort((a, b) => refDe(b) - refDe(a)
    || remplissage(b) - remplissage(a)
    || String(a.id).localeCompare(String(b.id)))
}

/** Ce qu'on recopie des perdantes vers la survivante — uniquement dans du vide. */
function completerDepuis(survivante, perdantes) {
  const champsACompleter = {}
  for (const champ of CHAMPS_COMPLETABLES) {
    if (!vide(survivante[champ])) continue
    const source = perdantes.find((p) => !vide(p[champ]))
    if (source) champsACompleter[champ] = String(source[champ]).trim()
  }
  return champsACompleter
}

export function planifierGrappe(grappe, references = new Map()) {
  const { homogene, commun, surplus } = surplusDeNoms(grappe)
  if (!homogene && commun.length === 0) return null

  const refDe = (membre) => references.get(membre.id) || 0
  const classees = classerParSurvie(grappe.membres, references)

  const survivante = classees[0]
  const perdantes = classees.slice(1)

  // ⚠ ON NE REPORTE QUE CE QUI EN DIT STRICTEMENT PLUS.
  //
  //   `choisirNomLePlusComplet` doit rendre UNE fiche, donc elle départage les
  //   ex æquo par identifiant — un ordre technique, sans aucun sens métier. Si
  //   on reportait sur cette base, la fusion réécrirait « OUEDRAOGO BOUKARY » en
  //   « OUEDRAOGO BOUKARE » (même nombre de mots, même longueur) au seul motif
  //   qu'un identifiant Firestore vient avant l'autre. Vu en production : sur
  //   les 76 noms reportés du 2026-10-11, une partie l'a été ainsi.
  //
  //   À équivalence, garder le nom de la survivante est meilleur sur les trois
  //   plans : une écriture de moins, un journal qui ne raconte pas un changement
  //   qui n'en est pas un, et le libellé conservé est celui de la fiche que la
  //   boutique utilise réellement — pas celui d'une fiche abandonnée.
  const porteNom = choisirNomLePlusComplet(grappe.membres)
  const nomAReporter = enDitPlus(porteNom, survivante)
    ? { nom: porteNom.nom ?? '', prenom: porteNom.prenom ?? '', depuis: porteNom.id }
    : null

  const champsACompleter = completerDepuis(survivante, perdantes)
  const aRepointer = perdantes.filter((p) => refDe(p) > 0)

  return {
    cle: grappe.cle,
    survivante,
    perdantes,
    nomAReporter,
    nomsAbandonnes: [],
    surplusDeNom: surplus,
    champsACompleter,
    perdantesReferencees: aRepointer.map((p) => p.id),
    lot: homogene && aRepointer.length === 0 ? 'A' : 'B',
  }
}

/**
 * LE LOT D : réduire à une fiche une grappe dont les noms n'ont rien en commun.
 *
 * Même squelette que `planifierGrappe`, deux différences qui comptent.
 *
 * ⚠ 1. AUCUN REPORT DE NOM, JAMAIS. Ailleurs, reporter « le nom le plus
 *      complet » enrichit la survivante : « ILBOUDO T.ALAYE » devient « ILBOUDO
 *      TONGONOMA ALAYE », c'est le même nom mieux écrit, et c'est ainsi que les
 *      annotations (« INTERDIT », « PAS DE DEPOT ») remontent sur la fiche qui
 *      reste. Ici les noms sont ÉTRANGERS l'un à l'autre : « le plus complet »
 *      n'y désigne plus rien — seulement celui qui compte le plus de mots. Le
 *      reporter écraserait le nom d'un commerce par celui d'un autre, et c'est
 *      le cas où ça se verrait le plus : la grappe vue en production oppose
 *      « MME SAWADOGO » à « BANQUE RETRAIT DEPOT », un libellé technique qui
 *      gagnerait sur un vrai nom au seul motif qu'il a trois mots.
 *
 *      La survivante garde donc SON nom. C'est bien « un des deux noms », et
 *      c'est le seul des deux qui soit défendable : la survivante est la fiche
 *      la plus référencée, donc son nom est celui attaché aux opérations réelles
 *      et celui que la boutique lit à l'écran tous les jours.
 *
 * ⚠ 2. LES NOMS PERDUS SONT NOMMÉS. C'est le seul lot où une information
 *      disparaît vraiment — ailleurs le nom abandonné était une variante de
 *      celui qui reste. `nomsAbandonnes` les porte jusqu'au journal d'audit et
 *      au dry-run, pour que « on a pris un des deux noms » reste une phrase
 *      vérifiable et non une formule.
 */
export function planifierSansRapport(grappe, references = new Map()) {
  if (grappe.membres.length < 2) return null

  const refDe = (membre) => references.get(membre.id) || 0
  const classees = classerParSurvie(grappe.membres, references)
  const survivante = classees[0]
  const perdantes = classees.slice(1)
  const aRepointer = perdantes.filter((p) => refDe(p) > 0)

  return {
    cle: grappe.cle,
    survivante,
    perdantes,
    nomAReporter: null,
    nomsAbandonnes: perdantes
      .map((p) => `${p.nom ?? ''} ${p.prenom ?? ''}`.trim())
      .filter((nom, i) => nom && nomComplet(perdantes[i]) !== nomComplet(survivante)),
    surplusDeNom: surplusDeNoms(grappe).surplus,
    champsACompleter: completerDepuis(survivante, perdantes),
    perdantesReferencees: aRepointer.map((p) => p.id),
    lot: 'D',
  }
}

/**
 * ⚠ LE DOUBLON FRANC NOYÉ DANS UNE GRAPPE À INTRUS.
 *
 *   `planifierGrappe` écarte une grappe dès que ses membres n'ont AUCUN mot en
 *   commun — l'intersection porte sur la grappe ENTIÈRE, donc une seule fiche
 *   étrangère la vide. Vu en production le 2026-10-11, dans les écartées :
 *
 *     SEOGO SYPRIEN · TAPSOBA SERGE · SEOGO SYPRIEN
 *     SANFO SIDIKI · SANFO SIDIKI · NAGRAOGO YOUSSIF
 *     SAWADOGO  HAMIDOU · BELEM WENDKUNI · SAWADOGO HAMIDOU
 *
 *   Chacune contient deux fiches au nom identique, jetées avec l'intruse. Les
 *   grouper rend ces doublons-là à la fusion, et laisse l'intruse intacte.
 *
 * ⚠ ICI, LE NOM DOIT ÊTRE STRICTEMENT IDENTIQUE — pas « un noyau commun »
 *   comme pour le lot B. Ces grappes ont déjà échoué au test global : les
 *   rouvrir avec un critère large y réunirait « OUEDRAOGO ALI » et « OUEDRAOGO
 *   MOUSSA », qui partagent un patronyme et rien d'autre. Deux fiches de même
 *   code agent ET de même nom exact sont aussi sûres que celles du lot A ; en
 *   deçà, on ne touche pas.
 *
 *   Le prix de cette prudence : une variante d'orthographe à l'intérieur d'une
 *   grappe à intrus reste écartée. C'est voulu.
 */
export function scinderParNomExact(grappe) {
  const parNom = new Map()

  for (const membre of grappe.membres) {
    const cle = nomComplet(membre)
    if (!cle) continue
    if (!parNom.has(cle)) parNom.set(cle, [])
    parNom.get(cle).push(membre)
  }

  return [...parNom.entries()]
    .filter(([, membres]) => membres.length >= 2)
    .map(([nom, membres]) => ({ cle: `${grappe.cle}|${nom}`, membres }))
}

/**
 * Les plans de toutes les grappes, rangés par lot.
 *
 * `ecartees` porte sa raison : un plan de fusion doit rendre compte de ce qu'il
 * NE fait pas, sinon la boutique ne sait pas ce qui reste à décider.
 *
 * ⚠ `fusionnerSansRapport` REMPLACE LE LOT C, il ne s'y ajoute pas. Le lot D
 *   réduit la grappe entière à une fiche ; le lot C n'en fusionnait que les
 *   doublons de nom exact. Produire les deux ferait planifier deux fois les
 *   mêmes suppressions, et la seconde transaction échouerait sur des fiches
 *   déjà parties. Quand D est demandé, `lotC` est donc vide — et le script le
 *   dit au lieu de l'accepter en silence.
 */
export function planifierFusion(grappes = [], references = new Map(), { fusionnerSansRapport = false } = {}) {
  const lotA = []
  const lotB = []
  const lotC = []
  const lotD = []
  const ecartees = []

  for (const grappe of grappes) {
    const plan = planifierGrappe(grappe, references)
    if (plan) {
      ;(plan.lot === 'A' ? lotA : lotB).push(plan)
      continue
    }

    if (fusionnerSansRapport) {
      const planD = planifierSansRapport(grappe, references)
      if (planD) lotD.push(planD)
      else ecartees.push({ cle: grappe.cle, raison: 'seule de sa grappe', membres: grappe.membres })
      continue
    }

    // Pas de noyau commun à toute la grappe : il peut rester des doublons
    // francs à l'intérieur. Une seule passe suffit — une sous-grappe de noms
    // identiques a forcément un noyau commun, donc elle ne revient jamais ici.
    const sousGrappes = scinderParNomExact(grappe)
    const plansSous = sousGrappes
      .map((sous) => planifierGrappe(sous, references))
      .filter(Boolean)
      .map((sous) => ({ ...sous, lot: 'C' }))

    lotC.push(...plansSous)

    const traitees = new Set(plansSous.flatMap((p) => [p.survivante.id, ...p.perdantes.map((m) => m.id)]))
    const intactes = grappe.membres.filter((m) => !traitees.has(m.id))
    if (intactes.length > 0) {
      ecartees.push({
        cle: grappe.cle,
        raison: plansSous.length > 0 ? 'intruses d\'une grappe scindée' : 'noms sans rapport',
        membres: intactes,
      })
    }
  }

  const tous = [...lotA, ...lotB, ...lotC, ...lotD]

  return {
    lotA,
    lotB,
    lotC,
    lotD,
    ecartees,
    fichesSupprimees: tous.reduce((n, p) => n + p.perdantes.length, 0),
    operationsRepointees: tous.reduce((n, p) => n + p.perdantesReferencees.length, 0),
    nomsReportes: tous.filter((p) => p.nomAReporter).length,
    nomsAbandonnes: tous.reduce((n, p) => n + p.nomsAbandonnes.length, 0),
  }
}

/**
 * ⚠ LA PORTE DE VÉRIFICATION DE LA SAUVEGARDE — rien ne s'écrit avant elle.
 *
 *   Une sauvegarde qu'on n'a pas relue n'est pas une sauvegarde, c'est un
 *   fichier. Cette fonction compare ce que le plan va détruire à ce que le
 *   fichier contient RÉELLEMENT, après relecture depuis le disque. Elle rend la
 *   liste des manques ; une seule suffit à tout abandonner.
 *
 *   Elle vérifie les fiches ET les opérations : repointer une opération modifie
 *   son `clientId`, donc son état d'avant doit être récupérable lui aussi.
 */
export function verifierSauvegarde({ plan, fichesSauvees = [], operationsSauvees = [] }) {
  const manques = []
  const fiches = new Map(fichesSauvees.map((f) => [f.id, f]))
  const operations = new Set(operationsSauvees.map((o) => o.chemin))

  for (const p of [...plan.lotA, ...plan.lotB]) {
    for (const membre of [p.survivante, ...p.perdantes]) {
      const sauvee = fiches.get(membre.id)
      if (!sauvee) {
        manques.push(`fiche absente de la sauvegarde : ${membre.id}`)
        continue
      }
      // Le nom est l'information qu'un report peut écraser : s'il n'est pas
      // dans la sauvegarde, la fusion n'est pas annulable.
      if (String(sauvee.nom ?? '') !== String(membre.nom ?? '')) {
        manques.push(`fiche ${membre.id} : nom sauvegardé différent de celui lu`)
      }
    }
  }

  for (const p of plan.lotB) {
    for (const id of p.perdantesReferencees) {
      const attendues = operationsSauvees.filter((o) => o.clientId === id)
      if (attendues.length === 0) {
        manques.push(`aucune opération sauvegardée pour la perdante référencée ${id}`)
      }
      for (const operation of attendues) {
        if (!operations.has(operation.chemin)) {
          manques.push(`opération sans chemin : ${operation.chemin}`)
        }
      }
    }
  }

  return manques
}
