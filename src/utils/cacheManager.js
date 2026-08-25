import { FIRESTORE_CONFIG } from '../constants/firestoreConstants'

// Cache intelligent avec TTL et invalidation sélective
class CacheManager {
  constructor() {
    this.cache = new Map()
    this.timers = new Map()
    this.dependencies = new Map() // Pour l'invalidation par pattern
  }

  // Générer une clé de cache
  generateKey(collection, query = {}, prefix = '') {
    const baseKey = `${prefix}${collection}`

    if (Object.keys(query).length === 0) {
      return baseKey
    }

    // Trier les clés pour avoir des clés cohérentes
    const sortedQuery = Object.keys(query)
      .sort()
      .reduce((obj, key) => {
        obj[key] = query[key]
        return obj
      }, {})

    return `${baseKey}:${JSON.stringify(sortedQuery)}`
  }

  // Mettre en cache avec TTL
  set(key, data, ttl = FIRESTORE_CONFIG.CACHE.TTL) {
    // Nettoyer l'ancien timer s'il existe
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key))
    }

    // Stocker les données avec metadata
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
      hits: 0
    })

    // Configurer l'expiration automatique
    const timer = setTimeout(() => {
      this.delete(key)
    }, ttl)

    this.timers.set(key, timer)

    // Nettoyer si le cache devient trop grand
    this.cleanup()
  }

  // Récupérer du cache
  get(key) {
    const entry = this.cache.get(key)

    if (!entry) {
      // Enregistrer cache miss
      if (typeof window !== 'undefined' && window.performanceMonitor) {
        window.performanceMonitor.recordCacheHit(false)
      }
      return null
    }

    // Vérifier l'expiration
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.delete(key)
      // Enregistrer cache miss (expiré)
      if (typeof window !== 'undefined' && window.performanceMonitor) {
        window.performanceMonitor.recordCacheHit(false)
      }
      return null
    }

    // Incrémenter le compteur de hits
    entry.hits++

    // Enregistrer cache hit
    if (typeof window !== 'undefined' && window.performanceMonitor) {
      window.performanceMonitor.recordCacheHit(true)
    }

    return entry.data
  }

  // Vérifier si une clé existe et est valide
  has(key) {
    return this.get(key) !== null
  }

  // Supprimer une entrée
  delete(key) {
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key))
      this.timers.delete(key)
    }

    return this.cache.delete(key)
  }

  // Invalider par pattern (ex: "clients_*")
  invalidatePattern(pattern) {
    const regex = new RegExp(pattern.replace('*', '.*'))
    const keysToDelete = []

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        keysToDelete.push(key)
      }
    }

    keysToDelete.forEach(key => this.delete(key))
    return keysToDelete.length
  }

  // Invalider par collection
  invalidateCollection(collection) {
    return this.invalidatePattern(`${collection}*`)
  }

  // Nettoyer le cache (supprimer les entrées les moins utilisées)
  cleanup() {
    if (this.cache.size <= FIRESTORE_CONFIG.CACHE.MAX_SIZE) {
      return
    }

    // Trier par nombre de hits (LRU amélioré)
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => a[1].hits - b[1].hits)

    // Supprimer 20% des entrées les moins utilisées
    const toDelete = Math.floor(entries.length * 0.2)
    for (let i = 0; i < toDelete; i++) {
      this.delete(entries[i][0])
    }
  }

  // Vider complètement le cache
  clear() {
    // Nettoyer tous les timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }

    this.cache.clear()
    this.timers.clear()
    this.dependencies.clear()
  }

  // Statistiques du cache
  getStats() {
    const entries = Array.from(this.cache.values())
    const now = Date.now()

    return {
      size: this.cache.size,
      maxSize: FIRESTORE_CONFIG.CACHE.MAX_SIZE,
      totalHits: entries.reduce((sum, entry) => sum + entry.hits, 0),
      averageAge: entries.length > 0
        ? entries.reduce((sum, entry) => sum + (now - entry.timestamp), 0) / entries.length
        : 0,
      expiredEntries: entries.filter(entry =>
        now - entry.timestamp > entry.ttl
      ).length
    }
  }

  // Précharger des données populaires
  async prefetch(collection, queries = [{}]) {
    const promises = queries.map(async (query) => {
      const key = this.generateKey(collection, query, 'prefetch_')

      if (!this.has(key)) {
        try {
          // Cette fonction sera définie dans le service Firestore
          const data = await this.fetchFromFirestore(collection, query)
          this.set(key, data, FIRESTORE_CONFIG.CACHE.TTL * 2) // TTL plus long pour prefetch
        } catch {
          // Ignorer les erreurs de prefetch
        }
      }
    })

    await Promise.allSettled(promises)
  }

  // Méthode pour définir la fonction de fetch (sera appelée par le service)
  setFetchFunction(fetchFn) {
    this.fetchFromFirestore = fetchFn
  }
}

// Instance singleton
const cacheManager = new CacheManager()

// Utility functions pour le cache
export const cacheUtils = {
  // Wrapper pour les opérations avec cache manuel
  async withManualCache(key, fetchFn, ttl = FIRESTORE_CONFIG.CACHE.TTL) {
    const cached = cacheManager.get(key)
    if (cached) {
      return cached
    }

    const data = await fetchFn()
    cacheManager.set(key, data, ttl)
    return data
  },

  // Invalidation intelligente basée sur les patterns
  invalidateRelated(action, collection, docId = null) {
    const patterns = []

    switch (action) {
      case 'create':
        patterns.push(`${collection}*`)
        break
      case 'update':
        patterns.push(`${collection}*`)
        if (docId) patterns.push(`*${docId}*`)
        break
      case 'delete':
        patterns.push(`${collection}*`)
        if (docId) patterns.push(`*${docId}*`)
        break
    }

    let totalInvalidated = 0
    patterns.forEach(pattern => {
      totalInvalidated += cacheManager.invalidatePattern(pattern)
    })

    return totalInvalidated
  }
}

export default cacheManager
export { CacheManager }
