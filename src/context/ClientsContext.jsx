import { useState, useEffect, useContext, createContext } from 'react'
import { STORAGE_KEYS } from '../constants'
import { firestoreService } from '../services/firestore'
import { parsefrenchDate } from '../utils/helpers.js'
import { AuthContext } from './AuthContext'

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
        unsubscribe = firestoreService.subscribeToClients((clientsData) => {
          if (isMounted) {
            clearTimeout(loadingTimeout)

            // Déduplication des clients pour éviter les erreurs de clés React
            const uniqueClients = clientsData.filter((client, index, array) =>
              array.findIndex(c => c.id === client.id) === index
            )

            // Tri décroissant : le dernier client enregistré apparaît en haut.
            setClients(sortClientsByRegistrationDesc(uniqueClients))
            setLoading(false)
            setError(null)
          }
        })

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


  const addClient = async (newClient) => {
    try {
      setError(null)
      await firestoreService.addClient({
        ...newClient,
        registeredBy: user?.uid,
        registeredByEmail: user?.email,
        registeredStoreId: userProfile?.storeId,
        registeredStoreName: activeStore?.name || userProfile?.storeName
      })
      // La mise à jour de l'état se fera automatiquement via onSnapshot
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
    clients,
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

