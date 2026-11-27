import { useContext } from 'react'
import { DemandesAgentContext } from '../context/demandesAgentContexte.js'

const SANS_DEMANDES = Object.freeze({
  demandes: Object.freeze([]),
  arrivees: new Map(),
  marquerVues: () => {},
})

/**
 * Les demandes des agents en attente pour la boutique de la caissière, telles
 * que l'écoute de la session les tient (`useEcouteDemandesAgent`, montée par
 * `DemandesAgentProvider`) : `{ demandes, arrivees, marquerVues }`.
 *
 * Hors du fournisseur, aucune demande — la caisse marche comme avant.
 */
export function useDemandesAgent() {
  return useContext(DemandesAgentContext) ?? SANS_DEMANDES
}
