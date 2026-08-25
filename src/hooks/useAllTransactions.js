import { useMemo } from 'react'
import { useTransactions } from '../context/transactions.jsx'

/**
 * Hook pour combiner toutes les transactions sans doublons
 * @returns {Array} Toutes les transactions déduplicées
 */
export const useAllTransactions = () => {
  const { pendingTransactions, completedTransactions } = useTransactions()

  return useMemo(() => {
    const pending = pendingTransactions || []
    const completed = completedTransactions || []

    // Créer un Map pour éviter les doublons basés sur l'ID
    const transactionMap = new Map()

    // Ajouter les transactions en attente
    pending.forEach(transaction => {
      if (transaction.id) {
        transactionMap.set(transaction.id, transaction)
      }
    })

    // Ajouter les transactions complétées (écrase les doublons)
    completed.forEach(transaction => {
      if (transaction.id) {
        transactionMap.set(transaction.id, transaction)
      }
    })

    return Array.from(transactionMap.values())
  }, [pendingTransactions, completedTransactions])
}