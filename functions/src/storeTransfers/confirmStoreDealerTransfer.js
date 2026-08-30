/**
 * Handler de confirmation d'un transfert boutique → dealer par le dealer.
 *
 * Sémantique (sens unique) :
 *   Le dealer confirme la réception → SON inventaire (dealerBalances) est CRÉDITÉ.
 *   Le solde boutique a déjà été débité à la création ; il ne bouge pas ici.
 *
 * db et FieldValue injectés (testabilité sans émulateur Functions).
 */

import { DealerRequestError } from '../errors.js'
import { validateAuthUid, validateInputPayload } from '../dealerRequests/shared.js'
import {
  validateTransferId,
  validateDealerProfile,
  validateTransferType,
  transferBalanceField,
  readDealerBalanceAmount,
  nextFluxAmount,
  resolveTransferNetwork,
} from './shared.js'
import { DEALER_NETWORKS } from '../config/dealerProfile.js'

export async function confirmStoreDealerTransferHandler(request, { db, FieldValue, dealerNetworks = DEALER_NETWORKS }) {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const actorUid = validateAuthUid(request.auth?.uid)

  // ── 2. Payload ─────────────────────────────────────────────────────────────
  const payload = validateInputPayload(request.data, ['transferId'])
  const transferId = validateTransferId(payload.transferId)

  // ── 3. Prévalidation profil dealer ─────────────────────────────────────────
  const profileSnap = await db.doc(`users/${actorUid}`).get()
  if (!profileSnap.exists) {
    throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
  }
  validateDealerProfile(profileSnap.data())

  // ── 4. Transaction atomique : crédit inventaire dealer ─────────────────────
  let result
  try {
    result = await db.runTransaction(async (t) => {
      const txProfileSnap = await t.get(db.doc(`users/${actorUid}`))
      if (!txProfileSnap.exists) {
        throw new DealerRequestError('PROFILE_NOT_FOUND', 'Profil utilisateur introuvable.')
      }
      const txProfile = txProfileSnap.data()
      validateDealerProfile(txProfile)

      const transferRef = db.doc(`storeDealerTransfers/${transferId}`)
      const transferSnap = await t.get(transferRef)
      if (!transferSnap.exists) {
        throw new DealerRequestError('TRANSFER_NOT_FOUND', 'Transfert introuvable.')
      }
      const transfer = transferSnap.data()

      if (transfer.dealerUid !== actorUid) {
        throw new DealerRequestError('TRANSFER_DEALER_MISMATCH', 'Ce transfert ne vous est pas destiné.')
      }
      if (transfer.status !== 'pending') {
        throw new DealerRequestError('TRANSFER_NOT_PENDING', 'Ce transfert a déjà été traité.')
      }
      const field = transferBalanceField(validateTransferType(transfer.transferType))
      // Réseau du transfert (persisté à la création), validé ∈ profil (défense en profondeur).
      const network = resolveTransferNetwork(transfer.network, dealerNetworks)
      const amount = transfer.amount
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw new DealerRequestError('INVALID_TRANSFER_DATA', 'Montant du transfert invalide.')
      }

      // Règle métier : SEUL le retour de stock crédite l'inventaire dealer.
      // L'« Envoi de liquidité » est validé et tracé mais NE crédite PAS la
      // liquidité dealer (la liquidité part vers Orange, hors inventaire suivi).
      const creditsDealer = transfer.transferType === 'return_stock'
      let previousDealerBalance = null
      let newDealerBalance = null
      const now = FieldValue.serverTimestamp()

      // Inventaire dealer — lu DANS TOUS LES CAS, car le compteur « revenu »
      // en a besoin même quand le transfert ne crédite pas l'inventaire.
      // (Une lecture de transaction doit précéder toute écriture.)
      const balRef = db.doc(`dealerBalances/${actorUid}`)
      const balSnap = await t.get(balRef)
      const balData = balSnap.exists ? balSnap.data() : null

      // Compteur « revenu » — avancé POUR LES DEUX TYPES DE RETOUR, alors que
      // seul `return_stock` crédite l'inventaire. Ce n'est pas une incohérence :
      // le compteur mesure ce qui a QUITTÉ LA CAISSE DE LA BOUTIQUE, et la
      // boutique est débitée des deux à la création du transfert. Un envoi de
      // liquidité part vers Orange sans repasser par l'inventaire du dealer —
      // il n'en est pas moins sorti du réseau.
      const revenuCumul = nextFluxAmount(balData, 'revenuCumul', amount)

      if (creditsDealer) {
        previousDealerBalance = readDealerBalanceAmount(balData, field, network)
        newDealerBalance = previousDealerBalance + amount
        if (!Number.isSafeInteger(newDealerBalance)) {
          throw new DealerRequestError('BALANCE_OVERFLOW', 'Le solde résultant dépasse la limite des entiers sûrs.')
        }
        // Crédit dealer — set + merge (crée le document s'il n'existe pas encore,
        // le merge profond préserve l'autre champ : stock ↔ liquidite).
        t.set(balRef, {
          balances: { [network]: { [field]: newDealerBalance } },
          updatedAt: now,
        }, { merge: true })
      }

      // Compteur de flux — écriture séparée de celle du solde, parce que sa
      // règle est différente : elle vaut pour les DEUX types de retour.
      //
      // ⚠ MAIS ELLE NE CRÉE JAMAIS LE DOCUMENT À ELLE SEULE. Un `dealerBalances`
      //   né d'un `flux` sans `balances` ferait passer la garde d'amorçage de
      //   confirmDealerRequest pour « inventaire amorcé », qui lirait alors un
      //   solde à 0 et refuserait tout approvisionnement avec
      //   INSUFFICIENT_DEALER_BALANCE. Un envoi de liquidité sur un dealer non
      //   amorcé bloquerait donc ses ravitaillements — depuis un autre fichier.
      //   D'où la condition : on n'écrit que si le document existe déjà, ou si
      //   le crédit ci-dessus vient de le créer avec ses soldes.
      if (balSnap.exists || creditsDealer) {
        t.set(balRef, {
          flux: { revenuCumul },
          updatedAt: now,
        }, { merge: true })
      }

      // Mise à jour du transfert
      t.update(transferRef, {
        status: 'confirmed',
        updatedAt: now,
        confirmedBy: actorUid,
        confirmedAt: now,
        rejectedBy: null,
        rejectedAt: null,
        rejectionReason: null,
        previousDealerBalance,
        newDealerBalance,
      })

      // Piste d'audit dealer
      const auditRef = db.collection(`dealerBalances/${actorUid}/auditLogs`).doc()
      t.set(auditRef, {
        action: 'STORE_DEALER_TRANSFER_CONFIRMED',
        actorUid,
        actorEmail: txProfile.email ?? null,
        actorName: txProfile.name ?? null,
        actorRole: 'dealer',
        transferId,
        storeId: transfer.storeId,
        storeName: transfer.storeName ?? null,
        transferType: transfer.transferType,
        network,
        amount,
        previousBalance: previousDealerBalance,
        newBalance: newDealerBalance,
        createdAt: now,
      })

      return { previousDealerBalance, newDealerBalance }
    })
  } catch (err) {
    if (err instanceof DealerRequestError) throw err
    throw new DealerRequestError('TRANSACTION_FAILED', 'La transaction a échoué. Veuillez réessayer.')
  }

  return {
    success: true,
    transferId,
    previousDealerBalance: result.previousDealerBalance,
    newDealerBalance: result.newDealerBalance,
  }
}
