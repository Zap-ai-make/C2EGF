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
    <div className="max-w-6xl mx-auto" data-testid="store-dealer-requests">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <h1 className="text-xl font-bold text-gray-800">Demandes Dealer</h1>
        <button
          type="button"
          onClick={() => { setExtraRequests([]); setRefreshKey(k => k + 1) }}
          disabled={loading}
          className="rounded bg-gray-100 border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 transition-colors"
          aria-label="Actualiser la liste"
          data-testid="btn-refresh"
        >
          {loading ? 'Chargement…' : 'Actualiser'}
        </button>
      </div>

      {/* Filtres */}
      <div className="bg-white rounded-lg shadow p-4 mb-5 flex flex-wrap gap-4 items-end">
        {/* Statut */}
        <div className="flex-1 min-w-36">
          <label htmlFor="status-filter" className="block text-xs font-medium text-gray-600 mb-1">
            Statut
          </label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={e => handleStatusChange(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
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
          <label htmlFor="type-filter" className="block text-xs font-medium text-gray-600 mb-1">
            Type
          </label>
          <select
            id="type-filter"
            value={typeFilter}
            onChange={e => handleTypeChange(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
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
          <label htmlFor="dealer-search" className="block text-xs font-medium text-gray-600 mb-1">
            Rechercher dans les demandes chargées
          </label>
          <input
            id="dealer-search"
            type="search"
            value={dealerSearch}
            onChange={e => setDealerSearch(e.target.value)}
            placeholder="Nom ou email Dealer…"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            aria-label="Rechercher parmi les demandes chargées"
            data-testid="filter-dealer"
          />
        </div>
      </div>

      {/* État chargement initial */}
      {loading && (
        <div className="space-y-3" aria-busy="true" aria-label="Chargement des demandes">
          {[1, 2, 3].map(n => (
            <div key={n} className="bg-white rounded-lg shadow p-4 animate-pulse">
              <div className="flex justify-between items-center">
                <div className="h-4 w-40 bg-gray-200 rounded" />
                <div className="h-5 w-20 bg-gray-200 rounded-full" />
              </div>
              <div className="mt-3 flex gap-6">
                <div className="h-4 w-24 bg-gray-200 rounded" />
                <div className="h-4 w-20 bg-gray-200 rounded" />
                <div className="h-4 w-28 bg-gray-200 rounded" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Erreur */}
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 p-5 text-red-700">
          <p className="font-medium mb-1">Erreur</p>
          <p className="text-sm">{error}</p>
          <button
            type="button"
            onClick={() => setRefreshKey(k => k + 1)}
            className="mt-3 rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors"
            data-testid="btn-retry"
          >
            Réessayer
          </button>
        </div>
      )}

      {/* Liste vide */}
      {hasLoaded && !loading && !error && requests.length === 0 && (
        <div className="bg-white rounded-lg shadow p-10 text-center text-gray-500" data-testid="empty-state">
          {statusFilter || typeFilter
            ? 'Aucune demande ne correspond aux filtres sélectionnés.'
            : 'Aucune demande Dealer pour votre boutique.'}
        </div>
      )}

      {/* Aucun résultat après filtre local */}
      {hasLoaded && !loading && !error && requests.length > 0 && filtered.length === 0 && (
        <div className="bg-white rounded-lg shadow p-10 text-center text-gray-500" data-testid="empty-search">
          Aucune demande ne correspond à « {dealerSearch} ».
        </div>
      )}

      {/* Tableau */}
      {!loading && filtered.length > 0 && (
        <>
          <div className="bg-white rounded-lg shadow overflow-x-auto" data-testid="requests-table">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Dealer</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Montant</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Réseau</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Statut</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Créée le</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Mise à jour</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <span className="sr-only">Détail</span>
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {filtered.map(req => (
                  <tr key={req.id} data-testid={`request-row-${req.id}`}>
                    <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-800">
                      {req.dealerName ?? 'Dealer inconnu'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600 text-xs">
                      {req.dealerEmail ?? 'Email indisponible'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                      {DEALER_REQUEST_TYPE_LABELS[req.requestType] ?? 'Type inconnu'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-800 font-medium">
                      {formatStoredAmount(req.amount)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                      {req.network ?? '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <DealerRequestStatusBadge status={req.status} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500 text-xs">
                      {formatFirestoreDate(req.createdAt)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500 text-xs">
                      {formatFirestoreDate(req.updatedAt)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => navigate(`/dealer-requests/${req.id}`)}
                        className="text-blue-600 hover:text-blue-800 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
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
                className="rounded bg-gray-100 border border-gray-300 px-6 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 transition-colors"
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
