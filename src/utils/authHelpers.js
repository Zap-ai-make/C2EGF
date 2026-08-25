import { AUTH_ERRORS, AUTH_CONFIG, AUTH_ROLES } from '../constants/authMessages'
import { serverTimestamp } from 'firebase/firestore'

/**
 * Fonctions utilitaires pour l'authentification
 */

// Validation des emails
export const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

// Validation des mots de passe existants (connexion) : plancher Firebase (6).
export const isValidPassword = (password) => {
  return password && password.length >= AUTH_CONFIG.MIN_PASSWORD_LENGTH
}

// Validation d'un NOUVEAU mot de passe (inscription / changement) : min 8.
// Distinct de isValidPassword pour ne pas verrouiller les comptes existants.
export const isValidNewPassword = (password) => {
  return password && password.length >= AUTH_CONFIG.MIN_NEW_PASSWORD_LENGTH
}

// Vérification de la correspondance des mots de passe
export const doPasswordsMatch = (password, confirmPassword) => {
  return password === confirmPassword
}

// Nettoyage et formatage des noms
export const formatUserName = (name) => {
  if (!name) return ''
  return name.trim().split(' ').map(word =>
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  ).join(' ')
}

// Génération d'avatar à partir du nom
export const getAvatarInitial = (name, email) => {
  if (name) {
    const words = name.trim().split(' ')
    if (words.length >= 2) {
      return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase()
    }
    return name.charAt(0).toUpperCase()
  }
  if (email) {
    return email.charAt(0).toUpperCase()
  }
  return 'U'
}

// Formatage des dates
export const formatDate = (dateString, options = {}) => {
  if (!dateString) return 'Non disponible'

  try {
    const dateValue = typeof dateString?.toDate === 'function'
      ? dateString.toDate()
      : dateString
    const defaultOptions = {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }

    const date = new Date(dateValue)
    if (isNaN(date.getTime())) return 'Non disponible'

    return date.toLocaleDateString('fr-FR', {
      ...defaultOptions,
      ...options
    })
  } catch {
    return 'Non disponible'
  }
}

// Calcul du temps écoulé depuis une date
export const getDaysFromDate = (dateString) => {
  if (!dateString) return 0

  try {
    const dateValue = typeof dateString?.toDate === 'function'
      ? dateString.toDate()
      : dateString
    const date = new Date(dateValue)
    if (isNaN(date.getTime())) return 0
    const now = new Date()
    const diffTime = Math.abs(now - date)
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
    return diffDays
  } catch {
    return 0
  }
}

// Gestion des erreurs d'authentification
export const getAuthErrorMessage = (errorCode, fallbackMessage = AUTH_ERRORS.GENERIC_ERROR) => {
  return AUTH_ERRORS[errorCode] || fallbackMessage
}

// Nettoyage des données utilisateur sensibles pour l'affichage
export const sanitizeUserDataForDisplay = (userData) => {
  if (!userData) return {}

  const { password: _password, ...safeData } = userData
  return safeData
}

// Validation des champs de formulaire
export const validateFormFields = (fields) => {
  const errors = {}

  Object.entries(fields).forEach(([fieldName, value]) => {
    switch (fieldName) {
      case 'email':
        if (!value) {
          errors.email = 'L\'email est requis'
        } else if (!isValidEmail(value)) {
          errors.email = AUTH_ERRORS.INVALID_EMAIL_FORMAT
        }
        break

      case 'password':
        if (!value) {
          errors.password = 'Le mot de passe est requis'
        } else if (!isValidPassword(value)) {
          errors.password = AUTH_ERRORS.PASSWORD_MIN_LENGTH
        }
        break

      case 'confirmPassword':
        if (!value) {
          errors.confirmPassword = 'La confirmation du mot de passe est requise'
        } else if (fields.password && !doPasswordsMatch(fields.password, value)) {
          errors.confirmPassword = AUTH_ERRORS.PASSWORD_MISMATCH
        }
        break

      case 'name':
        if (!value || value.trim().length < 2) {
          errors.name = 'Le nom doit contenir au moins 2 caractères'
        }
        break

      default:
        if (!value) {
          errors[fieldName] = `${fieldName} est requis`
        }
    }
  })

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  }
}

// Debouncing pour les validations en temps réel
export const debounce = (func, wait) => {
  let timeout
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout)
      func(...args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}

// Gestion des timeouts avec cleanup
export const createTimeoutWithCleanup = (callback, delay) => {
  const timeoutId = setTimeout(callback, delay)

  return {
    id: timeoutId,
    clear: () => clearTimeout(timeoutId)
  }
}

// Génération d'identifiants uniques pour les formulaires
export const generateFormId = (prefix = 'form') => {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

// Vérification du support des fonctionnalités du navigateur
export const checkBrowserSupport = () => {
  return {
    localStorage: typeof(Storage) !== 'undefined',
    sessionStorage: typeof(sessionStorage) !== 'undefined',
    indexedDB: typeof(indexedDB) !== 'undefined',
    webCrypto: typeof(crypto) !== 'undefined' && typeof(crypto.subtle) !== 'undefined'
  }
}

// Utilitaires pour la gestion des états de chargement
export const createLoadingState = () => {
  let loadingCount = 0

  return {
    start: () => {
      loadingCount++
      return loadingCount > 0
    },
    stop: () => {
      loadingCount = Math.max(0, loadingCount - 1)
      return loadingCount > 0
    },
    reset: () => {
      loadingCount = 0
      return false
    },
    isLoading: () => loadingCount > 0
  }
}

// Configuration par défaut pour les profils utilisateur
export const getDefaultUserProfile = (email) => ({
  name: email ? email.split('@')[0] : 'Utilisateur',
  email: email || '',
  role: AUTH_ROLES.STORE_ADMIN,
  createdAt: serverTimestamp(),
  lastLogin: serverTimestamp()
})
