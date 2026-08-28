import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { getStoreAdminDealerRequestById } from '../../services/storeAdminDealerService'
import {
  confirmDealerRequestCommand,
  rejectDealerRequestCommand,
} from '../../services/storeDealerRequestCommandService'
import { formatStoredAmount } from '../../utils/formatCurrency'
import { formatFirestoreDate } from '../../utils/formatFirestoreDate'
import DealerRequestStatusBadge from '../../components/ui/DealerRequestStatusBadge'
import {
  DEALER_REQUEST_TYPE_LABELS,
} from '../../constants/dealerConstants'
import { ChevronLeft } from 'lucide-react'

// ---------------------------------------------------------------------------
// Badges statut
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helper d'affichage d'un champ (null/undefined → '—')
// ---------------------------------------------------------------------------

function Field({ label, value }) {
  return (
    <div className="flex py-3 border-b border-line/60 last:border-0">
      <dt className="w-44 flex-shrink-0 text-sm text-gray-500">{label}</dt>
      <dd className="text-sm font-medium text-gray-800 break-all">{value ?? '—'}</dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sélecteur des éléments focalisables dans un conteneur
// ---------------------------------------------------------------------------

// :is() groups all interactive element types into one sub-selector so querySelectorAll
// returns results in document order regardless of element type (jsdom compat).
const FOCUSABLE_SELECTOR =
  ':is(button, input, textarea, select):not([disabled]),' +
  'a[href],' +
  '[tabindex]:not([tabindex="-1"]):not([disabled])'

// ---------------------------------------------------------------------------
// ConfirmModal — confirmation renforcée avec checkbox
// ---------------------------------------------------------------------------

function ConfirmModal({ request, processing, onConfirm, onClose, initialFocusRef }) {
  const [checked, setChecked] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    initialFocusRef?.current?.focus()
  }, [initialFocusRef])

  const typeLabel     = DEALER_REQUEST_TYPE_LABELS[request.requestType] ?? 'Type inconnu'
  const amountDisplay = formatStoredAmount(request.amount)
  const canSubmit     = checked && !processing

  function handleKeyDown(e) {
    if (e.key === 'Escape' && !processing) { onClose(); return }
    if (e.key === 'Tab') {
      const container = containerRef.current
      if (!container) return
      const els = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR))
      if (els.length === 0) return
      const first = els[0]
      const last  = els[els.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus() }
      } else {
        if (document.activeElement === last)  { e.preventDefault(); first.focus() }
      }
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      aria-describedby="confirm-modal-desc"
      onKeyDown={handleKeyDown}
      data-testid="confirm-modal-overlay"
    >
      <div ref={containerRef} className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <h2 id="confirm-modal-title" className="text-lg font-bold text-gray-800 mb-4">
          Confirmer la demande
        </h2>
        <p id="confirm-modal-desc" className="sr-only">
          Confirmez la demande de fonds pour {request.dealerName ?? 'ce dealer'}.
          Cette action est irréversible et modifiera immédiatement le solde de la boutique.
        </p>

        {/* Récapitulatif */}
        <dl className="text-sm space-y-2 mb-5">
          <div className="flex justify-between">
            <dt className="text-gray-500">Dealer</dt>
            <dd className="font-medium text-gray-800">{request.dealerName ?? 'Dealer inconnu'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Type</dt>
            <dd className="font-medium text-gray-800">{typeLabel}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Réseau</dt>
            <dd className="font-medium text-gray-800">{request.network ?? '—'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Montant</dt>
            <dd className="font-bold text-gray-900">{amountDisplay}</dd>
          </div>
        </dl>

        {/* Avertissement */}
        <div className="rounded-md bg-warn-soft border border-warn/30 p-3 mb-5 text-sm text-warn" role="note">
          Cette action modifiera immédiatement le solde de la boutique et ne pourra pas être annulée.
        </div>

        {/* Checkbox de confirmation */}
        <label className="flex items-start gap-3 cursor-pointer mb-6" data-testid="confirm-checkbox-label">
          <input
            ref={initialFocusRef}
            type="checkbox"
            checked={checked}
            onChange={e => setChecked(e.target.checked)}
            disabled={processing}
            className="mt-0.5 h-4 w-4 rounded border-line accent-brand-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            aria-label="Je confirme avoir vérifié le montant et le type de demande"
            data-testid="confirm-checkbox"
          />
          <span className="text-sm text-gray-700">
            Je confirme avoir vérifié le montant et le type de demande
          </span>
        </label>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={processing}
            className="rounded border border-line px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 transition-colors"
            data-testid="confirm-modal-cancel"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canSubmit}
            aria-disabled={!canSubmit}
            className="rounded bg-success px-4 py-2 text-sm font-medium text-white hover:bg-success/90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 transition-colors"
            data-testid="confirm-modal-submit"
          >
            {processing ? 'Confirmation…' : 'Confirmer la demande'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// RejectModal — rejet avec motif obligatoire (3–500 chars)
// ---------------------------------------------------------------------------

function RejectModal({ processing, onReject, onClose, initialFocusRef }) {
  const [reason, setReason]         = useState('')
  const [localError, setLocalError] = useState(null)
  const containerRef = useRef(null)

  useEffect(() => {
    initialFocusRef?.current?.focus()
  }, [initialFocusRef])

  const trimmed   = reason.trim()
  const charCount = trimmed.length
  const isValid   = charCount >= 3 && charCount <= 500
  const canSubmit = isValid && !processing

  function handleKeyDown(e) {
    if (e.key === 'Escape' && !processing) { onClose(); return }
    if (e.key === 'Tab') {
      const container = containerRef.current
      if (!container) return
      const els = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR))
      if (els.length === 0) return
      const first = els[0]
      const last  = els[els.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus() }
      } else {
        if (document.activeElement === last)  { e.preventDefault(); first.focus() }
      }
    }
  }

  function handleSubmit() {
    if (charCount < 3)   { setLocalError('Le motif doit comporter au moins 3 caractères.'); return }
    if (charCount > 500) { setLocalError('Le motif ne peut pas dépasser 500 caractères.'); return }
    setLocalError(null)
    onReject(trimmed)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reject-modal-title"
      aria-describedby="reject-modal-desc"
      onKeyDown={handleKeyDown}
      data-testid="reject-modal-overlay"
    >
      <div ref={containerRef} className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <h2 id="reject-modal-title" className="text-lg font-bold text-gray-800 mb-4">
          Rejeter la demande
        </h2>
        <p id="reject-modal-desc" className="sr-only">
          Saisissez le motif du rejet. Ce motif sera communiqué au dealer et ne pourra plus être modifié.
        </p>

        <div className="mb-4">
          <label htmlFor="rejection-reason" className="block text-sm font-medium text-gray-700 mb-1">
            Motif du rejet <span aria-hidden="true">*</span>
          </label>
          <textarea
            id="rejection-reason"
            ref={initialFocusRef}
            value={reason}
            onChange={e => { setReason(e.target.value); setLocalError(null) }}
            disabled={processing}
            rows={4}
            maxLength={510}
            placeholder="Décrivez le motif du rejet (3 à 500 caractères)…"
            className="w-full rounded border border-line px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50"
            aria-describedby={localError ? 'reject-reason-error' : 'reject-reason-hint'}
            data-testid="reject-reason-textarea"
          />
          <div className="flex justify-between items-center mt-1">
            <span
              id="reject-reason-hint"
              className={`text-xs ${charCount > 500 ? 'text-danger' : 'text-gray-400'}`}
              aria-live="polite"
              data-testid="reject-char-counter"
            >
              {charCount} / 500 caractères
            </span>
          </div>
          {localError && (
            <p
              id="reject-reason-error"
              role="alert"
              className="mt-1 text-xs text-danger"
              data-testid="reject-local-error"
            >
              {localError}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={processing}
            className="rounded border border-line px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 transition-colors"
            data-testid="reject-modal-cancel"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            aria-disabled={!canSubmit}
            className="rounded bg-danger px-4 py-2 text-sm font-medium text-white hover:bg-danger/90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger transition-colors"
            data-testid="reject-modal-submit"
          >
            {processing ? 'Rejet en cours…' : 'Confirmer le rejet'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// StoreAdminDealerRequestDetails
// ---------------------------------------------------------------------------

function StoreAdminDealerRequestDetails() {
  const { currentUser, userProfile } = useAuth()
  const navigate = useNavigate()
  const { requestId } = useParams()

  const [request, setRequest]             = useState(null)
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState(null)

  const [processingAction, setProcessingAction] = useState(null)  // 'confirm' | 'reject' | null
  const [confirmModalOpen, setConfirmModalOpen] = useState(false)
  const [rejectModalOpen, setRejectModalOpen]   = useState(false)
  const [actionError, setActionError]           = useState(null)
  const [actionSuccess, setActionSuccess]       = useState(null)
  // Distinct de actionError : la mutation a réussi mais le rechargement a échoué
  const [refreshError, setRefreshError]         = useState(null)

  // Refs pour retour de focus après fermeture de modale
  const confirmTriggerRef      = useRef(null)
  const rejectTriggerRef       = useRef(null)
  // Refs pour focus initial dans chaque modale
  const confirmInitialFocusRef = useRef(null)
  const rejectInitialFocusRef  = useRef(null)
  // Ref pour focus sur bannière de succès
  const successBannerRef       = useRef(null)

  // Retour de focus sur le bouton déclencheur après fermeture (transition true→false)
  const confirmModalWasOpen = useRef(false)
  useEffect(() => {
    if (confirmModalWasOpen.current && !confirmModalOpen) {
      confirmTriggerRef.current?.focus()
    }
    confirmModalWasOpen.current = confirmModalOpen
  }, [confirmModalOpen])

  const rejectModalWasOpen = useRef(false)
  useEffect(() => {
    if (rejectModalWasOpen.current && !rejectModalOpen) {
      rejectTriggerRef.current?.focus()
    }
    rejectModalWasOpen.current = rejectModalOpen
  }, [rejectModalOpen])

  // Focalise la bannière de succès quand elle apparaît (après le retour trigger)
  useEffect(() => {
    if (actionSuccess && successBannerRef.current) {
      successBannerRef.current.focus()
    }
  }, [actionSuccess])

  // Chargement initial (réinitialise tout)
  const loadRequest = useCallback(async (signal) => {
    setLoading(true)
    setError(null)
    setRequest(null)
    try {
      const data = await getStoreAdminDealerRequestById({ currentUser, userProfile, requestId })
      if (!signal.cancelled) { setRequest(data); setLoading(false) }
    } catch (err) {
      if (!signal.cancelled) { setError(err.message); setLoading(false) }
    }
  }, [currentUser, userProfile, requestId])

  // Rechargement silencieux après action — lève une erreur si le rechargement échoue
  const reloadRequest = useCallback(async () => {
    const data = await getStoreAdminDealerRequestById({ currentUser, userProfile, requestId })
    setRequest(data)
  }, [currentUser, userProfile, requestId])

  useEffect(() => {
    const signal = { cancelled: false }
    loadRequest(signal)
    return () => { signal.cancelled = true }
  }, [loadRequest])

  // ---------------------------------------------------------------------------
  // Confirmation
  // ---------------------------------------------------------------------------

  async function handleConfirm() {
    if (processingAction) return
    setProcessingAction('confirm')
    setActionError(null)
    setActionSuccess(null)
    setRefreshError(null)
    try {
      await confirmDealerRequestCommand(request.id)
      setActionSuccess('La demande a été confirmée avec succès.')
      // Recharger avant de fermer (rechargement-puis-fermeture)
      try {
        await reloadRequest()
      } catch {
        setRefreshError(
          'La demande a bien été confirmée, mais les données n\'ont pas pu être rechargées. Veuillez rafraîchir la page.'
        )
      }
      setConfirmModalOpen(false)
      // Le useEffect sur confirmModalOpen gère le retour de focus
    } catch (err) {
      setActionError(err.message)
      if (err.code === 'REQUEST_NOT_PENDING') {
        setConfirmModalOpen(false)
        await reloadRequest().catch(() => {})
      }
    } finally {
      setProcessingAction(null)
    }
  }

  // ---------------------------------------------------------------------------
  // Rejet
  // ---------------------------------------------------------------------------

  async function handleReject(trimmedReason) {
    if (processingAction) return
    setProcessingAction('reject')
    setActionError(null)
    setActionSuccess(null)
    setRefreshError(null)
    try {
      await rejectDealerRequestCommand(request.id, trimmedReason)
      setActionSuccess('La demande a été rejetée.')
      // Recharger avant de fermer (rechargement-puis-fermeture)
      try {
        await reloadRequest()
      } catch {
        setRefreshError(
          'La demande a bien été rejetée, mais les données n\'ont pas pu être rechargées. Veuillez rafraîchir la page.'
        )
      }
      setRejectModalOpen(false)
      // Le useEffect sur rejectModalOpen gère le retour de focus
    } catch (err) {
      setActionError(err.message)
      if (err.code === 'REQUEST_NOT_PENDING') {
        setRejectModalOpen(false)
        await reloadRequest().catch(() => {})
      }
    } finally {
      setProcessingAction(null)
    }
  }

  // ---------------------------------------------------------------------------
  // Render — chargement
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto" data-testid="store-dealer-request-details">
        <div className="bg-white rounded-lg shadow p-8 motion-safe:animate-pulse" aria-busy="true" aria-label="Chargement…">
          <div className="h-6 w-48 bg-gray-200 rounded mb-6" />
          {[1, 2, 3, 4, 5, 6].map(n => (
            <div key={n} className="flex py-3 border-b border-line/60">
              <div className="w-44 h-4 bg-gray-200 rounded mr-4" />
              <div className="flex-1 h-4 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render — erreur
  // ---------------------------------------------------------------------------

  if (error) {
    return (
      <div className="max-w-2xl mx-auto" data-testid="store-dealer-request-details">
        <div role="alert" className="rounded-lg bg-danger-soft border border-danger/30 p-5 text-danger">
          <p className="font-medium mb-1">Erreur</p>
          <p className="text-sm">{error}</p>
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={() => navigate('/dealer-requests')}
              className="rounded bg-danger px-3 py-1.5 text-sm font-medium text-white hover:bg-danger/90 transition-colors"
              data-testid="btn-back-error"
            >
              Retour à la liste
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render — détail
  // ---------------------------------------------------------------------------

  const isPending     = request.status === 'pending'
  const typeLabel     = DEALER_REQUEST_TYPE_LABELS[request.requestType] ?? 'Type inconnu'
  const amountDisplay = formatStoredAmount(request.amount)

  return (
    <div className="max-w-2xl mx-auto" data-testid="store-dealer-request-details">
      {/* Modales */}
      {confirmModalOpen && (
        <ConfirmModal
          request={request}
          processing={processingAction === 'confirm'}
          onConfirm={handleConfirm}
          onClose={() => {
            if (!processingAction) setConfirmModalOpen(false)
          }}
          initialFocusRef={confirmInitialFocusRef}
        />
      )}
      {rejectModalOpen && (
        <RejectModal
          processing={processingAction === 'reject'}
          onReject={handleReject}
          onClose={() => {
            if (!processingAction) setRejectModalOpen(false)
          }}
          initialFocusRef={rejectInitialFocusRef}
        />
      )}

      {/* Retour. La flèche était un caractère tapé au clavier : sa graisse ne
          suit pas la typo, son rendu dépend de la police du système, et un
          lecteur d'écran la prononce. */}
      <div className="mb-5">
        <button
          type="button"
          onClick={() => navigate('/dealer-requests')}
          className="inline-flex items-center gap-1.5 rounded text-sm font-medium text-brand-500 transition-colors hover:text-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          data-testid="btn-back"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Retour à la liste
        </button>
      </div>

      {/* Bannière de succès */}
      {actionSuccess && (
        <div
          ref={successBannerRef}
          tabIndex={-1}
          role="status"
          className="mb-4 rounded-lg bg-success-soft border border-success/30 p-4 text-sm text-success focus:outline-none"
          data-testid="action-success"
        >
          {actionSuccess}
        </div>
      )}

      {/* Bannière d'erreur rechargement (mutation réussie, rechargement échoué) */}
      {refreshError && (
        <div
          role="alert"
          className="mb-4 rounded-lg bg-warn-soft border border-warn/30 p-4 text-sm text-warn"
          data-testid="refresh-error"
        >
          {refreshError}
        </div>
      )}

      {/* Bannière d'erreur action */}
      {actionError && (
        <div
          role="alert"
          className="mb-4 rounded-lg bg-danger-soft border border-danger/30 p-4 text-sm text-danger"
          data-testid="action-error"
        >
          {actionError}
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-6">
        {/* En-tête */}
        <div className="flex items-start justify-between gap-3 mb-6">
          <div>
            <h1 className="text-lg font-bold text-gray-800">Détail de la demande</h1>
            <p className="text-xs text-gray-400 mt-0.5 break-all">{request.id}</p>
          </div>
          <DealerRequestStatusBadge status={request.status} />
        </div>

        {/* Champs */}
        <dl>
          <Field label="Dealer" value={request.dealerName ?? 'Dealer inconnu'} />
          <Field label="Email Dealer" value={request.dealerEmail ?? 'Email indisponible'} />
          <Field label="Boutique ciblée" value={request.targetStoreName ?? 'Boutique inconnue'} />
          <Field label="Type" value={typeLabel} />
          <Field label="Montant" value={amountDisplay} />
          <Field label="Réseau" value={request.network ?? '—'} />
          <Field label="Statut" value={<DealerRequestStatusBadge status={request.status} />} />
          <Field label="Créée le" value={formatFirestoreDate(request.createdAt)} />
          <Field label="Mise à jour le" value={formatFirestoreDate(request.updatedAt)} />
          <Field label="Ancien solde" value={request.previousBalance != null ? formatStoredAmount(request.previousBalance) : '—'} />
          <Field label="Nouveau solde" value={request.newBalance != null ? formatStoredAmount(request.newBalance) : '—'} />
          <Field label="Confirmé par" value={request.confirmedBy ?? '—'} />
          <Field label="Confirmé le" value={request.confirmedAt ? formatFirestoreDate(request.confirmedAt) : '—'} />
          <Field label="Rejeté par" value={request.rejectedBy ?? '—'} />
          <Field label="Rejeté le" value={request.rejectedAt ? formatFirestoreDate(request.rejectedAt) : '—'} />
          <Field label="Motif du rejet" value={request.rejectionReason ?? '—'} />
        </dl>

        {/* Actions — uniquement pour les demandes en attente */}
        {isPending && (
          <div className="mt-6 pt-5 border-t border-line/60 flex flex-wrap gap-3" data-testid="action-buttons">
            <button
              ref={confirmTriggerRef}
              type="button"
              onClick={() => { setActionError(null); setActionSuccess(null); setRefreshError(null); setConfirmModalOpen(true) }}
              disabled={!!processingAction}
              className="rounded bg-success px-5 py-2 text-sm font-medium text-white hover:bg-success/90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 transition-colors"
              aria-label="Confirmer cette demande Dealer"
              data-testid="btn-confirm"
            >
              {processingAction === 'confirm' ? 'Confirmation…' : 'Confirmer la demande'}
            </button>
            <button
              ref={rejectTriggerRef}
              type="button"
              onClick={() => { setActionError(null); setActionSuccess(null); setRefreshError(null); setRejectModalOpen(true) }}
              disabled={!!processingAction}
              className="rounded bg-danger px-5 py-2 text-sm font-medium text-white hover:bg-danger/90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger transition-colors"
              aria-label="Rejeter cette demande Dealer"
              data-testid="btn-reject"
            >
              {processingAction === 'reject' ? 'Rejet en cours…' : 'Rejeter la demande'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default StoreAdminDealerRequestDetails
