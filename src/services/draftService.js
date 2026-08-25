/**
 * draftService.js — Orchestration Firestore des transactions brouillons (drafts)
 *
 * Ce module contient toute la logique Firestore spécifique aux drafts :
 * - Création d'une transaction (addTransaction)
 * - Création d'un brouillon (addDraft)
 * - Mise à jour d'un brouillon avec recalcul des soldes (updateDraft)
 * - Suppression d'un brouillon avec inversion des soldes (deleteDraft)
 * - Abonnement temps réel aux brouillons (subscribeToDrafts)
 * - Lecture des brouillons (getDrafts)
 * - Validation d'un brouillon vers l'historique (validateTransaction)
 *
 * Ce service ne contient pas de logique métier pure : il délègue
 * aux modules financialImpact.js et draftLifecycle.js.
 *
 * Injection de dépendances :
 *   Le constructeur reçoit toutes ses dépendances explicitement afin
 *   d'éviter les imports circulaires et les singletons cachés.
 */

import {
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp
} from 'firebase/firestore'
import { db } from '../config/firebase'
import { getUserFriendlyMessage } from '../utils/errorHandler'
import { formatDateToFrench } from '../utils/helpers'
import { FIRESTORE_CONFIG } from '../constants/firestoreConstants'
import {
  validateFcfaAmount,
  normalizeNetworkBalances,
  isPendingStatus,
  mapPaymentMethodToNetwork,
  getSettlementActionFromStatus,
  validateSettlementAction,
  applyInitialTransactionImpact,
  reverseInitialTransactionImpact,
  applySettlementImpact
} from '../utils/financialImpact.js'
import { parseFcfaAmount } from '../utils/fcfaAmount.js'
import { buildDraftPayload, computeDraftUpdateImpacts } from '../utils/draftLifecycle.js'

export class DraftService {
  /**
   * @param {object} deps - Dépendances injectées
   * @param {object} deps.ctx - Objet contexte portant les méthodes (FirestoreService ou mock).
   *   Les méthodes sont appelées via deps.ctx.method() afin que les spies posés sur le
   *   contexte après construction soient honorés (pas de bind anticipé).
   *
   * Méthodes attendues sur ctx :
   *   requireActiveStore()       → activeStore | throws
   *   getNetworkBalanceDocRef()  → DocumentReference
   *   collectionRef(name)        → CollectionReference
   *   docRef(name, id)           → DocumentReference
   *   getCollection(name, opts?) → Promise<docs[]>
   *   addDocument(name, data)    → Promise<doc>
   */
  constructor(deps) {
    // Stocker le contexte vivant (pas de bind anticipé) pour que les spies
    // posés sur le contexte après construction soient honorés.
    this._ctx = deps.ctx
  }

  _requireActiveStore() { return this._ctx.requireActiveStore() }
  _getNetworkBalanceDocRef() { return this._ctx.getNetworkBalanceDocRef() }
  _collectionRef(name) { return this._ctx.collectionRef(name) }
  _docRef(name, id) { return this._ctx.docRef(name, id) }
  async _getCollection(name, opts) { return this._ctx.getCollection(name, opts) }
  async _addDocument(name, data) { return this._ctx.addDocument(name, data) }

  // ---------------------------------------------------------------------------
  // getDrafts
  // ---------------------------------------------------------------------------

  async getDrafts() {
    return this._getCollection(FIRESTORE_CONFIG.COLLECTIONS.DRAFTS)
  }

  // ---------------------------------------------------------------------------
  // addDraft
  // ---------------------------------------------------------------------------

  async addDraft(transactionData) {
    const parsedAmount = parseFcfaAmount(transactionData.montant)
    if (parsedAmount === null) {
      throw new Error(
        `Montant FCFA invalide dans addDraft : ${JSON.stringify(transactionData.montant)}. ` +
        'Le montant doit être un entier strictement positif.'
      )
    }
    return this._addDocument(FIRESTORE_CONFIG.COLLECTIONS.DRAFTS, {
      ...transactionData,
      montant: parsedAmount,
      statut: FIRESTORE_CONFIG.STATUS.PENDING,
      date: formatDateToFrench()
    })
  }

  // ---------------------------------------------------------------------------
  // updateDraft
  // ---------------------------------------------------------------------------

