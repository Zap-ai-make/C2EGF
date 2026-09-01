/**
 * Handler de confirmation d'une collaboration — LE CŒUR FINANCIER DU MODULE.
 *
 * Toute la mécanique est ici, rien à la création. La boutique FOURNISSEUSE, et
 * elle seule, confirme : c'est elle qui a réellement exécuté l'opération Mobile
 * Money depuis sa SIM.
 *
 * En une seule transaction :
 *   • le solde CÉDÉ par la fournisseuse baisse — son stock sur un dépôt, sa
 *     liquidité sur un retrait ;
 *   • une dette interne naît, toujours de la DEMANDEUSE vers la FOURNISSEUSE ;
 *   • la collaboration passe `confirmed` ;
 *   • une trace de l'opération est écrite dans l'historique de la demandeuse ;
 *   • la piste d'audit est écrite.
 *
 * ⚠ Les soldes de la DEMANDEUSE ne bougent jamais — ni stock, ni liquidité. La
 *   contrepartie est portée par la dette, pas par un second mouvement. La trace
 *   d'historique est donc une TRACE : elle est écrite `Validée`, et rien dans le
 *   rapprochement ne la rejoue (`argentDehors` ne compte que les non terminées).
 *
 * db et FieldValue injectés (testabilité sans émulateur Functions).
 */

import { DealerRequestError } from '../errors.js'
import { validateAuthUid, validateInputPayload, validateProfileData } from '../dealerRequests/shared.js'
import {
  assertCollaborationsEnabled,
  resolveCollaborationNetwork,
  validateCollaborationId,
  validateCollaborationAmount,
  validateOperationType,
  validateStoreRef,
  readStoreBalance,
  supplierResourceField,
  nextSupplierBalance,
  debtDirection,
  COLLABORATION_STATUSES,
} from './shared.js'
import { STORE_NETWORKS, COLLABORATIONS_ENABLED } from '../config/storeProfile.js'

