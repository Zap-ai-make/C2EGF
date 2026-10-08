import { useState, useMemo } from 'react'
import { MONTHS } from '../constants'
import { valeursAgent } from '../utils/agentFields.js'

export const useClientsFilter = (clients) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedMonth, setSelectedMonth] = useState('Tous les mois')

  const filteredClients = useMemo(() => {
    const search = searchTerm.trim().toLowerCase()
    return clients.filter(client => {
      // Recherche sur : nom, prénom, code agent, numéro agent et numéro
      // personnel. `valeursAgent` rend les deux champs d'une fiche séparée
      // COMME d'une fiche d'avant — chercher un ancien code continue de marcher.
      // Champs potentiellement absents → coalescer en chaîne vide avant toLowerCase().
      const matchesSearch = !search || [
        client.nom,
        client.prenom,
        client.numeroPersonnel,
        ...valeursAgent(client),
      ].some(field => String(field ?? '').toLowerCase().includes(search))

      let matchesMonth = true
      if (selectedMonth !== 'Tous les mois') {
        const selectedMonthNumber = MONTHS[selectedMonth]
        if (selectedMonthNumber && client.dateAjout) {
          const dateParts = client.dateAjout.split('/')
          if (dateParts.length === 3) {
            const clientMonth = dateParts[1]
            matchesMonth = clientMonth === selectedMonthNumber
          } else {
            matchesMonth = false
          }
        }
      }
      
      return matchesSearch && matchesMonth
    })
  }, [clients, searchTerm, selectedMonth])

  return {
    searchTerm,
    setSearchTerm,
    selectedMonth,
    setSelectedMonth,
    filteredClients
  }
}