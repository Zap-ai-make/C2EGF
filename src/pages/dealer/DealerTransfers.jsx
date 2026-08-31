import { useState, useEffect, useCallback, useRef } from 'react'
import { X } from 'lucide-react'
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
import Registre, { SqueletteRegistre } from '../../components/dealer/Registre'
import Toast from '../../components/Toast'
import { formatDateTime as formatDate } from '../../utils/formatters'

/**
 * Les retours des boutiques — la file où le dealer répond.
 *
 * DEUX ACTIONS, UNE SEULE PRIMAIRE
 * ────────────────────────────────
 * Confirmer et rejeter étaient deux boutons pleins de deux couleurs, vert et
 * rouge, de poids visuel égal. C'est le dessin qui fait cliquer à côté : deux
 * affordances identiques placées à 8 px l'une de l'autre, sur une action qui
 * déplace de l'argent. Confirmer devient la primaire, rejeter une secondaire
 * discrète — et le rouge disparaît d'un geste qui n'est pas un échec : rejeter
 * un retour est une décision, pas une panne (`danger` reste à l'échec).
 *
 * Le nom accessible de chaque bouton porte SA ligne (« Confirmer le retour de
 * FADA »). Sur une file de vingt lignes, vingt boutons nommés « Confirmer »
 * sont vingt fois la même phrase, et rien ne dit laquelle on active.
 */

const COLONNES = [
  { cle: 'boutique', titre: 'Boutique' },
  { cle: 'type', titre: 'Type' },
  { cle: 'montant', titre: 'Montant', nombre: true },
  { cle: 'date', titre: 'Date', discret: true },
  { cle: 'actions', titre: 'Actions', fin: true },
]

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
  const dialogRef = useRef(null)

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

  const fermerRejet = useCallback(() => { setRejectFor(null); setReason('') }, [])

  // Échap referme, comme tout calque (DESIGN.md §11).
  useEffect(() => {
    if (!rejectFor) return undefined
    const onKey = (e) => { if (e.key === 'Escape') fermerRejet() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rejectFor, fermerRejet])

  // Le focus entre dans la modale : sans cela la tabulation continuerait
  // derrière le calque, sur une file qu'on ne voit plus.
  useEffect(() => {
    if (!rejectFor) return
    dialogRef.current?.querySelector('textarea, button')?.focus()
  }, [rejectFor])

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

  const nomBoutique = (t) => t.storeName ?? t.storeId

  const cellules = (t) => ({
    boutique: <span className="font-medium text-ink">{nomBoutique(t)}</span>,
    type: <span className="text-ink-muted">{STORE_TRANSFER_TYPE_LABELS[t.transferType] ?? t.transferType}</span>,
    montant: formatCurrency(t.amount),
    date: formatDate(t.createdAt),
    actions: (
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => handleConfirm(t.id)}
          disabled={actingId === t.id}
          aria-label={`Confirmer le retour de ${nomBoutique(t)}`}
          className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          data-testid={`confirm-${t.id}`}
        >
          {actingId === t.id ? 'Traitement…' : 'Confirmer'}
        </button>
        <button
          type="button"
          onClick={() => { setRejectFor(t.id); setReason('') }}
          disabled={actingId === t.id}
          aria-label={`Rejeter le retour de ${nomBoutique(t)}`}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-brand-50 hover:text-ink disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          data-testid={`reject-${t.id}`}
        >
          Rejeter
        </button>
      </div>
    ),
  })

  return (
    <div data-testid="dealer-transfers">
      <PageHeader
        title="Retours boutiques"
        subtitle="Retours de stock et envois de liquidité des boutiques — à confirmer ou rejeter"
      />

      {loading && <SqueletteRegistre colonnes={COLONNES} lignes={5} />}
      {error && <ErrorState message={error} onRetry={() => { setError(null); setRefreshKey(k => k + 1) }} />}
      {!loading && !error && transfers.length === 0 && (
        <EmptyState
          title="Aucun retour en attente"
          message="Rien ne vous attend ici. Les retours déjà traités restent consultables dans l’historique."
        />
      )}

      {!loading && !error && transfers.length > 0 && (
        <Registre
          colonnes={COLONNES}
          lignes={transfers}
          cle={(t) => t.id}
          cellules={cellules}
          libelle="Retours de boutiques en attente"
          testId="transfers-table"
          testIdLigne={(t) => `transfer-row-${t.id}`}
        />
      )}

      {rejectFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rejet-titre"
        >
          <div ref={dialogRef} className="w-full max-w-md rounded-xl bg-surface p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <h2 id="rejet-titre" className="text-lg font-semibold text-ink">Rejeter le retour</h2>
              <button
                type="button"
                onClick={fermerRejet}
                className="-m-1 rounded p-1 text-ink-muted transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                aria-label="Fermer"
              >
                <X className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
              </button>
            </div>
            <p className="mt-1 text-sm text-ink-muted">
              Indiquez un motif (3 à 500 caractères). Le solde de la boutique sera restauré.
            </p>
            <label htmlFor="rejet-motif" className="sr-only">Motif du rejet</label>
            <textarea
              id="rejet-motif"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="mt-3 w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
              placeholder="Motif du rejet…"
            />
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={fermerRejet}
                disabled={actingId === rejectFor}
                className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-muted transition-colors hover:bg-brand-50 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                Annuler
              </button>
              {/* Rejeter est ici la PRIMAIRE : c'est l'action de cette modale,
                  et on l'a demandée. Le rouge reste absent — un rejet motivé
                  est une décision, pas un échec. */}
              <button
                type="button"
                onClick={handleReject}
                disabled={actingId === rejectFor || reason.trim().length < 3}
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                {actingId === rejectFor ? 'Traitement…' : 'Rejeter'}
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
