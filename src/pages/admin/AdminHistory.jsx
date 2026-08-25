import { useState, useCallback, useEffect, useRef } from 'react'
import { listConsolidatedHistory, listStoreHistory, listStoreOptions } from '../../services/adminService'
import { formatCurrency } from '../../utils/formatCurrency'
import { formatDateTime as formatDate } from '../../utils/formatters'
import EmptyState from '../../components/ui/EmptyState'
import ErrorState from '../../components/ui/ErrorState'
import StatusBadge from '../../components/ui/StatusBadge'
import { SkeletonTable } from '../../components/ui/SkeletonList'

// Nom du client : les transactions stockent l'objet `client` (nom/prénom) ;
// `clientNom` (aplati) n'existe pas → on le reconstruit, avec repli legacy.
function clientName(r) {
  const full = [r.client?.prenom, r.client?.nom].filter(Boolean).join(' ').trim()
  return full || r.clientNom || '—'
}
// Code / numéro agent : `code` (agent du réseau de la transaction) ou `client.orange`.
function agentCode(r) {
  return r.code || r.client?.orange || '—'
}

function statusVariant(statut) {
  if (!statut) return 'inactive'
  const s = String(statut).toLowerCase()
  if (s.includes('validée') || s.includes('validee') || s.includes('payé') || s.includes('encaissé')) return 'confirmed'
  if (s.includes('non terminée') || s.includes('non terminee')) return 'pending'
  if (s.includes('remboursée') || s.includes('remboursee') || s.includes('annulée') || s.includes('annulee')) return 'rejected'
  return 'inactive'
}

