/**
 * Handler de confirmation d'une tranche — boutique CRÉANCIÈRE.
 *
 * C'est ici que la dette est réellement imputée, et — selon la méthode — que du
 * float change de main :
 *
 *   Mobile Money → le stock du réseau passe VRAIMENT de la débitrice à la
 *                  créancière. La dette n'est pas qu'une écriture comptable.
 *   Cash, Banque → aucun solde de l'application ne bouge (l'argent circule hors
 *                  système), mais la dette est quand même imputée.
 *
 * ⚠ LECTURES AVANT ÉCRITURES : Firestore refuse toute lecture après une écriture
 *   dans une même transaction. Les DEUX soldes doivent donc être lus avant même
 *   la mise à jour de la dette.
 *
 * ⚠ La MÉTHODE n'est volontairement PAS revalidée ici. Une tranche déclarée avec
 *   un code historique (`especes`, `transfert`…) doit rester confirmable : la
 *   refuser la figerait pour toujours dans la file d'attente de la créancière.
 */

import { DealerRequestError } from '../errors.js'
import { validateAuthUid, validateInputPayload, validateProfileData } from '../dealerRequests/shared.js'
import { assertCollaborationsEnabled, readStoreStock } from './shared.js'
import {
  validateDebtId,
  validateSettlementId,
  validateSettlementAmount,
  nextDebtState,
  settlementMovesStock,
  settlementNetwork,
  SETTLEMENT_STATUSES,
  COMPENSATION_METHOD,
} from './debtShared.js'
import { COLLABORATIONS_ENABLED, STORE_NETWORKS } from '../config/storeProfile.js'

