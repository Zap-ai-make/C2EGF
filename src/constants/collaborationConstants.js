/**
 * Constantes du module collaborations / dettes internes.
 *
 * Les libellés vivent ici, pas dans les composants : les mêmes statuts sont rendus
 * par la file opérationnelle ET par l'historique, et deux orthographes du même
 * état feraient douter l'exploitant de ce qu'il lit.
 */

import { activeProfile } from '../config/activeClientProfile.js'

// ── Activation ───────────────────────────────────────────────────────────────
// Indépendant du nombre de réseaux : le besoin naît du STOCK, pas de la SIM.
// Une boutique à court de float sollicite une consœur, qu'elle ait un réseau ou cinq.
export const COLLABORATIONS_ENABLED = activeProfile?.collaborations?.enabled === true

// ── Tailles de fenêtre ───────────────────────────────────────────────────────
export const COLLABORATIONS_PAGE_SIZE = 20
export const INTERNAL_DEBTS_PAGE_SIZE = 20
export const COLLABORATIONS_HISTORY_PAGE_SIZE = 50

// ── Libellés ─────────────────────────────────────────────────────────────────
export const COLLAB_OPERATION_TYPE_LABELS = Object.freeze({
  deposit: 'Dépôt',
  withdrawal: 'Retrait',
})

export const COLLAB_STATUS_LABELS = Object.freeze({
  pending: 'En attente',
  confirmed: 'Confirmée',
  rejected: 'Rejetée',
})

export const DEBT_STATUS_LABELS = Object.freeze({
  open: 'Ouverte',
  partially_settled: 'Partiellement réglée',
  settled: 'Réglée',
})

export const DEBT_SETTLEMENT_STATUS_LABELS = Object.freeze({
  declared: 'Déclaré',
  confirmed: 'Confirmé',
  rejected: 'Rejeté',
})

/**
 * Libellés des méthodes.
 *
 * ⚠ Contient des codes HISTORIQUES (`especes`, `transfert`…) qui ne sont plus
 *   proposés à la saisie mais restent portés par d'anciennes tranches. Les retirer
 *   ferait afficher un code brut à la place d'un mot lisible.
 */
export const DEBT_SETTLEMENT_METHOD_LABELS = Object.freeze({
  especes: 'Espèces',
  depot_bancaire: 'Dépôt bancaire',
  transfert: 'Transfert',
  compensation: 'Compensation',
  retour_stock: 'Retour de stock',
})

export function settlementMethodLabel(method) {
  return DEBT_SETTLEMENT_METHOD_LABELS[method] ?? method ?? '—'
}

// ── Méthodes déclarables ─────────────────────────────────────────────────────
// Méthodes du profil + « Banque » : une dette peut se solder par virement
// bancaire, une transaction client non. Miroir de DEBT_SETTLEMENT_METHODS côté
// serveur, qui reste l'autorité.
export const DEBT_ONLY_SETTLEMENT_METHOD = 'Banque'

export const DEBT_SETTLEMENT_METHODS = Object.freeze([
  ...new Set([...(activeProfile?.transactions?.paymentMethods ?? []), DEBT_ONLY_SETTLEMENT_METHOD]),
])

// ── Sens d'une ligne, pour le code couleur entrée/sortie ─────────────────────
export const COLLAB_DIRECTION_LABELS = Object.freeze({
  incoming: 'Reçue',
  outgoing: 'Envoyée',
})

export const DEBT_DIRECTION_LABELS = Object.freeze({
  debt: 'Dette',
  credit: 'Créance',
})
