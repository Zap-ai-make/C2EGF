import { DemandesAgentContext } from './demandesAgentContexte.js'
import { useEcouteDemandesAgent } from '../hooks/useEcouteDemandesAgent.js'

/**
 * Fournit les demandes des agents à toute la session boutique : UNE écoute,
 * que lisent le compteur de la barre et le tableau des non terminées, et qui
 * sonne à chaque arrivée quel que soit l'écran ouvert. Voir
 * `useEcouteDemandesAgent`.
 */
export function DemandesAgentProvider({ children }) {
  const valeur = useEcouteDemandesAgent()
  return <DemandesAgentContext.Provider value={valeur}>{children}</DemandesAgentContext.Provider>
}
