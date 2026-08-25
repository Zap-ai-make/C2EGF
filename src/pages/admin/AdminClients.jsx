import { useState, useCallback, useEffect } from 'react'
import { listAllClients, listStoreOptions } from '../../services/adminService'
import PageHeader from '../../components/ui/PageHeader'
import EmptyState from '../../components/ui/EmptyState'
import ErrorState from '../../components/ui/ErrorState'
import { SkeletonTable } from '../../components/ui/SkeletonList'

function AdminClients() {
  const [clients, setClients]         = useState([])
  const [lastDoc, setLastDoc]         = useState(null)
  const [hasMore, setHasMore]         = useState(false)
  const [loading, setLoading]         = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError]             = useState(null)
  const [search, setSearch]           = useState('')
  const [storeId, setStoreId]         = useState('')
  const [storeOptions, setStoreOptions] = useState([])

  // Liste des boutiques (nom → id) pour le sélecteur de filtre.
  useEffect(() => {
    let cancelled = false
    listStoreOptions()
      .then(({ options }) => { if (!cancelled) setStoreOptions(options) })
      .catch(() => { /* sélecteur vide ; la liste reste utilisable */ })
    return () => { cancelled = true }
  }, [])

  const load = useCallback(async (reset = true) => {
    if (reset) {
      setLoading(true)
      setClients([])
      setLastDoc(null)
      setHasMore(false)
    } else {
      setLoadingMore(true)
    }
    setError(null)

    try {
      const result = await listAllClients({
        lastDoc: reset ? null : lastDoc,
        search,
        storeId,
      })
      if (reset) setClients(result.clients)
      else setClients(prev => [...prev, ...result.clients])
      setLastDoc(result.lastDoc)
      setHasMore(result.hasMore)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [search, storeId, lastDoc])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(true) }, [search, storeId])

  return (
    <div data-testid="admin-clients">
      <PageHeader
        title="Agents / Clients"
        subtitle="Base globale des agents et clients enregistrés sur la plateforme"
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
        <div className="flex-1 min-w-48">
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Nom, prénom, téléphone ou code agent…"
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-green-400 focus:ring-1 focus:ring-green-400"
            aria-label="Rechercher dans la page courante"
            title="Recherche dans la page courante (25 résultats max)"
          />
          <p className="mt-0.5 text-[11px] text-gray-400">Recherche dans la page courante</p>
        </div>
        <select
          value={storeId}
          onChange={e => setStoreId(e.target.value)}
          className="w-56 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-green-400 focus:ring-1 focus:ring-green-400"
          aria-label="Filtrer par boutique"
        >
          <option value="">Toutes les boutiques</option>
          {storeOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>

      {loading && <SkeletonTable rows={7} cols={5} />}
      {error && <ErrorState message={error} onRetry={() => load(true)} />}
      {!loading && !error && clients.length === 0 && (
        <EmptyState title="Aucun agent" message="Aucun agent ne correspond aux critères sélectionnés." />
      )}

      {!loading && !error && clients.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-green-50/70">
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-3">Nom</th>
                  <th className="px-4 py-3">Prénom</th>
                  <th className="px-4 py-3">Code agent</th>
                  <th className="px-4 py-3">Téléphone</th>
                  <th className="px-4 py-3">Boutique d'origine</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {clients.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{c.nom ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{c.prenom ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap font-mono text-xs">{c.orange || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap font-mono text-xs">{c.numeroPersonnel || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{c.registeredStoreName ?? '—'}</td>
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
    </div>
  )
}

export default AdminClients
