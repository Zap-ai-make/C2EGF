/**
 * Handler d'approvisionnement de l'inventaire dealer.
 *
 * Sémantique :
 *   Le dealer déclare une quantité (stock OU liquidité) qu'il a acquise
 *   (ex. achat chez Orange). Son inventaire (dealerBalances/{uid}) est CRÉDITÉ.
 *   Sert aussi d'amorçage : le premier approvisionnement initialise le solde.
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

export async function replenishDealerInventoryHandler(request, { db, FieldValue, dealerNetworks = DEALER_NETWORKS }) {
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

  // ── 4. Transaction : crédit inventaire ─────────────────────────────────────
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
      const newBalance = previousBalance + amount
      if (!Number.isSafeInteger(newBalance)) {
        throw new DealerRequestError('BALANCE_OVERFLOW', 'Le solde résultant dépasse la limite des entiers sûrs.')
      }
      const now = FieldValue.serverTimestamp()

      // Set + merge : crée le document s'il n'existe pas, préserve l'autre champ.
      t.set(balRef, {
        balances: { [network]: { [resource]: newBalance } },
        updatedAt: now,
      }, { merge: true })

      const auditRef = db.collection(`dealerBalances/${actorUid}/auditLogs`).doc()
      t.set(auditRef, {
        action: 'DEALER_INVENTORY_REPLENISHED',
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
