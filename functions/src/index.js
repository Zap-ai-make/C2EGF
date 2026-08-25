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

// Garde idempotente : évite "App named '[DEFAULT]' already exists" lors des imports
// dans les tests d'intégration (TC-036) qui s'exécutent après TC-035 dans le même processus.
if (!getApps().length) initializeApp()
const db = getFirestore()
const deps = { db, FieldValue }

export const confirmDealerRequest = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  wrapCallable(confirmDealerRequestHandler, deps)
)

export const rejectDealerRequest = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  wrapCallable(rejectDealerRequestHandler, deps)
)

export const createDealerClosure = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  wrapCallable(createDealerClosureHandler, deps)
)

export const confirmDealerClosure = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  wrapCallable(confirmDealerClosureHandler, deps)
)

export const rejectDealerClosure = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  wrapCallable(rejectDealerClosureHandler, deps)
)

export const addTransactionPayment = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  wrapCallable(addTransactionPaymentHandler, deps)
)

export const addTransactionRefund = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  wrapCallable(addTransactionRefundHandler, deps)
)

export const createStoreDealerTransfer = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  wrapCallable(createStoreDealerTransferHandler, deps)
)

export const confirmStoreDealerTransfer = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  wrapCallable(confirmStoreDealerTransferHandler, deps)
)

export const rejectStoreDealerTransfer = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  wrapCallable(rejectStoreDealerTransferHandler, deps)
)

export const replenishDealerInventory = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  wrapCallable(replenishDealerInventoryHandler, deps)
)

export const decreaseDealerInventory = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  wrapCallable(decreaseDealerInventoryHandler, deps)
)

export const createPartnerDeposit = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  wrapCallable(createPartnerDepositHandler, deps)
)
