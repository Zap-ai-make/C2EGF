/**
 * Handler de rejet d'une tranche — boutique CRÉANCIÈRE.
 *
 * « Je n'ai pas reçu cet argent. » La tranche passe `rejected`.
 *
 * ⚠ LA DETTE N'EST PAS MODIFIÉE, aucun solde ne bouge. Effet de bord attendu et
 *   voulu : le montant que cette tranche RÉSERVAIT redevient disponible, puisque
 *   seules les tranches `declared` comptent dans la réservation. La débitrice
 *   peut donc immédiatement redéclarer.
 *
 * Une tranche rejetée ne rouvre rien et n'est jamais réactivable : pour réessayer,
 * la débitrice en déclare une nouvelle, avec une nouvelle clé d'idempotence.
 */

import { rejectInternalDebtSettlement } from './rejectInternalDebtShared.js'
import { COLLABORATIONS_ENABLED } from '../config/storeProfile.js'

export async function rejectInternalDebtSettlementHandler(
  request,
  { db, FieldValue, collaborationsEnabled = COLLABORATIONS_ENABLED },
) {
  return rejectInternalDebtSettlement(request, { db, FieldValue, collaborationsEnabled })
}
