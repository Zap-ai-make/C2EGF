import { useState, useCallback, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useToast } from '../../hooks/useToast'
import { useDealerInventory } from '../../hooks/useDealerInventory'
import { replenishDealerInventory, decreaseDealerInventory } from '../../services/storeTransferService'
import { formatCurrency } from '../../utils/formatCurrency'
import { DEALER_NETWORKS, IS_DEALER_MULTI_NETWORK, estSousSeuil } from '../../constants/dealerConstants'
import { NETWORK_CONFIG } from '../../constants/networkConfig'
import Toast from '../Toast'

/**
 * Les cuves du dealer — stock et liquidité — et le seul endroit où on les ajuste.
 *
 * CE QUI A CHANGÉ, ET POURQUOI (spec S3)
 * ──────────────────────────────────────
 * C'était une BANDE horizontale, posée en haut de `<main>`, sur chaque écran.
 * Elle avait deux défauts que le dessin ne pouvait pas corriger :
 *
 *   • elle mangeait une centaine de pixels de hauteur sur tous les écrans,
 *     y compris ceux qui n'ont rien à voir avec l'inventaire ;
 *   • elle DÉFILAIT malgré tout, alors que « ai-je de quoi servir ? » est la
 *     condition de chaque action de la page.
 *
 * Elle devient un RAIL VERTICAL dans la barre latérale : présente en
 * permanence, jamais dans le chemin du contenu. C'est le même déplacement que
 * les cartes de solde de l'espace boutique, qui sont collantes pour la même
 * raison.
 *
 * L'ABONNEMENT A QUITTÉ CE FICHIER pour `useDealerInventory` : les cuves
 * s'affichent aussi en résumé dans l'en-tête mobile, où ce composant n'est pas
 * déplié. Deux vues, une source.
 *
 * ⚠ LE DOUBLE VERROU DE SOUMISSION EST CONSERVÉ TEL QUEL. `submittingRef` est
 *   un verrou SYNCHRONE qui bloque deux clics dans le même tick, avant que le
 *   re-rendu n'applique `disabled` ; l'état `submitting` pilote l'affordance.
 *   Les deux sont volontaires sur une action financière — ne pas retirer le ref
 *   au profit du seul `disabled`.
 */

const RESOURCES = [
  { value: 'stock', label: 'Stock' },
  { value: 'liquidite', label: 'Liquidité' },
]
const OPERATIONS = [
  { value: 'increase', label: 'Ajouter' },
  { value: 'decrease', label: 'Retirer' },
]
const NETWORK_SEGMENT_OPTIONS = DEALER_NETWORKS.map(n => ({ value: n, label: NETWORK_CONFIG[n]?.name ?? n }))

