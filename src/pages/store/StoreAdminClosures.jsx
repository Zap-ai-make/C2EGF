import { useState, useCallback, useEffect, useRef } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { useAuth } from '../../context/AuthContext.jsx'
import PageHeader from '../../components/ui/PageHeader'
import ErrorState from '../../components/ui/ErrorState'
import { listStoreClosures } from '../../services/closureService'
import { formatDateShort as fmtDate } from '../../utils/formatters'

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function fmtAmount(n) {
  if (typeof n !== 'number') return '—'
  return n.toLocaleString('fr-FR') + ' FCFA'
}

function diffClass(v) {
  if (v === 0) return 'text-gray-500'
  // Un écart de clôture est un MOUVEMENT D'ARGENT signé, pas un succès ni un
  // échec : positif il entre, négatif il sort. D'où inflow/outflow et non
  // success/danger — la distinction que toute l'application confondait.
  return v > 0 ? 'text-inflow' : 'text-outflow'
}

const STATUS_LABELS = {
  // Mêmes jetons que DealerRequestStatusBadge : « En attente » ne peut pas être
  // ambre ici et gris-bleu ailleurs.
  pending:   { label: 'En attente',  cls: 'bg-pending-soft text-pending' },
  confirmed: { label: 'Confirmée',   cls: 'bg-success-soft text-success' },
  rejected:  { label: 'Rejetée',     cls: 'bg-danger-soft  text-danger'  },
}

// ──────────────────────────────────────────────────────────────────────────────
// Modal de rejet
// ──────────────────────────────────────────────────────────────────────────────