export async function confirmInternalDebtSettlementHandler(
  request,
  {
    db,
    FieldValue,
    collaborationsEnabled = COLLABORATIONS_ENABLED,
    storeNetworks = STORE_NETWORKS,
  },
) {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const actorUid = validateAuthUid(request.auth?.uid)

  // ── 2. Module ouvert ? ─────────────────────────────────────────────────────
  assertCollaborationsEnabled(collaborationsEnabled)

  // ── 3. Payload (allow-list) ────────────────────────────────────────────────
  const payload = validateInputPayload(request.data, ['debtId', 'settlementId'])
  const debtId = validateDebtId(payload.debtId)
  const settlementId = validateSettlementId(payload.settlementId)

  // ── 4. Prévalidation profil ────────────────────────────────────────────────
  const profileSnap = await db.doc(`users/${actorUid}`).get()
  if (!profileSnap.exists) {
    throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
  }
  validateProfileData(profileSnap.data())

  // ── 5. Transaction ─────────────────────────────────────────────────────────
  let result
  try {
    result = await db.runTransaction(async (t) => {
      // ═══ LECTURES ═══════════════════════════════════════════════════════════

      // a. Profil autoritatif.
      const txProfileSnap = await t.get(db.doc(`users/${actorUid}`))
      if (!txProfileSnap.exists) {
        throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
      }
      const txProfile = txProfileSnap.data()
      const actorStoreId = validateProfileData(txProfile)

      // b. La dette — seule la CRÉANCIÈRE confirme : c'est elle qui reçoit.
      const debtRef = db.doc(`internalDebts/${debtId}`)
      const debtSnap = await t.get(debtRef)
      if (!debtSnap.exists) {
        throw new DealerRequestError('DEBT_NOT_FOUND', 'Dette introuvable.')
      }
      const debt = debtSnap.data()
      if (debt.creditorStoreId !== actorStoreId) {
        throw new DealerRequestError('DEBT_STORE_MISMATCH', "Vous n'êtes pas autorisé sur cette dette.")
      }

      // c. La tranche.
      const settlementRef = db.doc(`internalDebts/${debtId}/settlements/${settlementId}`)
      const settlementSnap = await t.get(settlementRef)
      if (!settlementSnap.exists) {
        throw new DealerRequestError('SETTLEMENT_NOT_FOUND', 'Règlement introuvable.')
      }
      const settlement = settlementSnap.data()

      // d. Aiguillage : une tranche de COMPENSATION ne se confirme pas par ce
      //    chemin. L'imputer ici ne toucherait qu'UNE des deux dettes et
      //    laisserait la dette opposée intacte — un déséquilibre silencieux.
      if (settlement.method === COMPENSATION_METHOD) {
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

      // e. Montant revalidé depuis le DOCUMENT, puis imputation calculée.
      const amount = validateSettlementAmount(settlement.amount)
      const nextDebt = nextDebtState(debt, amount)

      // f. Mouvement de stock conditionnel — les DEUX soldes lus AVANT toute
      //    écriture, y compris avant la mise à jour de la dette.
      const movesStock = settlementMovesStock(settlement.method, storeNetworks)
      let stockMove = null

      if (movesStock) {
        const network = settlementNetwork(settlement.method)
        const payerStoreId = debt.debtorStoreId     // elle paie : son stock baisse
        const receiverStoreId = debt.creditorStoreId // elle reçoit : son stock monte

        const payerRef = db.doc(`clients/${payerStoreId}/networkBalances/current`)
        const receiverRef = db.doc(`clients/${receiverStoreId}/networkBalances/current`)
        const [payerSnap, receiverSnap] = await Promise.all([t.get(payerRef), t.get(receiverRef)])

        const payerPrev = readStoreStock(payerSnap.exists ? payerSnap.data() : null, network)
        const receiverPrev = readStoreStock(receiverSnap.exists ? receiverSnap.data() : null, network)

        if (payerPrev < amount) {
          throw new DealerRequestError(
            'SETTLEMENT_INSUFFICIENT_BALANCE',
            'Solde réseau insuffisant chez la boutique débitrice pour ce remboursement.',
          )
        }
        const payerNext = payerPrev - amount
        const receiverNext = receiverPrev + amount
        if (
          !Number.isSafeInteger(payerNext) || payerNext < 0 ||
          !Number.isSafeInteger(receiverNext) || receiverNext < 0
        ) {
          throw new DealerRequestError('BALANCE_OVERFLOW', 'Le solde résultant est invalide.')
        }

        stockMove = {
          network, payerStoreId, receiverStoreId, payerRef, receiverRef,
          payerPrev, payerNext, receiverPrev, receiverNext,
        }
      }

      // ═══ ÉCRITURES ══════════════════════════════════════════════════════════
      const now = FieldValue.serverTimestamp()

      if (stockMove) {
        // Merge imbriqué sur le SEUL champ stock du SEUL réseau concerné.
        t.set(stockMove.payerRef, {
          balances: { [stockMove.network]: { stock: stockMove.payerNext } }, updatedAt: now,
        }, { merge: true })
        t.set(stockMove.receiverRef, {
          balances: { [stockMove.network]: { stock: stockMove.receiverNext } }, updatedAt: now,
        }, { merge: true })

        // Un audit de mouvement CHEZ CHACUNE des deux boutiques : chacune doit
        // retrouver le mouvement dans son propre journal.
        const moved = [
          { storeId: stockMove.payerStoreId, direction: 'DEBITED', previousBalance: stockMove.payerPrev, newBalance: stockMove.payerNext },
          { storeId: stockMove.receiverStoreId, direction: 'CREDITED', previousBalance: stockMove.receiverPrev, newBalance: stockMove.receiverNext },
        ]
        for (const entry of moved) {
          const ref = db.collection(`clients/${entry.storeId}/auditLogs`).doc()
          t.set(ref, {
            action: 'INTERNAL_DEBT_SETTLEMENT_BALANCE_MOVED',
            actorUid,
            actorEmail: txProfile.email ?? null,
            actorName: txProfile.name ?? null,
            actorRole: 'store_admin',
            actorStoreId,
            debtId,
            settlementId,
            amount,
            method: settlement.method ?? null,
            network: stockMove.network,
            storeId: entry.storeId,
            direction: entry.direction,
            previousBalance: entry.previousBalance,
            newBalance: entry.newBalance,
            createdAt: now,
          })
        }
      }

      t.update(debtRef, {
        settledAmount: nextDebt.settledAmount,
        remainingAmount: nextDebt.remainingAmount,
        status: nextDebt.status,
        updatedAt: now,
      })

      t.update(settlementRef, {
        settlementStatus: SETTLEMENT_STATUSES.CONFIRMED,
        confirmedBy: actorUid,
        confirmedAt: now,
        previousRemaining: debt.remainingAmount,
        newRemaining: nextDebt.remainingAmount,
      })

      const auditRef = db.collection(`clients/${actorStoreId}/auditLogs`).doc()
      t.set(auditRef, {
        action: 'INTERNAL_DEBT_SETTLEMENT_CONFIRMED',
        actorUid,
        actorEmail: txProfile.email ?? null,
        actorName: txProfile.name ?? null,
        actorRole: 'store_admin',
        actorStoreId,
        debtId,
        settlementId,
        amount,
        method: settlement.method ?? null,
        previousRemaining: debt.remainingAmount,
        newRemaining: nextDebt.remainingAmount,
        debtStatus: nextDebt.status,
        movedStock: Boolean(stockMove),
        createdAt: now,
      })

      return {
        previousRemaining: debt.remainingAmount,
        newRemaining: nextDebt.remainingAmount,
        debtStatus: nextDebt.status,
        movedStock: Boolean(stockMove),
      }
    })
  } catch (err) {
    if (err instanceof DealerRequestError) throw err
    throw new DealerRequestError('TRANSACTION_FAILED', 'La transaction a échoué. Veuillez réessayer.')
  }

  return { success: true, debtId, settlementId, ...result }
}
