// Système de logging intelligent pour production/développement

const isDevelopment = import.meta.env.DEV

// Logger principal avec différents niveaux
const logger = {
  // Logs de développement uniquement
  debug: (...args) => {
    if (isDevelopment) {
      console.debug('🐛 [DEBUG]', ...args)
    }
  },

  // Logs d'information (importantes même en production)
  info: (...args) => {
    if (isDevelopment) {
      console.info('ℹ️ [INFO]', ...args)
    }
  },

  // Logs d'avertissement (toujours affiché)
  warn: (...args) => {
    console.warn('⚠️ [WARN]', ...args)
  },

  // Logs d'erreur (toujours affiché mais format adapté à l'environnement)
  error: (...args) => {
    if (isDevelopment) {
      console.error('❌ [ERROR]', ...args)
    } else {
      // En production, log simplifié
      console.error('Application error occurred')
      // Ici on pourrait envoyer vers un service de monitoring
      // comme Sentry, LogRocket, etc.
    }
  },

  // Logger spécialisé pour Firestore
  firestore: {
    error: (...args) => {
      if (isDevelopment) {
        console.error('🔥 [FIRESTORE ERROR]', ...args)
      } else {
        console.error('Database operation failed')
      }
    },

    info: (...args) => {
      if (isDevelopment) {
        console.info('🔥 [FIRESTORE]', ...args)
      }
    },

    warn: (...args) => {
      if (isDevelopment) {
        console.warn('🔥 [FIRESTORE WARN]', ...args)
      }
    }
  },

  // Logger pour les performances
  performance: {
    start: (label) => {
      if (isDevelopment) {
        console.time(`⚡ [PERF] ${label}`)
      }
    },

    end: (label) => {
      if (isDevelopment) {
        console.timeEnd(`⚡ [PERF] ${label}`)
      }
    },

    mark: (label, ...data) => {
      if (isDevelopment) {
        console.log(`⚡ [PERF MARK] ${label}`, ...data)
      }
    }
  },

  // Logger pour les interactions utilisateur
  user: {
    action: (action, data = {}) => {
      if (isDevelopment) {
        console.log(`👤 [USER ACTION] ${action}`, data)
      }
      // En production, on pourrait envoyer vers un analytics
    },

    error: (context, error) => {
      if (isDevelopment) {
        console.error(`👤 [USER ERROR] ${context}`, error)
      } else {
        console.error(`User operation failed: ${context}`)
      }
    }
  }
}

// Export du logger principal
export default logger
export { logger }