function RejectModal({ closureId, onSuccess, onClose }) {
  const [reason, setReason]         = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr]               = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (reason.trim().length < 3) { setErr('Motif requis (minimum 3 caractères).'); return }
    setSubmitting(true)
    setErr(null)
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'rejectDealerClosure')
      await fn({ closureId, rejectionReason: reason.trim() })
      onSuccess()
    } catch (e) {
      setErr(e?.details?.message ?? e?.message ?? 'Erreur inattendue.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl p-6 mx-4">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Rejeter la clôture</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Motif de rejet</label>
            <textarea
              rows={3}
              value={reason}
              onChange={e => setReason(e.target.value)}
              maxLength={500}
              className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-danger resize-none"
              placeholder="Expliquez pourquoi vous rejetez cette clôture…"
              autoFocus
              data-testid="reject-reason-input"
            />
            <p className="text-xs text-gray-400 mt-0.5">{reason.length}/500</p>
          </div>
          {err && <p className="text-sm text-danger">{err}</p>}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white hover:bg-danger/90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
              data-testid="reject-confirm-btn"
            >
              {submitting ? 'Envoi…' : 'Rejeter'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// StoreAdminClosures
// ──────────────────────────────────────────────────────────────────────────────

function StoreAdminClosures() {
  const { userProfile } = useAuth()
  const storeId = userProfile?.storeId

  const [closures, setClosures]           = useState([])
  const [loading,  setLoading]            = useState(true)
  const [error,    setError]              = useState(null)
  const [hasMore,  setHasMore]            = useState(false)
  const [actionLoading, setActionLoading] = useState(null)
  const [actionError,   setActionError]   = useState(null)
  const [rejectTarget,  setRejectTarget]  = useState(null)
  const lastDocRef = useRef(null)

  const loadClosures = useCallback(async (reset = true) => {
    if (!storeId) return
    setLoading(true)
    setError(null)
    try {
      const cursor = reset ? null : lastDocRef.current
      const result = await listStoreClosures({ storeId, lastDoc: cursor })
      setClosures(prev => reset ? result.closures : [...prev, ...result.closures])
      setHasMore(result.hasMore)
      lastDocRef.current = result.lastDoc
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [storeId])

  useEffect(() => { loadClosures(true) }, [loadClosures])

  async function handleConfirm(closureId) {
    setActionLoading(closureId)
    setActionError(null)
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'confirmDealerClosure')
      await fn({ closureId })
      loadClosures(true)
    } catch (err) {
      setActionError(err?.details?.message ?? err?.message ?? 'Erreur inattendue.')
    } finally {
      setActionLoading(null)
    }
  }

  if (!storeId) {
    return (
      <div data-testid="store-admin-closures">
        <PageHeader title="Clôtures Dealer" subtitle="Clôtures soumises pour votre boutique" />
        <ErrorState message="Votre profil n'est associé à aucune boutique." />
      </div>
    )
  }

  return (
    <div data-testid="store-admin-closures">
      {rejectTarget && (
        <RejectModal
          closureId={rejectTarget}
          onSuccess={() => { setRejectTarget(null); loadClosures(true) }}
          onClose={() => setRejectTarget(null)}
        />
      )}

      <PageHeader
        title="Clôtures Dealer"
        subtitle="Clôtures soumises pour votre boutique"
        actions={
          <button
            type="button"
            onClick={() => loadClosures(true)}
            disabled={loading}
            className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            {loading ? 'Chargement…' : 'Actualiser'}
          </button>
        }
      />

      {actionError && (
        <div className="mb-4 rounded-lg bg-danger-soft border border-danger/30 px-4 py-3 text-sm text-danger">
          {actionError}
        </div>
      )}

      {loading && closures.length === 0 && (
        <div className="space-y-3">
          {[1,2,3].map(n => <div key={n} className="h-24 animate-pulse rounded-xl bg-gray-100" />)}
        </div>
      )}

      {error && <ErrorState message={error} onRetry={() => loadClosures(true)} />}

      {!loading && !error && closures.length === 0 && (
        <div className="rounded-xl border border-line bg-gray-50 p-12 text-center">
          <p className="text-base font-medium text-gray-600">Aucune clôture en attente</p>
          <p className="mt-1 text-sm text-gray-400">Le Dealer n'a pas encore soumis de clôture pour votre boutique.</p>
        </div>
      )}

      {closures.length > 0 && (
        <div className="space-y-3" data-testid="store-closure-list">
          {closures.map(c => {
            const st = STATUS_LABELS[c.status] ?? { label: c.status, cls: 'bg-gray-100 text-gray-700' }
            const isActing = actionLoading === c.id
            return (
              <div key={c.id} className="rounded-xl border border-line bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                  <div>
                    <p className="font-semibold text-gray-900">{c.dealerName ?? c.dealerEmail ?? c.dealerUid}</p>
                    <p className="text-xs text-gray-500">
                      Date clôture : {c.businessDate} · Soumise le {fmtDate(c.createdAt)}
                    </p>
                  </div>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm mb-3">
                  <div>
                    <p className="text-xs text-gray-400">Stock déclaré</p>
                    <p className="font-medium text-gray-800">{fmtAmount(c.declaredStockBalance)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Stock enregistré</p>
                    <p className="font-medium text-gray-800">{fmtAmount(c.recordedStockBalance)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Liquidité déclarée</p>
                    <p className="font-medium text-gray-800">{fmtAmount(c.declaredLiquidityBalance)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Liquidité enregistrée</p>
                    <p className="font-medium text-gray-800">{fmtAmount(c.recordedLiquidityBalance)}</p>
                  </div>
                </div>

                {(c.stockDifference !== 0 || c.liquidityDifference !== 0) && (
                  <div className="flex flex-wrap gap-4 text-sm border-t border-line/60 pt-3 mb-3">
                    <div>
                      <span className="text-xs text-gray-400">Écart stock : </span>
                      <span className={`font-semibold ${diffClass(c.stockDifference)}`}>
                        {c.stockDifference > 0 ? '+' : ''}{fmtAmount(c.stockDifference)}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-gray-400">Écart liquidité : </span>
                      <span className={`font-semibold ${diffClass(c.liquidityDifference)}`}>
                        {c.liquidityDifference > 0 ? '+' : ''}{fmtAmount(c.liquidityDifference)}
                      </span>
                    </div>
                  </div>
                )}

                {c.reason && (
                  <p className="text-xs text-gray-500 italic mb-3">Motif Dealer : {c.reason}</p>
                )}
                {c.status === 'rejected' && c.rejectionReason && (
                  <p className="text-xs text-danger mb-3">Rejet : {c.rejectionReason}</p>
                )}

                {c.status === 'pending' && (
                  <div className="flex gap-3 pt-2 border-t border-line/60">
                    <button
                      type="button"
                      onClick={() => handleConfirm(c.id)}
                      disabled={isActing}
                      className="rounded-lg bg-success px-4 py-2 text-sm font-medium text-white hover:bg-success/90 transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                      data-testid={`confirm-closure-${c.id}`}
                    >
                      {isActing ? 'Traitement…' : 'Confirmer'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRejectTarget(c.id)}
                      disabled={isActing}
                      className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-2 text-sm font-medium text-danger hover:bg-danger-soft/70 transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
                      data-testid={`reject-closure-${c.id}`}
                    >
                      Rejeter
                    </button>
                  </div>
                )}
              </div>
            )
          })}

          {hasMore && (
            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => loadClosures(false)}
                disabled={loading}
                className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                {loading ? 'Chargement…' : 'Charger plus'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default StoreAdminClosures
