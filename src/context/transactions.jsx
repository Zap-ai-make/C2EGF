import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { getTransactionStyles, getAvailableActions, isDraftSettling, parsefrenchDate } from '../utils/helpers.js'
import { STORAGE_KEYS } from '../constants/index.js'
import { FIRESTORE_CONFIG } from '../constants/firestoreConstants.js'
import { firestoreService } from '../services/firestore'
import { addTransactionPayment, addTransactionRefund } from '../services/settlementService'
import { AuthContext } from './AuthContext'
import { EnvoisContext } from './envoisContexte.js'
import {
  ANNULATION,
  CIBLE_NON_TERMINEE,
  CIBLE_RETOUR,
  CIBLE_VALIDEE,
  CORRECTION,
  ENVOYEE,
  MODIFICATION,
  REFUSEE,
  REGLEMENT,
  REMBOURSEMENT,
  SAISIE,
} from '../services/fileEnvoi.js'
import { appliquerFile, resumeLigne } from '../utils/envoisEnAttente.js'
import {
  businessDateKey,
  getBusinessDayBounds,
  millisecondsUntilNextBusinessDay,
} from '../utils/businessDate.js'
import { TYPE_RETOUR } from '../utils/ravitaillement.js'
import { stockDejaPris } from '../utils/financialImpact.js'
import { bornerPeriode, bornesServeur } from '../utils/periodeHistorique.js'

// Exporté comme ClientsContext : permet de fournir une valeur sans monter le
// provider réel (bancs d'essai, tests de rendu) — cf. src/preview.jsx.
export const TransactionsContext = createContext()

/** Un horodatage Firestore, une Date ou une chaîne, ramenés en millisecondes. */
const enMillisecondes = (brut) => {
  if (!brut) return 0
  if (typeof brut.toMillis === 'function') return brut.toMillis()
  const date = brut instanceof Date ? brut : new Date(brut)
  const t = date.getTime()
  return Number.isNaN(t) ? 0 : t
}

/**
 * Horodatage (ms) d'un élément d'historique pour le tri décroissant.
 * Priorité au Timestamp Firestore `createdAt` ; repli sur la date FR `date`
 * ("DD/MM/YYYY HH:mm"). On ne dépend d'aucun orderBy Firestore (le service
 * n'en pose pas volontairement, pour inclure TOUS les éléments).
 */
const historyTimestamp = (item) => {
  const cree = enMillisecondes(item?.createdAt)
  if (cree) return cree
  const parsed = parsefrenchDate(item?.date)
  return parsed ? parsed.getTime() : 0
}

/**
 * L'instant de la DERNIÈRE ACTION sur une ligne — c'est lui qui la classe.
 *
 * ⚠ CE N'EST PAS LA DATE DE SAISIE, ET LA DIFFÉRENCE SE VOIT TOUS LES JOURS.
 *   Une opération notée le matin, laissée en « non terminée », puis validée le
 *   soir conserve le `createdAt` du brouillon : le serveur le recopie tel quel
 *   dans l'historique (`storeTransactionCommand.js`, branche de validation).
 *   Classée là-dessus, elle réapparaissait au milieu de la matinée — le gérant
 *   venait de la traiter et devait la chercher. Elle remonte désormais au moment
 *   où on s'en est occupé.
 *
 *   `date`, lui, ne bouge pas : les filtres par journée continuent de ranger
 *   l'opération au jour où elle a eu lieu. Seul l'ORDRE D'AFFICHAGE change.
 */
export const instantDerniereAction = (item) => Math.max(
  historyTimestamp(item),
  enMillisecondes(item?.validatedAt),
)

/** Tri décroissant (la dernière traitée en haut). Exporté pour test. */
export const sortHistoryDesc = (list) =>
  [...list].sort((a, b) => instantDerniereAction(b) - instantDerniereAction(a))

