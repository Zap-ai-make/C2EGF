import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { firestoreService } from '../../services/firestore.js'
import { TABLE_HEADERS } from '../../constants'
import { chercherClients } from '../../utils/rechercheClients.js'
import TableRow from '../../components/TableRow.jsx'
import ErrorState from '../../components/ui/ErrorState.jsx'

// Ni l'un ni l'autre n'est arbitraire : au-delà, `chercherClients` replie des
// accents et découpe chaque fiche (NFD + regex + split) sur une base qui peut
// dépasser 15 000 lignes — l'afficher en entier bloquerait le rendu, pas
// seulement la recherche. 150 ms : assez court pour rester invisible à la
// frappe, assez long pour ne pas relancer le calcul à chaque caractère.
const AFFICHAGE_MAX = 50
const DEBOUNCE_MS = 150

/**
 * Le tableau des clients du réseau — l'écran d'accueil du patron.
 *
 * ⚠ CE N'EST PAS `ClientsTable`, ET C'EST VOULU. Celui-ci prend `onEdit`,
 *   `onImportClients` et `onAddClient`, lit `activeStore` dans `AuthContext`
 *   pour construire sa carte de boutiques, et monte `useExcelOperations`. Le
 *   patron n'a pas d'`activeStore`, et son espace est en lecture : importer un
 *   fichier Excel est une écriture. Ce qui est partagé, c'est la LIGNE
 *   (`TableRow`) et les COLONNES (`TABLE_HEADERS`) — pas l'enveloppe.
 *
 * ⚠ `onEdit` N'EST PAS PASSÉ, et c'est ce qui retire la cellule d'actions
 *   (TableRow, tâche 1). Onze en-têtes, onze cellules.
 *
 * ⚠ LA RECHERCHE PORTE SUR LA BASE ENTIÈRE, L'AFFICHAGE NON. `chercherClients`
 *   voit les 15 000+ fiches en mémoire — c'était l'argument de la tâche 3 et il
 *   survit. Mais rendre des milliers de lignes de DOM n'apporte rien : le
 *   patron cherche un nom ou un code, il ne parcourt pas. Affichage plafonné à
 *   `AFFICHAGE_MAX`, le reste annoncé plutôt que tu silencieusement coupé.
 */
function PatronClients() {
  const navigate = useNavigate()
  const [clients, setClients] = useState([])
  const [pret, setPret] = useState(false)
  const [erreur, setErreur] = useState(null)
  const [terme, setTerme] = useState('')
  const [termeDebounce, setTermeDebounce] = useState('')

  useEffect(() => {
    const onClients = (data) => {
      setClients(data)
      setPret(true)
      setErreur(null)
    }
    // Comme ClientsContext.jsx : `subscribeToAllClients` passe par
    // `normalizeSubscriptionObserver`, qui cherche `callback.onError`. Sans ce
    // crochet, un `permission-denied` ou une coupure de listener finit dans
    // `console.error` et rien n'atteint l'écran — qui reste bloqué sur
    // « Chargement… » pour toujours : le pire mode de défaillance possible
    // pour un écran qui ne sert qu'à trouver une fiche.
    onClients.onError = (err) => {
      setErreur(err?.message || 'Erreur de chargement.')
      setPret(true)
    }
    return firestoreService.subscribeToAllClients(onClients)
  }, [])

  useEffect(() => {
    const minuteur = setTimeout(() => setTermeDebounce(terme), DEBOUNCE_MS)
    return () => clearTimeout(minuteur)
  }, [terme])

  // ⚠ DEUX PLAFONDS, PAS UN SEUL RÉEMPLOI DE `filtrerClients`. Ce dernier ne
  //   rend qu'un tableau brut (contrat partagé avec `useClientsFilter.js` et
  //   verrouillé par TC-252) : il n'a ni plafond ni compte du reste. Le
  //   plafond avec recherche appelle directement `chercherClients(...,
  //   { maximum })`, qui rend déjà `reste` — le même appel que
  //   `ClientSearch.jsx`. Le plafond SANS recherche (afficher la base entière,
  //   mais pas plus de `AFFICHAGE_MAX` lignes) n'a pas d'équivalent partagé :
  //   aucun autre écran ne plafonne une liste non filtrée.
  const { affichees, total, reste } = useMemo(() => {
    if (termeDebounce.trim()) {
      const { resultats, total: totalTrouve, reste: resteTrouve } =
        chercherClients(clients, termeDebounce, { maximum: AFFICHAGE_MAX })
      return { affichees: resultats, total: totalTrouve, reste: resteTrouve }
    }
    const tranche = clients.slice(0, AFFICHAGE_MAX)
    return { affichees: tranche, total: clients.length, reste: Math.max(0, clients.length - tranche.length) }
  }, [clients, termeDebounce])

  const compteur = termeDebounce.trim()
    ? (reste > 0
        ? `${affichees.length} affichées sur ${total} correspondances`
        : `${total} ${total === 1 ? 'résultat' : 'résultats'}`)
    : (reste > 0
        ? `${affichees.length} affichées sur ${total.toLocaleString('fr-FR')} fiches`
        : `${total.toLocaleString('fr-FR')} fiches · tout le réseau`)

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="patron-clients">
      <div className="flex-none bg-brand-500 px-3 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
          <input
            type="search"
            value={terme}
            onChange={(e) => setTerme(e.target.value)}
            aria-label="Chercher un client"
            placeholder="Code agent, numéro, nom…"
            className="min-h-13 w-full rounded-xl bg-surface py-3 pl-11 pr-3 text-base text-ink placeholder:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          />
        </div>
      </div>

      {!erreur && (
        <p className="flex-none bg-canvas px-4 py-2 text-xs font-bold uppercase tracking-wider text-ink-muted tabular-nums">
          {compteur}
        </p>
      )}

      {erreur ? (
        <div className="px-4 py-3">
          <ErrorState message={erreur} />
        </div>
      ) : !pret ? (
        <p className="px-6 py-12 text-center text-ink-muted">Chargement…</p>
      ) : affichees.length === 0 ? (
        <p className="px-6 py-12 text-center text-ink-muted">
          {termeDebounce.trim()
            ? 'Rien trouvé. Vérifie le code agent, ou cherche par nom.'
            : 'Aucune fiche enregistrée pour le moment.'}
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto bg-surface">
          <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                {TABLE_HEADERS.map((header) => (
                  <th
                    key={header.key}
                    scope="col"
                    className={`sticky top-0 whitespace-nowrap border-b border-brand-200 bg-brand-100 px-4 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-brand-500 ${
                      // La colonne Nom reste visible quand on fait défiler vers
                      // la droite : sans elle, dix colonnes de chiffres
                      // n'appartiennent plus à personne. `header.key`, pas un
                      // index : `TABLE_HEADERS` est partagé, une réorganisation
                      // ne doit pas figer une colonne au hasard en silence.
                      // z-30 : ce `th` est à la fois sticky en haut ET à
                      // gauche (le coin), il doit rester au-dessus des autres
                      // `th` (z-20, sticky en haut seulement) qui, eux,
                      // doivent rester au-dessus du `td` Nom des lignes
                      // (z-10, sticky à gauche seulement — TableRow.jsx).
                      header.key === 'nom' ? 'left-0 z-30' : 'z-20'
                    } ${header.width}`}
                  >
                    {header.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {affichees.map((client, index) => (
                <TableRow
                  key={client.id}
                  client={client}
                  index={index}
                  nomFige
                  onHistorique={(c) => navigate(`/admin/clients/${c.id}/historique`)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default PatronClients
