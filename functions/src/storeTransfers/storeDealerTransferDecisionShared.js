import { DealerRequestError } from '../errors.js'
import { readValidatedProfile } from '../dealerRequests/shared.js'
import {
  resolveTransferNetwork,
  transferBalanceField,
  validateDealerProfile,
  validateTransferType,
} from './shared.js'

export function prevalidateDealerTransferActor(db, actorUid) {
  return readValidatedProfile(db, actorUid, validateDealerProfile)
}

export async function readPendingStoreDealerTransfer({
  db,
  transaction,
  actorUid,
  transferId,
  dealerNetworks,
}) {
  const { profile } = await readValidatedProfile(
    db,
    actorUid,
    validateDealerProfile,
    transaction,
  )

  const transferRef = db.doc(`storeDealerTransfers/${transferId}`)
  const transferSnap = await transaction.get(transferRef)
  if (!transferSnap.exists) {
    throw new DealerRequestError('TRANSFER_NOT_FOUND', 'Transfert introuvable.')
  }
  const transfer = transferSnap.data()

  if (transfer.dealerUid !== actorUid) {
    throw new DealerRequestError('TRANSFER_DEALER_MISMATCH', 'Ce transfert ne vous est pas destiné.')
  }
  if (transfer.status !== 'pending') {
    throw new DealerRequestError('TRANSFER_NOT_PENDING', 'Ce transfert a déjà été traité.')
  }

  const field = transferBalanceField(validateTransferType(transfer.transferType))
  const network = resolveTransferNetwork(transfer.network, dealerNetworks)
  const amount = transfer.amount
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new DealerRequestError('INVALID_TRANSFER_DATA', 'Montant du transfert invalide.')
  }

  return { profile, transferRef, transfer, field, network, amount }
}
