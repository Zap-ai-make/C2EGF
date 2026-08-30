import { useMemo, useState, useId } from 'react'
import { formatCurrency } from '../../utils/formatCurrency'
import {
  TRIS,
  TRI_DEFAUT,
  construireEchelle,
  depassePlafond,
  filtrerCaisses,
  largeurBarre,
  positionSeuil,
  trierCaisses,
  triParId,
} from '../../utils/caissesReseau'
import { estSousSeuil } from '../../constants/dealerConstants'

/**
 * Les caisses du réseau — la signature de l'écran d'accueil du dealer.
 *
 * L'IDÉE
 * ──────
 * Une échelle commune à toute la liste, et le seuil bas posé dessus comme un
 * FILET VERTICAL continu. Chaque boutique montre ses deux caisses réelles —
 * stock et liquidité, en montants exacts — sur cette même règle. Ce qui dépasse
 * le filet est servi ; ce qui reste en deçà est court. La question du matin,
 * « qui est court ? », se lit sans lire un seul chiffre ; les chiffres sont là
 * pour la question d'après, « combien lui envoyer ? ».
 *
 * POURQUOI PAS QUATRE-VINGT-QUATRE CARTES
 * ───────────────────────────────────────
 * C'est ce que fait l'écran « Boutiques » aujourd'hui : une carte par boutique,
 * deux pavés colorés par carte, vingt par page. Trois défauts que le dessin ne
 * corrige pas — on ne compare pas deux cartes éloignées de trois rangées, on ne
 * voit jamais plus de vingt boutiques sur quatre-vingt-quatre, et chaque carte
 * normalise ses montants sur elle-même, si bien que la plus petite caisse du
 * réseau y paraît aussi pleine que la plus grosse.
 *
 * CE QUI EST DÉCORATIF, CE QUI NE L'EST PAS
 * ─────────────────────────────────────────
 * Tout le visuel est masqué de l'arbre d'accessibilité, et chaque ligne porte
 * UNE phrase qui dit son sens entier (« POUYTENGA : stock 180 000 FCFA, sous
 * le seuil bas ; liquidité 2 940 000 FCFA »). Une barre lue à voix haute ne
 * dit rien ; sa longueur, elle, ne fait que répéter le montant déjà écrit.
 *
 * L'alerte de seuil passe TOUJOURS par un mot — « bas » — et jamais par la
 * seule couleur (DESIGN.md §5).
 */

/** La phrase que lit un lecteur d'écran. Pure, et testée comme telle. */
export function phraseAccessible(caisse) {
  const part = (label, montant) => {
    if (montant === null || montant === undefined) return `${label} inconnu`
    const bas = estSousSeuil(montant) ? ', sous le seuil bas' : ''
    return `${label} ${formatCurrency(montant)}${bas}`
  }
  return `${caisse?.name ?? 'Boutique sans nom'} : ${part('stock', caisse?.stock)} ; ${part('liquidité', caisse?.liquidite)}.`
}

/**
 * Une piste : la règle commune, la barre, et le filet du seuil par-dessus.
 *
 * Le filet déborde en haut et en bas de la piste, exactement comme la ligne de
 * zéro du fléau : les segments de chaque ligne se rejoignent et ne forment plus
 * qu'un seul trait continu sur toute la liste. C'est ce qui en fait un repère
 * plutôt qu'une décoration répétée quatre-vingt-quatre fois.
 */
function Piste({ montant, echelle, teinte }) {
  const largeur = largeurBarre(montant, echelle.plafond)
  const deborde = depassePlafond(montant, echelle.plafond)
  return (
    <span className="relative block h-3 w-full min-w-[3rem] rounded-sm bg-brand-100">
      {largeur > 0 && (
        <span
          className={`absolute inset-y-0 left-0 rounded-sm ${teinte} ${deborde ? 'piste-cran' : ''}`}
          style={{ width: `${largeur}%` }}
        />
      )}
      <span
        className="piste-seuil absolute -top-1 -bottom-1"
        style={{ left: `${positionSeuil(echelle.seuil, echelle.plafond)}%` }}
      />
    </span>
  )
}

/**
 * La colonne des montants a une largeur FIXE, et c'est structurel.
 *
 * Mesuré à la capture : avec une largeur au contenu, « 50 000 FCFA bas » et
 * « 3 079 774 FCFA » ne font pas la même largeur, la piste qui les précède se
 * réajuste ligne par ligne, et le filet du seuil dérive de 4,7 px sur les 84
 * lignes. Un trait de 1 px qui bouge de 5 px n'est plus un filet continu :
 * c'est quatre-vingt-quatre tirets, et toute la lecture d'un coup d'œil que
 * cette liste promet s'effondre avec lui.
 */
const CELLULE_MONTANT = 'w-32 shrink-0 text-right sm:w-40'