/**
 * Tri décroissant des non terminées — le dernier brouillon noté en haut.
 *
 * ⚠ IL N'Y EN AVAIT AUCUN. `subscribeToDrafts` ne pose pas d'`orderBy`, donc le
 *   snapshot arrive dans l'ordre des IDENTIFIANTS DE DOCUMENTS : un ordre
 *   alphabétique sur des identifiants aléatoires, c'est-à-dire aucun ordre. La
 *   liste se réorganisait à chaque ajout, et la ligne qu'on venait de noter
 *   pouvait atterrir n'importe où.
 */
export const sortDraftsDesc = (list) =>
  [...(list ?? [])].sort((a, b) => historyTimestamp(b) - historyTimestamp(a))

export const mergeHistoryPages = (...lists) => {
  const byId = new Map()
  for (const list of lists) {
    for (const item of list ?? []) {
      if (item?.id) byId.set(item.id, item)
    }
  }
  return sortHistoryDesc([...byId.values()])
}

/**
 * `enAttente` marque une fiche pas encore envoyée (lot G3c). C'est un état de cet
 * appareil : le serveur recopie le client tel quel dans la ligne, et l'historique
 * porterait cette marque pour toujours.
 */
const sansMarqueLocale = (transactionData) => {
  if (!transactionData.client) return transactionData
  const { enAttente: _marqueLocale, ...client } = transactionData.client
  return { ...transactionData, client }
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
  // La file d'envoi (lot G3b). Absente hors de son fournisseur : l'appel
  // direct d'avant la file reprend alors, à l'identique.
  const envois = useContext(EnvoisContext)
  const parLaFile = envois?.disponible === true
  const soumettre = envois?.soumettre

  // États pour les deux collections Firestore
  const [pendingTransactions, setPendingTransactions] = useState([])
  const [completedTransactions, setCompletedTransactions] = useState([])
  // La période relue à la demande, `{ from, to }` en clés de jour, ou `null`
  // quand l'historique s'en tient à la journée en cours (lot G1).
  const [periode, setPeriode] = useState(null)
  const [periodeEnChargement, setPeriodeEnChargement] = useState(false)
  const [erreurPeriode, setErreurPeriode] = useState(null)
  const [editingTransaction, setEditingTransaction] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  /*
   * L'HISTORIQUE S'EN TIENT À LA JOURNÉE EN COURS (lot G1)
   * ──────────────────────────────────────────────────────
   * Décision du 2026-11-06 (docs/rester-dans-le-quota-gratuit.md §G) : rien
   * d'antérieur ne se lit à l'ouverture. Quatre sources vivantes, toutes bornées :
   * la journée, les validées depuis ce matin, les supprimées depuis ce matin, les
   * ravitaillements encore dus. Une cinquième, la période, ne se lit qu'à la
   * demande, une fois, quand on choisit des dates.
   *
   * Les sources plus loin dans la liste l'emportent sur les précédentes pour une
   * même ligne : la période, lue une fois, passe en premier, pour que la version
   * vivante d'une ligne remplace toujours sa copie figée.
   */
  const periodeHistoryRef = useRef([])
  const todayHistoryRef = useRef([])
  // Les ravitaillements encore dus. Une dette ne se périme pas avec le jour :
  // une livraison d'il y a trois semaines reste due, et le badge doit le dire.
  const dettesRavitaillementRef = useRef([])
  // Ce qui vient d'etre VALIDE, meme si la saisie est ancienne. Voir
  // `subscribeToValidatedSince` : sans cette source, une non terminee vieille de
  // trois jours validee a l'instant n'apparaissait nulle part a l'ecran.
  const valideesRecemmentRef = useRef([])
  // Ce qui vient d'être SUPPRIMÉ, même saisi avant aujourd'hui : la corbeille du
  // jour. Voir `subscribeToDeletedSince`.
  const supprimeesRecemmentRef = useRef([])
  // La demande de période en cours. Une réponse arrivée après qu'on a choisi
  // une autre période, ou qu'on est revenu au jour, est ignorée.
  const periodeDemandeeRef = useRef(null)

  const publishHistory = useCallback(() => {
    setCompletedTransactions(mergeHistoryPages(
      periodeHistoryRef.current,
      dettesRavitaillementRef.current,
      todayHistoryRef.current,
      valideesRecemmentRef.current,
      supprimeesRecemmentRef.current,
    ))
  }, [])

  // Synchronisation temps réel avec Firestore pour les deux collections - seulement si authentifié
  useEffect(() => {
    periodeHistoryRef.current = []
    todayHistoryRef.current = []
    dettesRavitaillementRef.current = []
    valideesRecemmentRef.current = []
    supprimeesRecemmentRef.current = []
    periodeDemandeeRef.current = null
    setPeriode(null)
    setPeriodeEnChargement(false)
    setErreurPeriode(null)

    // Ne pas initialiser si l'auth est encore en cours de chargement
    if (authLoading) {
      return
    }

    // Si pas d'utilisateur connecté, ne pas essayer de charger depuis Firestore
    if (!user || !userProfile?.storeId || activeStore?.id !== userProfile.storeId) {
      setPendingTransactions([])
      setCompletedTransactions([])
      setLoading(false)
      return
    }

    let isMounted = true
    let unsubscribeDrafts, unsubscribeToday, unsubscribeDettes, unsubscribeValidees, unsubscribeSupprimees, rolloverTimeout

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
        // Seule attente de l'initialisation : démonté pendant la migration, on
        // n'ouvre aucune écoute que le nettoyage, déjà passé, ne fermerait plus.
        if (!isMounted) return

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
            // Le tri, lui, n'est pas donné : voir `sortDraftsDesc`.
            setPendingTransactions(sortDraftsDesc(draftsData))
        }
        onDrafts.onError = onSubscriptionError
        unsubscribeDrafts = firestoreService.subscribeToDrafts(onDrafts)

        // La journée en cours, en entier et en temps réel : c'est tout
        // l'historique qu'on lit à l'ouverture. Sa première réponse baisse
        // `loading`.
        const subscribeToday = () => {
          unsubscribeToday?.()
          const now = new Date()
          const { start, end } = getBusinessDayBounds(businessDateKey(now))
          const onToday = (historyData) => {
            if (!isMounted) return
            todayHistoryRef.current = historyData
            publishHistory()
            setLoading(false)
          }
          onToday.onError = onSubscriptionError
          unsubscribeToday = firestoreService.subscribeToHistory(onToday, {
            dateRange: { start, endExclusive: end },
            limitCount: null,
          })

          // Ce qui a ete VALIDE aujourd'hui, quelle que soit sa date de saisie.
          // L'ecoute journaliere ci-dessus cherche par `createdAt` : une non
          // terminee notee avant-hier garde ce `createdAt` en devenant une ligne
          // d'historique, donc elle echappait aux deux fenetres.
          unsubscribeValidees?.()
          const onValidees = (historyData) => {
            if (!isMounted) return
            valideesRecemmentRef.current = historyData
            publishHistory()
          }
          onValidees.onError = onSubscriptionError
          unsubscribeValidees = firestoreService.subscribeToValidatedSince(onValidees, start)

          // Ce qui a été SUPPRIMÉ aujourd'hui, quelle que soit sa date de saisie :
          // sans elle, la corbeille ne montrerait que les lignes du jour.
          unsubscribeSupprimees?.()
          const onSupprimees = (historyData) => {
            if (!isMounted) return
            supprimeesRecemmentRef.current = historyData
            publishHistory()
          }
          onSupprimees.onError = onSubscriptionError
          unsubscribeSupprimees = firestoreService.subscribeToDeletedSince(onSupprimees, start)

          rolloverTimeout = setTimeout(subscribeToday, millisecondsUntilNextBusinessDay(now) + 25)
        }
        subscribeToday()

        // Ce que la boutique doit encore au dealer, quelle que soit son
        // ancienneté. Sans cette écoute, une livraison d'avant aujourd'hui
        // disparaîtrait de « ce qu'il reste à rendre » et du badge : le logiciel
        // annoncerait une dette soldée qui ne l'est pas.
        const onDettes = (historyData) => {
          if (!isMounted) return
          dettesRavitaillementRef.current = historyData
          publishHistory()
        }
        onDettes.onError = onSubscriptionError
        unsubscribeDettes = firestoreService.subscribeToOpenReplenishments(onDettes)
        // `loading` retombe à la première réponse de la journée (`onToday`) ou
        // à la première erreur : pas ici, où aucune ligne n'est encore arrivée.
      } catch (error) {
        console.error('Erreur lors de l\'initialisation des transactions:', error)
        if (isMounted) {
          setError(error.message)
          setLoading(false)
          // Fallback vers localStorage en cas d'erreur
          try {
            const savedPending = localStorage.getItem(STORAGE_KEYS.PENDING_TRANSACTIONS)
            const savedCompleted = localStorage.getItem(STORAGE_KEYS.COMPLETED_TRANSACTIONS)
            setPendingTransactions(savedPending ? sortDraftsDesc(JSON.parse(savedPending)) : [])
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
      if (unsubscribeToday && typeof unsubscribeToday === 'function') unsubscribeToday()
      if (unsubscribeDettes && typeof unsubscribeDettes === 'function') unsubscribeDettes()
      if (unsubscribeValidees && typeof unsubscribeValidees === 'function') unsubscribeValidees()
      if (unsubscribeSupprimees && typeof unsubscribeSupprimees === 'function') unsubscribeSupprimees()
      if (rolloverTimeout) clearTimeout(rolloverTimeout)
    }
  }, [user, userProfile?.storeId, activeStore?.id, authLoading, publishHistory])

  /**
   * Relit une période passée, une fois, quand on choisit des dates.
   *
   * Lecture unique (`getHistoryBetween`, sans cache) et non écoute : les jours
   * passés ne bougent presque plus, et une écoute de période se refacturerait
   * en entier à chaque réouverture tardive. Les gestes faits ici sur une ligne
   * de la période (suppression, réouverture) la corrigent localement, et les
   * écoutes des validées et des supprimées du jour l'apportent à jour.
   *
   * Coût : une lecture par ligne de la période, journée en cours exclue
   * (`bornesServeur`). Une période au-delà de PERIODE_MAX_JOURS est refusée.
   *
   * @param {{ from?: string, to?: string }} choix  clés de jour `AAAA-MM-JJ`
   * @returns {Promise<boolean>} vrai quand la période est affichée
   */
  const chargerPeriode = useCallback(async (choix) => {
    const bornee = bornerPeriode(choix)
    if (bornee.erreur) {
      setErreurPeriode(bornee.erreur)
      return false
    }
    const demande = periodeDemandeeRef.current
    if (demande && demande.from === bornee.from && demande.to === bornee.to) return true

    periodeDemandeeRef.current = bornee
    setPeriode(bornee)
    setErreurPeriode(null)
    const bornes = bornesServeur(bornee)
    if (!bornes) {
      periodeHistoryRef.current = []
      publishHistory()
      return true
    }
    try {
      setPeriodeEnChargement(true)
      const lignes = await firestoreService.getHistoryBetween(bornes)
      if (periodeDemandeeRef.current !== bornee) return false
      periodeHistoryRef.current = lignes
      publishHistory()
      return true
    } catch (lectureError) {
      if (periodeDemandeeRef.current === bornee) setErreurPeriode(lectureError.message)
      return false
    } finally {
      if (periodeDemandeeRef.current === bornee) setPeriodeEnChargement(false)
    }
  }, [publishHistory])

  /** Revient à la journée en cours : la période relue est oubliée. */
  const revenirAuJour = useCallback(() => {
    periodeDemandeeRef.current = null
    periodeHistoryRef.current = []
    setPeriode(null)
    setPeriodeEnChargement(false)
    setErreurPeriode(null)
    publishHistory()
  }, [publishHistory])

  // Ce que la file attend encore (lots G3c et G4c) : une saisie faite hors ligne
  // apparaît sous l'identifiant que le serveur lui donnera, un règlement en attente
  // fait déjà baisser le reste dû, une annulation envoie la ligne à la corbeille.
  // Les listes exposées sont celles-ci ; l'état interne reste celui du serveur.
  const operationsEnAttente = envois?.operations
  const affichees = useMemo(
    () => appliquerFile(pendingTransactions, completedTransactions, operationsEnAttente ?? [], {
      trierNonTerminees: sortDraftsDesc,
      trierHistorique: sortHistoryDesc,
    }),
    [pendingTransactions, completedTransactions, operationsEnAttente],
  )
  // Un geste part de la ligne telle qu'elle est À L'ÉCRAN : elle peut n'exister que
  // dans la file. Il emporte ce qu'elle a laissé dans les soldes, pour les soldes
  // provisoires.
  const lignesAfficheesRef = useRef(affichees)
  lignesAfficheesRef.current = affichees
  const typeDeLigne = (draftId) => lignesAfficheesRef.current.nonTerminees.find((t) => t.id === draftId)?.type

  const addTransaction = useCallback(async (transactionData) => {
    try {
      setError(null)
      const transaction = {
        ...sansMarqueLocale(transactionData),
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

      // Rend `{ statut }` : « envoyee » quand le serveur a répondu, « en_attente »
      // quand la saisie attend le réseau sur l'appareil. La liste se met à jour
      // par onSnapshot, comme avant.
      if (!parLaFile) {
        await firestoreService.addTransaction(transaction)
        return { statut: ENVOYEE }
      }
      return await soumettre(SAISIE, { transaction })
    } catch (error) {
      console.error('Erreur lors de l\'ajout de la transaction:', error)
      setError(error.message)
      throw error
    }
  }, [activeStore?.name, user, userProfile?.name, userProfile?.role, userProfile?.storeId, userProfile?.storeName, parLaFile, soumettre])

  const updateTransaction = useCallback(async (id, updates) => {
    try {
      setError(null)
      if (!parLaFile) {
        await firestoreService.updateDraft(id, updates)
        // La mise à jour de l'état se fera automatiquement via onSnapshot
        return { statut: ENVOYEE }
      }
      const ligne = lignesAfficheesRef.current.nonTerminees.find((t) => t.id === id)
      return await soumettre(MODIFICATION, { draftId: id, updates: sansMarqueLocale(updates), avant: resumeLigne(ligne) })
    } catch (error) {
      console.error('Erreur lors de la mise à jour de la transaction:', error)
      setError(error.message)
      throw error
    }
  }, [parLaFile, soumettre])

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
      if (!parLaFile) {
        await addTransactionPayment({ draftId, amount, paymentMethod, idempotencyKey, agentCode })
        return { statut: ENVOYEE }
      }
      // L'opération prend la clé du geste pour identifiant : le même règlement
      // confirmé deux fois n'entre qu'une fois dans la file.
      return await soumettre(REGLEMENT, { draftId, amount, paymentMethod, idempotencyKey, agentCode, type: typeDeLigne(draftId) }, { id: `${REGLEMENT}-${idempotencyKey}` })
    } catch (error) {
      console.error('Erreur de règlement (paiement):', error)
      setError(error?.message || 'Erreur lors du paiement')
      throw error
    }
  }, [parLaFile, soumettre])

  const addRefundTranche = useCallback(async (draftId, amount, paymentMethod, idempotencyKey, agentCode) => {
    try {
      setError(null)
      if (!parLaFile) {
        await addTransactionRefund({ draftId, amount, paymentMethod, idempotencyKey, agentCode })
        return { statut: ENVOYEE }
      }
      return await soumettre(REMBOURSEMENT, { draftId, amount, paymentMethod, idempotencyKey, agentCode, type: typeDeLigne(draftId) }, { id: `${REMBOURSEMENT}-${idempotencyKey}` })
    } catch (error) {
      console.error('Erreur de règlement (remboursement):', error)
      setError(error?.message || 'Erreur lors du remboursement')
      throw error
    }
  }, [parLaFile, soumettre])

  /**
   * Met une transaction à la corbeille, qu'elle soit non terminée ou validée.
   *
   * UNE SEULE FONCTION POUR LES DEUX TABLEAUX
   * L'appelant n'a pas à savoir où vit la ligne : les deux boutons
   * « Supprimer » — celui des non terminées et celui de l'historique —
   * appellent ceci, et le routage se fait sur ce que le contexte sait déjà.
   * Dans les deux cas le serveur rend le montant aux soldes et la ligne
   * réapparaît dans la corbeille.
   *
   * L'identifiant de l'opération vient de la ligne : le même geste confirmé deux
   * fois n'entre qu'une fois dans la file.
   *
   * @returns {Promise<{ statut: string }>} « envoyee » ou « en_attente »
   */
  const trashTransaction = useCallback(async (id) => {
    try {
      setError(null)
      const { nonTerminees, historique } = lignesAfficheesRef.current
      const brouillon = nonTerminees.find((t) => t.id === id)
      const annuler = (cible, ligne) => soumettre(
        ANNULATION,
        { cible, cibleId: id, avant: resumeLigne(ligne) },
        { id: `${ANNULATION}-${id}` },
      )

      if (brouillon) {
        if (parLaFile) return await annuler(CIBLE_NON_TERMINEE, brouillon)
        await firestoreService.trashDraft(id)
        return { statut: ENVOYEE }
      }

      // Un retour de ravitaillement ne se défait pas comme une transaction
      // client : il faut AUSSI faire remonter le reste dû de sa livraison.
      // Le routage vit ici parce que le tableau n'a pas à connaître les deux
      // commandes — il sait seulement qu'on supprime une ligne.
      const ligne = historique.find((item) => item?.id === id)
      const estRetour = ligne?.type === TYPE_RETOUR

      let issue
      if (parLaFile) {
        issue = await annuler(estRetour ? CIBLE_RETOUR : CIBLE_VALIDEE, ligne)
      } else {
        const trashed = estRetour
          ? await firestoreService.trashReplenishmentReturn(id)
          : await firestoreService.trashHistory(id)
        issue = trashed ? { statut: ENVOYEE } : { statut: null }
      }

      const marquerSupprimee = (items) => items.map((item) => (
        item.id === id
          ? { ...item, statut: FIRESTORE_CONFIG.STATUS.DELETED, deletedAt: new Date() }
          : item
      ))
      // La période relue n'est branchée sur aucun onSnapshot : personne d'autre ne
      // la corrigera une fois l'opération partie.
      if (issue.statut !== null) periodeHistoryRef.current = marquerSupprimee(periodeHistoryRef.current)
      if (issue.statut === ENVOYEE) {
        // Marquage optimiste : la ligne doit quitter l'onglet clients tout de
        // suite — sinon le gérant reclique.
        todayHistoryRef.current = marquerSupprimee(todayHistoryRef.current)
        valideesRecemmentRef.current = marquerSupprimee(valideesRecemmentRef.current)
      }
      if (issue.statut !== null) publishHistory()
      return issue
    } catch (error) {
      console.error('Erreur lors de la suppression de la transaction:', error)
      setError(error.message)
      throw error
    }
  }, [parLaFile, soumettre, publishHistory])

  /**
   * Ouvre le formulaire sur une transaction validée, pour correction.
   *
   * Rien ne part au serveur, et les soldes ne bougent pas : sans réseau, une
   * réouverture ne pourrait pas précéder le formulaire (lot G4b). La ligne reste
   * validée tant que la caissière n'a pas confirmé, et fermer le formulaire ne
   * change rien.
   */
  const reopenTransaction = useCallback(async (transaction) => {
    setError(null)
    // Liste blanche : recopier la ligne d'historique en entier traînerait ses neuf
    // champs de règlement dans l'objet en cours d'édition, qui paraîtrait alors
    // déjà réglé à qui l'inspecte.
    setEditingTransaction({
      client: transaction.client,
      clientId: transaction.clientId,
      code: transaction.code,
      type: transaction.type,
      reseau: transaction.reseau,
      montant: transaction.montant,
      id: transaction.id,
      statut: FIRESTORE_CONFIG.STATUS.PENDING,
      reopenedFromHistoryId: transaction.id,
      stockDejaPris: stockDejaPris(transaction),
    })
    return transaction.id
  }, [])

  /**
   * Enregistre la correction d'une ligne validée, qui RESTE dans l'historique.
   *
   * Une transaction venue de l'historique doit y retourner. La laisser dans les
   * non terminées obligerait la caissière à re-cliquer « Encaisser » et à
   * re-choisir un mode de règlement qu'elle n'a jamais voulu changer : elle n'a
   * corrigé qu'un montant.
   *
   * UN SEUL ENVOI : `correctHistory` fait tout ou rien (lot G4a). Un refus laisse la
   * ligne telle qu'elle était, et le serveur décide seul du mode à rejouer.
   *
   * @returns {Promise<{ statut: string }>} « envoyee » ou « en_attente »
   */
  const saveReopenedCorrection = useCallback(async (transaction, updates) => {
    try {
      setError(null)
      const historyId = transaction.reopenedFromHistoryId
      const corrections = sansMarqueLocale(updates)
      let issue
      if (parLaFile) {
        const ligne = lignesAfficheesRef.current.historique.find((t) => t.id === historyId)
        issue = await soumettre(CORRECTION, { historyId, updates: corrections, avant: resumeLigne(ligne) })
      } else {
        await firestoreService.correctHistory(historyId, corrections)
        issue = { statut: ENVOYEE }
      }
      if (issue.statut === ENVOYEE) {
        // La ligne d'origine n'existe plus : la période relue n'écoute rien, et les
        // autres sources ne le diront qu'au prochain snapshot.
        const retiree = (items) => items.filter((item) => item.id !== historyId)
        periodeHistoryRef.current = retiree(periodeHistoryRef.current)
        todayHistoryRef.current = retiree(todayHistoryRef.current)
        valideesRecemmentRef.current = retiree(valideesRecemmentRef.current)
        publishHistory()
      }
      return issue
    } catch (error) {
      console.error('Erreur lors de la correction de la transaction:', error)
      setError(error.message)
      throw error
    }
  }, [parLaFile, soumettre, publishHistory])

  const startEditTransaction = useCallback((transaction) => {
    setEditingTransaction(transaction)
  }, [])

  const clearEditTransaction = useCallback(() => {
    setEditingTransaction(null)
  }, [])

  const getActionButtons = useCallback((transaction) => {
    const actions = getAvailableActions(transaction.type)
    // Une saisie refusée n'existe pas au serveur : rien ne s'y applique. En attente,
    // tout s'y applique : le geste partira après elle (lot G4b).
    if (transaction.envoi?.etat === REFUSEE) {
      return { ...Object.fromEntries(Object.keys(actions).map((geste) => [geste, false])), annuler: false }
    }
    // Dès qu'un règlement est engagé, `type`/`montant`/`clientId` sont figés côté
    // règles Firestore, et le serveur refuse d'annuler : on masque les deux gestes
    // pour rester cohérent avec lui (les tranches restent accessibles via
    // Encaisser/Payer/Rembourser). Sans réseau, le refus n'arriverait qu'au retour.
    if (isDraftSettling(transaction)) {
      return { ...actions, modifier: false, annuler: false }
    }
    return actions
  }, [])

  const getTransactionStylesFunc = useCallback((type) => {
    return getTransactionStyles(type)
  }, [])

  const value = {
    pendingTransactions: affichees.nonTerminees,
    completedTransactions: affichees.historique,
    periode,
    periodeEnChargement,
    erreurPeriode,
    chargerPeriode,
    revenirAuJour,
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
