import { useNetworkConfig } from '../context/NetworkConfigContext'

/**
 * Hook ultra-simple pour les cartes réseau
 *
 * RESPONSABILITÉS:
 * - Fournir les données des cartes (stock + liquidité par réseau)
 * - Permettre l'édition manuelle des stocks
 * - Calculer la liquidité totale
 *
 * AUCUNE LOGIQUE DE TRANSACTION ICI !
 */
export const useNetworkCards = () => {
  const { networkData, updateNetwork } = useNetworkConfig()

  // Calculer la liquidité totale (carte "Liquidité")
  const totalLiquidite = Object.values(networkData).reduce(
    (sum, data) => sum + (data.liquidite || 0),
    0
  )

  // Données finales avec la carte "Liquidité"
  const cardsData = {
    ...networkData,
    Liquidite: { liquidite: totalLiquidite }
  }

  // Fonction pour éditer le stock d'un réseau
  const updateStock = (network, amount) => updateNetwork(network, 'stock', amount)

  // === FONCTIONS SELON LE CAHIER DE CHARGES ===

  // Ajouter au stock d'un réseau (+)
  const addToStock = (network, amount) => {
    const currentStock = networkData[network]?.stock || 0
    return updateNetwork(network, 'stock', currentStock + amount)
  }

  // Retirer du stock d'un réseau (-)
  const removeFromStock = (network, amount) => {
    const currentStock = networkData[network]?.stock || 0
    return updateNetwork(network, 'stock', Math.max(0, currentStock - amount))
  }

  // Ajouter à la liquidité centrale (+)
  const addToLiquidity = (amount) => {
    // Ajouter à la liquidité de n'importe quel réseau (sera sommée dans totalLiquidite)
    // On utilise un réseau fictif pour stocker la liquidité centrale
    // Distribuer l'ajout sur le premier réseau disponible
    const firstNetwork = Object.keys(networkData)[0]
    if (firstNetwork) {
      const currentNetworkLiquidity = networkData[firstNetwork]?.liquidite || 0
      return updateNetwork(firstNetwork, 'liquidite', currentNetworkLiquidity + amount)
    }
    return Promise.resolve()
  }

  // Retirer de la liquidité centrale (-)
  const removeFromLiquidity = (amount) => {
    // Retirer de la liquidité en commençant par le réseau qui a le plus de liquidité
    let remainingToRemove = amount

    const updates = []

    for (const [network, data] of Object.entries(networkData)) {
      if (remainingToRemove <= 0) break

      const networkLiquidity = data.liquidite || 0
      if (networkLiquidity > 0) {
        const toRemoveFromThis = Math.min(networkLiquidity, remainingToRemove)
        updates.push(updateNetwork(network, 'liquidite', networkLiquidity - toRemoveFromThis))
        remainingToRemove -= toRemoveFromThis
      }
    }

    return Promise.all(updates)
  }

  // Obtenir le stock d'un réseau (pour validation formulaire)
  const getStock = (network) => {
    return networkData[network]?.stock || 0
  }

  // Obtenir la liquidité totale
  const getTotalLiquidity = () => {
    return totalLiquidite
  }

  const getLiquidite = () => {
    return totalLiquidite
  }

  // Éditer la liquidité totale (pour la carte Liquidité)
  const updateLiquidity = (newTotalAmount) => {
    const currentTotal = totalLiquidite
    const difference = newTotalAmount - currentTotal

    if (difference === 0) return Promise.resolve() // Aucun changement

    if (difference > 0) {
      return addToLiquidity(difference)
    }

    return removeFromLiquidity(Math.abs(difference))
  }

  // Formater un montant pour affichage
  const formatAmount = (amount) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'decimal',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount || 0)
  }

  return {
    cardsData,
    updateStock,
    updateLiquidity,
    addToStock,
    removeFromStock,
    addToLiquidity,
    removeFromLiquidity,
    getStock,
    getLiquidite,
    getTotalLiquidity,
    formatAmount
  }
}
