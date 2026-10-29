export const formatCurrency = (amount, currency = 'XOF') => {
  return parseFloat(amount || 0).toLocaleString('fr-FR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0
  })
}

export const getTopTransaction = (transactions) => {
  if (!transactions.length) return null

  return transactions.reduce((max, transaction) => {
    const currentAmount = parseFloat(transaction.montant || 0)
    const maxAmount = parseFloat(max.montant || 0)
    return currentAmount > maxAmount ? transaction : max
  }, { montant: 0 })
}
