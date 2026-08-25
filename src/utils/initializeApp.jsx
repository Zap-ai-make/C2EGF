import { useState, useEffect } from 'react'
import performanceMonitor from './performanceMonitor'

// Initialisation globale de l'application avec monitoring

export const initializeApp = () => {
  try {
    // Exposer le performance monitor globalement pour intégration
    if (typeof window !== 'undefined') {
      window.performanceMonitor = performanceMonitor
    }

    // Démarrer le monitoring périodique (toutes les 2 minutes)
    performanceMonitor.startPeriodicReporting(120000)

    // Log de démarrage

    // Écouter les erreurs non capturées
    if (typeof window !== 'undefined') {
      window.addEventListener('error', (event) => {
        console.error('Uncaught error:', {
          message: event.message,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          stack: event.error?.stack
        })
      })

      window.addEventListener('unhandledrejection', (event) => {
        console.error('Unhandled promise rejection:', {
          reason: event.reason?.toString(),
          stack: event.reason?.stack
        })
      })

      // Détecter la performance de chargement
      window.addEventListener('load', () => {
        if (performance.timing) {
          performance.timing.loadEventEnd - performance.timing.navigationStart
        }
      })

      // Surveiller les changements de visibilité
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          // Envoyer les métriques avant de quitter
          performanceMonitor.exportMetrics()
        }
      })
    }

    return true
  } catch (error) {
    console.error('Failed to initialize app monitoring:', error)
    return false
  }
}

// Nettoyage lors de la fermeture de l'application
export const cleanupApp = () => {
  try {
    performanceMonitor.stopPeriodicReporting()
    performanceMonitor.disconnect()

    return true
  } catch (error) {
    console.error('Failed to cleanup app:', error)
    return false
  }
}

// Hook pour React Strict Mode ou développement
export const useAppInitialization = () => {
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    const success = initializeApp()
    setInitialized(success)

    return () => {
      cleanupApp()
    }
  }, [])

  return initialized
}
