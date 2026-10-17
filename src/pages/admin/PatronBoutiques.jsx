import { useCallback, useEffect, useMemo, useState } from 'react'
import { listNetworkCaisses, listArgentDehors } from '../../services/dealerService.js'
import { TRIS, TRI_DEFAUT, trierCaisses, filtrerCaisses } from '../../utils/caissesReseau.js'
import ErrorState from '../../components/ui/ErrorState.jsx'

/**
 * L'état des 84 boutiques — quatre chiffres par ligne, et rien de plus.
 *
 * ⚠ LES DEUX SOURCES SONT INDÉPENDANTES, MAIS PAS SYMÉTRIQUES.
 *   Les caisses (stock, espèces) sont la source PRINCIPALE : sans elles, il n'y
 *   a plus rien d'honnête à montrer — écran d'erreur, bouton Réessayer. Le
 *   crédit et le retrait viennent d'un SECOND appel (la callable d'argent
 *   dehors) : si lui seul échoue, les soldes restent affichés et les deux
 *   cases disent « — ». Un écran à moitié chargé vaut mieux qu'un écran blanc
 *   quand la moitié qui reste est de l'argent.
 *
 * ⚠ UNE LECTURE QUI ÉCHOUE NE DIT JAMAIS « LE RÉSEAU N'A RIEN ».
 *   Ce chantier a déjà corrigé plusieurs fois le même défaut : replier un échec
 *   de lecture sur des zéros (`{ caisses: [], total: 0, ... }`) affiche
 *   « Caisses · 0 FCFA sur 0 » et aucune ligne — le patron lit que ses 84
 *   boutiques ne détiennent rien, alors que la lecture a simplement échoué.
 *   D'où TROIS états pour les caisses, pas deux : chargement, erreur (écran
 *   `ErrorState` avec Réessayer), prêt.
 *
 * ⚠ 84 LIGNES, DONC TRI ET FILTRE — RÉUTILISÉS, PAS RÉÉCRITS.
 *   `caissesReseau.js` les porte déjà pour l'accueil dealer.
 */
const francs = (n) => Number(n).toLocaleString('fr-FR')

/**
 * ⚠ DEUX SÉMANTIQUES OPPOSÉES, SUR LA MÊME LIGNE — NE PAS LES UNIFORMISER.
 *   Stock et espèces viennent du document `networkBalances` d'UNE boutique :
 *   s'il n'existe pas, `listNetworkCaisses` rend `null` (jamais 0) — on ne
 *   SAIT PAS, ce n'est pas une caisse vide. Crédit et retrait viennent de
 *   `parBoutique`, où le serveur ne pousse QUE les boutiques qui ont quelque
 *   chose dehors (`listOutstandingDrafts.js`, `if (row.depots > 0 ||
 *   row.retraits > 0)`) : une boutique absente de cette liste n'a donc RIEN
 *   dehors, un vrai 0. Afficher « Inconnu » sur une absence de crédit cacherait
 *   les boutiques qui ne doivent rien ; afficher « 0 » sur une caisse non lue
 *   ferait croire à une caisse vide qui ne l'est peut-être pas.
 */
const montantCaisse = (v) => (v === null || v === undefined ? 'Inconnu' : francs(v))

/** La note d'une somme : rien si elle est complète, sinon ce qui manque. */
const noteIllisibles = (illisibles) => (
  illisibles > 0
    ? ` — incomplète, ${illisibles} caisse${illisibles > 1 ? 's' : ''} illisible${illisibles > 1 ? 's' : ''}`
    : ''
)

