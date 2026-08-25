import { useState, useEffect } from 'react'

// Système de monitoring des performances

class PerformanceMonitor {
  constructor() {
    this.metrics = {
      firestore: {
        operations: 0,
        totalTime: 0,
        averageTime: 0,
        errors: 0,
        cacheHits: 0,
        cacheMisses: 0
      },
      auth: {
        operations: 0,
        totalTime: 0,
        averageTime: 0,
        errors: 0
      },
      ui: {
        renders: 0,
        slowRenders: 0,
        navigation: {
          count: 0,
          totalTime: 0,
          averageTime: 0
        }
      },
      network: {
        requests: 0,
        failures: 0,
        totalTime: 0,
        averageTime: 0
      }
    }

    this.thresholds = {
      slowFirestore: 2000, // 2s
      slowAuth: 5000, // 5s
      slowRender: 16, // 16ms (60fps)
      slowNavigation: 1000 // 1s
    }

    this.observers = []
    this.isObserving = false

    // Initialiser les observers Web APIs
    this.initializeObservers()
  }

  // Initialiser les observers natifs du navigateur
  initializeObservers() {
    if (typeof window === 'undefined') return

    // Performance Observer pour les métriques Web Vitals
    if ('PerformanceObserver' in window) {
      try {
        // Observer pour Largest Contentful Paint (LCP)
        const lcpObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries()
          entries.forEach((_entry) => {
          })
        })
        lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] })

        // Observer pour First Input Delay (FID)
        const fidObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries()
          entries.forEach((_entry) => {
          })
        })
        fidObserver.observe({ entryTypes: ['first-input'] })

        // Observer pour les métriques de navigation
        const navigationObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries()
          entries.forEach((entry) => {
            this.recordNavigation(entry.duration)
          })
        })
        navigationObserver.observe({ entryTypes: ['navigation'] })

        this.observers.push(lcpObserver, fidObserver, navigationObserver)
        this.isObserving = true
      } catch (error) {
        console.warn('Performance observers not supported:', error.message)
      }
    }
  }

  // Mesurer une opération Firestore
  measureFirestoreOperation(operation, startTime, error = null) {
    const duration = Date.now() - startTime

    this.metrics.firestore.operations++
    this.metrics.firestore.totalTime += duration
    this.metrics.firestore.averageTime = this.metrics.firestore.totalTime / this.metrics.firestore.operations

    if (error) {
      this.metrics.firestore.errors++
    }


    return duration
  }

  // Mesurer une opération d'authentification
  measureAuthOperation(operation, startTime, error = null) {
    const duration = Date.now() - startTime

    this.metrics.auth.operations++
    this.metrics.auth.totalTime += duration
    this.metrics.auth.averageTime = this.metrics.auth.totalTime / this.metrics.auth.operations

    if (error) {
      this.metrics.auth.errors++
    }


    return duration
  }

  // Enregistrer un hit/miss de cache
  recordCacheHit(hit) {
    if (hit) {
      this.metrics.firestore.cacheHits++
    } else {
      this.metrics.firestore.cacheMisses++
    }
  }

  // Enregistrer une navigation
  recordNavigation(duration) {
    this.metrics.ui.navigation.count++
    this.metrics.ui.navigation.totalTime += duration
    this.metrics.ui.navigation.averageTime = this.metrics.ui.navigation.totalTime / this.metrics.ui.navigation.count

    if (duration > this.thresholds.slowNavigation) {
      console.warn('Slow Navigation detected:', {
        duration,
        threshold: this.thresholds.slowNavigation
      })
    }
  }

  // Enregistrer un render React
  recordRender(componentName, duration) {
    this.metrics.ui.renders++

    if (duration > this.thresholds.slowRender) {
      this.metrics.ui.slowRenders++
      console.warn(`Slow Render detected: ${componentName}`, {
        duration,
        component: componentName,
        threshold: this.thresholds.slowRender
      })
    }
  }

  // Enregistrer une requête réseau
  recordNetworkRequest(duration, success = true) {
    this.metrics.network.requests++
    this.metrics.network.totalTime += duration
    this.metrics.network.averageTime = this.metrics.network.totalTime / this.metrics.network.requests

    if (!success) {
      this.metrics.network.failures++
    }
  }

  // Wrapper pour mesurer automatiquement les fonctions async
  async measureAsync(operation, asyncFunction, category = 'general') {
    const startTime = Date.now()
    let error = null

    try {
      const result = await asyncFunction()
      return result
    } catch (err) {
      error = err
      throw err
    } finally {
      switch (category) {
        case 'firestore':
          this.measureFirestoreOperation(operation, startTime, error)
          break
        case 'auth':
          this.measureAuthOperation(operation, startTime, error)
          break
        default:
      }
    }
  }

  // Obtenir les statistiques actuelles
  getStats() {
    const cacheHitRate = this.metrics.firestore.cacheHits + this.metrics.firestore.cacheMisses > 0
      ? (this.metrics.firestore.cacheHits / (this.metrics.firestore.cacheHits + this.metrics.firestore.cacheMisses)) * 100
      : 0

    const firestoreErrorRate = this.metrics.firestore.operations > 0
      ? (this.metrics.firestore.errors / this.metrics.firestore.operations) * 100
      : 0

    const authErrorRate = this.metrics.auth.operations > 0
      ? (this.metrics.auth.errors / this.metrics.auth.operations) * 100
      : 0

    const networkFailureRate = this.metrics.network.requests > 0
      ? (this.metrics.network.failures / this.metrics.network.requests) * 100
      : 0

    return {
      ...this.metrics,
      computed: {
        cacheHitRate: Math.round(cacheHitRate * 100) / 100,
        firestoreErrorRate: Math.round(firestoreErrorRate * 100) / 100,
        authErrorRate: Math.round(authErrorRate * 100) / 100,
        networkFailureRate: Math.round(networkFailureRate * 100) / 100,
        slowRenderRate: this.metrics.ui.renders > 0
          ? Math.round((this.metrics.ui.slowRenders / this.metrics.ui.renders) * 10000) / 100
          : 0
      },
      thresholds: this.thresholds,
      isObserving: this.isObserving
    }
  }

  // Exporter les métriques pour analytics
  exportMetrics() {
    const stats = this.getStats()

    return {
      timestamp: new Date().toISOString(),
      session: {
        duration: Date.now() - (performance.timing?.navigationStart || Date.now()),
        url: typeof window !== 'undefined' ? window.location.href : null
      },
      metrics: stats
    }
  }

  // Reset des métriques
  reset() {
    this.metrics = {
      firestore: {
        operations: 0,
        totalTime: 0,
        averageTime: 0,
        errors: 0,
        cacheHits: 0,
        cacheMisses: 0
      },
      auth: {
        operations: 0,
        totalTime: 0,
        averageTime: 0,
        errors: 0
      },
      ui: {
        renders: 0,
        slowRenders: 0,
        navigation: {
          count: 0,
          totalTime: 0,
          averageTime: 0
        }
      },
      network: {
        requests: 0,
        failures: 0,
        totalTime: 0,
        averageTime: 0
      }
    }

  }

  // Arrêter les observers
  disconnect() {
    this.observers.forEach(observer => {
      try {
        observer.disconnect()
      } catch (error) {
        console.warn('Error disconnecting observer:', error.message)
      }
    })
    this.observers = []
    this.isObserving = false
  }

  // Démarrer un monitoring périodique
  startPeriodicReporting(intervalMs = 60000) { // 1 minute par défaut
    if (this.reportingInterval) {
      clearInterval(this.reportingInterval)
    }

    this.reportingInterval = setInterval(() => {
      const stats = this.getStats()

      // Envoyer vers un service d'analytics si configuré
      if (typeof window !== 'undefined' && window.gtag) {
        window.gtag('event', 'performance_metrics', {
          custom_parameter: JSON.stringify(stats.computed)
        })
      }
    }, intervalMs)

    return this.reportingInterval
  }

  // Arrêter le monitoring périodique
  stopPeriodicReporting() {
    if (this.reportingInterval) {
      clearInterval(this.reportingInterval)
      this.reportingInterval = null
    }
  }
}

// Instance singleton
const performanceMonitor = new PerformanceMonitor()

// Hook React pour mesurer les renders
export const useRenderMetrics = (componentName) => {
  const [renderStart] = useState(() => performance.now())

  useEffect(() => {
    const renderTime = performance.now() - renderStart
    performanceMonitor.recordRender(componentName, renderTime)
  }, [componentName, renderStart])
}

// Décorateur pour mesurer automatiquement les méthodes
export const withPerformanceTracking = (category = 'general') => {
  return (target, propertyKey, descriptor) => {
    const originalMethod = descriptor.value

    descriptor.value = async function(...args) {
      return await performanceMonitor.measureAsync(
        propertyKey,
        () => originalMethod.apply(this, args),
        category
      )
    }

    return descriptor
  }
}

export default performanceMonitor
export { PerformanceMonitor }
