import { Link } from 'react-router-dom'
import { useState } from 'react'
import { formatCurrency } from '../../utils/formatCurrency'
import { ETATS, RAISONS } from '../../utils/positionDealer'
import DehorsParBoutique from './DehorsParBoutique'

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

/**
 * Les deux gabarits, écrits une seule fois — le rendu ET le squelette les
 * partagent. Recopiés, ils divergeraient au premier oubli, et la divergence se
 * verrait pendant le chargement, c'est-à-dire jamais en relecture.
 */
const GRILLE = 'grid gap-4 sm:grid-cols-[1fr_1px_1fr]'
const PANNEAU = 'rounded-lg bg-canvas p-4'

/**
 * Une ligne de la petite comptabilité — et, depuis le 31/08/2026, une cible.
 *
 * CHAQUE CHIFFRE MÈNE QUELQUE PART
 * ────────────────────────────────
 * L'écran énonçait cinq nombres et n'ouvrait sur rien. « 341 200 000 FCFA de
 * ravitaillements confirmés » posait aussitôt la question « lesquels ? », et il
 * fallait retrouver la file par le menu.
 *
 * ⚠ LA LIGNE ENTIÈRE EST LA CIBLE, PAS LE CHIFFRE. Un nombre est une cible
 *   étroite, difficile à viser à la souris comme au doigt, et son nom
 *   accessible seul (« 341 200 000 FCFA ») ne dit pas où il mène. La ligne
 *   porte le libellé ET le montant : son nom accessible peut les dire tous les
 *   deux, plus la destination.
 *
 * ⚠ UN LIEN POUR NAVIGUER, UN BOUTON POUR OUVRIR UN CALQUE. Même règle que les
 *   lignes de `CaissesReseau` : un lien s'ouvre dans un onglet, se copie,
 *   s'annonce comme « lien ». « Dehors » n'est pas une navigation — il déplie
 *   un détail sur place, c'est donc un bouton.
 *
 * Le soulignement discret est l'affordance, comme sur les liens de ligne des
 * caisses : les cinq libellés ne passent PAS en bleu, ce qui ferait cinq
 * accents dans un bloc qui doit se lire d'un coup d'œil.
 */
const TERME_ACTIF =
  '-mx-2 rounded px-2 underline decoration-line decoration-1 underline-offset-2 transition-colors hover:bg-brand-50 hover:decoration-brand-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400'

/**
 * Le décompte des ravitaillements en attente — pour l'oreille seule.
 *
 * Il s'affichait avant en toutes lettres, en pied de colonne : « 300 000 FCFA en
 * attente de confirmation — 1 ravitaillement envoyé ». Le montant est devenu une
 * ligne de l'addition ; le décompte, lui, n'a plus de place à l'œil et n'en
 * mérite pas : le lien mène à la file, qui le dit mieux. Il reste dans le nom
 * accessible, où il ne coûte aucune ligne.
 *
 * ⚠ LA PHRASE BASCULE EN ENTIER. Quatrième occurrence dans ce dépôt du « s »
 *   collé au bout d'une locution — celui qui produit « 1 ravitaillements
 *   envoyés ». Trois formes complètes, l'accord du participe compris.
 */
const indiceEnvois = (nombre) => {
  if (!nombre) return 'voir la file des ravitaillements'
  return nombre > 1
    ? `voir les ${nombre} ravitaillements envoyés`
    : 'voir le ravitaillement envoyé'
}

function Terme({ operation, libelle, montant, fort = false, vers, surClic, indice, testId }) {
  const dessin = `flex items-baseline gap-2 text-sm ${fort ? 'text-ink' : 'text-ink-muted'}`
  const contenu = (
    <>
      <span aria-hidden="true" className="w-3 shrink-0 text-right text-ink-muted">{operation}</span>
      <span className="min-w-0 flex-1 text-left">{libelle}</span>
      {/* Le deux-points n'existe que pour l'oreille : entre deux enfants de
          flex, `textContent` ne met aucun espace, et « Retours confirmés »
          suivi de son montant s'annoncerait d'un seul tenant. `sr-only` étant
          en position absolue, il ne pèse rien dans la mise en page. */}
      <span className="sr-only"> : </span>
      <span className={`shrink-0 tabular-nums ${fort ? 'font-semibold text-ink' : ''}`}>
        {formatCurrency(montant)}
      </span>
    </>
  )

  // Le nom accessible porte le libellé, le montant ET la destination. Sans lui,
  // cinq cibles s'annonceraient par leur seul texte visible, et « Stock » ne
  // dirait pas qu'il mène à la liste des boutiques.
  const nom = `${libelle} : ${formatCurrency(montant)}${indice ? ` — ${indice}` : ''}`

  if (vers) {
    return (
      <Link to={vers} aria-label={nom} data-testid={testId} className={`${dessin} ${TERME_ACTIF}`}>
        {contenu}
      </Link>
    )
  }
  if (surClic) {
    return (
      <button
        type="button"
        onClick={surClic}
        aria-label={nom}
        data-testid={testId}
        className={`w-full ${dessin} ${TERME_ACTIF}`}
      >
        {contenu}
      </button>
    )
  }
  return <p className={dessin}>{contenu}</p>
}

