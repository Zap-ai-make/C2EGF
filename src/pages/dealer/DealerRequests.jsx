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
import PageHeader from '../../components/ui/PageHeader'
import EmptyState from '../../components/ui/EmptyState'
import ErrorState from '../../components/ui/ErrorState'
import RejectionRemarkButton from '../../components/ui/RejectionRemarkButton'
import DealerRequestStatusBadge from '../../components/ui/DealerRequestStatusBadge'
import Registre, { SqueletteRegistre } from '../../components/dealer/Registre'
import { formatDateTime as formatDate } from '../../utils/formatters'

/**
 * Mes ravitaillements — la file de ce que le dealer a envoyé.
 *
 * ⚠ SEUL LE RENDU A CHANGÉ DANS CE FICHIER. Tout ce qui est au-dessus du
 *   `return` — la double source (abonnement temps réel sur la première page,
 *   curseur `getDocs` sur les suivantes), les quatre `ref` de garde, la
 *   génération de contexte — est de la logique de CONCURRENCE, pas du dessin.
 *   Elle est figée par S1 et n'a pas été touchée.
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
              onClick={() => { setExtraRequests([]); setRefreshKey(k => k + 1) }}
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
        <ErrorState message={error} onRetry={() => setRefreshKey(k => k + 1)} />
      )}

      {/* Deux vides, et non un seul (DESIGN.md §10). « Vous n'avez encore rien
          envoyé » invite à créer ; « rien ne correspond » invite à élargir.
          Un texte unique en trahirait forcément un des deux. */}
      {hasLoaded && !loading && !error && filtered.length === 0 && (
        filtreActif ? (
          <div data-testid="empty-state">
            <EmptyState
              title="Aucun ravitaillement ne correspond"
              message={`Aucune demande avec ${critereActif}.`}
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
