import {
  collection,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  where,
  getDocs,
  limit,
  startAfter,
  writeBatch,
  serverTimestamp
} from 'firebase/firestore'
import { db } from '../config/firebase'
import { withErrorHandling } from '../utils/errorHandler'
import cacheManager, { cacheUtils } from '../utils/cacheManager'
import { FIRESTORE_CONFIG } from '../constants/firestoreConstants'
import { CLIENT_ID, getFirestoreCollectionPath } from '../config/clientIsolation'
import { parseFcfaAmount } from '../utils/fcfaAmount.js'
import {
  validateFcfaAmount as _validateFcfaAmountFn,
  normalizeNetworkBalances as _normalizeNetworkBalancesFn,
  adjustBalanceValue as _adjustBalanceValueFn,
  applyLiquidityDelta as _applyLiquidityDeltaFn,
  normalizeTransactionLabel as _normalizeTransactionLabelFn,
  isDepositType as _isDepositTypeFn,
  isWithdrawalType as _isWithdrawalTypeFn,
  isCreditType as _isCreditTypeFn,
  isPendingStatus as _isPendingStatusFn,
  isValidatedStatus as _isValidatedStatusFn,
  mapPaymentMethodToNetwork as _mapPaymentMethodToNetworkFn,
  getSettlementActionFromStatus as _getSettlementActionFromStatusFn,
  validateSettlementAction as _validateSettlementActionFn,
  applyInitialTransactionImpact as _applyInitialTransactionImpactFn,
  reverseInitialTransactionImpact as _reverseInitialTransactionImpactFn,
  reversePendingOnlyImpact as _reversePendingOnlyImpactFn,
  reverseDirectValidatedImpact as _reverseDirectValidatedImpactFn,
  reverseHistoryTransactionImpact as _reverseHistoryTransactionImpactFn,
  applySettlementImpact as _applySettlementImpactFn
} from '../utils/financialImpact.js'
import { DraftService } from './draftService.js'
import { HistoryService } from './historyService.js'
import { BalanceService } from './balanceService.js'

// Service Firestore modulaire avec cache, gestion d'erreurs et optimisations

export class FirestoreService {
  constructor() {
    this.activeStore = null
    this.connectionPool = new Map() // Pool de connexions pour optimiser les listeners
    this.metrics = {
      operations: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errors: 0
    }

    // Configurer la fonction de fetch pour le cache
    cacheManager.setFetchFunction(this.fetchFromFirestore.bind(this))

    // Service délégué pour l'orchestration des drafts.
    // On passe this comme contexte vivant (pas de bind anticipé) afin que
    // les spies posés sur l'instance après construction soient honorés.
    this._draftService = new DraftService({ ctx: this })

    // Service délégué pour l'orchestration de l'historique.
    // Même pattern : contexte vivant pour honorer les spies.
    this._historyService = new HistoryService({ ctx: this })

    // Service délégué pour l'orchestration des soldes réseau.
    // Même pattern : contexte vivant pour honorer les spies.
    this._balanceService = new BalanceService({ ctx: this })
  }

  _validateFcfaAmount(raw, context = '') {
    return _validateFcfaAmountFn(raw, context)
  }

  setActiveStore(store = {}) {
    if (!store) {
      if (this.activeStore) {
        this.unsubscribeAll()
      }
      this.activeStore = null
      return
    }

    const nextStoreId = store.id || store.storeId || CLIENT_ID
    const nextStoreName = store.name || store.storeName || 'Boutique principale'

    if (this.activeStore?.id !== nextStoreId) {
      this.unsubscribeAll()
    }

    this.activeStore = {
      id: nextStoreId,
      name: nextStoreName
    }
  }

  getActiveStore() {
    return this.activeStore
  }

  requireActiveStore() {
    if (!this.activeStore?.id) {
      throw new Error('Boutique active introuvable. Veuillez vous reconnecter.')
    }

    return this.activeStore
  }