/**
 * Une colonne devient un PANNEAU, et c'est tout le point de ce lot.
 *
 * Les deux comptes flottaient côte à côte sur le même fond, séparés par un
 * simple espace. Quatre lignes de chiffres alignées se lisent alors comme un
 * seul tableau à deux colonnes — alors que ce sont deux comptes DISTINCTS,
 * dont l'intérêt est précisément de se regarder l'un l'autre. L'écran ne se
 * comprenait pas seul : il a fallu l'expliquer pour qu'il se lise.
 *
 * Le fond `canvas` est volontairement à peine distinct de `surface` : il ne
 * décore rien, il délimite. La ligne entre les deux fait le reste.
 */
function Colonne({ titre, montant, children, pied, testId }) {
  return (
    <div className={`min-w-0 ${PANNEAU}`}>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{titre}</h3>
      <p className="mt-1 text-2xl font-bold tabular-nums text-ink sm:text-3xl" data-testid={testId}>
        {formatCurrency(montant)}
      </p>
      <div className="mt-2 space-y-1">{children}</div>
      {pied}
    </div>
  )
}

/**
 * Ce qui attend une confirmation, au pied d'une colonne.
 *
 * ⚠ LE MOT « TRANSIT » EST PARTI, et il ne manque à personne. Il ne disait ni
 *   qui attend, ni quoi — c'était du vocabulaire de plomberie sur un écran qui
 *   parle d'argent.
 *
 * ⚠ IL N'EN RESTE QU'UNE, À DROITE, ET C'EST STRUCTUREL. Celle de gauche est
 *   devenue une LIGNE le 01/09/2026, parce que son montant entre désormais dans
 *   le total. Celle-ci ne peut pas suivre : `enTransit` est un terme de
 *   l'identité mais PAS de `sommeCaisses` — l'argent a quitté la caisse de la
 *   boutique. En faire une ligne casserait la règle que ce bloc tient partout
 *   ailleurs : les lignes affichées font exactement le total au-dessus d'elles.
 *   Une note en pied dit « ceci compte, mais pas dans ce total ».
 *
 * ⚠ Le fragment `sr-only` qui précise le sens de l'attente survit à la
 *   disparition de sa jumelle : « en attente de confirmation » seul ne dit
 *   toujours pas de QUI on attend la confirmation.
 *
 * ⚠ LA PHRASE BASCULE EN ENTIER, ELLE NE S'ASSEMBLE PAS. Une pluralisation par
 *   morceaux — un « s » collé au bout d'une locution — avait déjà produit
 *   « 3 caisses n'aont pas pu être lues » dans ce même écran, puis ici même
 *   « 3 retour reçus » à la première écriture de ce composant. Deux formes
 *   complètes, l'accord du participe compris.
 */
function EnAttente({ montant, nombre, sens, singulier, pluriel, testId }) {
  return (
    <p
      className="mt-3 flex flex-wrap items-baseline gap-x-2 border-t border-line pt-2 text-sm text-ink-muted"
      data-testid={testId}
    >
      {/* L'espace est ÉCRIT, pas seulement dessiné par le `gap` : sans lui,
          `textContent` colle les deux fragments et un lecteur d'écran annonce
          « … FCFAen attente ». La mise en page n'ajoute pas de mots. */}
      <span className="font-semibold tabular-nums text-ink">{formatCurrency(montant)}</span>{' '}
      <span>
        en attente de confirmation
        <span className="sr-only"> {sens}</span>
        {nombre > 0 && ` — ${nombre} ${nombre > 1 ? pluriel : singulier}.`}
      </span>
    </p>
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
    const dehorsManquant = position.raison === RAISONS.DEHORS_INDISPONIBLE
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
        ) : dehorsManquant ? (
          <>
            <span className="font-semibold">Rapprochement indisponible.</span> Les
            transactions non terminées des boutiques n’ont pas pu être lues. Le
            stock et la liquidité ci-dessus restent justes ; c’est leur TOTAL qui
            ne peut pas se former, parce qu’il lui manque un terme entier — et un
            total faux qui s’annonce juste est pire que pas de total.
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
        près, les attentes comprises.
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
            ont enregistré plus de sorties que les caisses et les retours en
            attente n’en contiennent. À signaler au gérant avant d’y voir une
            erreur de saisie.
          </>
        ) : (
          <>
            C’est le float que les boutiques détenaient déjà quand les compteurs
            ont été mis en service. Les opérations en cours chez elles n’y sont
            plus : elles sont comptées à part, dans « Dehors ». Cet écart doit
            rester <span className="font-semibold">stable</span> — c’est son
            mouvement d’un jour à l’autre qui est un signal, jamais sa valeur.
          </>
        )}
      </p>
    </div>
  )
}

