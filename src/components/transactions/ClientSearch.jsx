import { useState, useMemo, useEffect, useCallback } from 'react'
import { libelleAgent } from '../../utils/agentFields.js'
import { chercherClients } from '../../utils/rechercheClients.js'

/**
 * Ce que le menu montre. Au-delà, il DIT combien d'autres existent : une liste
 * coupée en silence est ce qui faisait croire qu'une fiche n'était pas en base.
 */
const RESULTATS_AFFICHES = 10

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

  /**
   * CINQ CHAMPS, et une recherche qui pardonne la façon d'écrire.
   *
   * Le filtre vit dans `utils/rechercheClients.js`, partagé avec la liste des
   * clients : accents pliés, numéros comparés en chiffres seuls, et TOUS LES
   * MOTS tapés doivent correspondre — ce qui fait enfin trouver « OUEDRAOGO
   * SALIF », le nom et le prénom étant deux champs distincts en base.
   */
  const { resultats: filteredClients, reste } = useMemo(
    () => chercherClients(clients, debouncedSearchTerm, { maximum: RESULTATS_AFFICHES }),
    [clients, debouncedSearchTerm],
  )

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
          {/* ⚠ UNE LISTE COUPÉE EN SILENCE SE LIT COMME UNE BASE INCOMPLÈTE.
              Dire le reste transforme « ce client n'y est pas » en « précisez ». */}
          {reste > 0 && (
            <li className="px-3 py-2 text-sm text-gray-600 bg-gray-50">
              … et {reste} autre{reste > 1 ? 's' : ''} : précisez le nom ou tapez le code agent entier.
            </li>
          )}
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
