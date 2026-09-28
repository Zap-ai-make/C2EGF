import { DealerRequestError } from '../errors.js'
import {
  readValidatedProfile,
  validateAuthUid,
  validateInputPayload,
} from '../dealerRequests/shared.js'
import { DEALER_NETWORKS } from '../config/dealerProfile.js'
import {
  financialCommandReceiptRef,
  readDealerBalanceAmount,
  replayFinancialCommand,
  resolveTransferNetwork,
  validateDealerProfile,
  validateFinancialCommandKey,
  validateInventoryResource,
  validateTransferAmount,
} from './shared.js'

function calculateInventoryBalance(action, previousBalance, amount) {
  if (action === 'replenish') {
    const newBalance = previousBalance + amount
    if (!Number.isSafeInteger(newBalance)) {
      throw new DealerRequestError('BALANCE_OVERFLOW', 'Le solde résultant dépasse la limite des entiers sûrs.')
    }
    return newBalance
  }

  const newBalance = previousBalance - amount
  if (newBalance < 0) {
    throw new DealerRequestError('INSUFFICIENT_DEALER_BALANCE', 'Solde dealer insuffisant pour cette diminution.')
  }
  return newBalance
}

async function runDealerInventoryCommand(
  request,
  { db, FieldValue, dealerNetworks = DEALER_NETWORKS },
  { action, auditAction },
) {
  const actorUid = validateAuthUid(request.auth?.uid)
  const payload = validateInputPayload(request.data, ['resource', 'amount', 'network', 'idempotencyKey'])
  const resource = validateInventoryResource(payload.resource)
  const amount = validateTransferAmount(payload.amount)
  const network = resolveTransferNetwork(payload.network, dealerNetworks)
  const idempotencyKey = validateFinancialCommandKey(payload.idempotencyKey)

  await readValidatedProfile(db, actorUid, validateDealerProfile)

  let result
  try {
    result = await db.runTransaction(async (t) => {
      const { profile } = await readValidatedProfile(db, actorUid, validateDealerProfile, t)
      const balanceRef = db.doc(`dealerBalances/${actorUid}`)
      const receiptRef = financialCommandReceiptRef(db, actorUid, action, idempotencyKey)
      const [balanceSnap, receiptSnap] = await t.getAll(balanceRef, receiptRef)
      const expected = { action, actorUid, network, resource, amount }

      if (receiptSnap.exists) return replayFinancialCommand(receiptSnap.data(), expected)

      const previousBalance = readDealerBalanceAmount(
        balanceSnap.exists ? balanceSnap.data() : null,
        resource,
        network,
      )
      const newBalance = calculateInventoryBalance(action, previousBalance, amount)
      const now = FieldValue.serverTimestamp()

      t.set(balanceRef, {
        balances: { [network]: { [resource]: newBalance } },
        updatedAt: now,
      }, { merge: true })

      const auditRef = db.collection(`dealerBalances/${actorUid}/auditLogs`).doc()
      t.set(auditRef, {
        action: auditAction,
        actorUid,
        actorEmail: profile.email ?? null,
        actorName: profile.name ?? null,
        actorRole: 'dealer',
        network,
        resource,
        amount,
        idempotencyKey,
        previousBalance,
        newBalance,
        createdAt: now,
      })

      const commandResult = { previousBalance, newBalance }
      t.set(receiptRef, { ...expected, result: commandResult, createdAt: now })
      return commandResult
    })
  } catch (err) {
    if (err instanceof DealerRequestError) throw err
    throw new DealerRequestError('TRANSACTION_FAILED', 'La transaction a échoué. Veuillez réessayer.')
  }

  return {
    success: true,
    resource,
    previousBalance: result.previousBalance,
    newBalance: result.newBalance,
    idempotent: result.idempotent ?? false,
  }
}

export function replenishDealerInventory(request, dependencies) {
  return runDealerInventoryCommand(request, dependencies, {
    action: 'replenish',
    auditAction: 'DEALER_INVENTORY_REPLENISHED',
  })
}

export function decreaseDealerInventory(request, dependencies) {
  return runDealerInventoryCommand(request, dependencies, {
    action: 'decrease',
    auditAction: 'DEALER_INVENTORY_DECREASED',
  })
}
