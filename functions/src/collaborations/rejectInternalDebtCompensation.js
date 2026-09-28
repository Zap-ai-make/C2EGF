/**
 * Handler de rejet d'une COMPENSATION — boutique créancière de D1.
 *
 * « Je préfère être payée. » La tranche passe `rejected`.
 *
 * ⚠ LES DEUX DETTES RESTENT INTACTES, et AUCUNE tranche miroir n'est écrite :
 *   le miroir n'existe que lorsqu'une compensation aboutit. Comme pour un
 *   règlement rejeté, le montant réservé sur les deux dettes redevient
 *   disponible, puisque seules les tranches `declared` comptent.
 */

import { rejectInternalDebtCompensation } from './rejectInternalDebtShared.js'
import { COLLABORATIONS_ENABLED } from '../config/storeProfile.js'

export async function rejectInternalDebtCompensationHandler(
  request,
  { db, FieldValue, collaborationsEnabled = COLLABORATIONS_ENABLED },
) {
  return rejectInternalDebtCompensation(request, { db, FieldValue, collaborationsEnabled })
}
