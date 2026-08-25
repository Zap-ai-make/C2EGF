/**
 * TC-037 — Test HTTP callable end-to-end via Functions Emulator
 *
 * Ce test utilise le vrai SDK client Firebase (firebase@12.x) pour appeler
 * les Cloud Functions via httpsCallable, exactement comme le ferait le navigateur.
 *
 * Prérequis :
 *   firebase emulators:exec --only auth,firestore,functions --project demo-akayis-test
 *   → npm run test:functions:e2e
 *
 * Émulateurs requis :
 *   Auth     : localhost:9099
 *   Firestore: localhost:8080
 *   Functions: localhost:5001
 *
 * Garde anti-production :
 *   Vérifie FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST, GCLOUD_PROJECT
 *   avant toute initialisation. Échoue immédiatement hors émulateur.
 *
 * Architecture :
 *   - Admin SDK : seed Firestore + création utilisateurs Auth
 *   - Client SDK : signIn + httpsCallable (ID token dans Authorization)
 *   - Admin SDK : vérification état Firestore après appel
 *
 * Projet exclusif : demo-akayis-test
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest'

// Admin SDK
import { initializeApp as initAdminApp, getApps as getAdminApps, deleteApp as deleteAdminApp } from 'firebase-admin/app'
import { getFirestore, FieldValue }  from 'firebase-admin/firestore'
import { getAuth as getAdminAuth }  from 'firebase-admin/auth'

// Client SDK
import { initializeApp as initClientApp, getApps as getClientApps, deleteApp as deleteClientApp } from 'firebase/app'
import { getAuth as getClientAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { getFirestore as getClientFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions'

// ─────────────────────────────────────────────────────────────────────────────
// Garde anti-production (exécution sans émulateurs → échec immédiat)
// ─────────────────────────────────────────────────────────────────────────────

const PROJECT_ID        = process.env.GCLOUD_PROJECT
const FIRESTORE_HOST    = process.env.FIRESTORE_EMULATOR_HOST
const AUTH_HOST         = process.env.FIREBASE_AUTH_EMULATOR_HOST

if (!FIRESTORE_HOST) {
  throw new Error(
    'SÉCURITÉ : FIRESTORE_EMULATOR_HOST non défini. ' +
    'Lancer via : npm run test:functions:e2e'
  )
}
if (!AUTH_HOST) {
  throw new Error(
    'SÉCURITÉ : FIREBASE_AUTH_EMULATOR_HOST non défini. ' +
    'Lancer via : npm run test:functions:e2e'
  )
}
if (!PROJECT_ID) {
  throw new Error(
    'SÉCURITÉ : GCLOUD_PROJECT non défini. ' +
    'Lancer via : npm run test:functions:e2e'
  )
}
if (!PROJECT_ID.startsWith('demo-')) {
  throw new Error(`SÉCURITÉ : GCLOUD_PROJECT non-demo : "${PROJECT_ID}"`)
}
if (PROJECT_ID !== 'demo-akayis-test') {
  throw new Error(`SÉCURITÉ : GCLOUD_PROJECT doit être "demo-akayis-test". Reçu : "${PROJECT_ID}"`)
}
if (PROJECT_ID === 'taofic-ajagbe') {
  throw new Error('SÉCURITÉ : projectId de production interdit.')
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup Admin SDK
// ─────────────────────────────────────────────────────────────────────────────

let adminApp
let adminDb
let adminAuth
let clientApp
let clientFunctions

beforeAll(() => {
  if (getAdminApps().length === 0) {
    adminApp = initAdminApp({ projectId: PROJECT_ID })
  } else {
    adminApp = getAdminApps()[0]
  }
  adminDb   = getFirestore(adminApp)
  adminAuth = getAdminAuth(adminApp)

  // Client SDK — valeurs de config factices (émulateur seul)
  if (getClientApps().length === 0) {
    clientApp = initClientApp({
      apiKey:    'demo-key',
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
    }, 'e2e-client')
  } else {
    clientApp = getClientApps().find(a => a.name === 'e2e-client') || getClientApps()[0]
  }

  const clientAuth       = getClientAuth(clientApp)
  const clientFirestore  = getClientFirestore(clientApp)
  clientFunctions        = getFunctions(clientApp, 'europe-west1')

  connectAuthEmulator(clientAuth, `http://${AUTH_HOST}`, { disableWarnings: true })
  connectFirestoreEmulator(clientFirestore, 'localhost', 8080)
  connectFunctionsEmulator(clientFunctions, 'localhost', 5001)
})

afterAll(async () => {
  if (clientApp) {
    try { await deleteClientApp(clientApp) } catch { /* ignoré */ }
  }
  if (adminApp) {
    try { await deleteAdminApp(adminApp) } catch { /* ignoré */ }
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function clearFirestoreEmulator() {
  const url = `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`
  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Impossible de vider Firestore : HTTP ${res.status}`)
}

async function clearAuthEmulator() {
  const url = `http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`
  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Impossible de vider Auth : HTTP ${res.status}`)
}

