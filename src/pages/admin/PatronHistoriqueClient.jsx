import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { firestoreService } from '../../services/firestore.js'
import { useHistoriqueClient } from '../../hooks/useHistoriqueClient.js'
import { delaiMoyen } from '../../utils/delaiMoyen.js'
import { champsAgent } from '../../utils/agentFields.js'
import LigneHistorique from '../../components/clients/LigneHistorique.jsx'
import ErrorState from '../../components/ui/ErrorState.jsx'

/**
 * L'historique d'un client, toutes boutiques — la page que le patron ouvre
 * pendant l'appel.
 *
 * ⚠ LA FICHE VIENT DE L'ABONNEMENT, PAS DE L'URL NI DE L'ÉTAT DE NAVIGATION.
 *   L'adresse ne porte qu'un identifiant. Passer l'objet par `state` du routeur
 *   le perdrait au rechargement, et refaire une lecture serait une requête de
 *   plus pour un document que le patron a DÉJÀ en mémoire : son écran d'accueil
 *   est abonné à la base entière.
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

  if (clientsErreur) {
    return (
      <div className="px-4 py-6">
        <ErrorState message={clientsErreur} />
        <Link
          to="/admin"
          className="mt-4 inline-flex min-h-11 items-center text-brand-400 underline"
        >
          Retour au tableau
        </Link>
      </div>
    )
  }

  if (!clientsPret) {
    return <p className="px-6 py-12 text-center text-ink-muted">Chargement…</p>
  }

  // ⚠ `clientsPret` PLUTÔT QUE `clients.length > 0`. Avec le seul effectif, une
  //   base réseau réellement vide aurait silencieusement affiché l'en-tête
  //   générique « Client » au lieu de dire que la fiche est introuvable.
  //   `clientsPret` est vrai dès que l'abonnement a répondu une première fois,
  //   effectif nul ou pas — c'est la bonne question ici, « a-t-on une réponse »,
  //   pas « la base est-elle non vide ».
  if (!client) {
    return (
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
    )
  }

  const agent = champsAgent(client)

  return (
    <div className="flex h-full min-h-0 flex-col">
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
            {agent.codeAgent ? `Code ${agent.codeAgent}` : 'Sans code agent'}
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {/* ⚠ L'EFFECTIF EST DANS LE MÊME BLOC QUE LA MOYENNE. Les séparer
            laisserait l'écran annoncer « 4 j » à côté de « 24 opérations »
            alors que la mesure n'en couvre qu'une partie. */}
        <div
          data-testid="delai-moyen"
          className="mb-3 rounded-xl border border-brand-200 bg-surface px-4 py-3"
        >
          <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
            Temps mis avant remboursement
          </p>
          <p className="text-2xl font-bold tabular-nums text-ink">
            {delai.jours === null ? 'Jamais mesuré' : `${delai.jours} j en moyenne`}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted tabular-nums">
            {delai.jours === null
              ? `Aucune des ${delai.total} opérations n'a attendu de règlement.`
              : `Sur ${delai.mesurees} opération${delai.mesurees > 1 ? 's' : ''} mesurée${delai.mesurees > 1 ? 's' : ''} sur ${delai.total}.`}
          </p>
        </div>

        {etat === 'erreur' && (
          <div className="mb-3 rounded-xl border border-danger/40 bg-danger-soft px-4 py-3">
            <p className="text-sm text-ink">{erreur}</p>
            <button
              type="button"
              onClick={reessayer}
              className="mt-2 min-h-11 text-sm font-semibold text-brand-400 underline"
            >
              Réessayer
            </button>
          </div>
        )}

        <ul className="flex flex-col gap-2">
          {lignes.map((ligne) => (
            <LigneHistorique key={ligne.id} ligne={ligne} />
          ))}
        </ul>

        {encore && etat !== 'erreur' && (
          <button
            type="button"
            onClick={chargerPlus}
            className="mt-3 min-h-11 w-full rounded-xl border border-brand-200 bg-surface py-3 text-sm font-semibold text-ink"
          >
            Voir plus
          </button>
        )}
      </div>
    </div>
  )
}

export default PatronHistoriqueClient
