/**
 * Entry point des Cloud Functions V2.
 *
 * Région : europe-west1 — proximité géographique Afrique de l'Ouest (FCFA).
 *
 * Architecture :
 *   - Les handlers métier (confirm/reject) sont dans ./dealerRequests/.
 *   - Ce fichier initialise Admin SDK et enveloppe les handlers en onCall.
 *   - La conversion DealerRequestError → HttpsError est centralisée dans ./callable.js.
 *
 * Ne pas déployer sans audit de sécurité complet.
 * Utiliser exclusivement les émulateurs pendant l'audit : demo-akayis-test.
 */

import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { onCall } from 'firebase-functions/v2/https'
import { wrapCallable } from './callable.js'
import { confirmDealerRequestHandler } from './dealerRequests/confirmDealerRequest.js'
import { rejectDealerRequestHandler } from './dealerRequests/rejectDealerRequest.js'
import { createDealerClosureHandler } from './closures/createDealerClosure.js'
import { confirmDealerClosureHandler } from './closures/confirmDealerClosure.js'
import { rejectDealerClosureHandler } from './closures/rejectDealerClosure.js'
import { addTransactionPaymentHandler } from './settlements/addTransactionPayment.js'
import { addTransactionRefundHandler } from './settlements/addTransactionRefund.js'
import { createStoreDealerTransferHandler } from './storeTransfers/createStoreDealerTransfer.js'
import { confirmStoreDealerTransferHandler } from './storeTransfers/confirmStoreDealerTransfer.js'
import { rejectStoreDealerTransferHandler } from './storeTransfers/rejectStoreDealerTransfer.js'
import { replenishDealerInventoryHandler } from './storeTransfers/replenishDealerInventory.js'
import { decreaseDealerInventoryHandler } from './storeTransfers/decreaseDealerInventory.js'
import { createPartnerDepositHandler } from './storeTransfers/createPartnerDeposit.js'
import { createStoreCollaborationHandler } from './collaborations/createStoreCollaboration.js'
import { confirmStoreCollaborationHandler } from './collaborations/confirmStoreCollaboration.js'
import { rejectStoreCollaborationHandler } from './collaborations/rejectStoreCollaboration.js'
import { listStoreCollaborationProvidersHandler } from './collaborations/listStoreCollaborationProviders.js'
import { declareInternalDebtSettlementHandler } from './collaborations/declareInternalDebtSettlement.js'
import { confirmInternalDebtSettlementHandler } from './collaborations/confirmInternalDebtSettlement.js'
import { rejectInternalDebtSettlementHandler } from './collaborations/rejectInternalDebtSettlement.js'
import { declareInternalDebtCompensationHandler } from './collaborations/declareInternalDebtCompensation.js'
import { confirmInternalDebtCompensationHandler } from './collaborations/confirmInternalDebtCompensation.js'
import { rejectInternalDebtCompensationHandler } from './collaborations/rejectInternalDebtCompensation.js'

// Garde idempotente : évite "App named '[DEFAULT]' already exists" lors des imports
// dans les tests d'intégration (TC-036) qui s'exécutent après TC-035 dans le même processus.
if (!getApps().length) initializeApp()
const db = getFirestore()
const deps = { db, FieldValue }

/**
 * Les options communes des 23 callables.
 *
 * POURQUOI UN PLAFOND D'INSTANCES
 * ──────────────────────────────
 * Sans `maxInstances`, une function de 2e génération peut monter à 100 instances.
 * Multiplié par 23 callables et un vCPU chacune, cela réserve 2 300 vCPU dans la
 * région — au-delà du quota d'un projet neuf. Trois functions ont échoué à se
 * créer pour cette raison au premier déploiement, avec un message qui ne parle
 * que de CPU et jamais d'instances.
 *
 * Mais la vraie raison n'est pas le quota, c'est LA FACTURE. Sur un plan Blaze,
 * un plafond absent signifie qu'un bug, une boucle de réessai côté client ou un
 * appel répété peuvent ouvrir cent conteneurs et les faire payer. Ce produit sert
 * une poignée de boutiques : dix instances simultanées par callable sont déjà
 * très au-dessus du besoin, et bornent le pire des cas.
 *
 * Un seul objet plutôt que la même accolade recopiée vingt-trois fois : le jour
 * où la région ou le plafond change, il change à UN endroit. TC-036 [WRA-08] et
 * [WRA-09] vérifient que tous les callables les portent.
 */
