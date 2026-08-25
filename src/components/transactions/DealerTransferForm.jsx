import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../hooks/useToast'
import { useSimpleNetworkData } from '../../hooks/useSimpleNetworkData'
import {
  createStoreDealerTransfer,
  subscribeStoreTransfers,
} from '../../services/storeTransferService'
import {
  STORE_TRANSFER_TYPES,
  STORE_TRANSFER_TYPE_LABELS,
  DEALER_REQUEST_STATUS_LABELS,
  DEALER_NETWORKS,
  IS_DEALER_MULTI_NETWORK,
} from '../../constants/dealerConstants'
import { NETWORK_CONFIG } from '../../constants/networkConfig'
import { parseFcfaAmount } from '../../utils/fcfaAmount.js'
import { formatCurrency } from '../../utils/formatCurrency'
import StatusBadge from '../ui/StatusBadge'
import RejectionRemarkButton from '../ui/RejectionRemarkButton'
import Toast from '../Toast'
import { formatDateTime as formatDate } from '../../utils/formatters'

/**
 * Chemin dealer du formulaire de transactions boutique.
 * La boutique renvoie UNE ressource (stock OU liquidité) au dealer ; le solde
 * boutique est débité immédiatement côté serveur (createStoreDealerTransfer).
 * Le solde n'est restauré qu'en cas de rejet du dealer.
 */