/**
 * Une caisse : sa piste, son montant exact, et le mot « bas » s'il le faut.
 *
 * ⚠ LE LIBELLÉ N'EST PAS UN DOUBLON DE L'INTITULÉ DE COLONNE. Sur le bureau,
 *   les colonnes sont côte à côte et coiffées de leur titre. Sur mobile, les
 *   deux pistes sont EMPILÉES sous le nom de la boutique, et plus rien ne dit
 *   laquelle est le stock — sauf la teinte. Or une information ne passe jamais
 *   par la seule couleur (DESIGN.md §5) : d'où ce libellé, visible uniquement
 *   là où l'intitulé de colonne a disparu.
 */
function Cellule({ montant, echelle, teinte, label }) {
  const inconnu = montant === null || montant === undefined
  const bas = estSousSeuil(montant)
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="w-14 shrink-0 truncate text-[10px] font-semibold uppercase tracking-wide text-ink-muted sm:hidden">
        {label}
      </span>
      <Piste montant={montant} echelle={echelle} teinte={teinte} />
      <span
        className={`${CELLULE_MONTANT} text-xs tabular-nums sm:text-sm ${
          inconnu ? 'text-ink-muted italic' : bas ? 'font-semibold text-warn' : 'text-ink'
        }`}
      >
        {inconnu ? 'inconnu' : formatCurrency(montant)}
        {bas && <span className="ml-1 font-bold">bas</span>}
      </span>
    </span>
  )
}

function Ligne({ caisse, echelle }) {
  return (
    <li className="border-b border-line last:border-b-0">
      <p className="sr-only">{phraseAccessible(caisse)}</p>
      <div
        aria-hidden="true"
        className="grid grid-cols-1 gap-1 px-4 py-2.5 sm:grid-cols-[minmax(7rem,12rem)_1fr_1fr] sm:items-center sm:gap-4"
      >
        <span className="truncate text-sm font-medium text-ink">{caisse.name ?? '—'}</span>
        <Cellule montant={caisse.stock} echelle={echelle} teinte="bg-net-orange" label="Stock" />
        <Cellule montant={caisse.liquidite} echelle={echelle} teinte="bg-brand-400" label="Liquidité" />
      </div>
    </li>
  )
}

/** Le squelette garde la hauteur exacte d'une ligne, pistes comprises. */
function Squelette({ echelle }) {
  return (
    <ul aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <li
          key={i}
          className="grid grid-cols-1 gap-1 border-b border-line px-4 py-2.5 last:border-b-0 sm:grid-cols-[minmax(7rem,12rem)_1fr_1fr] sm:items-center sm:gap-4"
        >
          <span className="h-4 w-28 rounded bg-gray-200 motion-safe:animate-pulse" />
          {[0, 1].map((c) => (
            <span key={c} className="flex items-center gap-2">
              <span className="w-14 shrink-0 sm:hidden" />
              <span className="relative block h-3 w-full rounded-sm bg-brand-100">
                <span
                  className="absolute inset-y-0 left-0 rounded-sm bg-gray-200 motion-safe:animate-pulse"
                  style={{ width: `${25 + ((i + c * 3) % 5) * 12}%` }}
                />
                <span
                  className="piste-seuil absolute -top-1 -bottom-1"
                  style={{ left: `${positionSeuil(echelle.seuil, echelle.plafond)}%` }}
                />
              </span>
              <span className={`${CELLULE_MONTANT} h-4 rounded bg-gray-200 motion-safe:animate-pulse`} />
            </span>
          ))}
        </li>
      ))}
    </ul>
  )
}

function Cle({ teinte, children }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`h-2.5 w-3.5 rounded-sm ${teinte}`} aria-hidden="true" />
      {children}
    </span>
  )
}

