import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { getTransactionStyles, getAvailableActions, isDraftSettling, parsefrenchDate } from '../utils/helpers.js'
import { STORAGE_KEYS } from '../constants/index.js'
import { FIRESTORE_CONFIG } from '../constants/firestoreConstants.js'
import { firestoreService } from '../services/firestore'
import { addTransactionPayment, addTransactionRefund } from '../services/settlementService'
import { AuthContext } from './AuthContext'
import {
  businessDateKey,
  getBusinessDayBounds,
  millisecondsUntilNextBusinessDay,
} from '../utils/businessDate.js'
import { TYPE_RETOUR } from '../utils/ravitaillement.js'

// Exporté comme ClientsContext : permet de fournir une valeur sans monter le
// provider réel (bancs d'essai, tests de rendu) — cf. src/preview.jsx.
export const TransactionsContext = createContext()

/**
 * Horodatage (ms) d'un élément d'historique pour le tri décroissant.
 * Priorité au Timestamp Firestore `createdAt` ; repli sur la date FR `date`
 * ("DD/MM/YYYY HH:mm"). On ne dépend d'aucun orderBy Firestore (le service
 * n'en pose pas volontairement, pour inclure TOUS les éléments).
 */
const historyTimestamp = (item) => {
  if (item?.createdAt?.toMillis) return item.createdAt.toMillis()
  if (item?.createdAt) {
    const t = new Date(item.createdAt).getTime()
    if (!Number.isNaN(t)) return t
  }
  const parsed = parsefrenchDate(item?.date)
  return parsed ? parsed.getTime() : 0
}

/** Tri décroissant (le dernier enregistré en haut). Exporté pour test. */
export const sortHistoryDesc = (list) =>
  [...list].sort((a, b) => historyTimestamp(b) - historyTimestamp(a))

export const mergeHistoryPages = (...lists) => {
  const byId = new Map()
  for (const list of lists) {
    for (const item of list ?? []) {
      if (item?.id) byId.set(item.id, item)
    }
  }
  return sortHistoryDesc([...byId.values()])
}

export const useTransactions = () => {
  const context = useContext(TransactionsContext)
  if (!context) {
    throw new Error('useTransactions must be used within a TransactionsProvider')
  }
  return context
}

