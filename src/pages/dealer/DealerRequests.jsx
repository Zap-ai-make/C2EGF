import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { listDealerRequests, subscribeDealerRequests } from '../../services/dealerService'
import { formatCurrency } from '../../utils/formatCurrency'
import { mergeUniqueRequests } from '../../utils/mergeRequests'
import {
  DEALER_REQUEST_STATUS_LABELS,
  DEALER_REQUEST_TYPE_LABELS,
  DEALER_REQUEST_STATUSES,
  DEALER_NETWORK,
} from '../../constants/dealerConstants'
import RejectionRemarkButton from '../../components/ui/RejectionRemarkButton'
import DealerRequestStatusBadge from '../../components/ui/DealerRequestStatusBadge'
import { formatDateTime as formatDate } from '../../utils/formatters'

// ---------------------------------------------------------------------------
// DealerRequests
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = [
  { value: '', label: 'Tous les statuts' },
  { value: DEALER_REQUEST_STATUSES.PENDING, label: DEALER_REQUEST_STATUS_LABELS.pending },
  { value: DEALER_REQUEST_STATUSES.CONFIRMED, label: DEALER_REQUEST_STATUS_LABELS.confirmed },
  { value: DEALER_REQUEST_STATUSES.REJECTED, label: DEALER_REQUEST_STATUS_LABELS.rejected },
]

