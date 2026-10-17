import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft, Send } from 'lucide-react'
import { firestoreService } from '../../services/firestore.js'
import { useHistoriqueClient } from '../../hooks/useHistoriqueClient.js'
import { delaiMoyen } from '../../utils/delaiMoyen.js'
import { champsAgent } from '../../utils/agentFields.js'
import { texteFiche, lienWhatsApp } from '../../utils/ficheWhatsApp.js'
import LigneHistorique from '../../components/clients/LigneHistorique.jsx'
import ErrorState from '../../components/ui/ErrorState.jsx'
import LoadMoreButton from '../../components/ui/LoadMoreButton.jsx'

/** Un accord au pluriel, pour les phrases comptées de ce fichier. */
const s = (n) => (n > 1 ? 's' : '')

/**
 * L'historique d'un client, toutes boutiques — la page que le patron ouvre
 * pendant l'appel.
 *
 * ⚠ LA FICHE VIENT DE L'ABONNEMENT, PAS DE L'URL NI DE L'ÉTAT DE NAVIGATION.
 *   L'adresse ne porte qu'un identifiant. Passer l'objet par `state` du routeur
 *   le perdrait au rechargement.
 *
 * ⚠ RONDE DE CORRECTION 1 (M-6) — CE N'EST PAS LE MÊME ABONNEMENT QUE CELUI DE
 *   `PatronClients`. `AdminLayout` monte l'écran d'accueil et cette page sous
 *   le MÊME `<Outlet>` : naviguer de l'un à l'autre démonte le premier avant de
 *   monter le second (routage, pas onglets superposés). Cette page ouvre donc
 *   un SECOND abonnement plein-collection sur ~15 700 fiches, pas une lecture
 *   d'un document déjà en mémoire. Un remontage partagé de l'abonnement (par
 *   exemple levé dans `AdminLayout`, au-dessus de l'`Outlet`) économiserait ce
 *   second coût réseau ; différé, pas traité par ce lot.
 *
 * ⚠ `subscribeToAllClients` PERD SES ERREURS SI ON LUI PASSE UNE FONCTION NUE.
 *   Il passe par `normalizeSubscriptionObserver`, qui cherche `callback.onError`
 *   — sans lui, un `permission-denied` ou une coupure finit dans `console.error`
 *   et rien n'atteint l'écran (même piège que `ClientsContext.jsx` et
 *   `PatronClients.jsx`). `clientsPret` ET `clientsErreur` sont donc DEUX états
 *   distincts : le premier dit que l'abonnement a répondu au moins une fois (que
 *   la liste soit vide ou pleine), le second qu'il a échoué. Les confondre
 *   referait exactement le bug que `PatronClients` a déjà dû corriger — un écran
 *   bloqué sur « Chargement… » pour toujours.
 */
function PatronHistoriqueClient() {
  const { clientId } = useParams()
  const [clients, setClients] = useState([])
  const [clientsPret, setClientsPret] = useState(false)
  const [clientsErreur, setClientsErreur] = useState(null)

  useEffect(() => {
    const onClients = (data) => {
      setClients(data)
      setClientsPret(true)
      setClientsErreur(null)
    }
    onClients.onError = (err) => {
      setClientsErreur(err?.message || 'Erreur de chargement.')
      setClientsPret(true)
    }
    return firestoreService.subscribeToAllClients(onClients)
  }, [])

  const client = useMemo(
    () => clients.find((c) => c.id === clientId) ?? null,
    [clients, clientId],
  )

  const { lignes, etat, erreur, encore, chargerPlus, reessayer } = useHistoriqueClient(clientId)
  const delai = useMemo(() => delaiMoyen(lignes), [lignes])

  const agent = client ? champsAgent(client) : null

  // ⚠ MÉMOÏSÉ : `texteFiche` parcourt les lignes, et l'en-tête se rend à chaque
  //   frappe de défilement de la liste en dessous.
  const lienFiche = useMemo(
    () => (client ? lienWhatsApp(texteFiche({ client, lignes, delai })) : '#'),
    [client, lignes, delai],
  )

  return (
    <div data-testid="patron-historique-client" className="flex h-full min-h-0 flex-col">
      {clientsErreur ? (
        <div className="px-4 py-6">
          <ErrorState message={clientsErreur} />
          <Link
            to="/admin"
            className="mt-4 inline-flex min-h-11 items-center text-brand-400 underline"
          >
            Retour au tableau
          </Link>
        </div>
      ) : !clientsPret ? (
        <p className="px-6 py-12 text-center text-ink-muted">Chargement…</p>
      ) : !client ? (
        // ⚠ `clientsPret` PLUTÔT QUE `clients.length > 0`. Avec le seul effectif,
        //   une base réseau réellement vide aurait silencieusement affiché l'en-
        //   tête générique « Client » au lieu de dire que la fiche est
        //   introuvable. `clientsPret` est vrai dès que l'abonnement a répondu
        //   une première fois, effectif nul ou pas — c'est la bonne question
        //   ici, « a-t-on une réponse », pas « la base est-elle non vide ».
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
            <a
              href={lienFiche}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto flex h-11 flex-none items-center gap-1.5 rounded-xl bg-success px-3 text-sm font-bold text-white hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              Envoyer
            </a>
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
                arrive ferait clignoter un chiffre déjà valide pour rien. */}
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
                <p className="text-2xl font-bold tabular-nums text-ink">
                  {/* ⚠ RONDE DE CORRECTION 1 (M-1) — « 0 j » DIT L'INVERSE DE CE
                      QU'IL VEUT DIRE. Toute moyenne mesurée sous 12 h arrondit à
                      zéro (`delaiMoyen` arrondit au jour) ; un agent réglé en 3 h
                      afficherait « 0 j en moyenne », qui se lit comme un défaut,
                      pas comme une qualité. */}
                  {delai.jours === null
                    ? 'Jamais mesuré'
                    : delai.jours === 0
                      ? "Moins d'un jour en moyenne"
                      : `${delai.jours} j en moyenne`}
                </p>
                <p className="mt-0.5 text-xs text-ink-muted tabular-nums">
                  {/* ⚠ RONDE DE CORRECTION 1 (M-3) — `total` N'EST PAS UN
                      COMPTE DE DÉPÔTS (I-2 : il mêle dépôts et retraits), donc
                      le zéro mesure ne peut pas dire « aucun des N dépôts » sans
                      mentir sur ce que N compte. Et plus aucune phrase ne porte
                      un « 0 » ou un « 1 » mal accordés — lues au téléphone, les
                      deux se remarquaient. */}
                  {delai.jours === null
                    ? (delai.total > 0
                        ? `Aucun dépôt mesurable parmi les ${delai.total} opération${s(delai.total)} chargée${s(delai.total)}.`
                        : "Aucune opération chargée pour l'instant.")
                    : `Sur ${delai.mesurees} dépôt${s(delai.mesurees)} mesuré${s(delai.mesurees)} sur ${delai.total} opération${s(delai.total)} chargée${s(delai.total)}.`}
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
