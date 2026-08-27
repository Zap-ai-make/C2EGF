import { useState, useMemo, useEffect, useCallback } from 'react'

function ClientSearch({ clients, onClientSelect, selectedClient, onManualCodeChange, resetToken = 0 }) {
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('')
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)

  // Debouncing du terme de recherche
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm)
    }, 300) // 300ms de délai

    return () => clearTimeout(timer)
  }, [searchTerm])

  const filteredClients = useMemo(() => {
    if (!debouncedSearchTerm.trim() || !clients || clients.length === 0) return []

    const term = debouncedSearchTerm.toLowerCase()
    return clients.filter(client => {
      if (!client) return false

      const nom = client.nom?.toLowerCase() || ''
      const prenom = client.prenom?.toLowerCase() || ''
      const orange = client.orange?.toLowerCase() || ''
      const numeroPersonnel = client.numeroPersonnel?.toLowerCase() || ''

      return nom.includes(term) ||
             prenom.includes(term) ||
             orange.includes(term) ||
             numeroPersonnel.includes(term)
    }).slice(0, 10)
  }, [clients, debouncedSearchTerm])

  const handleInputChange = useCallback((e) => {
    const nextValue = e.target.value
    setSearchTerm(nextValue)
    if (selectedClient) {
      onClientSelect(null)
    }
    onManualCodeChange?.(nextValue.trim())
    setIsDropdownOpen(true)
  }, [onClientSelect, onManualCodeChange, selectedClient])

  const handleClientSelect = (client) => {
    setSearchTerm(`${client.nom} ${client.prenom}`)
    onManualCodeChange?.('')
    setIsDropdownOpen(false)
    onClientSelect(client)
  }

  useEffect(() => {
    setSearchTerm('')
    setDebouncedSearchTerm('')
    setIsDropdownOpen(false)
  }, [resetToken])

  const formatClientDisplay = (client) => {
    const accounts = []
    if (client.orange) accounts.push(`Code agent: ${client.orange}`)
    
    return `${client.nom} ${client.prenom} | ${accounts.join(' | ')}`
  }

  return (
    <div className="relative">
      <input
        type="text"
        placeholder="Rechercher un client ou saisir le numéro/code agent..."
        value={searchTerm}
        onChange={handleInputChange}
        onFocus={() => searchTerm && setIsDropdownOpen(true)}
        onBlur={() => setTimeout(() => setIsDropdownOpen(false), 300)}
        className="w-full rounded border border-line bg-surface px-3 py-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      />
      
      {isDropdownOpen && filteredClients.length > 0 && (
        <ul className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded shadow-lg max-h-60 overflow-y-auto">
          {filteredClients.map((client) => (
            <li
              key={client.id}
              onMouseDown={(e) => {
                e.preventDefault()
                handleClientSelect(client)
              }}
              className="px-3 py-2 cursor-pointer hover:bg-gray-100 border-b border-gray-200 last:border-b-0"
            >
              <div className="text-sm text-gray-800">
                {formatClientDisplay(client)}
              </div>
            </li>
          ))}
        </ul>
      )}

      {isDropdownOpen && debouncedSearchTerm.trim() && filteredClients.length === 0 && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded shadow-lg">
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault()
              onClientSelect(null)
              onManualCodeChange?.(debouncedSearchTerm.trim())
              setIsDropdownOpen(false)
            }}
            className="w-full px-3 py-3 text-left hover:bg-gray-100"
          >
            <div className="text-sm font-semibold text-gray-800">
              Utiliser ce code sans client enregistré
            </div>
            <div className="text-sm text-gray-600">
              Code agent: {debouncedSearchTerm.trim()}
            </div>
          </button>
        </div>
      )}
    </div>
  )
}

export default ClientSearch
