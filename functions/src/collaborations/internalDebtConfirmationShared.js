import { DealerRequestError } from '../errors.js'
import {
  readValidatedProfile,
  validateAuthUid,
  validateInputPayload,
  validateProfileData,
} from '../dealerRequests/shared.js'
import { assertCollaborationsEnabled } from './shared.js'
import {
  COMPENSATION_METHOD,
  SETTLEMENT_STATUSES,
  validateDebtId,
  validateSettlementAmount,
  validateSettlementId,
} from './debtShared.js'

export async function prepareInternalDebtConfirmation(
  request,
  { db, collaborationsEnabled },
) {
  const actorUid = validateAuthUid(request.auth?.uid)
  assertCollaborationsEnabled(collaborationsEnabled)

  const payload = validateInputPayload(request.data, ['debtId', 'settlementId'])
  const debtId = validateDebtId(payload.debtId)
  const settlementId = validateSettlementId(payload.settlementId)

  await readValidatedProfile(db, actorUid, validateProfileData)

  return { actorUid, debtId, settlementId }
}

async function readInternalDebtConfirmationContext(
  { db, transaction, actorUid, debtId, settlementId },
  { compensation },
) {
  const {
    profile: txProfile,
    validationResult: actorStoreId,
  } = await readValidatedProfile(db, actorUid, validateProfileData, transaction)

  const debtRef = db.doc(`internalDebts/${debtId}`)
  const debtSnap = await transaction.get(debtRef)
  if (!debtSnap.exists) {
    throw new DealerRequestError('DEBT_NOT_FOUND', 'Dette introuvable.')
  }
  const debt = debtSnap.data()
  if (debt.creditorStoreId !== actorStoreId) {
    throw new DealerRequestError('DEBT_STORE_MISMATCH', "Vous n'êtes pas autorisé sur cette dette.")
  }

  const settlementRef = db.doc(`internalDebts/${debtId}/settlements/${settlementId}`)
  const settlementSnap = await transaction.get(settlementRef)
  if (!settlementSnap.exists) {
    throw new DealerRequestError('SETTLEMENT_NOT_FOUND', 'Règlement introuvable.')
  }
  const settlement = settlementSnap.data()

  if (compensation && settlement.method !== COMPENSATION_METHOD) {
    throw new DealerRequestError(
      'SETTLEMENT_NOT_FOUND',
      "Cette tranche n'est pas une compensation : utilisez la confirmation de règlement.",
    )
  }
  if (!compensation && settlement.method === COMPENSATION_METHOD) {
    throw new DealerRequestError(
      'SETTLEMENT_NOT_FOUND',
      'Cette tranche est une compensation : utilisez la confirmation de compensation.',
    )
  }
  if (settlement.settlementStatus !== SETTLEMENT_STATUSES.DECLARED) {
    throw new DealerRequestError(
      'SETTLEMENT_NOT_DECLARED',
      "Ce règlement n'est pas en attente de confirmation.",
    )
  }

  return {
    actorStoreId,
    amount: validateSettlementAmount(settlement.amount),
    debt,
    debtRef,
    settlement,
    settlementRef,
    txProfile,
  }
}

export function readSettlementConfirmationContext(context) {
  return readInternalDebtConfirmationContext(context, { compensation: false })
}

export function readCompensationConfirmationContext(context) {
  return readInternalDebtConfirmationContext(context, { compensation: true })
}
