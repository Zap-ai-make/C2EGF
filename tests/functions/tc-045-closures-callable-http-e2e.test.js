/**
 * TC-045 — Tests HTTP callable E2E pour les Cloud Functions de clôture Dealer.
 *
 * Ces tests utilisent le SDK client Firebase pour appeler les Functions
 * via httpsCallable, exactement comme le ferait le navigateur.
 *
 * Prérequis :
 *   npm run test:functions:e2e
 *   (firebase emulators:exec --only auth,firestore,functions --project demo-akayis-test)
 *
 * Émulateurs requis : Auth 9099 · Firestore 8080 · Functions 5001
 *
 * Projet exclusif : demo-akayis-test
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest'

// Admin SDK
import { initializeApp as initAdminApp, getApps as getAdminApps, deleteApp as deleteAdminApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getAuth as getAdminAuth }  from 'firebase-admin/auth'

// Client SDK
import { initializeApp as initClientApp, getApps as getClientApps, deleteApp as deleteClientApp } from 'firebase/app'
import { getAuth as getClientAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { getFirestore as getClientFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions'

// ─────────────────────────────────────────────────────────────────────────────
// Garde anti-production
// ─────────────────────────────────────────────────────────────────────────────

const PROJECT_ID     = process.env.GCLOUD_PROJECT
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST
const AUTH_HOST      = process.env.FIREBASE_AUTH_EMULATOR_HOST

if (!FIRESTORE_HOST) throw new Error('SÉCURITÉ : FIRESTORE_EMULATOR_HOST non défini. Lancer via npm run test:functions:e2e')
if (!AUTH_HOST)      throw new Error('SÉCURITÉ : FIREBASE_AUTH_EMULATOR_HOST non défini. Lancer via npm run test:functions:e2e')
if (!PROJECT_ID)     throw new Error('SÉCURITÉ : GCLOUD_PROJECT non défini.')
if (!PROJECT_ID.startsWith('demo-')) throw new Error(`SÉCURITÉ : GCLOUD_PROJECT non-demo : "${PROJECT_ID}"`)
if (PROJECT_ID !== 'demo-akayis-test') throw new Error(`SÉCURITÉ : GCLOUD_PROJECT doit être "demo-akayis-test". Reçu : "${PROJECT_ID}"`)
if (['taofic-ajagbe', 'c2egf-b0b5a'].includes(PROJECT_ID))    throw new Error('SÉCURITÉ : projectId de production interdit.')

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

let adminApp, adminDb, adminAuth, clientApp, clientFunctions

beforeAll(() => {
  if (getAdminApps().length === 0) adminApp = initAdminApp({ projectId: PROJECT_ID })
  else adminApp = getAdminApps()[0]
  adminDb   = getFirestore(adminApp)
  adminAuth = getAdminAuth(adminApp)

  if (getClientApps().find(a => a.name === 'e2e-closures-client')) {
    clientApp = getClientApps().find(a => a.name === 'e2e-closures-client')
  } else {
    clientApp = initClientApp({
      apiKey: 'demo-key', authDomain: `${PROJECT_ID}.firebaseapp.com`, projectId: PROJECT_ID,
    }, 'e2e-closures-client')
  }

  const clientAuth      = getClientAuth(clientApp)
  const clientFirestore = getClientFirestore(clientApp)
  clientFunctions       = getFunctions(clientApp, 'europe-west1')

  connectAuthEmulator(clientAuth, `http://${AUTH_HOST}`, { disableWarnings: true })
  connectFirestoreEmulator(clientFirestore, 'localhost', 8080)
  connectFunctionsEmulator(clientFunctions, 'localhost', 5001)
})

afterAll(async () => {
  if (clientApp) try { await deleteClientApp(clientApp) } catch { /* ignoré */ }
  if (adminApp)  try { await deleteAdminApp(adminApp) } catch { /* ignoré */ }
})

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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const DEALER_UID    = 'e2e-dealer-045'
const ADMIN_UID     = 'e2e-admin-045'
const DEALER_EMAIL  = 'dealer@e2e.045'
const DEALER_PWD    = 'DealerE2E045!'
const ADMIN_EMAIL   = 'admin@e2e.045'
const ADMIN_PWD     = 'AdminE2E045!'
const STORE_A       = 'store-e2e-045-A'
const BUSINESS_DATE = '2024-06-15'

const DEALER_PROFILE = { role: 'dealer', active: true, email: DEALER_EMAIL, name: 'Dealer E2E 045' }
const ADMIN_PROFILE  = { role: 'store_admin', active: true, storeId: STORE_A, email: ADMIN_EMAIL, name: 'Admin E2E 045' }

