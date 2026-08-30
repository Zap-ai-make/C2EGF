/**
 * Handler de confirmation d'une COMPENSATION — boutique créancière de D1.
 *
 * Impute ATOMIQUEMENT le même montant sur les DEUX dettes, et écrit une tranche
 * MIROIR sous D2 pour que la boutique d'en face retrouve l'opération dans son
 * propre historique de dette.
 *
 * ⚠ AUCUN MOUVEMENT DE SOLDE. C'est toute la différence avec un règlement
 *   Mobile Money : ici rien ne circule, deux créances s'annulent.
 *
 * ⚠ Le plafond est REVALIDÉ au moment présent, pas seulement à la déclaration :
 *   les deux dettes ont pu bouger entre-temps (temps réel, autres tranches
 *   confirmées). Sans ce garde-fou, une compensation déclarée hier pourrait
 *   sur-imputer une dette réduite depuis.
 */

import { DealerRequestError } from '../errors.js'
import { validateAuthUid, validateInputPayload, validateProfileData } from '../dealerRequests/shared.js'
import { assertCollaborationsEnabled } from './shared.js'
import {
  validateDebtId,
  validateSettlementId,
  validateSettlementAmount,
  deterministicMirrorId,
  validateOppositeDebtPair,
  readDebtState,
  nextDebtState,
  compensationCapacity,
  assertCompensationWithinCapacity,
  SETTLEMENT_STATUSES,
  COMPENSATION_METHOD,
} from './debtShared.js'
import { COLLABORATIONS_ENABLED } from '../config/storeProfile.js'

