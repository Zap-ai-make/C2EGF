import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { listActiveStores, listDealerRequests, subscribeDealerPendingCount } from '../../services/dealerService'
import { subscribeIncomingTransfersCount } from '../../services/storeTransferService'
import { formatCurrency } from '../../utils/formatCurrency'
import { formatDateTime as formatDate } from '../../utils/formatters'
import StatCard from '../../components/ui/StatCard'
import PageHeader from '../../components/ui/PageHeader'
import ErrorState from '../../components/ui/ErrorState'
import EmptyState from '../../components/ui/EmptyState'
import StatusBadge from '../../components/ui/StatusBadge'
import { SkeletonCards } from '../../components/ui/SkeletonList'
import RejectionRemarkButton from '../../components/ui/RejectionRemarkButton'
import { DEALER_REQUEST_STATUSES } from '../../constants/dealerConstants'
import { CARD, TABLE_WRAP, TABLE_HEAD } from '../../constants/workspaceTheme'

const STATUS_LABELS = { pending: 'En attente', confirmed: 'Confirmée', rejected: 'Rejetée' }
const TYPE_LABELS   = { stock_add: 'Ajout stock', liquidity_add: 'Ajout liquidité' }

function DealerDashboard() {
  const { currentUser, userProfile } = useAuth()
  const navigate = useNavigate()

  const [pendingCount, setPendingCount]   = useState(0)
  const [transfersCount, setTransfersCount] = useState(0)
  const [storeCount, setStoreCount]       = useState(null)
  const [recentReqs, setRecentReqs]       = useState([])
  const [kpiLoading, setKpiLoading]       = useState(true)
  const [reqsLoading, setReqsLoading]     = useState(true)
  const [kpiError, setKpiError]           = useState(null)
  const [reqsError, setReqsError]         = useState(null)

  // Compteur pending en temps réel via subscription
  useEffect(() => {
    const unsub = subscribeDealerPendingCount({
      currentUser,
      userProfile,
      onUpdate: setPendingCount,
    })
    return unsub
  }, [currentUser, userProfile])

  // Retours boutiques en attente (temps réel)
  useEffect(() => {
    if (userProfile?.role !== 'dealer' || !currentUser?.uid) return undefined
    return subscribeIncomingTransfersCount({ dealerUid: currentUser.uid, onUpdate: setTransfersCount })
  }, [currentUser, userProfile])

  const loadKpi = useCallback(async () => {
    setKpiLoading(true)
    setKpiError(null)
    try {
      const result = await listActiveStores()
      setStoreCount(result.stores.length + (result.hasMore ? '+' : ''))
    } catch (err) {
      setKpiError(err.message)
    } finally {
      setKpiLoading(false)
    }
  }, [])

  const loadRecentReqs = useCallback(async () => {
    if (!currentUser || !userProfile) return
    setReqsLoading(true)
    setReqsError(null)
    try {
      const result = await listDealerRequests({ currentUser, userProfile })
      setRecentReqs(result.requests.slice(0, 8))
    } catch (err) {
      setReqsError(err.message)
    } finally {
      setReqsLoading(false)
    }
  }, [currentUser, userProfile])

  useEffect(() => {
    loadKpi()
    loadRecentReqs()
  }, [loadKpi, loadRecentReqs])

  return (
    <div data-testid="dealer-home">
      <PageHeader
        title="Vue générale"
        subtitle={`Bonjour ${userProfile?.name ?? ''} 👋`}
        actions={
          <button
            type="button"
            onClick={() => { loadKpi(); loadRecentReqs() }}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
          >
            Actualiser
          </button>
        }
      />

      {/* KPI */}
      <section aria-labelledby="kpi-heading" className="mb-8">
        <h2 id="kpi-heading" className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-400">
          Indicateurs
        </h2>
        {kpiError ? (
          <ErrorState message={kpiError} onRetry={loadKpi} />
        ) : kpiLoading ? (
          <SkeletonCards count={4} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Boutiques partenaires" value={storeCount ?? '—'} color="green" icon="🏪" />
            <StatCard
              label="Demandes en attente"
              value={pendingCount}
              color={pendingCount > 0 ? 'amber' : 'green'}
              icon="📋"
              onClick={() => navigate('/dealer/requests')}
            />
            <StatCard
              label="Retours en attente"
              value={transfersCount}
              color={transfersCount > 0 ? 'amber' : 'green'}
              icon="📥"
              onClick={() => navigate('/dealer/transfers')}
            />
            <StatCard label="Mes demandes récentes" value={recentReqs.length} color="teal" icon="📊" />
          </div>
        )}
      </section>

      {/* Demandes récentes */}
      <section aria-labelledby="recent-heading">
        <div className="flex items-center justify-between mb-4">
          <h2 id="recent-heading" className="text-sm font-semibold uppercase tracking-wider text-gray-400">
            Mes dernières demandes
          </h2>
          <button
            type="button"
            onClick={() => navigate('/dealer/requests')}
            className="text-xs font-medium text-green-600 hover:text-green-800 focus:outline-none focus-visible:underline"
          >
            Voir tout →
          </button>
        </div>

        {reqsError && <ErrorState message={reqsError} onRetry={loadRecentReqs} />}
        {reqsLoading && !reqsError && (
          <div className={`${CARD} space-y-2 p-5`}>
            {[1, 2, 3].map(n => <div key={n} className="h-10 animate-pulse rounded bg-gray-100" />)}
          </div>
        )}
        {!reqsLoading && !reqsError && recentReqs.length === 0 && (
          <div className={`${CARD} p-5`}>
            <EmptyState title="Aucune demande" message="Créez votre première demande avec le bouton ci-dessus." />
          </div>
        )}
        {!reqsLoading && !reqsError && recentReqs.length > 0 && (
          <div className={TABLE_WRAP}>
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className={TABLE_HEAD}>
                <tr className="text-left text-xs font-medium uppercase tracking-wider">
                  <th className="px-4 py-3">Boutique</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Montant</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3">Remarque</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {recentReqs.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">{r.targetStoreName}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{TYPE_LABELS[r.requestType] ?? r.requestType}</td>
                    <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">{formatCurrency(r.amount)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={r.status} label={STATUS_LABELS[r.status] ?? r.status} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <RejectionRemarkButton
                        storeName={r.targetStoreName}
                        reason={r.status === DEALER_REQUEST_STATUSES.REJECTED ? r.rejectionReason : null}
                        testId={`remark-btn-${r.id}`}
                      />
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{formatDate(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

export default DealerDashboard
