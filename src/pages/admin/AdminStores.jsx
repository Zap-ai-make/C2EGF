import { useState, useCallback, useEffect } from 'react'
import { listAllStores, getStoreNetworkBalances } from '../../services/adminService'
import { formatCurrency } from '../../utils/formatCurrency'
import PageHeader from '../../components/ui/PageHeader'
import EmptyState from '../../components/ui/EmptyState'
import ErrorState from '../../components/ui/ErrorState'
import StatusBadge from '../../components/ui/StatusBadge'
import { SkeletonTable } from '../../components/ui/SkeletonList'

// ──────────────────────────────────────────────────────────────────────────────
// Panneau de détail boutique
// ──────────────────────────────────────────────────────────────────────────────

function StoreDetail({ store, onClose }) {
  const [balances, setBalances] = useState(null)
  const [balLoading, setBalLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    getStoreNetworkBalances(store.id)
      .then(b => { if (!cancelled) { setBalances(b); setBalLoading(false) } })
      .catch(() => { if (!cancelled) setBalLoading(false) })
    return () => { cancelled = true }
  }, [store.id])

  const orange = balances?.balances?.Orange ?? null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl p-6 overflow-y-auto max-h-[90vh]"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="store-detail-title"
      >
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 id="store-detail-title" className="text-lg font-bold text-gray-900">{store.name}</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>

        <dl className="divide-y divide-gray-100 text-sm mb-6">
          <div className="flex py-2.5">
            <dt className="w-36 flex-shrink-0 text-gray-500">Statut</dt>
            <dd><StatusBadge status={store.active ? 'active' : 'inactive'} label={store.active ? 'Active' : 'Inactive'} /></dd>
          </div>
          {store.email && (
            <div className="flex py-2.5">
              <dt className="w-36 flex-shrink-0 text-gray-500">Email</dt>
              <dd className="text-gray-800">{store.email}</dd>
            </div>
          )}
          {store.adminUid && (
            <div className="flex py-2.5">
              <dt className="w-36 flex-shrink-0 text-gray-500">Admin UID</dt>
              <dd className="text-gray-600 font-mono text-xs break-all">{store.adminUid}</dd>
            </div>
          )}
        </dl>

        <h3 className="text-sm font-semibold text-gray-700 mb-3">Soldes Orange</h3>
        {balLoading ? (
          <div className="space-y-2">
            <div className="h-10 motion-safe:animate-pulse rounded bg-gray-100" />
            <div className="h-10 motion-safe:animate-pulse rounded bg-gray-100" />
          </div>
        ) : orange ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-orange-50 border border-orange-100 p-3 text-center">
              <p className="text-xs text-orange-600 font-medium uppercase tracking-wide">Stock</p>
              <p className="mt-1 text-lg font-bold text-orange-800">{formatCurrency(orange.stock ?? 0)}</p>
            </div>
            <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-center">
              <p className="text-xs text-blue-600 font-medium uppercase tracking-wide">Liquidité</p>
              <p className="mt-1 text-lg font-bold text-blue-800">{formatCurrency(orange.liquidite ?? 0)}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-400">Soldes non disponibles.</p>
        )}

        <p className="mt-6 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-700">
          La modification, la suspension ou la réactivation d'une boutique doit être effectuée par l'administrateur système. Cette vue est en lecture seule.
        </p>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// AdminStores
// ──────────────────────────────────────────────────────────────────────────────

const FILTER_OPTIONS = [
  { value: 'all', label: 'Toutes' },
  { value: 'active', label: 'Actives' },
  { value: 'inactive', label: 'Inactives' },
]

function AdminStores() {
  const [stores, setStores]           = useState([])
  const [lastDoc, setLastDoc]         = useState(null)
  const [hasMore, setHasMore]         = useState(false)
  const [loading, setLoading]         = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError]             = useState(null)
  const [search, setSearch]           = useState('')
  const [activeFilter, setActiveFilter] = useState('all')
  const [selectedStore, setSelectedStore] = useState(null)

  const load = useCallback(async (reset = true) => {
    if (reset) {
      setLoading(true)
      setStores([])
      setLastDoc(null)
      setHasMore(false)
    } else {
      setLoadingMore(true)
    }
    setError(null)

    try {
      const result = await listAllStores({
        lastDoc: reset ? null : lastDoc,
        activeFilter: activeFilter === 'all' ? null : activeFilter === 'active',
        search,
      })
      if (reset) {
        setStores(result.stores)
      } else {
        setStores(prev => [...prev, ...result.stores])
      }
      setLastDoc(result.lastDoc)
      setHasMore(result.hasMore)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [activeFilter, search, lastDoc])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(true) }, [activeFilter, search])

  return (
    <div data-testid="admin-stores">
      <PageHeader
        title="Boutiques"
        subtitle="Liste de toutes les boutiques de la plateforme"
        actions={
          <button
            type="button"
            onClick={() => load(true)}
            disabled={loading}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
          >
            {loading ? 'Chargement…' : 'Actualiser'}
          </button>
        }
      />

      {/* Filtres */}
      <div className="mb-5 flex flex-wrap gap-3">
        <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden">
          {FILTER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setActiveFilter(opt.value)}
              className={`px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 ${
                activeFilter === opt.value
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
              aria-pressed={activeFilter === opt.value}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-48">
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher par nom…"
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-green-400 focus:ring-1 focus:ring-green-400"
            aria-label="Rechercher une boutique dans la page courante"
            title="Recherche dans la page courante (25 résultats max)"
          />
          <p className="mt-0.5 text-[11px] text-gray-400">Recherche dans la page courante</p>
        </div>
      </div>

      {loading && <SkeletonTable rows={6} cols={5} />}

      {error && <ErrorState message={error} onRetry={() => load(true)} />}

      {!loading && !error && stores.length === 0 && (
        <EmptyState title="Aucune boutique" message="Aucune boutique ne correspond aux critères sélectionnés." />
      )}

      {!loading && !error && stores.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-green-50/70">
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-3">Nom</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {stores.map(store => (
                  <tr key={store.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{store.name}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{store.email ?? '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge
                        status={store.active ? 'active' : 'inactive'}
                        label={store.active ? 'Active' : 'Inactive'}
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setSelectedStore(store)}
                        className="text-xs font-medium text-green-600 hover:text-green-800 focus:outline-none focus-visible:underline"
                      >
                        Voir détail
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => load(false)}
                disabled={loadingMore}
                className="rounded-lg border border-gray-200 bg-white px-6 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
              >
                {loadingMore ? 'Chargement…' : 'Charger plus'}
              </button>
            </div>
          )}
        </>
      )}

      {selectedStore && (
        <StoreDetail store={selectedStore} onClose={() => setSelectedStore(null)} />
      )}
    </div>
  )
}

export default AdminStores