export async function confirmInternalDebtCompensationHandler(
  request,
  { db, FieldValue, collaborationsEnabled = COLLABORATIONS_ENABLED },
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
      const txProfileSnap = await t.get(db.doc(`users/${actorUid}`))
      if (!txProfileSnap.exists) {
        throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
      }
      const txProfile = txProfileSnap.data()
      const actorStoreId = validateProfileData(txProfile)

      // a. D1 — c'est sa CRÉANCIÈRE qui accepte la compensation.
      const d1Ref = db.doc(`internalDebts/${debtId}`)
      const d1Snap = await t.get(d1Ref)
      if (!d1Snap.exists) {
        throw new DealerRequestError('DEBT_NOT_FOUND', 'Dette introuvable.')
      }
      const debt1 = d1Snap.data()
      if (debt1.creditorStoreId !== actorStoreId) {
        throw new DealerRequestError('DEBT_STORE_MISMATCH', "Vous n'êtes pas autorisé sur cette dette.")
      }

      // b. La tranche, qui DOIT être une compensation.
      const settlementRef = db.doc(`internalDebts/${debtId}/settlements/${settlementId}`)
      const settlementSnap = await t.get(settlementRef)
      if (!settlementSnap.exists) {
        throw new DealerRequestError('SETTLEMENT_NOT_FOUND', 'Règlement introuvable.')
      }
      const settlement = settlementSnap.data()
      if (settlement.method !== COMPENSATION_METHOD) {
        throw new DealerRequestError(
          'SETTLEMENT_NOT_FOUND',
          "Cette tranche n'est pas une compensation : utilisez la confirmation de règlement.",
        )
      }
      if (settlement.settlementStatus !== SETTLEMENT_STATUSES.DECLARED) {
        throw new DealerRequestError(
          'SETTLEMENT_NOT_DECLARED',
          "Ce règlement n'est pas en attente de confirmation.",
        )
      }

      // c. D2, relue depuis la TRANCHE (pas depuis le payload).
      const oppositeDebtId = validateDebtId(settlement.oppositeDebtId)
      const d2Ref = db.doc(`internalDebts/${oppositeDebtId}`)
      const d2Snap = await t.get(d2Ref)
      if (!d2Snap.exists) {
        throw new DealerRequestError('DEBT_NOT_FOUND', 'Dette opposée introuvable.')
      }
      const debt2 = d2Snap.data()

      // d. La paire opposée est REVALIDÉE : rien ne garantit qu'elle l'est encore.
      validateOppositeDebtPair(debt1, debt2)

      // e. Plafond revalidé AU MOMENT PRÉSENT — garde-fou anti-dérive.
      const amount = validateSettlementAmount(settlement.amount)
      const state1 = readDebtState(debt1)
      const state2 = readDebtState(debt2)
      assertCompensationWithinCapacity(
        amount,
        compensationCapacity({ remainingD1: state1.remainingAmount, remainingD2: state2.remainingAmount }),
      )

      const next1 = nextDebtState(debt1, amount)
      const next2 = nextDebtState(debt2, amount)

      // ═══ ÉCRITURES ══════════════════════════════════════════════════════════
      const now = FieldValue.serverTimestamp()

      // f. Les DEUX dettes imputées, chacune avec son statut recalculé.
      t.update(d1Ref, {
        settledAmount: next1.settledAmount,
        remainingAmount: next1.remainingAmount,
        status: next1.status,
        updatedAt: now,
      })
      t.update(d2Ref, {
        settledAmount: next2.settledAmount,
        remainingAmount: next2.remainingAmount,
        status: next2.status,
        updatedAt: now,
      })

      // g. La tranche source, avec les restes dus de D1.
      t.update(settlementRef, {
        settlementStatus: SETTLEMENT_STATUSES.CONFIRMED,
        confirmedBy: actorUid,
        confirmedAt: now,
        previousRemaining: state1.remainingAmount,
        newRemaining: next1.remainingAmount,
      })

      // h. La tranche MIROIR sous D2 : elle naît directement `confirmed`.
      //    declaredBy/declaredAt sont RECOPIÉS de la source — la déclaration
      //    reste attribuée à son auteur réel, pas à celui qui confirme.
      const mirrorId = deterministicMirrorId(debtId, settlementId)
      t.set(db.doc(`internalDebts/${oppositeDebtId}/settlements/${mirrorId}`), {
        debtId: oppositeDebtId,
        oppositeDebtId: debtId,
        debtorStoreId: debt2.debtorStoreId,
        creditorStoreId: debt2.creditorStoreId,
        amount,
        method: COMPENSATION_METHOD,
        settlementStatus: SETTLEMENT_STATUSES.CONFIRMED,
        idempotencyKey: settlement.idempotencyKey ?? null,
        mirrorOf: settlementId,
        previousRemaining: state2.remainingAmount,
        newRemaining: next2.remainingAmount,
        declaredBy: settlement.declaredBy ?? null,
        declaredAt: settlement.declaredAt ?? now,
        confirmedBy: actorUid,
        confirmedAt: now,
        rejectedBy: null,
        rejectedAt: null,
        rejectionReason: null,
      })

      // i. Audit chez LES DEUX boutiques : chacune doit voir la compensation
      //    dans son propre journal, avec l'état de SA dette.
      const auditTargets = [
        { storeId: debt1.creditorStoreId, debtStatus: next1.status, oppositeDebtStatus: next2.status },
        { storeId: debt1.debtorStoreId, debtStatus: next1.status, oppositeDebtStatus: next2.status },
      ]
      for (const target of auditTargets) {
        const ref = db.collection(`clients/${target.storeId}/auditLogs`).doc()
        t.set(ref, {
          action: 'INTERNAL_DEBT_COMPENSATION_CONFIRMED',
          actorUid,
          actorEmail: txProfile.email ?? null,
          actorName: txProfile.name ?? null,
          actorRole: 'store_admin',
          actorStoreId,
          storeId: target.storeId,
          debtId,
          oppositeDebtId,
          settlementId,
          mirrorSettlementId: mirrorId,
          amount,
          previousRemaining: state1.remainingAmount,
          newRemaining: next1.remainingAmount,
          debtStatus: target.debtStatus,
          oppositeDebtStatus: target.oppositeDebtStatus,
          createdAt: now,
        })
      }

      return {
        oppositeDebtId,
        mirrorSettlementId: mirrorId,
        amount,
        debtStatus: next1.status,
        oppositeDebtStatus: next2.status,
        newRemaining: next1.remainingAmount,
        oppositeNewRemaining: next2.remainingAmount,
      }
    })
  } catch (err) {
    if (err instanceof DealerRequestError) throw err
    throw new DealerRequestError('TRANSACTION_FAILED', 'La transaction a échoué. Veuillez réessayer.')
  }

  return { success: true, debtId, settlementId, ...result }
}
