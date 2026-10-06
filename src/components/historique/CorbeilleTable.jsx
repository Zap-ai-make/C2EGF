import { Trash2 } from 'lucide-react'
import { useTransactions } from '../../context/transactions.jsx'
import { useTheme } from '../../context/ThemeContext.jsx'
import { getClientName, formatTransactionDateTime, formatInstant } from '../../utils/helpers.js'
import EmptyState from '../ui/EmptyState.jsx'

const PROVENANCES = {
  draft: 'Non terminée',
  history: 'Historique',
}

/**
 * La corbeille — ce qui a été supprimé, des deux provenances, sans retour.
 *
 * UNE SEULE LISTE, ET C'EST LE POINT
 * ──────────────────────────────────
 * Une non terminée supprimée et une ligne d'historique supprimée atterrissent
 * ici côte à côte, triées par heure de suppression. Le gérant qui cherche ce
 * qu'il vient de perdre ne devrait pas avoir à se rappeler dans quel onglet il
 * l'a perdu. La colonne « Provenance » dit d'où la ligne venait, pour ceux qui
 * ont besoin de le savoir.
 *
 * AUCUN BOUTON, VOLONTAIREMENT
 * ────────────────────────────
 * Pas de « Restaurer ». Réinjecter un montant d'hier dans des cartes vidées
 * depuis par une clôture les rendrait fausses, et la clôture déjà écrite
 * deviendrait fausse à son tour — rétroactivement, sans que personne le voie.
 * La corbeille sert donc à RELIRE : les valeurs sont toutes là, et une saisie
 * refaite à la main prend dix secondes et laisse une trace propre.
 *
 * Pas de virtualisation ni de pagination non plus : si cette table est longue,
 * le problème n'est pas son rendu.
 */
function CorbeilleTable({ transactions = [] }) {
  const { getTransactionStyles } = useTransactions()
  const { themeClasses } = useTheme()

  const headers = ['Date & heure', 'Client', 'Type', 'Réseau', 'Montant', 'Provenance', 'Supprimée']

  if (transactions.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Trash2}
          title="La corbeille est vide"
          message="Les transactions supprimées, qu’elles viennent des non terminées ou de l’historique, apparaîtront ici."
        />
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className={`overflow-x-auto rounded-lg border ${themeClasses.tableBorder}`}>
        <table className="w-full border-collapse min-w-max">
          <thead>
            <tr className={themeClasses.tableHeader}>
              {headers.map((header) => (
                <th
                  key={header}
                  className={`whitespace-nowrap px-4 py-3 text-base font-medium ${themeClasses.text} ${
                    header === 'Montant' ? 'text-right' : 'text-left'
                  }`}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {transactions.map((transaction) => {
              const styles = getTransactionStyles(transaction.type)
              return (
                <tr
                  key={transaction.id}
                  className="border-b border-line/60"
                  data-testid="ligne-corbeille"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-base">
                    {formatTransactionDateTime(transaction)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-base">
                    {getClientName(transaction.client)}
                  </td>
                  <td className={`whitespace-nowrap px-4 py-3 text-base font-medium ${styles.textColor}`}>
                    {transaction.type || '-'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-base">
                    {transaction.reseau || '-'}
                  </td>
                  {/* Barré : le montant est lisible pour une resaisie, mais il
                      ne compte plus dans les soldes, et rien ne doit laisser
                      croire le contraire. */}
                  <td className="whitespace-nowrap px-4 py-3 text-right text-base tabular-nums text-ink-muted line-through">
                    {(Number(transaction.montant) || 0).toLocaleString('fr-FR')} FCFA
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-base">
                    <span className="inline-flex rounded-full border border-line px-2.5 py-0.5 text-xs font-medium text-ink-muted">
                      {PROVENANCES[transaction.origin] || 'Historique'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-ink-muted">
                    {formatInstant(transaction.deletedAt)}
                    {transaction.deletedByName ? ` · ${transaction.deletedByName}` : ''}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default CorbeilleTable
