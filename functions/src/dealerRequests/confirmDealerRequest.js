/**
 * Handler de confirmation d'une demande Dealer.
 *
 * Design :
 *   - db et FieldValue sont injectés en paramètre (testabilité sans emulateur Functions).
 *   - Toutes les erreurs métier lancent DealerRequestError ; index.js les convertit en HttpsError.
 *   - Une prévalidation rapide du profil hors transaction retourne une erreur tôt.
 *   - La validation autoritative du profil est répétée dans la transaction : si le profil
 *     change entre la prévalidation et le commit (active, role, storeId), la transaction
 *     est rejetée avec l'erreur appropriée.
 *   - La transaction lit la demande ET le solde atomiquement.
 *   - La mise à jour du solde utilise le chemin pointé (balances.Orange.<field>)
 *     pour préserver les autres réseaux et champs.
 *
 * Région choisie : europe-west1 (proximité géographique Afrique de l'Ouest / FCFA).
 */

import { DealerRequestError } from '../errors.js'
import {
  validateAuthUid,
  validateInputPayload,
  validateRequestId,
  validateRequestData,
  validateProfileData,
  readCurrentBalance,
  getBalanceField,
  buildAuditEntry,
} from './shared.js'
import { readDealerBalanceAmount } from '../storeTransfers/shared.js'
import { DEALER_NETWORKS } from '../config/dealerProfile.js'

