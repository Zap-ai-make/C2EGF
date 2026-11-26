import { runStoreTransactionCommand } from './storeTransactionCommandService.js'

/**
 * Les deux réponses de la caissière à une demande d'agent.
 *
 * ⚠ JAMAIS PAR LA FILE D'ENVOI. Une acceptation mise en file pendant que
 *   l'agent annule serait refusée après coup, une fois l'argent remis ou reçu.
 *   Sans réseau, l'appel échoue tout de suite et la caissière le lit :
 *   « Cette opération demande une connexion internet. »
 */

/** @param {'Validée'|'Non Terminées'} statut */
export const accepterDemandeAgent = (demandeId, statut) =>
  runStoreTransactionCommand({ action: 'acceptAgentRequest', demandeId, statut })

/**
 * Le remboursement que l'agent a lancé (contrat v10 §11.3) : un seul geste,
 * Accepter. Le serveur fait la tranche d'« Encaisser », ou crée la ligne
 * « Remb. siège », selon la nature de la demande ; aucun statut à choisir.
 */
export const accepterRemboursementAgent = (demandeId) =>
  runStoreTransactionCommand({ action: 'acceptAgentRequest', demandeId })

export const rejeterDemandeAgent = (demandeId) =>
  runStoreTransactionCommand({ action: 'rejectAgentRequest', demandeId })
