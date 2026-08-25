/**
 * Handler de dépôt / retrait partenaire (sous-dealer hors boîte).
 *
 * Sémantique (sur l'inventaire du dealer, 1:1, en une transaction) :
 *   - deposit    (dépôt)  : stock −M et liquidité +M. Exige stock ≥ M.
 *   - withdrawal (retrait): stock +M et liquidité −M. Exige liquidité ≥ M.
 *   Aucune notification, aucune confirmation : opération immédiate, juste
 *   enregistrée dans l'historique. Le partenaire n'a aucun solde.
 *
 * db et FieldValue injectés (testabilité sans émulateur Functions).
 */

import { DealerRequestError } from '../errors.js'
import { validateAuthUid, validateInputPayload } from '../dealerRequests/shared.js'
import {
  validateTransferAmount,
  validatePartnerInput,
  validatePartnerOperation,
  validateDealerProfile,
  readDealerBalanceAmount,
  resolveTransferNetwork,
} from './shared.js'
import { DEALER_NETWORKS } from '../config/dealerProfile.js'

export async function createPartnerDepositHandler(request, { db, FieldValue, dealerNetworks = DEALER_NETWORKS }) {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const actorUid = validateAuthUid(request.auth?.uid)

  // ── 2. Payload ─────────────────────────────────────────────────────────────
  const payload = validateInputPayload(request.data, [
    'partnerId', 'partnerNom', 'partnerPrenom', 'partnerNumeroDA', 'partnerLocalite', 'amount', 'operation', 'network',
  ])
  const amount = validateTransferAmount(payload.amount)
  const operation = validatePartnerOperation(payload.operation) // 'deposit' | 'withdrawal'
  const partner = validatePartnerInput(payload)
  const network = resolveTransferNetwork(payload.network, dealerNetworks)
  const isWithdrawal = operation === 'withdrawal'

  // ── 3. Prévalidation profil dealer ─────────────────────────────────────────
  const profileSnap = await db.doc(`users/${actorUid}`).get()
  if (!profileSnap.exists) {
    throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
  }
  validateDealerProfile(profileSnap.data())

  // ── 4. Transaction : ajustement croisé stock ↔ liquidité ───────────────────
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
      const balData = balSnap.exists ? balSnap.data() : null
      const previousStock = readDealerBalanceAmount(balData, 'stock', network)
      const previousLiquidite = readDealerBalanceAmount(balData, 'liquidite', network)

      // Dépôt : −stock +liquidité (exige stock). Retrait : +stock −liquidité (exige liquidité).
      const previousDebit = isWithdrawal ? previousLiquidite : previousStock
      if (previousDebit < amount) {
        throw new DealerRequestError(
          'INSUFFICIENT_DEALER_BALANCE',
          isWithdrawal ? 'Liquidité insuffisante pour ce retrait partenaire.' : 'Stock insuffisant pour ce dépôt partenaire.'
        )
      }

      const newStock = isWithdrawal ? previousStock + amount : previousStock - amount
      const newLiquidite = isWithdrawal ? previousLiquidite - amount : previousLiquidite + amount
      const creditNew = isWithdrawal ? newStock : newLiquidite
      if (!Number.isSafeInteger(creditNew)) {
        throw new DealerRequestError('BALANCE_OVERFLOW', 'Le solde résultant dépasse la limite des entiers sûrs.')
      }
      const now = FieldValue.serverTimestamp()

      // Mise à jour atomique des deux champs (set+merge : préserve le document).
      t.set(balRef, {
        balances: { [network]: { stock: newStock, liquidite: newLiquidite } },
        updatedAt: now,
      }, { merge: true })

      // Enregistrement de l'opération (confirmée d'emblée — pas de flux de validation).
      const depositRef = db.collection('dealerPartnerDeposits').doc()
      t.set(depositRef, {
        dealerUid: actorUid,
        dealerName: txProfile.name ?? null,
        dealerEmail: txProfile.email ?? null,
        partnerId: partner.partnerId,
        partnerNom: partner.partnerNom,
        partnerPrenom: partner.partnerPrenom,
        partnerNumeroDA: partner.partnerNumeroDA,
        partnerLocalite: partner.partnerLocalite,
        operation,
        network,
        amount,
        previousStock,
        newStock,
        previousLiquidite,
        newLiquidite,
        status: 'confirmed',
        createdAt: now,
      })

      // Piste d'audit dealer
      const auditRef = db.collection(`dealerBalances/${actorUid}/auditLogs`).doc()
      t.set(auditRef, {
        action: 'PARTNER_DEPOSIT',
        operation,
        actorUid,
        actorEmail: txProfile.email ?? null,
        actorName: txProfile.name ?? null,
        actorRole: 'dealer',
        depositId: depositRef.id,
        partnerId: partner.partnerId,
        partnerNom: partner.partnerNom,
        network,
        amount,
        previousStock, newStock,
        previousLiquidite, newLiquidite,
        createdAt: now,
      })

      return { depositId: depositRef.id, operation, newStock, newLiquidite }
    })
  } catch (err) {
    if (err instanceof DealerRequestError) throw err
    throw new DealerRequestError('TRANSACTION_FAILED', 'La transaction a échoué. Veuillez réessayer.')
  }

  return { success: true, ...result }
}