export async function confirmDealerRequestHandler(request, { db, FieldValue, dealerNetworks = DEALER_NETWORKS }) {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const actorUid = validateAuthUid(request.auth?.uid)

  // ── 2. Validation de la forme du payload ───────────────────────────────────
  const payload = validateInputPayload(request.data, ['requestId'])

  // ── 3. Validation des entrées ──────────────────────────────────────────────
  const requestId = validateRequestId(payload.requestId)

  // ── 4. Prévalidation rapide du profil acteur (retour d'erreur anticipé) ───
  const profileSnap = await db.doc(`users/${actorUid}`).get()
  if (!profileSnap.exists) {
    throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
  }
  validateProfileData(profileSnap.data())

  // ── 5. Transaction atomique ────────────────────────────────────────────────
  //   La validation du profil est RÉPÉTÉE dans la transaction (autoritative).
  //   Si active, role ou storeId changent entre la prévalidation et le commit,
  //   la transaction est rejetée (ABORTED sur conflit Firestore + relecture invalide).
  let result
  try {
    result = await db.runTransaction(async (t) => {
      // Relecture authoritative du profil
      const profileRef   = db.doc(`users/${actorUid}`)
      const txProfileSnap = await t.get(profileRef)
      if (!txProfileSnap.exists) {
        throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
      }
      const txProfile    = txProfileSnap.data()
      const actorStoreId = validateProfileData(txProfile)

      const reqRef  = db.doc(`dealerRequests/${requestId}`)
      const reqSnap = await t.get(reqRef)

      if (!reqSnap.exists) {
        throw new DealerRequestError('REQUEST_NOT_FOUND', 'Demande introuvable.')
      }
      const reqData = reqSnap.data()

      // Valide : status pending, store match, type/réseau (∈ profil)/montant propres
      validateRequestData(reqData, actorStoreId, dealerNetworks)
      // Réseau ciblé par cette opération (validé ∈ dealerNetworks ci-dessus).
      const network = reqData.network

      // Lecture du solde dans la même transaction
      const balRef  = db.doc(`clients/${actorStoreId}/networkBalances/current`)
      const balSnap = await t.get(balRef)
      if (!balSnap.exists) {
        throw new DealerRequestError('BALANCE_NOT_FOUND', 'Document de soldes introuvable pour cette boutique.')
      }

      const now = FieldValue.serverTimestamp()

      let previousBalance, newBalance, balUpdatePayload
      let previousLiquidityBalance = null
      let newLiquidityBalance      = null
      // Cohérence inventaire dealer : décrément à l'approvisionnement (stock_add /
      // liquidity_add). Garde d'amorçage : si le dealer n'a pas encore de document
      // dealerBalances, on NE décrémente PAS (transition avant amorçage).
      // La lecture DOIT précéder les écritures (règle des transactions Firestore).
      let dealerDebit = null

      if (reqData.requestType === 'open_day') {
        // Ouverture du jour : définit stock ET liquidité (pas d'addition)
        const stockAmount     = reqData.amount
        const liquiditeAmount = reqData.liquidityAmount
        if (!Number.isSafeInteger(stockAmount) || stockAmount <= 0) {
          throw new DealerRequestError('INVALID_REQUEST_DATA', 'Montant stock invalide pour open_day.')
        }
        if (!Number.isSafeInteger(liquiditeAmount) || liquiditeAmount <= 0) {
          throw new DealerRequestError('INVALID_REQUEST_DATA', 'Montant liquidité invalide pour open_day.')
        }
        // Lire les deux soldes précédents pour la piste d'audit complète
        previousBalance          = readCurrentBalance(balSnap.data(), 'stock_add', network)
        newBalance               = stockAmount
        previousLiquidityBalance = readCurrentBalance(balSnap.data(), 'liquidity_add', network)
        newLiquidityBalance      = liquiditeAmount

        balUpdatePayload = {
          [`balances.${network}.stock`]:     stockAmount,
          [`balances.${network}.liquidite`]: liquiditeAmount,
          updatedAt: now,
        }
      } else {
        const balField  = getBalanceField(reqData.requestType)
        previousBalance = readCurrentBalance(balSnap.data(), reqData.requestType, network)
        newBalance      = previousBalance + reqData.amount

        if (!Number.isSafeInteger(newBalance)) {
          throw new DealerRequestError(
            'BALANCE_OVERFLOW',
            'Le solde résultant dépasse la limite des entiers sûrs.'
          )
        }
        balUpdatePayload = {
          [`balances.${network}.${balField}`]: newBalance,
          updatedAt: now,
        }

        // Décrément inventaire dealer (même champ + réseau) si l'inventaire est amorcé.
        const dealerBalRef  = db.doc(`dealerBalances/${reqData.dealerUid}`)
        const dealerBalSnap = await t.get(dealerBalRef)
        if (dealerBalSnap.exists) {
          const previousDealerBalance = readDealerBalanceAmount(dealerBalSnap.data(), balField, network)
          if (previousDealerBalance < reqData.amount) {
            throw new DealerRequestError(
              'INSUFFICIENT_DEALER_BALANCE',
              "L'inventaire du dealer est insuffisant pour cet approvisionnement."
            )
          }
          dealerDebit = {
            ref: dealerBalRef,
            field: balField,
            previous: previousDealerBalance,
            next: previousDealerBalance - reqData.amount,
          }
        }
      }

      // Mise à jour de la demande (les champs liquidity sont null pour stock_add/liquidity_add)
      t.update(reqRef, {
        status:                  'confirmed',
        updatedAt:               now,
        confirmedBy:             actorUid,
        confirmedAt:             now,
        rejectedBy:              null,
        rejectedAt:              null,
        rejectionReason:         null,
        previousBalance,
        newBalance,
        previousLiquidityBalance,
        newLiquidityBalance,
      })

      // Mise à jour du solde (chemin pointé pour préserver les autres réseaux)
      t.update(balRef, balUpdatePayload)

      // Décrément inventaire dealer + audit dealer (si amorcé)
      if (dealerDebit) {
        t.update(dealerDebit.ref, {
          [`balances.${network}.${dealerDebit.field}`]: dealerDebit.next,
          updatedAt: now,
        })
        const dealerAuditRef = db.collection(`dealerBalances/${reqData.dealerUid}/auditLogs`).doc()
        t.set(dealerAuditRef, {
          action:          'DEALER_SUPPLY_DEBIT',
          actorUid,
          actorRole:       'store_admin',
          actorStoreId,
          requestId,
          dealerUid:       reqData.dealerUid,
          requestType:     reqData.requestType,
          network,
          resource:        dealerDebit.field,
          amount:          reqData.amount,
          previousBalance: dealerDebit.previous,
          newBalance:      dealerDebit.next,
          createdAt:       now,
        })
      }

      // Piste d'audit dans clients/{storeId}/auditLogs
      const auditRef = db.collection(`clients/${actorStoreId}/auditLogs`).doc()
      t.set(auditRef, buildAuditEntry({
        action:                  'DEALER_REQUEST_CONFIRMED',
        actorUid,
        actorEmail:              txProfile.email  ?? null,
        actorName:               txProfile.name   ?? null,
        actorRole:               'store_admin',
        actorStoreId,
        requestId,
        reqData,
        previousBalance,
        newBalance,
        previousLiquidityBalance,
        newLiquidityBalance,
        rejectionReason:         null,
        createdAt:               now,
      }))

      return { previousBalance, newBalance, previousLiquidityBalance, newLiquidityBalance }
    })
  } catch (err) {
    if (err instanceof DealerRequestError) throw err
    throw new DealerRequestError('TRANSACTION_FAILED', 'La transaction a échoué. Veuillez réessayer.')
  }

  return {
    success:                 true,
    requestId,
    previousBalance:         result.previousBalance,
    newBalance:              result.newBalance,
    previousLiquidityBalance: result.previousLiquidityBalance,
    newLiquidityBalance:     result.newLiquidityBalance,
  }
}
