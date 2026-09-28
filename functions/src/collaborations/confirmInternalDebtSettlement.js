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
import { readStoreStock } from './shared.js'
import {
  nextDebtState,
  settlementMovesStock,
  settlementNetwork,
  SETTLEMENT_STATUSES,
} from './debtShared.js'
import {
  prepareInternalDebtConfirmation,
  readSettlementConfirmationContext,
} from './internalDebtConfirmationShared.js'
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
  const { actorUid, debtId, settlementId } = await prepareInternalDebtConfirmation(
    request,
    { db, collaborationsEnabled },
  )

  // ── 5. Transaction ─────────────────────────────────────────────────────────
  let result
  try {
    result = await db.runTransaction(async (t) => {
      // ═══ LECTURES ═══════════════════════════════════════════════════════════

      const {
        actorStoreId,
        amount,
        debt,
        debtRef,
        settlement,
        settlementRef,
        txProfile,
      } = await readSettlementConfirmationContext({
        db, transaction: t, actorUid, debtId, settlementId,
      })

      // La méthode n'est volontairement pas revalidée : un code historique
      // doit rester confirmable. Seule une compensation est aiguillée ailleurs.
      const nextDebt = nextDebtState(debt, amount)

      // Mouvement de stock conditionnel — les DEUX soldes lus AVANT toute
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
