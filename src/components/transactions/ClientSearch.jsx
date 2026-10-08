import { useState, useMemo, useEffect, useCallback } from 'react'
import { valeursAgent, libelleAgent } from '../../utils/agentFields.js'

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

      // CINQ CHAMPS, pas quatre : le code agent et le numéro agent sont
      // désormais deux choses distinctes, et la caissière connaît parfois
      // l'une sans l'autre. `valeursAgent` les rend aussi bien d'une fiche
      // séparée que d'une fiche d'avant, donc chercher un ancien code
      // continue de trouver.
      const champs = [
        client.nom,
        client.prenom,
        client.numeroPersonnel,
        ...valeursAgent(client),
      ]

      return champs.some((champ) => String(champ ?? '').toLowerCase().includes(term))
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
    const agent = libelleAgent(client)
    return agent ? `${client.nom} ${client.prenom} | ${agent}` : `${client.nom} ${client.prenom}`
  }

  return (
    <div className="relative">
      <input
        type="text"
        placeholder="Nom, prénom, code agent, numéro agent ou numéro personnel…"
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
