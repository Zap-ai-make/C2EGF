import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

function DailyPagination({ transactions, onDateSelect }) {
  const [currentPage, setCurrentPage] = useState(0)
  const daysPerPage = 7

  // Grouper les transactions par jour
  const transactionsByDay = useMemo(() => {
    const groups = {}
    
    transactions.forEach(transaction => {
      let dateKey
      if (transaction.date) {
        // Format français: "15/09/2025 14:30"
        const [datePart] = transaction.date.split(' ')
        if (datePart.includes('/')) {
          const [day, month, year] = datePart.split('/')
          const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
          dateKey = date.toISOString().split('T')[0] // Format YYYY-MM-DD
        } else {
          dateKey = new Date(transaction.date).toISOString().split('T')[0]
        }
      } else {
        dateKey = new Date().toISOString().split('T')[0]
      }
      
      if (!groups[dateKey]) {
        groups[dateKey] = []
      }
      groups[dateKey].push(transaction)
    })
    
    return groups
  }, [transactions])

  // Obtenir les jours triés par date (plus récent en premier)
  const sortedDays = useMemo(() => {
    return Object.keys(transactionsByDay)
      .sort((a, b) => new Date(b) - new Date(a))
      .map(dateKey => ({
        date: dateKey,
        displayDate: new Date(dateKey).toLocaleDateString('fr-FR'),
        count: transactionsByDay[dateKey].length
      }))
  }, [transactionsByDay])

  // Pagination des jours
  const totalPages = Math.ceil(sortedDays.length / daysPerPage)
  const startIndex = currentPage * daysPerPage
  const currentDays = sortedDays.slice(startIndex, startIndex + daysPerPage)

  const handleDayClick = (dateKey) => {
    const selectedDate = new Date(dateKey)
    const formattedDate = selectedDate.toISOString().split('T')[0]
    onDateSelect && onDateSelect({
      from: formattedDate,
      to: formattedDate
    })
  }

  const handlePreviousPage = () => {
    if (currentPage > 0) {
      setCurrentPage(currentPage - 1)
    }
  }

  const handleNextPage = () => {
    if (currentPage < totalPages - 1) {
      setCurrentPage(currentPage + 1)
    }
  }

  if (sortedDays.length === 0) {
    return (
      <div className="text-center text-gray-500 py-4">
        Aucune transaction disponible
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-gray-700">Navigation par jour</h3>
        <div className="flex gap-2">
          <button
            onClick={handlePreviousPage}
            disabled={currentPage === 0}
            className="inline-flex items-center gap-1.5 rounded border border-line bg-surface px-3 py-1 text-sm font-medium text-ink transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Précédent
          </button>
          <span className="px-3 py-1 text-sm text-gray-600">
            Page {currentPage + 1} sur {totalPages}
          </span>
          <button
            onClick={handleNextPage}
            disabled={currentPage >= totalPages - 1}
            className="inline-flex items-center gap-1.5 rounded border border-line bg-surface px-3 py-1 text-sm font-medium text-ink transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            Suivant
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
        {currentDays.map(({ date, displayDate, count }) => (
          <button
            key={date}
            onClick={() => handleDayClick(date)}
            className="rounded-lg border border-line p-3 text-center transition-colors hover:border-brand-400 hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <div className="text-sm font-medium text-gray-700">
              {displayDate}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {count} transaction{count > 1 ? 's' : ''}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

export default DailyPagination