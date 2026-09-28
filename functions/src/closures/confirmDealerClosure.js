/**
 * Handler de confirmation d'une clôture Dealer par le store_admin.
 *
 * Sémantique :
 *   Le store_admin confirme que les soldes déclarés par le Dealer correspondent
 *   à ce qui a été constaté en boutique. Aucun solde n'est modifié.
 *   Une entrée d'audit est écrite dans clients/{storeId}/auditLogs.
 *
 * db et FieldValue sont injectés (testabilité sans émulateur Functions).
 */

import {
  validateAuthUid,
  validateInputPayload,
} from '../dealerRequests/shared.js'
import {
  confirmDealerClosure,
  validateClosureId,
} from './dealerClosureDecisionShared.js'

export async function confirmDealerClosureHandler(request, { db, FieldValue }) {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const actorUid = validateAuthUid(request.auth?.uid)

  // ── 2. Validation payload ─────────────────────────────────────────────────
  const payload   = validateInputPayload(request.data, ['closureId'])
  const closureId = validateClosureId(payload.closureId)

  await confirmDealerClosure({ actorUid, closureId, db, FieldValue })

  return { success: true, closureId }
}
