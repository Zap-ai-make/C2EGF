import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { listDealerRequests, subscribeDealerRequests } from '../../services/dealerService'
import { useRealtimePaginatedRequests } from '../../hooks/useRealtimePaginatedRequests'
import { formatCurrency } from '../../utils/formatCurrency'
import {
  DEALER_REQUEST_STATUS_LABELS,
  DEALER_REQUEST_TYPE_LABELS,
  DEALER_REQUEST_STATUSES,
  DEALER_NETWORK,
} from '../../constants/dealerConstants'
import PageHeader from '../../components/ui/PageHeader'
import MessageDeRetour from '../../components/dealer/MessageDeRetour'
import EmptyState from '../../components/ui/EmptyState'
import ErrorState from '../../components/ui/ErrorState'
import RejectionRemarkButton from '../../components/ui/RejectionRemarkButton'
import DealerRequestStatusBadge from '../../components/ui/DealerRequestStatusBadge'
import Registre, { SqueletteRegistre } from '../../components/dealer/Registre'
import { formatDateTime as formatDate } from '../../utils/formatters'

/**
 * Mes ravitaillements — la file de ce que le dealer a envoyé.
 *
 * La double source — abonnement temps réel sur la première page, curseur
 * `getDocs` sur les suivantes — vit dans `useRealtimePaginatedRequests`. Ses
 * gardes de concurrence restent caractérisées sur cette page et sur la vue
 * boutique, qui partage désormais la même orchestration.
 *
 * L'état « Appuyez sur Actualiser » a disparu : il était inatteignable, puisque
 * l'abonnement part au montage. Un état mort dans le code est un état qu'on
 * croit avoir dessiné.
 */

const STATUS_OPTIONS = [
  { value: '', label: 'Tous les statuts' },
  { value: DEALER_REQUEST_STATUSES.PENDING, label: DEALER_REQUEST_STATUS_LABELS.pending },
  { value: DEALER_REQUEST_STATUSES.CONFIRMED, label: DEALER_REQUEST_STATUS_LABELS.confirmed },
  { value: DEALER_REQUEST_STATUSES.REJECTED, label: DEALER_REQUEST_STATUS_LABELS.rejected },
]

const COLONNES = [
  { cle: 'boutique', titre: 'Boutique' },
  { cle: 'type', titre: 'Type' },
  { cle: 'montant', titre: 'Montant', nombre: true },
  { cle: 'reseau', titre: 'Réseau' },
  { cle: 'statut', titre: 'Statut' },
  { cle: 'remarque', titre: 'Remarque' },
  { cle: 'date', titre: 'Date', discret: true },
]

const CHAMP = 'rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400'

