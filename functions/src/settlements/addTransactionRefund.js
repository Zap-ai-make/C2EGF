/**
 * addTransactionRefund — Handler Cloud Function pour les remboursements par tranche.
 *
 * Règle métier :
 *   amount <= (paidAmount - refundedAmount)  — impossible de rembourser plus que le net payé.
 *   newRemaining = remainingAmount + amount  — la dette est rouverte.
 *   Draft jamais supprimé sur remboursement.
 *
 * Idempotence stricte :
 *   Même clé + même payload → idempotent:true, aucune mutation.
 *   Même clé + payload différent → IDEMPOTENCY_CONFLICT.
 *
 * Audit :
 *   Settlement contient l'état complet avant/après + impact financier.
 *   settlementSummary du draft maintenu incrémentalement.
 */

import { write } from 'firebase-functions/logger'
import { DealerRequestError } from '../errors.js'
import { writeSafeAuditLog } from '../logging.js'
import {
  readValidatedProfile,
  validateAuthUid,
  validateInputPayload,
} from '../dealerRequests/shared.js'
import {
  normalizeNetworkBalances,
  mapPaymentMethodToNetwork,
  reverseSettlementImpact,
} from './financialUtils.js'
import {
  validateSettlementProfile,
} from './profileValidation.js'
import {
  buildSettlementAuditBase,
  readIdempotentSettlement,
  readSettlementTransactionContext,
  cleanSettlementAgentCode,
} from './settlementShared.js'
import { STORE_PAYMENT_METHODS } from '../config/storeProfile.js'

/**
 * Met à jour le settlementSummary du draft pour un remboursement.
 */
function updateSummaryForRefund(prevSummary, network, amount) {
  const prev = (prevSummary?.netByNetwork || {})[network] || { paid: 0, refunded: 0 }
  return {
    netByNetwork: {
      ...(prevSummary?.netByNetwork || {}),
      [network]: { paid: prev.paid, refunded: prev.refunded + amount },
    },
  }
}

