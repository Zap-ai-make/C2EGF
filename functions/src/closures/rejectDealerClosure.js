/**
 * Handler de rejet d'une clôture Dealer par le store_admin.
 *
 * Sémantique :
 *   Le store_admin rejette la clôture avec un motif obligatoire.
 *   Aucun solde n'est modifié.
 *   Une entrée d'audit est écrite dans clients/{storeId}/auditLogs.
 *
 * db et FieldValue sont injectés (testabilité sans émulateur Functions).
 */

import { DealerRequestError } from '../errors.js'
import {
  validateAuthUid,
  validateInputPayload,
  validateProfileData,
  validateRejectionReason,
} from '../dealerRequests/shared.js'

function validateClosureId(closureId) {
  if (!closureId || typeof closureId !== 'string' || !closureId.trim()) {
    throw new DealerRequestError('INVALID_CLOSURE_ID', 'Identifiant de clôture requis.')
  }
  return closureId.trim()
}

export async function rejectDealerClosureHandler(request, { db, FieldValue }) {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const actorUid = validateAuthUid(request.auth?.uid)

  // ── 2. Validation payload ─────────────────────────────────────────────────
  const payload         = validateInputPayload(request.data, ['closureId', 'rejectionReason'])
  const closureId       = validateClosureId(payload.closureId)
  const rejectionReason = validateRejectionReason(payload.rejectionReason)

  // ── 3. Prévalidation profil ───────────────────────────────────────────────
  const profileSnap = await db.doc(`users/${actorUid}`).get()
  if (!profileSnap.exists) {
    throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
  }
  validateProfileData(profileSnap.data())

  // ── 4. Transaction ────────────────────────────────────────────────────────
  try {
    await db.runTransaction(async (t) => {
      // Relecture authoritative du profil
      const txProfileSnap = await t.get(db.doc(`users/${actorUid}`))
      if (!txProfileSnap.exists) {
        throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
      }
      const txProfile    = txProfileSnap.data()
      const actorStoreId = validateProfileData(txProfile)

      // Lecture de la clôture
      const closureRef  = db.doc(`dealerClosures/${closureId}`)
      const closureSnap = await t.get(closureRef)
      if (!closureSnap.exists) {
        throw new DealerRequestError('CLOSURE_NOT_FOUND', 'Clôture introuvable.')
      }
      const closure = closureSnap.data()

      if (closure.targetStoreId !== actorStoreId) {
        throw new DealerRequestError('CLOSURE_STORE_MISMATCH', 'Cette clôture ne cible pas votre boutique.')
      }
      if (closure.status !== 'pending') {
        throw new DealerRequestError('CLOSURE_NOT_PENDING', 'Cette clôture a déjà été traitée.')
      }

      const now = FieldValue.serverTimestamp()

      t.update(closureRef, {
        status:          'rejected',
        updatedAt:       now,
        rejectedBy:      actorUid,
        rejectedAt:      now,
        rejectionReason,
        confirmedBy:     null,
        confirmedAt:     null,
      })

      const auditRef = db.collection(`clients/${actorStoreId}/auditLogs`).doc()
      t.set(auditRef, {
        action:                  'DEALER_CLOSURE_REJECTED',
        actorUid,
        actorEmail:              txProfile.email ?? null,
        actorName:               txProfile.name  ?? null,
        actorRole:               'store_admin',
        actorStoreId,
        closureId,
        dealerUid:               closure.dealerUid,
        dealerName:              closure.dealerName  ?? null,
        targetStoreId:           closure.targetStoreId,
        network:                 closure.network,
        businessDate:            closure.businessDate,
        declaredStockBalance:    closure.declaredStockBalance,
        declaredLiquidityBalance: closure.declaredLiquidityBalance,
        recordedStockBalance:    closure.recordedStockBalance,
        recordedLiquidityBalance: closure.recordedLiquidityBalance,
        stockDifference:         closure.stockDifference,
        liquidityDifference:     closure.liquidityDifference,
        reason:                  closure.reason ?? null,
        rejectionReason,
        createdAt:               now,
      })
    })
  } catch (err) {
    if (err instanceof DealerRequestError) throw err
    throw new DealerRequestError('TRANSACTION_FAILED', 'La transaction a échoué. Veuillez réessayer.')
  }

  return { success: true, closureId }
}
