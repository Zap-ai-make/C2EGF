/**
 * Handler de diminution de l'inventaire dealer.
 *
 * Sémantique :
 *   Le dealer retire une quantité (stock OU liquidité) de son inventaire
 *   (dealerBalances/{uid}) — correction ou sortie. Symétrique de
 *   replenishDealerInventory, mais en SOUSTRACTION.
 *   Blocage sous zéro : le solde ne peut jamais devenir négatif
 *   (INSUFFICIENT_DEALER_BALANCE), aucune écriture dans ce cas.
 *
 * Aucun autre solde n'est touché. db et FieldValue injectés (testabilité).
 */

import { DealerRequestError } from '../errors.js'
import { validateAuthUid, validateInputPayload } from '../dealerRequests/shared.js'
import {
  validateDealerProfile,
  validateInventoryResource,
  validateTransferAmount,
  readDealerBalanceAmount,
  resolveTransferNetwork,
} from './shared.js'
import { DEALER_NETWORKS } from '../config/dealerProfile.js'

export async function decreaseDealerInventoryHandler(request, { db, FieldValue, dealerNetworks = DEALER_NETWORKS }) {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const actorUid = validateAuthUid(request.auth?.uid)

  // ── 2. Payload ─────────────────────────────────────────────────────────────
  const payload = validateInputPayload(request.data, ['resource', 'amount', 'network'])
  const resource = validateInventoryResource(payload.resource) // 'stock' | 'liquidite'
  const amount = validateTransferAmount(payload.amount)
  const network = resolveTransferNetwork(payload.network, dealerNetworks)

  // ── 3. Prévalidation profil dealer ─────────────────────────────────────────
  const profileSnap = await db.doc(`users/${actorUid}`).get()
  if (!profileSnap.exists) {
    throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
  }
  validateDealerProfile(profileSnap.data())

  // ── 4. Transaction : débit inventaire (blocage sous zéro) ──────────────────
  let result
  try {
    result = await db.runTransaction(async (t) => {
      const txProfileSnap = await t.get(db.doc(`users/${actorUid}`))
      if (!txProfileSnap.exists) {
        throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
      }
      const txProfile = txProfileSnap.data()
      validateDealerProfile(txProfile)

      const balRef = db.doc(`dealerBalances/${actorUid}`)
      const balSnap = await t.get(balRef)
      const previousBalance = readDealerBalanceAmount(balSnap.exists ? balSnap.data() : null, resource, network)
      const newBalance = previousBalance - amount
      if (newBalance < 0) {
        throw new DealerRequestError('INSUFFICIENT_DEALER_BALANCE', 'Solde dealer insuffisant pour cette diminution.')
      }
      const now = FieldValue.serverTimestamp()

      // Set + merge : préserve l'autre champ (stock ↔ liquidite).
      t.set(balRef, {
        balances: { [network]: { [resource]: newBalance } },
        updatedAt: now,
      }, { merge: true })

      const auditRef = db.collection(`dealerBalances/${actorUid}/auditLogs`).doc()
      t.set(auditRef, {
        action: 'DEALER_INVENTORY_DECREASED',
        actorUid,
        actorEmail: txProfile.email ?? null,
        actorName: txProfile.name ?? null,
        actorRole: 'dealer',
        network,
        resource,
        amount,
        previousBalance,
        newBalance,
        createdAt: now,
      })

      return { previousBalance, newBalance }
    })
  } catch (err) {
    if (err instanceof DealerRequestError) throw err
    throw new DealerRequestError('TRANSACTION_FAILED', 'La transaction a échoué. Veuillez réessayer.')
  }

  return { success: true, resource, previousBalance: result.previousBalance, newBalance: result.newBalance }
}
