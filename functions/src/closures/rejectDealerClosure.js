/**
 * Handler de rejet d'une clôture Dealer par le store_admin.
 *
 * Sémantique :
 *   Le store_admin rejette la clôture avec un motif obligatoire.
 *   Aucun solde n'est modifié.
 *   Une entrée d'audit est écrite dans clients/{storeId}/auditLogs.
 *
 * db et FieldValue sont injectés (testabilité sans émulateur Functions).
 */

import {
  validateAuthUid,
  validateInputPayload,
  validateRejectionReason,
} from '../dealerRequests/shared.js'
import {
  rejectDealerClosure,
  validateClosureId,
} from './dealerClosureDecisionShared.js'

export async function rejectDealerClosureHandler(request, { db, FieldValue }) {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const actorUid = validateAuthUid(request.auth?.uid)

  // ── 2. Validation payload ─────────────────────────────────────────────────
  const payload         = validateInputPayload(request.data, ['closureId', 'rejectionReason'])
  const closureId       = validateClosureId(payload.closureId)
  const rejectionReason = validateRejectionReason(payload.rejectionReason)

  await rejectDealerClosure({ actorUid, closureId, rejectionReason, db, FieldValue })

  return { success: true, closureId }
}
