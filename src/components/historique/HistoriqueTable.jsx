import { useTransactions } from '../../context/transactions.jsx'
import { useTheme } from '../../context/ThemeContext.jsx'
import { getClientName, formatTransactionDateTime } from '../../utils/helpers.js'
import { useWindowedRows } from '../../hooks/useWindowedRows.js'
import EmptyState from '../ui/EmptyState.jsx'
import { History } from 'lucide-react'

// Au-delà de ce nombre de lignes, on active le fenêtrage (virtualisation).
// En dessous, le rendu est strictement identique à l'historique (aucune régression).
const VIRTUALIZE_THRESHOLD = 60
// Hauteur de repli d'une ligne (px) tant que la mesure réelle n'est pas disponible.
const DEFAULT_ROW_HEIGHT = 49

function HistoriqueTable({ transactions = [] }) {
  const { getTransactionStyles } = useTransactions()
  const { themeClasses } = useTheme()
  const allTransactions = transactions

  const headers = [
    'Date & heure',
    'Client',
    'Type',
    'Réseau',
    'Code',
    'Montant',
    'Statut',
    'Utilisateur',
    'Email utilisateur'
  ]

  const borderClass = themeClasses.tableBorder
  const isVirtualized = allTransactions.length > VIRTUALIZE_THRESHOLD

  const { containerRef, rowRef, onScroll, startIndex, endIndex, topPad, bottomPad } =
    useWindowedRows({ itemCount: allTransactions.length, defaultRowHeight: DEFAULT_ROW_HEIGHT })

  // Une seule définition du markup de ligne, partagée par les deux branches.
  const renderRow = (transaction, index, ref) => {
    const styles = getTransactionStyles(transaction.type)
    return (
      <tr
        ref={ref}
        key={transaction.id || `${transaction.clientId || 'transaction'}-${transaction.date || index}-${index}`}
        className={`border-b border-line/60 ${styles.bgColor} ${styles.textColor}`}
      >
        <td className="whitespace-nowrap px-4 py-3 text-base">
          {formatTransactionDateTime(transaction)}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-base">
          {getClientName(transaction.client)}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-base font-medium tabular-nums">
          {transaction.type || '-'}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-base">
          {transaction.reseau || transaction.network || '-'}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-base">
          {transaction.code || '-'}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-base font-medium tabular-nums">
          {transaction.montant ? `${(Number(transaction.montant) || 0).toLocaleString('fr-FR')} FCFA` :
           transaction.amount ? `${transaction.amount} FCFA` : '-'}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-base">
          <span className="rounded bg-success-soft px-2 py-1 text-sm text-success">
            {transaction.statut || 'Validée'}
          </span>
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-base">
          {transaction.operatorName || transaction.userName || '-'}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-base">
          {transaction.operatorEmail || transaction.userEmail || '-'}
        </td>
      </tr>
    )
  }

  // Lignes à rendre : toute la liste (court) ou la seule fenêtre visible (long).
  const visibleRows = isVirtualized
    ? allTransactions.slice(startIndex, endIndex)
    : allTransactions

  if (allTransactions.length === 0) {
    return (
      <div className="mt-6">
        <EmptyState
          icon={History}
          title="Aucune transaction dans l'historique"
          message="Aucune opération ne correspond à la période et aux filtres choisis."
        />
      </div>
    )
  }

  return (
    <div className="mt-6">
      <div
        ref={containerRef}
        onScroll={isVirtualized ? onScroll : undefined}
        className={`overflow-x-auto ${isVirtualized ? 'overflow-y-auto max-h-[70vh]' : ''} rounded-lg border ${borderClass}`}
      >
        <table className="w-full border-collapse min-w-max">
          <thead className={isVirtualized ? 'sticky top-0 z-10' : ''}>
            <tr className={themeClasses.tableHeader}>
              {headers.map((header, index) => (
                <th
                  key={index}
                  className={`whitespace-nowrap px-4 py-3 text-left text-base font-medium ${themeClasses.text}`}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(
              <>
                {isVirtualized && topPad > 0 && (
                  <tr aria-hidden="true">
                    <td colSpan={headers.length} style={{ height: topPad, padding: 0, border: 'none' }} />
                  </tr>
                )}
                {visibleRows.map((transaction, i) =>
                  renderRow(transaction, startIndex + i, isVirtualized && i === 0 ? rowRef : undefined)
                )}
                {isVirtualized && bottomPad > 0 && (
                  <tr aria-hidden="true">
                    <td colSpan={headers.length} style={{ height: bottomPad, padding: 0, border: 'none' }} />
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default HistoriqueTable