beforeEach(async () => {
  await clearFirestoreEmulator()
  await clearAuthEmulator()
})

async function createAuthUser(uid, email, password) {
  await adminAuth.createUser({ uid, email, password })
}

async function seedProfile(uid, data) {
  await adminDb.doc(`users/${uid}`).set(data)
}

async function seedRequest(reqId, data) {
  await adminDb.doc(`dealerRequests/${reqId}`).set(data)
}

async function seedBalance(storeId, data) {
  await adminDb.doc(`clients/${storeId}/networkBalances/current`).set(data)
}

async function signInClient(email, password) {
  const clientAuth = getClientAuth(clientApp)
  return signInWithEmailAndPassword(clientAuth, email, password)
}

async function signOutClient() {
  const clientAuth = getClientAuth(clientApp)
  return signOut(clientAuth)
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const STORE_ADMIN_UID     = 'e2e-store-admin'
const DEALER_UID          = 'e2e-dealer'
const OTHER_ADMIN_UID     = 'e2e-other-admin'
const STORE_A             = 'store-e2e-A'
const STORE_B             = 'store-e2e-B'
const ADMIN_EMAIL         = 'store-admin@e2e.test'
const ADMIN_PASSWORD      = 'E2ePassword123!'
const DEALER_EMAIL        = 'dealer@e2e.test'
const DEALER_PASSWORD     = 'E2eDealer123!'
const OTHER_ADMIN_EMAIL   = 'other-admin@e2e.test'
const OTHER_ADMIN_PASSWORD = 'E2eOther123!'

const ADMIN_PROFILE = {
  role: 'store_admin', active: true, storeId: STORE_A,
  email: ADMIN_EMAIL, name: 'Admin E2E',
}
const DEALER_PROFILE = {
  role: 'dealer', active: true, storeId: STORE_A,
  email: DEALER_EMAIL, name: 'Dealer E2E',
}
const OTHER_ADMIN_PROFILE = {
  role: 'store_admin', active: true, storeId: STORE_B,
  email: OTHER_ADMIN_EMAIL, name: 'Other Admin E2E',
}

const BASE_REQ = {
  dealerUid:       DEALER_UID,
  dealerEmail:     DEALER_EMAIL,
  dealerName:      'Dealer E2E',
  requestType:     'stock_add',
  network:         'Orange',
  amount:          10000,
  status:          'pending',
  targetStoreId:   STORE_A,
  targetStoreName: 'Boutique E2E',
  confirmedBy:     null, confirmedAt:     null,
  rejectedBy:      null, rejectedAt:      null,
  rejectionReason: null,
  previousBalance: null, newBalance:      null,
  createdAt:       new Date('2024-01-01T10:00:00Z'),
  updatedAt:       new Date('2024-01-01T10:00:00Z'),
}

const BASE_BALANCE = {
  balances: {
    Orange:  { stock: 50000, liquidite: 30000 },
    Moov:    { stock: 10000, liquidite:  5000 },
  },
  updatedAt: new Date('2024-01-01T00:00:00Z'),
}

// ─────────────────────────────────────────────────────────────────────────────
// §E2E-CF — Confirmation HTTP réelle
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-037-CF — confirmDealerRequest via httpsCallable', () => {
  it('[E2E-CF-01] confirmation réussie : statut confirmed, solde augmenté, audit créé', async () => {
    await createAuthUser(STORE_ADMIN_UID, ADMIN_EMAIL, ADMIN_PASSWORD)
    await seedProfile(STORE_ADMIN_UID, ADMIN_PROFILE)
    await seedRequest('req-e2e-1', BASE_REQ)
    await seedBalance(STORE_A, BASE_BALANCE)

    await signInClient(ADMIN_EMAIL, ADMIN_PASSWORD)

    const confirmCallable = httpsCallable(clientFunctions, 'confirmDealerRequest')
    const result = await confirmCallable({ requestId: 'req-e2e-1' })

    expect(result.data).toMatchObject({ success: true, requestId: 'req-e2e-1' })
    expect(result.data.previousBalance).toBe(50000)
    expect(result.data.newBalance).toBe(60000)

    const reqSnap = await adminDb.doc('dealerRequests/req-e2e-1').get()
    expect(reqSnap.data().status).toBe('confirmed')
    expect(reqSnap.data().confirmedBy).toBe(STORE_ADMIN_UID)
    expect(reqSnap.data().previousBalance).toBe(50000)
    expect(reqSnap.data().newBalance).toBe(60000)

    const balSnap = await adminDb.doc(`clients/${STORE_A}/networkBalances/current`).get()
    expect(balSnap.data().balances.Orange.stock).toBe(60000)

    const auditSnap = await adminDb.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.size).toBe(1)
    expect(auditSnap.docs[0].data().action).toBe('DEALER_REQUEST_CONFIRMED')

    await signOutClient()
  })

  it('[E2E-CF-02] deuxième appel sur la même demande → functions/failed-precondition + code REQUEST_NOT_PENDING', async () => {
    await createAuthUser(STORE_ADMIN_UID, ADMIN_EMAIL, ADMIN_PASSWORD)
    await seedProfile(STORE_ADMIN_UID, ADMIN_PROFILE)
    await seedRequest('req-e2e-2', BASE_REQ)
    await seedBalance(STORE_A, BASE_BALANCE)

    await signInClient(ADMIN_EMAIL, ADMIN_PASSWORD)
    const callable = httpsCallable(clientFunctions, 'confirmDealerRequest')
    await callable({ requestId: 'req-e2e-2' })

    try {
      await callable({ requestId: 'req-e2e-2' })
      expect.fail('Devrait lancer')
    } catch (err) {
      expect(err.code).toBe('functions/failed-precondition')
      expect(err.details?.code).toBe('REQUEST_NOT_PENDING')
    }

    await signOutClient()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §E2E-RJ — Rejet HTTP réel
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-037-RJ — rejectDealerRequest via httpsCallable', () => {
  it('[E2E-RJ-01] rejet réussi : statut rejected, solde inchangé, audit créé', async () => {
    await createAuthUser(STORE_ADMIN_UID, ADMIN_EMAIL, ADMIN_PASSWORD)
    await seedProfile(STORE_ADMIN_UID, ADMIN_PROFILE)
    await seedRequest('req-e2e-rj-1', BASE_REQ)
    await seedBalance(STORE_A, BASE_BALANCE)

    await signInClient(ADMIN_EMAIL, ADMIN_PASSWORD)

    const rejectCallable = httpsCallable(clientFunctions, 'rejectDealerRequest')
    const result = await rejectCallable({ requestId: 'req-e2e-rj-1', rejectionReason: 'Motif E2E valide.' })

    expect(result.data).toMatchObject({ success: true, requestId: 'req-e2e-rj-1' })

    const reqSnap = await adminDb.doc('dealerRequests/req-e2e-rj-1').get()
    expect(reqSnap.data().status).toBe('rejected')
    expect(reqSnap.data().rejectedBy).toBe(STORE_ADMIN_UID)
    expect(reqSnap.data().rejectionReason).toBe('Motif E2E valide.')
    expect(reqSnap.data().previousBalance).toBeNull()
    expect(reqSnap.data().newBalance).toBeNull()

    const balSnap = await adminDb.doc(`clients/${STORE_A}/networkBalances/current`).get()
    expect(balSnap.data().balances.Orange.stock).toBe(50000)

    const auditSnap = await adminDb.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.size).toBe(1)
    expect(auditSnap.docs[0].data().action).toBe('DEALER_REQUEST_REJECTED')
    expect(auditSnap.docs[0].data().rejectionReason).toBe('Motif E2E valide.')

    await signOutClient()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §E2E-AUTH — Erreurs d'authentification et de rôle
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-037-AUTH — Auth, rôle et validations HTTP', () => {
  it('[E2E-AUTH-01] utilisateur non connecté → functions/unauthenticated', async () => {
    await signOutClient()
    const callable = httpsCallable(clientFunctions, 'confirmDealerRequest')
    try {
      await callable({ requestId: 'req-any' })
      expect.fail('Devrait lancer')
    } catch (err) {
      expect(err.code).toBe('functions/unauthenticated')
    }
  })

  it('[E2E-AUTH-02] Dealer (rôle interdit) → functions/permission-denied + ROLE_FORBIDDEN', async () => {
    await createAuthUser(DEALER_UID, DEALER_EMAIL, DEALER_PASSWORD)
    await seedProfile(DEALER_UID, DEALER_PROFILE)
    await seedRequest('req-e2e-auth-2', BASE_REQ)

    await signInClient(DEALER_EMAIL, DEALER_PASSWORD)
    const callable = httpsCallable(clientFunctions, 'confirmDealerRequest')
    try {
      await callable({ requestId: 'req-e2e-auth-2' })
      expect.fail('Devrait lancer')
    } catch (err) {
      expect(err.code).toBe('functions/permission-denied')
      expect(err.details?.code).toBe('ROLE_FORBIDDEN')
    }
    await signOutClient()
  })

  it('[E2E-AUTH-03] Store Admin autre boutique → functions/permission-denied + REQUEST_STORE_MISMATCH', async () => {
    await createAuthUser(OTHER_ADMIN_UID, OTHER_ADMIN_EMAIL, OTHER_ADMIN_PASSWORD)
    await seedProfile(OTHER_ADMIN_UID, OTHER_ADMIN_PROFILE)
    await seedRequest('req-e2e-auth-3', BASE_REQ) // targetStoreId = STORE_A
    await seedBalance(STORE_B, BASE_BALANCE)

    await signInClient(OTHER_ADMIN_EMAIL, OTHER_ADMIN_PASSWORD)
    const callable = httpsCallable(clientFunctions, 'confirmDealerRequest')
    try {
      await callable({ requestId: 'req-e2e-auth-3' })
      expect.fail('Devrait lancer')
    } catch (err) {
      expect(err.code).toBe('functions/permission-denied')
      expect(err.details?.code).toBe('REQUEST_STORE_MISMATCH')
    }
    await signOutClient()
  })

  it('[E2E-AUTH-04] requestId invalide (vide) → functions/invalid-argument', async () => {
    await createAuthUser(STORE_ADMIN_UID, ADMIN_EMAIL, ADMIN_PASSWORD)
    await seedProfile(STORE_ADMIN_UID, ADMIN_PROFILE)

    await signInClient(ADMIN_EMAIL, ADMIN_PASSWORD)
    const callable = httpsCallable(clientFunctions, 'confirmDealerRequest')
    try {
      await callable({ requestId: '' })
      expect.fail('Devrait lancer')
    } catch (err) {
      expect(err.code).toBe('functions/invalid-argument')
    }
    await signOutClient()
  })

  it('[E2E-AUTH-05] payload avec clé supplémentaire → functions/invalid-argument', async () => {
    await createAuthUser(STORE_ADMIN_UID, ADMIN_EMAIL, ADMIN_PASSWORD)
    await seedProfile(STORE_ADMIN_UID, ADMIN_PROFILE)

    await signInClient(ADMIN_EMAIL, ADMIN_PASSWORD)
    const callable = httpsCallable(clientFunctions, 'confirmDealerRequest')
    try {
      await callable({ requestId: 'req-any', extra: 'injection' })
      expect.fail('Devrait lancer')
    } catch (err) {
      expect(err.code).toBe('functions/invalid-argument')
    }
    await signOutClient()
  })

  it('[E2E-AUTH-06] motif rejet invalide (trop court) → functions/invalid-argument', async () => {
    await createAuthUser(STORE_ADMIN_UID, ADMIN_EMAIL, ADMIN_PASSWORD)
    await seedProfile(STORE_ADMIN_UID, ADMIN_PROFILE)
    await seedRequest('req-e2e-auth-6', BASE_REQ)

    await signInClient(ADMIN_EMAIL, ADMIN_PASSWORD)
    const callable = httpsCallable(clientFunctions, 'rejectDealerRequest')
    try {
      await callable({ requestId: 'req-e2e-auth-6', rejectionReason: 'ab' })
      expect.fail('Devrait lancer')
    } catch (err) {
      expect(err.code).toBe('functions/invalid-argument')
    }
    await signOutClient()
  })

  it('[E2E-AUTH-07] demande introuvable → functions/not-found', async () => {
    await createAuthUser(STORE_ADMIN_UID, ADMIN_EMAIL, ADMIN_PASSWORD)
    await seedProfile(STORE_ADMIN_UID, ADMIN_PROFILE)

    await signInClient(ADMIN_EMAIL, ADMIN_PASSWORD)
    const callable = httpsCallable(clientFunctions, 'confirmDealerRequest')
    try {
      await callable({ requestId: 'req-inexistante' })
      expect.fail('Devrait lancer')
    } catch (err) {
      expect(err.code).toBe('functions/not-found')
      expect(err.details?.code).toBe('REQUEST_NOT_FOUND')
    }
    await signOutClient()
  })

  it('[E2E-AUTH-08] code métier dans err.details.code disponible', async () => {
    await createAuthUser(STORE_ADMIN_UID, ADMIN_EMAIL, ADMIN_PASSWORD)
    await seedProfile(STORE_ADMIN_UID, ADMIN_PROFILE)
    await seedRequest('req-e2e-auth-8', { ...BASE_REQ, status: 'confirmed', confirmedBy: 'x', confirmedAt: new Date() })
    await seedBalance(STORE_A, BASE_BALANCE)

    await signInClient(ADMIN_EMAIL, ADMIN_PASSWORD)
    const callable = httpsCallable(clientFunctions, 'confirmDealerRequest')
    try {
      await callable({ requestId: 'req-e2e-auth-8' })
      expect.fail('Devrait lancer')
    } catch (err) {
      expect(err.code).toBe('functions/failed-precondition')
      expect(err.details).toMatchObject({ code: 'REQUEST_NOT_PENDING' })
    }
    await signOutClient()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §E2E-INT — Erreurs internes (functions/internal)
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-037-INT — erreurs internes via httpsCallable', () => {
  it('[E2E-INT-01] solde corrompu (stock string) → functions/internal + INVALID_BALANCE_DATA, demande et solde inchangés, aucun audit', async () => {
    await createAuthUser(STORE_ADMIN_UID, ADMIN_EMAIL, ADMIN_PASSWORD)
    await seedProfile(STORE_ADMIN_UID, ADMIN_PROFILE)
    await seedRequest('req-e2e-int-1', BASE_REQ)
    // Solde corrompu : stock est une string → INVALID_BALANCE_DATA → functions/internal via wrapCallable
    const corruptBalance = {
      balances: { Orange: { stock: 'invalid_string', liquidite: 0 } },
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    }
    await seedBalance(STORE_A, corruptBalance)

    await signInClient(ADMIN_EMAIL, ADMIN_PASSWORD)
    const callable = httpsCallable(clientFunctions, 'confirmDealerRequest')

    try {
      await callable({ requestId: 'req-e2e-int-1' })
      expect.fail('Devrait lancer une erreur functions/internal')
    } catch (err) {
      // Code HTTP correct
      expect(err.code).toBe('functions/internal')
      // Code métier exposé dans details (pas de stack ni d'internals Admin SDK)
      expect(err.details?.code).toBe('INVALID_BALANCE_DATA')
      // Message ne contient ni stack trace ni références aux internals Firebase
      expect(err.message).not.toMatch(/at /)
      expect(err.message).not.toMatch(/Error:.*Error:/)
      expect(err.message).not.toMatch(/firestore|admin|googleapis/i)
    }

    // Demande inchangée : toujours en attente
    const reqSnap = await adminDb.doc('dealerRequests/req-e2e-int-1').get()
    expect(reqSnap.data().status).toBe('pending')
    expect(reqSnap.data().confirmedBy).toBeNull()
    expect(reqSnap.data().confirmedAt).toBeNull()

    // Solde inchangé : valeur corrompue préservée
    const balSnap = await adminDb.doc(`clients/${STORE_A}/networkBalances/current`).get()
    expect(balSnap.data().balances.Orange.stock).toBe('invalid_string')

    // Aucun audit créé
    const auditSnap = await adminDb.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.size).toBe(0)

    await signOutClient()
  })
})
