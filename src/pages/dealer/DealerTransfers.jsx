import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../context/AuthContext'
import {
  subscribeIncomingTransfers,
  confirmStoreDealerTransfer,
  rejectStoreDealerTransfer,
} from '../../services/storeTransferService'
import { STORE_TRANSFER_TYPE_LABELS } from '../../constants/dealerConstants'
import { formatCurrency } from '../../utils/formatCurrency'
import { useToast } from '../../hooks/useToast'
import PageHeader from '../../components/ui/PageHeader'
import EmptyState from '../../components/ui/EmptyState'
import ErrorState from '../../components/ui/ErrorState'
import { SkeletonTable } from '../../components/ui/SkeletonList'
import Toast from '../../components/Toast'
import { formatDateTime as formatDate } from '../../utils/formatters'

function DealerTransfers() {
  const { currentUser } = useAuth()
  const { toasts, showToast, removeToast } = useToast()

  const [transfers, setTransfers] = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [actingId, setActingId]   = useState(null)
  const [rejectFor, setRejectFor] = useState(null) // transfer id
  const [reason, setReason]       = useState('')
  // Incrémenté par « Réessayer » pour relancer l'abonnement sans recharger la page.
  const [refreshKey, setRefreshKey] = useState(0)

  const dealerUid = currentUser?.uid

  useEffect(() => {
    if (!dealerUid) return undefined
    setLoading(true)
    const unsub = subscribeIncomingTransfers({
      dealerUid,
      statusFilter: 'pending',
      onUpdate: (list) => { setTransfers(list); setLoading(false); setError(null) },
      onError: (err) => { setError(err.message); setLoading(false) },
    })
    return unsub
  }, [dealerUid, refreshKey])

  const handleConfirm = useCallback(async (id) => {
    setActingId(id)
    try {
      await confirmStoreDealerTransfer(id)
      showToast('Retour confirmé. Inventaire mis à jour.', 'success')
    } catch (err) {
      showToast(err?.message || 'Échec de la confirmation', 'error')
    } finally {
      setActingId(null)
    }
  }, [showToast])

  const handleReject = useCallback(async () => {
    if (!rejectFor) return
    setActingId(rejectFor)
    try {
      await rejectStoreDealerTransfer(rejectFor, reason)
      showToast('Retour rejeté. Le solde de la boutique a été restauré.', 'success')
      setRejectFor(null)
      setReason('')
    } catch (err) {
      showToast(err?.message || 'Échec du rejet', 'error')
    } finally {
      setActingId(null)
    }
  }, [rejectFor, reason, showToast])

  return (
    <div data-testid="dealer-transfers">
      <PageHeader
        title="Retours boutiques"
        subtitle="Retours de stock / liquidité envoyés par les boutiques — à confirmer ou rejeter"
      />

      {loading && <SkeletonTable rows={5} cols={5} />}
      {error && <ErrorState message={error} onRetry={() => { setError(null); setRefreshKey(k => k + 1) }} />}
      {!loading && !error && transfers.length === 0 && (
        <EmptyState title="Aucun retour en attente" message="Les boutiques n'ont envoyé aucun retour pour le moment." />
      )}

      {!loading && !error && transfers.length > 0 && (
        <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-gray-100 shadow-sm">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-green-50/70">
              <tr className="text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Boutique</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Montant</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {transfers.map(t => (
                <tr key={t.id} className="hover:bg-gray-50" data-testid={`transfer-row-${t.id}`}>
                  <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{t.storeName ?? t.storeId}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{STORE_TRANSFER_TYPE_LABELS[t.transferType] ?? t.transferType}</td>
                  <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">{formatCurrency(t.amount)}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{formatDate(t.createdAt)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => handleConfirm(t.id)}
                        disabled={actingId === t.id}
                        className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                        data-testid={`confirm-${t.id}`}
                      >
                        {actingId === t.id ? '…' : 'Confirmer'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setRejectFor(t.id); setReason('') }}
                        disabled={actingId === t.id}
                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                        data-testid={`reject-${t.id}`}
                      >
                        Rejeter
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modale de rejet */}
      {rejectFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900">Rejeter le retour</h2>
            <p className="mt-1 text-sm text-gray-500">Indiquez un motif (3–500 caractères). Le solde de la boutique sera restauré.</p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-green-400 focus:ring-1 focus:ring-green-400"
              placeholder="Motif du rejet…"
            />
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => { setRejectFor(null); setReason('') }}
                disabled={actingId === rejectFor}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleReject}
                disabled={actingId === rejectFor || reason.trim().length < 3}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {actingId === rejectFor ? 'Rejet…' : 'Rejeter'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="fixed top-0 right-0 z-50 space-y-2 p-4">
        {toasts.map(toast => (
          <Toast key={toast.id} message={toast.message} type={toast.type} duration={toast.duration} onClose={() => removeToast(toast.id)} />
        ))}
      </div>
    </div>
  )
}

export default DealerTransfers
