/**
 * addTransactionPayment — Handler Cloud Function pour les paiements par tranche.
 *
 * Sécurité :
 *   - storeId issu du profil serveur (jamais du client)
 *   - Double lecture profil (avant + dans transaction)
 *   - allow-list strict des méthodes de paiement
 *   - Idempotence stricte : même clé + payload différent → IDEMPOTENCY_CONFLICT
 *
 * Audit :
 *   - Chaque settlement contient l'état avant/après complet (montants + soldes + statuts)
 *   - Sur paiement final : settlement copié sous history/{historyId}/settlements/
 *   - settlementSummary maintenu incrémentalement sur le draft
 *
 * Annulation multi-tranches :
 *   - settlementSummary sur le doc history contient l'impact net par réseau
 *   - reverseHistoryTransactionImpact l'utilise pour inverser exactement ce qui a été fait
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
  applySettlementImpact,
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

function buildFinalStatus(type, paymentMethod) {
  const t = String(type || '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  if (t === 'depot')   return `Encaissé par ${paymentMethod}`
  if (t === 'retrait') return `Payé par ${paymentMethod}`
  if (t === 'credit')  return `Remboursé par ${paymentMethod}`
  return `Validée par ${paymentMethod}`
}

/**
 * Met à jour le settlementSummary du draft pour ce réseau.
 * Le summary est maintenu incrémentalement pour permettre l'annulation exacte.
 */
function updateSummaryForPayment(prevSummary, network, amount) {
  const prev = (prevSummary?.netByNetwork || {})[network] || { paid: 0, refunded: 0 }
  return {
    netByNetwork: {
      ...(prevSummary?.netByNetwork || {}),
      [network]: { paid: prev.paid + amount, refunded: prev.refunded },
    },
  }
}

