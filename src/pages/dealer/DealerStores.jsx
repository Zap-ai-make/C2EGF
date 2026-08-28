import { useState, useCallback, useEffect } from 'react'
import DealerStoreCard from '../../components/dealer/DealerStoreCard'
import { listActiveStores, getStoreBalances } from '../../services/dealerService'

function DealerStores() {
  const [stores, setStores] = useState([])
  const [balancesMap, setBalancesMap] = useState({})
  const [errorsMap, setErrorsMap] = useState({})
  const [balancesLoading, setBalancesLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [hasLoaded, setHasLoaded] = useState(false)
  const [lastDoc, setLastDoc] = useState(null)
  const [hasMore, setHasMore] = useState(false)

  async function loadBalances(storeList) {
    if (storeList.length === 0) return
    setBalancesLoading(true)
    const results = await Promise.allSettled(storeList.map(s => getStoreBalances(s.id)))
    const balMap = {}
    const errMap = {}
    storeList.forEach((s, i) => {
      const r = results[i]
      if (r.status === 'fulfilled') {
        balMap[s.id] = r.value?.balances ?? null
      } else {
        errMap[s.id] = r.reason?.message ?? 'Erreur inconnue'
      }
    })
    setBalancesMap(prev => ({ ...prev, ...balMap }))
    setErrorsMap(prev => ({ ...prev, ...errMap }))
    setBalancesLoading(false)
  }

  const loadStores = useCallback(async () => {
    setLoading(true)
    setError(null)
    setStores([])
    setBalancesMap({})
    setErrorsMap({})
    setLastDoc(null)
    setHasMore(false)
    try {
      const result = await listActiveStores()
      setStores(result.stores)
      setLastDoc(result.lastDoc)
      setHasMore(result.hasMore)
      setHasLoaded(true)
      await loadBalances(result.stores)
    } catch (err) {
      setError(err.message)
      setHasLoaded(true)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadMore = useCallback(async () => {
    if (!lastDoc || loadingMore) return
    setLoadingMore(true)
    try {
      const result = await listActiveStores({ lastDoc })
      setStores(prev => [...prev, ...result.stores])
      setLastDoc(result.lastDoc)
      setHasMore(result.hasMore)
      await loadBalances(result.stores)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingMore(false)
    }
  }, [lastDoc, loadingMore])

  useEffect(() => {
    loadStores()
  }, [loadStores])

  const filtered = stores.filter(s =>
    s.name?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="max-w-5xl mx-auto" data-testid="dealer-stores">
      {/* Titre + Actualiser */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <h1 className="text-xl font-bold text-gray-800">Boutiques partenaires</h1>
        <button
          type="button"
          onClick={loadStores}
          disabled={loading}
          className="rounded bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600 transition-colors"
          aria-label="Actualiser la liste des boutiques"
        >
          {loading ? 'Chargement…' : 'Actualiser'}
        </button>
      </div>

      {/* Recherche */}
      {hasLoaded && !error && stores.length > 0 && (
        <div className="mb-5">
          <label htmlFor="store-search" className="block text-sm font-medium text-gray-700 mb-1">
            Rechercher sur cette page
          </label>
          <input
            id="store-search"
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Nom de la boutique…"
            className="w-full max-w-xs rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
            aria-label="Rechercher une boutique par nom"
          />
        </div>
      )}

      {/* États */}
      {!hasLoaded && !loading && (
        <div className="bg-white rounded-lg shadow p-10 text-center text-gray-500">
          <p className="mb-4">Appuyez sur <strong>Actualiser</strong> pour charger les boutiques.</p>
        </div>
      )}

      {loading && (
        <div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          aria-busy="true"
          aria-label="Chargement des boutiques"
        >
          {[1, 2, 3].map(n => (
            <div key={n} className="bg-white rounded-lg shadow p-5 motion-safe:animate-pulse">
              <div className="h-5 w-32 bg-gray-200 rounded mb-3" />
              <div className="flex gap-3 mb-4">
                <div className="flex-1 h-14 bg-orange-100 rounded" />
                <div className="flex-1 h-14 bg-blue-100 rounded" />
              </div>
              <div className="flex gap-2">
                <div className="flex-1 h-9 bg-gray-200 rounded" />
                <div className="flex-1 h-9 bg-gray-200 rounded" />
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-lg bg-red-50 border border-red-200 p-5 text-red-700"
        >
          <p className="font-medium mb-1">Erreur de chargement</p>
          <p className="text-sm">{error}</p>
          <button
            type="button"
            onClick={loadStores}
            className="mt-3 rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors"
          >
            Réessayer
          </button>
        </div>
      )}

      {hasLoaded && !loading && !error && stores.length === 0 && (
        <div className="bg-white rounded-lg shadow p-10 text-center text-gray-500">
          Aucune boutique active disponible.
        </div>
      )}

      {hasLoaded && !loading && !error && stores.length > 0 && filtered.length === 0 && (
        <div className="bg-white rounded-lg shadow p-10 text-center text-gray-500">
          Aucune boutique ne correspond à « {search} ».
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(store => (
              <DealerStoreCard
                key={store.id}
                store={store}
                balances={balancesMap[store.id] ?? null}
                balanceError={errorsMap[store.id] ?? null}
                isLoading={balancesLoading}
              />
            ))}
          </div>

          {hasMore && (
            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded bg-gray-100 border border-gray-300 px-6 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 transition-colors"
                data-testid="btn-load-more-stores"
              >
                {loadingMore ? 'Chargement…' : 'Charger plus'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default DealerStores
