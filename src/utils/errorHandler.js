import { FIRESTORE_CONFIG } from '../constants/firestoreConstants'

// Types d'erreurs Firestore
export const ERROR_TYPES = {
  NETWORK: 'network',
  PERMISSION: 'permission',
  NOT_FOUND: 'not-found',
  QUOTA: 'quota',
  TIMEOUT: 'timeout',
  VALIDATION: 'validation',
  UNKNOWN: 'unknown'
}

// Circuit Breaker pour éviter les appels répétés en cas de problème
class CircuitBreaker {
  constructor(threshold = 5, timeout = 60000) {
    this.threshold = threshold
    this.timeout = timeout
    this.failures = 0
    this.lastFailureTime = null
    this.state = 'CLOSED' // CLOSED, OPEN, HALF_OPEN
  }

  async execute(operation) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'HALF_OPEN'
      } else {
        throw new Error('Circuit breaker is OPEN - service temporarily unavailable')
      }
    }

    try {
      const result = await operation()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    }
  }

  onSuccess() {
    this.failures = 0
    this.state = 'CLOSED'
  }

  onFailure() {
    this.failures++
    this.lastFailureTime = Date.now()

    if (this.failures >= this.threshold) {
      this.state = 'OPEN'
    }
  }

  isOpen() {
    return this.state === 'OPEN'
  }
}

// Instance globale du circuit breaker
const circuitBreaker = new CircuitBreaker()

// Fonction de retry avec backoff exponentiel
export const retryWithBackoff = async (
  operation,
  maxRetries = FIRESTORE_CONFIG.LIMITS.RETRY_ATTEMPTS,
  baseDelay = FIRESTORE_CONFIG.LIMITS.RETRY_DELAY
) => {
  let lastError

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Utiliser le circuit breaker pour l'opération
      return await circuitBreaker.execute(operation)
    } catch (error) {
      lastError = error

      // Ne pas retry pour certains types d'erreurs
      if (shouldNotRetry(error) || attempt === maxRetries) {
        break
      }

      // Calculer le délai avec backoff exponentiel + jitter
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000
      await sleep(delay)
    }
  }

  throw lastError
}

// Détermine si une erreur ne doit pas être retryée
const shouldNotRetry = (error) => {
  const code = error.code || error.message

  return [
    'permission-denied',
    'invalid-argument',
    'not-found',
    'already-exists',
    'failed-precondition',
    'unauthenticated'
  ].includes(code)
}

// Fonction utilitaire pour le sleep
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// Classifier le type d'erreur Firestore
export const classifyError = (error) => {
  const code = error.code || error.message?.toLowerCase() || ''

  if (code.includes('network') || code.includes('offline')) {
    return ERROR_TYPES.NETWORK
  }

  if (code.includes('permission') || code.includes('unauthorized')) {
    return ERROR_TYPES.PERMISSION
  }

  if (code.includes('not-found')) {
    return ERROR_TYPES.NOT_FOUND
  }

  if (code.includes('quota') || code.includes('resource-exhausted')) {
    return ERROR_TYPES.QUOTA
  }

  if (code.includes('timeout') || code.includes('deadline')) {
    return ERROR_TYPES.TIMEOUT
  }

  if (code.includes('invalid') || code.includes('validation')) {
    return ERROR_TYPES.VALIDATION
  }

  return ERROR_TYPES.UNKNOWN
}

// Obtenir un message d'erreur utilisateur-friendly
export const getUserFriendlyMessage = (error) => {
  const errorType = classifyError(error)

  const messages = {
    [ERROR_TYPES.NETWORK]: 'Problème de connexion réseau. Vérifiez votre connexion internet.',
    [ERROR_TYPES.PERMISSION]: 'Vous n\'avez pas les permissions nécessaires pour cette action.',
    [ERROR_TYPES.NOT_FOUND]: 'L\'élément demandé n\'existe pas ou a été supprimé.',
    [ERROR_TYPES.QUOTA]: 'Limite de quota atteinte. Veuillez réessayer plus tard.',
    [ERROR_TYPES.TIMEOUT]: 'L\'opération a pris trop de temps. Veuillez réessayer.',
    [ERROR_TYPES.VALIDATION]: 'Les données fournies ne sont pas valides.',
    [ERROR_TYPES.UNKNOWN]: 'Une erreur inattendue s\'est produite.'
  }

  return messages[errorType] || messages[ERROR_TYPES.UNKNOWN]
}

// Wrapper pour les opérations Firestore avec gestion d'erreurs complète
export const withErrorHandling = async (operation, context = '') => {
  try {
    return await retryWithBackoff(operation)
  } catch (error) {
    // Log error for debugging
    console.error(`Error in ${context || 'operation'}:`, error)

    // Créer une erreur enrichie
    const enhancedError = new Error(getUserFriendlyMessage(error))
    enhancedError.originalError = error
    enhancedError.type = classifyError(error)
    enhancedError.context = context
    enhancedError.timestamp = new Date().toISOString()

    throw enhancedError
  }
}

export { circuitBreaker }