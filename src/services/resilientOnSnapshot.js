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
 * Emballe un `unsubscribe` Firestore pour qu'il ne puisse pas faire tomber un
 * écran en se fermant.
 *
 * À réserver aux abonnements qui n'utilisent PAS `resilientOnSnapshot` — celui-ci
 * rend déjà un démontage total. Les écouteurs bruts (`onSnapshot` appelé en
 * direct) rendent, eux, la fonction du SDK, qui lève dès que sa file interne est
 * tombée. Rendue telle quelle à un `useEffect`, elle transforme un incident de
 * fond en arbre React démonté.
 */
export function safeUnsubscribe(unsubscribe) {
  return function demontageSur() {
    try {
      if (typeof unsubscribe === 'function') unsubscribe()
    } catch { /* on abandonne cet écouteur de toute façon */ }
  }
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

  function programmerReprise(err) {
    if (stopped || isPermanentSnapshotError(err)) return
    retryTimer = setTimeoutFn(() => {
      retryTimer = null
      currentDelay = Math.min(currentDelay * 2, maxDelayMs)
      open()
    }, currentDelay)
  }

  function open() {
    if (stopped) return
    try {
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
          programmerReprise(err)
        },
      )
    } catch (err) {
      // ⚠ `onSnapshot` peut LEVER au lieu de rapporter — c'est le cas quand la
      //   file interne du SDK est déjà tombée : toute opération suivante relance
      //   l'échec d'origine. Sans ce garde, l'exception traverserait l'effet
      //   React qui a monté l'abonnement et ferait tomber l'écran entier.
      currentUnsubscribe = null
      onError?.(err)
      programmerReprise(err)
    }
  }

  open()

  /**
   * LE DÉMONTAGE NE PEUT PAS ÉCHOUER.
   *
   * Cette fonction est appelée depuis un nettoyage d'effet React. Une exception
   * levée là n'est pas rattrapée par le `try` de personne : React la traite
   * comme une erreur de composant, démonte l'arbre et le confie à la frontière
   * d'erreur la plus proche. Sur cette application, ça emporte la page ET la
   * barre de navigation — puis le remontage rouvre les mêmes abonnements, qui
   * relèvent la même exception, en boucle.
   *
   * Or `unsubscribe()` de Firestore lève quand la file interne du SDK est déjà
   * tombée (assertion `b815` : toute opération enfilée après un échec relance
   * cet échec). Un incident de fond devient alors un écran mort — exactement ce
   * que ce fichier existe pour éviter, en plus bruyant.
   *
   * On avale donc, et on avale VRAIMENT : arrêter un écouteur qu'on abandonne
   * de toute façon n'a aucune information à remonter. Ce qui compte est que
   * `stopped` soit posé — le réabonnement, lui, ne repartira pas.
   */
  return function unsubscribe() {
    stopped = true
    const listener = currentUnsubscribe
    currentUnsubscribe = null
    const minuteur = retryTimer
    retryTimer = null

    if (minuteur !== null) {
      try { clearTimeoutFn(minuteur) } catch { /* rien à sauver ici */ }
    }
    if (typeof listener === 'function') {
      try { listener() } catch { /* rien à sauver ici */ }
    }
  }
}

export default resilientOnSnapshot
