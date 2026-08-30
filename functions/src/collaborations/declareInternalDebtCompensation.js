/**
 * Handler de déclaration d'une COMPENSATION — boutique débitrice de D1.
 *
 * Compenser, c'est solder la dette D1 (A→B) contre la dette opposée D2 (B→A).
 * Même paire de boutiques, sens inverse, tous réseaux confondus : on règle la
 * position nette entre A et B.
 *
 * ⚠ AUCUN FLOAT NE BOUGE, ni ici ni à la confirmation. Seuls les restes dus des
 *   deux dettes changent. C'est une opération purement comptable.
 *
 * ⚠ Comme pour un règlement ordinaire, ce handler N'IMPUTE RIEN : il écrit une
 *   tranche `declared` sous D1, en attente de la créancière de D1. Et comme pour
 *   un règlement, le court-circuit d'idempotence précède le calcul du plafond.
 */

import { DealerRequestError } from '../errors.js'
import { validateAuthUid, validateInputPayload, validateProfileData } from '../dealerRequests/shared.js'
import { assertCollaborationsEnabled } from './shared.js'
import {
  validateDebtId,
  validateSettlementAmount,
  validateIdempotencyKey,
  deterministicCompensationId,
  assertDistinctDebts,
  assertDebtOpen,
  validateOppositeDebtPair,
  sumDeclaredAmounts,
  compensationCapacity,
  assertCompensationWithinCapacity,
  SETTLEMENT_STATUSES,
  COMPENSATION_METHOD,
} from './debtShared.js'
import { COLLABORATIONS_ENABLED } from '../config/storeProfile.js'

export async function declareInternalDebtCompensationHandler(
  request,
  { db, FieldValue, collaborationsEnabled = COLLABORATIONS_ENABLED },
) {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const actorUid = validateAuthUid(request.auth?.uid)

  // ── 2. Module ouvert ? ─────────────────────────────────────────────────────
  assertCollaborationsEnabled(collaborationsEnabled)

  // ── 3. Payload (allow-list) ────────────────────────────────────────────────
  const payload = validateInputPayload(request.data, ['debtId', 'oppositeDebtId', 'amount', 'idempotencyKey'])
  const debtId = validateDebtId(payload.debtId)
  const oppositeDebtId = validateDebtId(payload.oppositeDebtId)
  const amount = validateSettlementAmount(payload.amount)
  const idempotencyKey = validateIdempotencyKey(payload.idempotencyKey)

  // On ne compense pas une dette avec elle-même.
  assertDistinctDebts(debtId, oppositeDebtId)

  const settlementId = deterministicCompensationId(debtId, actorUid, idempotencyKey)

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
      const txProfileSnap = await t.get(db.doc(`users/${actorUid}`))
      if (!txProfileSnap.exists) {
        throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
      }
      const txProfile = txProfileSnap.data()
      const actorStoreId = validateProfileData(txProfile)

      // a. Les deux dettes.
      const [d1Snap, d2Snap] = await Promise.all([
        t.get(db.doc(`internalDebts/${debtId}`)),
        t.get(db.doc(`internalDebts/${oppositeDebtId}`)),
      ])
      if (!d1Snap.exists || !d2Snap.exists) {
        throw new DealerRequestError('DEBT_NOT_FOUND', 'Dette introuvable.')
      }
      const debt1 = d1Snap.data()
      const debt2 = d2Snap.data()

      // b. C'est la débitrice de D1 qui propose de compenser.
      if (debt1.debtorStoreId !== actorStoreId) {
        throw new DealerRequestError('DEBT_STORE_MISMATCH', "Vous n'êtes pas autorisé sur cette dette.")
      }

      // c. D2 doit lier les deux MÊMES boutiques, en sens inverse. Sans ce
      //    contrôle, on solderait une dette contre la créance d'un tiers.
      validateOppositeDebtPair(debt1, debt2)

      // d. ⚠ IDEMPOTENCE D'ABORD — avant tout calcul de plafond.
      const settlementRef = db.doc(`internalDebts/${debtId}/settlements/${settlementId}`)
      const existingSnap = await t.get(settlementRef)
      if (existingSnap.exists) {
        const existing = existingSnap.data()
        if (
          existing.method === COMPENSATION_METHOD &&
          existing.amount === amount &&
          existing.oppositeDebtId === oppositeDebtId
        ) {
          return { settlementId, idempotent: true }
        }
        throw new DealerRequestError(
          'IDEMPOTENCY_CONFLICT',
          'Une tranche différente existe déjà pour cette action.',
        )
      }

      // e. Les deux dettes doivent être ouvertes.
      const remainingD1 = assertDebtOpen(debt1)
      const remainingD2 = assertDebtOpen(debt2)

      // f. Plafond : les tranches déclarées des DEUX dettes réservent du montant.
      const [pending1Snap, pending2Snap] = await Promise.all([
        t.get(db.collection(`internalDebts/${debtId}/settlements`)
          .where('settlementStatus', '==', SETTLEMENT_STATUSES.DECLARED)),
        t.get(db.collection(`internalDebts/${oppositeDebtId}/settlements`)
          .where('settlementStatus', '==', SETTLEMENT_STATUSES.DECLARED)),
      ])
      const capacity = compensationCapacity({
        remainingD1,
        pendingD1: sumDeclaredAmounts(pending1Snap.docs),
        remainingD2,
        pendingD2: sumDeclaredAmounts(pending2Snap.docs),
      })
      assertCompensationWithinCapacity(amount, capacity)

      // ── Écritures ───────────────────────────────────────────────────────────
      const now = FieldValue.serverTimestamp()

      t.set(settlementRef, {
        debtId,
        oppositeDebtId,
        debtorStoreId: debt1.debtorStoreId,
        creditorStoreId: debt1.creditorStoreId,
        amount,
        method: COMPENSATION_METHOD,
        settlementStatus: SETTLEMENT_STATUSES.DECLARED,
        idempotencyKey,
        previousRemaining: remainingD1,
        newRemaining: null,
        declaredBy: actorUid,
        declaredAt: now,
        confirmedBy: null,
        confirmedAt: null,
        rejectedBy: null,
        rejectedAt: null,
        rejectionReason: null,
      })

      const auditRef = db.collection(`clients/${actorStoreId}/auditLogs`).doc()
      t.set(auditRef, {
        action: 'INTERNAL_DEBT_COMPENSATION_DECLARED',
        actorUid,
        actorEmail: txProfile.email ?? null,
        actorName: txProfile.name ?? null,
        actorRole: 'store_admin',
        actorStoreId,
        debtId,
        oppositeDebtId,
        settlementId,
        amount,
        method: COMPENSATION_METHOD,
        createdAt: now,
      })

      return { settlementId, idempotent: false }
    })
  } catch (err) {
    if (err instanceof DealerRequestError) throw err
    throw new DealerRequestError('TRANSACTION_FAILED', 'La transaction a échoué. Veuillez réessayer.')
  }

  return { success: true, ...result }
}
