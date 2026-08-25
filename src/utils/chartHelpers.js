import { parsefrenchDate } from './helpers.js'

export const getDateFromTransaction = (transaction) => {
  return parsefrenchDate(transaction.date)
}

export const isToday = (date) => {
  if (!date) return false
  const today = new Date()
  return date.toDateString() === today.toDateString()
}

export const isThisMonth = (date) => {
  if (!date) return false
  const today = new Date()
  return date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear()
}

export const formatCurrency = (amount, currency = 'XOF') => {
  return parseFloat(amount || 0).toLocaleString('fr-FR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0
  })
}

export const calculatePercentage = (value, total) => {
  return total > 0 ? ((value / total) * 100).toFixed(1) : 0
}

export const createChartData = (data, colorMap) => {
  return Object.entries(data)
    .map(([name, value]) => ({
      name,
      value,
      color: colorMap[name] || '#6B7280'
    }))
    .filter(item => item.value > 0)
}

export const getTopTransaction = (transactions) => {
  if (!transactions.length) return null

  return transactions.reduce((max, transaction) => {
    const currentAmount = parseFloat(transaction.montant || 0)
    const maxAmount = parseFloat(max.montant || 0)
    return currentAmount > maxAmount ? transaction : max
  }, { montant: 0 })
}

export const getDaysSinceDate = (dateString) => {
  if (!dateString) return 0

  try {
    const date = new Date(dateString)
    const now = new Date()
    const diffTime = Math.abs(now - date)
    return Math.floor(diffTime / (1000 * 60 * 60 * 24))
  } catch {
    return 0
  }
}

export const formatDateRange = (days) => {
  return Array.from({ length: days }, (_, i) => {
    const date = new Date()
    date.setDate(date.getDate() - i)
    return date.toDateString()
  }).reverse()
}