async function createAuthUser(uid, email, password) {
  await adminAuth.createUser({ uid, email, password })
}
async function seedProfile(uid, data) { await adminDb.doc(`users/${uid}`).set(data) }
async function seedStore(storeId, data) { await adminDb.doc(`stores/${storeId}`).set(data) }
async function seedBalance(storeId) {
  await adminDb.doc(`clients/${storeId}/networkBalances/current`).set({
    balances: { Orange: { stock: 50000, liquidite: 25000 } },
    updatedAt: new Date(),
  })
}
async function signInClient(email, password) {
  return signInWithEmailAndPassword(getClientAuth(clientApp), email, password)
}
async function signOutClient() {
  return signOut(getClientAuth(clientApp))
}

async function createPendingClosure(overrides = {}) {
  const closureId = `${DEALER_UID}_${STORE_A}_Orange_${BUSINESS_DATE}`
  await adminDb.doc(`dealerClosures/${closureId}`).set({
    dealerUid: DEALER_UID, dealerName: 'Dealer E2E 045', dealerEmail: DEALER_EMAIL,
    targetStoreId: STORE_A, targetStoreName: 'Boutique E2E 045-A',
    network: 'Orange', businessDate: BUSINESS_DATE,
    declaredStockBalance: 50000, declaredLiquidityBalance: 25000,
    recordedStockBalance: 50000, recordedLiquidityBalance: 25000,
    stockDifference: 0, liquidityDifference: 0, reason: null,
    status: 'pending', createdAt: new Date(), updatedAt: new Date(),
    confirmedBy: null, confirmedAt: null,
    rejectedBy: null, rejectedAt: null, rejectionReason: null,
    ...overrides,
  })
  return closureId
}