export async function addTransactionRefundHandler(request, { db, FieldValue, logWriter = write }) {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const actorUid = validateAuthUid(request.auth?.uid)

  // ── 2. Payload shape ──────────────────────────────────────────────────────
  const payload = validateInputPayload(request.data, ['draftId', 'amount', 'paymentMethod', 'idempotencyKey', 'agentCode'])
  const { draftId, amount, paymentMethod, idempotencyKey } = payload
  // Facultatif : `null` quand la boutique n'a pas note de destination.
  const agentCode = cleanSettlementAgentCode(payload.agentCode)

  // ── 3. Field validation ───────────────────────────────────────────────────
  if (typeof draftId !== 'string' || !draftId.trim()) {
    throw new DealerRequestError('SETTLEMENT_DATA_INVALID', 'draftId manquant ou invalide.')
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new DealerRequestError('INVALID_SETTLEMENT_AMOUNT', 'Montant invalide (entier strictement positif requis).')
  }
  if (typeof paymentMethod !== 'string' || !paymentMethod.trim()) {
    throw new DealerRequestError('INVALID_PAYMENT_METHOD', `Méthode non autorisée : ${paymentMethod}`)
  }
  if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
    throw new DealerRequestError('SETTLEMENT_DATA_INVALID', 'Clé d\'idempotence manquante.')
  }

  const trimmedKey = idempotencyKey.trim()

  // ── 4. Pré-validation profil ──────────────────────────────────────────────
  const { validationResult: preStoreId } = await readValidatedProfile(
    db,
    actorUid,
    (profile) => validateSettlementProfile(profile, 'des remboursements'),
  )

  // ── 5. ID de settlement déterministe ──────────────────────────────────────
  const settlementId = `ref_${draftId}_${actorUid}_${trimmedKey}`

  // ── 6. Transaction atomique ───────────────────────────────────────────────
  // Détail d'un éventuel conflit d'idempotence, capturé DANS la transaction mais journalisé
  // UNE SEULE FOIS hors transaction (le corps peut être rejoué sur contention).
  let idempotencyConflictLog = null
  let txResult
  try {
    txResult = await db.runTransaction(async (t) => {
      const {
        txProfile,
        storeId,
        draftRef,
        settlementRef,
        balanceRef,
        draftSnap,
        settlementSnap,
        balanceSnap,
      } = await readSettlementTransactionContext({
        db,
        transaction: t,
        actorUid,
        preStoreId,
        draftId,
        settlementId,
      })

      // ── Idempotence stricte ───────────────────────────────────────────────
      const existingData = readIdempotentSettlement({
        settlementSnap,
        amount,
        paymentMethod,
        agentCode,
        action: 'addTransactionRefund',
        actorUid,
        storeId,
        settlementId,
        recordConflict: (conflict) => { idempotencyConflictLog = conflict },
      })
      if (existingData) {
        return { idempotent: true }
      }

      if (!draftSnap.exists) {
        throw new DealerRequestError('SETTLEMENT_DRAFT_NOT_FOUND', 'Transaction introuvable.')
      }

      const draft = draftSnap.data()

      // ── Type métier ÉPINGLÉ (défense en profondeur, cf. C1) ────────────────
      // On relit le type épinglé par la 1re tranche (settlementType, champ serveur
      // immuable verrouillé côté règles) plutôt que draft.type — le signe de
      // l'impact réseau reste stable même si le gel des règles était contourné.
      const effectiveType = draft.settlementType ?? draft.type

      // ── Initialisation lazy ───────────────────────────────────────────────
      const originalAmount  = draft.originalAmount  ?? draft.montant
      const paidAmount      = draft.paidAmount      ?? 0
      const refundedAmount  = draft.refundedAmount  ?? 0
      const remainingAmount = draft.remainingAmount ?? (originalAmount - paidAmount + refundedAmount)

      const netPaid = paidAmount - refundedAmount
      if (netPaid <= 0) {
        throw new DealerRequestError('REFUND_EXCEEDS_PAID', 'Aucun paiement net à rembourser.')
      }
      if (amount > netPaid) {
        throw new DealerRequestError(
          'REFUND_EXCEEDS_PAID',
          `Montant remboursé (${amount} FCFA) supérieur au net payé (${netPaid} FCFA).`
        )
      }

      // Une méthode retirée du profil ne peut plus recevoir de nouveau paiement,
      // mais doit rester remboursable si une tranche historique l'a utilisée.
      const affectedNetwork = mapPaymentMethodToNetwork(paymentMethod)
      const historical = draft.settlementSummary?.netByNetwork?.[affectedNetwork]
      const historicalNet = (historical?.paid ?? 0) - (historical?.refunded ?? 0)
      if (!STORE_PAYMENT_METHODS.includes(paymentMethod) && historicalNet < amount) {
        throw new DealerRequestError('INVALID_PAYMENT_METHOD', `Méthode non autorisée : ${paymentMethod}`)
      }

      // ── Impact financier inverse ──────────────────────────────────────────
      const currentBalances = normalizeNetworkBalances(balanceSnap.exists ? balanceSnap.data() : {})
      const nextBalances    = reverseSettlementImpact(currentBalances, { type: effectiveType, montant: amount }, paymentMethod)

      const previousBalanceEntry = currentBalances[affectedNetwork] ?? { stock: 0, liquidite: 0 }
      const newBalanceEntry      = nextBalances[affectedNetwork]    ?? { stock: 0, liquidite: 0 }

      const now          = FieldValue.serverTimestamp()
      const newRefunded  = refundedAmount + amount
      const newRemaining = remainingAmount + amount

      // ── settlementSummary incrémental ─────────────────────────────────────
      const prevSummary = draft.settlementSummary ?? null
      const newSummary  = updateSummaryForRefund(prevSummary, affectedNetwork, amount)

      // ── Document settlement ───────────────────────────────────────────────
      t.set(settlementRef, {
        // Identité
        type:              'refund',
        operationType:     'refund',
        ...buildSettlementAuditBase({
          agentCode,
          settlementId,
          draftId,
          storeId,
          draft,
          amount,
          paymentMethod,
          affectedNetwork,
          trimmedKey,
          actorUid,
          txProfile,
          paidAmount,
          refundedAmount,
          remainingAmount,
        }),
        // Après
        newPaidAmount:       paidAmount,
        newRefundedAmount:   newRefunded,
        newRemainingAmount:  newRemaining,
        newSettlementStatus: 'partial',
        // Impact financier
        affectedNetwork,
        affectedBalanceField: affectedNetwork === 'Liquidite' ? 'liquidite' : 'stock',
        previousFinancialBalance: previousBalanceEntry,
        newFinancialBalance:      newBalanceEntry,
        financialDelta:           -amount,  // négatif : restitution
        // Finalization
        fullySettled: false,
        historyId:    null,
        createdAt:    now,
      })

      // ── Mise à jour des soldes ────────────────────────────────────────────
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })

      // ── Mise à jour du draft ──────────────────────────────────────────────
      t.update(draftRef, {
        originalAmount,
        paidAmount,
        refundedAmount:      newRefunded,
        remainingAmount:     newRemaining,
        settlementStatus:    'partial',
        settlementType:      effectiveType,
        settlementSummary:   newSummary,
        settlementUpdatedAt: now,
      })

      return { idempotent: false }
    })
  } catch (err) {
    // Conflit d'idempotence : log d'audit serveur émis UNE SEULE fois, hors transaction.
    if (idempotencyConflictLog) writeSafeAuditLog(logWriter, idempotencyConflictLog)
    if (err instanceof DealerRequestError) throw err
    throw new DealerRequestError('TRANSACTION_FAILED', 'La transaction a échoué. Veuillez réessayer.')
  }

  return {
    success:    true,
    idempotent: txResult.idempotent ?? false,
  }
}
