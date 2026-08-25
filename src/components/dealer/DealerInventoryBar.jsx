import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../hooks/useToast'
import { subscribeDealerBalance, replenishDealerInventory, decreaseDealerInventory } from '../../services/storeTransferService'
import { formatCurrency } from '../../utils/formatCurrency'
import { DEALER_NETWORKS, IS_DEALER_MULTI_NETWORK } from '../../constants/dealerConstants'
import { NETWORK_CONFIG } from '../../constants/networkConfig'
import { emptyDealerInventory } from '../../utils/dealerInventory'
import Toast from '../Toast'

/**
 * Bandeau d'inventaire dealer — persistant en haut de chaque page (comme le
 * bandeau des cartes réseau de l'espace boutique). Un unique bouton « Ajuster »
 * ouvre une modale unifiée (ressource + opération + montant).
 *
 * Mono-réseau (ex. TAOFIC) : deux cartes Stock + Liquidité (comportement historique,
 * inchangé). Multi-réseaux (dealer multi-SIM) : une carte Stock PAR réseau + une
 * carte Liquidité globale (somme), et la modale ajoute un sélecteur de réseau.
 */

const RESOURCES = [
  { value: 'stock', label: 'Stock' },
  { value: 'liquidite', label: 'Liquidité' },
]
const OPERATIONS = [
  { value: 'increase', label: '+ Ajouter' },
  { value: 'decrease', label: '− Retirer' },
]
// Options du sélecteur de réseau (dealer multi-réseaux) — nom lisible du profil.
const NETWORK_SEGMENT_OPTIONS = DEALER_NETWORKS.map(n => ({ value: n, label: NETWORK_CONFIG[n]?.name ?? n }))

