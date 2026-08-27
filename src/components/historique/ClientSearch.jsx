import { useState, useEffect } from 'react'

function ClientSearch({ onSearch, onSearchChange }) {
  const [searchTerm, setSearchTerm] = useState('')

  // Recherche en temps réel avec debounce
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      onSearchChange && onSearchChange(searchTerm)
    }, 300) // Délai de 300ms pour éviter trop d'appels

    return () => clearTimeout(timeoutId)
  }, [searchTerm, onSearchChange])

  const handleInputChange = (e) => {
    setSearchTerm(e.target.value)
  }

  const handleSearch = () => {
    onSearch && onSearch(searchTerm)
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSearch()
    }
  }

  return (
    <div className="flex gap-4 items-end">
      <div className="flex-1">
        <input
          type="text"
          placeholder="Rechercher par nom, prénom ou code réseau..."
          value={searchTerm}
          onChange={handleInputChange}
          onKeyPress={handleKeyPress}
          className="w-full rounded border border-line bg-surface px-3 py-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        />
      </div>
      
      <button
        onClick={handleSearch}
        className="rounded bg-brand-500 px-6 py-2 font-medium text-white transition-colors hover:bg-brand-600 disabled:bg-gray-300 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        Rechercher
      </button>
    </div>
  )
}

export default ClientSearch