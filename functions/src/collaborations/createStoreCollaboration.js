/**
 * Handler de création d'une collaboration inter-boutiques.
 *
 * Sémantique :
 *   La boutique DEMANDEUSE a un client en face d'elle et n'a pas le stock pour le
 *   servir. Elle demande à une boutique FOURNISSEUSE d'exécuter l'opération.
 *
 * ⚠ AUCUN mouvement de solde, AUCUNE dette ici. La création n'engage rien :
 *   toute la mécanique financière est dans confirmStoreCollaboration, parce que
 *   c'est la fournisseuse qui exécute réellement l'opération Mobile Money et elle
 *   seule sait si elle l'a faite.
 *
 * db et FieldValue injectés (testabilité sans émulateur Functions).
 */

import { DealerRequestError } from '../errors.js'
import { validateAuthUid, validateInputPayload, validateProfileData } from '../dealerRequests/shared.js'
import {
  assertCollaborationsEnabled,
  resolveCollaborationNetwork,
  validateOperationType,
  validateCollaborationAmount,
  validateStoreRef,
  validateClientId,
  COLLABORATION_STATUSES,
} from './shared.js'
import { STORE_NETWORKS, COLLABORATIONS_ENABLED } from '../config/storeProfile.js'

export async function createStoreCollaborationHandler(
  request,
  {
    db,
    FieldValue,
    storeNetworks = STORE_NETWORKS,
    collaborationsEnabled = COLLABORATIONS_ENABLED,
  },
) {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const actorUid = validateAuthUid(request.auth?.uid)

  // ── 2. Le module est-il ouvert chez ce client ? ────────────────────────────
  assertCollaborationsEnabled(collaborationsEnabled)

  // ── 3. Forme du payload (allow-list stricte) ───────────────────────────────
  // `network` n'est PAS dans la liste : le réseau est résolu depuis le profil,
  // jamais accepté du client.
  const payload = validateInputPayload(request.data, [
    'clientId',
    'operationType',
    'amount',
    'supplierStoreId',
  ])
  const clientId = validateClientId(payload.clientId)
  const operationType = validateOperationType(payload.operationType)
  const amount = validateCollaborationAmount(payload.amount)
  const supplierStoreId = validateStoreRef(payload.supplierStoreId)
  const network = resolveCollaborationNetwork(null, storeNetworks)

  // ── 4. Prévalidation profil (store_admin actif avec storeId) ───────────────
  const profileSnap = await db.doc(`users/${actorUid}`).get()
  if (!profileSnap.exists) {
    throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
  }
  validateProfileData(profileSnap.data())

  // ── 5. Transaction : relecture autoritative + écriture du document pending ─
  let result
  try {
    result = await db.runTransaction(async (t) => {
      // a. Profil relu dans la transaction — c'est LUI qui fait autorité sur la
      //    boutique demandeuse, jamais un storeId envoyé par le client.
      const txProfileSnap = await t.get(db.doc(`users/${actorUid}`))
      if (!txProfileSnap.exists) {
        throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
      }
      const txProfile = txProfileSnap.data()
      const requestingStoreId = validateProfileData(txProfile)

      // b. On ne se sollicite pas soi-même.
      if (requestingStoreId === supplierStoreId) {
        throw new DealerRequestError(
          'SAME_STORE_COLLABORATION',
          'La boutique fournisseuse doit être différente de la vôtre.',
        )
      }

      // c. Nom de la demandeuse (dénormalisation) — best effort.
      const requestingStoreSnap = await t.get(db.doc(`stores/${requestingStoreId}`))
      const requestingStoreName = requestingStoreSnap.exists
        ? (requestingStoreSnap.data().name ?? null)
        : null

      // d. La fournisseuse doit exister ET être active.
      //    Mono-réseau : toute boutique active opère le réseau, donc l'éligibilité
      //    se réduit à ça — c'est l'analogue du drapeau isProvider d'un profil
      //    multi-réseaux. Le vrai garde-fou financier reste le contrôle de stock
      //    à la confirmation.
      const supplierSnap = await t.get(db.doc(`stores/${supplierStoreId}`))
      if (!supplierSnap.exists) {
        throw new DealerRequestError('SUPPLIER_STORE_NOT_FOUND', 'Boutique fournisseuse introuvable.')
      }
      const supplierData = supplierSnap.data()
      if (supplierData.active !== true) {
        throw new DealerRequestError('SUPPLIER_STORE_INACTIVE', "Cette boutique n'est plus active.")
      }

      // e. Le client doit exister. Nom et prénom sont dénormalisés DEPUIS LA
      //    LECTURE SERVEUR — jamais depuis le payload, qui pourrait afficher à la
      //    fournisseuse un nom qui n'est pas celui du dossier.
      const clientSnap = await t.get(db.doc(`globalClients/${clientId}`))
      if (!clientSnap.exists) {
        throw new DealerRequestError('CLIENT_NOT_FOUND', 'Client introuvable.')
      }
      const clientData = clientSnap.data()

      const now = FieldValue.serverTimestamp()

      // f. Le document de collaboration : un seul, lu des deux côtés.
      const collabRef = db.collection('storeCollaborations').doc()
      t.set(collabRef, {
        requestingStoreId,
        requestingStoreName,
        requestingStoreAdminUid: actorUid,
        supplierStoreId,
        supplierStoreName: supplierData.name ?? null,
        clientId,
        clientNom: clientData.nom ?? null,
        clientPrenom: clientData.prenom ?? null,
        network,
        operationType,
        amount,
        status: COLLABORATION_STATUSES.PENDING,
        previousSupplierBalance: null,
        newSupplierBalance: null,
        debtId: null,
        createdAt: now,
        updatedAt: now,
        confirmedBy: null,
        confirmedAt: null,
        rejectedBy: null,
        rejectedAt: null,
        rejectionReason: null,
      })

      // g. Piste d'audit chez la demandeuse.
      const auditRef = db.collection(`clients/${requestingStoreId}/auditLogs`).doc()
      t.set(auditRef, {
        action: 'STORE_COLLABORATION_CREATED',
        actorUid,
        actorEmail: txProfile.email ?? null,
        actorName: txProfile.name ?? null,
        actorRole: 'store_admin',
        actorStoreId: requestingStoreId,
        collaborationId: collabRef.id,
        supplierStoreId,
        clientId,
        network,
        operationType,
        amount,
        createdAt: now,
      })

      return { collaborationId: collabRef.id }
    })
  } catch (err) {
    if (err instanceof DealerRequestError) throw err
    throw new DealerRequestError('TRANSACTION_FAILED', 'La transaction a échoué. Veuillez réessayer.')
  }

  return { success: true, collaborationId: result.collaborationId }
}
