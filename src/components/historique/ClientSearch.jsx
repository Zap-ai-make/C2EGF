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
          className="w-full px-3 py-2 border-2 border-gray-300 rounded focus:outline-none focus:border-green-500 bg-white transition-colors"
        />
      </div>
      
      <button
        onClick={handleSearch}
        className="bg-green-500 hover:bg-green-600 text-white px-6 py-2 rounded font-medium transition-colors"
      >
        Rechercher
      </button>
    </div>
  )
}

export default ClientSearch