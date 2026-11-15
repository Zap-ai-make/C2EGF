/**
 * rembSiege.js — l'arithmétique du remboursement au siège, côté serveur.
 *
 * Le siège donne du stock à crédit aux agents la nuit ; le lendemain, l'agent
 * rembourse dans une boutique, qui envoie l'argent au siège. Cet argent n'est
 * pas à la boutique, mais il passe par sa caisse : les soldes doivent le suivre
 * à chaque geste (docs/superpowers/specs/2026-11-14-remboursement-siege-design.md).
 *
 * UNE SEULE RÉSERVE À LA FOIS, COMME LE RAVITAILLEMENT
 * ────────────────────────────────────────────────────
 * Recevoir fait entrer l'argent dans la réserve où l'agent l'a mis (stock ou
 * espèce) ; envoyer au siège sort du stock, et de lui seul. Chaque jambe est
 * donc un `applyReplenishmentImpact` ou un `applyReplenishmentReturnImpact`,
 * déjà éprouvés : aucune arithmétique nouvelle, et le moteur des dépôts et
 * retraits n'est pas touché.
 *
 * ⚠ L'ORDRE DES JAMBES COMPTE : LE + D'ABORD. `adjustBalanceValue` refuse tout
 *   delta négatif qui passerait sous zéro. Appliquer le − avant le + refuserait
 *   « Valider, reçu en Stock » à stock nul, alors que la réserve ne bouge pas
 *   (+100 000 puis −100 000). Le + d'abord, seul le net peut refuser.
 *
 * PUR : aucune lecture ni écriture Firestore.
 */

import { applyReplenishmentImpact, applyReplenishmentReturnImpact } from '../settlements/financialUtils.js'

export const TYPE_REMB_SIEGE = 'Remb. siège'

/** Le refus des gestes génériques (Modifier, Annuler, Encaisser…) sur cette ligne. */
export const MESSAGE_GESTE_GENERIQUE = 'Une ligne « Remb. siège » se traite par ses propres boutons.'

/** Au-delà, on garde les dernières tranches : cinquante envois d'un seul remboursement relèvent de l'erreur. */
export const ENVOIS_MAX = 50

const VALIDATED = ['Validée', 'Validee']

export const estRembSiege = (doc) => doc?.type === TYPE_REMB_SIEGE

/**
 * La saisie : l'argent reçu de l'agent entre dans sa réserve. Validée d'un
 * geste, la caissière l'envoie aussitôt au siège : le même montant sort du stock.
 */
export function impactSaisie(balances, network, { statut, balanceType, montant }) {
  const recu = applyReplenishmentImpact(balances, network, balanceType, montant)
  return VALIDATED.includes(statut) ? applyReplenishmentReturnImpact(recu, network, 'stock', montant) : recu
}

/** Une tranche envoyée au siège : toujours depuis le stock (décision de l'utilisateur). */
export function impactEnvoi(balances, network, montant) {
  return applyReplenishmentReturnImpact(balances, network, 'stock', montant)
}

/**
 * « Ce remboursement n'a pas eu lieu » : les tranches envoyées reviennent au
 * stock, puis l'argent reçu ressort de sa réserve. Rien d'envoyé : seule la
 * seconde jambe, un montant nul n'étant pas un mouvement.
 */
export function impactAnnulation(balances, network, { balanceType, montant, envoyeAuSiege }) {
  const envoye = Number(envoyeAuSiege) || 0
  const rendu = envoye > 0 ? applyReplenishmentImpact(balances, network, 'stock', envoye) : balances
  return applyReplenishmentReturnImpact(rendu, network, balanceType, montant)
}

/** Avant toute tranche : le nouveau montant entre, puis l'ancien ressort. */
export function impactModification(balances, network, avant, apres) {
  const ajoute = applyReplenishmentImpact(balances, network, apres.balanceType, apres.montant)
  return applyReplenishmentReturnImpact(ajoute, network, avant.balanceType, avant.montant)
}
