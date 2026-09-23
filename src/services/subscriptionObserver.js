export function normalizeSubscriptionObserver(observer) {
  if (typeof observer === 'function') {
    return { onNext: observer, onError: observer.onError }
  }
  if (observer && typeof observer === 'object' && typeof (observer.onNext || observer.next) === 'function') {
    return { onNext: observer.onNext || observer.next, onError: observer.onError }
  }
  throw new TypeError('Un abonnement requiert onNext (ou une fonction callback).')
}

export function notifySubscriptionError(observer, error, label) {
  if (typeof observer.onError === 'function') observer.onError(error)
  else console.error(`${label}:`, error)
}
