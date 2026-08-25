/**
 * Fixtures de transactions fictives pour les tests.
 * Structure basée sur firestore.rules validTransaction() (lignes 35-40),
 * validStoreScopedTransaction(), validStatus(), isPendingStatus(),
 * et les collections clients/{storeId}/drafts et clients/{storeId}/history.
 * Aucun import depuis src/. Aucun import Firebase.
 * Toutes les dates sont des chaînes ISO fixes ou new Date() avec littéral explicite.
 * Aucun Date.now(), aucun new Date() sans argument.
 */

import { storeA, storeB } from './stores.js'
import { clientStoreA, clientStoreB } from './clients.js'

/** Date fixe de référence — ne jamais utiliser Date.now() ni new Date() sans argument */
export const FIXED_DATE = '2025-01-15T10:00:00.000Z'
export const FIXED_NOW = new Date('2025-01-15T10:00:00.000Z')

/** Date antérieure fixe — pour tester le tri chronologique */
export const FIXED_DATE_EARLIER = '2025-01-10T08:00:00.000Z'

/**
 * Transaction en attente (draft) — type 'Dépôt', statut 'Non Terminées'.
 * Conforme à : validTransaction + isPendingStatus + validStoreScopedTransaction.
 */
export const transactionPending = {
  id: 'txn-pending-aaa',
  type: 'Dépôt',
  montant: 5000,
  clientId: clientStoreA.id,
  statut: 'Non Terminées',
  storeId: storeA.id,
  reseau: 'Orange',
  createdAt: FIXED_DATE,
}

/**
 * Transaction validée (history) — type 'Retrait', statut 'Validée'.
 * Conforme à : validTransaction + validStatus + !isPendingStatus.
 */
export const transactionValidated = {
  id: 'txn-validated-aaa',
  type: 'Retrait',
  montant: 2000,
  clientId: clientStoreA.id,
  statut: 'Validée',
  storeId: storeA.id,
  reseau: 'Moov',
  createdAt: FIXED_DATE,
}

/**
 * Transaction annulée (history) — type 'Crédit', statut 'Annulée'.
 * Conforme à : validTransaction + validStatus + !isPendingStatus.
 */
export const transactionCancelled = {
  id: 'txn-cancelled-aaa',
  type: 'Crédit',
  montant: 1000,
  clientId: clientStoreA.id,
  statut: 'Annulée',
  storeId: storeA.id,
  reseau: 'Telecel',
  createdAt: FIXED_DATE,
}

/**
 * Transaction de la boutique B (history) — pour tester l'isolation inter-boutiques.
 * statut 'Validée', type 'Dépôt'.
 */
export const transactionStoreB = {
  id: 'txn-validated-bbb',
  type: 'Dépôt',
  montant: 3000,
  clientId: clientStoreB.id,
  statut: 'Validée',
  storeId: storeB.id,
  reseau: 'Orange',
  createdAt: FIXED_DATE,
}

/**
 * Transaction avec une date antérieure explicite — pour tester le tri chronologique.
 * Date différente de FIXED_DATE pour permettre la vérification d'ordre.
 */
export const transactionWithFixedDate = {
  id: 'txn-earlier-aaa',
  type: 'Dépôt',
  montant: 4000,
  clientId: clientStoreA.id,
  statut: 'Validée',
  storeId: storeA.id,
  reseau: 'Coris',
  createdAt: FIXED_DATE_EARLIER,
}
