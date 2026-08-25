/**
 * Fixtures de clients fictifs pour les tests.
 * Structure basée sur firestore.rules validClient() (lignes 24-33) et les collections
 * globalClients et clients/{storeId}.
 * Aucun import depuis src/. Aucun import Firebase.
 * Aucune donnée personnelle réelle.
 */

import { storeA, storeB } from './stores.js'

/** Client local enregistré dans la sous-collection clients/{storeA.id} */
export const clientStoreA = {
  id: 'client-local-aaa',
  nom: 'Alpha',
  prenom: 'Client',
  storeId: storeA.id,
  dateAjout: '15/01/2025',
}

/** Client local enregistré dans la sous-collection clients/{storeB.id} */
export const clientStoreB = {
  id: 'client-local-bbb',
  nom: 'Beta',
  prenom: 'Client',
  storeId: storeB.id,
  dateAjout: '15/01/2025',
}

/**
 * Client global enregistré par la boutique A.
 * Champs conformes à validClient() : nom, prenom, registeredStoreId, registeredStoreName.
 */
export const globalClientStoreA = {
  id: 'gclient-aaa',
  nom: 'Global',
  prenom: 'Alpha',
  registeredStoreId: storeA.id,
  registeredStoreName: storeA.name,
  dateAjout: '15/01/2025',
}

/**
 * Client global enregistré par la boutique B.
 * Champs conformes à validClient() : nom, prenom, registeredStoreId, registeredStoreName.
 */
export const globalClientStoreB = {
  id: 'gclient-bbb',
  nom: 'Global',
  prenom: 'Beta',
  registeredStoreId: storeB.id,
  registeredStoreName: storeB.name,
  dateAjout: '15/01/2025',
}