export async function confirmStoreCollaborationHandler(
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

  // ── 2. Module ouvert ? ─────────────────────────────────────────────────────
  assertCollaborationsEnabled(collaborationsEnabled)

  // ── 3. Payload (allow-list) ────────────────────────────────────────────────
  const payload = validateInputPayload(request.data, ['collaborationId'])
  const collaborationId = validateCollaborationId(payload.collaborationId)

  // ── 4. Prévalidation profil ────────────────────────────────────────────────
  const profileSnap = await db.doc(`users/${actorUid}`).get()
  if (!profileSnap.exists) {
    throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
  }
  validateProfileData(profileSnap.data())

  // ── 5. Transaction atomique ────────────────────────────────────────────────
  let result
  try {
    result = await db.runTransaction(async (t) => {
      // ⚠ TOUTES les lectures d'abord : Firestore refuse toute lecture après une
      // écriture dans une même transaction.

      // a. Profil autoritatif.
      const txProfileSnap = await t.get(db.doc(`users/${actorUid}`))
      if (!txProfileSnap.exists) {
        throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
      }
      const txProfile = txProfileSnap.data()
      const actorStoreId = validateProfileData(txProfile)

      // b. La collaboration.
      const collabRef = db.doc(`storeCollaborations/${collaborationId}`)
      const collabSnap = await t.get(collabRef)
      if (!collabSnap.exists) {
        throw new DealerRequestError('COLLABORATION_NOT_FOUND', 'Collaboration introuvable.')
      }
      const collab = collabSnap.data()

      // c. Seule la FOURNISSEUSE confirme. La demandeuse ne peut jamais
      //    s'auto-servir en confirmant sa propre demande.
      if (collab.supplierStoreId !== actorStoreId) {
        throw new DealerRequestError(
          'COLLABORATION_STORE_MISMATCH',
          "Cette collaboration ne vous est pas destinée.",
        )
      }

      // d. Terminalité : un document déjà traité ne se retraite pas. C'est ce qui
      //    empêche un double clic de bouger le stock deux fois.
      if (collab.status !== COLLABORATION_STATUSES.PENDING) {
        throw new DealerRequestError('COLLABORATION_NOT_PENDING', 'Cette collaboration a déjà été traitée.')
      }

      // e. Revalidation des données LUES DANS LE DOCUMENT (pas du payload).
      const operationType = validateOperationType(collab.operationType)
      const amount = validateCollaborationAmount(collab.amount)
      const requestingStoreId = validateStoreRef(collab.requestingStoreId)
      const network = resolveCollaborationNetwork(collab.network, storeNetworks)

      // f. Défense en profondeur : la boutique a pu être désactivée depuis la
      //    création de la demande.
      const actorStoreSnap = await t.get(db.doc(`stores/${actorStoreId}`))
      if (!actorStoreSnap.exists) {
        throw new DealerRequestError('STORE_NOT_FOUND', 'Boutique introuvable.')
      }
      if (actorStoreSnap.data().active !== true) {
        throw new DealerRequestError('STORE_INACTIVE', "Votre boutique n'est plus active.")
      }

      // g. Le solde que la fournisseuse va céder : son STOCK sur un dépôt, sa
      //    LIQUIDITÉ sur un retrait. Tolérant à l'absence, strict sur la valeur.
      const resourceField = supplierResourceField(operationType)
      const balRef = db.doc(`clients/${actorStoreId}/networkBalances/current`)
      const balSnap = await t.get(balRef)
      const previousSupplierBalance = readStoreBalance(
        balSnap.exists ? balSnap.data() : null, network, resourceField,
      )

      // h. Suffisance, puis nouveau solde. La fournisseuse cède dans les deux sens.
      const newSupplierBalance = nextSupplierBalance(operationType, amount, previousSupplierBalance)
      const { debtorStoreId, creditorStoreId } = debtDirection(operationType, {
        requestingStoreId,
        supplierStoreId: actorStoreId,
      })

      // ── Fin des lectures. Écritures à partir d'ici. ──────────────────────────
      const now = FieldValue.serverTimestamp()

      // i. Solde : merge imbriqué sur le SEUL champ cédé du SEUL réseau concerné,
      //    pour ne jamais écraser les autres réseaux ni l'autre champ.
      t.set(
        balRef,
        { balances: { [network]: { [resourceField]: newSupplierBalance } }, updatedAt: now },
        { merge: true },
      )

      // j. La dette — elle n'existe QUE parce qu'une collaboration a été confirmée.
      const debtRef = db.collection('internalDebts').doc()
      const debtorStoreName = debtorStoreId === actorStoreId
        ? (collab.supplierStoreName ?? null)
        : (collab.requestingStoreName ?? null)
      const creditorStoreName = creditorStoreId === actorStoreId
        ? (collab.supplierStoreName ?? null)
        : (collab.requestingStoreName ?? null)

      t.set(debtRef, {
        collaborationId,
        debtorStoreId,
        debtorStoreName,
        creditorStoreId,
        creditorStoreName,
        network,
        operationType,
        resourceField,
        originalAmount: amount,
        settledAmount: 0,
        remainingAmount: amount,
        status: 'open',
        createdAt: now,
        updatedAt: now,
      })

      // j bis. LA TRACE CHEZ LA DEMANDEUSE.
      //
      // Le client s'est présenté chez ELLE : son opération doit se retrouver là
      // où il ira la chercher. Elle est écrite `Validée` — donc terminale, donc
      // ignorée d'`argentDehors`, qui ne somme que les non terminées.
      //
      // ⚠ Elle ne déplace AUCUN solde. C'est un enregistrement, pas un
      //   mouvement : la contrepartie de la demandeuse est portée par la dette.
      //   `collaborationId` la rattache à son origine, et empêche de la prendre
      //   pour une opération que la boutique aurait servie sur ses propres fonds.
      const historyRef = db.collection(`clients/${requestingStoreId}/history`).doc()
      t.set(historyRef, {
        type: operationType === 'deposit' ? 'Dépôt' : 'Retrait',
        statut: 'Validée',
        montant: amount,
        reseau: network,
        clientId: collab.clientId ?? null,
        clientNom: collab.clientNom ?? null,
        clientPrenom: collab.clientPrenom ?? null,
        collaborationId,
        supplierStoreId: actorStoreId,
        supplierStoreName: collab.supplierStoreName ?? null,
        operatorName: collab.requestingStoreName ?? null,
        operatorEmail: null,
        createdAt: now,
        date: now,
      })

      // k. La collaboration devient terminale, et garde la trace de sa filiation.
      t.update(collabRef, {
        status: COLLABORATION_STATUSES.CONFIRMED,
        previousSupplierBalance,
        newSupplierBalance,
        debtId: debtRef.id,
        historyId: historyRef.id,
        confirmedBy: actorUid,
        confirmedAt: now,
        updatedAt: now,
      })

      // l. Piste d'audit chez la fournisseuse (celle dont le solde a bougé).
      const auditRef = db.collection(`clients/${actorStoreId}/auditLogs`).doc()
      t.set(auditRef, {
        action: 'STORE_COLLABORATION_CONFIRMED',
        actorUid,
        actorEmail: txProfile.email ?? null,
        actorName: txProfile.name ?? null,
        actorRole: 'store_admin',
        actorStoreId,
        collaborationId,
        debtId: debtRef.id,
        requestingStoreId,
        supplierStoreId: actorStoreId,
        clientId: collab.clientId ?? null,
        network,
        operationType,
        resourceField,
        amount,
        previousBalance: previousSupplierBalance,
        newBalance: newSupplierBalance,
        createdAt: now,
      })

      return {
        debtId: debtRef.id,
        historyId: historyRef.id,
        resourceField,
        previousSupplierBalance,
        newSupplierBalance,
        debtorStoreId,
        creditorStoreId,
      }
    })
  } catch (err) {
    if (err instanceof DealerRequestError) throw err
    throw new DealerRequestError('TRANSACTION_FAILED', 'La transaction a échoué. Veuillez réessayer.')
  }

  return {
    success: true,
    collaborationId,
    debtId: result.debtId,
    historyId: result.historyId,
    resourceField: result.resourceField,
    previousSupplierBalance: result.previousSupplierBalance,
    newSupplierBalance: result.newSupplierBalance,
    debtorStoreId: result.debtorStoreId,
    creditorStoreId: result.creditorStoreId,
  }
}