function CaissesReseau({
  caisses = [],
  illisibles = 0,
  loading = false,
  reseau = 'Orange',
}) {
  const [terme, setTerme] = useState('')
  const [triId, setTriId] = useState(TRI_DEFAUT)
  const idRecherche = useId()
  const idTri = useId()

  // L'échelle se calcule sur TOUT le réseau, jamais sur le résultat filtré :
  // sinon une recherche redessinerait toutes les barres, et deux captures du
  // même écran ne seraient plus comparables.
  const echelle = useMemo(() => construireEchelle(caisses), [caisses])

  const visibles = useMemo(
    () => trierCaisses(filtrerCaisses(caisses, terme), triId),
    [caisses, terme, triId],
  )

  const tri = triParId(triId)
  const sousLeSeuil = useMemo(
    () => caisses.filter(c => estSousSeuil(c.stock) || estSousSeuil(c.liquidite)).length,
    [caisses],
  )

  return (
    <section
      className="overflow-hidden rounded-xl border border-line bg-surface"
      aria-labelledby="caisses-titre"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-line bg-brand-50 px-4 py-3">
        <div className="min-w-0">
          <h2 id="caisses-titre" className="text-sm font-semibold text-ink">
            Caisses des boutiques
          </h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            Échelle commune 0 – {formatCurrency(echelle.plafond)} · seuil bas{' '}
            {formatCurrency(echelle.seuil)}
            {sousLeSeuil > 0 && (
              <>
                {' · '}
                <span className="font-semibold text-warn">
                  {sousLeSeuil} boutique{sousLeSeuil > 1 ? 's' : ''} sous le seuil
                </span>
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor={idRecherche} className="block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Rechercher
            </label>
            <input
              id={idRecherche}
              type="search"
              value={terme}
              onChange={(e) => setTerme(e.target.value)}
              placeholder="Nom de boutique…"
              data-testid="caisses-recherche"
              className="mt-1 w-44 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
            />
          </div>
          <div>
            <label htmlFor={idTri} className="block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Trier par
            </label>
            <select
              id={idTri}
              value={triId}
              onChange={(e) => setTriId(e.target.value)}
              data-testid="caisses-tri"
              className="mt-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
            >
              {TRIS.map(t => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Le tri courant est ANNONCÉ, et pas seulement affiché dans un menu
          déroulant : un lecteur d'écran qui vient d'entendre la liste changer
          d'ordre n'a aucun moyen de savoir pourquoi. */}
      <p role="status" className="sr-only">
        {loading
          ? 'Chargement des caisses.'
          : `${visibles.length} boutique${visibles.length > 1 ? 's' : ''} affichée${visibles.length > 1 ? 's' : ''}. ${tri.annonce}.`}
      </p>

      {/* Les intitulés de colonnes sont décoratifs : chaque ligne porte déjà sa
          phrase complète, et les relire à chaque ligne serait 84 répétitions. */}
      <div
        aria-hidden="true"
        className="hidden border-b border-line px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted sm:grid sm:grid-cols-[minmax(7rem,12rem)_1fr_1fr] sm:gap-4"
      >
        <span>Boutique</span>
        <span>Stock {reseau}</span>
        <span>Liquidité</span>
      </div>

      {loading ? (
        <Squelette echelle={echelle} />
      ) : caisses.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <p className="text-base font-medium text-ink">Aucune boutique active</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">
            Le réseau ne compte aucune boutique en service. Vos cuves et vos
            ravitaillements en cours restent consultables ; c’est la liste des
            caisses qui n’a rien à montrer.
          </p>
        </div>
      ) : visibles.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <p className="text-base font-medium text-ink">Aucune boutique ne correspond</p>
          <p className="mt-1 text-sm text-ink-muted">
            « {terme} » ne correspond à aucune des {caisses.length} boutiques du réseau.
          </p>
        </div>
      ) : (
        <ul data-testid="caisses-liste">
          {visibles.map(caisse => (
            <Ligne key={caisse.storeId} caisse={caisse} echelle={echelle} />
          ))}
        </ul>
      )}

      {!loading && caisses.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-line px-4 py-3 text-xs text-ink-muted">
          <Cle teinte="bg-net-orange">Stock {reseau}</Cle>
          <Cle teinte="bg-brand-400">Liquidité</Cle>
          <span className="inline-flex items-center gap-2">
            <span className="piste-seuil h-3.5" aria-hidden="true" />
            Seuil bas
          </span>
          {echelle.depassements > 0 && (
            <Cle teinte="bg-net-orange piste-cran">
              Crantée : au-delà de l’échelle, montant exact à droite
            </Cle>
          )}
        </div>
      )}

      {/* Une seule boutique : la comparaison n'a plus d'objet, et une barre à
          mi-course ne veut plus rien dire de relatif. On le dit, plutôt que de
          laisser croire à un classement d'un seul élément. */}
      {!loading && caisses.length === 1 && (
        <p className="border-t border-line bg-brand-50 px-4 py-2 text-xs text-ink-muted">
          Une seule boutique en service : l’échelle ne compare rien. Seule la
          position par rapport au seuil bas garde un sens.
        </p>
      )}

      {/* Un montant illisible n'est pas avalé en silence : sur un écran qui sert
          à décider qui ravitailler, une caisse muette prise pour une caisse
          vide enverrait du stock là où il n'en manque pas. */}
      {!loading && illisibles > 0 && (
        <p className="border-t border-line bg-warn-soft px-4 py-2 text-xs text-warn" role="status">
          {/* La phrase entière bascule au pluriel — accord du verbe compris.
              Coller un « s » sur les seuls noms laisse la queue de phrase au
              singulier : « 3 caisses illisibles : son solde… Elle reste… ». */}
          {illisibles > 1
            ? `${illisibles} caisses illisibles : leur solde n’a pas pu être lu. Elles restent dans la liste, marquées « inconnu », et n’entrent dans aucun total.`
            : '1 caisse illisible : son solde n’a pas pu être lu. Elle reste dans la liste, marquée « inconnu », et n’entre dans aucun total.'}
        </p>
      )}
    </section>
  )
}

export default CaissesReseau
