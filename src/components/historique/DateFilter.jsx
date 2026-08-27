import { useState } from 'react'

function DateFilter({ onDateChange, onResetToToday }) {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const handleDateFromChange = (e) => {
    setDateFrom(e.target.value)
  }

  const handleDateToChange = (e) => {
    setDateTo(e.target.value)
  }

  const handleFilter = () => {
    if (isValidDateRange()) {
      onDateChange && onDateChange({ from: dateFrom, to: dateTo })
    }
  }

  const handleResetToToday = () => {
    setDateFrom('')
    setDateTo('')
    onResetToToday && onResetToToday()
  }


  // Validation des dates
  const isValidDateRange = () => {
    if (!dateFrom || !dateTo) return true
    return new Date(dateFrom) <= new Date(dateTo)
  }

  return (
    <div className="space-y-4">
      {/* Date Du */}
      <div>
        <label className="block text-lg font-semibold text-gray-700 mb-1">
          Du :
        </label>
        <input
          type="date"
          value={dateFrom}
          onChange={handleDateFromChange}
          className="w-full rounded border border-line bg-surface px-3 py-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        />
      </div>

      {/* Date Au */}
      <div>
        <label className="block text-lg font-semibold text-gray-700 mb-1">
          Au :
        </label>
        <input
          type="date"
          value={dateTo}
          onChange={handleDateToChange}
          className="w-full rounded border border-line bg-surface px-3 py-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        />
      </div>

      {/* Validation et actions */}
      {!isValidDateRange() && (
        <div className="text-sm text-danger">
          La date de fin doit être postérieure à la date de début
        </div>
      )}
      
      {/* Boutons d'action */}
      <div className="flex gap-2">
        <button
          onClick={handleFilter}
          disabled={!isValidDateRange() || (!dateFrom && !dateTo)}
          className="rounded bg-brand-500 px-6 py-2 font-medium text-white transition-colors hover:bg-brand-600 disabled:bg-gray-300 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          Filtrer
        </button>
        
        <button
          onClick={handleResetToToday}
          className="rounded border border-line bg-surface px-6 py-2 font-medium text-ink transition-colors hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          Aujourd'hui
        </button>
      </div>
    </div>
  )
}

export default DateFilter