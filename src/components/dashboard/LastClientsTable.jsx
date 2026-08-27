import { UserPlus } from 'lucide-react'
import { parsefrenchDate } from '../../utils/helpers.js'
import { CARTE } from '../../constants/dashboardTheme.js'

/**
 * Les derniers agents enrôlés.
 *
 * Le bloc portait deux dégradés, un carré bleu décoratif et un code agent en
 * orange vif — une pastille de couleur par colonne, dont aucune ne signifiait
 * quoi que ce soit. Tout passe aux jetons ; le seul accent conservé est la
 * graisse sur le code agent, qui est bien la clé d'identification d'un point de
 * vente.
 */

const CELLULE = 'px-4 py-3 text-sm text-ink-muted'

function LastClientsTable({ clients = [] }) {
  const derniers = clients.slice(-5).reverse()

  // Résumé de cinq lignes, pas le fichier complet : le numéro personnel et le
  // prénom en colonne propre appartiennent à l'écran « Clients ». Sept colonnes
  // dans une demi-largeur se tronquaient à droite.
  const colonnes = ['Agent', 'Code agent', 'Localité', 'Commercial', 'Ajouté le']

  const dateAffichee = (client) => {
    if (!client.dateAjout) return '—'
    const date = parsefrenchDate(client.dateAjout)
    return date ? date.toLocaleDateString('fr-FR') : '—'
  }

  return (
    <section aria-labelledby="titre-derniers-agents" className={`${CARTE} p-0`}>
      <h2
        id="titre-derniers-agents"
        className="flex items-center gap-2 border-b border-line px-6 py-5 text-lg font-bold text-ink"
      >
        <UserPlus aria-hidden="true" className="h-5 w-5 text-brand-500" />
        Derniers agents enrôlés
      </h2>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line bg-brand-50">
              {colonnes.map((colonne) => (
                <th
                  key={colonne}
                  scope="col"
                  className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted"
                >
                  {colonne}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {derniers.length === 0 ? (
              <tr>
                <td colSpan={colonnes.length} className="px-4 py-12 text-center">
                  <p className="text-sm text-ink-muted">
                    Aucun agent enrôlé pour le moment.
                  </p>
                  <p className="mt-1 text-sm text-ink-muted">
                    Les nouveaux comptes apparaîtront ici dès leur enregistrement.
                  </p>
                </td>
              </tr>
            ) : (
              derniers.map((client, index) => (
                <tr
                  key={client.id || `${client.nom || 'agent'}-${client.prenom || ''}-${index}`}
                  className="border-b border-line/60 transition-colors last:border-0 hover:bg-brand-50"
                >
                  <td className="px-4 py-3 text-sm font-medium text-ink">
                    {`${client.nom || ''} ${client.prenom || ''}`.trim() || '—'}
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold tabular-nums text-ink">
                    {client.orange || '—'}
                  </td>
                  <td className={CELLULE}>{client.localite || '—'}</td>
                  <td className={CELLULE}>{client.agentCommercial || '—'}</td>
                  <td className={`${CELLULE} whitespace-nowrap tabular-nums`}>
                    {dateAffichee(client)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default LastClientsTable