function DealerRequests() {
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

  // Filtres
  const [statusFilter, setStatusFilter] = useState('')
  const [storeSearch, setStoreSearch] = useState('')

  // Curseurs Firestore — séparés pour éviter qu'un nouveau snapshot n'écrase
  // le curseur d'une page supplémentaire déjà chargée.
  const realtimeLastDocRef = useRef(null)     // dernier doc du snapshot (première page)
  const paginationLastDocRef = useRef(null)   // dernier doc de la dernière page extra
  // Indique si au moins un loadMore a réussi, indépendamment de la valeur du curseur.
  // paginationLastDocRef peut devenir null sur la dernière page ; ce flag empêche
  // le snapshot de restaurer hasMore et de repartir depuis le curseur realtime.
  const hasLoadedExtraPagesRef = useRef(false)
  // Génération du contexte : incrémentée à chaque reset (filtre / user / profil / refreshKey).
  // Un loadMore qui se résout après un reset détecte la divergence et ne touche aucun état.
  const requestGenerationRef = useRef(0)
  // Identifiant de l'opération loadMore en cours : protège le finally contre une ancienne
  // opération qui remettraitloadingMore à false alors qu'une nouvelle est en cours.
  const loadMoreOperationRef = useRef(0)

  // ---------------------------------------------------------------------------
  // Abonnement temps réel — première page
  // Redémarre à chaque changement de filtre ou d'Actualiser
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
      unsubscribe = subscribeDealerRequests({
        currentUser,
        userProfile,
        statusFilter: statusFilter || null,
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
      // Invalider toute opération asynchrone en vol (loadMore) avant de fermer
      // le listener. Sans cet incrément, un loadMore démarré avant le démontage
      // ou le changement de filtre passerait le guard de génération et tenterait
      // d'écrire sur les setters d'un contexte périmé ou d'un composant démonté.
      requestGenerationRef.current += 1
      loadMoreOperationRef.current += 1
      unsubscribe?.()
    }
  }, [statusFilter, refreshKey, currentUser, userProfile])

  // ---------------------------------------------------------------------------
  // Page suivante — getDocs avec curseur (Charger plus)
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

    // Capturer la génération et l'id d'opération avant tout await.
    // Si le contexte change pendant l'attente, requestGenerationRef.current sera différent
    // et aucun état ne sera écrit pour ce contexte obsolète.
    const generationAtStart = requestGenerationRef.current
    const operationId = ++loadMoreOperationRef.current

    setLoadingMore(true)
    try {
      const result = await listDealerRequests({
        currentUser,
        userProfile,
        statusFilter: statusFilter || null,
        lastDoc: cursorDoc,
      })
      // Résultat obsolète : le contexte a changé pendant l'attente — abandonner.
      if (generationAtStart !== requestGenerationRef.current) return
      setExtraRequests(prev => [...prev, ...result.requests])
      hasLoadedExtraPagesRef.current = true
      paginationLastDocRef.current = result.lastDoc
      setHasMore(result.hasMore)
    } catch (err) {
      if (generationAtStart !== requestGenerationRef.current) return
      setError(err.message)
    } finally {
      // Ne remettre loadingMore à false que si cette opération est toujours
      // la dernière en date ET que le contexte n'a pas changé.
      if (
        generationAtStart === requestGenerationRef.current &&
        operationId === loadMoreOperationRef.current
      ) {
        setLoadingMore(false)
      }
    }
  }, [currentUser, userProfile, statusFilter, loadingMore])

  // ---------------------------------------------------------------------------
  // Filtre statut → redémarre l'abonnement via useEffect
  // ---------------------------------------------------------------------------

  function handleStatusChange(value) {
    setStatusFilter(value)
  }

  // ---------------------------------------------------------------------------
  // Fusion première page (temps réel) + pages supplémentaires, sans doublons
  // ---------------------------------------------------------------------------

  const requests = useMemo(
    () => mergeUniqueRequests(realtimeRequests, extraRequests),
    [realtimeRequests, extraRequests],
  )

  const filtered = storeSearch.trim()
    ? requests.filter(r =>
        r.targetStoreName?.toLowerCase().includes(storeSearch.toLowerCase())
      )
    : requests

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="max-w-5xl mx-auto" data-testid="dealer-requests">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <h1 className="text-xl font-bold text-gray-800">Mes demandes</h1>
        <button
          type="button"
          onClick={() => navigate('/dealer/requests/new')}
          className="rounded bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600 transition-colors"
          data-testid="btn-new-request"
        >
          Nouvelle demande
        </button>
      </div>

      {/* Filtres */}
      <div className="bg-white rounded-lg shadow p-4 mb-5 flex flex-wrap gap-4 items-end">
        {/* Statut */}
        <div className="flex-1 min-w-40">
          <label htmlFor="status-filter" className="block text-xs font-medium text-gray-600 mb-1">
            Statut
          </label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={e => handleStatusChange(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
            aria-label="Filtrer par statut"
            data-testid="filter-status"
          >
            {STATUS_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Recherche boutique */}
        <div className="flex-1 min-w-40">
          <label htmlFor="store-filter" className="block text-xs font-medium text-gray-600 mb-1">
            Boutique
          </label>
          <input
            id="store-filter"
            type="search"
            value={storeSearch}
            onChange={e => setStoreSearch(e.target.value)}
            placeholder="Nom de la boutique…"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
            aria-label="Filtrer par nom de boutique"
            data-testid="filter-store"
          />
        </div>

        {/* Actualiser */}
        <button
          type="button"
          onClick={() => { setExtraRequests([]); setRefreshKey(k => k + 1) }}
          disabled={loading}
          className="rounded bg-gray-100 border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 transition-colors"
          aria-label="Actualiser la liste"
        >
          {loading ? 'Chargement…' : 'Actualiser'}
        </button>
      </div>

      {/* État initial (n'apparaît jamais avec l'abonnement automatique) */}
      {!hasLoaded && !loading && (
        <div className="bg-white rounded-lg shadow p-10 text-center text-gray-500">
          Appuyez sur <strong>Actualiser</strong> pour charger vos demandes.
        </div>
      )}

      {loading && (
        <div className="space-y-3" aria-busy="true" aria-label="Chargement des demandes">
          {[1, 2, 3].map(n => (
            <div key={n} className="bg-white rounded-lg shadow p-4 animate-pulse">
              <div className="flex justify-between items-center">
                <div className="h-4 w-32 bg-gray-200 rounded" />
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

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 p-5 text-red-700">
          <p className="font-medium mb-1">Erreur</p>
          <p className="text-sm">{error}</p>
          <button
            type="button"
            onClick={() => setRefreshKey(k => k + 1)}
            className="mt-3 rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors"
          >
            Réessayer
          </button>
        </div>
      )}

      {hasLoaded && !loading && !error && requests.length === 0 && (
        <div className="bg-white rounded-lg shadow p-10 text-center text-gray-500" data-testid="empty-state">
          {statusFilter
            ? `Aucune demande avec le statut « ${DEALER_REQUEST_STATUS_LABELS[statusFilter] ?? statusFilter} ».`
            : 'Vous n\'avez pas encore de demande.'}
        </div>
      )}

      {/* Liste */}
      {!loading && !error && filtered.length > 0 && (
        <>
          {/* Tableau — scroll horizontal sur mobile */}
          <div className="bg-white rounded-lg shadow overflow-x-auto" data-testid="requests-table">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-green-50/70">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Boutique
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Montant
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Réseau
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Statut
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Remarque
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {filtered.map(req => (
                  <tr key={req.id} data-testid={`request-row-${req.id}`}>
                    <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-800">
                      {req.targetStoreName}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                      {DEALER_REQUEST_TYPE_LABELS[req.requestType] ?? req.requestType}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-800 font-medium">
                      {formatCurrency(req.amount)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                      {req.network ?? DEALER_NETWORK}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <DealerRequestStatusBadge status={req.status} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <RejectionRemarkButton
                        storeName={req.targetStoreName}
                        reason={req.status === DEALER_REQUEST_STATUSES.REJECTED ? req.rejectionReason : null}
                        testId={`remark-btn-${req.id}`}
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500 text-xs">
                      {formatDate(req.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination Firestore */}
          {hasMore && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded bg-gray-100 border border-gray-300 px-6 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 transition-colors"
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
