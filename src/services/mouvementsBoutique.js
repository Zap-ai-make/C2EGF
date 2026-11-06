/**
 * mouvementsBoutique.js — le ravitaillement et son retour, par la file d'envoi quand
 * elle est là (lot G4b, docs/rester-dans-le-quota-gratuit.md §G4).
 *
 * Sans stock, aucune opération n'est possible : le ravitaillement doit passer sans
 * réseau. Le formulaire, le panneau et l'assistant envoient la même commande : celle
 * de `ravitaillement.js`. Le serveur reste le garant ; le réseau est porté ici pour
 * les soldes provisoires, il n'est jamais envoyé.
 *
 * Module à part, sans Firebase de plus que le service de commande : le formulaire se
 * monte seul dans ses tests.
 */

import { runStoreTransactionCommand } from './storeTransactionCommandService.js'
import { ENVOYEE, RAVITAILLEMENT, RETOUR } from './fileEnvoi.js'
import { NETWORK_OPTIONS } from '../utils/constants.js'

const TYPES = { replenish: RAVITAILLEMENT, returnReplenishment: RETOUR }

/**
 * @param {{ disponible?: boolean, soumettre?: Function } | null} envois la file (`useEnvois`) ;
 *   absente, l'appel direct d'avant la file reprend
 * @param {object} commande celle que `preparerRavitaillement` ou `preparerRetour` a rendue
 * @returns {Promise<{ statut: string }>} « envoyee » ou « en_attente »
 */
export async function envoyerMouvement(envois, commande) {
  if (envois?.disponible !== true) {
    await runStoreTransactionCommand(commande)
    return { statut: ENVOYEE }
  }
  return envois.soumettre(TYPES[commande.action], { commande, reseau: NETWORK_OPTIONS[0] })
}
