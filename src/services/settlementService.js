/**
 * settlementService.js — Appels aux Cloud Functions de règlement.
 *
 * Couche cliente mince : délègue à `addTransactionPayment` / `addTransactionRefund`
 * (europe-west1). La clé d'idempotence DOIT être fournie par l'appelant.
 *
 * Pattern idempotence client :
 *   L'appelant génère une clé stable par action utilisateur (voir TransactionTable.jsx).
 *   La clé est conservée dans un useRef pour les retries réseau et les re-renders.
 *   Elle est supprimée après succès confirmé.
 *   Un nouveau payload (montant ou méthode différent) doit utiliser une nouvelle clé.
 */

import { httpsCallable } from 'firebase/functions'
import { functions } from '../config/firebase'

const callPayment = httpsCallable(functions, 'addTransactionPayment')
const callRefund  = httpsCallable(functions, 'addTransactionRefund')

/**
 * Génère une clé d'idempotence aléatoire.
 * À appeler UNE SEULE FOIS par action utilisateur, puis stocker le résultat.
 */
export function generateIdempotencyKey() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/**
 * Enregistre un paiement (total ou partiel) sur un draft.
 *
 * @param {{ draftId: string, amount: number, paymentMethod: string, idempotencyKey: string }} params
 * @returns {Promise<{ success: boolean, idempotent: boolean, fullySettled: boolean, historyId: string|null }>}
 */
export async function addTransactionPayment({ draftId, amount, paymentMethod, idempotencyKey }) {
  if (!idempotencyKey) throw new Error('addTransactionPayment: idempotencyKey requis.')
  const result = await callPayment({ draftId, amount, paymentMethod, idempotencyKey })
  return result.data
}

/**
 * Enregistre un remboursement partiel sur un draft.
 *
 * @param {{ draftId: string, amount: number, paymentMethod: string, idempotencyKey: string }} params
 * @returns {Promise<{ success: boolean, idempotent: boolean }>}
 */
export async function addTransactionRefund({ draftId, amount, paymentMethod, idempotencyKey }) {
  if (!idempotencyKey) throw new Error('addTransactionRefund: idempotencyKey requis.')
  const result = await callRefund({ draftId, amount, paymentMethod, idempotencyKey })
  return result.data
}
