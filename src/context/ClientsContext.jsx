import { useState, useEffect, useContext, createContext, useMemo } from 'react'
import { STORAGE_KEYS } from '../constants'
import { firestoreService, normaliserChampsAgent } from '../services/firestore'
import { parsefrenchDate } from '../utils/helpers.js'
import { messageDoublonAgent, trouverFicheAgent } from '../utils/agentFields.js'
import { CLIENT, ENVOYEE } from '../services/fileEnvoi.js'
import { AuthContext } from './AuthContext'
import { EnvoisContext } from './envoisContexte.js'
import { clientsEnAttente } from '../utils/envoisEnAttente.js'

export const ClientsContext = createContext()

/**
 * Horodatage (ms) d'enregistrement d'un client, pour le tri décroissant
 * (le dernier enregistré en haut). Priorité au Timestamp Firestore `createdAt` ;
 * repli sur `dateAjout` (format FR "JJ/MM/AAAA"). L'abonnement temps réel
 * (`subscribeToClients`) ne pose pas d'`orderBy` → on trie côté client, sans
 * dépendre d'un index ni exclure les anciens documents sans `createdAt`.
 */
const clientTimestamp = (c) => {
  if (c?.createdAt?.toMillis) return c.createdAt.toMillis()
  if (c?.createdAt) {
    const t = new Date(c.createdAt).getTime()
    if (!Number.isNaN(t)) return t
  }
  const parsed = parsefrenchDate(c?.dateAjout)
  return parsed ? parsed.getTime() : 0
}

/** Tri décroissant par date d'enregistrement. Exporté pour test. */
export const sortClientsByRegistrationDesc = (list) =>
  [...list].sort((a, b) => clientTimestamp(b) - clientTimestamp(a))

