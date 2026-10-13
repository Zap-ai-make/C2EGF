import { useState, useMemo } from 'react'
import { MONTHS } from '../constants'
import { filtrerClients } from '../utils/rechercheClients.js'

export const useClientsFilter = (clients) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedMonth, setSelectedMonth] = useState('Tous les mois')

  const filteredClients = useMemo(() => {
    // ⚠ LA MÊME RECHERCHE QUE LA BARRE DU FORMULAIRE DE TRANSACTION, et c'est
    //   le point : deux implémentations divergent, et l'opératrice qui trouve
    //   une fiche dans un écran sans la trouver dans l'autre conclut que le
    //   logiciel se trompe. Accents pliés, numéros en chiffres seuls, tous les
    //   mots tapés exigés — voir `utils/rechercheClients.js`.
    const correspondants = new Set(filtrerClients(clients, searchTerm))

    return clients.filter(client => {
      const matchesSearch = correspondants.has(client)

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