import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listNetworkCaisses, listArgentDehors } from '../../services/dealerService.js'
import { TRIS, TRI_DEFAUT, trierCaisses, filtrerCaisses, triParId } from '../../utils/caissesReseau.js'
import { formatCurrency } from '../../utils/formatCurrency.js'
import { DEALER_NETWORK } from '../../constants/dealerConstants.js'
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
 *   `ErrorState` avec Réessayer), prêt. Et TROIS états pour l'argent dehors
 *   aussi (ronde de correction 1, I1) — « en vol » (la callable n'a pas encore
 *   répondu) n'est PAS la même chose qu'« en échec » (elle a répondu un refus).
 *   Les confondre affirme une panne pendant les quelques secondes où Cloud Run
 *   se réveille simplement — le défaut inverse de celui du paragraphe
 *   précédent, mais le même principe : ne jamais se prononcer avant d'avoir
 *   fini de demander.
 *
 * ⚠ 84 LIGNES, DONC TRI ET FILTRE — RÉUTILISÉS, PAS RÉÉCRITS.
 *   `caissesReseau.js` les porte déjà pour l'accueil dealer.
 */

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
const montantCaisse = (v) => (v === null || v === undefined ? 'Inconnu' : formatCurrency(v))

/** La note d'une somme : rien si elle est complète, sinon ce qui manque. */
const noteIllisibles = (illisibles) => (
  illisibles > 0
    ? ` — incomplète, ${illisibles} caisse${illisibles > 1 ? 's' : ''} illisible${illisibles > 1 ? 's' : ''}`
    : ''
)

/**
 * Les deux réserves possibles de l'agrégat réseau, dans les mots que
 * `DehorsParBoutique.jsx:91-104` emploie déjà pour la même réalité — pas un
 * second vocabulaire (« brouillon ») pour ce que l'utilisateur appelle déjà
 * une « opération ».
 */
function reservesDehors(illisibles, horsReseau) {
  const phrases = []
  if (illisibles > 0) {
    phrases.push(illisibles > 1
      ? `${illisibles} opérations n’ont pas pu être lues : elles n’entrent dans aucun total.`
      : '1 opération n’a pas pu être lue : elle n’entre dans aucun total.')
  }
  if (horsReseau > 0) {
    phrases.push(horsReseau > 1
      ? `${horsReseau} opérations appartiennent à des boutiques qui ne sont plus en service : écartées du total, comme leurs caisses le sont.`
      : '1 opération appartient à une boutique qui n’est plus en service : écartée du total, comme sa caisse l’est.')
  }
  return phrases
}

