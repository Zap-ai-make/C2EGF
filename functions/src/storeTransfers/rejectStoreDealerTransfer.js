/**
 * Handler de rejet d'un transfert boutique → dealer par le dealer.
 *
 * Sémantique (sens unique) :
 *   Le dealer refuse le retour → le solde boutique débité à la création est
 *   RESTAURÉ. L'inventaire dealer ne bouge pas. Motif obligatoire (3–500 car.).
 *
 * db et FieldValue injectés (testabilité sans émulateur Functions).
 */

import { DealerRequestError } from '../errors.js'
import {
  validateAuthUid,
  validateInputPayload,
  validateRejectionReason,
} from '../dealerRequests/shared.js'
import {
  validateTransferId,
  validateDealerProfile,
  validateTransferType,
  transferBalanceField,
  readBalanceAmount,
  resolveTransferNetwork,
} from './shared.js'
import { DEALER_NETWORKS } from '../config/dealerProfile.js'

export async function rejectStoreDealerTransferHandler(request, { db, FieldValue, dealerNetworks = DEALER_NETWORKS }) {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const actorUid = validateAuthUid(request.auth?.uid)

  // ── 2. Payload ─────────────────────────────────────────────────────────────
  const payload = validateInputPayload(request.data, ['transferId', 'rejectionReason'])
  const transferId = validateTransferId(payload.transferId)
  const rejectionReason = validateRejectionReason(payload.rejectionReason)

  // ── 3. Prévalidation profil dealer ─────────────────────────────────────────
  const profileSnap = await db.doc(`users/${actorUid}`).get()
  if (!profileSnap.exists) {
    throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
  }
  validateDealerProfile(profileSnap.data())

  // ── 4. Transaction atomique : restauration du solde boutique ───────────────
  try {
    await db.runTransaction(async (t) => {
      const txProfileSnap = await t.get(db.doc(`users/${actorUid}`))
      if (!txProfileSnap.exists) {
        throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
      }
      const txProfile = txProfileSnap.data()
      validateDealerProfile(txProfile)

      const transferRef = db.doc(`storeDealerTransfers/${transferId}`)
      const transferSnap = await t.get(transferRef)
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
      // Réseau du transfert (persisté à la création), validé ∈ profil (défense en profondeur).
      const network = resolveTransferNetwork(transfer.network, dealerNetworks)
      const amount = transfer.amount
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw new DealerRequestError('INVALID_TRANSFER_DATA', 'Montant du transfert invalide.')
      }

      // Restauration du solde boutique (crédit du montant débité à la création)
      const balRef = db.doc(`clients/${transfer.storeId}/networkBalances/current`)
      const balSnap = await t.get(balRef)
      if (!balSnap.exists) {
        throw new DealerRequestError('BALANCE_NOT_FOUND', 'Document de soldes introuvable pour cette boutique.')
      }
      const previousStoreBalance = readBalanceAmount(balSnap.data(), field, network)
      const newStoreBalance = previousStoreBalance + amount
      if (!Number.isSafeInteger(newStoreBalance)) {
        throw new DealerRequestError('BALANCE_OVERFLOW', 'Le solde résultant dépasse la limite des entiers sûrs.')
      }
      const now = FieldValue.serverTimestamp()

      t.update(balRef, {
        [`balances.${network}.${field}`]: newStoreBalance,
        updatedAt: now,
      })

      t.update(transferRef, {
        status: 'rejected',
        updatedAt: now,
        rejectedBy: actorUid,
        rejectedAt: now,
        rejectionReason,
        confirmedBy: null,
        confirmedAt: null,
      })

      // Audit côté boutique (le solde y est restauré)
      const storeAuditRef = db.collection(`clients/${transfer.storeId}/auditLogs`).doc()
      t.set(storeAuditRef, {
        action: 'STORE_DEALER_TRANSFER_REJECTED',
        actorUid,
        actorEmail: txProfile.email ?? null,
        actorName: txProfile.name ?? null,
        actorRole: 'dealer',
        actorStoreId: transfer.storeId,
        transferId,
        dealerUid: actorUid,
        transferType: transfer.transferType,
        network,
        amount,
        previousBalance: previousStoreBalance,
        newBalance: newStoreBalance,
        rejectionReason,
        createdAt: now,
      })

      // Audit côté dealer (qui a rejeté)
      const dealerAuditRef = db.collection(`dealerBalances/${actorUid}/auditLogs`).doc()
      t.set(dealerAuditRef, {
        action: 'STORE_DEALER_TRANSFER_REJECTED',
        actorUid,
        actorEmail: txProfile.email ?? null,
        actorName: txProfile.name ?? null,
        actorRole: 'dealer',
        transferId,
        storeId: transfer.storeId,
        storeName: transfer.storeName ?? null,
        transferType: transfer.transferType,
        network,
        amount,
        rejectionReason,
        createdAt: now,
      })
    })
  } catch (err) {
    if (err instanceof DealerRequestError) throw err
    throw new DealerRequestError('TRANSACTION_FAILED', 'La transaction a échoué. Veuillez réessayer.')
  }

  return { success: true, transferId }
}
