/**
 * Handler de rejet d'une COMPENSATION — boutique créancière de D1.
 *
 * « Je préfère être payée. » La tranche passe `rejected`.
 *
 * ⚠ LES DEUX DETTES RESTENT INTACTES, et AUCUNE tranche miroir n'est écrite :
 *   le miroir n'existe que lorsqu'une compensation aboutit. Comme pour un
 *   règlement rejeté, le montant réservé sur les deux dettes redevient
 *   disponible, puisque seules les tranches `declared` comptent.
 */

import { DealerRequestError } from '../errors.js'
import {
  validateAuthUid,
  validateInputPayload,
  validateProfileData,
  validateRejectionReason,
} from '../dealerRequests/shared.js'
import { assertCollaborationsEnabled } from './shared.js'
import {
  validateDebtId,
  validateSettlementId,
  SETTLEMENT_STATUSES,
  COMPENSATION_METHOD,
} from './debtShared.js'
import { COLLABORATIONS_ENABLED } from '../config/storeProfile.js'

export async function rejectInternalDebtCompensationHandler(
  request,
  { db, FieldValue, collaborationsEnabled = COLLABORATIONS_ENABLED },
) {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const actorUid = validateAuthUid(request.auth?.uid)

  // ── 2. Module ouvert ? ─────────────────────────────────────────────────────
  assertCollaborationsEnabled(collaborationsEnabled)

  // ── 3. Payload (allow-list) ────────────────────────────────────────────────
  const payload = validateInputPayload(request.data, ['debtId', 'settlementId', 'rejectionReason'])
  const debtId = validateDebtId(payload.debtId)
  const settlementId = validateSettlementId(payload.settlementId)
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

      const debtSnap = await t.get(db.doc(`internalDebts/${debtId}`))
      if (!debtSnap.exists) {
        throw new DealerRequestError('DEBT_NOT_FOUND', 'Dette introuvable.')
      }
      const debt = debtSnap.data()
      if (debt.creditorStoreId !== actorStoreId) {
        throw new DealerRequestError('DEBT_STORE_MISMATCH', "Vous n'êtes pas autorisé sur cette dette.")
      }

      const settlementRef = db.doc(`internalDebts/${debtId}/settlements/${settlementId}`)
      const settlementSnap = await t.get(settlementRef)
      if (!settlementSnap.exists) {
        throw new DealerRequestError('SETTLEMENT_NOT_FOUND', 'Règlement introuvable.')
      }
      const settlement = settlementSnap.data()
      if (settlement.method !== COMPENSATION_METHOD) {
        throw new DealerRequestError(
          'SETTLEMENT_NOT_FOUND',
          "Cette tranche n'est pas une compensation : utilisez le rejet de règlement.",
        )
      }
      if (settlement.settlementStatus !== SETTLEMENT_STATUSES.DECLARED) {
        throw new DealerRequestError(
          'SETTLEMENT_NOT_DECLARED',
          "Ce règlement n'est pas en attente de confirmation.",
        )
      }

      const now = FieldValue.serverTimestamp()

      t.update(settlementRef, {
        settlementStatus: SETTLEMENT_STATUSES.REJECTED,
        rejectedBy: actorUid,
        rejectedAt: now,
        rejectionReason,
      })

      const auditRef = db.collection(`clients/${actorStoreId}/auditLogs`).doc()
      t.set(auditRef, {
        action: 'INTERNAL_DEBT_COMPENSATION_REJECTED',
        actorUid,
        actorEmail: txProfile.email ?? null,
        actorName: txProfile.name ?? null,
        actorRole: 'store_admin',
        actorStoreId,
        debtId,
        oppositeDebtId: settlement.oppositeDebtId ?? null,
        settlementId,
        amount: settlement.amount ?? null,
        rejectionReason,
        createdAt: now,
      })
    })
  } catch (err) {
    if (err instanceof DealerRequestError) throw err
    throw new DealerRequestError('TRANSACTION_FAILED', 'La transaction a échoué. Veuillez réessayer.')
  }

  return { success: true, debtId, settlementId }
}
