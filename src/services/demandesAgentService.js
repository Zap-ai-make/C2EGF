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

export const rejeterDemandeAgent = (demandeId) =>
  runStoreTransactionCommand({ action: 'rejectAgentRequest', demandeId })
