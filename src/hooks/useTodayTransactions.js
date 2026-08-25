import { useMemo } from 'react'
import { parsefrenchDate } from '../utils/helpers.js'

/**
 * Hook pour filtrer les transactions d'aujourd'hui
 * @param {Array} allTransactions - Toutes les transactions
 * @returns {Array} Transactions d'aujourd'hui
 */
export const useTodayTransactions = (allTransactions) => {
  return useMemo(() => {
    if (!allTransactions?.length) return []

    const today = new Date().toDateString()

    return allTransactions.filter(transaction => {
      if (transaction.statut === 'Annulée') return false
      const transactionDate = parsefrenchDate(transaction.date)
      if (!transactionDate) return false
      return transactionDate.toDateString() === today
    })
  }, [allTransactions])
}