function DealerTransferForm() {
  const { userProfile } = useAuth()
  const { toasts, showToast, removeToast } = useToast()
  const { networkData } = useSimpleNetworkData()

  const [transferType, setTransferType] = useState(STORE_TRANSFER_TYPES.RETURN_STOCK)
  const [network, setNetwork] = useState(DEALER_NETWORKS[0]) // réseau ciblé (multi-réseaux)
  const [amount, setAmount] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pending, setPending] = useState(null) // confirmation modal
  const [transfers, setTransfers] = useState([])
  const submittingRef = useRef(false) // verrou synchrone anti-double-clic (débit)

  const storeId = userProfile?.storeId

  // Solde du réseau ciblé. En mono, activeNetwork = 'Orange' (le backend débite
  // balances.Orange.<field>) → comportement inchangé ; en multi, réseau sélectionné.
  const activeNetwork = IS_DEALER_MULTI_NETWORK ? network : 'Orange'
  const netBal = networkData?.[activeNetwork] ?? { stock: 0, liquidite: 0 }
  const available = transferType === STORE_TRANSFER_TYPES.RETURN_STOCK
    ? (Number(netBal.stock) || 0)
    : (Number(netBal.liquidite) || 0)

  useEffect(() => {
    if (!storeId) { setTransfers([]); return undefined }
    return subscribeStoreTransfers({
      storeId,
      onUpdate: setTransfers,
      onError: (err) => showToast(err.message, 'error'),
    })
  }, [storeId, showToast])

  const validation = useMemo(() => {
    const value = parseFcfaAmount(amount)
    if (value === null) return { ok: false, reason: 'Montant invalide (entier > 0).' }
    if (value > available) return { ok: false, reason: `Solde insuffisant. Disponible : ${formatCurrency(available)}.` }
    return { ok: true, reason: '', value }
  }, [amount, available])

  const openConfirm = useCallback(() => {
    if (!validation.ok) { showToast(validation.reason, 'error'); return }
    setPending({ transferType, amount: validation.value, network: activeNetwork })
  }, [validation, transferType, activeNetwork, showToast])

  const confirmSubmit = useCallback(async () => {
    // Verrou synchrone : empêche un double-clic de déclencher deux débits avant
    // que setIsSubmitting(true) (asynchrone) ne prenne effet.
    if (!pending || submittingRef.current) return
    submittingRef.current = true
    setIsSubmitting(true)
    try {
      // network omis en mono (deploy-safe : le serveur applique le défaut mono-réseau).
      await createStoreDealerTransfer({ transferType: pending.transferType, amount: pending.amount, network: IS_DEALER_MULTI_NETWORK ? pending.network : undefined })
      showToast('Envoi au dealer effectué. En attente de validation.', 'success')
      setAmount('')
      setPending(null)
    } catch (err) {
      showToast(err?.message || "Échec de l'envoi au dealer", 'error')
    } finally {
      setIsSubmitting(false)
      submittingRef.current = false
    }
  }, [pending, showToast])

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-xl font-bold text-gray-800 mb-1">Opération dealer</h2>
      <p className="text-sm text-gray-500 mb-5">
        Renvoyer une ressource au dealer. Le solde est débité immédiatement et restauré si le dealer rejette.
      </p>

      <div className="space-y-4">
        {/* Réseau (multi-réseaux) — mono : réseau unique implicite (Orange) */}
        {IS_DEALER_MULTI_NETWORK && (
          <div>
            <label htmlFor="transfer-network" className="block text-sm font-semibold text-gray-700 mb-2">Réseau</label>
            <select
              id="transfer-network"
              value={network}
              onChange={(e) => { setNetwork(e.target.value); setAmount('') }}
              className="w-full rounded border-2 border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-green-500"
              data-testid="transfer-select-network"
            >
              {DEALER_NETWORKS.map(n => (<option key={n} value={n}>{NETWORK_CONFIG[n]?.name ?? n}</option>))}
            </select>
          </div>
        )}
        {/* Ressource */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Ressource à renvoyer</label>
          <div className="flex flex-wrap gap-3">
            {Object.values(STORE_TRANSFER_TYPES).map(t => (
              <label
                key={t}
                className={`flex-1 min-w-48 cursor-pointer rounded-xl border-2 px-4 py-3 transition-colors ${
                  transferType === t ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name="transferType"
                  value={t}
                  checked={transferType === t}
                  onChange={() => { setTransferType(t); setAmount('') }}
                  className="sr-only"
                />
                <span className="block text-sm font-medium text-gray-800">{STORE_TRANSFER_TYPE_LABELS[t]}</span>
                <span className="mt-0.5 block text-xs text-gray-500">
                  Disponible : {formatCurrency(t === STORE_TRANSFER_TYPES.RETURN_STOCK ? (Number(netBal.stock) || 0) : (Number(netBal.liquidite) || 0))}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Montant */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Montant (FCFA)</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Saisir le montant"
            className={`w-full px-3 py-2 border-2 rounded focus:outline-none transition-colors ${
              validation.ok || !amount ? 'border-gray-300 focus:border-green-500' : 'border-red-300 focus:border-red-500'
            }`}
          />
          {!validation.ok && amount && (
            <p className="mt-1 text-sm text-red-600">{validation.reason}</p>
          )}
        </div>

        <button
          type="button"
          onClick={openConfirm}
          disabled={!validation.ok || isSubmitting}
          className={`px-6 py-2 rounded font-medium transition-colors ${
            !validation.ok || isSubmitting ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700 text-white'
          }`}
        >
          {isSubmitting ? 'Envoi…' : 'Envoyer au dealer'}
        </button>
      </div>

      {/* Historique des envois de la boutique */}
      <div className="mt-8">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-3">Mes envois au dealer</h3>
        {transfers.length === 0 ? (
          <p className="text-sm text-gray-400">Aucun envoi pour le moment.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-green-50/70">
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Montant</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3">Remarque</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {transfers.map(t => (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{STORE_TRANSFER_TYPE_LABELS[t.transferType] ?? t.transferType}</td>
                    <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">{formatCurrency(t.amount)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={t.status} label={DEALER_REQUEST_STATUS_LABELS[t.status] ?? t.status} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <RejectionRemarkButton
                        storeName="Dealer"
                        reason={t.status === 'rejected' ? t.rejectionReason : null}
                        testId={`transfer-remark-${t.id}`}
                      />
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{formatDate(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modale de confirmation */}
      {pending && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-2xl">
            <h3 className="text-xl font-bold text-gray-900">Confirmer l'envoi au dealer</h3>
            <div className="mt-4 space-y-2 text-sm text-gray-700">
              <p><span className="font-semibold">Opération :</span> {STORE_TRANSFER_TYPE_LABELS[pending.transferType]}</p>
              {IS_DEALER_MULTI_NETWORK && <p><span className="font-semibold">Réseau :</span> {pending.network}</p>}
              <p><span className="font-semibold">Montant :</span> {formatCurrency(pending.amount)}</p>
              <p className="text-xs text-gray-500">Le solde de la boutique sera débité immédiatement.</p>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setPending(null)}
                disabled={isSubmitting}
                className="rounded border border-gray-300 px-4 py-2 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={confirmSubmit}
                disabled={isSubmitting}
                className="rounded bg-green-600 px-4 py-2 font-medium text-white hover:bg-green-700 disabled:bg-gray-400"
              >
                {isSubmitting ? 'Envoi…' : 'Confirmer'}
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

export default DealerTransferForm
