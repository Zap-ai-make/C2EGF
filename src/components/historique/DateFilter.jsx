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
          className="w-full px-3 py-2 border-2 border-gray-300 rounded focus:outline-none focus:border-green-500 bg-white transition-colors"
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
          className="w-full px-3 py-2 border-2 border-gray-300 rounded focus:outline-none focus:border-green-500 bg-white transition-colors"
        />
      </div>

      {/* Validation et actions */}
      {!isValidDateRange() && (
        <div className="text-red-600 text-sm">
          La date de fin doit être postérieure à la date de début
        </div>
      )}
      
      {/* Boutons d'action */}
      <div className="flex gap-2">
        <button
          onClick={handleFilter}
          disabled={!isValidDateRange() || (!dateFrom && !dateTo)}
          className="bg-green-500 hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-6 py-2 rounded font-medium transition-colors"
        >
          Filtrer
        </button>
        
        <button
          onClick={handleResetToToday}
          className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded font-medium transition-colors"
        >
          Aujourd'hui
        </button>
      </div>
    </div>
  )
}

export default DateFilter