function baseCreatePayload(overrides = {}) {
  return {
    targetStoreId:            STORE_A,
    businessDate:             BUSINESS_DATE,
    declaredStockBalance:     50000,
    declaredLiquidityBalance: 25000,
    reason:                   '',
    network:                  'Orange',
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §E2E-CC — createDealerClosure via httpsCallable
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-045-CC — createDealerClosure via httpsCallable', () => {

  it('[E2E-CC-01] succès : closure créée, audit écrit, aucun solde modifié', async () => {
    await createAuthUser(DEALER_UID, DEALER_EMAIL, DEALER_PWD)
    await seedProfile(DEALER_UID, DEALER_PROFILE)
    await seedStore(STORE_A, { name: 'Boutique E2E 045-A', active: true, adminUid: ADMIN_UID })
    await seedBalance(STORE_A)

    await signInClient(DEALER_EMAIL, DEALER_PWD)
    const fn = httpsCallable(clientFunctions, 'createDealerClosure')
    const result = await fn(baseCreatePayload())

    expect(result.data).toMatchObject({ success: true, idempotent: false })
    const closureId = result.data.closureId
    expect(closureId).toBe(`${DEALER_UID}_${STORE_A}_Orange_${BUSINESS_DATE}`)

    const closureSnap = await adminDb.doc(`dealerClosures/${closureId}`).get()
    expect(closureSnap.data().status).toBe('pending')
    expect(closureSnap.data().recordedStockBalance).toBe(50000)
    expect(closureSnap.data().stockDifference).toBe(0)

    // Aucun solde modifié
    const balSnap = await adminDb.doc(`clients/${STORE_A}/networkBalances/current`).get()
    expect(balSnap.data().balances.Orange.stock).toBe(50000)

    // Audit créé
    const auditSnap = await adminDb.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.size).toBe(1)
    expect(auditSnap.docs[0].data().action).toBe('DEALER_CLOSURE_CREATED')

    await signOutClient()
  })

  it('[E2E-CC-02] idempotence : même payload deux fois → success + idempotent:true, 1 doc', async () => {
    await createAuthUser(DEALER_UID, DEALER_EMAIL, DEALER_PWD)
    await seedProfile(DEALER_UID, DEALER_PROFILE)
    await seedStore(STORE_A, { name: 'Boutique E2E 045-A', active: true, adminUid: ADMIN_UID })
    await seedBalance(STORE_A)

    await signInClient(DEALER_EMAIL, DEALER_PWD)
    const fn = httpsCallable(clientFunctions, 'createDealerClosure')
    const payload = baseCreatePayload()
    const r1 = await fn(payload)
    const r2 = await fn(payload)

    expect(r1.data.success).toBe(true)
    expect(r2.data.success).toBe(true)
    expect(r2.data.idempotent).toBe(true)
    expect(r1.data.closureId).toBe(r2.data.closureId)

    const snap = await adminDb.collection('dealerClosures').get()
    expect(snap.size).toBe(1)

    await signOutClient()
  })

  it('[E2E-CC-03] payload avec champ supplémentaire → functions/invalid-argument', async () => {
    await createAuthUser(DEALER_UID, DEALER_EMAIL, DEALER_PWD)
    await seedProfile(DEALER_UID, DEALER_PROFILE)

    await signInClient(DEALER_EMAIL, DEALER_PWD)
    const fn = httpsCallable(clientFunctions, 'createDealerClosure')
    try {
      await fn({ ...baseCreatePayload(), status: 'confirmed' })
      expect.fail('Devrait lancer')
    } catch (err) {
      expect(err.code).toBe('functions/invalid-argument')
    }
    await signOutClient()
  })

  it('[E2E-CC-04] écart sans motif → functions/invalid-argument', async () => {
    await createAuthUser(DEALER_UID, DEALER_EMAIL, DEALER_PWD)
    await seedProfile(DEALER_UID, DEALER_PROFILE)
    await seedStore(STORE_A, { name: 'Boutique E2E 045-A', active: true, adminUid: ADMIN_UID })
    await seedBalance(STORE_A)

    await signInClient(DEALER_EMAIL, DEALER_PWD)
    const fn = httpsCallable(clientFunctions, 'createDealerClosure')
    try {
      await fn(baseCreatePayload({ declaredStockBalance: 10000, reason: '' }))
      expect.fail('Devrait lancer')
    } catch (err) {
      expect(err.code).toBe('functions/invalid-argument')
      expect(err.details?.code).toBe('REASON_REQUIRED')
    }
    await signOutClient()
  })

  it('[E2E-CC-05] non connecté → functions/unauthenticated', async () => {
    await signOutClient()
    const fn = httpsCallable(clientFunctions, 'createDealerClosure')
    try {
      await fn(baseCreatePayload())
      expect.fail('Devrait lancer')
    } catch (err) {
      expect(err.code).toBe('functions/unauthenticated')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §E2E-CF — confirmDealerClosure via httpsCallable
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-045-CF — confirmDealerClosure via httpsCallable', () => {

  it('[E2E-CF-01] succès : confirmée, aucun solde modifié, audit créé', async () => {
    await createAuthUser(ADMIN_UID, ADMIN_EMAIL, ADMIN_PWD)
    await seedProfile(ADMIN_UID, ADMIN_PROFILE)
    await seedBalance(STORE_A)
    const closureId = await createPendingClosure()

    await signInClient(ADMIN_EMAIL, ADMIN_PWD)
    const fn = httpsCallable(clientFunctions, 'confirmDealerClosure')
    const result = await fn({ closureId })

    expect(result.data).toMatchObject({ success: true, closureId })

    const snap = await adminDb.doc(`dealerClosures/${closureId}`).get()
    expect(snap.data().status).toBe('confirmed')
    expect(snap.data().confirmedBy).toBe(ADMIN_UID)

    const balSnap = await adminDb.doc(`clients/${STORE_A}/networkBalances/current`).get()
    expect(balSnap.data().balances.Orange.stock).toBe(50000)

    const auditSnap = await adminDb.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.docs.some(d => d.data().action === 'DEALER_CLOSURE_CONFIRMED')).toBe(true)

    await signOutClient()
  })

  it('[E2E-CF-02] déjà confirmée → functions/failed-precondition + CLOSURE_NOT_PENDING', async () => {
    await createAuthUser(ADMIN_UID, ADMIN_EMAIL, ADMIN_PWD)
    await seedProfile(ADMIN_UID, ADMIN_PROFILE)
    await seedBalance(STORE_A)
    const closureId = await createPendingClosure()

    await signInClient(ADMIN_EMAIL, ADMIN_PWD)
    const fn = httpsCallable(clientFunctions, 'confirmDealerClosure')
    await fn({ closureId })

    try {
      await fn({ closureId })
      expect.fail('Devrait lancer')
    } catch (err) {
      expect(err.code).toBe('functions/failed-precondition')
      expect(err.details?.code).toBe('CLOSURE_NOT_PENDING')
    }
    await signOutClient()
  })

  it('[E2E-CF-03] dealer (mauvais rôle) tente confirmation → functions/permission-denied', async () => {
    await createAuthUser(DEALER_UID, DEALER_EMAIL, DEALER_PWD)
    await seedProfile(DEALER_UID, DEALER_PROFILE)
    const closureId = await createPendingClosure()

    await signInClient(DEALER_EMAIL, DEALER_PWD)
    const fn = httpsCallable(clientFunctions, 'confirmDealerClosure')
    try {
      await fn({ closureId })
      expect.fail('Devrait lancer')
    } catch (err) {
      expect(err.code).toBe('functions/permission-denied')
    }
    await signOutClient()
  })

  it('[E2E-CF-04] non connecté → functions/unauthenticated', async () => {
    await signOutClient()
    const fn = httpsCallable(clientFunctions, 'confirmDealerClosure')
    try {
      await fn({ closureId: 'any' })
      expect.fail('Devrait lancer')
    } catch (err) {
      expect(err.code).toBe('functions/unauthenticated')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §E2E-RJ — rejectDealerClosure via httpsCallable
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-045-RJ — rejectDealerClosure via httpsCallable', () => {

  it('[E2E-RJ-01] succès : rejetée, aucun solde modifié, audit créé', async () => {
    await createAuthUser(ADMIN_UID, ADMIN_EMAIL, ADMIN_PWD)
    await seedProfile(ADMIN_UID, ADMIN_PROFILE)
    await seedBalance(STORE_A)
    const closureId = await createPendingClosure()

    await signInClient(ADMIN_EMAIL, ADMIN_PWD)
    const fn = httpsCallable(clientFunctions, 'rejectDealerClosure')
    const result = await fn({ closureId, rejectionReason: 'Motif de rejet E2E valide.' })

    expect(result.data).toMatchObject({ success: true, closureId })

    const snap = await adminDb.doc(`dealerClosures/${closureId}`).get()
    expect(snap.data().status).toBe('rejected')
    expect(snap.data().rejectedBy).toBe(ADMIN_UID)
    expect(snap.data().rejectionReason).toBe('Motif de rejet E2E valide.')

    const balSnap = await adminDb.doc(`clients/${STORE_A}/networkBalances/current`).get()
    expect(balSnap.data().balances.Orange.stock).toBe(50000)

    const auditSnap = await adminDb.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.docs.some(d => d.data().action === 'DEALER_CLOSURE_REJECTED')).toBe(true)

    await signOutClient()
  })

  it('[E2E-RJ-02] motif trop court → functions/invalid-argument', async () => {
    await createAuthUser(ADMIN_UID, ADMIN_EMAIL, ADMIN_PWD)
    await seedProfile(ADMIN_UID, ADMIN_PROFILE)
    await seedBalance(STORE_A)
    const closureId = await createPendingClosure()

    await signInClient(ADMIN_EMAIL, ADMIN_PWD)
    const fn = httpsCallable(clientFunctions, 'rejectDealerClosure')
    try {
      await fn({ closureId, rejectionReason: 'ab' })
      expect.fail('Devrait lancer')
    } catch (err) {
      expect(err.code).toBe('functions/invalid-argument')
      expect(err.details?.code).toBe('INVALID_REJECTION_REASON')
    }
    await signOutClient()
  })

  it('[E2E-RJ-03] non connecté → functions/unauthenticated', async () => {
    await signOutClient()
    const fn = httpsCallable(clientFunctions, 'rejectDealerClosure')
    try {
      await fn({ closureId: 'any', rejectionReason: 'Motif quelconque.' })
      expect.fail('Devrait lancer')
    } catch (err) {
      expect(err.code).toBe('functions/unauthenticated')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §E2E-IDEMPOTENCE — Idempotence et aucun solde modifié
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-045-IDEMPOTENCE — Aucun solde modifié par les clôtures', () => {

  it('[E2E-IDP-01] aucune clôture ne modifie les soldes Orange', async () => {
    await createAuthUser(DEALER_UID, DEALER_EMAIL, DEALER_PWD)
    await createAuthUser(ADMIN_UID, ADMIN_EMAIL, ADMIN_PWD)
    await seedProfile(DEALER_UID, DEALER_PROFILE)
    await seedProfile(ADMIN_UID, ADMIN_PROFILE)
    await seedStore(STORE_A, { name: 'Boutique E2E 045-A', active: true, adminUid: ADMIN_UID })
    await seedBalance(STORE_A)

    // Dealer crée
    await signInClient(DEALER_EMAIL, DEALER_PWD)
    const createFn = httpsCallable(clientFunctions, 'createDealerClosure')
    await createFn(baseCreatePayload({ declaredStockBalance: 30000, reason: 'Écart test idempotence.' }))
    await signOutClient()

    // Admin confirme
    await signInClient(ADMIN_EMAIL, ADMIN_PWD)
    const closureId = `${DEALER_UID}_${STORE_A}_Orange_${BUSINESS_DATE}`
    const confirmFn = httpsCallable(clientFunctions, 'confirmDealerClosure')
    await confirmFn({ closureId })
    await signOutClient()

    // Soldes inchangés malgré l'écart
    const balSnap = await adminDb.doc(`clients/${STORE_A}/networkBalances/current`).get()
    expect(balSnap.data().balances.Orange.stock).toBe(50000)
    expect(balSnap.data().balances.Orange.liquidite).toBe(25000)
  })
})
