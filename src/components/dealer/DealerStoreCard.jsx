import { useNavigate } from 'react-router-dom'
import { formatCurrency } from '../../utils/formatCurrency'
import { DEALER_REQUEST_TYPES } from '../../constants/dealerConstants'
import { CARD, BTN_SECOND } from '../../constants/workspaceTheme'

/**
 * La carte d'une boutique — repeinte, pas redessinée.
 *
 * L'ORANGE OPÉRATEUR SORT DU DESSIN
 * ─────────────────────────────────
 * Le pavé « Stock » portait l'orange opérateur en fond, en intitulé et en
 * bouton. Deux raisons, et la première suffit : `#FF6B35` plafonne à 2,84:1
 * même sur blanc — l'intitulé du pavé était donc illisible au sens de WCAG, sur
 * une carte dont c'est l'information principale. La seconde est de
 * vocabulaire : `index.css` réserve `net-*` à l'identité OPÉRATEUR,
 * c'est-à-dire à la DONNÉE. Un fond, un intitulé et un bouton ne sont pas de la
 * donnée ; ils empruntaient une teinte qui ne leur appartient pas.
 *
 * ⚠ Les quatre classes retirées ne sont volontairement PAS écrites ci-dessus.
 *   Tailwind v4 extrait ses utilitaires du texte brut du projet, COMMENTAIRES
 *   ET FICHIERS `.md` COMPRIS. Vérification faite dans le CSS livré : trois
 *   d'entre elles restent employées ailleurs (`networkConfig.js`,
 *   `AdminStores.jsx`) et seraient émises de toute façon. La quatrième —
 *   l'orange plein du bouton — n'était plus employée nulle part, et pourtant
 *   elle était livrée : elle survivait par une PHRASE de `REFONTE.md`, qui
 *   racontait l'avoir retirée d'`OfflineBanner`. Le document de conception
 *   était la dernière raison de vivre de la couleur qu'il condamnait.
 *   `SkeletonList.jsx` documente le même piège pour l'animation de pulsation.
 *
 * Ce qui distinguait stock et liquidité était donc la couleur seule. Ce n'était
 * de toute façon pas admissible (DESIGN.md §5) : les deux intitulés sont écrits
 * en toutes lettres et portent seuls la distinction désormais.
 *
 * ⚠ « LIQUIDITÉ ORANGE » N'EXISTE PAS, et l'intitulé le disait quand même
 *   jusqu'au 01/09/2026. Le stock EST de l'Orange — des unités de monnaie
 *   électronique chez un opérateur nommé. La liquidité est de l'espèce : des
 *   billets dans un tiroir, qui n'appartiennent à aucun réseau. Accoler
 *   l'opérateur aux deux faisait symétrique et disait faux, et sur un profil
 *   mono-réseau le qualificatif ne distinguait de toute façon rien. « Stock
 *   Orange » le garde parce qu'il est vrai ; « Liquidité » le perd.
 *
 * DEUX BOUTONS DE MÊME POIDS, ET C'EST VOULU
 * ──────────────────────────────────────────
 * Un orange plein et un bleu plein, côte à côte, se disputaient le regard sans
 * qu'aucun ne soit l'action recommandée — la carte offre un CHOIX, pas une
 * suggestion. Les deux passent en secondaire : le poids visuel devient égal
 * parce que les deux gestes le sont.
 *
 * ⚠ Cet écran fait double emploi avec l'accueil depuis S4 (20 par page, une
 *   requête de solde par boutique, recherche limitée à la page). Son sort est
 *   une décision client, consignée au journal de la ROADMAP ; ce lot le repeint
 *   sans le trancher.
 */
function DealerStoreCard({ store, balances, balanceError, isLoading }) {
  const navigate = useNavigate()

  const orange = balances?.Orange
  const stock = orange?.stock ?? null
  const liquidite = orange?.liquidite ?? null

  function openRequest(requestType) {
    navigate(
      `/dealer/requests/new?storeId=${encodeURIComponent(store.id)}&type=${encodeURIComponent(requestType)}`
    )
  }

  return (
    <article
      className={`flex flex-col gap-4 p-5 ${CARD}`}
      aria-label={`Boutique ${store.name}`}
      data-testid={`store-card-${store.id}`}
    >
      {/* En-tête */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-ink">{store.name}</h3>
        </div>
        <span className="inline-block flex-shrink-0 rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-medium text-success">
          Active
        </span>
      </div>

      {/* Soldes Orange */}
      <div className="flex gap-3">
        <div className="flex-1 rounded-lg bg-canvas p-3">
          <p className="mb-1 text-xs font-medium text-ink-muted">Stock Orange</p>
          {isLoading ? (
            <div className="h-5 w-24 rounded bg-gray-200 motion-safe:animate-pulse" aria-busy="true" />
          ) : (
            <p className="text-sm font-semibold tabular-nums text-ink" data-testid={`stock-${store.id}`}>
              {balanceError ? 'Solde indisponible' : formatCurrency(stock)}
            </p>
          )}
        </div>
        <div className="flex-1 rounded-lg bg-canvas p-3">
          <p className="mb-1 text-xs font-medium text-ink-muted">Liquidité</p>
          {isLoading ? (
            <div className="h-5 w-24 rounded bg-gray-200 motion-safe:animate-pulse" aria-busy="true" />
          ) : (
            <p className="text-sm font-semibold tabular-nums text-ink" data-testid={`liquidite-${store.id}`}>
              {balanceError ? 'Solde indisponible' : formatCurrency(liquidite)}
            </p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => openRequest(DEALER_REQUEST_TYPES.STOCK_ADD)}
          className={`flex-1 ${BTN_SECOND}`}
          aria-label={`Ajouter stock pour ${store.name}`}
          data-testid={`btn-stock-${store.id}`}
        >
          Ajouter stock
        </button>
        <button
          type="button"
          onClick={() => openRequest(DEALER_REQUEST_TYPES.LIQUIDITY_ADD)}
          className={`flex-1 ${BTN_SECOND}`}
          aria-label={`Ajouter liquidité pour ${store.name}`}
          data-testid={`btn-liquidite-${store.id}`}
        >
          Ajouter liquidité
        </button>
      </div>
    </article>
  )
}

export default DealerStoreCard
