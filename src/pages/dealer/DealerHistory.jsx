import { useState, useCallback, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import { listDealerRequests } from '../../services/dealerService'
import { subscribePartnerDeposits } from '../../services/storeTransferService'
import { partnerLabel } from '../../constants/dealerPartners'
import { formatCurrency } from '../../utils/formatCurrency'
import {
  DEALER_REQUEST_STATUS_LABELS,
  DEALER_REQUEST_TYPE_LABELS,
  DEALER_REQUEST_STATUSES,
} from '../../constants/dealerConstants'
import PageHeader from '../../components/ui/PageHeader'
import EmptyState from '../../components/ui/EmptyState'
import ErrorState from '../../components/ui/ErrorState'
import StatusBadge from '../../components/ui/StatusBadge'
import { SkeletonTable } from '../../components/ui/SkeletonList'
import RejectionRemarkButton from '../../components/ui/RejectionRemarkButton'
import { formatDateTime as formatDate } from '../../utils/formatters'

const ms = (ts) => ts?.toMillis?.() ?? (ts ? new Date(ts).getTime() : 0)

const STATUS_OPTIONS = [
  { value: '', label: 'Tous les statuts' },
  { value: DEALER_REQUEST_STATUSES.PENDING, label: DEALER_REQUEST_STATUS_LABELS.pending },
  { value: DEALER_REQUEST_STATUSES.CONFIRMED, label: DEALER_REQUEST_STATUS_LABELS.confirmed },
  { value: DEALER_REQUEST_STATUSES.REJECTED, label: DEALER_REQUEST_STATUS_LABELS.rejected },
]

function DealerHistory() {
  const { currentUser, userProfile } = useAuth()

  const [requests, setRequests]       = useState([])
  const [partnerDeposits, setPartnerDeposits] = useState([])
  const [lastDoc, setLastDoc]         = useState(null)
  const [hasMore, setHasMore]         = useState(false)
  const [loading, setLoading]         = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError]             = useState(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [storeSearch, setStoreSearch]   = useState('')

  const load = useCallback(async (reset = true) => {
    if (!currentUser || !userProfile) return
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
      const result = await listDealerRequests({
        currentUser,
        userProfile,
        statusFilter: statusFilter || null,
        lastDoc: reset ? null : lastDoc,
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
  }, [currentUser, userProfile, statusFilter, lastDoc])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(true) }, [statusFilter, currentUser, userProfile])

  // Dépôts partenaires (temps réel)
  useEffect(() => {
    if (!currentUser?.uid) { setPartnerDeposits([]); return undefined }
    return subscribePartnerDeposits({ dealerUid: currentUser.uid, onUpdate: setPartnerDeposits })
  }, [currentUser])

  // Fusion demandes + dépôts partenaires en lignes normalisées, triées par date.
  const requestRows = requests.map(r => ({
    id: r.id, kind: 'request',
    label: r.targetStoreName ?? '—',
    typeLabel: DEALER_REQUEST_TYPE_LABELS[r.requestType] ?? r.requestType,
    amount: r.amount,
    status: r.status,
    rejectionReason: r.status === DEALER_REQUEST_STATUSES.REJECTED ? r.rejectionReason : null,
    soldeApres: r.newBalance != null ? r.newBalance : null,
    createdAt: r.createdAt,
  }))
  const partnerRows = partnerDeposits.map(d => ({
    id: d.id, kind: 'partner',
    label: partnerLabel({ nom: d.partnerNom, prenom: d.partnerPrenom, localite: d.partnerLocalite, numeroDA: d.partnerNumeroDA }),
    typeLabel: d.operation === 'withdrawal' ? 'Retrait partenaire' : 'Dépôt partenaire',
    amount: d.amount,
    status: 'confirmed',
    rejectionReason: null,
    soldeApres: d.newStock != null ? d.newStock : null,
    createdAt: d.createdAt,
  }))

  const search = storeSearch.trim().toLowerCase()
  let rows = [...requestRows, ...partnerRows]
  if (statusFilter) rows = rows.filter(r => r.status === statusFilter)
  if (search) rows = rows.filter(r => r.label.toLowerCase().includes(search))
  rows.sort((a, b) => ms(b.createdAt) - ms(a.createdAt))

  return (
    <div data-testid="dealer-history">
      <PageHeader
        title="Historique"
        subtitle="Mes ravitaillements de boutiques et dépôts partenaires"
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
          value={storeSearch}
          onChange={e => setStoreSearch(e.target.value)}
          placeholder="Filtrer par boutique / partenaire…"
          className="flex-1 min-w-40 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-green-400 focus:ring-1 focus:ring-green-400"
          aria-label="Rechercher par boutique ou partenaire"
        />
      </div>

      {loading && <SkeletonTable rows={6} cols={6} />}
      {error && <ErrorState message={error} onRetry={() => load(true)} />}
      {!loading && !error && rows.length === 0 && (
        <EmptyState title="Aucune opération" message="Aucune opération ne correspond aux critères sélectionnés." />
      )}

      {!loading && !error && rows.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-green-50/70">
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-3">Boutique / Partenaire</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Montant</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3">Remarque</th>
                  <th className="px-4 py-3">Solde après</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map(r => (
                  <tr key={`${r.kind}-${r.id}`} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{r.label}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{r.typeLabel}</td>
                    <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">{formatCurrency(r.amount)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={r.status} label={DEALER_REQUEST_STATUS_LABELS[r.status] ?? r.status} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <RejectionRemarkButton storeName={r.label} reason={r.rejectionReason} testId={`remark-btn-${r.id}`} />
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {r.soldeApres != null ? formatCurrency(r.soldeApres) : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{formatDate(r.createdAt)}</td>
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
                {loadingMore ? 'Chargement…' : 'Charger plus (ravitaillements)'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default DealerHistory
