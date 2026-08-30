/**
 * Handler de déclaration d'une tranche de remboursement — boutique DÉBITRICE.
 *
 * ⚠ CE HANDLER N'IMPUTE RIEN. La dette n'est pas modifiée, aucun solde ne bouge.
 *   Il écrit une tranche `declared` qui RÉSERVE du montant, en attente de la
 *   confirmation de la créancière. C'est elle qui décide si l'argent est arrivé.
 *
 * ⚠ ORDRE IMPÉRATIF : le court-circuit d'idempotence doit PRÉCÉDER le calcul du
 *   reste disponible. Sinon la tranche déjà écrite se compterait elle-même dans
 *   les montants réservés, et un simple retour arrière du navigateur ferait
 *   échouer un retry légitime en SETTLEMENT_EXCEEDS_REMAINING au lieu d'être un
 *   no-op silencieux.
 */

import { DealerRequestError } from '../errors.js'
import { validateAuthUid, validateInputPayload, validateProfileData } from '../dealerRequests/shared.js'
import { assertCollaborationsEnabled } from './shared.js'
import {
  validateDebtId,
  validateSettlementAmount,
  validateSettlementMethod,
  validateIdempotencyKey,
  deterministicSettlementId,
  assertDebtOpen,
  sumDeclaredAmounts,
  availableToDeclare,
  SETTLEMENT_STATUSES,
} from './debtShared.js'
import { COLLABORATIONS_ENABLED, DEBT_SETTLEMENT_METHODS } from '../config/storeProfile.js'

export async function declareInternalDebtSettlementHandler(
  request,
  {
    db,
    FieldValue,
    collaborationsEnabled = COLLABORATIONS_ENABLED,
    settlementMethods = DEBT_SETTLEMENT_METHODS,
  },
) {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const actorUid = validateAuthUid(request.auth?.uid)

  // ── 2. Module ouvert ? ─────────────────────────────────────────────────────
  assertCollaborationsEnabled(collaborationsEnabled)

  // ── 3. Payload (allow-list) ────────────────────────────────────────────────
  const payload = validateInputPayload(request.data, ['debtId', 'amount', 'method', 'idempotencyKey'])
  const debtId = validateDebtId(payload.debtId)
  const amount = validateSettlementAmount(payload.amount)
  const method = validateSettlementMethod(payload.method, settlementMethods)
  const idempotencyKey = validateIdempotencyKey(payload.idempotencyKey)

  // ── 4. Identifiant déterministe — socle de l'idempotence ──────────────────
  const settlementId = deterministicSettlementId(debtId, actorUid, idempotencyKey)

  // ── 5. Prévalidation profil ────────────────────────────────────────────────
  const profileSnap = await db.doc(`users/${actorUid}`).get()
  if (!profileSnap.exists) {
    throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
  }
  validateProfileData(profileSnap.data())

  // ── 6. Transaction ─────────────────────────────────────────────────────────
  let result
  try {
    result = await db.runTransaction(async (t) => {
      // a. Profil autoritatif.
      const txProfileSnap = await t.get(db.doc(`users/${actorUid}`))
      if (!txProfileSnap.exists) {
        throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
      }
      const txProfile = txProfileSnap.data()
      const actorStoreId = validateProfileData(txProfile)

      // b. La dette.
      const debtRef = db.doc(`internalDebts/${debtId}`)
      const debtSnap = await t.get(debtRef)
      if (!debtSnap.exists) {
        throw new DealerRequestError('DEBT_NOT_FOUND', 'Dette introuvable.')
      }
      const debt = debtSnap.data()

      // c. Seule la DÉBITRICE déclare : c'est elle qui rembourse.
      if (debt.debtorStoreId !== actorStoreId) {
        throw new DealerRequestError('DEBT_STORE_MISMATCH', "Vous n'êtes pas autorisé sur cette dette.")
      }

      // d. ⚠ IDEMPOTENCE D'ABORD — avant tout calcul de reste dû.
      const settlementRef = db.doc(`internalDebts/${debtId}/settlements/${settlementId}`)
      const existingSnap = await t.get(settlementRef)
      if (existingSnap.exists) {
        const existing = existingSnap.data()
        if (existing.amount === amount && existing.method === method) {
          // Rejeu exact : no-op, on rend le même identifiant.
          return { settlementId, idempotent: true }
        }
        throw new DealerRequestError(
          'IDEMPOTENCY_CONFLICT',
          'Une tranche différente existe déjà pour cette action.',
        )
      }

      // e. La dette doit encore être ouverte.
      const remainingAmount = assertDebtOpen(debt)

      // f. Réservation : les tranches déjà déclarées immobilisent du montant.
      const declaredSnap = await t.get(
        db.collection(`internalDebts/${debtId}/settlements`)
          .where('settlementStatus', '==', SETTLEMENT_STATUSES.DECLARED),
      )
      const pending = sumDeclaredAmounts(declaredSnap.docs)
      const available = availableToDeclare(remainingAmount, pending)
      if (amount > available) {
        throw new DealerRequestError(
          'SETTLEMENT_EXCEEDS_REMAINING',
          'Le montant dépasse le reste dû (des règlements sont peut-être déjà en attente).',
        )
      }

      // ── Fin des lectures. ───────────────────────────────────────────────────
      const now = FieldValue.serverTimestamp()

      // g. La tranche. debtorStoreId/creditorStoreId sont DÉNORMALISÉS ici :
      //    c'est ce qui rend possible le compteur collection-group du badge, et
      //    ce qui distingue ces documents des `settlements` du moteur de
      //    transactions client, qui portent le même nom de sous-collection.
      t.set(settlementRef, {
        debtId,
        debtorStoreId: debt.debtorStoreId,
        creditorStoreId: debt.creditorStoreId,
        amount,
        method,
        settlementStatus: SETTLEMENT_STATUSES.DECLARED,
        idempotencyKey,
        previousRemaining: remainingAmount,
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
        action: 'INTERNAL_DEBT_SETTLEMENT_DECLARED',
        actorUid,
        actorEmail: txProfile.email ?? null,
        actorName: txProfile.name ?? null,
        actorRole: 'store_admin',
        actorStoreId,
        debtId,
        settlementId,
        amount,
        method,
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
