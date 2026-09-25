/**
 * Handler de création d'un transfert boutique → dealer (retour de stock/liquidité).
 *
 * Sémantique (sens unique) :
 *   La boutique renvoie UNE ressource au dealer. Le solde boutique est DÉBITÉ
 *   immédiatement (au clic). Le solde dealer ne bouge qu'à la confirmation.
 *   Un rejet restaurera le solde boutique.
 *
 * db et FieldValue injectés (testabilité sans émulateur Functions).
 */

import { DealerRequestError } from '../errors.js'
import {
  readValidatedProfile,
  validateAuthUid,
  validateInputPayload,
  validateProfileData,
} from '../dealerRequests/shared.js'
import {
  validateTransferType,
  validateTransferAmount,
  transferBalanceField,
  readBalanceAmount,
  resolveSingleDealer,
  resolveTransferNetwork,
  validateFinancialCommandKey,
  financialCommandReceiptRef,
  replayFinancialCommand,
} from './shared.js'
import { DEALER_NETWORKS } from '../config/dealerProfile.js'

export async function createStoreDealerTransferHandler(request, { db, FieldValue, dealerNetworks = DEALER_NETWORKS }) {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const actorUid = validateAuthUid(request.auth?.uid)

  // ── 2. Forme du payload (allow-list) ───────────────────────────────────────
  const payload = validateInputPayload(request.data, ['transferType', 'amount', 'network', 'idempotencyKey'])
  const transferType = validateTransferType(payload.transferType)
  const amount = validateTransferAmount(payload.amount)
  const network = resolveTransferNetwork(payload.network, dealerNetworks)
  const idempotencyKey = validateFinancialCommandKey(payload.idempotencyKey)
  const field = transferBalanceField(transferType)

  // ── 3. Prévalidation profil (store_admin actif avec storeId) ──────────────
  const { validationResult: preStoreId } = await readValidatedProfile(
    db,
    actorUid,
    validateProfileData,
  )
  const preStoreSnap = await db.doc(`stores/${preStoreId}`).get()
  if (!preStoreSnap.exists || preStoreSnap.data()?.active !== true) {
    throw new DealerRequestError('STORE_INACTIVE', 'Cette boutique est inactive.')
  }

  const receiptRef = financialCommandReceiptRef(db, actorUid, 'storeTransfer', idempotencyKey)
  const expectedIntent = { action: 'storeTransfer', actorUid, storeId: preStoreId, transferType, network, amount }
  const existingReceipt = await receiptRef.get()
  if (existingReceipt.exists) {
    const replay = replayFinancialCommand(existingReceipt.data(), expectedIntent)
    return { success: true, ...replay }
  }

  // ── 4. Résolution du dealer unique (hors transaction : singleton stable) ──
  const dealer = await resolveSingleDealer(db)

  // ── 5. Transaction atomique : débit boutique + création du transfert ──────
  let result
  try {
    result = await db.runTransaction(async (t) => {
      // Relecture autoritative du profil
      const {
        profile: txProfile,
        validationResult: storeId,
      } = await readValidatedProfile(db, actorUid, validateProfileData, t)

      const storeRef = db.doc(`stores/${storeId}`)
      const balRef = db.doc(`clients/${storeId}/networkBalances/current`)
      const [storeSnap, balSnap, receiptSnap] = await t.getAll(storeRef, balRef, receiptRef)
      if (!storeSnap.exists || storeSnap.data()?.active !== true) {
        throw new DealerRequestError('STORE_INACTIVE', 'Cette boutique est inactive.')
      }
      const storeName = storeSnap.data().name ?? null

      const expected = { action: 'storeTransfer', actorUid, storeId, transferType, network, amount }
      if (receiptSnap.exists) return replayFinancialCommand(receiptSnap.data(), expected)

      // Solde boutique + garde-fou solde suffisant
      if (!balSnap.exists) {
        throw new DealerRequestError('BALANCE_NOT_FOUND', 'Document de soldes introuvable pour cette boutique.')
      }
      const previousStoreBalance = readBalanceAmount(balSnap.data(), field, network)
      if (previousStoreBalance < amount) {
        throw new DealerRequestError('INSUFFICIENT_STORE_BALANCE', 'Solde insuffisant pour ce transfert.')
      }
      const newStoreBalance = previousStoreBalance - amount
      const now = FieldValue.serverTimestamp()

      // Débit boutique (chemin pointé pour préserver les autres champs/réseaux)
      t.update(balRef, {
        [`balances.${network}.${field}`]: newStoreBalance,
        updatedAt: now,
      })

      // Document de transfert (champs sensibles imposés par le backend)
      const transferRef = db.collection('storeDealerTransfers').doc()
      t.set(transferRef, {
        storeId,
        storeName,
        storeAdminUid: actorUid,
        dealerUid: dealer.uid,
        dealerName: dealer.name,
        transferType,
        network,
        amount,
        idempotencyKey,
        status: 'pending',
        previousStoreBalance,
        newStoreBalance,
        previousDealerBalance: null,
        newDealerBalance: null,
        createdAt: now,
        updatedAt: now,
        confirmedBy: null,
        confirmedAt: null,
        rejectedBy: null,
        rejectedAt: null,
        rejectionReason: null,
      })

      // Piste d'audit boutique
      const auditRef = db.collection(`clients/${storeId}/auditLogs`).doc()
      t.set(auditRef, {
        action: 'STORE_DEALER_TRANSFER_CREATED',
        actorUid,
        actorEmail: txProfile.email ?? null,
        actorName: txProfile.name ?? null,
        actorRole: 'store_admin',
        actorStoreId: storeId,
        transferId: transferRef.id,
        dealerUid: dealer.uid,
        transferType,
        network,
        amount,
        idempotencyKey,
        previousBalance: previousStoreBalance,
        newBalance: newStoreBalance,
        createdAt: now,
      })

      const commandResult = { transferId: transferRef.id, previousStoreBalance, newStoreBalance }
      t.set(receiptRef, { ...expected, result: commandResult, createdAt: now })
      return commandResult
    })
  } catch (err) {
    if (err instanceof DealerRequestError) throw err
    throw new DealerRequestError('TRANSACTION_FAILED', 'La transaction a échoué. Veuillez réessayer.')
  }

  return {
    success: true,
    transferId: result.transferId,
    previousStoreBalance: result.previousStoreBalance,
    newStoreBalance: result.newStoreBalance,
    idempotent: result.idempotent ?? false,
  }
}