function PatronBoutiques() {
  const [caisses, setCaisses] = useState(null)
  const [caissesErreur, setCaissesErreur] = useState(null)
  const [dehors, setDehors] = useState(null)
  const [dehorsEnEchec, setDehorsEnEchec] = useState(false)
  const [tri, setTri] = useState(TRI_DEFAUT)
  const [filtre, setFiltre] = useState('')

  // ⚠ RONDE DE CORRECTION 1 (C2) — UNE RÉFÉRENCE DE MONTAGE PARTAGÉE, PAS UN
  //   DRAPEAU FERMÉ PAR TENTATIVE. La version précédente rouvrait l'effet via
  //   un compteur `tentative`, et le `catch` de l'argent dehors ne faisait que
  //   `setDehorsEnEchec(true)` — rien, nulle part, ne le repassait à `false`.
  //   Après une coupure initiale puis un Réessayer réussi, l'écran continuait
  //   d'afficher « indisponible » et « — » dans les 168 cases crédit/retrait,
  //   alors que `dehors` portait les vrais montants en mémoire : un appel
  //   facturé pour un résultat que l'écran refusait de montrer.
  //   `charger()` est maintenant LE seul endroit qui remet `caissesErreur`,
  //   `dehors` ET `dehorsEnEchec` à zéro avant de relire — le bug disparaît par
  //   construction. `vivantRef` (plutôt qu'un `let vivant` local à l'effet)
  //   parce que Réessayer appelle `charger()` directement, hors de l'effet : un
  //   drapeau fermé sur le seul mandat de l'effet de montage ne protégerait pas
  //   ce second appel contre un démontage pendant que la requête est en vol.
  const vivantRef = useRef(true)
  useEffect(() => () => { vivantRef.current = false }, [])

  const charger = useCallback(() => {
    setCaissesErreur(null)
    setDehors(null)
    setDehorsEnEchec(false)
    listNetworkCaisses()
      .then((r) => { if (vivantRef.current) setCaisses(r) })
      .catch((err) => { if (vivantRef.current) setCaissesErreur(err?.message || 'Erreur de chargement.') })
    listArgentDehors()
      .then((r) => { if (vivantRef.current) setDehors(r) })
      .catch(() => { if (vivantRef.current) setDehorsEnEchec(true) })
  }, [])

  useEffect(() => { charger() }, [charger])

  const parBoutique = useMemo(() => {
    const index = new Map()
    for (const l of dehors?.parBoutique ?? []) index.set(l.storeId, l)
    return index
  }, [dehors])

  const vues = useMemo(
    () => trierCaisses(filtrerCaisses(caisses?.caisses ?? [], filtre), tri),
    [caisses, filtre, tri],
  )

  // Trois états, jamais deux (voir le commentaire d'en-tête, I1) : « en vol »
  // tant que `dehors` est encore `null` et qu'aucun échec n'est constaté ;
  // « en échec » une fois le refus reçu ; sinon prêt, avec de vrais montants.
  const dehorsEnVol = !dehors && !dehorsEnEchec

  return (
    <div data-testid="patron-boutiques" className="flex h-full min-h-0 flex-col">
      {/* Titre muet : la page n'a pas de bandeau visuel (téléphone d'abord, le
          strict nécessaire), mais un lecteur d'écran arrivant ici doit pouvoir
          nommer l'écran, erreur et chargement compris. */}
      <h2 className="sr-only">Les boutiques et leurs soldes</h2>

      {caissesErreur ? (
        <div className="px-4 py-6">
          <ErrorState message={caissesErreur} onRetry={charger} />
        </div>
      ) : !caisses ? (
        <p className="px-6 py-12 text-center text-ink-muted">Chargement…</p>
      ) : (
        <>
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

          {/* ⚠ RONDE DE CORRECTION 1 (I5) — L'ANNONCE VOCALE DE `TRIS` EST
              RÉUTILISÉE, PAS SEULEMENT LE TABLEAU. `tri.annonce` existe
              précisément pour qu'un lecteur d'écran sache POURQUOI la liste
              vient de changer d'ordre — `CaissesReseau.jsx:365-371` le rend
              déjà ainsi pour le même tri. */}
          <p role="status" className="sr-only">
            {`${vues.length} boutique${vues.length > 1 ? 's' : ''} affichée${vues.length > 1 ? 's' : ''}. ${triParId(tri).annonce}.`}
          </p>

          {/* ⚠ CETTE SOMME PORTE SUR LE RÉSEAU, PAS SUR LA VUE : elle ne bouge
              pas quand le filtre réduit la liste affichée (TC-271-09). */}
          <p
            data-testid="somme-caisses"
            className="flex-none bg-canvas px-4 py-2 text-xs font-bold uppercase tracking-wider text-ink-muted tabular-nums"
          >
            {`Caisses · ${formatCurrency(caisses.sommeStock + caisses.sommeLiquidite)} sur ${caisses.total}`}
            {noteIllisibles(caisses.illisibles)}
          </p>

          {/* ⚠ CORRECTION 2 DU BRIEF, PUIS C1 DE LA RONDE 1 — `illisibles` ET
              `horsReseau` SONT ANNONCÉS, ET LE NOMBRE AFFICHÉ EST LE BRUT, PAS
              LE NET. `dehors.dehors` (= dépôts − retraits, `argentDehors.js`)
              porte le MÊME libellé que `d.depots` affiché deux lignes plus bas
              sur chaque ligne (« Crédit · argent dehors ») : la même phrase
              pour deux nombres différents sous-estimait les deux colonnes d'un
              facteur pouvant dépasser 20 dans un cas réel relevé en relecture.
              Les deux totaux que le patron a dictés ont donc chacun leur
              chiffre réseau — pas de net ici. */}
          <p
            data-testid="somme-dehors"
            className="flex-none bg-canvas px-4 pb-2 text-xs font-bold uppercase tracking-wider text-ink-muted tabular-nums"
          >
            {dehorsEnEchec
              ? 'Argent dehors · indisponible.'
              : dehorsEnVol
                ? 'Argent dehors · lecture en cours…'
                : `Crédit · argent dehors · ${formatCurrency(dehors.depots)} — Retrait · clients non payés · ${formatCurrency(dehors.retraits)}`
                  + (reservesDehors(dehors.illisibles, dehors.horsReseau).length > 0
                    ? ` — Total incomplet : ${reservesDehors(dehors.illisibles, dehors.horsReseau).join(' ')}`
                    : '')}
          </p>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            {/* ⚠ RONDE DE CORRECTION 1 (I6) — LES DEUX VIDES NE SE CONFONDENT
                PAS, MÊME DISTINCTION QUE `CaissesReseau.jsx:390-405` : un
                réseau sans boutique active n'est pas la même situation qu'un
                filtre qui ne trouve personne — le premier n'a rien à voir avec
                ce que le patron vient de taper. */}
            {caisses.caisses.length === 0 ? (
              <div className="px-1 py-10 text-center">
                <p className="text-base font-medium text-ink">Aucune boutique active</p>
                <p className="mt-1 text-sm text-ink-muted">
                  Le réseau ne compte aucune boutique en service pour l'instant.
                </p>
              </div>
            ) : vues.length === 0 ? (
              <div className="px-1 py-10 text-center">
                <p className="text-base font-medium text-ink">Aucune boutique ne correspond</p>
                <p className="mt-1 text-sm text-ink-muted">
                  « {filtre} » ne correspond à aucune des {caisses.caisses.length} boutiques du réseau.
                </p>
              </div>
            ) : (
              // ⚠ RONDE DE CORRECTION 1 (M5) — UN VRAI `<ul>`, PAS UNE PILE DE
              //   `<div>`. `CaissesReseau.jsx:407-411` rend ses 84 lignes de la
              //   même façon ; chaque carte est un `<li>` direct, pas un `<div>`
              //   qui romprait la sémantique de liste pour un lecteur d'écran.
              <ul className="flex flex-col gap-2">
                {vues.map((c) => {
                  const d = parBoutique.get(c.storeId)
                  return (
                    <li
                      key={c.storeId}
                      data-testid={`boutique-${c.storeId}`}
                      className="rounded-xl border border-brand-200 bg-surface px-3 py-2.5"
                    >
                      <p className="font-bold text-ink">{c.name ?? c.storeId}</p>
                      <dl className="mt-2 grid grid-cols-2 gap-1.5 text-sm">
                        <div className="rounded-lg border border-brand-200 bg-canvas px-2 py-1">
                          {/* ⚠ CORRECTION 4 DU BRIEF — PASTILLE, PAS BORDURE.
                              `net-orange` est réservé aux données
                              (index.css:26-31) ; une bordure de 3 px est du
                              chrome, interdit. ⚠ RONDE DE CORRECTION 1 (M3) —
                              LA PASTILLE EST « TOUJOURS DOUBLÉE DU NOM DE
                              L'OPÉRATEUR EN TOUTES LETTRES » (index.css:30),
                              pas d'un rond silencieux : `DealerInventoryBar.jsx
                              :205` écrit déjà `Stock ${DEALER_NETWORKS[0]}`
                              pour la même donnée. */}
                          <dt className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-ink-muted">
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-net-orange" aria-hidden="true" />
                            {`Stock ${DEALER_NETWORK}`}
                          </dt>
                          <dd className="font-bold tabular-nums text-ink">{montantCaisse(c.stock)}</dd>
                        </div>
                        <div className="rounded-lg border border-brand-200 bg-canvas px-2 py-1">
                          <dt className="text-[9px] font-bold uppercase tracking-wider text-ink-muted">Espèces</dt>
                          <dd className="font-bold tabular-nums text-ink">{montantCaisse(c.liquidite)}</dd>
                        </div>
                        <div className="rounded-lg border border-brand-200 bg-canvas px-2 py-1">
                          <dt className="text-[9px] font-bold uppercase tracking-wider text-ink-muted">Crédit · argent dehors</dt>
                          {/* ⚠ UNE BOUTIQUE ABSENTE DE `parBoutique` DOIT
                              RÉELLEMENT 0, PAS « INCONNU » (voir le commentaire
                              de `montantCaisse` plus haut) — sauf si la source
                              est en vol ou en échec, auquel cas on ne sait pas
                              encore ou plus du tout : « … » puis « — ».
                              ⚠ RONDE DE CORRECTION 1 (I3) — NI `warn` NI
                              `danger` NI `outflow` : un dépôt ou un retrait non
                              terminé n'est ni un seuil bas, ni un échec, ni un
                              mouvement de caisse (index.css:18-31). Les mots
                              portent déjà le sens ; `DehorsParBoutique.jsx
                              :39-47` ne colore ni l'un ni l'autre, même
                              choix ici. */}
                          <dd data-testid={`credit-${c.storeId}`} className="font-bold tabular-nums text-ink">
                            {dehorsEnEchec ? '—' : dehorsEnVol ? '…' : formatCurrency(d?.depots ?? 0)}
                          </dd>
                        </div>
                        <div className="rounded-lg border border-brand-200 bg-canvas px-2 py-1">
                          <dt className="text-[9px] font-bold uppercase tracking-wider text-ink-muted">Retrait · clients non payés</dt>
                          <dd data-testid={`retrait-${c.storeId}`} className="font-bold tabular-nums text-ink">
                            {dehorsEnEchec ? '—' : dehorsEnVol ? '…' : formatCurrency(d?.retraits ?? 0)}
                          </dd>
                        </div>
                      </dl>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default PatronBoutiques
