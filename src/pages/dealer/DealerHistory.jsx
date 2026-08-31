import { useState, useCallback, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import { listDealerRequests } from '../../services/dealerService'
import { subscribePartnerDeposits } from '../../services/storeTransferService'
import { partnerLabel } from '../../constants/dealerPartners'
import { formatCurrency } from '../../utils/formatCurrency'
import {
  DEALER_REQUEST_STATUS_LABELS,
  DEALER_REQUEST_TYPE_LABELS,
  DEALER_REQUEST_STATUSES,
} from '../../constants/dealerConstants'
import PageHeader from '../../components/ui/PageHeader'
import EmptyState from '../../components/ui/EmptyState'
import ErrorState from '../../components/ui/ErrorState'
import DealerRequestStatusBadge from '../../components/ui/DealerRequestStatusBadge'
import Registre, { SqueletteRegistre } from '../../components/dealer/Registre'
import RejectionRemarkButton from '../../components/ui/RejectionRemarkButton'
import { formatDateTime as formatDate } from '../../utils/formatters'

/**
 * L'historique — les ravitaillements et les dépôts partenaires, fusionnés.
 *
 * UN SEUL BADGE DE STATUT DANS L'ESPACE DEALER
 * ────────────────────────────────────────────
 * Cet écran utilisait `StatusBadge`, l'écran des ravitaillements
 * `DealerRequestStatusBadge`. Deux composants pour le même objet, dans le même
 * espace. Leurs palettes avaient déjà été alignées sur les jetons sémantiques ;
 * les laisser tous deux en service, c'était garder deux endroits où les
 * désaligner à nouveau. Celui qui reste est celui qui tire son libellé du
 * dictionnaire métier et porte un nom accessible complet (« Statut : … »).
 *
 * `StatusBadge` n'est pas supprimé pour autant : dix écrans admin et boutique
 * s'en servent, hors de ce chantier.
 */

const ms = (ts) => ts?.toMillis?.() ?? (ts ? new Date(ts).getTime() : 0)

const STATUS_OPTIONS = [
  { value: '', label: 'Tous les statuts' },
  { value: DEALER_REQUEST_STATUSES.PENDING, label: DEALER_REQUEST_STATUS_LABELS.pending },
  { value: DEALER_REQUEST_STATUSES.CONFIRMED, label: DEALER_REQUEST_STATUS_LABELS.confirmed },
  { value: DEALER_REQUEST_STATUSES.REJECTED, label: DEALER_REQUEST_STATUS_LABELS.rejected },
]

const COLONNES = [
  { cle: 'qui', titre: 'Boutique / Partenaire' },
  { cle: 'type', titre: 'Type' },
  { cle: 'montant', titre: 'Montant', nombre: true },
  { cle: 'statut', titre: 'Statut' },
  { cle: 'remarque', titre: 'Remarque' },
  { cle: 'solde', titre: 'Solde après', nombre: true },
  { cle: 'date', titre: 'Date', discret: true },
]

const CHAMP = 'rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400'

function DealerHistory() {
  const { currentUser, userProfile } = useAuth()

  const [requests, setRequests]       = useState([])
  const [partnerDeposits, setPartnerDeposits] = useState([])
  const [lastDoc, setLastDoc]         = useState(null)
  const [hasMore, setHasMore]         = useState(false)
  const [loading, setLoading]         = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError]             = useState(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [storeSearch, setStoreSearch]   = useState('')

  const load = useCallback(async (reset = true) => {
    if (!currentUser || !userProfile) return
    if (reset) {
      setLoading(true)
      setRequests([])
      setLastDoc(null)
      setHasMore(false)
    } else {
      setLoadingMore(true)
    }
    setError(null)

    try {
      const result = await listDealerRequests({
        currentUser,
        userProfile,
        statusFilter: statusFilter || null,
        lastDoc: reset ? null : lastDoc,
      })
      if (reset) setRequests(result.requests)
      else setRequests(prev => [...prev, ...result.requests])
      setLastDoc(result.lastDoc)
      setHasMore(result.hasMore)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [currentUser, userProfile, statusFilter, lastDoc])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(true) }, [statusFilter, currentUser, userProfile])

  // Dépôts partenaires (temps réel)
  useEffect(() => {
    if (!currentUser?.uid) { setPartnerDeposits([]); return undefined }
    return subscribePartnerDeposits({ dealerUid: currentUser.uid, onUpdate: setPartnerDeposits })
  }, [currentUser])

  // Fusion demandes + dépôts partenaires en lignes normalisées, triées par date.
  const requestRows = requests.map(r => ({
    id: r.id, kind: 'request',
    label: r.targetStoreName ?? '—',
    typeLabel: DEALER_REQUEST_TYPE_LABELS[r.requestType] ?? r.requestType,
    amount: r.amount,
    status: r.status,
    rejectionReason: r.status === DEALER_REQUEST_STATUSES.REJECTED ? r.rejectionReason : null,
    soldeApres: r.newBalance != null ? r.newBalance : null,
    createdAt: r.createdAt,
  }))
  const partnerRows = partnerDeposits.map(d => ({
    id: d.id, kind: 'partner',
    label: partnerLabel({ nom: d.partnerNom, prenom: d.partnerPrenom, localite: d.partnerLocalite, numeroDA: d.partnerNumeroDA }),
    typeLabel: d.operation === 'withdrawal' ? 'Retrait partenaire' : 'Dépôt partenaire',
    amount: d.amount,
    status: 'confirmed',
    rejectionReason: null,
    soldeApres: d.newStock != null ? d.newStock : null,
    createdAt: d.createdAt,
  }))

  const search = storeSearch.trim().toLowerCase()
  let rows = [...requestRows, ...partnerRows]
  if (statusFilter) rows = rows.filter(r => r.status === statusFilter)
  if (search) rows = rows.filter(r => r.label.toLowerCase().includes(search))
  rows = [...rows].sort((a, b) => ms(b.createdAt) - ms(a.createdAt))

  // Deux vides, et non un seul (DESIGN.md §10) : « vous n'avez rien fait » et
  // « votre filtre ne rend rien » demandent deux gestes opposés — commencer,
  // ou élargir. Un texte unique en trahit forcément un des deux.
  const filtreActif = Boolean(statusFilter || search)
  const effacerFiltres = () => { setStatusFilter(''); setStoreSearch('') }

  const cellules = (r) => ({
    qui: <span className="font-medium text-ink">{r.label}</span>,
    type: <span className="text-ink-muted">{r.typeLabel}</span>,
    montant: formatCurrency(r.amount),
    statut: <DealerRequestStatusBadge status={r.status} />,
    remarque: (
      <RejectionRemarkButton storeName={r.label} reason={r.rejectionReason} testId={`remark-btn-${r.id}`} />
    ),
    solde: r.soldeApres != null ? formatCurrency(r.soldeApres) : '—',
    date: formatDate(r.createdAt),
  })

  return (
    <div data-testid="dealer-history">
      <PageHeader
        title="Historique"
        subtitle="Mes ravitaillements de boutiques et dépôts partenaires"
        actions={
          <button
            type="button"
            onClick={() => load(true)}
            disabled={loading}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-brand-50 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            {loading ? 'Chargement…' : 'Actualiser'}
          </button>
        }
      />

      <div className="mb-5 flex flex-wrap gap-3">
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className={`sm:w-56 ${CHAMP}`}
          aria-label="Filtrer par statut"
        >
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input
          type="search"
          value={storeSearch}
          onChange={e => setStoreSearch(e.target.value)}
          placeholder="Filtrer par boutique / partenaire…"
          className={`min-w-40 flex-1 sm:max-w-80 ${CHAMP}`}
          aria-label="Rechercher par boutique ou partenaire"
        />
      </div>

      {loading && <SqueletteRegistre colonnes={COLONNES} lignes={6} />}
      {error && <ErrorState message={error} onRetry={() => load(true)} />}

      {!loading && !error && rows.length === 0 && (
        filtreActif ? (
          <EmptyState
            title="Aucune opération ne correspond"
            message="Aucune de vos opérations ne répond à ces critères. Élargissez la recherche pour retrouver le reste."
            action={
              <button
                type="button"
                onClick={effacerFiltres}
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                Effacer les filtres
              </button>
            }
          />
        ) : (
          <EmptyState
            title="Aucune opération"
            message="Vos ravitaillements de boutiques et vos dépôts partenaires apparaîtront ici, du plus récent au plus ancien."
          />
        )
      )}

      {!loading && !error && rows.length > 0 && (
        <>
          <Registre
            colonnes={COLONNES}
            lignes={rows}
            cle={(r) => `${r.kind}-${r.id}`}
            cellules={cellules}
            libelle="Historique des ravitaillements et dépôts partenaires"
            testId="history-table"
          />

          {hasMore && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => load(false)}
                disabled={loadingMore}
                className="rounded-lg border border-line bg-surface px-6 py-2 text-sm font-medium text-ink transition-colors hover:bg-brand-50 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                {loadingMore ? 'Chargement…' : 'Charger plus (ravitaillements)'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default DealerHistory