function AdminHistory() {
  const [records, setRecords]         = useState([])
  const [storeNameMap, setStoreNameMap] = useState(null)
  const [storeOptions, setStoreOptions] = useState([])
  const [storeFilter, setStoreFilter] = useState('') // '' = toutes les boutiques
  const [hasMore, setHasMore]         = useState(false)
  const [loading, setLoading]         = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError]             = useState(null)
  const [search, setSearch]           = useState('')

  const lastDocRef = useRef(null)

  // Chargement (une fois) de la liste des boutiques pour le sélecteur de filtre.
  useEffect(() => {
    let cancelled = false
    listStoreOptions()
      .then(({ map, options }) => {
        if (cancelled) return
        setStoreNameMap(map)
        setStoreOptions(options)
      })
      .catch(() => { /* le sélecteur reste vide ; l'historique consolidé fonctionne */ })
    return () => { cancelled = true }
  }, [])

  const load = useCallback(async (reset, currentStoreMap = null) => {
    if (reset) {
      setLoading(true)
      setRecords([])
      lastDocRef.current = null
      setHasMore(false)
    } else {
      setLoadingMore(true)
    }
    setError(null)

    try {
      // Filtre par boutique → requête serveur dédiée sur la sous-collection de
      // la boutique (tout son historique). Sinon → historique consolidé.
      const result = storeFilter
        ? await listStoreHistory({
            storeId: storeFilter,
            storeName: (currentStoreMap ?? storeNameMap)?.[storeFilter],
            lastDoc: reset ? null : lastDocRef.current,
          })
        : await listConsolidatedHistory({
            lastDoc: reset ? null : lastDocRef.current,
            search,
            storeNameMap: currentStoreMap ?? storeNameMap,
          })

      if (reset) {
        setRecords(result.records)
        if (result.storeNameMap) setStoreNameMap(result.storeNameMap)
      } else {
        setRecords(prev => {
          const combined = [...prev, ...result.records]
          combined.sort((a, b) => {
            const ta = a.createdAt?.toMillis?.() ?? (a.createdAt ? new Date(a.createdAt).getTime() : 0)
            const tb = b.createdAt?.toMillis?.() ?? (b.createdAt ? new Date(b.createdAt).getTime() : 0)
            return tb - ta
          })
          return combined
        })
      }
      lastDocRef.current = result.lastDoc
      setHasMore(result.hasMore)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [search, storeFilter, storeNameMap])

  useEffect(() => {
    load(true, storeNameMap)
  }, [search, storeFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(() => {
    load(true, storeNameMap)
  }, [load, storeNameMap])

  // Quand une boutique est sélectionnée, `search` affine côté client la liste
  // (déjà complète pour cette boutique). En vue consolidée, le filtrage `search`
  // est fait par le service (limité à la page courante).
  const visibleRecords = storeFilter && search.trim()
    ? records.filter(r => {
        const q = search.trim().toLowerCase()
        return (
          clientName(r).toLowerCase().includes(q) ||
          agentCode(r).toLowerCase().includes(q) ||
          r.type?.toLowerCase().includes(q)
        )
      })
    : records

  return (
    <div data-testid="admin-history" className="min-h-screen bg-gray-50/60">

      {/* ── Hero header ─────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-100 px-6 py-6 mb-6">
        <div className="flex items-start justify-between gap-4 max-w-7xl mx-auto">
          <div>
            <h1 className="text-2xl font-black text-gray-900 tracking-tight">Historique consolidé</h1>
            <p className="mt-0.5 text-sm text-gray-500">Transactions de toutes les boutiques — lecture seule</p>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 hover:border-gray-300 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 disabled:opacity-50"
          >
            <svg className="h-4 w-4 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Actualiser
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 pb-10 space-y-5">

        {/* ── Filtres ───────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start gap-3">
          <div>
            <select
              value={storeFilter}
              onChange={e => setStoreFilter(e.target.value)}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm shadow-sm focus:outline-none focus:border-green-400 focus:ring-1 focus:ring-green-400"
              aria-label="Filtrer par boutique"
            >
              <option value="">Toutes les boutiques</option>
              {storeOptions.map(o => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-gray-400">
              {storeFilter
                ? 'Historique complet de la boutique sélectionnée'
                : 'Toutes boutiques — chargées par pages de 25'}
            </p>
          </div>
          <div>
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher agent, client…"
              className="w-full max-w-md rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm shadow-sm focus:outline-none focus:border-green-400 focus:ring-1 focus:ring-green-400"
              aria-label="Rechercher"
            />
            <p className="mt-1 text-[11px] text-gray-400">
              {storeFilter
                ? 'Affine la liste de la boutique'
                : 'Recherche dans la page courante (25 résultats max)'}
            </p>
          </div>
        </div>

        {/* ── États ─────────────────────────────────────────────────────────── */}
        {loading && <SkeletonTable rows={8} cols={7} />}
        {error && <ErrorState message={error} onRetry={refresh} />}
        {/* Vide ET rien de plus à charger → aucune donnée. Si `hasMore`, on
            garde le bouton « Charger plus » accessible (voir bloc suivant). */}
        {!loading && !error && visibleRecords.length === 0 && !hasMore && (
          <EmptyState title="Aucune transaction" message="Aucune transaction ne correspond aux critères sélectionnés." />
        )}

        {/* ── Tableau ───────────────────────────────────────────────────────── */}
        {!loading && !error && (visibleRecords.length > 0 || hasMore) && (
          <>
            {visibleRecords.length === 0 && hasMore && (
              <p className="rounded-xl border border-gray-100 bg-white px-4 py-3 text-sm text-gray-500">
                Aucun résultat dans la portion chargée. Chargez plus pour poursuivre la recherche.
              </p>
            )}
            {visibleRecords.length > 0 && (
            <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead className="bg-green-50/70">
                  <tr className="text-left text-xs font-semibold uppercase tracking-widest text-gray-400">
                    <th className="px-5 py-3.5">Boutique</th>
                    <th className="px-5 py-3.5">Type</th>
                    <th className="px-5 py-3.5">Montant</th>
                    <th className="px-5 py-3.5">Statut</th>
                    <th className="px-5 py-3.5">Client</th>
                    <th className="px-5 py-3.5">Code agent</th>
                    <th className="px-5 py-3.5">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {visibleRecords.map(r => (
                    <tr key={r.id + (r.storeId ?? '')} className="hover:bg-gray-50/60 transition-colors">
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <p className="text-sm font-semibold text-gray-800 truncate max-w-[140px]">{r.storeName ?? r.storeId ?? '—'}</p>
                      </td>
                      <td className="px-5 py-3.5 text-gray-600 whitespace-nowrap text-xs">{r.type ?? '—'}</td>
                      <td className="px-5 py-3.5 font-semibold text-gray-900 whitespace-nowrap">
                        {r.montant != null ? formatCurrency(r.montant) : '—'}
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        {r.statut ? (
                          <StatusBadge status={statusVariant(r.statut)} label={r.statut} />
                        ) : '—'}
                      </td>
                      <td className="px-5 py-3.5 text-gray-700 whitespace-nowrap text-xs">{clientName(r)}</td>
                      <td className="px-5 py-3.5 text-gray-500 whitespace-nowrap font-mono text-xs">{agentCode(r)}</td>
                      <td className="px-5 py-3.5 text-gray-400 text-xs whitespace-nowrap">{formatDate(r.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}

            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-400">{visibleRecords.length} résultat{visibleRecords.length > 1 ? 's' : ''} affiché{visibleRecords.length > 1 ? 's' : ''}</p>
              {hasMore && (
                <button
                  type="button"
                  onClick={() => load(false, storeNameMap)}
                  disabled={loadingMore}
                  className="rounded-xl border border-gray-200 bg-white px-5 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                >
                  {loadingMore ? 'Chargement…' : 'Charger plus'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default AdminHistory