function PatronBoutiques() {
  const [caisses, setCaisses] = useState(null)
  const [caissesErreur, setCaissesErreur] = useState(null)
  const [dehors, setDehors] = useState(null)
  const [dehorsEnEchec, setDehorsEnEchec] = useState(false)
  const [tri, setTri] = useState(TRI_DEFAUT)
  const [filtre, setFiltre] = useState('')
  // Change à chaque Réessayer pour redéclencher l'effet de lecture des caisses.
  const [tentative, setTentative] = useState(0)

  useEffect(() => {
    let vivant = true
    setCaissesErreur(null)
    listNetworkCaisses()
      .then((r) => { if (vivant) setCaisses(r) })
      .catch((err) => { if (vivant) setCaissesErreur(err?.message || 'Erreur de chargement.') })
    listArgentDehors()
      .then((r) => { if (vivant) setDehors(r) })
      .catch(() => { if (vivant) setDehorsEnEchec(true) })
    return () => { vivant = false }
  }, [tentative])

  const reessayer = useCallback(() => setTentative((n) => n + 1), [])

  const parBoutique = useMemo(() => {
    const index = new Map()
    for (const l of dehors?.parBoutique ?? []) index.set(l.storeId, l)
    return index
  }, [dehors])

  const vues = useMemo(
    () => trierCaisses(filtrerCaisses(caisses?.caisses ?? [], filtre), tri),
    [caisses, filtre, tri],
  )

  if (caissesErreur) {
    return (
      <div className="px-4 py-6">
        <ErrorState message={caissesErreur} onRetry={reessayer} />
      </div>
    )
  }

  if (!caisses) return <p className="px-6 py-12 text-center text-ink-muted">Chargement…</p>

  const dehorsIndispo = dehorsEnEchec || !dehors

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none gap-2 bg-canvas px-3 pb-1 pt-3">
        <input
          type="search"
          value={filtre}
          onChange={(e) => setFiltre(e.target.value)}
          aria-label="Filtrer les boutiques"
          placeholder="Nom de boutique…"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-brand-200 bg-surface px-3 text-sm text-ink"
        />
        <select
          value={tri}
          onChange={(e) => setTri(e.target.value)}
          aria-label="Trier les boutiques"
          className="min-h-11 max-w-[48%] rounded-xl border border-brand-200 bg-surface px-2 text-sm text-ink"
        >
          {TRIS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </div>

      {/* ⚠ CETTE SOMME PORTE SUR LE RÉSEAU, PAS SUR LA VUE : elle ne bouge pas
          quand le filtre réduit la liste affichée (TC-271-09). */}
      <p
        data-testid="somme-caisses"
        className="flex-none bg-canvas px-4 py-2 text-xs font-bold uppercase tracking-wider text-ink-muted tabular-nums"
      >
        {`Caisses · ${francs(caisses.sommeStock + caisses.sommeLiquidite)} FCFA sur ${caisses.total}`}
        {noteIllisibles(caisses.illisibles)}
      </p>

      {/* ⚠ CORRECTION 2 DU BRIEF — `illisibles` ET `horsReseau` NE SONT PAS
          AFFICHÉS AILLEURS. Sans cette note, de l'argent réellement dehors
          manque aux colonnes crédit/retrait sans que rien ne le signale : la
          somme des colonnes ne correspond plus à la réalité du terrain. */}
      <p
        data-testid="somme-dehors"
        className="flex-none bg-canvas px-4 pb-2 text-xs font-bold uppercase tracking-wider text-ink-muted tabular-nums"
      >
        {dehorsIndispo
          ? 'Argent dehors · indisponible'
          : (() => {
              const { illisibles, horsReseau } = dehors
              const reserves = []
              if (illisibles > 0) reserves.push(`${illisibles} brouillon${illisibles > 1 ? 's' : ''} illisible${illisibles > 1 ? 's' : ''}`)
              if (horsReseau > 0) reserves.push(`${horsReseau} hors réseau`)
              return `Argent dehors · ${francs(dehors.dehors)} FCFA` + (reserves.length ? ` — incomplet, ${reserves.join(', ')}` : '')
            })()}
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <div className="flex flex-col gap-2">
          {vues.map((c) => {
            const d = parBoutique.get(c.storeId)
            return (
              <div
                key={c.storeId}
                data-testid={`boutique-${c.storeId}`}
                className="rounded-xl border border-brand-200 bg-surface px-3 py-2.5"
              >
                <p className="font-bold text-ink">{c.name ?? c.storeId}</p>
                <dl className="mt-2 grid grid-cols-2 gap-1.5 text-sm">
                  <div className="rounded-lg border border-brand-200 bg-canvas px-2 py-1">
                    {/* ⚠ CORRECTION 4 DU BRIEF — PASTILLE, PAS BORDURE.
                        `net-orange` est réservé aux données (index.css:26-29) ;
                        une bordure de 3 px est du chrome, interdit. La pastille
                        est l'emploi déjà fait par `DealerInventoryBar.jsx` et
                        `CaissesReseau.jsx` pour cette même donnée. */}
                    <dt className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-ink-muted">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-net-orange" aria-hidden="true" />
                      Stock
                    </dt>
                    <dd className="font-bold tabular-nums text-ink">{montantCaisse(c.stock)}</dd>
                  </div>
                  <div className="rounded-lg border border-brand-200 bg-canvas px-2 py-1">
                    <dt className="text-[9px] font-bold uppercase tracking-wider text-ink-muted">Espèces</dt>
                    <dd className="font-bold tabular-nums text-ink">{montantCaisse(c.liquidite)}</dd>
                  </div>
                  <div className="rounded-lg border border-warn bg-canvas px-2 py-1">
                    <dt className="text-[9px] font-bold uppercase tracking-wider text-ink-muted">Crédit · argent dehors</dt>
                    {/* ⚠ UNE BOUTIQUE ABSENTE DE `parBoutique` DOIT RÉELLEMENT 0,
                        PAS « INCONNU » (voir le commentaire de `montantCaisse`
                        plus haut) — sauf si la source elle-même est indisponible,
                        auquel cas on ne sait vraiment pas : « — ». */}
                    <dd data-testid={`credit-${c.storeId}`} className="font-bold tabular-nums text-warn">
                      {dehorsIndispo ? '—' : francs(d?.depots ?? 0)}
                    </dd>
                  </div>
                  <div className="rounded-lg border border-danger bg-canvas px-2 py-1">
                    <dt className="text-[9px] font-bold uppercase tracking-wider text-ink-muted">Retrait · clients non payés</dt>
                    <dd data-testid={`retrait-${c.storeId}`} className="font-bold tabular-nums text-danger">
                      {dehorsIndispo ? '—' : francs(d?.retraits ?? 0)}
                    </dd>
                  </div>
                </dl>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default PatronBoutiques
