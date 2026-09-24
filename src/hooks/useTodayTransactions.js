import { useEffect, useMemo, useState } from 'react'
import {
  businessDateKey,
  millisecondsUntilNextBusinessDay,
  storedBusinessDateKey,
} from '../utils/businessDate.js'

/**
 * Hook pour filtrer les transactions d'aujourd'hui
 * @param {Array} allTransactions - Toutes les transactions
 * @returns {Array} Transactions d'aujourd'hui
 */
export const useTodayTransactions = (allTransactions) => {
  const [todayKey, setTodayKey] = useState(() => businessDateKey())

  useEffect(() => {
    const scheduleRollover = () => {
      const now = new Date()
      return setTimeout(() => {
        setTodayKey(businessDateKey())
        timeoutId = scheduleRollover()
      }, millisecondsUntilNextBusinessDay(now) + 25)
    }
    let timeoutId = scheduleRollover()
    return () => clearTimeout(timeoutId)
  }, [])

  return useMemo(() => {
    if (!allTransactions?.length) return []

    return allTransactions.filter(transaction => {
      if (transaction.statut === 'Annulée') return false
      if (!transaction.date) return false
      try {
        return storedBusinessDateKey(transaction.date) === todayKey
      } catch {
        return false
      }
    })
  }, [allTransactions, todayKey])
}
