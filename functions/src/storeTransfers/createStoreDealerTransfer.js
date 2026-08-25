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
import { validateAuthUid, validateInputPayload, validateProfileData } from '../dealerRequests/shared.js'
import {
  validateTransferType,
  validateTransferAmount,
  transferBalanceField,
  readBalanceAmount,
  resolveSingleDealer,
  resolveTransferNetwork,
} from './shared.js'
import { DEALER_NETWORKS } from '../config/dealerProfile.js'

export async function createStoreDealerTransferHandler(request, { db, FieldValue, dealerNetworks = DEALER_NETWORKS }) {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const actorUid = validateAuthUid(request.auth?.uid)

  // ── 2. Forme du payload (allow-list) ───────────────────────────────────────
  const payload = validateInputPayload(request.data, ['transferType', 'amount', 'network'])
  const transferType = validateTransferType(payload.transferType)
  const amount = validateTransferAmount(payload.amount)
  const network = resolveTransferNetwork(payload.network, dealerNetworks)
  const field = transferBalanceField(transferType)

  // ── 3. Prévalidation profil (store_admin actif avec storeId) ──────────────
  const profileSnap = await db.doc(`users/${actorUid}`).get()
  if (!profileSnap.exists) {
    throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
  }
  validateProfileData(profileSnap.data())

  // ── 4. Résolution du dealer unique (hors transaction : singleton stable) ──
  const dealer = await resolveSingleDealer(db)

  // ── 5. Transaction atomique : débit boutique + création du transfert ──────
  let result
  try {
    result = await db.runTransaction(async (t) => {
      // Relecture autoritative du profil
      const txProfileSnap = await t.get(db.doc(`users/${actorUid}`))
      if (!txProfileSnap.exists) {
        throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
      }
      const txProfile = txProfileSnap.data()
      const storeId = validateProfileData(txProfile)

      // Nom de boutique (dénormalisation) — best effort
      const storeSnap = await t.get(db.doc(`stores/${storeId}`))
      const storeName = storeSnap.exists ? (storeSnap.data().name ?? null) : null

      // Solde boutique + garde-fou solde suffisant
      const balRef = db.doc(`clients/${storeId}/networkBalances/current`)
      const balSnap = await t.get(balRef)
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
        previousBalance: previousStoreBalance,
        newBalance: newStoreBalance,
        createdAt: now,
      })

      return { transferId: transferRef.id, previousStoreBalance, newStoreBalance }
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
  }
}