export async function addTransactionPaymentHandler(request, { db, FieldValue, logWriter = write }) {
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
  if (!STORE_PAYMENT_METHODS.includes(paymentMethod)) {
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
    (profile) => validateSettlementProfile(profile, 'des règlements'),
  )

  // ── 5. ID de settlement déterministe ──────────────────────────────────────
  const settlementId = `pmt_${draftId}_${actorUid}_${trimmedKey}`

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
        action: 'addTransactionPayment',
        actorUid,
        storeId,
        settlementId,
        recordConflict: (conflict) => { idempotencyConflictLog = conflict },
      })
      if (existingData) {
        return { idempotent: true, fullySettled: existingData.fullySettled ?? false }
      }

      if (!draftSnap.exists) {
        throw new DealerRequestError('SETTLEMENT_DRAFT_NOT_FOUND', 'Transaction introuvable.')
      }

      const draft = draftSnap.data()

      // ── Type métier ÉPINGLÉ (défense en profondeur, cf. C1) ────────────────
      // Le signe de l'impact réseau dépend du type (Retrait ⇒ débit). Les règles
      // Firestore figent déjà draft.type dès qu'un règlement est engagé, mais on
      // ne s'y fie pas seul : dès la 1re tranche on épingle le type dans un champ
      // serveur immuable (settlementType, verrouillé côté règles) et on le relit
      // ensuite — même si le gel des règles était contourné, le signe reste stable.
      const effectiveType = draft.settlementType ?? draft.type

      // ── Initialisation lazy (backward compat) ─────────────────────────────
      const originalAmount  = draft.originalAmount  ?? draft.montant
      const paidAmount      = draft.paidAmount      ?? 0
      const refundedAmount  = draft.refundedAmount  ?? 0
      const remainingAmount = draft.remainingAmount ?? (originalAmount - paidAmount + refundedAmount)

      if (remainingAmount <= 0) {
        throw new DealerRequestError('SETTLEMENT_ALREADY_SETTLED', 'Cette transaction est déjà entièrement réglée.')
      }
      if (amount > remainingAmount) {
        throw new DealerRequestError(
          'SETTLEMENT_EXCEEDS_REMAINING',
          `Montant (${amount} FCFA) supérieur au reste dû (${remainingAmount} FCFA).`
        )
      }

      // ── Impact financier ──────────────────────────────────────────────────
      const currentBalances = normalizeNetworkBalances(balanceSnap.exists ? balanceSnap.data() : {})
      const affectedNetwork = mapPaymentMethodToNetwork(paymentMethod)
      const nextBalances    = applySettlementImpact(currentBalances, { type: effectiveType, montant: amount }, paymentMethod)

      const previousBalanceEntry = currentBalances[affectedNetwork] ?? { stock: 0, liquidite: 0 }
      const newBalanceEntry      = nextBalances[affectedNetwork]    ?? { stock: 0, liquidite: 0 }

      const now          = FieldValue.serverTimestamp()
      const newPaid      = paidAmount + amount
      const newRemaining = remainingAmount - amount
      const fullySettled = newRemaining === 0

      // ── settlementSummary incrémental ─────────────────────────────────────
      const prevSummary  = draft.settlementSummary ?? null
      const newSummary   = updateSummaryForPayment(prevSummary, affectedNetwork, amount)

      // ── Document settlement ───────────────────────────────────────────────
      const settlementData = {
        // Identité
        type:              'payment',
        operationType:     'payment',
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
        newPaidAmount:       newPaid,
        newRefundedAmount:   refundedAmount,
        newRemainingAmount:  newRemaining,
        newSettlementStatus: fullySettled ? 'settled' : 'partial',
        // Impact financier
        affectedNetwork,
        affectedBalanceField: affectedNetwork === 'Liquidite' ? 'liquidite' : 'stock',
        previousFinancialBalance: previousBalanceEntry,
        newFinancialBalance:      newBalanceEntry,
        financialDelta:           amount,
        // Finalisation
        fullySettled,
        historyId:   null,  // mis à jour ci-dessous si fullySettled
        createdAt:   now,
      }

      // ── Mise à jour des soldes ────────────────────────────────────────────
      t.set(balanceRef, { balances: nextBalances, updatedAt: now }, { merge: true })

      if (fullySettled) {
        // Déplacer vers l'historique
        const historyRef = db.collection(`clients/${storeId}/history`).doc()
        const historyId  = historyRef.id

        const finalSummary = {
          ...newSummary,
          totalPaid:      newPaid,
          totalRefunded:  refundedAmount,
          draftSettlementsPath: `clients/${storeId}/drafts/${draftId}`,
        }

        t.set(historyRef, {
          ...draft,
          originalAmount,
          paidAmount:          newPaid,
          refundedAmount,
          remainingAmount:     0,
          settlementStatus:    'settled',
          settlementType:      effectiveType,
          settlementSummary:   finalSummary,
          settlementUpdatedAt: now,
          statut:              buildFinalStatus(effectiveType, paymentMethod),
          paymentMethod,
          // ⚠ `settlementAgentCode` ET NON `agentCode` : la ligne d'historique
          //   porte deja `code`, celui du CLIENT. Les deux repondent a des
          //   questions differentes — « qui est ce client » et « ou est parti
          //   l'argent » — et un nom court les aurait confondus a la relecture.
          settlementAgentCode: agentCode,
          effectiveNetwork:    affectedNetwork,
          settlementAmount:    originalAmount,
          validatedAt:         now,
          updatedAt:           now,
        })
        t.delete(draftRef)

        // Copie du settlement sous history pour audit durable
        const historySettlementRef = db.doc(`clients/${storeId}/history/${historyId}/settlements/${settlementId}`)
        t.set(settlementRef,        { ...settlementData, historyId })
        t.set(historySettlementRef, { ...settlementData, historyId })

        return { idempotent: false, fullySettled: true, historyId }
      } else {
        // Paiement partiel
        t.set(settlementRef, settlementData)

        t.update(draftRef, {
          originalAmount,
          paidAmount:          newPaid,
          refundedAmount,
          remainingAmount:     newRemaining,
          settlementStatus:    'partial',
          settlementType:      effectiveType,
          settlementSummary:   newSummary,
          settlementUpdatedAt: now,
        })

        return { idempotent: false, fullySettled: false }
      }
    })
  } catch (err) {
    // Conflit d'idempotence : log d'audit serveur émis UNE SEULE fois, hors transaction.
    if (idempotencyConflictLog) writeSafeAuditLog(logWriter, idempotencyConflictLog)
    if (err instanceof DealerRequestError) throw err
    throw new DealerRequestError('TRANSACTION_FAILED', 'La transaction a échoué. Veuillez réessayer.')
  }

  return {
    success:      true,
    idempotent:   txResult.idempotent  ?? false,
    fullySettled: txResult.fullySettled ?? false,
    historyId:    txResult.historyId   ?? null,
  }
}
