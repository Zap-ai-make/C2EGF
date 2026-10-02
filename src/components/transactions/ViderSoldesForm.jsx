import { useCallback, useMemo, useRef, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { useToast } from '../../hooks/useToast'
import { useSimpleNetworkData } from '../../hooks/useSimpleNetworkData'
import { runStoreTransactionCommand } from '../../services/storeTransactionCommandService'
import { formatCurrency } from '../../utils/formatCurrency'
import { activeProfile } from '../../config/activeClientProfile.js'

/**
 * Vider les soldes — la boutique repart de zéro.
 *
 * POURQUOI LES MONTANTS SONT ÉCRITS ICI
 * ─────────────────────────────────────
 * C'est le geste le plus destructeur de l'écran : il efface la position de
 * fonds de roulement. Demander « êtes-vous sûr ? » sans dire DE QUOI ne protège
 * de rien — le gérant clique sur le même bouton dans les deux cas. En affichant
 * ce qui va être soldé, la confirmation devient une relecture : un chiffre qui
 * surprend arrête la main avant le clic, pas après.
 *
 * Les montants sont ceux de l'écran, donc indicatifs : le serveur solde ce
 * qu'il lit au moment de la transaction, et c'est lui qui fait foi. Un
 * ravitaillement arrivé entre l'ouverture de cette fenêtre et la validation
 * sera soldé lui aussi.
 */

const RESEAUX = activeProfile.networks.enabled

function ViderSoldesForm({ onComplete, onCancel }) {
  const { showToast } = useToast()
  const { networkData } = useSimpleNetworkData()
  const [envoiEnCours, setEnvoiEnCours] = useState(false)
  const verrou = useRef(false)

  const lignes = useMemo(() => RESEAUX.flatMap((reseau) => {
    const data = networkData?.[reseau]
    if (!data) return []
    return [
      { cle: `${reseau}-stock`, libelle: `${reseau} · stock`, montant: Number(data.stock) || 0 },
      { cle: `${reseau}-liquidite`, libelle: 'Liquidité · espèces', montant: Number(data.liquidite) || 0 },
    ]
  }), [networkData])

  const total = useMemo(() => lignes.reduce((somme, ligne) => somme + ligne.montant, 0), [lignes])

  const vider = useCallback(async () => {
    if (verrou.current) return
    verrou.current = true
    setEnvoiEnCours(true)
    try {
      await runStoreTransactionCommand({ action: 'closeDay' })
      showToast('Soldes vidés. La journée repart de zéro.', 'success')
      onComplete?.()
    } catch (err) {
      showToast(err?.message || "Les soldes n'ont pas pu être vidés.", 'error')
    } finally {
      setEnvoiEnCours(false)
      verrou.current = false
    }
  }, [showToast, onComplete])

  const rienASolder = total <= 0

  return (
    <div className="space-y-5">
      <div className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
        <p className="text-sm text-ink">
          Les montants ci-dessous seront ramenés à zéro. Ils restent inscrits dans l'historique
          sous une ligne de clôture, mais ne s'annulent pas depuis l'application.
        </p>
      </div>

      <dl className="divide-y divide-line rounded-lg border border-line" data-testid="soldes-a-vider">
        {lignes.map((ligne) => (
          <div key={ligne.cle} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
            <dt className="text-sm text-ink-muted">{ligne.libelle}</dt>
            <dd className="text-sm font-semibold tabular-nums text-ink">{formatCurrency(ligne.montant)}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-4 bg-brand-50 px-4 py-2.5">
          <dt className="text-sm font-semibold text-ink">Total soldé</dt>
          <dd className="text-base font-bold tabular-nums text-ink" data-testid="total-a-vider">{formatCurrency(total)}</dd>
        </div>
      </dl>

      {rienASolder && (
        <p className="text-sm text-ink-muted">Les soldes sont déjà à zéro : il n'y a rien à vider.</p>
      )}

      <div className="flex justify-end gap-3 border-t border-line pt-4">
        <button
          type="button"
          onClick={onCancel}
          disabled={envoiEnCours}
          className="rounded border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-brand-50 disabled:opacity-60"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={vider}
          disabled={envoiEnCours || rienASolder}
          data-testid="confirmer-vider-soldes"
          className={`rounded px-5 py-2 text-sm font-semibold transition-colors ${
            envoiEnCours || rienASolder
              ? 'cursor-not-allowed bg-gray-200 text-gray-500'
              : 'bg-danger text-white hover:bg-danger/90'
          }`}
        >
          {envoiEnCours ? 'Vidage…' : 'Vider les soldes'}
        </button>
      </div>
    </div>
  )
}

export default ViderSoldesForm
