import { useMemo } from 'react'
import { parsefrenchDate } from '../utils/helpers.js'
import { useTodayTransactions } from './useTodayTransactions.js'
import { formatCurrency, getTopTransaction } from '../utils/chartHelpers.js'

/**
 * Hook central pour toutes les données du dashboard
 * @param {Array} clients - Liste des clients
 * @param {Array} allTransactions - Toutes les transactions
 * @returns {Object} Statistiques du dashboard
 */
export const useDashboardData = (clients, allTransactions) => {
  const todayTransactions = useTodayTransactions(allTransactions)

  return useMemo(() => {
    const today = new Date()
    const todayString = today.toDateString()
    const currentMonth = today.getMonth()
    const currentYear = today.getFullYear()

    // 1. totalClients - Nombre total de clients enregistrés
    const totalClients = clients.length

    // 2. monthlyClients - Clients enregistrés ce mois
    const monthlyClients = clients.filter(client => {
      if (!client.dateAjout) return false
      const clientDate = parsefrenchDate(client.dateAjout)
      if (!clientDate) return false
      return clientDate.getMonth() === currentMonth && clientDate.getFullYear() === currentYear
    }).length

    // 3. dailyClients - Clients ajoutés aujourd'hui
    const dailyClients = clients.filter(client => {
      if (!client.dateAjout) return false
      const clientDate = parsefrenchDate(client.dateAjout)
      if (!clientDate) return false
      return clientDate.toDateString() === todayString
    }).length

    // 4. topClient - Client avec la transaction la plus élevée du jour courant
    let topClient = "Aucune transaction aujourd'hui"
    if (todayTransactions.length > 0) {
      const topTransaction = getTopTransaction(todayTransactions)

      if (parseFloat(topTransaction.montant || 0) > 0 && topTransaction.client) {
        const amount = formatCurrency(topTransaction.montant)
        topClient = `${topTransaction.client.nom} ${topTransaction.client.prenom} (${amount})`
      }
    }

    return {
      totalClients,
      monthlyClients,
      dailyClients,
      topClient,
      todayTransactions // Export pour autres composants
    }
  }, [clients, todayTransactions])
}