  resolveCollectionPath(collectionName) {
    if (
      collectionName === FIRESTORE_CONFIG.COLLECTIONS.USERS ||
      collectionName === FIRESTORE_CONFIG.COLLECTIONS.STORES ||
      collectionName === FIRESTORE_CONFIG.COLLECTIONS.CLIENTS
    ) {
      return collectionName
    }

    if (!this.activeStore?.id) {
      return getFirestoreCollectionPath(collectionName)
    }

    return `clients/${this.activeStore.id}/${collectionName}`
  }

  collectionRef(collectionName) {
    return collection(db, this.resolveCollectionPath(collectionName))
  }

  docRef(collectionName, docId) {
    return doc(db, this.resolveCollectionPath(collectionName), docId)
  }

  // ====================
  // MÉTHODES UTILITAIRES
  // ====================

  // Fetch pour le cache manager
  async fetchFromFirestore(collectionName, queryOptions = {}) {

    const q = this.buildQuery(collectionName, queryOptions)
    const snapshot = await getDocs(q)
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))

    return data
  }

  // Construire une query optimisée
  buildQuery(collectionName, options = {}) {
    let q = this.collectionRef(collectionName)

    if (options.where) {
      options.where.forEach(whereClause => {
        q = query(q, where(whereClause.field, whereClause.operator, whereClause.value))
      })
    }

    if (options.orderByField) {
      q = query(q, orderBy(options.orderByField, options.orderDirection || 'desc'))
    }

    if (options.limitCount) {
      q = query(q, limit(options.limitCount))
    }

    if (options.startAfterDoc) {
      q = query(q, startAfter(options.startAfterDoc))
    }

    return q
  }

  // Validation des données
  validateData(collectionName, data) {
    const rules = FIRESTORE_CONFIG.VALIDATION

    switch (collectionName) {
      case FIRESTORE_CONFIG.COLLECTIONS.CLIENTS:
        return this.validateClientData(data, rules.CLIENT)
      case FIRESTORE_CONFIG.COLLECTIONS.DRAFTS:
      case FIRESTORE_CONFIG.COLLECTIONS.HISTORY:
        return this.validateTransactionData(data, rules.TRANSACTION)
      default:
        return { isValid: true }
    }
  }

  validateClientData(data, rules) {
    const errors = []

    // --- nom ---
    if (!data.nom || typeof data.nom !== 'string') {
      errors.push(`Le nom est requis`)
    } else if (data.nom.length < rules.NAME_MIN_LENGTH) {
      errors.push(`Le nom doit comporter au moins ${rules.NAME_MIN_LENGTH} caractères`)
    } else if (data.nom.length > rules.NAME_MAX_LENGTH) {
      errors.push(`Le nom ne peut pas dépasser ${rules.NAME_MAX_LENGTH} caractères`)
    }

    // --- prenom ---
    if (!data.prenom || typeof data.prenom !== 'string') {
      errors.push(`Le prénom est requis`)
    } else if (data.prenom.length < rules.NAME_MIN_LENGTH) {
      errors.push(`Le prénom doit comporter au moins ${rules.NAME_MIN_LENGTH} caractères`)
    } else if (data.prenom.length > rules.NAME_MAX_LENGTH) {
      errors.push(`Le prénom ne peut pas dépasser ${rules.NAME_MAX_LENGTH} caractères`)
    }

    // --- numeroPersonnel (optionnel) ---
    // Aligné sur validClient() firestore.rules ligne 30-32 :
    //   (!data.keys().hasAny(['numeroPersonnel']) ||
    //    data.numeroPersonnel == '' ||
    //    data.numeroPersonnel.matches('^[0-9+\\-\\s()/]{8,120}$'))
    const personalNumber = data.numeroPersonnel
    if (personalNumber !== undefined && personalNumber !== '') {
      if (typeof personalNumber !== 'string' || !rules.PHONE_REGEX.test(personalNumber)) {
        errors.push('Le numéro personnel doit être une chaîne de 8 à 120 caractères (chiffres, +, -, espaces, /, ())')
      }
    }

    // --- registeredStoreId ---
    if (
      !data.registeredStoreId ||
      typeof data.registeredStoreId !== 'string' ||
      data.registeredStoreId.trim() === ''
    ) {
      errors.push('Identifiant de boutique manquant ou invalide')
    }

    // --- registeredStoreName ---
    if (
      !data.registeredStoreName ||
      typeof data.registeredStoreName !== 'string' ||
      data.registeredStoreName.trim() === ''
    ) {
      errors.push('Nom de boutique manquant ou invalide')
    }

    return { isValid: errors.length === 0, errors }
  }

  validateTransactionData(data, rules) {
    const errors = []

    if ('montant' in data) {
      if (parseFcfaAmount(data.montant) === null) {
        errors.push('Le montant doit être un entier strictement positif')
      }
    }

    rules.REQUIRED_FIELDS.forEach(field => {
      if (!data[field]) {
        errors.push(`Le champ ${field} est requis`)
      }
    })

    return { isValid: errors.length === 0, errors }
  }

  // ====================
  // FONCTIONS CRUD AVEC CACHE ET GESTION D'ERREURS
  // ====================

  /**
   * Ajouter un document à une collection
   */
  async addDocument(collectionName, data) {
    return await withErrorHandling(async () => {
      // Valider les données
      const validation = this.validateData(collectionName, data)
      if (!validation.isValid) {
        throw new Error(`Données invalides: ${validation.errors.join(', ')}`)
      }

      // Normaliser le montant en number pour les collections transactionnelles.
      // validateTransactionData a déjà validé : parseFcfaAmount est ici sans risque.
      const isTransactional =
        collectionName === FIRESTORE_CONFIG.COLLECTIONS.DRAFTS ||
        collectionName === FIRESTORE_CONFIG.COLLECTIONS.HISTORY

      let dataToWrite = data
      if (isTransactional && data.montant !== undefined) {
        const parsedAmount = parseFcfaAmount(data.montant)
        if (parsedAmount !== null) {
          dataToWrite = { ...data, montant: parsedAmount }
        }
      }

      const enrichedData = {
        ...dataToWrite,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }

      const docRef = await addDoc(this.collectionRef(collectionName), enrichedData)
      const result = { id: docRef.id, ...enrichedData }

      // Invalider le cache
      cacheUtils.invalidateRelated('create', collectionName)

      // Incrémenter les métriques
      this.metrics.operations++

      return result
    }, `addDocument(${collectionName})`)
  }

  /**
   * Mettre à jour un document
   */
  async updateDocument(collectionName, docId, updates) {
    return await withErrorHandling(async () => {
      // Vérifier d'abord que le document existe
      const docRef = this.docRef(collectionName, docId)
      const docSnap = await getDoc(docRef)

      if (!docSnap.exists()) {
        console.warn(`Document ${docId} n'existe pas dans ${collectionName}, création d'un nouveau document`)
        // Créer le document au lieu de le mettre à jour
        return await this.addDocument(collectionName, { ...updates, id: docId })
      }

      const enrichedUpdates = {
        ...updates,
        updatedAt: serverTimestamp()
      }

      await updateDoc(docRef, enrichedUpdates)

      // Invalider le cache
      cacheUtils.invalidateRelated('update', collectionName, docId)

      // Incrémenter les métriques
      this.metrics.operations++

      return true
    }, `updateDocument(${collectionName}, ${docId})`)
  }

  /**
   * Supprimer un document
   */
  async deleteDocument(collectionName, docId) {
    return await withErrorHandling(async () => {
      await deleteDoc(this.docRef(collectionName, docId))

      // Invalider le cache
      cacheUtils.invalidateRelated('delete', collectionName, docId)

      // Incrémenter les métriques
      this.metrics.operations++

      return true
    }, `deleteDocument(${collectionName}, ${docId})`)
  }

  /**
   * Lire un document avec cache
   */
  async getDocument(collectionName, docId, useCache = true) {
    return await withErrorHandling(async () => {
      const cacheKey = cacheManager.generateKey(collectionName, { docId })

      if (useCache) {
        const cached = cacheManager.get(cacheKey)
        if (cached) {
          this.metrics.cacheHits++
          return cached
        }
        this.metrics.cacheMisses++
      }

      const docRef = this.docRef(collectionName, docId)
      const docSnap = await getDocs(query(this.collectionRef(collectionName), where('__name__', '==', docRef)))

      if (docSnap.empty) {
        return null
      }

      const document = { id: docSnap.docs[0].id, ...docSnap.docs[0].data() }

      if (useCache) {
        cacheManager.set(cacheKey, document)
      }

      this.metrics.operations++
      return document
    }, `getDocument(${collectionName}, ${docId})`)
  }

  /**
   * Lire une collection avec cache et pagination
   */
  async getCollection(collectionName, options = {}, useCache = true) {
    return await withErrorHandling(async () => {
      const cacheKey = cacheManager.generateKey(collectionName, options)

      if (useCache) {
        const cached = cacheManager.get(cacheKey)
        if (cached) {
          this.metrics.cacheHits++
          return cached
        }
        this.metrics.cacheMisses++
      }

      const q = this.buildQuery(collectionName, options)
      const snapshot = await getDocs(q)
      const documents = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))

      if (useCache) {
        cacheManager.set(cacheKey, documents)
      }

      this.metrics.operations++
      return documents
    }, `getCollection(${collectionName})`)
  }

  /**
   * Opérations en batch pour de meilleures performances
   */
  async batchWrite(operations) {
    return await withErrorHandling(async () => {
      const batch = writeBatch(db)
      let operationCount = 0

      for (const operation of operations) {
        if (operationCount >= FIRESTORE_CONFIG.LIMITS.MAX_BATCH_SIZE) {
          throw new Error(`Batch size limit exceeded (${FIRESTORE_CONFIG.LIMITS.MAX_BATCH_SIZE})`)
        }

        const { type, collection: collectionName, id, data } = operation

        switch (type) {
          case 'create': {
            const newDocRef = doc(this.collectionRef(collectionName))
            batch.set(newDocRef, {
              ...data,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            })
            break
          }

          case 'update': {
            const updateDocRef = this.docRef(collectionName, id)
            batch.update(updateDocRef, {
              ...data,
              updatedAt: serverTimestamp()
            })
            break
          }

          case 'delete': {
            const deleteDocRef = this.docRef(collectionName, id)
            batch.delete(deleteDocRef)
            break
          }

          default:
            throw new Error(`Unknown operation type: ${type}`)
        }

        operationCount++
      }

      await batch.commit()

      // Invalider le cache pour toutes les collections affectées
      const affectedCollections = [...new Set(operations.map(op => op.collection))]
      affectedCollections.forEach(collectionName => {
        cacheManager.invalidateCollection(collectionName)
      })

      this.metrics.operations += operationCount

      return { success: true, operationsCount: operationCount }
    }, 'batchWrite')
  }

  // ====================
  // SYNCHRONISATION TEMPS RÉEL OPTIMISÉE
  // ====================

  /**
   * Écouter les changements d'une collection en temps réel avec optimisations
   */
  subscribeToCollection(collectionName, callback, queryOptions = {}) {
    try {
      const subscriptionKey = `${this.resolveCollectionPath(collectionName)}_${JSON.stringify(queryOptions)}`

      // Vérifier si on a déjà un listener pour cette requête exacte
      if (this.connectionPool.has(subscriptionKey)) {
        const existingListener = this.connectionPool.get(subscriptionKey)
        existingListener.callbacks.add(callback)
        return () => this.unsubscribeCallback(subscriptionKey, callback)
      }

      // Construire la query optimisée
      const q = this.buildQuery(collectionName, {
        ...queryOptions
        // Pas de limite par défaut - uniquement si explicitement demandée
      })

      // Timeout pour éviter les listeners bloqués
      const timeoutId = setTimeout(() => {
        console.warn('Firestore listener timeout for subscription:', subscriptionKey)
        this.unsubscribeFromCollection(subscriptionKey)
      }, FIRESTORE_CONFIG.LIMITS.LISTENER_TIMEOUT)

      const unsubscribe = onSnapshot(q,
        (snapshot) => {
          try {
            clearTimeout(timeoutId)

            // Obtenir tous les documents du snapshot
            const changes = snapshot.docChanges()
            // Traiter même s'il n'y a pas de changements (important pour chargement initial)

            const documents = snapshot.docs.map(doc => ({
              id: doc.id,
              ...doc.data()
            }))

            // Mettre à jour le cache automatiquement
            const cacheKey = cacheManager.generateKey(collectionName, queryOptions)
            cacheManager.set(cacheKey, documents, FIRESTORE_CONFIG.CACHE.TTL * 2) // TTL plus long pour real-time

            // Notifier tous les callbacks enregistrés
            const listenerInfo = this.connectionPool.get(subscriptionKey)
            if (listenerInfo) {
              listenerInfo.callbacks.forEach(cb => {
                try {
                  cb(documents, changes) // Passer aussi les changements pour optimisation
                } catch (error) {
                  console.error('Firestore subscription callback error:', error)
                }
              })
            }

          } catch (error) {
            console.error('Firestore snapshot processing error:', error)
          }
        },
        (error) => {
          clearTimeout(timeoutId)
          this.metrics.errors++
          console.error('Firestore listener error:', error)

          // Notifier les callbacks de l'erreur
          const listenerInfo = this.connectionPool.get(subscriptionKey)
          if (listenerInfo) {
            listenerInfo.callbacks.forEach(cb => {
              if (cb.onError) {
                cb.onError(error)
              }
            })
          }
        }
      )

      // Enregistrer dans le pool de connexions
      this.connectionPool.set(subscriptionKey, {
        unsubscribe,
        callbacks: new Set([callback]),
        createdAt: Date.now(),
        collection: collectionName
      })

      // Retourner une fonction pour se désabonner
      return () => this.unsubscribeCallback(subscriptionKey, callback)
    } catch (error) {
      this.metrics.errors++
      console.error(`Error in subscribeToCollection(${collectionName}):`, error)

      if (callback?.onError) {
        callback.onError(error)
      }

      return () => {}
    }
  }

  /**
   * Désabonner un callback spécifique
   */
  unsubscribeCallback(subscriptionKey, callback) {
    const listenerInfo = this.connectionPool.get(subscriptionKey)
    if (!listenerInfo) return

    listenerInfo.callbacks.delete(callback)

    // Si plus de callbacks, fermer le listener
    if (listenerInfo.callbacks.size === 0) {
      listenerInfo.unsubscribe()
      this.connectionPool.delete(subscriptionKey)
    }
  }

  /**
   * Optimiser les listeners inactifs
   */
  optimizeListeners() {
    const now = Date.now()
    const maxAge = 30 * 60 * 1000 // 30 minutes

    for (const [key, listenerInfo] of this.connectionPool.entries()) {
      if (now - listenerInfo.createdAt > maxAge && listenerInfo.callbacks.size === 0) {
        listenerInfo.unsubscribe()
        this.connectionPool.delete(key)
      }
    }
  }

  /**
   * Désabonner tous les listeners
   */
  unsubscribeAll() {
    // Listeners optimisés
    this.connectionPool.forEach((listenerInfo, _subscriptionKey) => {
      listenerInfo.unsubscribe()
    })
    this.connectionPool.clear()

    // Nettoyer le cache
    cacheManager.clear()
  }

  /**
   * Désabonner un listener spécifique
   */
  unsubscribeFromCollection(collectionName) {
    // Optimized listeners
    const keysToRemove = []
    this.connectionPool.forEach((listenerInfo, key) => {
      if (listenerInfo.collection === collectionName) {
        listenerInfo.unsubscribe()
        keysToRemove.push(key)
      }
    })

    keysToRemove.forEach(key => {
      this.connectionPool.delete(key)
    })

    // Invalider le cache pour cette collection
    cacheManager.invalidateCollection(collectionName)
  }

  // ====================
  // MÉTRIQUES ET MONITORING
  // ====================

  /**
   * Obtenir les métriques de performance
   */
  getMetrics() {
    return {
      ...this.metrics,
      cacheStats: cacheManager.getStats(),
      activeListeners: this.connectionPool.size,
      connectionPoolSize: this.connectionPool.size,
      cacheHitRatio: this.metrics.cacheHits > 0
        ? (this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses))
        : 0,
      legacyListenersSize: 0
    }
  }

  getNetworkBalanceDocRef() {
    return this._balanceService.getNetworkBalanceDocRef()
  }

  normalizeNetworkBalances(data = {}) {
    return _normalizeNetworkBalancesFn(data)
  }

  adjustBalanceValue(balances, network, field, delta) {
    return _adjustBalanceValueFn(balances, network, field, delta)
  }

  applyLiquidityDelta(balances, delta) {
    return _applyLiquidityDeltaFn(balances, delta)
  }

  normalizeTransactionLabel(value) {
    return _normalizeTransactionLabelFn(value)
  }

  isDepositType(type) {
    return _isDepositTypeFn(type)
  }

  isWithdrawalType(type) {
    return _isWithdrawalTypeFn(type)
  }

  isCreditType(type) {
    return _isCreditTypeFn(type)
  }

  isPendingStatus(status) {
    return _isPendingStatusFn(status)
  }

  isValidatedStatus(status) {
    return _isValidatedStatusFn(status)
  }

  applyInitialTransactionImpact(balances, transactionData) {
    return _applyInitialTransactionImpactFn(balances, transactionData)
  }

  reverseInitialTransactionImpact(balances, transactionData) {
    return _reverseInitialTransactionImpactFn(balances, transactionData)
  }

  _reversePendingOnlyImpact(balances, type, reseau, amount) {
    return _reversePendingOnlyImpactFn(balances, type, reseau, amount)
  }

  _reverseDirectValidatedImpact(balances, type, reseau, amount) {
    return _reverseDirectValidatedImpactFn(balances, type, reseau, amount)
  }

  reverseHistoryTransactionImpact(currentBalances, historyData) {
    return _reverseHistoryTransactionImpactFn(currentBalances, historyData)
  }

  applySettlementImpact(balances, transactionData, paymentMethod) {
    return _applySettlementImpactFn(balances, transactionData, paymentMethod)
  }

  getSettlementActionFromStatus(status) {
    return _getSettlementActionFromStatusFn(status)
  }

  validateSettlementAction(transactionType, action) {
    return _validateSettlementActionFn(transactionType, action)
  }

  async setNetworkBalances(balances) {
    return this._balanceService.setNetworkBalances(balances)
  }

  async ensureNetworkBalances(initialBalances) {
    return this._balanceService.ensureNetworkBalances(initialBalances)
  }

  async setNetworkBalance(network, type, amount) {
    return this._balanceService.setNetworkBalance(network, type, amount)
  }

  subscribeToNetworkBalances(callback) {
    return this._balanceService.subscribeToNetworkBalances(callback)
  }

  /**
   * Reset des métriques
   */
  resetMetrics() {
    this.metrics = {
      operations: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errors: 0
    }
  }

  /**
   * Health check du service
   */
  async healthCheck() {
    try {
      // Test basique de connexion
      const testQuery = query(collection(db, 'test'), limit(1))
      await getDocs(testQuery)

      const metrics = this.getMetrics()

      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        metrics,
        connectionPool: {
          size: this.connectionPool.size,
          connections: Array.from(this.connectionPool.keys())
        }
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error.message,
        metrics: this.getMetrics()
      }
    }
  }

  // ====================
  // FONCTIONS SPÉCIALISÉES POUR CHAQUE COLLECTION
  // ====================

  // CLIENTS
  async getClients() {
    this.requireActiveStore()
    return this.getCollection(FIRESTORE_CONFIG.COLLECTIONS.CLIENTS, {
      orderByField: 'createdAt',
      orderDirection: 'desc'
    })
  }

  async addClient(clientData) {
    const activeStore = this.requireActiveStore()

    if (!activeStore?.id || !activeStore?.name) {
      throw new Error('Boutique active non disponible pour la création du client')
    }

    // Anti-doublon : un même numéro/code agent (champ `orange`) ne peut être enregistré
    // qu'une seule fois par boutique. On ignore les valeurs vides (champ facultatif).
    // La collection `clients` est globale et isolée par `registeredStoreId` ⇒ on filtre
    // sur les deux champs (deux égalités → aucun index composite requis).
    const agentCode = String(clientData?.orange ?? '').trim()
    if (agentCode) {
      const existing = await this.getCollection(
        FIRESTORE_CONFIG.COLLECTIONS.CLIENTS,
        {
          where: [
            { field: 'orange', operator: '==', value: agentCode },
            { field: 'registeredStoreId', operator: '==', value: activeStore.id },
          ],
          limitCount: 1,
        },
        false, // pas de cache : on veut l'état réel avant écriture
      )
      if (existing.length > 0) {
        throw new Error('Un client avec ce numéro/code agent existe déjà dans cette boutique.')
      }
    }

    // Les champs d'appartenance à la boutique sont toujours imposés par le service
    // (jamais hérités des données du formulaire) pour aligner avec la règle Firestore :
    //   allow create: if ... request.resource.data.registeredStoreId == profile().storeId
    return this.addDocument(FIRESTORE_CONFIG.COLLECTIONS.CLIENTS, {
      ...clientData,
      // On stocke le numéro/code agent normalisé (trim) pour que l'anti-doublon
      // ci-dessus, qui compare la valeur trimmée, reste fiable dans le temps.
      ...(clientData?.orange !== undefined ? { orange: agentCode } : {}),
      registeredStoreId: activeStore.id,
      registeredStoreName: activeStore.name,
      dateAjout: new Date().toLocaleDateString('fr-FR')
    })
  }

  async updateClient(clientId, updates) {
    this.requireActiveStore()
    return this.updateDocument(FIRESTORE_CONFIG.COLLECTIONS.CLIENTS, clientId, updates)
  }

  async deleteClient(clientId) {
    return this.deleteDocument(FIRESTORE_CONFIG.COLLECTIONS.CLIENTS, clientId)
  }

  subscribeToClients(callback) {
    // Version simplifiée qui bypasse le système complexe
    this.requireActiveStore()
    const collectionRef = this.collectionRef(FIRESTORE_CONFIG.COLLECTIONS.CLIENTS)

    return onSnapshot(collectionRef,
      (snapshot) => {
        try {
          const documents = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }))

          callback(documents)
        } catch (error) {
          console.error('Clients snapshot processing error:', error)
        }
      },
      (error) => {
        console.error('Clients subscription error:', error)
      }
    )
  }

  // DRAFTS (Transactions non terminées) — délèguent à DraftService

  async getDrafts() {
    return this._draftService.getDrafts()
  }

  async addDraft(transactionData) {
    return this._draftService.addDraft(transactionData)
  }

  async updateDraft(draftId, updates) {
    return this._draftService.updateDraft(draftId, updates)
  }

  async deleteDraft(draftId) {
    return this._draftService.deleteDraft(draftId)
  }

  subscribeToDrafts(callback) {
    return this._draftService.subscribeToDrafts(callback)
  }

  // HISTORY (Transactions terminées) — délèguent à HistoryService

  async getHistory() {
    return this._historyService.getHistory()
  }

  async addToHistory(transactionData) {
    return this._historyService.addToHistory(transactionData)
  }

  async addTransaction(transactionData) {
    return this._draftService.addTransaction(transactionData)
  }

  async deleteFromHistory(historyId) {
    return this._historyService.deleteFromHistory(historyId)
  }

  subscribeToHistory(callback, filters = {}) {
    return this._historyService.subscribeToHistory(callback, filters)
  }

  // Helper pour mapper les méthodes de paiement aux réseaux
  mapPaymentMethodToNetwork(paymentMethod) {
    return _mapPaymentMethodToNetworkFn(paymentMethod)
  }

  // VALIDATION DE TRANSACTION (Drafts → History) — délègue à DraftService
  async validateTransaction(draftId, customStatus = 'Validée', selectedPaymentMethod = null, amountOverride = null) {
    return this._draftService.validateTransaction(draftId, customStatus, selectedPaymentMethod, amountOverride)
  }

  // MIGRATION DES DONNÉES LOCALSTORAGE
  async migrateLocalStorageData(localStorageData) {
    try {
      const { clients = [], pendingTransactions = [], completedTransactions = [] } = localStorageData

      // Migrer les clients d'abord
      const migratedClients = []
      for (const client of clients) {
        const addedClient = await this.addClient(client)
        migratedClients.push(addedClient)
      }

      // Helper pour corriger les transactions sans clientId
      const fixTransactionClientId = (transaction) => {
        // Si la transaction a déjà un clientId valide, on la garde
        if (transaction.clientId) {
          return transaction
        }

        // Sinon, essayer de trouver le client par nom/prénom
        if (transaction.client) {
          const matchingClient = migratedClients.find(c =>
            c.nom === transaction.client.nom &&
            c.prenom === transaction.client.prenom
          )

          if (matchingClient) {
            return {
              ...transaction,
              clientId: matchingClient.id,
              client: matchingClient
            }
          }
        }

        // Si on ne peut pas associer un clientId, on ignore cette transaction
        console.warn('Transaction ignorée - impossible de déterminer clientId:', transaction)
        return null
      }

      // Migrer les transactions en attente vers drafts
      for (const transaction of pendingTransactions) {
        const fixedTransaction = fixTransactionClientId(transaction)
        if (fixedTransaction) {
          const validatedAmount = parseFcfaAmount(fixedTransaction.montant)
          if (validatedAmount === null) {
            console.warn('Migration : transaction ignorée — montant FCFA invalide :', fixedTransaction)
            continue
          }
          await this.addDraft({ ...fixedTransaction, montant: validatedAmount })
        }
      }

      // Migrer les transactions terminées vers history
      for (const transaction of completedTransactions) {
        const fixedTransaction = fixTransactionClientId(transaction)
        if (fixedTransaction) {
          const validatedAmount = parseFcfaAmount(fixedTransaction.montant)
          if (validatedAmount === null) {
            console.warn('Migration : transaction ignorée — montant FCFA invalide :', fixedTransaction)
            continue
          }
          await this.addToHistory({ ...fixedTransaction, montant: validatedAmount })
        }
      }

      return true
    } catch (error) {
      console.error('Data migration failed:', error.message)
      throw error
    }
  }
}

// Instance singleton du service
export const firestoreService = new FirestoreService()

// Exports de fonctions spécialisées pour faciliter l'utilisation
export const {
  getClients,
  addClient,
  updateClient,
  deleteClient,
  subscribeToClients,
  getDrafts,
  addDraft,
  updateDraft,
  deleteDraft,
  subscribeToDrafts,
  getHistory,
  addToHistory,
  deleteFromHistory,
  subscribeToHistory,
  validateTransaction,
  migrateLocalStorageData,
  unsubscribeAll,
  unsubscribeFromCollection
} = firestoreService
