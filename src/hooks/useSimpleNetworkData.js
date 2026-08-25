import { useNetworkCards } from './useNetworkCards'
import { parseFcfaAmount } from '../utils/fcfaAmount.js'

/**
 * Hook de compatibilité pour maintenir l'interface existante
 *
 * SIMPLIFIÉ: Redirige vers useNetworkCards
 * Plus de logique complexe de transactions !
 */
export const useSimpleNetworkData = () => {
  const { cardsData, getStock, getLiquidite, formatAmount } = useNetworkCards()

  // Interface de compatibilité pour le formulaire
  const validateAmount = (network, amount, transactionType) => {
    const numericAmount = parseFcfaAmount(amount)
    const normalizedType = String(transactionType || '')
      .trim()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()

    if (numericAmount === null) {
      return {
        isValid: false,
        message: 'Le montant doit être supérieur à 0'
      }
    }

    // Pour les dépôts, vérifier uniquement le stock du réseau.
    // Les retraits sont contrôlés avec la liquidité dans TransactionForm.
    if (normalizedType === 'depot' || normalizedType === 'credit') {
      const networkStock = getStock(network)

      if (numericAmount > networkStock) {
        return {
          isValid: false,
          message: `Stock insuffisant pour ${network}. Disponible: ${formatAmount(networkStock)} FCFA`
        }
      }
    }

    return {
      isValid: true,
      message: ''
    }
  }

  const getFormattedStock = (network) => {
    return formatAmount(getStock(network))
  }

  return {
    networkData: cardsData,
    validateAmount,
    getStock,
    getLiquidite,
    getFormattedStock
  }
}
