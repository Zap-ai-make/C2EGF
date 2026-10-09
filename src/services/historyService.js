/**
 * historyService.js — Orchestration Firestore des transactions historique
 *
 * Ce module contient toute la logique Firestore spécifique à l'historique :
 * - Ajout d'une transaction à l'historique (addToHistory)
 * - Suppression (soft-delete) avec inversion des soldes (deleteFromHistory)
 * - Abonnement temps réel à l'historique (subscribeToHistory)
 * - Lecture de l'historique (getHistory)
 *
 * Ce service ne contient pas de logique métier pure : il délègue
 * aux modules financialImpact.js (via le contexte).
 *
 * Injection de dépendances :
 *   Le constructeur reçoit toutes ses dépendances explicitement afin
 *   d'éviter les imports circulaires et les singletons cachés.
 *
 * Méthodes attendues sur ctx :
 *   requireActiveStore()                        → activeStore | throws
 *   getNetworkBalanceDocRef()                   → DocumentReference
 *   docRef(name, id)                            → DocumentReference
 *   addDocument(name, data)                     → Promise<doc>
 *   getCollection(name, opts?)                  → Promise<docs[]>
 *   subscribeToCollection(name, cb, opts)       → unsubscribe fn
 *   normalizeTransactionLabel(value)            → string
 *   normalizeNetworkBalances(data)              → object
 *   reverseHistoryTransactionImpact(balances, historyData) → object
 *   _validateFcfaAmount(raw, context)           → number | throws
 */

import {
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
} from 'firebase/firestore'
import { db } from '../config/firebase'
import { getUserFriendlyMessage } from '../utils/errorHandler'
import { formatDateToFrench } from '../utils/helpers'
import { FIRESTORE_CONFIG } from '../constants/firestoreConstants'
import { parseFcfaAmount } from '../utils/fcfaAmount.js'

export const HISTORY_PAGE_SIZE = 100

export class HistoryService {
  /**
   * @param {object} deps - Dépendances injectées
   * @param {object} deps.ctx - Objet contexte portant les méthodes (FirestoreService ou mock).
   *   Les méthodes sont appelées via deps.ctx.method() afin que les spies posés sur le
   *   contexte après construction soient honorés (pas de bind anticipé).
   */
  constructor(deps) {
    // Stocker le contexte vivant (pas de bind anticipé) pour que les spies
    // posés sur le contexte après construction soient honorés.
    this._ctx = deps.ctx
  }

  _requireActiveStore() { return this._ctx.requireActiveStore() }
  _getNetworkBalanceDocRef() { return this._ctx.getNetworkBalanceDocRef() }
  _docRef(name, id) { return this._ctx.docRef(name, id) }
  async _addDocument(name, data) { return this._ctx.addDocument(name, data) }
  async _getCollection(name, opts) { return this._ctx.getCollection(name, opts) }
  _collectionRef(name) { return this._ctx.collectionRef(name) }
  _subscribeToCollection(name, cb, opts) { return this._ctx.subscribeToCollection(name, cb, opts) }
  _normalizeTransactionLabel(value) { return this._ctx.normalizeTransactionLabel(value) }
  _normalizeNetworkBalances(data) { return this._ctx.normalizeNetworkBalances(data) }
  _reverseHistoryTransactionImpact(balances, historyData) { return this._ctx.reverseHistoryTransactionImpact(balances, historyData) }
  _validateFcfaAmount(raw, context) { return this._ctx._validateFcfaAmount(raw, context) }

  // ---------------------------------------------------------------------------
  // getHistory
  // ---------------------------------------------------------------------------

  async getHistory() {
    return this._getCollection(FIRESTORE_CONFIG.COLLECTIONS.HISTORY)
  }

  async getHistoryPage({ lastDoc = null, pageSize = HISTORY_PAGE_SIZE } = {}) {
    this._requireActiveStore()
    const safePageSize = Number.isSafeInteger(pageSize) && pageSize > 0
      ? pageSize
      : HISTORY_PAGE_SIZE
    const constraints = [
      orderBy('createdAt', 'desc'),
    ]
    if (lastDoc) constraints.push(startAfter(lastDoc))
    constraints.push(limit(safePageSize + 1))

    const snapshot = await getDocs(query(
      this._collectionRef(FIRESTORE_CONFIG.COLLECTIONS.HISTORY),
      ...constraints,
    ))
    const pageDocs = snapshot.docs.slice(0, safePageSize)
    return {
      transactions: pageDocs.map((doc) => ({ id: doc.id, ...doc.data() })),
      lastDoc: pageDocs.at(-1) ?? null,
      hasMore: snapshot.docs.length > safePageSize,
    }
  }

  // ---------------------------------------------------------------------------
  // addToHistory
  // ---------------------------------------------------------------------------

  async addToHistory(transactionData) {
    this._validateFcfaAmount(transactionData.montant, 'addToHistory')
    const parsedAmount = parseFcfaAmount(transactionData.montant)
    return this._addDocument(FIRESTORE_CONFIG.COLLECTIONS.HISTORY, {
      ...transactionData,
      montant: parsedAmount,
      date: formatDateToFrench()
    })
  }

