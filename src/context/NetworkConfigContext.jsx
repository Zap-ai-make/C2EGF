import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { getStorageKey } from '../config/clientIsolation'
import { AuthContext } from './AuthContext'
import { firestoreService } from '../services/firestore'

const NetworkConfigContext = createContext()

// Configuration par défaut : STOCKS + LIQUIDITÉS par réseau
const DEFAULT_NETWORK_DATA = {
  Orange: { stock: 0, liquidite: 0 },
  Moov: { stock: 0, liquidite: 0 },
  Telecel: { stock: 0, liquidite: 0 },
  Coris: { stock: 0, liquidite: 0 },
  Sank: { stock: 0, liquidite: 0 }
}

// Clés pour localStorage
const NETWORK_DATA_STORAGE_KEY = getStorageKey('network_data_v3')

export function useNetworkConfig() {
  const context = useContext(NetworkConfigContext)
  if (!context) {
    throw new Error('useNetworkConfig must be used within a NetworkConfigProvider')
  }
  return context
}

// Charger depuis localStorage
const loadNetworkDataFromStorage = () => {
  try {
    const stored = localStorage.getItem(NETWORK_DATA_STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (parsed && typeof parsed === 'object') {
        // Fusionner avec les défauts pour ajouter de nouveaux réseaux si nécessaire
        return { ...DEFAULT_NETWORK_DATA, ...parsed }
      }
    }
  } catch (error) {
    console.warn('Erreur lors du chargement des données réseau:', error)
  }
  return { ...DEFAULT_NETWORK_DATA }
}

// Sauvegarder dans localStorage
const saveNetworkDataToStorage = (data) => {
  try {
    localStorage.setItem(NETWORK_DATA_STORAGE_KEY, JSON.stringify(data))
  } catch (error) {
    console.warn('Erreur lors de la sauvegarde:', error)
  }
}

export function NetworkConfigProvider({ children }) {
  const { currentUser: user, userProfile, activeStore, loading: authLoading } = useContext(AuthContext)
  const [networkData, setNetworkData] = useState(() => loadNetworkDataFromStorage())

  useEffect(() => {
    if (authLoading) return undefined

    if (!user || !userProfile?.storeId || activeStore?.id !== userProfile.storeId) {
      setNetworkData(loadNetworkDataFromStorage())
      return undefined
    }

    firestoreService.ensureNetworkBalances(loadNetworkDataFromStorage())
      .catch((error) => {
        console.error('Erreur lors de l initialisation des soldes reseau:', error)
      })

    const unsubscribe = firestoreService.subscribeToNetworkBalances((balances) => {
      setNetworkData(balances)
      saveNetworkDataToStorage(balances)
    })

    return unsubscribe
  }, [user, userProfile?.storeId, activeStore?.id, authLoading])

  // Sauvegarde locale de secours pour l'affichage hors ligne.
  useEffect(() => {
    saveNetworkDataToStorage(networkData)
  }, [networkData])

  // Mettre à jour un réseau (stock OU liquidité)
  const updateNetwork = useCallback((network, type, amount) => {
    const nextAmount = Math.max(0, Number(amount) || 0)
    const applyLocalUpdate = () => setNetworkData(prev => {
      const newData = { ...prev }

      if (!newData[network]) {
        newData[network] = { stock: 0, liquidite: 0 }
      }

      newData[network] = {
        ...newData[network],
        [type]: nextAmount
      }

      return newData
    })

    if (user) {
      return firestoreService.setNetworkBalance(network, type, nextAmount)
        .then((balances) => {
          setNetworkData(balances)
          return balances
        })
        .catch((error) => {
          console.error('Erreur lors de la sauvegarde du solde reseau:', error)
          throw error
        })
    }

    applyLocalUpdate()
    return Promise.resolve()
  }, [user])

  // Réinitialiser
  const resetToDefaults = useCallback(() => {
    setNetworkData({ ...DEFAULT_NETWORK_DATA })
    localStorage.removeItem(NETWORK_DATA_STORAGE_KEY)
  }, [])

  const value = {
    networkData,
    updateNetwork,
    resetToDefaults
  }

  return (
    <NetworkConfigContext.Provider value={value}>
      {children}
    </NetworkConfigContext.Provider>
  )
}

export { DEFAULT_NETWORK_DATA }
