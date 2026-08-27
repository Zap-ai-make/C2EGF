import { useContext, useMemo } from 'react'
import { useClientsFilter } from '../hooks/useClientsFilter'
import { useExcelOperations } from '../hooks/useExcelOperations'
import { usePagination } from '../hooks/usePagination'
import { useToast } from '../hooks/useToast'
import { useTheme } from '../context/ThemeContext.jsx'
import { AuthContext } from '../context/AuthContext'
import { MONTH_OPTIONS, TABLE_HEADERS } from '../constants'
import TableRow from './TableRow'
import Pagination from './Pagination'
import Toast from './Toast'
import PageHeader from './ui/PageHeader'

function ClientsTable({ clients, onDelete, onEdit, onImportClients }) {
  const { toasts, showToast, removeToast } = useToast()
  const { activeStore } = useContext(AuthContext)
  const { searchTerm, setSearchTerm, selectedMonth, setSelectedMonth, filteredClients } = useClientsFilter(clients)
  const { paginatedData, ...paginationProps } = usePagination(filteredClients)

  // Construire la map des boutiques pour la résolution du nom dans l'export.
  // L'utilisateur ne voit que les clients de sa propre boutique (activeStore).
  const storesById = useMemo(() => {
    if (!activeStore?.id) return {}
    return { [activeStore.id]: activeStore }
  }, [activeStore])

  const { isImporting, fileInputRef, handleExport, handleImportClick, handleFileImport } = useExcelOperations(
    onImportClients,
    showToast,
    storesById
  )
  const { themeClasses } = useTheme()

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <PageHeader title="Liste des clients" />

      {/* Input caché pour l'import */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileImport}
        accept=".xlsx,.xlsm,.xls"
        style={{ display: 'none' }}
      />

      {/* Boutons d'action en haut */}
      <div className="flex flex-wrap justify-between gap-3 mb-6">
        <button 
          onClick={handleImportClick}
          disabled={isImporting}
          className="rounded border border-line bg-surface px-6 py-2 font-medium text-ink transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          {isImporting ? 'Import en cours...' : 'Importer (XLSM)'}
        </button>
        <button 
          onClick={() => handleExport(filteredClients)}
          className="rounded border border-line bg-surface px-6 py-2 font-medium text-ink transition-colors hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          Exporter (XLSM) {filteredClients.length > 0 && `(${filteredClients.length})`}
        </button>
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap gap-4 mb-6">
        <input
          type="text"
          placeholder="Rechercher nom, prénom, numéro/code agent, numéro personnel..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="min-w-64 flex-1 rounded border border-line px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        />
        <select
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="rounded border border-line px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          {MONTH_OPTIONS.map(month => (
            <option key={month} value={month}>{month}</option>
          ))}
        </select>
      </div>

      {/* Tableau */}
      <div className={`overflow-x-auto rounded-lg border ${themeClasses.tableBorder}`}>
        <table className="w-full border-collapse min-w-max">
          <thead>
            <tr className={`${themeClasses.tableHeader} border-b`}>
              {TABLE_HEADERS.map(header => (
                <th key={header.key} className={`whitespace-nowrap px-4 py-3 text-left text-base font-medium ${themeClasses.text} ${header.width}`}>
                  {header.label}
                </th>
              ))}
              <th className={`min-w-48 whitespace-nowrap px-4 py-3 text-center text-base font-medium ${themeClasses.text}`}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginatedData.map((client, index) => (
              <TableRow
                key={client.id}
                client={client}
                index={index}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </tbody>
        </table>
      </div>

      <Pagination {...paginationProps} />

      {filteredClients.length === 0 && (
        <p className="mt-4 text-center text-ink-muted">Aucun client trouvé.</p>
      )}

      {/* Toasts */}
      <div className="fixed top-0 right-0 z-50 space-y-2 p-4">
        {toasts.map(toast => (
          <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
            duration={toast.duration}
            onClose={() => removeToast(toast.id)}
          />
        ))}
      </div>
    </div>
  )
}

export default ClientsTable
