import { createContext } from 'react'

/**
 * Les demandes des agents en attente, écoutées une fois pour la session
 * boutique (`DemandesAgentProvider`) et lues par `useDemandesAgent`.
 *
 * ⚠ CE MODULE NE DÉPEND DE RIEN, ET C'EST VOULU. La barre de navigation le
 *   lit : s'il chargeait Firebase, chaque test qui la monte devrait le
 *   simuler. `null` hors du fournisseur.
 */
export const DemandesAgentContext = createContext(null)
