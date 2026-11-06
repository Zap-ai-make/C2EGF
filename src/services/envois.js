/**
 * envois.js — ce que chaque opération de la file devient au serveur (lots G3b et
 * G4b).
 *
 * Chaque appel porte de quoi être reconnu s'il est renvoyé : le `commandeId`
 * pour les commandes (lots G3a et G4a), l'`idempotencyKey` pour le règlement et le
 * remboursement, l'identifiant de la fiche pour le client. Voir `fileEnvoi.js`.
 *
 * Il porte aussi l'âge de l'opération, jamais sa date : le serveur la situe sur sa
 * propre horloge (`functions/src/instantDeLaCaisse.js`). Le remboursement n'en a
 * pas besoin : il ne valide aucune ligne.
 */

import { runStoreTransactionCommand } from './storeTransactionCommandService.js'
import { addTransactionPayment, addTransactionRefund } from './settlementService.js'
import { firestoreService } from './firestore.js'
import {
  ANNULATION,
  CIBLE_NON_TERMINEE,
  CIBLE_RETOUR,
  CLIENT,
  CORRECTION,
  MODIFICATION,
  RAVITAILLEMENT,
  REGLEMENT,
  REMBOURSEMENT,
  RETOUR,
  SAISIE,
} from './fileEnvoi.js'

/** Le verrou qui empêche deux onglets du même compte d'envoyer en même temps. */
export function verrouillerEnvois(uid, locks = globalThis.navigator?.locks) {
  if (!locks?.request) return (fn) => fn()
  // `ifAvailable` : si un autre onglet envoie déjà, celui-ci n'attend pas son
  // tour. L'autre lit la file à chaque opération, il enverra aussi celles-ci.
  return (fn) => locks.request(`c2egf-envois-${uid}`, { ifAvailable: true }, (verrou) => (verrou ? fn() : undefined))
}

/** Ce qu'une annulation devient : la commande de la ligne qu'elle vise. */
function commandeAnnulation({ cible, cibleId }) {
  if (cible === CIBLE_NON_TERMINEE) return { action: 'trashDraft', draftId: cibleId }
  if (cible === CIBLE_RETOUR) return { action: 'trashReplenishmentReturn', returnId: cibleId }
  return { action: 'trashHistory', historyId: cibleId }
}

export async function executerEnvoi({ id, type, charge, creeLe }, maintenant = Date.now()) {
  const reconnue = { commandeId: id, ageMs: maintenant - creeLe }
  if (type === SAISIE) {
    return runStoreTransactionCommand({ action: 'add', transaction: charge.transaction, ...reconnue })
  }
  if (type === RAVITAILLEMENT || type === RETOUR) {
    return runStoreTransactionCommand({ ...charge.commande, ...reconnue })
  }
  if (type === MODIFICATION) {
    return runStoreTransactionCommand({ action: 'updateDraft', draftId: charge.draftId, updates: charge.updates, ...reconnue })
  }
  if (type === CORRECTION) {
    return runStoreTransactionCommand({ action: 'correctHistory', historyId: charge.historyId, updates: charge.updates, ...reconnue })
  }
  if (type === ANNULATION) {
    return runStoreTransactionCommand({ ...commandeAnnulation(charge), ...reconnue })
  }
  if (type === REGLEMENT || type === REMBOURSEMENT) {
    const { draftId, amount, paymentMethod, idempotencyKey, agentCode } = charge
    const appel = { draftId, amount, paymentMethod, idempotencyKey, agentCode }
    return type === REGLEMENT
      ? addTransactionPayment({ ...appel, ageMs: reconnue.ageMs })
      : addTransactionRefund(appel)
  }
  if (type === CLIENT) {
    return firestoreService.enregistrerClientEnvoye(id, charge.donnees)
  }
  throw Object.assign(new Error(`Opération inconnue : ${type}`), { code: 'ENVOI_INCONNU' })
}
