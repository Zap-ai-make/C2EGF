import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft, Send } from 'lucide-react'
import { firestoreService } from '../../services/firestore.js'
import { useHistoriqueClient } from '../../hooks/useHistoriqueClient.js'
import { delaiMoyen } from '../../utils/delaiMoyen.js'
import { phraseDelai } from '../../utils/phraseDelai.js'
import { champsAgent } from '../../utils/agentFields.js'
import { texteFiche, lienWhatsApp } from '../../utils/ficheWhatsApp.js'
import LigneHistorique from '../../components/clients/LigneHistorique.jsx'
import ErrorState from '../../components/ui/ErrorState.jsx'
import LoadMoreButton from '../../components/ui/LoadMoreButton.jsx'

/**
 * L'historique d'un client, toutes boutiques — la page que le patron ouvre
 * pendant l'appel.
 *
 * ⚠ LA FICHE VIENT DE L'ABONNEMENT, PAS DE L'URL NI DE L'ÉTAT DE NAVIGATION.
 *   L'adresse ne porte qu'un identifiant. Passer l'objet par `state` du routeur
 *   le perdrait au rechargement.
 *
 * ⚠ UNE FICHE ÉCOUTÉE, PAS LA BASE (docs/rester-dans-le-quota-gratuit.md
 *   §A2). Cette page s'abonnait aux ~15 700 fiches du réseau pour en afficher
 *   une : 15 679 lectures facturées à chaque ouverture faite après 30 minutes.
 *   `subscribeToClient` écoute le seul document : une lecture, plus une par
 *   modification — et la fiche suit toujours en direct une correction ou une
 *   suppression faite par une boutique (TC-269-18, TC-269-19).
 *
 * ⚠ LA RÉPONSE EST RANGÉE AVEC L'IDENTIFIANT QU'ELLE CONCERNE. Si l'adresse
 *   change sans démonter la page, `ficheRecue` repasse à faux jusqu'à la
 *   réponse pour le nouvel identifiant : l'ancienne fiche ne s'affiche jamais
 *   sous la nouvelle adresse.
 *
 * ⚠ L'ABONNEMENT PERD SES ERREURS SI ON LUI PASSE UNE FONCTION NUE. Il passe
 *   par `normalizeSubscriptionObserver`, qui cherche `callback.onError` — sans
 *   lui, un `permission-denied` ou une coupure finit dans `console.error` et
 *   rien n'atteint l'écran (même piège que `ClientsContext.jsx` et
 *   `PatronClients.jsx`). « Avoir une réponse » et « avoir échoué » restent
 *   donc deux états distincts : les confondre referait le bug que
 *   `PatronClients` a déjà dû corriger — un écran bloqué sur « Chargement… »
 *   pour toujours.
 */