function DealerRequests() {
  const { currentUser, userProfile } = useAuth()
  const navigate = useNavigate()

  // Filtres
  const [statusFilter, setStatusFilter] = useState('')
  const [storeSearch, setStoreSearch] = useState('')

  const requestArgs = useMemo(() => ({
    currentUser,
    userProfile,
    statusFilter: statusFilter || null,
  }), [currentUser, statusFilter, userProfile])

  const {
    requests,
    hasMore,
    loading,
    loadingMore,
    error,
    hasLoaded,
    loadMore,
    refresh,
  } = useRealtimePaginatedRequests({
    subscribeRequests: subscribeDealerRequests,
    listRequests: listDealerRequests,
    subscriptionArgs: requestArgs,
  })

  // ---------------------------------------------------------------------------
  // Filtre statut → redémarre l'abonnement via useEffect
  // ---------------------------------------------------------------------------

  function handleStatusChange(value) {
    setStatusFilter(value)
  }

  const filtered = storeSearch.trim()
    ? requests.filter(r =>
        r.targetStoreName?.toLowerCase().includes(storeSearch.toLowerCase())
      )
    : requests

  const filtreActif = Boolean(statusFilter || storeSearch.trim())
  const effacerFiltres = () => { handleStatusChange(''); setStoreSearch('') }

  // Le vide filtré NOMME le filtre qui ne rend rien. « Aucun résultat » tout
  // court oblige à remonter lire les champs pour comprendre ce qu'on cherchait ;
  // sur un écran où deux filtres se combinent, c'est une devinette.
  const critereActif = [
    statusFilter && `le statut « ${DEALER_REQUEST_STATUS_LABELS[statusFilter] ?? statusFilter} »`,
    storeSearch.trim() && `la boutique « ${storeSearch.trim()} »`,
  ].filter(Boolean).join(' et ')

  const cellules = (req) => ({
    boutique: <span className="font-medium text-ink">{req.targetStoreName}</span>,
    type: <span className="text-ink-muted">{DEALER_REQUEST_TYPE_LABELS[req.requestType] ?? req.requestType}</span>,
    montant: formatCurrency(req.amount),
    reseau: <span className="text-ink-muted">{req.network ?? DEALER_NETWORK}</span>,
    statut: <DealerRequestStatusBadge status={req.status} />,
    remarque: (
      <RejectionRemarkButton
        storeName={req.targetStoreName}
        reason={req.status === DEALER_REQUEST_STATUSES.REJECTED ? req.rejectionReason : null}
        testId={`remark-btn-${req.id}`}
      />
    ),
    date: formatDate(req.createdAt),
  })

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div data-testid="dealer-requests">
      <PageHeader
        title="Mes ravitaillements"
        subtitle="Ce que j’ai envoyé aux boutiques, et où ça en est"
        actions={
          <>
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-brand-50 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              aria-label="Actualiser la liste"
            >
              {loading ? 'Chargement…' : 'Actualiser'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/dealer/requests/new')}
              className="rounded-lg bg-brand-500 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              data-testid="btn-new-request"
            >
              Nouveau ravitaillement
            </button>
          </>
        }
      />

      {/* Le retour du geste qui vient d'être fait, s'il y en a un : il arrive
          par l'état du routeur, depuis l'écran de ravitaillement. */}
      <MessageDeRetour />

      {/* Filtres */}
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="min-w-40 flex-1 sm:max-w-56">
          <label htmlFor="status-filter" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Statut
          </label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={e => handleStatusChange(e.target.value)}
            className={`w-full ${CHAMP}`}
            aria-label="Filtrer par statut"
            data-testid="filter-status"
          >
            {STATUS_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="min-w-40 flex-1 sm:max-w-80">
          <label htmlFor="store-filter" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Boutique
          </label>
          <input
            id="store-filter"
            type="search"
            value={storeSearch}
            onChange={e => setStoreSearch(e.target.value)}
            placeholder="Nom de la boutique…"
            className={`w-full ${CHAMP}`}
            aria-label="Filtrer par nom de boutique"
            data-testid="filter-store"
          />
        </div>
      </div>

      {loading && <SqueletteRegistre colonnes={COLONNES} lignes={5} />}

      {error && (
        <ErrorState message={error} onRetry={refresh} />
      )}

      {/* Deux vides, et non un seul (DESIGN.md §10). « Vous n'avez encore rien
          envoyé » invite à créer ; « rien ne correspond » invite à élargir.
          Un texte unique en trahirait forcément un des deux. */}
      {hasLoaded && !loading && !error && filtered.length === 0 && (
        filtreActif ? (
          <div data-testid="empty-state">
            <EmptyState
              title="Aucun ravitaillement ne correspond"
              message={`Aucun ravitaillement avec ${critereActif}.`}
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
          </div>
        ) : (
          <div data-testid="empty-state">
            <EmptyState
              title="Aucun ravitaillement"
              message="Envoyez du stock ou de la liquidité à une boutique de votre réseau ; le ravitaillement apparaîtra ici jusqu’à ce qu’elle le confirme."
              action={
                <button
                  type="button"
                  onClick={() => navigate('/dealer/requests/new')}
                  className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                >
                  Nouveau ravitaillement
                </button>
              }
            />
          </div>
        )
      )}

      {!loading && !error && filtered.length > 0 && (
        <>
          <Registre
            colonnes={COLONNES}
            lignes={filtered}
            cle={(req) => req.id}
            cellules={cellules}
            libelle="Mes ravitaillements envoyés aux boutiques"
            testId="requests-table"
            testIdLigne={(req) => `request-row-${req.id}`}
          />

          {hasMore && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-lg border border-line bg-surface px-6 py-2 text-sm font-medium text-ink transition-colors hover:bg-brand-50 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                data-testid="btn-load-more"
              >
                {loadingMore ? 'Chargement…' : 'Voir plus'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default DealerRequests
