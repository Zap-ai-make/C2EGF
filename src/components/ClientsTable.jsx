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
      <h2 className={`text-2xl font-bold ${themeClasses.text} mb-6 border-b-2 border-current pb-2`}>
        Liste des clients
      </h2>

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
          className="bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white px-6 py-2 rounded transition-colors"
        >
          {isImporting ? 'Import en cours...' : 'Importer (XLSM)'}
        </button>
        <button 
          onClick={() => handleExport(filteredClients)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded transition-colors"
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
          className="flex-1 min-w-64 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-green-500"
        />
        <select
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-green-500"
        >
          {MONTH_OPTIONS.map(month => (
            <option key={month} value={month}>{month}</option>
          ))}
        </select>
      </div>

      {/* Tableau */}
      <div className={`overflow-x-auto border ${themeClasses.tableBorder} rounded`}>
        <table className="w-full border-collapse min-w-max">
          <thead>
            <tr className={themeClasses.tableHeader}>
              {TABLE_HEADERS.map(header => (
                <th key={header.key} className={`border ${themeClasses.tableBorder} px-4 py-3 text-left text-base font-medium ${themeClasses.text} whitespace-nowrap ${header.width}`}>
                  {header.label}
                </th>
              ))}
              <th className={`border ${themeClasses.tableBorder} px-4 py-3 text-center text-base font-medium ${themeClasses.text} whitespace-nowrap min-w-48`}>Actions</th>
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
        <p className="text-center text-gray-500 mt-4">Aucun client trouvé.</p>
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
