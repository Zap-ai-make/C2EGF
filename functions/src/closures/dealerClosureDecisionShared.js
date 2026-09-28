import { DealerRequestError } from '../errors.js'
import {
  readValidatedProfile,
  validateProfileData,
} from '../dealerRequests/shared.js'

export function validateClosureId(closureId) {
  if (!closureId || typeof closureId !== 'string' || !closureId.trim()) {
    throw new DealerRequestError('INVALID_CLOSURE_ID', 'Identifiant de clôture requis.')
  }
  return closureId.trim()
}

function buildClosureAudit({
  action,
  actorUid,
  actorStoreId,
  closureId,
  closure,
  profile,
  rejectionReason,
  createdAt,
}) {
  return {
    action,
    actorUid,
    actorEmail: profile.email ?? null,
    actorName: profile.name ?? null,
    actorRole: 'store_admin',
    actorStoreId,
    closureId,
    dealerUid: closure.dealerUid,
    dealerName: closure.dealerName ?? null,
    targetStoreId: closure.targetStoreId,
    network: closure.network,
    businessDate: closure.businessDate,
    declaredStockBalance: closure.declaredStockBalance,
    declaredLiquidityBalance: closure.declaredLiquidityBalance,
    recordedStockBalance: closure.recordedStockBalance,
    recordedLiquidityBalance: closure.recordedLiquidityBalance,
    stockDifference: closure.stockDifference,
    liquidityDifference: closure.liquidityDifference,
    reason: closure.reason ?? null,
    ...(rejectionReason === undefined ? {} : { rejectionReason }),
    createdAt,
  }
}

async function processDealerClosureDecision({
  actorUid,
  closureId,
  decision,
  rejectionReason,
  db,
  FieldValue,
}) {
  await readValidatedProfile(db, actorUid, validateProfileData)

  try {
    await db.runTransaction(async (t) => {
      const {
        profile,
        validationResult: actorStoreId,
      } = await readValidatedProfile(db, actorUid, validateProfileData, t)

      const closureRef = db.doc(`dealerClosures/${closureId}`)
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
      const isRejection = decision === 'rejected'

      t.update(closureRef, {
        status: decision,
        updatedAt: now,
        confirmedBy: isRejection ? null : actorUid,
        confirmedAt: isRejection ? null : now,
        rejectedBy: isRejection ? actorUid : null,
        rejectedAt: isRejection ? now : null,
        rejectionReason: isRejection ? rejectionReason : null,
      })

      const auditRef = db.collection(`clients/${actorStoreId}/auditLogs`).doc()
      t.set(auditRef, buildClosureAudit({
        action: isRejection ? 'DEALER_CLOSURE_REJECTED' : 'DEALER_CLOSURE_CONFIRMED',
        actorUid,
        actorStoreId,
        closureId,
        closure,
        profile,
        rejectionReason: isRejection ? rejectionReason : undefined,
        createdAt: now,
      }))
    })
  } catch (err) {
    if (err instanceof DealerRequestError) throw err
    throw new DealerRequestError('TRANSACTION_FAILED', 'La transaction a échoué. Veuillez réessayer.')
  }
}

export function confirmDealerClosure({ actorUid, closureId, db, FieldValue }) {
  return processDealerClosureDecision({
    actorUid,
    closureId,
    decision: 'confirmed',
    db,
    FieldValue,
  })
}

export function rejectDealerClosure({ actorUid, closureId, rejectionReason, db, FieldValue }) {
  return processDealerClosureDecision({
    actorUid,
    closureId,
    decision: 'rejected',
    rejectionReason,
    db,
    FieldValue,
  })
}
