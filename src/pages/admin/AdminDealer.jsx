import { useState, useCallback, useEffect } from 'react'
import { listAllDealerRequests } from '../../services/adminService'
import { formatCurrency } from '../../utils/formatCurrency'
import { formatDateTime as formatDate } from '../../utils/formatters'
import PageHeader from '../../components/ui/PageHeader'
import EmptyState from '../../components/ui/EmptyState'
import ErrorState from '../../components/ui/ErrorState'
import StatusBadge from '../../components/ui/StatusBadge'
import { SkeletonTable } from '../../components/ui/SkeletonList'

const STATUS_LABELS = { pending: 'En attente', confirmed: 'Confirmée', rejected: 'Rejetée' }
const TYPE_LABELS    = { stock_add: 'Ajout stock', liquidity_add: 'Ajout liquidité' }
const STATUS_OPTIONS = [
  { value: '', label: 'Tous les statuts' },
  { value: 'pending', label: 'En attente' },
  { value: 'confirmed', label: 'Confirmée' },
  { value: 'rejected', label: 'Rejetée' },
]

function RequestDetail({ req, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl p-6 overflow-y-auto max-h-[90vh]"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="req-detail-title"
      >
        <div className="flex items-start justify-between mb-4">
          <h2 id="req-detail-title" className="text-lg font-bold text-gray-900">Détail de la demande</h2>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500" aria-label="Fermer">✕</button>
        </div>

        <dl className="divide-y divide-gray-100 text-sm">
          {[
            ['Boutique', req.targetStoreName],
            ['Dealer', req.dealerName],
            ['Email dealer', req.dealerEmail],
            ['Type', TYPE_LABELS[req.requestType] ?? req.requestType],
            ['Montant', formatCurrency(req.amount)],
            ['Réseau', req.network ?? '—'],
            ['Statut', STATUS_LABELS[req.status] ?? req.status],
            ['Créée le', formatDate(req.createdAt)],
            ['Traitée le', req.confirmedAt ? formatDate(req.confirmedAt) : req.rejectedAt ? formatDate(req.rejectedAt) : '—'],
            ['Solde avant', req.previousBalance != null ? formatCurrency(req.previousBalance) : '—'],
            ['Solde après', req.newBalance != null ? formatCurrency(req.newBalance) : '—'],
            ['Motif rejet', req.rejectionReason ?? '—'],
          ].map(([label, value]) => (
            <div key={label} className="flex py-2.5">
              <dt className="w-36 flex-shrink-0 text-gray-500">{label}</dt>
              <dd className="text-gray-800 break-words">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}

function AdminDealer() {
  const [requests, setRequests]       = useState([])
  const [lastDoc, setLastDoc]         = useState(null)
  const [hasMore, setHasMore]         = useState(false)
  const [loading, setLoading]         = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError]             = useState(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [dealerSearch, setDealerSearch] = useState('')
  const [storeSearch, setStoreSearch]   = useState('')
  const [selectedReq, setSelectedReq]   = useState(null)

  const load = useCallback(async (reset = true) => {
    if (reset) {
      setLoading(true)
      setRequests([])
      setLastDoc(null)
      setHasMore(false)
    } else {
      setLoadingMore(true)
    }
    setError(null)

    try {
      const result = await listAllDealerRequests({
        lastDoc: reset ? null : lastDoc,
        statusFilter: statusFilter || null,
        dealerSearch,
        storeSearch,
      })
      if (reset) setRequests(result.requests)
      else setRequests(prev => [...prev, ...result.requests])
      setLastDoc(result.lastDoc)
      setHasMore(result.hasMore)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [statusFilter, dealerSearch, storeSearch, lastDoc])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(true) }, [statusFilter, dealerSearch, storeSearch])

  return (
    <div data-testid="admin-dealer">
      <PageHeader
        title="Supervision Dealer"
        subtitle="Toutes les demandes Dealer de la plateforme"
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
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-green-400 focus:ring-1 focus:ring-green-400"
          aria-label="Filtrer par statut"
        >
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input
          type="search"
          value={dealerSearch}
          onChange={e => setDealerSearch(e.target.value)}
          placeholder="Dealer (nom ou email)…"
          className="flex-1 min-w-40 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-green-400 focus:ring-1 focus:ring-green-400"
          aria-label="Rechercher par dealer dans la page courante"
          title="Recherche dans la page courante (25 résultats max)"
        />
        <input
          type="search"
          value={storeSearch}
          onChange={e => setStoreSearch(e.target.value)}
          placeholder="Boutique…"
          className="flex-1 min-w-40 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-green-400 focus:ring-1 focus:ring-green-400"
          aria-label="Rechercher par boutique dans la page courante"
          title="Recherche dans la page courante (25 résultats max)"
        />
      </div>
      <p className="-mt-3 mb-4 text-[11px] text-gray-400">Recherche dans la page courante (25 demandes max)</p>

      {loading && <SkeletonTable rows={6} cols={6} />}
      {error && <ErrorState message={error} onRetry={() => load(true)} />}
      {!loading && !error && requests.length === 0 && (
        <EmptyState title="Aucune demande" message="Aucune demande ne correspond aux critères sélectionnés." />
      )}

      {!loading && !error && requests.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-green-50/70">
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-3">Boutique</th>
                  <th className="px-4 py-3">Dealer</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Montant</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Détail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {requests.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{r.targetStoreName}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{r.dealerName}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{TYPE_LABELS[r.requestType] ?? r.requestType}</td>
                    <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">{formatCurrency(r.amount)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={r.status} label={STATUS_LABELS[r.status] ?? r.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{formatDate(r.createdAt)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setSelectedReq(r)}
                        className="text-xs font-medium text-green-600 hover:text-green-800 focus:outline-none focus-visible:underline"
                      >
                        Voir
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

      {selectedReq && (
        <RequestDetail req={selectedReq} onClose={() => setSelectedReq(null)} />
      )}
    </div>
  )
}

export default AdminDealer
