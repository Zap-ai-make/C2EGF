import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import {
  listStoreAdminDealerRequests,
  subscribeStoreAdminDealerRequests,
} from '../../services/storeAdminDealerService'
import { formatStoredAmount } from '../../utils/formatCurrency'
import { mergeUniqueRequests } from '../../utils/mergeRequests'
import { formatFirestoreDate } from '../../utils/formatFirestoreDate'
import DealerRequestStatusBadge from '../../components/ui/DealerRequestStatusBadge'
import PageHeader from '../../components/ui/PageHeader'
import EmptyState from '../../components/ui/EmptyState'
import ErrorState from '../../components/ui/ErrorState'
import { SkeletonTable } from '../../components/ui/SkeletonList'
import { RefreshCw, Inbox, SearchX } from 'lucide-react'
import {
  DEALER_REQUEST_STATUS_LABELS,
  DEALER_REQUEST_STATUSES,
  DEALER_REQUEST_TYPE_LABELS,
  DEALER_REQUEST_TYPES,
} from '../../constants/dealerConstants'

// ---------------------------------------------------------------------------
// Badges statut
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Options de filtres
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = [
  { value: '', label: 'Tous les statuts' },
  { value: DEALER_REQUEST_STATUSES.PENDING,   label: DEALER_REQUEST_STATUS_LABELS.pending },
  { value: DEALER_REQUEST_STATUSES.CONFIRMED, label: DEALER_REQUEST_STATUS_LABELS.confirmed },
  { value: DEALER_REQUEST_STATUSES.REJECTED,  label: DEALER_REQUEST_STATUS_LABELS.rejected },
]

const TYPE_OPTIONS = [
  { value: '', label: 'Tous les types' },
  { value: DEALER_REQUEST_TYPES.STOCK_ADD,     label: DEALER_REQUEST_TYPE_LABELS.stock_add },
  { value: DEALER_REQUEST_TYPES.LIQUIDITY_ADD, label: DEALER_REQUEST_TYPE_LABELS.liquidity_add },
]

// ---------------------------------------------------------------------------
// StoreAdminDealerRequests
// ---------------------------------------------------------------------------

