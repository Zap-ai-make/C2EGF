import { formatCurrency } from '../../utils/formatCurrency'
import { ETATS, RAISONS } from '../../utils/positionDealer'

/**
 * La position — « combien de mon argent est dehors », et son rapprochement.
 *
 * UN SEUL CHIFFRE, PAS DEUX
 * ─────────────────────────
 * « Dehors » ne se découpe pas en stock et liquidité, et ce n'est pas un choix
 * de mise en page : au comptoir d'une boutique, un dépôt fait stock ↓ et
 * liquidité ↑. Le stock envoyé DEVIENT de la liquidité chez elle. Deux nombres
 * séparés dériveraient l'un vers l'autre sans qu'un franc ne sorte du réseau —
 * on afficherait deux mouvements là où il n'y en a aucun.
 *
 * POURQUOI CE BLOC NE RESSEMBLE PAS À UNE CARTE D'INDICATEUR
 * ──────────────────────────────────────────────────────────
 * Les quatre `StatCard` qui occupaient cet écran étaient le tic « gros chiffre,
 * petit libellé, pastille d'icône » que DESIGN.md §1 range parmi les réflexes
 * par défaut. Elles disaient de surcroît des choses fausses ou inutiles : un
 * compte de boutiques plafonné à « 20+ », et la longueur d'une tranche de huit
 * demandes présentée comme un indicateur.
 *
 * Ici, les deux nombres sont posés CÔTE À CÔTE parce que leur intérêt est
 * précisément de se regarder l'un l'autre, et la ligne du dessous dit ce que
 * leur différence vaut — ou refuse de le dire.
 */

/** Une ligne de la petite comptabilité, en chiffres tabulaires alignés. */
function Terme({ operation, libelle, montant, fort = false }) {
  return (
    <p className={`flex items-baseline gap-2 text-sm ${fort ? 'text-ink' : 'text-ink-muted'}`}>
      <span aria-hidden="true" className="w-3 shrink-0 text-right text-ink-muted">{operation}</span>
      <span className="min-w-0 flex-1">{libelle}</span>
      {/* Le deux-points n'existe que pour l'oreille : entre deux enfants de
          flex, `textContent` ne met aucun espace, et « Retours confirmés »
          suivi de son montant s'annoncerait d'un seul tenant. `sr-only` étant
          en position absolue, il ne pèse rien dans la mise en page. */}
      <span className="sr-only"> : </span>
      <span className={`shrink-0 tabular-nums ${fort ? 'font-semibold text-ink' : ''}`}>
        {formatCurrency(montant)}
      </span>
    </p>
  )
}

function Colonne({ titre, montant, children, testId }) {
  return (
    <div className="min-w-0 flex-1 basis-64">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{titre}</h3>
      <p className="mt-1 text-2xl font-bold tabular-nums text-ink sm:text-3xl" data-testid={testId}>
        {formatCurrency(montant)}
      </p>
      <div className="mt-2 space-y-1">{children}</div>
    </div>
  )
}

/**
 * Le rapprochement.
 *
 * ⚠ CE BANDEAU N'EST PAS UN VERDICT, et sa formulation est ce qui l'en empêche.
 *   Les compteurs de S2 sont partis de zéro le jour de leur mise en service,
 *   alors que les boutiques détenaient déjà du float : un écart permanent est
 *   donc NORMAL, et l'annoncer comme une alerte enverrait le dealer chercher
 *   tous les matins une anomalie qui n'existe pas. Ce qui se lit ici, c'est le
 *   MOUVEMENT de l'écart, pas sa valeur — et le texte le dit.
 */
function Rapprochement({ position }) {
  if (position.etat === ETATS.INDISPONIBLE) {
    const neufs = position.raison === RAISONS.COMPTEURS_NEUFS
    const injoignable = position.raison === RAISONS.CAISSES_INDISPONIBLES
    return (
      <p
        className="mt-4 rounded-lg bg-pending-soft px-3 py-2 text-xs text-pending"
        data-testid="rapprochement"
      >
        {injoignable ? (
          <>
            <span className="font-semibold">Rapprochement impossible.</span> L’état
            des caisses n’a pas pu être lu. « Mon argent dehors » reste juste — il
            vient de vos compteurs, pas du réseau — mais il n’y a rien à comparer
            tant que la liste n’est pas revenue.
          </>
        ) : neufs ? (
          <>
            <span className="font-semibold">Rapprochement indisponible.</span> Aucun
            ravitaillement ni retour n’a encore été compté depuis la mise en service
            des compteurs. Tant qu’ils n’ont rien enregistré, la comparaison avec la
            somme des caisses n’aurait aucun sens — un écart s’afficherait, et il ne
            vaudrait que l’historique manquant.
          </>
        ) : (
          <>
            <span className="font-semibold">Rapprochement suspendu.</span>{' '}
            {/* ⚠ La phrase entière bascule, elle ne s'assemble pas morceau par
                morceau. Une pluralisation par bouts avait produit « 3 caisses
                n'aont pas pu être lues » — du français cassé sur un avertissement
                qui parle d'argent manquant. Vu à la capture, pas déduit. */}
            {position.illisibles > 1
              ? `${position.illisibles} caisses n’ont pas pu être lues`
              : '1 caisse n’a pas pu être lue'}{' '}
            : la somme est incomplète, et un total faux qui s’annonce juste est
            pire que pas de total.
          </>
        )}
      </p>
    )
  }

  if (position.etat === ETATS.CONCORDANT) {
    return (
      <p
        className="mt-4 rounded-lg bg-success-soft px-3 py-2 text-xs text-success"
        data-testid="rapprochement"
      >
        <span className="font-semibold">Les deux colonnes concordent</span> au franc
        près, transit compris.
      </p>
    )
  }

  const anomalie = position.etat === ETATS.ANOMALIE
  const ecart = Math.abs(position.ecart)

  return (
    <div
      className={`mt-4 rounded-lg px-3 py-2 text-xs ${anomalie ? 'bg-warn-soft text-warn' : 'bg-brand-50 text-ink-muted'}`}
      data-testid="rapprochement"
    >
      <p>
        <span className="font-semibold tabular-nums">{formatCurrency(ecart)}</span>{' '}
        {anomalie ? 'de MOINS' : 'de plus'} dans les caisses que ce que les compteurs
        ont suivi.
      </p>
      <p className="mt-1">
        {anomalie ? (
          <>
            Aucun fonds d’ouverture n’explique un écart de ce sens : les compteurs
            ont enregistré plus de sorties que les caisses et le transit n’en
            contiennent. À signaler au gérant avant d’y voir une erreur de saisie.
          </>
        ) : (
          <>
            C’est le float que les boutiques détenaient déjà quand les compteurs ont
            été mis en service, plus les opérations en cours chez elles. Cet écart
            doit rester <span className="font-semibold">stable</span> — c’est son
            mouvement d’un jour à l’autre qui est un signal, jamais sa valeur.
          </>
        )}
      </p>
    </div>
  )
}