export const TransactionsProvider = ({ children }) => {
  const { currentUser: user, userProfile, activeStore, loading: authLoading } = useContext(AuthContext)

  // États pour les deux collections Firestore
  const [pendingTransactions, setPendingTransactions] = useState([])
  const [completedTransactions, setCompletedTransactions] = useState([])
  const [historyHasMore, setHistoryHasMore] = useState(false)
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false)
  const [editingTransaction, setEditingTransaction] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const liveHistoryRef = useRef([])
  const todayHistoryRef = useRef([])
  const archiveHistoryRef = useRef([])
  const historyCursorRef = useRef(null)

  const publishHistory = useCallback(() => {
    setCompletedTransactions(mergeHistoryPages(
      archiveHistoryRef.current,
      liveHistoryRef.current,
      todayHistoryRef.current,
    ))
  }, [])

  // Synchronisation temps réel avec Firestore pour les deux collections - seulement si authentifié
  useEffect(() => {
    liveHistoryRef.current = []
    todayHistoryRef.current = []
    archiveHistoryRef.current = []
    historyCursorRef.current = null
    setHistoryLoadingMore(false)

    // Ne pas initialiser si l'auth est encore en cours de chargement
    if (authLoading) {
      return
    }

    // Si pas d'utilisateur connecté, ne pas essayer de charger depuis Firestore
    if (!user || !userProfile?.storeId || activeStore?.id !== userProfile.storeId) {
      setPendingTransactions([])
      setCompletedTransactions([])
      setHistoryHasMore(false)
      setLoading(false)
      return
    }

    let isMounted = true
    let unsubscribeDrafts, unsubscribeHistory, unsubscribeToday, rolloverTimeout

    const initializeTransactions = async () => {
      try {
        setLoading(true)
        setError(null)

        // Vérifier s'il y a des données localStorage à migrer
        const pendingData = localStorage.getItem(STORAGE_KEYS.PENDING_TRANSACTIONS)
        const completedData = localStorage.getItem(STORAGE_KEYS.COMPLETED_TRANSACTIONS)

        if (pendingData || completedData) {
          const pendingTx = pendingData ? JSON.parse(pendingData) : []
          const completedTx = completedData ? JSON.parse(completedData) : []

          if (pendingTx.length > 0 || completedTx.length > 0) {
            await firestoreService.migrateLocalStorageData({
              pendingTransactions: pendingTx,
              completedTransactions: completedTx
            })
            localStorage.removeItem(STORAGE_KEYS.PENDING_TRANSACTIONS)
            localStorage.removeItem(STORAGE_KEYS.COMPLETED_TRANSACTIONS)
          }
        }

        // Écouter les drafts (transactions non terminées)
        const onSubscriptionError = (subscriptionError) => {
          if (isMounted) {
            setError(subscriptionError.message)
            setLoading(false)
          }
        }

        const onDrafts = (draftsData) => {
            if (!isMounted) return
            // Un snapshot Firestore contient déjà un document unique par id.
            setPendingTransactions(draftsData)
        }
        onDrafts.onError = onSubscriptionError
        unsubscribeDrafts = firestoreService.subscribeToDrafts(onDrafts)

        const firstPage = await firestoreService.getHistoryPage()
        if (!isMounted) return
        archiveHistoryRef.current = firstPage.transactions
        historyCursorRef.current = firstPage.lastDoc
        setHistoryHasMore(firstPage.hasMore)
        publishHistory()

        // Écouter l'historique récent en temps réel.
        const onHistory = (historyData) => {
            if (!isMounted) return
            liveHistoryRef.current = historyData
            publishHistory()
        }
        onHistory.onError = onSubscriptionError
        unsubscribeHistory = firestoreService.subscribeToHistory(onHistory)

        // Une journée métier peut dépasser la page de 100 lignes : cette écoute
        // journalière garde les indicateurs du tableau de bord exacts.
        const subscribeToday = () => {
          unsubscribeToday?.()
          const now = new Date()
          const { start, end } = getBusinessDayBounds(businessDateKey(now))
          const onToday = (historyData) => {
            if (!isMounted) return
            todayHistoryRef.current = historyData
            publishHistory()
          }
          onToday.onError = onSubscriptionError
          unsubscribeToday = firestoreService.subscribeToHistory(onToday, {
            dateRange: { start, endExclusive: end },
            limitCount: null,
          })
          rolloverTimeout = setTimeout(subscribeToday, millisecondsUntilNextBusinessDay(now) + 25)
        }
        subscribeToday()

        if (isMounted) {
          setLoading(false)
        }
      } catch (error) {
        console.error('Erreur lors de l\'initialisation des transactions:', error)
        if (isMounted) {
          setError(error.message)
          setLoading(false)
          // Fallback vers localStorage en cas d'erreur
          try {
            const savedPending = localStorage.getItem(STORAGE_KEYS.PENDING_TRANSACTIONS)
            const savedCompleted = localStorage.getItem(STORAGE_KEYS.COMPLETED_TRANSACTIONS)
            setPendingTransactions(savedPending ? JSON.parse(savedPending) : [])
            // Même tri décroissant qu'en mode nominal, pour une cohérence d'affichage.
            setCompletedTransactions(savedCompleted ? sortHistoryDesc(JSON.parse(savedCompleted)) : [])
          } catch {
            setPendingTransactions([])
            setCompletedTransactions([])
          }
        }
      }
    }

    initializeTransactions()

    return () => {
      isMounted = false
      if (unsubscribeDrafts && typeof unsubscribeDrafts === 'function') {
        unsubscribeDrafts()
      }
      if (unsubscribeHistory && typeof unsubscribeHistory === 'function') {
        unsubscribeHistory()
      }
      if (unsubscribeToday && typeof unsubscribeToday === 'function') unsubscribeToday()
      if (rolloverTimeout) clearTimeout(rolloverTimeout)
    }
  }, [user, userProfile?.storeId, activeStore?.id, authLoading, publishHistory])

  const loadMoreHistory = useCallback(async () => {
    if (!historyHasMore || historyLoadingMore || !historyCursorRef.current) return false
    try {
      setHistoryLoadingMore(true)
      setError(null)
      const page = await firestoreService.getHistoryPage({ lastDoc: historyCursorRef.current })
      archiveHistoryRef.current = mergeHistoryPages(archiveHistoryRef.current, page.transactions)
      historyCursorRef.current = page.lastDoc
      setHistoryHasMore(page.hasMore)
      publishHistory()
      return true
    } catch (loadError) {
      setError(loadError.message)
      return false
    } finally {
      setHistoryLoadingMore(false)
    }
  }, [historyHasMore, historyLoadingMore, publishHistory])

  const addTransaction = useCallback(async (transactionData) => {
    try {
      setError(null)
      const transaction = {
        ...transactionData,
        statut: transactionData.statut || 'Non Terminées',
        storeId: userProfile?.storeId,
        storeName: activeStore?.name || userProfile?.storeName,
        role: userProfile?.role,
        operatorId: user?.uid,
        operatorName: userProfile?.name || user?.displayName || user?.email,
        operatorEmail: user?.email || 'Utilisateur inconnu',
        userId: user?.uid,
        userEmail: user?.email || 'Utilisateur inconnu'
      }

      await firestoreService.addTransaction(transaction)
      // La mise à jour de l'état se fera automatiquement via onSnapshot
    } catch (error) {
      console.error('Erreur lors de l\'ajout de la transaction:', error)
      setError(error.message)
      throw error
    }
  }, [activeStore?.name, user, userProfile?.name, userProfile?.role, userProfile?.storeId, userProfile?.storeName])

  const updateTransaction = useCallback(async (id, updates) => {
    try {
      setError(null)
      await firestoreService.updateDraft(id, updates)
      // La mise à jour de l'état se fera automatiquement via onSnapshot
    } catch (error) {
      console.error('Erreur lors de la mise à jour de la transaction:', error)
      setError(error.message)
      throw error
    }
  }, [])

  const validateTransaction = useCallback(async (id, customStatus = 'Validée', selectedPaymentMethod = null, amountOverride = null) => {
    try {
      setError(null)

      const success = await firestoreService.validateTransaction(id, customStatus, selectedPaymentMethod, amountOverride)
      if (!success) {
        console.warn(`Transaction ${id} n'a pas pu être validée (probablement déjà supprimée)`)
        return false
      }

      return true
    } catch (error) {
      console.error('Erreur lors de la validation de la transaction:', error)
      setError(error.message)
      throw error
    }
  }, [])

  const addPaymentTranche = useCallback(async (draftId, amount, paymentMethod, idempotencyKey, agentCode) => {
    try {
      setError(null)
      await addTransactionPayment({ draftId, amount, paymentMethod, idempotencyKey, agentCode })
      return true
    } catch (error) {
      console.error('Erreur de règlement (paiement):', error)
      setError(error?.message || 'Erreur lors du paiement')
      throw error
    }
  }, [])

  const addRefundTranche = useCallback(async (draftId, amount, paymentMethod, idempotencyKey, agentCode) => {
    try {
      setError(null)
      await addTransactionRefund({ draftId, amount, paymentMethod, idempotencyKey, agentCode })
      return true
    } catch (error) {
      console.error('Erreur de règlement (remboursement):', error)
      setError(error?.message || 'Erreur lors du remboursement')
      throw error
    }
  }, [])

  /**
   * Met une transaction à la corbeille, qu'elle soit non terminée ou validée.
   *
   * UNE SEULE FONCTION POUR LES DEUX TABLEAUX
   * L'appelant n'a pas à savoir où vit la ligne : les deux boutons
   * « Supprimer » — celui des non terminées et celui de l'historique —
   * appellent ceci, et le routage se fait sur ce que le contexte sait déjà.
   * Dans les deux cas le serveur rend le montant aux soldes et la ligne
   * réapparaît dans la corbeille.
   */
  const trashTransaction = useCallback(async (id) => {
    try {
      setError(null)
      const isDraft = pendingTransactions.some(t => t.id === id)

      if (isDraft) {
        await firestoreService.trashDraft(id)
      } else {
        // Un retour de ravitaillement ne se défait pas comme une transaction
        // client : il faut AUSSI faire remonter le reste dû de sa livraison.
        // Le routage vit ici parce que le tableau n'a pas à connaître les deux
        // commandes — il sait seulement qu'on supprime une ligne.
        const ligne = [
          ...liveHistoryRef.current,
          ...todayHistoryRef.current,
          ...archiveHistoryRef.current,
        ].find((item) => item?.id === id)

        const trashed = ligne?.type === TYPE_RETOUR
          ? await firestoreService.trashReplenishmentReturn(id)
          : await firestoreService.trashHistory(id)
        if (trashed) {
          // Marquage optimiste : les pages d'archive ne sont pas toutes
          // branchées sur un onSnapshot, et la ligne doit quitter l'onglet
          // clients tout de suite — sinon le gérant reclique.
          const marquerSupprimee = (items) => items.map((item) => (
            item.id === id
              ? { ...item, statut: FIRESTORE_CONFIG.STATUS.DELETED, deletedAt: new Date() }
              : item
          ))
          archiveHistoryRef.current = marquerSupprimee(archiveHistoryRef.current)
          liveHistoryRef.current = marquerSupprimee(liveHistoryRef.current)
          todayHistoryRef.current = marquerSupprimee(todayHistoryRef.current)
          publishHistory()
        }
      }
    } catch (error) {
      console.error('Erreur lors de la suppression de la transaction:', error)
      setError(error.message)
      throw error
    }
  }, [pendingTransactions, publishHistory])

  /**
   * Ramène une transaction validée dans le formulaire pour correction.
   *
   * Le serveur rend la part encaissée aux soldes et recrée un brouillon ; on
   * ouvre le formulaire sur CE brouillon, pas sur la ligne d'historique qui
   * vient de disparaître — c'est son identifiant que la correction modifiera.
   *
   * On préremplit depuis la ligne qu'on a déjà en main plutôt que d'attendre
   * le snapshot : le formulaire s'ouvre sans latence, et l'abonnement corrige
   * la copie locale dans la seconde.
   */
  const reopenTransaction = useCallback(async (transaction) => {
    try {
      setError(null)
      const { draftId, direct } = await firestoreService.reopenHistory(transaction.id)
      const retiree = (items) => items.filter((item) => item.id !== transaction.id)
      archiveHistoryRef.current = retiree(archiveHistoryRef.current)
      liveHistoryRef.current = retiree(liveHistoryRef.current)
      todayHistoryRef.current = retiree(todayHistoryRef.current)
      publishHistory()
      // Liste blanche, comme côté serveur : recopier la ligne d'historique en
      // entier traînerait ses neuf champs de règlement dans l'objet en cours
      // d'édition, qui paraîtrait alors déjà réglé à qui l'inspecte.
      setEditingTransaction({
        client: transaction.client,
        clientId: transaction.clientId,
        code: transaction.code,
        type: transaction.type,
        reseau: transaction.reseau,
        montant: transaction.montant,
        id: draftId,
        statut: FIRESTORE_CONFIG.STATUS.PENDING,
        reopenedFromHistoryId: transaction.id,
        reopenedPaymentMethod: transaction.paymentMethod ?? null,
        // Validée d'un geste depuis le formulaire, sans règlement : la
        // correction devra rejouer CE geste, pas en inventer un autre.
        //
        // Le drapeau vient du SERVEUR. Le déduire ici de `!paymentMethod`
        // reviendrait à inventer une jambe de liquidité aux lignes qui n'en ont
        // jamais porté — un montant corrigé à l'identique déplacerait les soldes.
        reopenedDirect: direct,
      })
      return draftId
    } catch (error) {
      console.error('Erreur lors de la réouverture de la transaction:', error)
      setError(error.message)
      throw error
    }
  }, [publishHistory])

  /**
   * Enregistre la correction d'une ligne rouverte et la REMET dans l'historique.
   *
   * Une transaction venue de l'historique doit y retourner. La laisser dans les
   * non terminées obligerait la caissière à re-cliquer « Encaisser » et à
   * re-choisir un mode de règlement qu'elle n'a jamais voulu changer : elle n'a
   * corrigé qu'un montant.
   *
   * DEUX APPELS, ET C'EST SANS DANGER
   * `updateDraft` ajuste la jambe du brouillon et journalise la correction ;
   * `validateDraft` rejoue la jambe du règlement avec le mode mémorisé. Chacun
   * est atomique de son côté. Si le second échouait, le brouillon resterait
   * dans les non terminées avec des soldes COHÉRENTS pour un brouillon — rien
   * de faux, juste une étape à reprendre d'un clic.
   */
  const saveReopenedCorrection = useCallback(async (transaction, updates) => {
    try {
      setError(null)
      await firestoreService.updateDraft(transaction.id, updates)
      await firestoreService.validateTransaction(
        transaction.id,
        FIRESTORE_CONFIG.STATUS.VALIDATED,
        transaction.reopenedPaymentMethod ?? null,
        null,
        Boolean(transaction.reopenedDirect),
      )
    } catch (error) {
      console.error('Erreur lors de la correction de la transaction:', error)
      setError(error.message)
      throw error
    }
  }, [])

  const startEditTransaction = useCallback((transaction) => {
    setEditingTransaction(transaction)
  }, [])

  const clearEditTransaction = useCallback(() => {
    setEditingTransaction(null)
  }, [])

  const getActionButtons = useCallback((transaction) => {
    const actions = getAvailableActions(transaction.type)
    // Dès qu'un règlement est engagé, `type`/`montant`/`clientId` sont figés côté
    // règles Firestore : on masque donc « Modifier » pour rester cohérent avec le
    // serveur (les tranches restent accessibles via Encaisser/Payer/Rembourser).
    if (isDraftSettling(transaction)) {
      return { ...actions, modifier: false }
    }
    return actions
  }, [])

  const getTransactionStylesFunc = useCallback((type) => {
    return getTransactionStyles(type)
  }, [])

  const value = {
    pendingTransactions,
    completedTransactions,
    historyHasMore,
    historyLoadingMore,
    loadMoreHistory,
    editingTransaction,
    loading,
    error,
    addTransaction,
    updateTransaction,
    validateTransaction,
    addPaymentTranche,
    addRefundTranche,
    trashTransaction,
    reopenTransaction,
    saveReopenedCorrection,
    startEditTransaction,
    clearEditTransaction,
    getActionButtons,
    getTransactionStyles: getTransactionStylesFunc
  }

  return (
    <TransactionsContext.Provider value={value}>
      {children}
    </TransactionsContext.Provider>
  )
}