function PatronHistoriqueClient() {
  const { clientId } = useParams()
  const [reponse, setReponse] = useState({ id: null, client: null, erreur: null })

  useEffect(() => {
    const onFiche = (fiche) => setReponse({ id: clientId, client: fiche, erreur: null })
    onFiche.onError = (err) => setReponse({
      id: clientId,
      client: null,
      erreur: err?.message || 'Erreur de chargement.',
    })
    return firestoreService.subscribeToClient(clientId, onFiche)
  }, [clientId])

  const ficheRecue = reponse.id === clientId
  const ficheErreur = ficheRecue ? reponse.erreur : null
  const client = ficheRecue ? reponse.client : null

  const { lignes, etat, erreur, encore, chargerPlus, reessayer } = useHistoriqueClient(clientId)
  const delai = useMemo(() => delaiMoyen(lignes), [lignes])
  const { titre: delaiTitre, detail: delaiDetail } = phraseDelai(delai)

  const agent = client ? champsAgent(client) : null

  /**
   * ⚠ RONDE DE CORRECTION 1 (R22) — LE LIEN PREND LA MÊME EXPRESSION QUE LE
   *   BLOC `delai-moyen` CI-DESSOUS, PAS SA PROPRE CONDITION. Avant ce correctif,
   *   le lien se rendait dès que `client` existait, sans regarder `etat` : en
   *   `inactif`/`chargement`, le message partait en disant « Jamais mesuré —
   *   aucune opération chargée » sur un agent qui en a peut-être 300 ; en
   *   `erreur`, il en envoyait un alors que la lecture a échoué ; et le pire
   *   cas — une `erreur` survenue APRÈS une première page, où le `catch` du
   *   hook ne vide pas `lignes` (`useHistoriqueClient.js:73-83`) — faisait
   *   partir un chiffre que l'écran, lui, ne montre plus du tout. Un bouton qui
   *   apparaît quand la donnée arrive est normal ; un message qui parle quand
   *   l'écran se tait ne l'est pas.
   * ⚠ PAS DE REPLI `'#'` : un lien qui ne mène nulle part se tape, deux fois
   *   parfois (M-7 de cette même ronde). Hors de ces deux états, rien n'est
   *   rendu — voir le JSX plus bas.
   */
  const peutEnvoyerFiche = Boolean(client) && (etat === 'pret' || etat === 'chargementPage')
  const lienFiche = useMemo(
    () => (peutEnvoyerFiche ? lienWhatsApp(texteFiche({ client, lignes, delai })) : null),
    [peutEnvoyerFiche, client, lignes, delai],
  )

  return (
    <div data-testid="patron-historique-client" className="flex h-full min-h-0 flex-col">
      {ficheErreur ? (
        <div className="px-4 py-6">
          <ErrorState message={ficheErreur} />
          <Link
            to="/admin"
            className="mt-4 inline-flex min-h-11 items-center text-brand-400 underline"
          >
            Retour au tableau
          </Link>
        </div>
      ) : !ficheRecue ? (
        <p className="px-6 py-12 text-center text-ink-muted">Chargement…</p>
      ) : !client ? (
        // ⚠ `ficheRecue` D'ABORD, `client` ENSUITE. Le premier dit « a-t-on une
        //   réponse », le second « la fiche existe-t-elle ». Sans cet ordre,
        //   l'attente de la première réponse se lirait « fiche introuvable »
        //   (TC-269-06).
        <div className="px-6 py-12 text-center">
          <p className="mb-4 font-semibold text-ink">Fiche introuvable.</p>
          <p className="mb-6 text-sm text-ink-muted">
            Cette fiche n'existe plus, ou l'adresse est erronée.
          </p>
          <Link
            to="/admin"
            className="inline-flex min-h-11 items-center text-brand-400 underline"
          >
            Retour au tableau
          </Link>
        </div>
      ) : (
        <>
          <div className="flex flex-none items-center gap-3 bg-brand-500 px-3 py-3">
            <Link
              to="/admin"
              aria-label="Retour au tableau"
              className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-white/15 text-white hover:bg-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <ChevronLeft className="h-6 w-6" aria-hidden="true" />
            </Link>
            <div className="min-w-0">
              <p className="truncate font-bold text-white">
                {`${client.nom ?? ''} ${client.prenom ?? ''}`.trim() || 'Client'}
              </p>
              <p className="truncate text-xs text-brand-200 tabular-nums">
                {agent?.codeAgent ? `Code ${agent.codeAgent}` : 'Sans code agent'}
              </p>
            </div>
            {lienFiche && (
              <a
                href={lienFiche}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Envoyer la fiche par WhatsApp"
                className="ml-auto flex h-11 flex-none items-center gap-1.5 rounded-xl bg-success px-3 text-sm font-bold text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
                Envoyer
              </a>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {/* ⚠ RONDE DE CORRECTION 1 (I-1) — PAS DE VERDICT AVANT D'AVOIR
                DEMANDÉ, MÊME MOTIF QUE `HistoriqueClientPanel.jsx:144-150`. Le
                hook démarre à `inactif` puis `chargement`, avec `lignes ===
                []` : une condition qui ne regarderait que `lignes` afficherait
                « Jamais mesuré — Aucune opération chargée » sur un agent qui en
                a peut-être 300, le temps que la première page arrive.
             ⚠ RONDE DE CORRECTION 2 (R17) — `'chargementPage'` EST ADMIS, ET
                CE N'EST PAS LE MÊME CAS. Cet état n'est atteignable qu'APRÈS
                qu'une première page a répondu : il exige un curseur
                (`useHistoriqueClient.js:55`, posé par `charger(id, curseur)`
                lors d'un « Charger plus »). La garantie d'I-1 — ne jamais
                afficher un verdict avant la réponse du serveur — tient donc
                encore : on A une réponse, et le chiffre affiché reste celui de
                cette réponse-là. Le démonter pendant que la page suivante
                arrive ferait clignoter un chiffre déjà valide pour rien.
             ⚠ CETTE CONDITION EST AUSSI CELLE DU LIEN « ENVOYER » CI-DESSUS
                (`peutEnvoyerFiche`, ronde de correction 1, R22) : le message
                ne doit jamais parler quand ce bloc se tait. */}
            {(etat === 'pret' || etat === 'chargementPage') && (
              // ⚠ L'EFFECTIF EST DANS LE MÊME BLOC QUE LA MOYENNE. Les séparer
              //   laisserait l'écran annoncer « 4 j » à côté de « 24 opérations »
              //   alors que la mesure n'en couvre qu'une partie.
              <div
                data-testid="delai-moyen"
                className="mb-3 rounded-xl border border-brand-200 bg-surface px-4 py-3"
              >
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                  Temps mis avant remboursement
                </p>
                {/* ⚠ RONDE DE CORRECTION 1 (I-3) — `titre`/`detail` VIENNENT DE
                    `phraseDelai.js`, PAS D'UN TERNAIRE ÉCRIT ICI. Les
                    `data-testid` ne changent rien à l'affichage : ils laissent
                    `tc-269-12` lire ces deux textes dans le DOM rendu au lieu
                    de les recopier à la main dans le test — la seule façon
                    pour un test de ne jamais diverger de l'écran qu'il
                    verrouille. Le détail de chaque branche (jamais mesuré,
                    0 j, etc.) est documenté dans `phraseDelai.js`. */}
                <p data-testid="delai-titre" className="text-2xl font-bold tabular-nums text-ink">
                  {delaiTitre}
                </p>
                <p data-testid="delai-detail" className="mt-0.5 text-xs text-ink-muted tabular-nums">
                  {delaiDetail}
                </p>
                {/* ⚠ RONDE DE CORRECTION 1 (M-2) — LA MOYENNE SUIT LA PAGE, PAS
                    L'HISTORIQUE ENTIER. `useHistoriqueClient` charge par pages de
                    50 (`functions/src/clients/listClientHistory.js`, `PAGE`) ;
                    `delaiMoyen` ne voit que les lignes déjà reçues. Sans cette
                    phrase, le chiffre change après un « Charger plus » sans que
                    rien ne le dise — un second appel du patron au même client
                    lirait un nombre différent sans explication. */}
                <p className="mt-1 text-[11px] text-ink-muted">
                  Calculé sur les opérations déjà chargées (pages de 50) — pas sur
                  tout l'historique de l'agent.
                </p>
              </div>
            )}

            {(etat === 'inactif' || etat === 'chargement') && (
              <p className="px-1 py-6 text-center text-ink-muted">Chargement de l'historique…</p>
            )}

            {/* ⚠ RONDE DE CORRECTION 1 (M-5) — `ErrorState` REMPLACE LE BANDEAU
                MAISON. Deux widgets d'erreur pour la même panne (un bandeau
                écrit à la main ici, `ErrorState` importé mais utilisé seulement
                plus haut) n'avaient aucune raison de différer — et `ErrorState`
                porte déjà son `role="alert"` et son bouton Réessayer. */}
            {etat === 'erreur' && (
              <div className="mb-3">
                <ErrorState message={erreur} onRetry={reessayer} />
              </div>
            )}

            {/* ⚠ RONDE DE CORRECTION 1 (M-4) — DES `<div>`, PAS UN `<ul>`. Un
                `<ul>` dont les enfants directs sont des `<div>` (la racine de
                `LigneHistorique`) n'est, pour un lecteur d'écran, une liste
                d'AUCUN élément — les `<li>` manquants ne comptent pas comme du
                contenu de liste. Même choix que `HistoriqueClientPanel.jsx`. */}
            <div className="flex flex-col gap-2">
              {lignes.map((ligne) => (
                <LigneHistorique key={ligne.id} ligne={ligne} />
              ))}
            </div>

            {/* ⚠ RONDE DE CORRECTION 1 (M-5) — `LoadMoreButton` REMPLACE LE
                BOUTON MAISON. Le bouton écrit à la main n'avait ni `loading` ni
                `disabled` : le patron pouvait le taper deux fois sans retour
                visible pendant que la page suivante arrivait déjà.
                `LoadMoreButton` (`src/components/ui/LoadMoreButton.jsx`) porte
                les deux, et c'est déjà celui que `HistoriqueClientPanel.jsx`
                utilise pour le même geste. */}
            {encore && etat !== 'erreur' && (
              <LoadMoreButton loading={etat === 'chargementPage'} onClick={chargerPlus} />
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default PatronHistoriqueClient
