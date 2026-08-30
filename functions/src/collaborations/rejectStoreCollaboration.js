/**
 * Handler de rejet d'une collaboration.
 *
 * Mêmes contrôles d'acteur et de statut que la confirmation : seule la boutique
 * FOURNISSEUSE rejette, et seulement une demande encore `pending`.
 *
 * ⚠ AUCUN mouvement de solde, AUCUNE dette. Un rejet ne fait que clore la
 *   demande — c'est le pendant symétrique de la confirmation, en plus simple.
 *
 * Le motif est obligatoire (3 à 500 caractères) : la demandeuse doit comprendre
 * pourquoi son client n'a pas été servi.
 */

import { DealerRequestError } from '../errors.js'
import {
  validateAuthUid,
  validateInputPayload,
  validateProfileData,
  validateRejectionReason,
} from '../dealerRequests/shared.js'
import {
  assertCollaborationsEnabled,
  validateCollaborationId,
  COLLABORATION_STATUSES,
} from './shared.js'
import { COLLABORATIONS_ENABLED } from '../config/storeProfile.js'

export async function rejectStoreCollaborationHandler(
  request,
  { db, FieldValue, collaborationsEnabled = COLLABORATIONS_ENABLED },
) {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const actorUid = validateAuthUid(request.auth?.uid)

  // ── 2. Module ouvert ? ─────────────────────────────────────────────────────
  assertCollaborationsEnabled(collaborationsEnabled)

  // ── 3. Payload (allow-list) ────────────────────────────────────────────────
  const payload = validateInputPayload(request.data, ['collaborationId', 'rejectionReason'])
  const collaborationId = validateCollaborationId(payload.collaborationId)
  const rejectionReason = validateRejectionReason(payload.rejectionReason)

  // ── 4. Prévalidation profil ────────────────────────────────────────────────
  const profileSnap = await db.doc(`users/${actorUid}`).get()
  if (!profileSnap.exists) {
    throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
  }
  validateProfileData(profileSnap.data())

  // ── 5. Transaction ─────────────────────────────────────────────────────────
  try {
    await db.runTransaction(async (t) => {
      const txProfileSnap = await t.get(db.doc(`users/${actorUid}`))
      if (!txProfileSnap.exists) {
        throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
      }
      const txProfile = txProfileSnap.data()
      const actorStoreId = validateProfileData(txProfile)

      const collabRef = db.doc(`storeCollaborations/${collaborationId}`)
      const collabSnap = await t.get(collabRef)
      if (!collabSnap.exists) {
        throw new DealerRequestError('COLLABORATION_NOT_FOUND', 'Collaboration introuvable.')
      }
      const collab = collabSnap.data()

      if (collab.supplierStoreId !== actorStoreId) {
        throw new DealerRequestError(
          'COLLABORATION_STORE_MISMATCH',
          'Cette collaboration ne vous est pas destinée.',
        )
      }
      if (collab.status !== COLLABORATION_STATUSES.PENDING) {
        throw new DealerRequestError('COLLABORATION_NOT_PENDING', 'Cette collaboration a déjà été traitée.')
      }

      const now = FieldValue.serverTimestamp()

      t.update(collabRef, {
        status: COLLABORATION_STATUSES.REJECTED,
        rejectedBy: actorUid,
        rejectedAt: now,
        rejectionReason,
        updatedAt: now,
      })

      const auditRef = db.collection(`clients/${actorStoreId}/auditLogs`).doc()
      t.set(auditRef, {
        action: 'STORE_COLLABORATION_REJECTED',
        actorUid,
        actorEmail: txProfile.email ?? null,
        actorName: txProfile.name ?? null,
        actorRole: 'store_admin',
        actorStoreId,
        collaborationId,
        requestingStoreId: collab.requestingStoreId ?? null,
        supplierStoreId: actorStoreId,
        clientId: collab.clientId ?? null,
        network: collab.network ?? null,
        operationType: collab.operationType ?? null,
        amount: collab.amount ?? null,
        rejectionReason,
        createdAt: now,
      })
    })
  } catch (err) {
    if (err instanceof DealerRequestError) throw err
    throw new DealerRequestError('TRANSACTION_FAILED', 'La transaction a échoué. Veuillez réessayer.')
  }

  return { success: true, collaborationId }
}
