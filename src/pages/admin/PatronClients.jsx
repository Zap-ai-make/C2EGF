import { useEffect, useMemo, useState } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { firestoreService } from '../../services/firestore.js'
import { TABLE_HEADERS } from '../../constants'
import { chercherClients } from '../../utils/rechercheClients.js'
import TableRow from '../../components/TableRow.jsx'

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
 * ⚠ AUCUNE PAGINATION. Le gérant en a une parce que son écran sert aussi à
 *   parcourir ; le patron, lui, CHERCHE. Une pagination le forcerait à deviner
 *   dans quelle page dort la fiche qu'il a au téléphone — et la recherche,
 *   elle, porte sur la base entière parce qu'elle est entièrement en mémoire.
 */
function PatronClients() {
  const navigate = useNavigate()
  const [clients, setClients] = useState([])
  const [terme, setTerme] = useState('')

  // `flushSync` : le flux vient de Firestore, hors du cycle de rendu React —
  // sans lui, le lot « React 19 » applique la mise à jour à la prochaine
  // tâche plutôt qu'avant le prochain repaint, ce qui vaut aussi pour l'appel
  // synchrone que fait un test sur le callback capturé.
  useEffect(
    () => firestoreService.subscribeToAllClients((data) => flushSync(() => setClients(data))),
    [],
  )

  const resultats = useMemo(
    () => (terme.trim() ? chercherClients(clients, terme).resultats : clients),
    [clients, terme],
  )

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

      <p className="flex-none bg-canvas px-4 py-2 text-xs font-bold uppercase tracking-wider text-ink-muted tabular-nums">
        {terme.trim()
          ? `${resultats.length} ${resultats.length === 1 ? 'résultat' : 'résultats'}`
          : `${clients.length.toLocaleString('fr-FR')} fiches · tout le réseau`}
      </p>

      {resultats.length === 0 ? (
        <p className="px-6 py-12 text-center text-ink-muted">
          {terme.trim() ? 'Rien trouvé. Vérifie le code agent, ou cherche par nom.' : 'Chargement…'}
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto bg-surface">
          <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                {TABLE_HEADERS.map((header, i) => (
                  <th
                    key={header.key}
                    scope="col"
                    className={`sticky top-0 z-10 whitespace-nowrap border-b border-brand-200 bg-brand-100 px-4 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-brand-500 ${
                      // La colonne Nom reste visible quand on fait défiler vers
                      // la droite : sans elle, dix colonnes de chiffres
                      // n'appartiennent plus à personne.
                      i === 1 ? 'left-0 z-20' : ''
                    } ${header.width}`}
                  >
                    {header.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resultats.map((client, index) => (
                <TableRow
                  key={client.id}
                  client={client}
                  index={index}
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