export function ClientsProvider({ children }) {
  const { currentUser: user, userProfile, activeStore, loading: authLoading } = useContext(AuthContext)
  const envois = useContext(EnvoisContext)
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Synchronisation temps réel avec Firestore - seulement si l'utilisateur est authentifié
  useEffect(() => {
    // Ne pas initialiser si l'auth est encore en cours de chargement
    if (authLoading) {
      return
    }

    // Si pas d'utilisateur connecté, ne pas essayer de charger depuis Firestore
    if (!user || !userProfile?.storeId || activeStore?.id !== userProfile.storeId) {
      setClients([])
      setLoading(false)
      return
    }

    let isMounted = true
    let unsubscribe
    let loadingTimeout

    const initializeClients = async () => {
      try {
        setLoading(true)
        setError(null)

        // Vérifier s'il y a des données localStorage à migrer
        const localStorageClients = localStorage.getItem(STORAGE_KEYS.CLIENTS)
        if (localStorageClients) {
          const parsedClients = JSON.parse(localStorageClients)
          if (parsedClients.length > 0) {
            await firestoreService.migrateLocalStorageData({ clients: parsedClients })
            localStorage.removeItem(STORAGE_KEYS.CLIENTS)
          }
        }

        // Timeout pour éviter le loading infini
        loadingTimeout = setTimeout(() => {
          if (isMounted) {
            setLoading(false)
          }
        }, 5000) // 5 secondes maximum

        // Écouter les changements en temps réel - PRIORITÉ À FIRESTORE
        const onClients = (clientsData) => {
            if (!isMounted) return
            clearTimeout(loadingTimeout)

            // Tri décroissant : le dernier client enregistré apparaît en haut.
            setClients(sortClientsByRegistrationDesc(clientsData))
            setLoading(false)
            setError(null)
        }
        onClients.onError = (subscriptionError) => {
          if (!isMounted) return
          clearTimeout(loadingTimeout)
          setError(subscriptionError.message)
          setLoading(false)
        }
        unsubscribe = firestoreService.subscribeToClients(onClients)

      } catch (error) {
        console.error('Clients initialization error:', error)
        if (isMounted) {
          setError(error.message)
          setLoading(false)
          // Seulement utiliser le fallback en cas d'erreur critique
          setClients([])
        }
      }
    }

    initializeClients()

    return () => {
      isMounted = false
      if (unsubscribe && typeof unsubscribe === 'function') {
        unsubscribe()
      }
      // Nettoyer le timeout si le composant se démonte
      if (loadingTimeout) {
        clearTimeout(loadingTimeout)
      }
    }
  }, [user, userProfile?.storeId, activeStore?.id, authLoading])


  // Les fiches ajoutées sans réseau (lot G3c) : en tête, comme la dernière
  // enregistrée, tant que l'annuaire ne les a pas reçues. Elles comptent aussi
  // pour le contrôle de doublon : deux fiches hors ligne au même code seraient
  // refusées l'une après l'autre au retour du réseau.
  const operationsEnAttente = envois?.operations
  const clientsAffiches = useMemo(() => {
    const enAttente = clientsEnAttente(operationsEnAttente ?? [])
    if (enAttente.length === 0) return clients
    const connus = new Set(clients.map((c) => c.id))
    return [...enAttente.filter((c) => !connus.has(c.id)), ...clients]
  }, [clients, operationsEnAttente])

  const addClient = async (newClient) => {
    try {
      setError(null)
      const donnees = {
        ...newClient,
        registeredBy: user?.uid,
        registeredByEmail: user?.email,
        registeredStoreId: userProfile?.storeId,
        registeredStoreName: activeStore?.name || userProfile?.storeName
      }
      // La liste se met à jour par onSnapshot ; la fiche RENDUE sert à qui doit
      // la reprendre tout de suite (la transaction qui vient de la créer).
      if (envois?.disponible !== true) return await firestoreService.addClient(donnees)

      // Par la file d'envoi (lot G3b). Hors ligne, le serveur ne peut pas dire
      // si le code agent est déjà pris : la copie de l'annuaire le peut, avec
      // la règle même du serveur (`trouverFicheAgent`). Le serveur refera le
      // contrôle à l'envoi, pour une fiche créée ailleurs entre-temps.
      const normalise = normaliserChampsAgent(donnees)
      for (const valeur of [normalise.codeAgent, normalise.numeroAgent].filter(Boolean)) {
        const autre = trouverFicheAgent(clientsAffiches, valeur)
        if (autre) throw Object.assign(new Error(messageDoublonAgent(autre, userProfile?.storeId)), { code: 'CLIENT_DOUBLON' })
      }
      const id = firestoreService.nouvelIdClient()
      const charge = { donnees: { ...donnees, dateAjout: new Date().toLocaleDateString('fr-FR') } }
      const issue = await envois.soumettre(CLIENT, charge, { id })
      // En attente du réseau, la fiche existe déjà sous son identifiant : la
      // transaction qui l'a créée peut la prendre, et partira après elle.
      return issue.statut === ENVOYEE ? issue.resultat : { id, ...charge.donnees, ...normalise, enAttente: true }
    } catch (error) {
      console.error('Client creation error:', error)
      setError(error.message)
      throw error
    }
  }

  const deleteClient = async (clientId) => {
    try {
      setError(null)
      await firestoreService.deleteClient(clientId)
      // La mise à jour de l'état se fera automatiquement via onSnapshot
    } catch (error) {
      console.error('Client deletion error:', error)
      setError(error.message)
      throw error
    }
  }

  const editClient = async (clientId, updatedClient) => {
    try {
      setError(null)
      await firestoreService.updateClient(clientId, updatedClient)
      // La mise à jour de l'état se fera automatiquement via onSnapshot
    } catch (error) {
      console.error('Client update error:', error)
      setError(error.message)
      throw error
    }
  }

  const value = {
    clients: clientsAffiches,
    loading,
    error,
    addClient,
    deleteClient,
    editClient
  }

  return (
    <ClientsContext.Provider value={value}>
      {children}
    </ClientsContext.Provider>
  )
}
