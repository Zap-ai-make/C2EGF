export const NETWORK_CONFIG = {
  Orange: {
    name: 'Orange',
    color: '#FF6B35',
    bgLight: 'bg-orange-50',
    bgDark: 'bg-orange-100',
    border: 'border-orange-200',
    text: 'text-orange-800',
    textLight: 'text-orange-600',
    gradient: 'from-orange-50 to-orange-100'
  },
  Moov: {
    name: 'Moov',
    color: '#1E88E5',
    bgLight: 'bg-blue-50',
    bgDark: 'bg-blue-100',
    border: 'border-blue-200',
    text: 'text-blue-800',
    textLight: 'text-blue-600',
    gradient: 'from-blue-50 to-blue-100'
  },
  Telecel: {
    name: 'Telecel',
    color: '#8E24AA',
    bgLight: 'bg-purple-50',
    bgDark: 'bg-purple-100',
    border: 'border-purple-200',
    text: 'text-purple-800',
    textLight: 'text-purple-600',
    gradient: 'from-purple-50 to-purple-100'
  },
  Coris: {
    name: 'Coris',
    color: '#FFB300',
    bgLight: 'bg-yellow-50',
    bgDark: 'bg-yellow-100',
    border: 'border-yellow-200',
    text: 'text-yellow-800',
    textLight: 'text-yellow-600',
    gradient: 'from-yellow-50 to-yellow-100'
  },
  Sank: {
    name: 'Sank',
    color: '#E53E3E',
    bgLight: 'bg-red-50',
    bgDark: 'bg-red-100',
    border: 'border-red-200',
    text: 'text-red-800',
    textLight: 'text-red-600',
    gradient: 'from-red-50 to-red-100'
  },
  Liquidite: {
    name: 'Liquidité',
    color: '#38A169',
    bgLight: 'bg-green-50',
    bgDark: 'bg-green-100',
    border: 'border-green-200',
    text: 'text-green-800',
    textLight: 'text-green-600',
    gradient: 'from-green-50 to-green-100'
  }
}

export const formatAmount = (amount) => {
  if (!amount || amount === 0) return '0'

  const formatted = new Intl.NumberFormat('fr-FR', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(Math.abs(amount))

  return amount < 0 ? `-${formatted}` : formatted
}

/**
 * Le montant et la ligne qui le qualifie, pour une carte de solde.
 *
 * Le libellé portait l'unité : « Liquidité FCFA », « Stock FCFA ». Sur la carte
 * de liquidité, dont le titre est déjà « Liquidité », la ligne répétait donc le
 * nom puis l'unité — et l'unité figure désormais en exposant à côté du montant,
 * là où on la lit une fois. La ligne dit maintenant ce que le solde EST.
 */
export const formatAmountWithCurrency = (amount, isLiquidityCard = false) => {
  const formattedAmount = formatAmount(amount)
  const label = isLiquidityCard ? 'Espèces' : 'Stock'
  return { amount: formattedAmount, label }
}