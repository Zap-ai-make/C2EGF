import { isDepositType, isWithdrawalType } from './financialImpact'

/**
 * L'argent dehors — ce que les boutiques ont engagé sans l'avoir encaissé.
 *
 * DE QUOI ON PARLE
 * ────────────────
 * Une transaction « non terminée » est une opération dont UNE SEULE jambe est
 * passée. Au comptoir :
 *
 *   • Dépôt non terminé — la boutique a envoyé l'e-float au client, mais n'a
 *     pas encore encaissé son argent. Son stock a baissé ; sa liquidité n'a pas
 *     monté. Le client lui DOIT ce montant.
 *   • Retrait non terminé — le client a envoyé son e-float à la boutique, mais
 *     n'est pas repassé chercher son argent. Le stock a monté ; la liquidité
 *     n'a pas baissé. La boutique lui DOIT ce montant.
 *
 * D'où `dehors = dépôts − retraits` : le solde net de ce qui est dû à la
 * boutique, une fois retiré ce qu'elle doit.
 *
 * ⚠ CE N'EST PAS UNE LIGNE D'APPOINT, C'EST LE TERME QUI MANQUAIT.
 *   La somme des caisses (stock + liquidité) est, de ce fait, FAUSSE des deux
 *   côtés : trop basse de ce qui reste à encaisser, trop haute de ce qui reste
 *   à payer. Ajouter `dehors` ne décore pas le total — il le rend exact, et
 *   c'est pourquoi `positionDealer.js` l'intègre au rapprochement au lieu de
 *   l'afficher à côté.
 *
 * ⚠ LE MONTANT RETENU EST LE RESTE DÛ, PAS LE MONTANT D'ORIGINE.
 *   Une non terminée peut être partiellement réglée : `addTransactionPayment`
 *   écrit alors `remainingAmount` sur le document lui-même. Sommer `montant`
 *   compterait une deuxième fois ce qui a déjà été payé. Le détail des tranches
 *   vit dans une sous-collection `settlements` qui reste, elle, fermée au
 *   dealer — et qui n'est pas nécessaire, puisque le reste dû est sur le
 *   document.
 *
 * PUR — aucune I/O. C'est ce fichier qui décide de chiffres portés au
 * rapprochement ; il se teste seul (tc-209).
 */

/** Vrai pour un entier fini — négatif compris, qu'on ne masque jamais. */
const estNombre = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * Le montant qu'une non terminée laisse réellement dehors.
 *
 * `remainingAmount` fait autorité dès qu'il est lisible : il est écrit par la
 * Cloud Function de règlement et vaut 0 sur une transaction soldée. On ne
 * retombe sur `montant` que s'il est absent — le cas des transactions qui n'ont
 * jamais connu de règlement partiel, c'est-à-dire la plupart.
 *
 * @returns {number|null} `null` si aucun montant n'est lisible.
 */
export function montantRestant(brouillon) {
  if (estNombre(brouillon?.remainingAmount)) return brouillon.remainingAmount
  if (estNombre(brouillon?.montant)) return brouillon.montant
  return null
}

const vide = (storeId, name) => ({ storeId, name, depots: 0, retraits: 0, dehors: 0 })

/**
 * Agrège les non terminées du réseau, par boutique et en total.
 *
 * ⚠ LA POPULATION EST CELLE DES CAISSES, ET C'EST STRUCTUREL. `sommeDehors`
 *   part au rapprochement à côté de `sommeStock` et `sommeLiquidite`, qui ne
 *   couvrent que les boutiques ACTIVES (cf. `listNetworkCaisses`). Compter ici
 *   une boutique fermée ajouterait à un total ce qui a été retiré de l'autre :
 *   l'écart bougerait sans qu'un franc n'ait bougé.
 *
 *   Ces documents ne sont pas jetés en silence pour autant — `horsReseau` dit
 *   combien il y en avait. Un compteur muet et un compteur à zéro ne se
 *   ressemblent que sur l'écran de celui qui n'a rien à vérifier.
 *
 * @param {Array<{storeId?:string,type?:string,montant?:number,remainingAmount?:number}>} brouillons
 * @param {Array<{storeId?:string,name?:string}>} boutiques  les caisses actives
 * @returns {{parBoutique:Array, depots:number, retraits:number, dehors:number,
 *            illisibles:number, horsReseau:number}}
 */
export function agregerArgentDehors(brouillons, boutiques = []) {
  const parId = new Map()
  for (const b of boutiques ?? []) {
    if (b?.storeId) parId.set(b.storeId, vide(b.storeId, b.name ?? null))
  }

  let illisibles = 0
  let horsReseau = 0

  for (const brouillon of brouillons ?? []) {
    const ligne = parId.get(brouillon?.storeId)
    if (!ligne) { horsReseau += 1; continue }

    const reste = montantRestant(brouillon)
    if (reste === null) { illisibles += 1; continue }

    // Un type inconnu ne tombe dans aucune des deux colonnes : le compter
    // arbitrairement d'un côté fausserait le solde, et le taire ferait croire
    // le total complet. Il rejoint donc les illisibles, qui disent « ce chiffre
    // n'est pas entier ».
    if (isDepositType(brouillon?.type)) ligne.depots += reste
    else if (isWithdrawalType(brouillon?.type)) ligne.retraits += reste
    else { illisibles += 1; continue }
  }

  const parBoutique = []
  let depots = 0
  let retraits = 0
  for (const ligne of parId.values()) {
    ligne.dehors = ligne.depots - ligne.retraits
    depots += ligne.depots
    retraits += ligne.retraits
    // Une boutique sans aucune non terminée n'a rien à dire dans la liste. Une
    // boutique dont les deux colonnes s'annulent en a, elle, quelque chose : son
    // solde est nul mais son argent circule.
    if (ligne.depots > 0 || ligne.retraits > 0) parBoutique.push(ligne)
  }

  // Du plus exposé au moins exposé — c'est l'ordre dans lequel on lit une liste
  // qu'on ouvre pour savoir « qui ». À égalité, le nom, pour que deux captures
  // du même écran soient comparables.
  parBoutique.sort((a, b) =>
    b.dehors - a.dehors || String(a.name ?? '').localeCompare(String(b.name ?? '')))

  return {
    parBoutique,
    depots,
    retraits,
    // Peut être NÉGATIF — plus de retraits en attente que de dépôts — et on ne
    // le borne pas. Même discipline que `dealerInventory.js` : un négatif est
    // un signal honnête, le forcer à zéro fabriquerait une donnée fausse.
    dehors: depots - retraits,
    illisibles,
    horsReseau,
  }
}

export default agregerArgentDehors