function PositionDealer({ position, retoursEnAttente = 0, loading = false }) {
  if (loading || !position) {
    return (
      <section
        className="rounded-xl border border-line bg-surface p-4"
        aria-label="Ma position, en cours de chargement"
      >
        <div className="flex flex-wrap gap-x-10 gap-y-6">
          {[0, 1].map(i => (
            <div key={i} className="min-w-0 flex-1 basis-64" aria-hidden="true">
              <span className="block h-3 w-32 rounded bg-gray-200 motion-safe:animate-pulse" />
              <span className="mt-2 block h-8 w-52 rounded bg-gray-200 motion-safe:animate-pulse" />
              <span className="mt-3 block h-3 w-full rounded bg-gray-100 motion-safe:animate-pulse" />
              <span className="mt-1.5 block h-3 w-full rounded bg-gray-100 motion-safe:animate-pulse" />
            </div>
          ))}
        </div>
        <span className="mt-4 block h-8 w-full rounded-lg bg-gray-100 motion-safe:animate-pulse" aria-hidden="true" />
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-4" aria-labelledby="position-titre">
      <h2 id="position-titre" className="sr-only">Ma position</h2>

      <div className="flex flex-wrap gap-x-10 gap-y-6">
        {/* Les deux lignes de chaque colonne font EXACTEMENT le grand nombre
            au-dessus d'elles. Aucun terme décoratif ne se glisse dans une
            addition qui ne tombe pas juste : c'est la première chose qu'un
            lecteur vérifie, et la première qui ruine sa confiance. */}
        <Colonne titre="Mon argent dehors" montant={position.dehors} testId="montant-dehors">
          <Terme operation="" libelle="Ravitaillements confirmés" montant={position.envoye} />
          <Terme operation="−" libelle="Retours confirmés" montant={position.revenu} />
        </Colonne>

        <Colonne titre="Dans les caisses" montant={position.sommeCaisses} testId="montant-caisses">
          <Terme operation="" libelle="Stock" montant={position.sommeStock} />
          <Terme operation="+" libelle="Liquidité" montant={position.sommeLiquidite} />
        </Colonne>
      </div>

      {/* L'EN TRANSIT N'APPARTIENT À AUCUNE DES DEUX COLONNES, et c'est
          précisément pour cela qu'il est posé entre elles et le rapprochement.
          La boutique est débitée à la CRÉATION du retour, le compteur du dealer
          n'avance qu'à sa CONFIRMATION : entre les deux, cet argent a quitté
          les caisses sans être encore compté comme revenu. Il n'est ni dedans
          ni dehors — il est le terme qui ferme l'identité. */}
      <p
        className="mt-4 flex flex-wrap items-baseline gap-x-2 border-t border-line pt-3 text-sm text-ink-muted"
        data-testid="en-transit"
      >
        {/* L'espace est écrit, pas seulement dessiné par le `gap` : sans lui,
            `textContent` colle les deux fragments et un lecteur d'écran
            annonce « … FCFAen transit ». La mise en page n'ajoute pas de mots. */}
        <span className="font-semibold tabular-nums text-ink">
          {formatCurrency(position.enTransit)}
        </span>{' '}
        <span>
          en transit —{' '}
          {retoursEnAttente > 0
            ? `${retoursEnAttente} retour${retoursEnAttente > 1 ? 's' : ''} sorti${retoursEnAttente > 1 ? 's' : ''} des caisses, pas encore confirmé${retoursEnAttente > 1 ? 's' : ''}.`
            : 'aucun retour en attente de confirmation.'}
        </span>
      </p>

      <Rapprochement position={position} />
    </section>
  )
}

export default PositionDealer
