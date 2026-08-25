import { useState, useContext } from 'react'
import { ClientsContext } from '../../context/ClientsContext'

function HistoriqueFilters({ onFiltersChange, activeFilters }) {
  const { clients } = useContext(ClientsContext)
  const [startDate, setStartDate] = useState(activeFilters?.startDate || '')
  const [endDate, setEndDate] = useState(activeFilters?.endDate || '')
  const [selectedClient, setSelectedClient] = useState(activeFilters?.clientId || '')

  const handleFilterChange = () => {
    const filters = {}

    if (startDate || endDate) {
      filters.dateRange = {}
      if (startDate) filters.dateRange.start = new Date(startDate).toISOString()
      if (endDate) filters.dateRange.end = new Date(endDate).toISOString()
    }

    if (selectedClient) {
      filters.clientId = selectedClient
    }

    onFiltersChange(filters)
  }

  const clearFilters = () => {
    setStartDate('')
    setEndDate('')
    setSelectedClient('')
    onFiltersChange({})
  }

  const hasActiveFilters = startDate || endDate || selectedClient

  return (
    <div className="bg-white rounded-lg shadow-md p-6 mb-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">
        Filtrer l'historique
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Filtre par date de début */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Date de début
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Filtre par date de fin */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Date de fin
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Filtre par client */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Client
          </label>
          <select
            value={selectedClient}
            onChange={(e) => setSelectedClient(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Tous les clients</option>
            {clients.map(client => (
              <option key={client.id} value={client.id}>
                {client.nom}
              </option>
            ))}
          </select>
        </div>

        {/* Boutons d'action */}
        <div className="flex flex-col justify-end space-y-2">
          <button
            onClick={handleFilterChange}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md transition-colors text-sm"
          >
            Appliquer les filtres
          </button>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-md transition-colors text-sm"
            >
              Effacer les filtres
            </button>
          )}
        </div>
      </div>

      {/* Indicateur de filtres actifs */}
      {hasActiveFilters && (
        <div className="mt-4 p-3 bg-blue-50 border-l-4 border-blue-400">
          <div className="text-sm text-blue-700">
            <strong>Filtres actifs :</strong>
            {startDate && <span className="ml-2">Date début: {new Date(startDate).toLocaleDateString('fr-FR')}</span>}
            {endDate && <span className="ml-2">Date fin: {new Date(endDate).toLocaleDateString('fr-FR')}</span>}
            {selectedClient && (
              <span className="ml-2">
                Client: {clients.find(c => c.id === selectedClient)?.nom || 'Inconnu'}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default HistoriqueFilters