/**
 * envois.js — ce que chaque opération de la file devient au serveur (lot G3b).
 *
 * Chaque appel porte de quoi être reconnu s'il est renvoyé : le `commandeId`
 * pour la saisie (lot G3a), l'`idempotencyKey` pour le règlement et le
 * remboursement, l'identifiant de la fiche pour le client. Voir `fileEnvoi.js`.
 */

import { runStoreTransactionCommand } from './storeTransactionCommandService.js'
import { addTransactionPayment, addTransactionRefund } from './settlementService.js'
import { firestoreService } from './firestore.js'
import { CLIENT, REGLEMENT, REMBOURSEMENT, SAISIE } from './fileEnvoi.js'

/** Le verrou qui empêche deux onglets du même compte d'envoyer en même temps. */
export function verrouillerEnvois(uid, locks = globalThis.navigator?.locks) {
  if (!locks?.request) return (fn) => fn()
  // `ifAvailable` : si un autre onglet envoie déjà, celui-ci n'attend pas son
  // tour. L'autre lit la file à chaque opération, il enverra aussi celles-ci.
  return (fn) => locks.request(`c2egf-envois-${uid}`, { ifAvailable: true }, (verrou) => (verrou ? fn() : undefined))
}

export async function executerEnvoi({ id, type, charge }) {
  if (type === SAISIE) {
    return runStoreTransactionCommand({ action: 'add', transaction: charge.transaction, commandeId: id })
  }
  if (type === REGLEMENT || type === REMBOURSEMENT) {
    const appel = type === REGLEMENT ? addTransactionPayment : addTransactionRefund
    const { draftId, amount, paymentMethod, idempotencyKey, agentCode } = charge
    return appel({ draftId, amount, paymentMethod, idempotencyKey, agentCode })
  }
  if (type === CLIENT) {
    return firestoreService.enregistrerClientEnvoye(id, charge.donnees)
  }
  throw Object.assign(new Error(`Opération inconnue : ${type}`), { code: 'ENVOI_INCONNU' })
}