  // ---------------------------------------------------------------------------
  // deleteFromHistory
  // ---------------------------------------------------------------------------

  async deleteFromHistory(historyId) {
    this._requireActiveStore()
    try {
      return await runTransaction(db, async (tx) => {
        const historyRef = this._docRef(FIRESTORE_CONFIG.COLLECTIONS.HISTORY, historyId)
        const historySnap = await tx.get(historyRef)

        if (!historySnap.exists()) {
          throw new Error(`Transaction ${historyId} introuvable`)
        }

        const historyData = historySnap.data()

        if (this._normalizeTransactionLabel(historyData.statut) === this._normalizeTransactionLabel(FIRESTORE_CONFIG.STATUS.CANCELLED)) {
          return false
        }

        const balanceRef = this._getNetworkBalanceDocRef()
        const balanceSnap = await tx.get(balanceRef)

        if (!balanceSnap.exists()) {
          throw new Error('Impossible de lire networkBalances/current : document absent. Le renversement est annulé.')
        }
        const rawBalances = balanceSnap.data()
        const currentBalances = this._normalizeNetworkBalances(rawBalances)
        if (!currentBalances || typeof currentBalances !== 'object' || Array.isArray(currentBalances) || Object.keys(currentBalances).length === 0) {
          throw new Error('Données de soldes invalides ou absentes. Le renversement est annulé.')
        }

        const nextBalances = this._reverseHistoryTransactionImpact(currentBalances, historyData)
        const now = serverTimestamp()

        tx.update(historyRef, {
          statut: FIRESTORE_CONFIG.STATUS.CANCELLED,
          updatedAt: now,
        })
        tx.set(balanceRef, {
          balances: nextBalances,
          updatedAt: now,
        }, { merge: true })

        return true
      })
    } catch (error) {
      const friendlyMessage = getUserFriendlyMessage(error)
      const enhancedError = new Error(friendlyMessage)
      enhancedError.originalError = error
      throw enhancedError
    }
  }

  // ---------------------------------------------------------------------------
  // subscribeToHistory
  // ---------------------------------------------------------------------------

  subscribeToHistory(callback, filters = {}) {
    this._requireActiveStore()

    // collectionRef(history) pointe déjà sur clients/{activeStore}/history :
    // le chemin isole la boutique et inclut les anciennes lignes sans storeId.
    const whereClause = []

    if (filters.clientId) {
      whereClause.push({ field: 'clientId', operator: '==', value: filters.clientId })
    }

    if (filters.dateRange) {
      if (filters.dateRange.start) {
        whereClause.push({ field: 'createdAt', operator: '>=', value: filters.dateRange.start })
      }
      if (filters.dateRange.end) {
        whereClause.push({ field: 'createdAt', operator: '<=', value: filters.dateRange.end })
      }
      if (filters.dateRange.endExclusive) {
        whereClause.push({ field: 'createdAt', operator: '<', value: filters.dateRange.endExclusive })
      }
    }

    return this._subscribeToCollection(
      FIRESTORE_CONFIG.COLLECTIONS.HISTORY,
      callback,
      {
        where: whereClause,
        orderByField: 'createdAt',
        orderDirection: 'desc',
        ...(filters.limitCount === null
          ? {}
          : { limitCount: filters.limitCount ?? HISTORY_PAGE_SIZE }),
      }
    )
  }

  /**
   * Les ravitaillements encore dus — TOUS, et non ceux de la page chargée.
   *
   * POURQUOI UNE ÉCOUTE À PART
   * ──────────────────────
   * `subscribeToHistory` sert une FENÊTRE : les 100 dernières lignes, plus la
   * journée en cours. C'est la bonne réponse pour relire l'historique, et la
   * mauvaise pour une DETTE : une livraison reçue il y a trois semaines sort de
   * la fenêtre dès que cent opérations ont suivi, et la boutique lisait alors
   * « Rien à rendre pour le moment » en devant encore de l'argent. Un montant dû
   * ne se périme pas avec la pagination.
   *
   * ⚠ NI TRI NI LIMITE, ET C'EST VOLONTAIRE. Un filtre d'égalité seul se sert
   *   de l'index automatique de Firestore ; y ajouter `orderBy('createdAt')`
   *   exigerait un index composite — donc un déploiement — pour trier une
   *   poignée de lignes que `ravitaillementsEnCours` reclasse déjà en mémoire.
   *
   * Le statut est écrit par le serveur dès la création (`replenishmentStatus:
   * 'open'`) et repasse à `settled` au dernier retour : la ligne quitte alors
   * cette écoute d'elle-même.
   */
  subscribeToOpenReplenishments(callback) {
    this._requireActiveStore()

    return this._subscribeToCollection(
      FIRESTORE_CONFIG.COLLECTIONS.HISTORY,
      callback,
      { where: [{ field: 'replenishmentStatus', operator: '==', value: 'open' }] },
    )
  }
}