// Petit sélecteur segmenté accessible (radiogroup).
function Segmented({ label, options, value, onChange, name }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-gray-100 p-1">
        {options.map(opt => {
          const active = opt.value === value
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(opt.value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 ${
                active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
              data-testid={`seg-${name}-${opt.value}`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function DealerInventoryBar() {
  const { currentUser, userProfile } = useAuth()
  const { toasts, showToast, removeToast } = useToast()

  const [inventory, setInventory] = useState(emptyDealerInventory())
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [resource, setResource]     = useState('stock')     // 'stock' | 'liquidite'
  const [mode, setMode]             = useState('increase')  // 'increase' | 'decrease'
  const [network, setNetwork]       = useState(DEALER_NETWORKS[0]) // réseau ciblé (multi-réseaux)
  const [amount, setAmount]         = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Défense en profondeur pour une action financière (appel de Cloud Function) :
  //  - submittingRef : verrou SYNCHRONE, bloque deux clics dans le même tick avant
  //    que le re-render n'applique `disabled` (fenêtre de double-soumission).
  //  - submitting (state) : pilote `disabled` + le libellé du bouton.
  // Les deux sont volontaires : ne pas retirer le ref au profit du seul `disabled`.
  const submittingRef = useRef(false)

  const dealerUid = currentUser?.uid
  const isDealer = userProfile?.role === 'dealer'

  useEffect(() => {
    if (!isDealer || !dealerUid) { setInventory(emptyDealerInventory()); return undefined }
    return subscribeDealerBalance({ dealerUid, onUpdate: setInventory })
  }, [dealerUid, isDealer])

  const closeModal = useCallback(() => {
    setAdjustOpen(false)
    setAmount('')
    setResource('stock')
    setMode('increase')
    setNetwork(DEALER_NETWORKS[0])
  }, [])

  // Fermeture à la touche Échap
  useEffect(() => {
    if (!adjustOpen) return undefined
    const onKey = (e) => { if (e.key === 'Escape') closeModal() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [adjustOpen, closeModal])

  const submit = useCallback(async () => {
    if (submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    const isDecrease = mode === 'decrease'
    // Mono-réseau : payload historique { resource, amount } (aucun réseau transmis,
    // compatible functions non mises à jour). Multi-réseaux : réseau sélectionné.
    const args = IS_DEALER_MULTI_NETWORK ? { resource, amount, network } : { resource, amount }
    try {
      if (isDecrease) await decreaseDealerInventory(args)
      else await replenishDealerInventory(args)
      showToast(isDecrease ? 'Inventaire diminué.' : 'Inventaire approvisionné.', 'success')
      closeModal()
    } catch (err) {
      showToast(err?.message || (isDecrease ? 'Échec de la diminution' : "Échec de l'approvisionnement"), 'error')
    } finally {
      setSubmitting(false)
      submittingRef.current = false
    }
  }, [resource, mode, amount, network, showToast, closeModal])

  if (!isDealer) return null

  const isDecrease = mode === 'decrease'
  const amountValid = /^[0-9]+$/.test(amount.trim())

  const Card = ({ label, value, icon, tint, dotColor }) => (
    <div className={`flex-1 min-w-40 rounded-xl border border-gray-100 bg-gradient-to-br ${tint} to-white px-4 py-2.5`}>
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

  return (
    <div className="mb-6 rounded-2xl bg-white ring-1 ring-gray-100 shadow-sm">
      <div className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center">
        <div className="flex shrink-0 items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            {IS_DEALER_MULTI_NETWORK ? 'Mon inventaire' : 'Mon inventaire (Orange)'}
          </span>
        </div>
        {IS_DEALER_MULTI_NETWORK ? (
          <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3">
            {DEALER_NETWORKS.map(net => (
              <Card
                key={net}
                label={NETWORK_CONFIG[net]?.name ?? net}
                value={inventory.byNetwork?.[net]?.stock ?? 0}
                icon="📦"
                tint="from-blue-50"
                dotColor={NETWORK_CONFIG[net]?.color}
              />
            ))}
            <Card label="Liquidité" value={inventory.totalLiquidite ?? 0} icon="💵" tint="from-teal-50" />
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-3 sm:flex-row">
            <Card label="Stock" value={inventory.stock} icon="📦" tint="from-blue-50" />
            <Card label="Liquidité" value={inventory.liquidite} icon="💵" tint="from-teal-50" />
          </div>
        )}
        <div className="flex shrink-0">
          <button
            type="button"
            onClick={() => { setAdjustOpen(true); setAmount(''); setResource('stock'); setMode('increase'); setNetwork(DEALER_NETWORKS[0]) }}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
            data-testid="dealer-inventory-adjust"
          >
            Ajuster
          </button>
        </div>
      </div>

      {/* Modale d'ajustement unifiée */}
      {adjustOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="dealer-adjust-title">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 id="dealer-adjust-title" className="text-lg font-semibold text-gray-900">Ajuster l'inventaire</h2>
            <p className="mt-1 text-sm text-gray-500">
              {IS_DEALER_MULTI_NETWORK
                ? 'Approvisionnement ou correction de votre inventaire.'
                : 'Approvisionnement ou correction de votre inventaire (Orange).'}
            </p>

            <div className="mt-4 space-y-4">
              {IS_DEALER_MULTI_NETWORK && (
                <Segmented label="Réseau" name="network" options={NETWORK_SEGMENT_OPTIONS} value={network} onChange={setNetwork} />
              )}
              <Segmented label="Ressource" name="resource" options={RESOURCES} value={resource} onChange={setResource} />
              <Segmented label="Opération" name="operation" options={OPERATIONS} value={mode} onChange={setMode} />
              <div>
                <label htmlFor="dealer-adjust-amount" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Montant</label>
                <input
                  id="dealer-adjust-amount"
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Montant (FCFA)"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-green-400 focus:ring-1 focus:ring-green-400"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeModal}
                disabled={submitting}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={submitting || !amountValid}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 focus:outline-none focus-visible:ring-2 ${
                  isDecrease ? 'bg-red-600 hover:bg-red-700 focus-visible:ring-red-500' : 'bg-green-600 hover:bg-green-700 focus-visible:ring-green-500'
                }`}
                data-testid="dealer-adjust-submit"
              >
                {submitting ? 'Traitement…' : 'Valider'}
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

export default DealerInventoryBar
