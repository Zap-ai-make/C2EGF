import { useMemo } from 'react'
import { useAllTransactions } from './useAllTransactions.js'
import { useSimpleNetworkData } from './useSimpleNetworkData.js'
import {
  SEUIL_DECROCHAGE_JOURS,
  calculerBalance,
  calculerConcentration,
  calculerCouverture,
  calculerDecrochages,
  calculerFlux,
  projeterRupture,
} from '../utils/reseauStats.js'

/**
 * Assemble les statistiques du tableau de bord.
 *
 * Tout est calculé sur des données DÉJÀ en mémoire — le portefeuille reçu du
 * contexte clients, les opérations de `useAllTransactions`, les soldes de
 * `useSimpleNetworkData`. Ce hook n'ouvre aucun abonnement Firestore et n'en
 * coûte donc aucune lecture supplémentaire.
 *
 * `maintenant` est injectable : c'est ce qui rend l'ensemble testable sans
 * dépendre de l'heure d'exécution.
 *
 * @param {Array} clients      portefeuille d'agents enrôlés
 * @param {object} options     { seuilDecrochage, maintenant }
 */
export function useReseauStats(clients = [], options = {}) {
  const { seuilDecrochage = SEUIL_DECROCHAGE_JOURS, maintenant } = options
  const transactions = useAllTransactions()
  const { networkData } = useSimpleNetworkData()

  return useMemo(() => {
    const now = maintenant ?? new Date()

    const balance = calculerBalance(networkData, transactions, { maintenant: now })

    return {
      balance,
      projection: projeterRupture(balance, transactions, { maintenant: now }),
      couverture: calculerCouverture(clients, transactions, { maintenant: now }),
      decrochages: calculerDecrochages(clients, transactions, {
        seuilJours: seuilDecrochage,
        maintenant: now,
      }),
      concentration: calculerConcentration(transactions, clients, { maintenant: now }),
      flux: calculerFlux(transactions, { jours: 14, maintenant: now }),
    }
  }, [clients, transactions, networkData, seuilDecrochage, maintenant])
}
