import DateFilter from '../components/historique/DateFilter'
import ClientSearch from '../components/historique/ClientSearch'
import HistoriqueTable from '../components/historique/HistoriqueTable'
import ActionButtons from '../components/historique/ActionButtons'
import DailyPagination from '../components/historique/DailyPagination'
import PageHeader from '../components/ui/PageHeader'
import { useHistoriqueFilters } from '../hooks/useHistoriqueFilters'

function Historique() {
  const {
    dateFilter: _dateFilter,
    searchTerm: _searchTerm,
    filteredTransactions,
    allTransactions,
    applyDateFilter,
    applySearchFilter,
    handleSearchChange,
    resetToToday,
    resetFilters
  } = useHistoriqueFilters()

  const handleDateChange = (dates) => {
    applyDateFilter(dates)
  }

  const handleSearch = (term) => {
    applySearchFilter(term)
  }

  const handleSearchInputChange = (term) => {
    handleSearchChange(term)
  }

  const handleResetToToday = () => {
    resetToToday()
  }

  const handleDaySelect = (dateRange) => {
    applyDateFilter(dateRange)
  }

  return (
    <div>
      <PageHeader title="Historique" />

      <div className="space-y-6">
        {/* Section des filtres */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-end">
            {/* Filtres de dates */}
            <div className="lg:col-span-1">
              <DateFilter
                onDateChange={handleDateChange}
                onResetToToday={handleResetToToday}
              />
            </div>

            {/* Recherche client */}
            <div className="lg:col-span-2">
              <ClientSearch
                onSearch={handleSearch}
                onSearchChange={handleSearchInputChange}
              />
            </div>
          </div>
        </div>

        {/* Navigation par jour */}
        <DailyPagination
          transactions={allTransactions}
          onDateSelect={handleDaySelect}
        />

        {/* Tableau des transactions */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <HistoriqueTable transactions={filteredTransactions} />

          {/* Boutons d'action */}
          <ActionButtons
            filteredTransactions={filteredTransactions}
            resetFilters={resetFilters}
          />
        </div>
      </div>
    </div>
  )
}

export default Historique