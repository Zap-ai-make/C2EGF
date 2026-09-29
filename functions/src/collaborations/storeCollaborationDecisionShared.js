import { DealerRequestError } from '../errors.js'
import {
  readValidatedProfile,
  validateProfileData,
} from '../dealerRequests/shared.js'
import { COLLABORATION_STATUSES } from './shared.js'

export async function readPendingStoreCollaborationDecisionContext({
  db,
  transaction,
  actorUid,
  collaborationId,
}) {
  const {
    profile: txProfile,
    validationResult: actorStoreId,
  } = await readValidatedProfile(db, actorUid, validateProfileData, transaction)

  const collabRef = db.doc(`storeCollaborations/${collaborationId}`)
  const collabSnap = await transaction.get(collabRef)
  if (!collabSnap.exists) {
    throw new DealerRequestError('COLLABORATION_NOT_FOUND', 'Collaboration introuvable.')
  }
  const collab = collabSnap.data()

  if (collab.supplierStoreId !== actorStoreId) {
    throw new DealerRequestError(
      'COLLABORATION_STORE_MISMATCH',
      'Cette collaboration ne vous est pas destinée.',
    )
  }
  if (collab.status !== COLLABORATION_STATUSES.PENDING) {
    throw new DealerRequestError(
      'COLLABORATION_NOT_PENDING',
      'Cette collaboration a déjà été traitée.',
    )
  }

  return { actorStoreId, collab, collabRef, txProfile }
}
