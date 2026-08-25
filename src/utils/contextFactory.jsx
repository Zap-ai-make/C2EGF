import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react'

// Factory pour créer des contextes avec des patterns communs

export const createAppContext = (contextName, initialState = {}) => {
  const Context = createContext()

  // Hook personnalisé pour utiliser le contexte
  const useAppContext = () => {
    const context = useContext(Context)
    if (!context) {
      throw new Error(`use${contextName} must be used within a ${contextName}Provider`)
    }
    return context
  }

  // Provider de base avec gestion d'erreurs et état unifiés
  const BaseProvider = ({ children, additionalState = {}, methods = {} }) => {
    // États communs à tous les contextes
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    // États personnalisés
    const [customState, setCustomState] = useState({ ...initialState, ...additionalState })

    // Gestion d'erreurs unifiée
    const handleError = useCallback((error, context = '') => {
      const errorMessage = error?.message || 'Une erreur est survenue'
      setError(errorMessage)
      console.error(`${contextName} error in ${context}:`, errorMessage)
    }, [])

    // Clear des erreurs
    const clearError = useCallback(() => {
      setError(null)
    }, [])

    // Wrapper pour les opérations async avec gestion d'erreur et loading
    const withAsyncHandler = useCallback(async (operation, context = '', options = {}) => {
      const { showLoading = true, clearErrorFirst = true } = options

      try {
        if (clearErrorFirst) clearError()
        if (showLoading) setLoading(true)

        const result = await operation()
        return result
      } catch (error) {
        handleError(error, context)
        throw error
      } finally {
        if (showLoading) setLoading(false)
      }
    }, [handleError, clearError])

    // Setter pour l'état personnalisé
    const updateState = useCallback((updates) => {
      setCustomState(prev => ({ ...prev, ...updates }))
    }, [])

    // Valeur du contexte avec méthodes communes
    const value = useMemo(() => ({
      // États communs
      loading,
      error,
      ...customState,

      // Méthodes communes
      setLoading,
      setError,
      clearError,
      handleError,
      withAsyncHandler,
      updateState,

      // Méthodes personnalisées
      ...methods
    }), [
      loading,
      error,
      customState,
      setLoading,
      setError,
      clearError,
      handleError,
      withAsyncHandler,
      updateState,
      methods
    ])

    return (
      <Context.Provider value={value}>
        {children}
      </Context.Provider>
    )
  }

  return {
    Context,
    useAppContext,
    BaseProvider
  }
}

// Pattern pour les contextes avec données Firestore
export const createFirestoreContext = (contextName, collection, initialData = []) => {
  const { Context, useAppContext, BaseProvider } = createAppContext(contextName, {
    data: initialData,
    isSubscribed: false
  })

  // Provider spécialisé pour Firestore
  const FirestoreProvider = ({
    children,
    service,
    subscriptionMethod,
    additionalMethods = {}
  }) => {
    const firestoreMethods = useMemo(() => ({
      // Méthodes CRUD génériques
      create: async (item) => {
        return await service.add(collection, item)
      },

      update: async (id, updates) => {
        return await service.update(collection, id, updates)
      },

      delete: async (id) => {
        return await service.delete(collection, id)
      },

      // Souscription aux changements
      subscribe: (callback) => {
        if (subscriptionMethod) {
          return subscriptionMethod(callback)
        }
        return () => {}
      },

      ...additionalMethods
    }), [service, subscriptionMethod, additionalMethods])

    return (
      <BaseProvider methods={firestoreMethods}>
        {children}
      </BaseProvider>
    )
  }

  return {
    Context,
    useAppContext,
    BaseProvider,
    FirestoreProvider
  }
}

// Utilitaires pour les hooks d'effet communs
export const useAsyncEffect = (asyncFunction, dependencies = [], options = {}) => {
  const { onError, onSuccess, cleanup } = options
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let isMounted = true

    const runAsync = async () => {
      try {
        setLoading(true)
        setError(null)
        const result = await asyncFunction()

        if (isMounted && onSuccess) {
          onSuccess(result)
        }
      } catch (err) {
        if (isMounted) {
          setError(err)
          if (onError) onError(err)
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    runAsync()

    return () => {
      isMounted = false
      if (cleanup) cleanup()
    }
  // Dependencies are intentionally supplied by callers, like React's own hooks.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies)

  return { loading, error }
}

// Pattern pour la gestion des subscriptions
export const useSubscription = (subscribeFunction, dependencies = []) => {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let unsubscribe

    const startSubscription = async () => {
      try {
        setLoading(true)
        setError(null)

        unsubscribe = await subscribeFunction((newData) => {
          setData(newData)
          setLoading(false)
        })
      } catch (err) {
        setError(err)
        setLoading(false)
        console.error('Subscription error:', err.message)
      }
    }

    startSubscription()

    return () => {
      if (unsubscribe) {
        unsubscribe()
      }
    }
  // Dependencies are intentionally supplied by callers, like React's own hooks.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies)

  return { data, loading, error }
}

export default createAppContext
