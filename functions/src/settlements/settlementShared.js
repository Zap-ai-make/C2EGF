import { DealerRequestError } from '../errors.js'
import { readValidatedProfile } from '../dealerRequests/shared.js'
import { validateSettlementTransactionProfile } from './profileValidation.js'

export async function readSettlementTransactionContext({
  db,
  transaction,
  actorUid,
  preStoreId,
  draftId,
  settlementId,
}) {
  const {
    profile: txProfile,
    validationResult: storeId,
  } = await readValidatedProfile(
    db,
    actorUid,
    (profile) => validateSettlementTransactionProfile(profile, preStoreId),
    transaction,
  )

  const storeSnap = await transaction.get(db.doc(`stores/${storeId}`))
  if (!storeSnap.exists || storeSnap.data().active !== true) {
    throw new DealerRequestError('STORE_INACTIVE', 'Boutique désactivée.')
  }

  const draftRef = db.doc(`clients/${storeId}/drafts/${draftId}`)
  const settlementRef = db.doc(`clients/${storeId}/drafts/${draftId}/settlements/${settlementId}`)
  const balanceRef = db.doc(`clients/${storeId}/networkBalances/current`)
  const [draftSnap, settlementSnap, balanceSnap] = await transaction.getAll(
    draftRef,
    settlementRef,
    balanceRef,
  )

  return {
    txProfile,
    storeId,
    draftRef,
    settlementRef,
    balanceRef,
    draftSnap,
    settlementSnap,
    balanceSnap,
  }
}

export function readIdempotentSettlement({
  settlementSnap,
  amount,
  paymentMethod,
  action,
  actorUid,
  storeId,
  settlementId,
  recordConflict,
}) {
  if (!settlementSnap.exists) return null

  const existingData = settlementSnap.data()
  if (existingData.amount !== amount || existingData.paymentMethod !== paymentMethod) {
    recordConflict({
      event: 'SETTLEMENT_IDEMPOTENCY_CONFLICT',
      action,
      actorUid,
      storeId,
      settlementId,
      existingAmount: existingData.amount,
      newAmount: amount,
      existingMethod: existingData.paymentMethod,
      newMethod: paymentMethod,
    })
    throw new DealerRequestError(
      'IDEMPOTENCY_CONFLICT',
      'Cette opération a déjà été enregistrée avec des paramètres différents. Rechargez la page et réessayez.',
    )
  }

  return existingData
}

export function buildSettlementAuditBase({
  settlementId,
  draftId,
  storeId,
  draft,
  amount,
  paymentMethod,
  affectedNetwork,
  trimmedKey,
  actorUid,
  txProfile,
  paidAmount,
  refundedAmount,
  remainingAmount,
}) {
  return {
    settlementId,
    draftId,
    storeId,
    clientId: draft.clientId ?? null,
    amount,
    paymentMethod,
    effectiveNetwork: affectedNetwork,
    idempotencyKey: trimmedKey,
    actorUid,
    actorName: txProfile.name ?? null,
    actorRole: txProfile.role,
    actorStoreId: storeId,
    previousPaidAmount: paidAmount,
    previousRefundedAmount: refundedAmount,
    previousRemainingAmount: remainingAmount,
    previousSettlementStatus: draft.settlementStatus ?? null,
  }
}
