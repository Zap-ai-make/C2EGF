import { DealerRequestError } from '../errors.js'
import {
  readValidatedProfile,
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

const REJECTION_TYPES = Object.freeze({
  SETTLEMENT: 'settlement',
  COMPENSATION: 'compensation',
})

function assertExpectedRejectionType(settlement, rejectionType) {
  const isCompensation = settlement.method === COMPENSATION_METHOD

  if (rejectionType === REJECTION_TYPES.COMPENSATION && !isCompensation) {
    throw new DealerRequestError(
      'SETTLEMENT_NOT_FOUND',
      "Cette tranche n'est pas une compensation : utilisez le rejet de règlement.",
    )
  }

  if (rejectionType === REJECTION_TYPES.SETTLEMENT && isCompensation) {
    throw new DealerRequestError(
      'SETTLEMENT_NOT_FOUND',
      'Cette tranche est une compensation : utilisez le rejet de compensation.',
    )
  }
}

function buildRejectionAudit({
  rejectionType,
  txProfile,
  actorUid,
  actorStoreId,
  debtId,
  settlementId,
  settlement,
  rejectionReason,
  now,
}) {
  return {
    action: rejectionType === REJECTION_TYPES.COMPENSATION
      ? 'INTERNAL_DEBT_COMPENSATION_REJECTED'
      : 'INTERNAL_DEBT_SETTLEMENT_REJECTED',
    actorUid,
    actorEmail: txProfile.email ?? null,
    actorName: txProfile.name ?? null,
    actorRole: 'store_admin',
    actorStoreId,
    debtId,
    ...(rejectionType === REJECTION_TYPES.COMPENSATION
      ? { oppositeDebtId: settlement.oppositeDebtId ?? null }
      : { method: settlement.method ?? null }),
    settlementId,
    amount: settlement.amount ?? null,
    rejectionReason,
    createdAt: now,
  }
}

/**
 * Rejette une tranche de dette sans modifier la dette ni les stocks.
 * `rejectionType` est fixé par le handler public, jamais par le payload client.
 */
async function rejectInternalDebtHandler(
  request,
  { db, FieldValue, collaborationsEnabled },
  rejectionType,
) {
  const actorUid = validateAuthUid(request.auth?.uid)
  assertCollaborationsEnabled(collaborationsEnabled)

  const payload = validateInputPayload(request.data, ['debtId', 'settlementId', 'rejectionReason'])
  const debtId = validateDebtId(payload.debtId)
  const settlementId = validateSettlementId(payload.settlementId)
  const rejectionReason = validateRejectionReason(payload.rejectionReason)

  await readValidatedProfile(db, actorUid, validateProfileData)

  try {
    await db.runTransaction(async (t) => {
      const {
        profile: txProfile,
        validationResult: actorStoreId,
      } = await readValidatedProfile(db, actorUid, validateProfileData, t)

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

      assertExpectedRejectionType(settlement, rejectionType)
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
      t.set(auditRef, buildRejectionAudit({
        rejectionType,
        txProfile,
        actorUid,
        actorStoreId,
        debtId,
        settlementId,
        settlement,
        rejectionReason,
        now,
      }))
    })
  } catch (err) {
    if (err instanceof DealerRequestError) throw err
    throw new DealerRequestError('TRANSACTION_FAILED', 'La transaction a échoué. Veuillez réessayer.')
  }

  return { success: true, debtId, settlementId }
}

export function rejectInternalDebtSettlement(request, dependencies) {
  return rejectInternalDebtHandler(request, dependencies, REJECTION_TYPES.SETTLEMENT)
}

export function rejectInternalDebtCompensation(request, dependencies) {
  return rejectInternalDebtHandler(request, dependencies, REJECTION_TYPES.COMPENSATION)
}