function StoreAdminDealerRequests() {
  const { currentUser, userProfile } = useAuth()
  const navigate = useNavigate()

  // Première page — mise à jour temps réel via onSnapshot
  const [realtimeRequests, setRealtimeRequests] = useState([])
  // Pages supplémentaires — chargées via getDocs avec curseur
  const [extraRequests, setExtraRequests] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const [hasLoaded, setHasLoaded] = useState(false)
  // refreshKey force la re-souscription sans changer les filtres (bouton Actualiser)
  const [refreshKey, setRefreshKey] = useState(0)

  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [dealerSearch, setDealerSearch] = useState('')

  // Curseurs Firestore — séparés pour éviter qu'un nouveau snapshot n'écrase
  // le curseur d'une page supplémentaire déjà chargée.
  const realtimeLastDocRef = useRef(null)     // dernier doc du snapshot (première page)
  const paginationLastDocRef = useRef(null)   // dernier doc de la dernière page extra
  // Indique si au moins un loadMore a réussi, indépendamment de la valeur du curseur.
  const hasLoadedExtraPagesRef = useRef(false)
  // Génération du contexte : incrémentée à chaque reset (filtre / user / profil / refreshKey).
  const requestGenerationRef = useRef(0)
  // Identifiant de l'opération loadMore en cours : protège le finally.
  const loadMoreOperationRef = useRef(0)

  // ---------------------------------------------------------------------------
  // Abonnement temps réel — première page
  // ---------------------------------------------------------------------------

  useEffect(() => {
    requestGenerationRef.current += 1
    setLoadingMore(false)
    setRealtimeRequests([])
    setExtraRequests([])
    setHasMore(false)
    setLoading(true)
    setHasLoaded(false)
    setError(null)
    realtimeLastDocRef.current = null
    paginationLastDocRef.current = null
    hasLoadedExtraPagesRef.current = false

    let unsubscribe
    try {
      unsubscribe = subscribeStoreAdminDealerRequests({
        currentUser,
        userProfile,
        statusFilter: statusFilter || null,
        typeFilter: typeFilter || null,
        onUpdate: ({ requests, lastDoc, hasMore: more }) => {
          setRealtimeRequests(requests)
          realtimeLastDocRef.current = lastDoc
          // Ne mettre à jour hasMore depuis le snapshot que si aucune page extra
          // n'a encore été chargée ; après, c'est le loadMore qui gère hasMore.
          if (!hasLoadedExtraPagesRef.current) {
            setHasMore(more)
          }
          setLoading(false)
          setHasLoaded(true)
        },
        onError: (err) => {
          setError(err.message)
          setLoading(false)
          setHasLoaded(true)
        },
      })
    } catch (err) {
      setError(err.message)
      setLoading(false)
      setHasLoaded(true)
    }

    return () => {
      requestGenerationRef.current += 1
      loadMoreOperationRef.current += 1
      unsubscribe?.()
    }
  }, [statusFilter, typeFilter, refreshKey, currentUser, userProfile])

  // ---------------------------------------------------------------------------
  // Chargement page suivante
  // ---------------------------------------------------------------------------

  const loadMore = useCallback(async () => {
    // Pagination commencée et curseur épuisé → dernière page déjà atteinte,
    // ne pas repartir depuis realtimeLastDocRef.
    if (hasLoadedExtraPagesRef.current && paginationLastDocRef.current === null) return
    // Avant le premier loadMore : curseur du snapshot.
    // Après au moins un loadMore : curseur de la dernière page extra.
    const cursorDoc = hasLoadedExtraPagesRef.current
      ? paginationLastDocRef.current
      : realtimeLastDocRef.current
    if (!cursorDoc || loadingMore) return

    const generationAtStart = requestGenerationRef.current
    const operationId = ++loadMoreOperationRef.current

    setLoadingMore(true)
    try {
      const result = await listStoreAdminDealerRequests({
        currentUser,
        userProfile,
        statusFilter: statusFilter || null,
        typeFilter: typeFilter || null,
        lastDoc: cursorDoc,
      })
      if (generationAtStart !== requestGenerationRef.current) return
      setExtraRequests(prev => [...prev, ...result.requests])
      hasLoadedExtraPagesRef.current = true
      paginationLastDocRef.current = result.lastDoc
      setHasMore(result.hasMore)
    } catch (err) {
      if (generationAtStart !== requestGenerationRef.current) return
      setError(err.message)
    } finally {
      if (
        generationAtStart === requestGenerationRef.current &&
        operationId === loadMoreOperationRef.current
      ) {
        setLoadingMore(false)
      }
    }
  }, [currentUser, userProfile, statusFilter, typeFilter, loadingMore])

  // ---------------------------------------------------------------------------
  // Changements de filtre → re-souscription via useEffect
  // ---------------------------------------------------------------------------

  function handleStatusChange(value) {
    setStatusFilter(value)
  }

  function handleTypeChange(value) {
    setTypeFilter(value)
  }

  // ---------------------------------------------------------------------------
  // Fusion première page (temps réel) + pages supplémentaires, sans doublons
  // ---------------------------------------------------------------------------

  const requests = useMemo(
    () => mergeUniqueRequests(realtimeRequests, extraRequests),
    [realtimeRequests, extraRequests],
  )

  const filtered = dealerSearch.trim()
    ? requests.filter(r =>
        (r.dealerName ?? '').toLowerCase().includes(dealerSearch.toLowerCase()) ||
        (r.dealerEmail ?? '').toLowerCase().includes(dealerSearch.toLowerCase())
      )
    : requests

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div data-testid="store-dealer-requests">
      {/* Le titre passe par PageHeader, comme les six autres écrans de la
          boutique : un h1, un seul dessin, et une place prévue pour l'action.
          L'écran ouvrait aussi sa propre largeur (`max-w-6xl mx-auto`) alors
          que le Layout tient déjà la gouttière — un tableau de neuf colonnes
          n'a aucune raison d'être plus étroit que celui de l'historique. */}
      <PageHeader
        title="Demandes Dealer"
        subtitle="Ravitaillements demandés par le dealer pour votre boutique"
        actions={
          <button
            type="button"
            onClick={() => { setExtraRequests([]); setRefreshKey(k => k + 1) }}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-brand-50 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            aria-label="Actualiser la liste"
            data-testid="btn-refresh"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {loading ? 'Chargement…' : 'Actualiser'}
          </button>
        }
      />

      {/* Filtres */}
      <div className="mb-5 flex flex-wrap items-end gap-4 rounded-lg border border-line bg-surface p-4">
        {/* Statut */}
        <div className="flex-1 min-w-36">
          <label htmlFor="status-filter" className="mb-1 block text-xs font-medium text-ink-muted">
            Statut
          </label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={e => handleStatusChange(e.target.value)}
            className="w-full rounded border border-line px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            aria-label="Filtrer par statut"
            data-testid="filter-status"
          >
            {STATUS_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Type */}
        <div className="flex-1 min-w-36">
          <label htmlFor="type-filter" className="mb-1 block text-xs font-medium text-ink-muted">
            Type
          </label>
          <select
            id="type-filter"
            value={typeFilter}
            onChange={e => handleTypeChange(e.target.value)}
            className="w-full rounded border border-line px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            aria-label="Filtrer par type"
            data-testid="filter-type"
          >
            {TYPE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Recherche locale Dealer */}
        <div className="flex-1 min-w-40">
          <label htmlFor="dealer-search" className="mb-1 block text-xs font-medium text-ink-muted">
            Rechercher dans les demandes chargées
          </label>
          <input
            id="dealer-search"
            type="search"
            value={dealerSearch}
            onChange={e => setDealerSearch(e.target.value)}
            placeholder="Nom ou email Dealer…"
            className="w-full rounded border border-line px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            aria-label="Rechercher parmi les demandes chargées"
            data-testid="filter-dealer"
          />
        </div>
      </div>

      {/* Chargement : le squelette partagé. Il en existait un quatrième ici,
          fait main — trois fausses cartes, alors que le contenu qui arrive est
          un TABLEAU. Un squelette qui n'annonce pas la bonne forme fait sauter
          la page au moment où les données arrivent. */}
      {loading && <SkeletonTable rows={4} cols={6} />}

      {/* Erreur : le composant partagé, qui porte déjà role="alert" et son
          bouton « Réessayer ». */}
      {error && <ErrorState message={error} onRetry={() => setRefreshKey(k => k + 1)} />}

      {/* Deux vides distincts, deux issues distinctes : des filtres qui ne
          rendent rien s'effacent ; une boîte réellement vide n'attend rien de
          l'utilisateur — elle attend le dealer, et le dit. */}
      {hasLoaded && !loading && !error && requests.length === 0 && (
        <div data-testid="empty-state">
          {statusFilter || typeFilter ? (
            <EmptyState
              icon={SearchX}
              title="Aucune demande ne correspond aux filtres sélectionnés."
              message="Élargissez la sélection pour voir les autres demandes."
              action={
                <button
                  type="button"
                  onClick={() => { handleStatusChange(''); handleTypeChange('') }}
                  className="rounded border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                >
                  Effacer les filtres
                </button>
              }
            />
          ) : (
            <EmptyState
              icon={Inbox}
              title="Aucune demande Dealer pour votre boutique."
              message="Les ravitaillements envoyés par le dealer apparaîtront ici, à valider ou à rejeter."
            />
          )}
        </div>
      )}

      {hasLoaded && !loading && !error && requests.length > 0 && filtered.length === 0 && (
        <div data-testid="empty-search">
          <EmptyState
            icon={SearchX}
            title={'Aucune demande ne correspond à \u00ab ' + dealerSearch + ' \u00bb.'}
            message="La recherche ne porte que sur les demandes déjà chargées."
            action={
              <button
                type="button"
                onClick={() => setDealerSearch('')}
                className="rounded border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                Effacer la recherche
              </button>
            }
          />
        </div>
      )}

      {/* Tableau */}
      {!loading && filtered.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface" data-testid="requests-table">
            <table className="min-w-full text-sm">
              <thead className="border-b border-line bg-brand-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">Dealer</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">Email</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">Type</th>
                  <th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-ink-muted">Montant</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">Réseau</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">Statut</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">Créée le</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">Mise à jour</th>
                  {/* `relative` n'est pas décoratif ici : `sr-only` place son
                      contenu en `position: absolute`. Sans ancêtre positionné,
                      son bloc conteneur devient la PAGE — il échappe au cadre
                      défilant du tableau et va se poser à la largeur réelle de
                      celui-ci, ~1 035 px. Le document se met alors à défiler
                      horizontalement sur mobile, alors que le tableau, lui,
                      défilait correctement dans son cadre. Un texte invisible
                      d'un pixel élargissait la page de 645 px. */}
                  <th scope="col" className="relative px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">
                    <span className="sr-only">Détail</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {filtered.map(req => (
                  <tr key={req.id} className="transition-colors hover:bg-brand-50/60" data-testid={`request-row-${req.id}`}>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-ink">
                      {req.dealerName ?? 'Dealer inconnu'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-muted">
                      {req.dealerEmail ?? 'Email indisponible'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-muted">
                      {DEALER_REQUEST_TYPE_LABELS[req.requestType] ?? 'Type inconnu'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums text-ink">
                      {formatStoredAmount(req.amount)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-muted">
                      {req.network ?? '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <DealerRequestStatusBadge status={req.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-muted">
                      {formatFirestoreDate(req.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-muted">
                      {formatFirestoreDate(req.updatedAt)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => navigate(`/dealer-requests/${req.id}`)}
                        className="text-brand-500 hover:text-brand-600 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 rounded"
                        aria-label={`Voir le détail de la demande ${req.id}`}
                        data-testid={`btn-detail-${req.id}`}
                      >
                        Voir le détail
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Charger plus */}
          {hasMore && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded border border-line bg-surface px-6 py-2 text-sm font-medium text-ink transition-colors hover:bg-brand-50 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                data-testid="btn-load-more"
              >
                {loadingMore ? 'Chargement…' : 'Charger plus'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default StoreAdminDealerRequests
