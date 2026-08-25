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
import { validateAuthUid, validateInputPayload } from '../dealerRequests/shared.js'
import {
  normalizeNetworkBalances,
  mapPaymentMethodToNetwork,
  reverseSettlementImpact,
} from './financialUtils.js'

const ALLOWED_METHODS = [
  'Orange Money',
  'Moov Money',
  'Telecel Money',
  'Coris Money',
  'Sank Money',
  'Cash',
]

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
  const payload = validateInputPayload(request.data, ['draftId', 'amount', 'paymentMethod', 'idempotencyKey'])
  const { draftId, amount, paymentMethod, idempotencyKey } = payload

  // ── 3. Field validation ───────────────────────────────────────────────────
  if (typeof draftId !== 'string' || !draftId.trim()) {
    throw new DealerRequestError('SETTLEMENT_DATA_INVALID', 'draftId manquant ou invalide.')
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new DealerRequestError('INVALID_SETTLEMENT_AMOUNT', 'Montant invalide (entier strictement positif requis).')
  }
  if (!ALLOWED_METHODS.includes(paymentMethod)) {
    throw new DealerRequestError('INVALID_PAYMENT_METHOD', `Méthode non autorisée : ${paymentMethod}`)
  }
  if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
    throw new DealerRequestError('SETTLEMENT_DATA_INVALID', 'Clé d\'idempotence manquante.')
  }

  const trimmedKey = idempotencyKey.trim()

  // ── 4. Pré-validation profil ──────────────────────────────────────────────
  const profileSnap = await db.doc(`users/${actorUid}`).get()
  if (!profileSnap.exists) {
    throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
  }
  const preProfile = profileSnap.data()
  if (!preProfile.active) {
    throw new DealerRequestError('PROFILE_INACTIVE', 'Compte désactivé.')
  }
  if (!['store_admin', 'member'].includes(preProfile.role)) {
    throw new DealerRequestError('ROLE_FORBIDDEN', 'Seuls les membres de boutique peuvent enregistrer des remboursements.')
  }
  const preStoreId = typeof preProfile.storeId === 'string' ? preProfile.storeId.trim() : ''
  if (!preStoreId) {
    throw new DealerRequestError('STORE_ID_REQUIRED', 'Profil sans boutique assignée.')
  }

  // ── 5. ID de settlement déterministe ──────────────────────────────────────
  const settlementId = `ref_${draftId}_${actorUid}_${trimmedKey}`

  // ── 6. Transaction atomique ───────────────────────────────────────────────
  // Détail d'un éventuel conflit d'idempotence, capturé DANS la transaction mais journalisé
  // UNE SEULE FOIS hors transaction (le corps peut être rejoué sur contention).
  let idempotencyConflictLog = null
  let txResult
  try {
    txResult = await db.runTransaction(async (t) => {
      // Relecture authoritative du profil
      const txProfileSnap = await t.get(db.doc(`users/${actorUid}`))
      if (!txProfileSnap.exists) {
        throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil introuvable.')
      }
      const txProfile = txProfileSnap.data()
      if (!txProfile.active || !['store_admin', 'member'].includes(txProfile.role)) {
        throw new DealerRequestError('ROLE_FORBIDDEN', 'Accès refusé (profil modifié).')
      }
      const storeId = typeof txProfile.storeId === 'string' ? txProfile.storeId.trim() : ''
      if (!storeId || storeId !== preStoreId) {
        throw new DealerRequestError('SETTLEMENT_STORE_MISMATCH', 'Boutique modifiée entre les lectures.')
      }

      const draftRef      = db.doc(`clients/${storeId}/drafts/${draftId}`)
      const settlementRef = db.doc(`clients/${storeId}/drafts/${draftId}/settlements/${settlementId}`)
      const balanceRef    = db.doc(`clients/${storeId}/networkBalances/current`)

      const [draftSnap, settlementSnap, balanceSnap] = await t.getAll(draftRef, settlementRef, balanceRef)

      // ── Idempotence stricte ───────────────────────────────────────────────
      if (settlementSnap.exists) {
        const existingData = settlementSnap.data()
        if (existingData.amount !== amount || existingData.paymentMethod !== paymentMethod) {
          // On CAPTURE le détail (montants/méthode) pour un log serveur émis hors transaction
          // (diagnostic — jamais renvoyé au client ; message client volontairement générique).
          idempotencyConflictLog = {
            event:          'SETTLEMENT_IDEMPOTENCY_CONFLICT',
            action:         'addTransactionRefund',
            actorUid,
            storeId,
            settlementId,
            existingAmount: existingData.amount,
            newAmount:      amount,
            existingMethod: existingData.paymentMethod,
            newMethod:      paymentMethod,
          }
          throw new DealerRequestError(
            'IDEMPOTENCY_CONFLICT',
            'Cette opération a déjà été enregistrée avec des paramètres différents. Rechargez la page et réessayez.'
          )
        }
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

      // ── Impact financier inverse ──────────────────────────────────────────
      const currentBalances = normalizeNetworkBalances(balanceSnap.exists ? balanceSnap.data() : {})
      const affectedNetwork = mapPaymentMethodToNetwork(paymentMethod)
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
        settlementId,
        draftId,
        storeId,
        clientId:          draft.clientId ?? null,
        amount,
        paymentMethod,
        effectiveNetwork:  affectedNetwork,
        idempotencyKey:    trimmedKey,
        // Acteur
        actorUid,
        actorName:         txProfile.name  ?? null,
        actorRole:         txProfile.role,
        actorStoreId:      storeId,
        // Avant
        previousPaidAmount:       paidAmount,
        previousRefundedAmount:   refundedAmount,
        previousRemainingAmount:  remainingAmount,
        previousSettlementStatus: draft.settlementStatus ?? null,
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