  async updateDraft(draftId, updates) {
    let normalizedUpdates = updates
    if (updates.montant !== undefined) {
      const parsedAmount = validateFcfaAmount(updates.montant, 'updateDraft')
      normalizedUpdates = {
        ...updates,
        montant: parsedAmount
      }
    }
    return runTransaction(db, async (tx) => {
      const draftRef = this._docRef(FIRESTORE_CONFIG.COLLECTIONS.DRAFTS, draftId)
      const draftSnap = await tx.get(draftRef)

      if (!draftSnap.exists()) {
        throw new Error('Transaction introuvable')
      }

      const currentDraft = draftSnap.data()
      const balanceRef = this._getNetworkBalanceDocRef()
      const balanceSnap = await tx.get(balanceRef)
      const currentBalances = normalizeNetworkBalances(balanceSnap.exists() ? balanceSnap.data() : {})
      const nextDraft = buildDraftPayload(currentDraft, normalizedUpdates)
      const { nextBalances } = computeDraftUpdateImpacts(currentDraft, nextDraft, currentBalances)
      const now = serverTimestamp()

      tx.update(draftRef, {
        ...normalizedUpdates,
        statut: FIRESTORE_CONFIG.STATUS.PENDING,
        updatedAt: now
      })
      tx.set(balanceRef, {
        balances: nextBalances,
        updatedAt: now
      }, { merge: true })

      return { id: draftId, ...nextDraft }
    })
  }

  // ---------------------------------------------------------------------------
  // deleteDraft
  // ---------------------------------------------------------------------------

  async deleteDraft(draftId) {
    return runTransaction(db, async (tx) => {
      const draftRef = this._docRef(FIRESTORE_CONFIG.COLLECTIONS.DRAFTS, draftId)
      const draftSnap = await tx.get(draftRef)

      if (!draftSnap.exists()) {
        return false
      }

      const balanceRef = this._getNetworkBalanceDocRef()
      const balanceSnap = await tx.get(balanceRef)
      const currentBalances = normalizeNetworkBalances(balanceSnap.exists() ? balanceSnap.data() : {})
      const nextBalances = reverseInitialTransactionImpact(currentBalances, draftSnap.data())
      const now = serverTimestamp()

      tx.delete(draftRef)
      tx.set(balanceRef, {
        balances: nextBalances,
        updatedAt: now
      }, { merge: true })

      return true
    })
  }

  // ---------------------------------------------------------------------------
  // subscribeToDrafts
  // ---------------------------------------------------------------------------

  subscribeToDrafts(callback) {
    const collectionRef = this._collectionRef(FIRESTORE_CONFIG.COLLECTIONS.DRAFTS)

    return onSnapshot(collectionRef,
      (snapshot) => {
        try {
          const documents = snapshot.docs.map(d => ({
            id: d.id,
            ...d.data()
          }))
          callback(documents)
        } catch (error) {
          console.error('Drafts snapshot processing error:', error)
        }
      },
      (error) => {
        console.error('Drafts subscription error:', error)
      }
    )
  }

  // ---------------------------------------------------------------------------
  // addTransaction
  // ---------------------------------------------------------------------------

  async addTransaction(transactionData) {
    this._requireActiveStore()
    const parsedAmount = validateFcfaAmount(transactionData.montant, 'addTransaction')
    const normalizedTransactionData = {
      ...transactionData,
      montant: parsedAmount
    }

    try {
      return await runTransaction(db, async (tx) => {
        const balanceRef = this._getNetworkBalanceDocRef()
        const balanceSnap = await tx.get(balanceRef)
        const currentBalances = normalizeNetworkBalances(balanceSnap.exists() ? balanceSnap.data() : {})
        const nextBalances = applyInitialTransactionImpact(currentBalances, normalizedTransactionData)
        const targetCollection = isPendingStatus(normalizedTransactionData.statut)
          ? FIRESTORE_CONFIG.COLLECTIONS.DRAFTS
          : FIRESTORE_CONFIG.COLLECTIONS.HISTORY
        const transactionRef = doc(this._collectionRef(targetCollection))
        const now = serverTimestamp()
        const transactionPayload = {
          ...normalizedTransactionData,
          date: formatDateToFrench(),
          createdAt: now,
          updatedAt: now
        }

        tx.set(transactionRef, transactionPayload)
        tx.set(balanceRef, {
          balances: nextBalances,
          updatedAt: now
        }, { merge: true })

        return { id: transactionRef.id, ...transactionPayload }
      })
    } catch (error) {
      const friendlyMessage = getUserFriendlyMessage(error)
      const enhancedError = new Error(friendlyMessage)
      enhancedError.originalError = error
      throw enhancedError
    }
  }