const CALLABLE = Object.freeze({
  region: 'europe-west1',
  enforceAppCheck: false,
  maxInstances: 10,
})

export const confirmDealerRequest = onCall(
  CALLABLE,
  wrapCallable(confirmDealerRequestHandler, deps)
)

export const rejectDealerRequest = onCall(
  CALLABLE,
  wrapCallable(rejectDealerRequestHandler, deps)
)

export const createDealerClosure = onCall(
  CALLABLE,
  wrapCallable(createDealerClosureHandler, deps)
)

export const confirmDealerClosure = onCall(
  CALLABLE,
  wrapCallable(confirmDealerClosureHandler, deps)
)

export const rejectDealerClosure = onCall(
  CALLABLE,
  wrapCallable(rejectDealerClosureHandler, deps)
)

export const addTransactionPayment = onCall(
  CALLABLE,
  wrapCallable(addTransactionPaymentHandler, deps)
)

export const addTransactionRefund = onCall(
  CALLABLE,
  wrapCallable(addTransactionRefundHandler, deps)
)

export const createStoreDealerTransfer = onCall(
  CALLABLE,
  wrapCallable(createStoreDealerTransferHandler, deps)
)

export const confirmStoreDealerTransfer = onCall(
  CALLABLE,
  wrapCallable(confirmStoreDealerTransferHandler, deps)
)

export const rejectStoreDealerTransfer = onCall(
  CALLABLE,
  wrapCallable(rejectStoreDealerTransferHandler, deps)
)

export const replenishDealerInventory = onCall(
  CALLABLE,
  wrapCallable(replenishDealerInventoryHandler, deps)
)

export const decreaseDealerInventory = onCall(
  CALLABLE,
  wrapCallable(decreaseDealerInventoryHandler, deps)
)

export const createPartnerDeposit = onCall(
  CALLABLE,
  wrapCallable(createPartnerDepositHandler, deps)
)

// ── Collaborations inter-boutiques ──────────────────────────────────────────
// Une boutique à court de stock fait exécuter l'opération par une consœur ; la
// contrepartie devient une dette interne. Toute la mécanique financière est dans
// confirmStoreCollaboration : la création n'engage aucun solde.

export const createStoreCollaboration = onCall(
  CALLABLE,
  wrapCallable(createStoreCollaborationHandler, deps)
)

export const confirmStoreCollaboration = onCall(
  CALLABLE,
  wrapCallable(confirmStoreCollaborationHandler, deps)
)

export const rejectStoreCollaboration = onCall(
  CALLABLE,
  wrapCallable(rejectStoreCollaborationHandler, deps)
)

export const listStoreCollaborationProviders = onCall(
  CALLABLE,
  wrapCallable(listStoreCollaborationProvidersHandler, deps)
)

// ── Dettes internes : remboursement par tranches ────────────────────────────
// La DÉBITRICE déclare (n'impute rien, réserve du montant) ; la CRÉANCIÈRE
// confirme (impute, et déplace du float si la méthode est du Mobile Money) ou
// rejette (libère la réservation, dette intacte).

export const declareInternalDebtSettlement = onCall(
  CALLABLE,
  wrapCallable(declareInternalDebtSettlementHandler, deps)
)

export const confirmInternalDebtSettlement = onCall(
  CALLABLE,
  wrapCallable(confirmInternalDebtSettlementHandler, deps)
)

export const rejectInternalDebtSettlement = onCall(
  CALLABLE,
  wrapCallable(rejectInternalDebtSettlementHandler, deps)
)

// ── Dettes internes : compensation ──────────────────────────────────────────
// Solder une dette D1 (A→B) contre la dette opposée D2 (B→A). Aucun float ne
// bouge : deux créances s'annulent. La confirmation impute les DEUX dettes et
// écrit une tranche miroir sous D2.

export const declareInternalDebtCompensation = onCall(
  CALLABLE,
  wrapCallable(declareInternalDebtCompensationHandler, deps)
)

export const confirmInternalDebtCompensation = onCall(
  CALLABLE,
  wrapCallable(confirmInternalDebtCompensationHandler, deps)
)

export const rejectInternalDebtCompensation = onCall(
  CALLABLE,
  wrapCallable(rejectInternalDebtCompensationHandler, deps)
)
