import { useState, useCallback, useEffect } from 'react'
import DealerStoreCard from '../../components/dealer/DealerStoreCard'
import { listActiveStores, getStoreBalances } from '../../services/dealerService'
import { BTN_SECOND } from '../../constants/workspaceTheme'

/**
 * Les boutiques partenaires — repeintes, et débarrassées d'un état mort.
 *
 * ⚠ UNE SUPPRESSION DANS UN LOT DE PEINTURE, DÉCLARÉE COMME TELLE.
 *   L'écran ouvrait sur « Appuyez sur **Actualiser** pour charger les
 *   boutiques. » Or `loadStores()` part au montage : cette phrase n'est vraie à
 *   aucun moment où on peut la lire. Elle n'est pas seulement morte — elle est
 *   FAUSSE, et elle demande un geste inutile pendant la seule frame où elle
 *   s'affiche. La spec S5 la nomme explicitement (relevé en S1) ; c'est la
 *   seule ligne de ce lot qui ne soit pas une valeur de `className`.
 *
 * ⚠ Cet écran fait double emploi avec l'accueil depuis S4 — 20 boutiques par
 *   page, une requête de solde par boutique, recherche limitée à la page
 *   courante. Son sort est une décision client : supprimer un écran routé ne se
 *   décide pas au motif qu'un autre le couvre mieux.
 */
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
        <h1 className="text-xl font-bold text-ink">Boutiques partenaires</h1>
        <button
          type="button"
          onClick={loadStores}
          disabled={loading}
          className={BTN_SECOND}
          aria-label="Actualiser la liste des boutiques"
        >
          {loading ? 'Chargement…' : 'Actualiser'}
        </button>
      </div>

      {/* Recherche */}
      {hasLoaded && !error && stores.length > 0 && (
        <div className="mb-5">
          <label htmlFor="store-search" className="mb-1 block text-sm font-medium text-ink">
            Rechercher sur cette page
          </label>
          <input
            id="store-search"
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Nom de la boutique…"
            className="w-full max-w-xs rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
            aria-label="Rechercher une boutique par nom"
          />
        </div>
      )}

      {/* États */}
      {loading && (
        <div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          aria-busy="true"
          aria-label="Chargement des boutiques"
        >
          {[1, 2, 3].map(n => (
            <div key={n} className="rounded-2xl bg-surface p-5 shadow-sm ring-1 ring-gray-100 motion-safe:animate-pulse">
              <div className="mb-3 h-5 w-32 rounded bg-gray-200" />
              <div className="flex gap-3 mb-4">
                <div className="h-14 flex-1 rounded bg-gray-200" />
                <div className="h-14 flex-1 rounded bg-gray-200" />
              </div>
              <div className="flex gap-2">
                <div className="h-9 flex-1 rounded bg-gray-200" />
                <div className="h-9 flex-1 rounded bg-gray-200" />
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-danger/30 bg-danger-soft p-5 text-danger"
        >
          <p className="font-medium mb-1">Erreur de chargement</p>
          <p className="text-sm">{error}</p>
          <button
            type="button"
            onClick={loadStores}
            className="mt-3 rounded-lg bg-danger px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-danger/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
          >
            Réessayer
          </button>
        </div>
      )}

      {hasLoaded && !loading && !error && stores.length === 0 && (
        <div className="rounded-xl border border-dashed border-line bg-surface p-10 text-center text-ink-muted">
          Aucune boutique active disponible.
        </div>
      )}

      {hasLoaded && !loading && !error && stores.length > 0 && filtered.length === 0 && (
        <div className="rounded-xl border border-dashed border-line bg-surface p-10 text-center text-ink-muted">
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
                className={BTN_SECOND}
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
