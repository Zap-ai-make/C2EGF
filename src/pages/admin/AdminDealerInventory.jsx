import { useState, useCallback, useEffect } from 'react'
import { listDealerInventoryMovements } from '../../services/adminService'
import { formatCurrency } from '../../utils/formatCurrency'
import { formatDateTime as formatDate } from '../../utils/formatters'
import { DEALER_NETWORKS, IS_DEALER_MULTI_NETWORK } from '../../constants/dealerConstants'
import { NETWORK_CONFIG } from '../../constants/networkConfig'
import PageHeader from '../../components/ui/PageHeader'
import EmptyState from '../../components/ui/EmptyState'
import ErrorState from '../../components/ui/ErrorState'
import { SkeletonTable } from '../../components/ui/SkeletonList'

const SENS_STYLES = {
  '+': 'text-green-700 bg-green-50',
  '−': 'text-red-700 bg-red-50',
  '±': 'text-amber-700 bg-amber-50',
}

function BalanceCard({ label, value, icon, tint, dotColor }) {
  return (
    <div className={`flex-1 min-w-40 rounded-xl border border-gray-100 bg-gradient-to-br ${tint} to-white px-4 py-3`}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          {dotColor && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: dotColor }} aria-hidden="true" />}
          {label}
        </span>
        <span className="text-lg" aria-hidden="true">{icon}</span>
      </div>
      <p className="mt-0.5 text-xl font-bold text-gray-900">{formatCurrency(value)}</p>
    </div>
  )
}

function AdminDealerInventory() {
  const [dealerUid, setDealerUid]   = useState(null)
  const [dealerName, setDealerName] = useState(null)
  const [balance, setBalance]       = useState({ stock: 0, liquidite: 0 })
  const [byNetwork, setByNetwork]   = useState({})   // solde par réseau (multi-réseaux)
  const [totalLiquidite, setTotalLiquidite] = useState(0) // somme des liquidités réseau
  const [movements, setMovements]   = useState([])
  const [lastDoc, setLastDoc]       = useState(null)
  const [hasMore, setHasMore]       = useState(false)
  const [loading, setLoading]       = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError]           = useState(null)
  const [multipleDealers, setMultipleDealers] = useState(false)

  const load = useCallback(async (reset = true) => {
    if (reset) { setLoading(true); setMovements([]); setLastDoc(null); setHasMore(false) }
    else setLoadingMore(true)
    setError(null)
    try {
      const result = await listDealerInventoryMovements({
        lastDoc: reset ? null : lastDoc,
        dealerUid: reset ? null : dealerUid,
      })
      setDealerUid(result.dealerUid)
      setDealerName(result.dealerName)
      setBalance(result.balance)
      setByNetwork(result.byNetwork ?? {})
      setTotalLiquidite(result.totalLiquidite ?? 0)
      if (reset) setMultipleDealers(!!result.multipleActiveDealers)
      if (reset) setMovements(result.movements)
      else setMovements(prev => [...prev, ...result.movements])
      setLastDoc(result.lastDoc)
      setHasMore(result.hasMore)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [lastDoc, dealerUid])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(true) }, [])

  return (
    <div data-testid="admin-dealer-inventory">
      <PageHeader
        title="Inventaire Dealer"
        subtitle={dealerName ? `Mouvements de stock et liquidité — ${dealerName}` : 'Mouvements de stock et liquidité du dealer'}
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

      {multipleDealers && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          ⚠️ Plusieurs dealers actifs détectés — l'inventaire affiché ne concerne qu'un seul d'entre eux. Vérifiez la configuration des comptes dealer.
        </div>
      )}

      {/* Solde courant — mono-réseau : Stock/Liquidité (Orange). Multi-réseaux :
          une carte Stock par réseau + une carte Liquidité globale (somme). */}
      {IS_DEALER_MULTI_NETWORK ? (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {DEALER_NETWORKS.map(net => (
            <BalanceCard
              key={net}
              label={NETWORK_CONFIG[net]?.name ?? net}
              value={byNetwork[net]?.stock ?? 0}
              icon="📦"
              tint="from-blue-50"
              dotColor={NETWORK_CONFIG[net]?.color}
            />
          ))}
          <BalanceCard label="Liquidité" value={totalLiquidite} icon="💵" tint="from-teal-50" />
        </div>
      ) : (
        <div className="mb-5 flex flex-col gap-3 sm:flex-row">
          <BalanceCard label="Stock (Orange)" value={balance.stock} icon="📦" tint="from-blue-50" />
          <BalanceCard label="Liquidité (Orange)" value={balance.liquidite} icon="💵" tint="from-teal-50" />
        </div>
      )}

      {loading && <SkeletonTable rows={6} cols={6} />}
      {error && <ErrorState message={error} onRetry={() => load(true)} />}
      {!loading && !error && movements.length === 0 && (
        <EmptyState title="Aucun mouvement" message="Aucun mouvement d'inventaire dealer à afficher." />
      )}

      {!loading && !error && movements.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-green-50/70">
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Ressource</th>
                  <th className="px-4 py-3">Sens</th>
                  <th className="px-4 py-3">Montant</th>
                  <th className="px-4 py-3">Solde après</th>
                  <th className="px-4 py-3">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {movements.map(m => (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{formatDate(m.createdAt)}</td>
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{m.type}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{m.resourceLabel}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded px-1.5 text-xs font-bold ${SENS_STYLES[m.sens] ?? 'text-gray-500 bg-gray-50'}`}>
                        {m.sens || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">{formatCurrency(m.amount)}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {m.action === 'PARTNER_DEPOSIT'
                        ? `Stock ${formatCurrency(m.newStock)} · Liq. ${formatCurrency(m.newLiquidite)}`
                        : (m.soldeApres != null ? formatCurrency(m.soldeApres) : '—')}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{m.source}</td>
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

export default AdminDealerInventory
