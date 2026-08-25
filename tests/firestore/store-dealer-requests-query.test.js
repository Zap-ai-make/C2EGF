/**
 * TC-V26-SQ — Tests émulateur : requêtes dealerRequests par store_admin (V2-6)
 *
 * 14 scénarios : 7 autorisés / 7 refusés.
 *
 * IMPORTANT : Le helper getAuthenticatedContext() retourne un RulesTestContext,
 * pas une instance Firestore. Chaque test appelle ctx.firestore() pour obtenir
 * la vraie instance Firestore à passer à collection(), doc(), etc.
 *
 * Matrice :
 *   store-admin-a-uid     store_admin actif boutique A
 *   store-admin-b-uid     store_admin actif boutique B
 *   store-admin-inact-uid store_admin inactif boutique A
 *   dealer-a-uid          dealer actif
 *   (non authentifié)     contexte unauthenticated
 *
 * Projet exclusif : demo-akayis-test — aucun accès Firebase production.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import {
  doc, getDoc, collection, getDocs, updateDoc,
  query, where, orderBy, limit, startAfter, Timestamp,
} from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertSucceeds,
  assertFails,
  getAuthenticatedContext,
  getUnauthenticatedContext,
  seedDocument,
} from './helpers.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rulesPath = resolve(__dirname, '../../firestore.rules')
const rules = readFileSync(rulesPath, 'utf-8')

let testEnv

beforeAll(async () => {
  const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || ''
  if (!projectId.startsWith('demo-')) {
    throw new Error(`SÉCURITÉ : projectId manquant ou non-demo. Valeur reçue : "${projectId}"`)
  }
  if (projectId !== 'demo-akayis-test') {
    throw new Error(`SÉCURITÉ : projectId doit être "demo-akayis-test". Valeur reçue : "${projectId}"`)
  }
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-akayis-test',
    firestore: { rules, host: '127.0.0.1', port: 8080 },
  })
})

afterAll(async () => { if (testEnv) await testEnv.cleanup() })
beforeEach(async () => { await testEnv.clearFirestore() })

// ─────────────────────────────────────────────────────────────
// Assertion : le helper retourne un contexte, pas une instance Firestore
// ─────────────────────────────────────────────────────────────

function assertContextHasFirestore(ctx) {
  if (typeof ctx?.firestore !== 'function') {
    throw new Error(
      'getAuthenticatedContext() doit retourner un RulesTestContext avec .firestore(). ' +
      'Ne pas l\'utiliser directement comme instance Firestore.'
    )
  }
}

// ─────────────────────────────────────────────────────────────
// Timestamps déterministes pour un ordre prévisible
// ─────────────────────────────────────────────────────────────

const TS1 = new Timestamp(1700000001, 0)
const TS2 = new Timestamp(1700000002, 0)
const TS3 = new Timestamp(1700000003, 0)

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

async function seedUsers() {
  await seedDocument(testEnv, 'users', 'dealer-a-uid', {
    role: 'dealer', active: true, email: 'dealer-a@test.test', name: 'Dealer A',
  })
  await seedDocument(testEnv, 'users', 'store-admin-a-uid', {
    role: 'store_admin', active: true, storeId: 'store-A', storeName: 'Boutique A',
    email: 'admin-a@test.test', name: 'Admin A',
  })
  await seedDocument(testEnv, 'users', 'store-admin-b-uid', {
    role: 'store_admin', active: true, storeId: 'store-B', storeName: 'Boutique B',
    email: 'admin-b@test.test', name: 'Admin B',
  })
  await seedDocument(testEnv, 'users', 'store-admin-inact-uid', {
    role: 'store_admin', active: false, storeId: 'store-A', storeName: 'Boutique A',
    email: 'admin-inact@test.test', name: 'Admin Inactif',
  })
}

async function seedStores() {
  await seedDocument(testEnv, 'stores', 'store-A', {
    name: 'Boutique A', active: true, adminUid: 'store-admin-a-uid',
  })
  await seedDocument(testEnv, 'stores', 'store-B', {
    name: 'Boutique B', active: true, adminUid: 'store-admin-b-uid',
  })
}

const BASE_REQ = {
  dealerUid: 'dealer-a-uid',
  dealerEmail: 'dealer-a@test.test',
  dealerName: 'Dealer A',
  requestType: 'stock_add',
  network: 'Orange',
  amount: 50000,
  status: 'pending',
  confirmedBy: null, confirmedAt: null,
  rejectedBy: null, rejectedAt: null, rejectionReason: null,
  previousBalance: null, newBalance: null,
}

async function seedRequests() {
  // 3 demandes ciblant store-A — timestamps croissants pour ordre déterministe
  await seedDocument(testEnv, 'dealerRequests', 'req-a1', {
    ...BASE_REQ, targetStoreId: 'store-A', targetStoreName: 'Boutique A',
    createdAt: TS1, updatedAt: TS1,
  })
  await seedDocument(testEnv, 'dealerRequests', 'req-a2', {
    ...BASE_REQ, targetStoreId: 'store-A', targetStoreName: 'Boutique A',
    status: 'confirmed', createdAt: TS2, updatedAt: TS2,
  })
  await seedDocument(testEnv, 'dealerRequests', 'req-a3', {
    ...BASE_REQ, targetStoreId: 'store-A', targetStoreName: 'Boutique A',
    requestType: 'liquidity_add', status: 'rejected', createdAt: TS3, updatedAt: TS3,
  })
  // 1 demande ciblant store-B
  await seedDocument(testEnv, 'dealerRequests', 'req-b1', {
    ...BASE_REQ, targetStoreId: 'store-B', targetStoreName: 'Boutique B',
    createdAt: TS1, updatedAt: TS1,
  })
}

async function seedAll() {
  await seedUsers()
  await seedStores()
  await seedRequests()
}

// ─────────────────────────────────────────────────────────────
// §SQ-A — Lectures autorisées pour store_admin
// ─────────────────────────────────────────────────────────────

describe('TC-V26-SQ-A — Lectures autorisées : store_admin (7 tests)', () => {
  it('[SQ-01] Admin-A liste les demandes ciblant store-A → allow', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    assertContextHasFirestore(ctx)
    const db = ctx.firestore()
    const q = query(
      collection(db, 'dealerRequests'),
      where('targetStoreId', '==', 'store-A'),
      orderBy('createdAt', 'desc'),
      limit(20)
    )
    await assertSucceeds(getDocs(q))
  })

  it('[SQ-02] Admin-B liste les demandes ciblant store-B → allow', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-b-uid')
    assertContextHasFirestore(ctx)
    const db = ctx.firestore()
    const q = query(
      collection(db, 'dealerRequests'),
      where('targetStoreId', '==', 'store-B'),
      orderBy('createdAt', 'desc'),
      limit(20)
    )
    await assertSucceeds(getDocs(q))
  })

  it('[SQ-03] Admin-A filtre par statut pending sur store-A → allow', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    assertContextHasFirestore(ctx)
    const db = ctx.firestore()
    const q = query(
      collection(db, 'dealerRequests'),
      where('targetStoreId', '==', 'store-A'),
      where('status', '==', 'pending'),
      orderBy('createdAt', 'desc'),
      limit(20)
    )
    await assertSucceeds(getDocs(q))
  })

  it('[SQ-04] Admin-A filtre par type liquidity_add sur store-A → allow', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    assertContextHasFirestore(ctx)
    const db = ctx.firestore()
    const q = query(
      collection(db, 'dealerRequests'),
      where('targetStoreId', '==', 'store-A'),
      where('requestType', '==', 'liquidity_add'),
      orderBy('createdAt', 'desc'),
      limit(20)
    )
    await assertSucceeds(getDocs(q))
  })

  it('[SQ-05] Admin-A filtre statut + type sur store-A → allow', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    assertContextHasFirestore(ctx)
    const db = ctx.firestore()
    const q = query(
      collection(db, 'dealerRequests'),
      where('targetStoreId', '==', 'store-A'),
      where('status', '==', 'rejected'),
      where('requestType', '==', 'liquidity_add'),
      orderBy('createdAt', 'desc'),
      limit(20)
    )
    await assertSucceeds(getDocs(q))
  })

  it('[SQ-06] Admin-A pagination avec startAfter → allow', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    assertContextHasFirestore(ctx)
    const db = ctx.firestore()

    // Première page (limit 2) — ordre desc : req-a3, req-a2
    const firstPage = query(
      collection(db, 'dealerRequests'),
      where('targetStoreId', '==', 'store-A'),
      orderBy('createdAt', 'desc'),
      limit(2)
    )
    const snap1 = await getDocs(firstPage)
    const cursor = snap1.docs.at(-1)

    // Deuxième page avec curseur → doit retourner req-a1
    const secondPage = query(
      collection(db, 'dealerRequests'),
      where('targetStoreId', '==', 'store-A'),
      orderBy('createdAt', 'desc'),
      startAfter(cursor),
      limit(2)
    )
    await assertSucceeds(getDocs(secondPage))
  })

  it('[SQ-07] Admin-A lit le détail d\'une demande ciblant store-A → allow', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    assertContextHasFirestore(ctx)
    const db = ctx.firestore()
    await assertSucceeds(getDoc(doc(db, 'dealerRequests', 'req-a1')))
  })
})

// ─────────────────────────────────────────────────────────────
// §SQ-R — Lectures refusées
// ─────────────────────────────────────────────────────────────

describe('TC-V26-SQ-R — Lectures refusées (7 tests)', () => {
  it('[SQ-08] Admin-A lit le détail d\'une demande ciblant store-B → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    assertContextHasFirestore(ctx)
    const db = ctx.firestore()
    await assertFails(getDoc(doc(db, 'dealerRequests', 'req-b1')))
  })

  it('[SQ-09] Admin-A liste sans filtre targetStoreId → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    assertContextHasFirestore(ctx)
    const db = ctx.firestore()
    // Sans where('targetStoreId',...) les règles ne peuvent pas vérifier isStoreAdmin(resource.data.targetStoreId)
    const q = query(
      collection(db, 'dealerRequests'),
      where('status', '==', 'pending'),
      orderBy('createdAt', 'desc'),
      limit(20)
    )
    await assertFails(getDocs(q))
  })

  it('[SQ-10] Admin-A liste avec targetStoreId=store-B (autre boutique) → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    assertContextHasFirestore(ctx)
    const db = ctx.firestore()
    const q = query(
      collection(db, 'dealerRequests'),
      where('targetStoreId', '==', 'store-B'),
      orderBy('createdAt', 'desc'),
      limit(20)
    )
    await assertFails(getDocs(q))
  })

  it('[SQ-11] Dealer utilisant la requête boutique (where targetStoreId) → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    assertContextHasFirestore(ctx)
    const db = ctx.firestore()
    // La règle dealer exige resource.data.dealerUid == request.auth.uid
    // Mais le where targetStoreId ne contraint pas dealerUid → requête refusée
    const q = query(
      collection(db, 'dealerRequests'),
      where('targetStoreId', '==', 'store-A'),
      orderBy('createdAt', 'desc'),
      limit(20)
    )
    await assertFails(getDocs(q))
  })

  it('[SQ-12] Store Admin inactif (active=false) → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-inact-uid')
    assertContextHasFirestore(ctx)
    const db = ctx.firestore()
    await assertFails(getDoc(doc(db, 'dealerRequests', 'req-a1')))
  })

  it('[SQ-13] Utilisateur non authentifié → deny', async () => {
    await seedAll()
    const ctx = getUnauthenticatedContext(testEnv)
    assertContextHasFirestore(ctx)
    const db = ctx.firestore()
    await assertFails(getDoc(doc(db, 'dealerRequests', 'req-a1')))
  })

  it('[SQ-14] Store Admin A tente updateDoc (écriture) → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    assertContextHasFirestore(ctx)
    const db = ctx.firestore()
    // allow update: if false → toujours refusé
    await assertFails(
      updateDoc(doc(db, 'dealerRequests', 'req-a1'), {
        status: 'confirmed',
        confirmedBy: 'store-admin-a-uid',
      })
    )
  })
})