/** Sélecteur segmenté accessible (radiogroup). */
function Segmented({ label, options, value, onChange, name }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-brand-100 p-1">
        {options.map(opt => {
          const active = opt.value === value
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(opt.value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                active ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
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

/**
 * Une cuve.
 *
 * Le seuil bas est doublé D'UN MOT, jamais porté par la seule couleur
 * (DESIGN.md §5). La pastille orange est l'identité de l'opérateur — c'est une
 * donnée, le seul emploi que `index.css` autorise pour `net-orange`, qui
 * plafonne à 2,84:1 et ne peut donc porter ni texte ni chrome.
 */
function Cuve({ label, montant, operateur = false }) {
  const bas = estSousSeuil(montant)
  return (
    <div
      // ⚠ L'anneau est `warn-soft`, pas `warn`. Les deux disent le seuil bas,
      //   mais `warn` (#8a5a00) est une teinte pour fond CLAIR : sur le marine
      //   de la barre elle disparaît, et un signal invisible n'est pas un
      //   signal. Sur fond sombre, c'est la variante claire qui porte. Vu à la
      //   capture, pas déduit.
      className={`rounded-lg bg-white/[0.07] px-3 py-2 ${bas ? 'ring-1 ring-warn-soft/70' : ''}`}
      data-testid={`cuve-${label}`}
    >
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-brand-200">
        {operateur && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-net-orange" aria-hidden="true" />
        )}
        <span className="truncate">{label}</span>
      </p>
      <p className="mt-0.5 truncate text-base font-bold tabular-nums text-white">
        {formatCurrency(montant)}
      </p>
      {bas && (
        <p className="mt-0.5 text-[10px] font-semibold text-warn-soft">Sous le seuil bas</p>
      )}
    </div>
  )
}

function DealerInventoryBar() {
  const { toasts, showToast, removeToast } = useToast()
  const { inventory, isDealer } = useDealerInventory()

  const [adjustOpen, setAdjustOpen] = useState(false)
  const [resource, setResource]     = useState('stock')
  const [mode, setMode]             = useState('increase')
  const [network, setNetwork]       = useState(DEALER_NETWORKS[0])
  const [amount, setAmount]         = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const dialogRef = useRef(null)

  const closeModal = useCallback(() => {
    setAdjustOpen(false)
    setAmount('')
    setResource('stock')
    setMode('increase')
    setNetwork(DEALER_NETWORKS[0])
  }, [])

  // Échap referme, comme tout calque (DESIGN.md §11).
  useEffect(() => {
    if (!adjustOpen) return undefined
    const onKey = (e) => { if (e.key === 'Escape') closeModal() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [adjustOpen, closeModal])

  // Le focus entre dans la modale à l'ouverture. Sans cela, la tabulation
  // continuerait derrière le calque, sur une page qu'on ne voit plus.
  useEffect(() => {
    if (!adjustOpen) return
    dialogRef.current?.querySelector('input, button')?.focus()
  }, [adjustOpen])

  const submit = useCallback(async () => {
    if (submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    const isDecrease = mode === 'decrease'
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

  return (
    <div className="px-3 py-3">
      <p className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-200">
        Mes cuves
      </p>

      <div className="grid gap-2">
        {IS_DEALER_MULTI_NETWORK ? (
          <>
            {DEALER_NETWORKS.map(net => (
              <Cuve
                key={net}
                label={NETWORK_CONFIG[net]?.name ?? net}
                montant={inventory.byNetwork?.[net]?.stock ?? 0}
                operateur
              />
            ))}
            <Cuve label="Liquidité" montant={inventory.totalLiquidite ?? 0} />
          </>
        ) : (
          <>
            <Cuve label={`Stock ${DEALER_NETWORKS[0]}`} montant={inventory.stock} operateur />
            <Cuve label="Liquidité" montant={inventory.liquidite} />
          </>
        )}
      </div>

      <button
        type="button"
        onClick={() => { setAdjustOpen(true); setAmount(''); setResource('stock'); setMode('increase'); setNetwork(DEALER_NETWORKS[0]) }}
        className="mt-2 w-full rounded-lg border border-white/25 px-3 py-1.5 text-xs font-semibold text-brand-100 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        data-testid="dealer-inventory-adjust"
      >
        Ajuster
      </button>

      {adjustOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dealer-adjust-title"
        >
          <div ref={dialogRef} className="w-full max-w-md rounded-xl bg-surface p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <h2 id="dealer-adjust-title" className="text-lg font-semibold text-ink">
                Ajuster l’inventaire
              </h2>
              <button
                type="button"
                onClick={closeModal}
                className="-m-1 rounded p-1 text-ink-muted transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                aria-label="Fermer"
              >
                <X className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
              </button>
            </div>
            <p className="mt-1 text-sm text-ink-muted">
              {IS_DEALER_MULTI_NETWORK
                ? 'Approvisionnement ou correction de vos cuves.'
                : `Approvisionnement ou correction de vos cuves (${DEALER_NETWORKS[0]}).`}
            </p>

            <div className="mt-4 space-y-4">
              {IS_DEALER_MULTI_NETWORK && (
                <Segmented label="Réseau" name="network" options={NETWORK_SEGMENT_OPTIONS} value={network} onChange={setNetwork} />
              )}
              <Segmented label="Ressource" name="resource" options={RESOURCES} value={resource} onChange={setResource} />
              <Segmented label="Opération" name="operation" options={OPERATIONS} value={mode} onChange={setMode} />
              <div>
                <label htmlFor="dealer-adjust-amount" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Montant
                </label>
                <input
                  id="dealer-adjust-amount"
                  type="text"
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Ex : 50000"
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm tabular-nums text-ink focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
                />
                <p className="mt-1 text-xs text-ink-muted">Entier positif, sans virgule ni point.</p>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeModal}
                disabled={submitting}
                className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-muted transition-colors hover:bg-brand-50 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                Annuler
              </button>
              {/* Le bouton dit ce qui va se passer, et le mot survit au toast.
                  Retirer du stock n'est pas une erreur : pas de rouge — `danger`
                  reste à l'échec, au rejet et à la suppression. */}
              <button
                type="button"
                onClick={submit}
                disabled={submitting || !amountValid}
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                data-testid="dealer-adjust-submit"
              >
                {submitting ? 'Traitement…' : (isDecrease ? 'Retirer' : 'Ajouter')}
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
