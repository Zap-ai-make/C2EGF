/**
 * transfertArgent.js — l'arithmétique des transferts d'argent, côté serveur.
 *
 * Certaines boutiques font aussi Western Union, Ria, MoneyGram ou un autre
 * service : l'argent de ces clients ordinaires passe par leur caisse, et les
 * soldes doivent le suivre à chaque geste
 * (docs/superpowers/specs/2026-11-23-transferts-argent-design.md).
 *
 *   Transfert : le client confie l'argent (+ réserve cochée), la boutique
 *               l'envoie au siège par tranches (− stock).
 *   Retrait   : la boutique paie le client (− réserve cochée), le siège la
 *               rembourse par tranches (+ stock).
 *
 * UNE SEULE RÉSERVE À LA FOIS, COMME LE REMBOURSEMENT AU SIÈGE
 * ────────────────────────────────────────────────────────────
 * Chaque jambe est un `applyReplenishmentImpact` (+) ou un
 * `applyReplenishmentReturnImpact` (−), déjà éprouvés ; le moteur des dépôts et
 * retraits n'est pas touché.
 *
 * ⚠ LE + D'ABORD. `adjustBalanceValue` refuse tout delta négatif qui passerait
 *   sous zéro : seul le net doit pouvoir refuser (voir rembSiege.js).
 *
 * PUR : aucune lecture ni écriture Firestore.
 */

import { applyReplenishmentImpact, applyReplenishmentReturnImpact } from '../settlements/financialUtils.js'

export const TYPE_TRANSFERT_ARGENT = 'Transfert argent'
export const SERVICES_TRANSFERT = Object.freeze(['Western Union', 'Ria', 'MoneyGram', 'Autres'])
export const OPERATIONS_TRANSFERT = Object.freeze(['transfert', 'retrait'])

/** Le refus des gestes génériques (Modifier, Annuler, Encaisser…) sur cette ligne. */
export const MESSAGE_GESTE_TRANSFERT = 'Une ligne de transfert se traite par ses propres boutons.'

/** Au-delà, on garde les dernières tranches, comme les envois au siège. */
export const TRANCHES_MAX = 50

export const estTransfertArgent = (doc) => doc?.type === TYPE_TRANSFERT_ARGENT

const entre = (balances, network, reserve, montant) => applyReplenishmentImpact(balances, network, reserve, montant)
const sort = (balances, network, reserve, montant) => applyReplenishmentReturnImpact(balances, network, reserve, montant)

/** La saisie : l'argent du client entre (transfert) ou sort (retrait) de sa réserve. */
export function impactSaisieTransfert(balances, network, { operation, balanceType, montant }) {
  return operation === 'retrait'
    ? sort(balances, network, balanceType, montant)
    : entre(balances, network, balanceType, montant)
}

/** Une tranche : envoyée au siège (− stock) ou encaissée du siège (+ stock). */
export function impactTrancheTransfert(balances, network, { operation }, montant) {
  return operation === 'retrait'
    ? entre(balances, network, 'stock', montant)
    : sort(balances, network, 'stock', montant)
}

/**
 * Avant toute tranche : l'ancienne saisie est défaite, la nouvelle appliquée.
 * L'opération ne change pas (le serveur la refuse dans les modifications).
 */
export function impactModificationTransfert(balances, network, avant, apres) {
  if (avant.operation === 'retrait') {
    return sort(entre(balances, network, avant.balanceType, avant.montant), network, apres.balanceType, apres.montant)
  }
  return sort(entre(balances, network, apres.balanceType, apres.montant), network, avant.balanceType, avant.montant)
}

/**
 * « Cette opération n'a pas eu lieu » : toutes les jambes sont défaites. Un
 * montant traité nul n'est pas un mouvement.
 */
export function impactAnnulationTransfert(balances, network, { operation, balanceType, montant, montantTraite }) {
  const traite = Number(montantTraite) || 0
  if (operation === 'retrait') {
    const rendu = entre(balances, network, balanceType, montant)
    return traite > 0 ? sort(rendu, network, 'stock', traite) : rendu
  }
  const revenu = traite > 0 ? entre(balances, network, 'stock', traite) : balances
  return sort(revenu, network, balanceType, montant)
}