function PositionDealer({
  position,
  retoursEnAttente = 0,
  envoisEnAttente = { nombre: 0, montant: 0 },
  dehors = null,
  loading = false,
}) {
  const [detailOuvert, setDetailOuvert] = useState(false)
  if (loading || !position) {
    return (
      <section
        className="rounded-xl border border-line bg-surface p-4"
        aria-label="Ma position, en cours de chargement"
      >
        {/* Le squelette porte le MÊME gabarit et les MÊMES panneaux que le
            rendu : sans cela la page saute d'une mise en page à l'autre à
            l'arrivée des données, exactement là où on la regarde le moins. */}
        <div className={GRILLE}>
          {/* Trois barres à gauche, quatre à droite : le compte EXACT des
              lignes que chaque panneau va rendre. Un squelette qui en promet
              deux quand il en vient quatre fait sauter la page au moment
              précis où on la regarde le moins. */}
          <div className={`${PANNEAU} min-w-0`} aria-hidden="true">
            <span className="block h-3 w-32 rounded bg-gray-200 motion-safe:animate-pulse" />
            <span className="mt-2 block h-8 w-52 rounded bg-gray-200 motion-safe:animate-pulse" />
            {[0, 1, 2].map((i) => (
              <span key={i} className="mt-1.5 block h-3 w-full rounded bg-gray-100 motion-safe:animate-pulse" />
            ))}
          </div>
          <div className="hidden bg-line sm:block" aria-hidden="true" />
          <div className={`${PANNEAU} min-w-0`} aria-hidden="true">
            <span className="block h-3 w-32 rounded bg-gray-200 motion-safe:animate-pulse" />
            <span className="mt-2 block h-8 w-52 rounded bg-gray-200 motion-safe:animate-pulse" />
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="mt-1.5 block h-3 w-full rounded bg-gray-100 motion-safe:animate-pulse" />
            ))}
            <span className="mt-3 block h-3 w-3/4 rounded bg-gray-100 motion-safe:animate-pulse" />
          </div>
        </div>
        <span className="mt-4 block h-8 w-full rounded-lg bg-gray-100 motion-safe:animate-pulse" aria-hidden="true" />
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-4" aria-labelledby="position-titre">
      <h2 id="position-titre" className="sr-only">Ma position</h2>

      {/* ⚠ UNE GRILLE, PAS UN `flex-wrap`. Mesuré à la capture : en flex, les
          deux panneaux prenaient 478 px et 415 px — deux comptes qu'on demande
          de comparer, servis à deux largeurs différentes. Et le filet du milieu
          y recevait une largeur de ZÉRO : il était dans le DOM et invisible à
          l'écran. `1fr 1px 1fr` donne deux panneaux égaux et un trait qui
          existe. */}
      <div className={GRILLE}>
        {/* Les deux lignes de chaque colonne font EXACTEMENT le grand nombre
            au-dessus d'elles. Aucun terme décoratif ne se glisse dans une
            addition qui ne tombe pas juste : c'est la première chose qu'un
            lecteur vérifie, et la première qui ruine sa confiance. */}
        {/* ⚠ CE COMMENTAIRE DISAIT L'INVERSE JUSQU'AU 01/09/2026, et il vaut
            d'être raconté. Il déclarait « asymétrie voulue » : le ravitaillement
            en attente restait hors du rapprochement au motif qu'il n'avait rien
            débité — ce qui est vrai DU CRM, et faux du monde. Le transfert est
            fait au guichet : l'argent a quitté le float du dealer et n'est pas
            dans la caisse de la boutique. Le laisser dehors du calcul, c'était
            afficher « Mon argent dehors : 0 FCFA » au-dessus d'une note disant
            « 300 000 FCFA en attente ». Un total qui contredit sa propre note.

            Il est donc devenu une LIGNE, des deux côtés — `position.enRoute`,
            le seul terme des deux membres de l'identité. Il s'annule dans
            l'écart (tc-203 [ER-02]) : ce qui bouge, ce sont les deux totaux.

            ⚠ CE QUI RESTE ASYMÉTRIQUE, ET POURQUOI. `enTransit` — les retours
              créés, pas encore confirmés — demeure une note en pied à DROITE et
              n'a pas de contrepartie à gauche. Ce n'est pas un oubli : un
              retour en attente n'a pas fait avancer `revenuCumul`, il est donc
              DÉJÀ compté dans « Mon argent dehors », par omission. Lui donner
              une ligne à gauche le compterait deux fois. */}
        <Colonne
          titre="Mon argent dehors"
          montant={position.dehors}
          testId="montant-dehors"
        >
          <Terme
            operation=""
            libelle="Ravitaillements confirmés"
            montant={position.envoye}
            vers="/dealer/requests"
            indice="voir la file des ravitaillements"
            testId="ligne-ravitaillements"
          />
          <Terme
            operation="−"
            libelle="Retours confirmés"
            montant={position.revenu}
            vers="/dealer/transfers"
            indice="voir la file des retours"
            testId="ligne-retours"
          />
          {/* Le libellé est celui que le dealer a demandé, au mot près : le
              montant, puis « en attente de confirmation ». Le décompte qui
              suivait — « — 1 ravitaillement envoyé » — n'est pas perdu, il est
              passé dans le nom accessible, où il ne coûte pas une ligne. */}
          <Terme
            operation="+"
            libelle="En attente de confirmation"
            montant={position.enRoute}
            vers="/dealer/requests"
            indice={indiceEnvois(envoisEnAttente.nombre)}
            testId="ligne-en-route"
          />
        </Colonne>

        <div className="hidden bg-line sm:block" aria-hidden="true" />

        <Colonne
          titre="Dans les caisses"
          montant={position.sommeCaisses}
          testId="montant-caisses"
          pied={
            <EnAttente
              montant={position.enTransit}
              nombre={retoursEnAttente}
              sens="de ma part"
              singulier="retour reçu"
              pluriel="retours reçus"
              testId="retours-en-attente"
            />
          }
        >
          <Terme
            operation=""
            libelle="Stock"
            montant={position.sommeStock}
            vers="/dealer/stores"
            indice="voir le stock de chaque boutique"
            testId="ligne-stock"
          />
          <Terme
            operation="+"
            libelle="Liquidité"
            montant={position.sommeLiquidite}
            vers="/dealer/stores"
            indice="voir la liquidité de chaque boutique"
            testId="ligne-liquidite"
          />
          {/* ⚠ CE TERME N'EST PAS UN AJOUT DÉCORATIF. Une transaction client non
              terminée n'a fait passer qu'une de ses deux jambes : un dépôt en
              attente a baissé le stock sans monter la liquidité, un retrait en
              attente a fait l'inverse. Sans lui, les deux lignes du dessus ne
              font pas le total du dessus d'elles — et le rapprochement porte un
              trou qu'il ne sait pas nommer. */}
          {/* Un BOUTON, pas un lien : il ne navigue pas, il déplie un détail
              sur place. Et il ne s'active que s'il y a un détail à montrer —
              une cible qui ouvrirait un calque vide serait une promesse non
              tenue. */}
          {dehors ? (
            <Terme
              operation="+"
              libelle="Dehors"
              montant={position.sommeDehors}
              surClic={() => setDetailOuvert(true)}
              indice="voir le détail par boutique"
              testId="ligne-dehors"
            />
          ) : (
            <Terme operation="+" libelle="Dehors" montant={position.sommeDehors} />
          )}
          {/* ⚠ LE MÊME MONTANT QU'EN FACE, ET C'EST LE POINT. Voir deux fois
              trois cent mille, une fois dans chaque panneau, est ce qui rend
              LISIBLE le fait qu'ils s'annulent : l'écart n'a pas bougé, et on
              voit pourquoi. Masquer l'un des deux rendrait le total de l'autre
              inexplicable. */}
          <Terme
            operation="+"
            libelle="En route vers les boutiques"
            montant={position.enRoute}
            vers="/dealer/requests"
            indice="le même montant qu’en face, compté du côté du réseau"
            testId="ligne-en-route-caisses"
          />
        </Colonne>
      </div>

      <Rapprochement position={position} />

      <DehorsParBoutique
        open={detailOuvert}
        onClose={() => setDetailOuvert(false)}
        dehors={dehors}
      />
    </section>
  )
}

export default PositionDealer