  // ---------------------------------------------------------------------------
  // validateTransaction
  // ---------------------------------------------------------------------------

  async validateTransaction(draftId, customStatus = 'Validée', selectedPaymentMethod = null, amountOverride = null) {
    try {
      this._requireActiveStore()

      // 1. Récupérer la transaction draft directement par ID
      const draftDocRef = this._docRef(FIRESTORE_CONFIG.COLLECTIONS.DRAFTS, draftId)
      const draftDoc = await getDoc(draftDocRef)

      if (!draftDoc.exists()) {
        console.warn(`Transaction draft ${draftId} n'existe pas ou a déjà été supprimée`)
        return false
      }

      const transactionData = draftDoc.data()

      // 2. Vérifier que les données sont valides avant de les ajouter à l'historique
      if (!transactionData.clientId || !transactionData.type || !transactionData.montant) {
        console.warn(`Transaction draft ${draftId} a des données incomplètes:`, transactionData)
        return false
      }

      // 2b. Valider le montant FCFA (entier strictement positif)
      validateFcfaAmount(transactionData.montant, 'validateTransaction')

      // 2c. Valider le montant de règlement si fourni
      if (amountOverride !== null) {
        validateFcfaAmount(amountOverride, 'validateTransaction.amountOverride')
      }

      // 3. Extraire la méthode de paiement du statut si pas fournie explicitement
      let effectivePaymentMethod = selectedPaymentMethod
      if (!effectivePaymentMethod && customStatus !== 'Validée') {
        // Extraire de "Payé par Orange Money" => "Orange Money"
        const match = customStatus.match(/(?:Payé|Remboursé|Encaissé) par (.+)$/)
        if (match) {
          effectivePaymentMethod = match[1]
        }
      }

      const settlementAction = getSettlementActionFromStatus(customStatus)
      const effectiveNetworkMapped = effectivePaymentMethod ? mapPaymentMethodToNetwork(effectivePaymentMethod) : transactionData.reseau
      return await runTransaction(db, async (tx) => {
        const lockedDraftDoc = await tx.get(draftDocRef)

        if (!lockedDraftDoc.exists()) {
          return false
        }

        const lockedTransactionData = lockedDraftDoc.data()
        validateSettlementAction(lockedTransactionData.type, settlementAction)
        const balanceRef = this._getNetworkBalanceDocRef()
        const balanceSnap = await tx.get(balanceRef)
        const currentBalances = normalizeNetworkBalances(balanceSnap.exists() ? balanceSnap.data() : {})

        // Montant effectif de règlement (peut différer du montant d'origine)
        const effectiveAmount = amountOverride !== null ? amountOverride : lockedTransactionData.montant
        const dataForImpact = { ...lockedTransactionData, montant: effectiveAmount }

        const nextBalances = effectivePaymentMethod
          ? applySettlementImpact(currentBalances, dataForImpact, effectivePaymentMethod)
          : currentBalances
        const now = serverTimestamp()
        const historyData = {
          ...lockedTransactionData,
          statut: customStatus,
          paymentMethod: effectivePaymentMethod,
          effectiveNetwork: effectiveNetworkMapped,
          settlementAmount: effectiveAmount,
          // Champs de règlement pour cohérence historique (paiement unique complet)
          originalAmount:   lockedTransactionData.montant,
          paidAmount:       effectiveAmount,
          refundedAmount:   0,
          remainingAmount:  0,
          settlementStatus: 'settled',
          settlementUpdatedAt: now,
          validatedAt: now,
          updatedAt: now
        }

        const historyRef = doc(this._collectionRef(FIRESTORE_CONFIG.COLLECTIONS.HISTORY))
        tx.set(historyRef, historyData)
        tx.delete(draftDocRef)
        tx.set(balanceRef, {
          balances: nextBalances,
          updatedAt: now
        }, { merge: true })

        return true
      })
    } catch (error) {
      console.error('Transaction validation error:', error)
      const friendlyMessage = getUserFriendlyMessage(error)
      const enhancedError = new Error(friendlyMessage)
      enhancedError.originalError = error
      throw enhancedError
    }
  }
}
