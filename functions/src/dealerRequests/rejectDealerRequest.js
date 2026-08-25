/**
 * Handler de rejet d'une demande Dealer.
 *
 * Design :
 *   - Aucune modification de solde lors d'un rejet.
 *   - Le motif de rejet est obligatoire, normalisé (trim) et validé (3–500 chars).
 *   - db et FieldValue sont injectés en paramètre (testabilité sans emulateur Functions).
 *   - Toutes les erreurs métier lancent DealerRequestError ; index.js les convertit en HttpsError.
 *   - Une prévalidation rapide du profil hors transaction retourne une erreur tôt.
 *   - La validation autoritative du profil est répétée dans la transaction : si le profil
 *     change entre la prévalidation et le commit (active, role, storeId), la transaction
 *     est rejetée avec l'erreur appropriée.
 */

import { DealerRequestError } from '../errors.js'
import {
  validateAuthUid,
  validateInputPayload,
  validateRequestId,
  validateRejectionReason,
  validateRequestData,
  validateProfileData,
  buildAuditEntry,
} from './shared.js'
import { DEALER_NETWORKS } from '../config/dealerProfile.js'

export async function rejectDealerRequestHandler(request, { db, FieldValue, dealerNetworks = DEALER_NETWORKS }) {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const actorUid = validateAuthUid(request.auth?.uid)

  // ── 2. Validation de la forme du payload ───────────────────────────────────
  const payload = validateInputPayload(request.data, ['requestId', 'rejectionReason'])

  // ── 3. Validation des entrées ──────────────────────────────────────────────
  const requestId       = validateRequestId(payload.requestId)
  const rejectionReason = validateRejectionReason(payload.rejectionReason)

  // ── 4. Prévalidation rapide du profil acteur (retour d'erreur anticipé) ───
  const profileSnap = await db.doc(`users/${actorUid}`).get()
  if (!profileSnap.exists) {
    throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
  }
  validateProfileData(profileSnap.data())

  // ── 5. Transaction atomique ────────────────────────────────────────────────
  //   La validation du profil est RÉPÉTÉE dans la transaction (autoritative).
  //   Si active, role ou storeId changent entre la prévalidation et le commit,
  //   la transaction est rejetée avec l'erreur appropriée.
  try {
    await db.runTransaction(async (t) => {
      // Relecture authoritative du profil
      const profileRef    = db.doc(`users/${actorUid}`)
      const txProfileSnap = await t.get(profileRef)
      if (!txProfileSnap.exists) {
        throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
      }
      const txProfile    = txProfileSnap.data()
      const actorStoreId = validateProfileData(txProfile)

      const reqRef  = db.doc(`dealerRequests/${requestId}`)
      const reqSnap = await t.get(reqRef)

      if (!reqSnap.exists) {
        throw new DealerRequestError('REQUEST_NOT_FOUND', 'Demande introuvable.')
      }
      const reqData = reqSnap.data()

      // Valide : status pending, store match, type/réseau (∈ profil)/montant propres
      validateRequestData(reqData, actorStoreId, dealerNetworks)

      const now = FieldValue.serverTimestamp()

      // Mise à jour de la demande (aucun changement de solde au rejet)
      t.update(reqRef, {
        status:                  'rejected',
        updatedAt:               now,
        rejectedBy:              actorUid,
        rejectedAt:              now,
        rejectionReason,
        confirmedBy:             null,
        confirmedAt:             null,
        previousBalance:         null,
        newBalance:              null,
        previousLiquidityBalance: null,
        newLiquidityBalance:     null,
      })

      // Piste d'audit dans clients/{storeId}/auditLogs
      const auditRef = db.collection(`clients/${actorStoreId}/auditLogs`).doc()
      t.set(auditRef, buildAuditEntry({
        action:          'DEALER_REQUEST_REJECTED',
        actorUid,
        actorEmail:      txProfile.email  ?? null,
        actorName:       txProfile.name   ?? null,
        actorRole:       'store_admin',
        actorStoreId,
        requestId,
        reqData,
        previousBalance: null,
        newBalance:      null,
        rejectionReason,
        createdAt:       now,
      }))
    })
  } catch (err) {
    if (err instanceof DealerRequestError) throw err
    throw new DealerRequestError('TRANSACTION_FAILED', 'La transaction a échoué. Veuillez réessayer.')
  }

  return { success: true, requestId }
}
