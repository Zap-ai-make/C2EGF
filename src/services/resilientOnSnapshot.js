/**
 * resilientOnSnapshot — abonnement Firestore qui se relève.
 *
 * POURQUOI CE FICHIER EXISTE
 * ──────────────────────────
 * Un `onSnapshot` qui tombe en erreur est TERMINAL : le listener meurt et ne se
 * rétablit jamais. La page cesse de se mettre à jour, le bandeau d'erreur reste
 * figé, et l'utilisateur ne voit plus rien changer — sans qu'aucun indice ne lui
 * dise qu'il regarde des données mortes. Sur des écrans qui portent de l'argent,
 * c'est le pire mode de défaillance : silencieux et crédible.
 *
 * ⚠ Ne PAS confondre avec FirestoreService.subscribeToCollection, qui coupe ses
 *   listeners au bout de 30 s (LISTENER_TIMEOUT). Les abonnements de ce module
 *   passent en direct par `onSnapshot`, comme le fait déjà storeTransferService.
 *
 * LES CODES PERMANENTS NE SE RÉESSAIENT PAS
 * ─────────────────────────────────────────
 * `permission-denied` (règle qui refuse) et `failed-precondition` (index manquant)
 * exigent un déploiement pour être corrigés. Se réabonner en boucle ne ferait que
 * marteler le backend sans aucune chance d'aboutir. On prévient l'appelant et on
 * s'arrête — c'est un bug à corriger, pas un incident à traverser.
 */

import { onSnapshot } from 'firebase/firestore'

export const RESILIENT_BASE_DELAY_MS = 4000
export const RESILIENT_MAX_DELAY_MS = 60000

// Codes pour lesquels un réabonnement est vain (cf. ci-dessus).
export const PERMANENT_SNAPSHOT_CODES = Object.freeze(['permission-denied', 'failed-precondition'])

export function isPermanentSnapshotError(err) {
  const code = String(err?.code ?? '')
  return PERMANENT_SNAPSHOT_CODES.some((permanent) => code.includes(permanent))
}

/**
 * @param {import('firebase/firestore').Query} query
 * @param {object} options
 * @param {(snapshot: import('firebase/firestore').QuerySnapshot) => void} options.onNext
 * @param {(error: Error) => void} [options.onError]
 * @param {number} [options.delayMs] délai initial du backoff
 * @param {number} [options.maxDelayMs] plafond du backoff
 * @param {Function} [options.subscribe] injection de onSnapshot (tests)
 * @param {Function} [options.setTimeoutFn] injection du minuteur (tests)
 * @param {Function} [options.clearTimeoutFn]
 * @returns {() => void} unsubscribe — annule le minuteur ET le listener courant
 */
export function resilientOnSnapshot(query, {
  onNext,
  onError,
  delayMs = RESILIENT_BASE_DELAY_MS,
  maxDelayMs = RESILIENT_MAX_DELAY_MS,
  subscribe = onSnapshot,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  let currentUnsubscribe = null
  let retryTimer = null
  let currentDelay = delayMs
  let stopped = false

  function open() {
    if (stopped) return
    currentUnsubscribe = subscribe(
      query,
      (snapshot) => {
        // Un snapshot réussi réinitialise le backoff : une coupure passagère ne
        // doit pas laisser la prochaine dans une fenêtre d'attente d'une minute.
        currentDelay = delayMs
        onNext?.(snapshot)
      },
      (err) => {
        // On prévient TOUJOURS l'appelant d'abord : c'est lui qui décide quoi
        // afficher. Le réabonnement vient après, jamais à la place.
        onError?.(err)
        if (stopped || isPermanentSnapshotError(err)) return

        retryTimer = setTimeoutFn(() => {
          retryTimer = null
          currentDelay = Math.min(currentDelay * 2, maxDelayMs)
          open()
        }, currentDelay)
      },
    )
  }

  open()

  return function unsubscribe() {
    stopped = true
    if (retryTimer !== null) {
      clearTimeoutFn(retryTimer)
      retryTimer = null
    }
    if (typeof currentUnsubscribe === 'function') {
      currentUnsubscribe()
      currentUnsubscribe = null
    }
  }
}

export default resilientOnSnapshot
