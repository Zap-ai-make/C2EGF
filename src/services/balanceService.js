/**
 * balanceService.js — Orchestration Firestore des soldes réseau (networkBalances)
 *
 * Ce module contient toute la logique Firestore spécifique aux soldes réseau :
 * - Obtention de la référence du document networkBalances/current (getNetworkBalanceDocRef)
 * - Initialisation garantie du document (ensureNetworkBalances)
 * - Écriture atomique d'un champ de solde (setNetworkBalance)
 * - Abonnement temps réel aux soldes (subscribeToNetworkBalances)
 * - Écriture batch des soldes (setNetworkBalances)
 *
 * Ce module ne contient pas de logique métier pure (formules financières) :
 * il délègue la normalisation à financialImpact.js via le contexte injecté.
 *
 * Injection de dépendances :
 *   Le constructeur reçoit toutes ses dépendances explicitement afin
 *   d'éviter les imports circulaires et les singletons cachés.
 *
 * Méthodes attendues sur ctx :
 *   requireActiveStore()                   → activeStore | throws
 *   docRef(collectionName, docId)          → DocumentReference
 *   normalizeNetworkBalances(data)         → object
 */

import {
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc
} from 'firebase/firestore'
import { db } from '../config/firebase'
import { FIRESTORE_CONFIG } from '../constants/firestoreConstants'

const CURRENT_BALANCE_DOC_ID = 'current'

export class BalanceService {
  /**
   * @param {object} deps - Dépendances injectées
   * @param {object} deps.ctx - Objet contexte portant les méthodes (FirestoreService ou mock).
   *   Les méthodes sont appelées via deps.ctx.method() afin que les spies posés sur le
   *   contexte après construction soient honorés (pas de bind anticipé).
   *
   * Méthodes attendues sur ctx :
   *   requireActiveStore()                   → activeStore | throws
   *   docRef(collectionName, docId)          → DocumentReference
   *   normalizeNetworkBalances(data)         → object
   */
  constructor(deps) {
    // Stocker le contexte vivant (pas de bind anticipé) pour que les spies
    // posés sur le contexte après construction soient honorés.
    this._ctx = deps.ctx
  }

  // ---------------------------------------------------------------------------
  // getNetworkBalanceDocRef
  // ---------------------------------------------------------------------------

  /**
   * Retourne la DocumentReference vers clients/{activeStore.id}/networkBalances/current.
   * Appelle requireActiveStore() pour garantir qu'une boutique est active — même
   * comportement que l'implémentation originale dans FirestoreService.
   *
   * @returns {import('firebase/firestore').DocumentReference}
   */
  getNetworkBalanceDocRef() {
    this._ctx.requireActiveStore()
    return this._ctx.docRef(FIRESTORE_CONFIG.COLLECTIONS.NETWORK_BALANCES, CURRENT_BALANCE_DOC_ID)
  }

  // ---------------------------------------------------------------------------
  // ensureNetworkBalances
  // ---------------------------------------------------------------------------

  /**
   * Garantit l'existence du document networkBalances/current.
   * Si le document est absent, le crée avec les balances initiales normalisées.
   * Si le document existe, retourne les balances normalisées existantes sans écriture.
   *
   * @param {object} [initialBalances={}] - Balances initiales si le document est absent
   * @returns {Promise<object>} Balances normalisées (existantes ou nouvellement créées)
   */
  async ensureNetworkBalances(initialBalances) {
    return runTransaction(db, async (tx) => {
      const balanceRef = this.getNetworkBalanceDocRef()
      const balanceSnap = await tx.get(balanceRef)

      if (balanceSnap.exists()) {
        return this._ctx.normalizeNetworkBalances(balanceSnap.data())
      }

      const normalizedBalances = this._ctx.normalizeNetworkBalances(initialBalances)
      tx.set(balanceRef, {
        balances: normalizedBalances,
        updatedAt: serverTimestamp()
      })

      return normalizedBalances
    })
  }

  // ---------------------------------------------------------------------------
  // setNetworkBalance
  // ---------------------------------------------------------------------------

  /**
   * Écrit atomiquement un champ (stock ou liquidite) pour un réseau donné.
   * Lit les balances courantes, applique la mise à jour, et écrit en merge.
   *
   * @param {string} network - Nom du réseau (ex: 'Orange')
   * @param {string} type - Champ à mettre à jour ('stock' ou 'liquidite')
   * @param {number} amount - Valeur à écrire (ramenée à 0 si négative)
   * @returns {Promise<object>} Nouvelles balances complètes
   */
  async setNetworkBalance(network, type, amount) {
    return runTransaction(db, async (tx) => {
      const balanceRef = this.getNetworkBalanceDocRef()
      const balanceSnap = await tx.get(balanceRef)
      const currentBalances = this._ctx.normalizeNetworkBalances(
        balanceSnap.exists() ? balanceSnap.data() : {}
      )
      const nextBalances = {
        ...currentBalances,
        [network]: {
          ...(currentBalances[network] || { stock: 0, liquidite: 0 }),
          [type]: Math.max(0, Number(amount) || 0)
        }
      }

      tx.set(balanceRef, {
        balances: nextBalances,
        updatedAt: serverTimestamp()
      }, { merge: true })

      return nextBalances
    })
  }

  // ---------------------------------------------------------------------------
  // subscribeToNetworkBalances
  // ---------------------------------------------------------------------------

  /**
   * Abonne un callback aux changements du document networkBalances/current.
   * Le callback reçoit les balances normalisées à chaque mise à jour.
   * Si le document est absent, le callback reçoit des balances vides normalisées.
   * Les erreurs de snapshot sont loggées sans propagation.
   *
   * @param {function} callback - Fonction appelée avec les balances normalisées
   * @returns {function} Fonction de désabonnement
   */
  subscribeToNetworkBalances(callback) {
    return onSnapshot(
      this.getNetworkBalanceDocRef(),
      (snapshot) => {
        callback(this._ctx.normalizeNetworkBalances(snapshot.exists() ? snapshot.data() : {}))
      },
      (error) => {
        console.error('Network balances subscription error:', error)
      }
    )
  }

  // ---------------------------------------------------------------------------
  // setNetworkBalances
  // ---------------------------------------------------------------------------

  /**
   * Écrit les balances complètes en merge (setDoc avec { merge: true }).
   * Normalise les balances avant l'écriture.
   * Ajoute updatedAt avec serverTimestamp.
   *
   * @param {object} balances - Balances à écrire (normalisées automatiquement)
   * @returns {Promise<object>} Balances normalisées écrites
   */
  async setNetworkBalances(balances) {
    const normalizedBalances = this._ctx.normalizeNetworkBalances(balances)

    await setDoc(this.getNetworkBalanceDocRef(), {
      balances: normalizedBalances,
      updatedAt: serverTimestamp()
    }, { merge: true })

    return normalizedBalances
  }
}
