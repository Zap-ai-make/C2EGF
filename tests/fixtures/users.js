/**
 * Fixtures d'utilisateurs fictifs pour les tests.
 * Structure basée sur firestore.rules lignes 79-95 et AuthContext.jsx.
 * Aucun import depuis src/. Aucun import Firebase.
 * Aucun UID réel Firebase.
 */

import { storeA, storeB } from './stores.js'

/** Administrateur de la boutique A — rôle store_admin, actif */
export const storeAAdmin = {
  uid: 'uid-admin-aaa',
  role: 'store_admin',
  active: true,
  storeId: storeA.id,
  storeName: storeA.name,
  lastLogin: '2025-01-15T09:00:00.000Z',
}

/** Membre de la boutique A — rôle member, actif */
export const storeAMember = {
  uid: 'uid-member-aaa',
  role: 'member',
  active: true,
  storeId: storeA.id,
  storeName: storeA.name,
  lastLogin: '2025-01-15T08:00:00.000Z',
}

/** Administrateur de la boutique B — rôle store_admin, actif */
export const storeBAdmin = {
  uid: 'uid-admin-bbb',
  role: 'store_admin',
  active: true,
  storeId: storeB.id,
  storeName: storeB.name,
  lastLogin: '2025-01-15T09:00:00.000Z',
}

/** Utilisateur désactivé de la boutique A — active: false */
export const inactiveUser = {
  uid: 'uid-inactive-aaa',
  role: 'member',
  active: false,
  storeId: storeA.id,
  storeName: storeA.name,
  lastLogin: '2025-01-10T08:00:00.000Z',
}

/**
 * Utilisateur d'une boutique non reconnue — pour les tests de refus d'accès.
 * storeId arbitraire qui n'est ni storeA.id ni storeB.id.
 */
export const unauthorizedUser = {
  uid: 'uid-unauthorized-zzz',
  role: 'member',
  active: true,
  storeId: 'store-unauthorized-zzz',
  storeName: 'Boutique Inconnue',
  lastLogin: '2025-01-15T08:00:00.000Z',
}
