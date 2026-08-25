/**
 * TC-DC — Règles Firestore : collection dealerClosures.
 *
 * Matrice :
 *   dealer-a-uid        dealer actif — owns closure-a
 *   dealer-b-uid        dealer actif — NE doit PAS lire closure-a
 *   store-admin-a-uid   store_admin boutique A — doit lire closure-a (targetStoreId==store-A)
 *   store-admin-b-uid   store_admin boutique B — NE doit PAS lire closure-a
 *   system-mgr-uid      system_manager actif — lit tout
 *   inactive-uid        dealer inactif — accès refusé
 *   (non authentifié)   accès refusé
 *
 * Règles vérifiées :
 *   - dealer lit uniquement ses propres clôtures (dealerUid == auth.uid)
 *   - store_admin lit uniquement celles ciblant sa boutique
 *   - system_manager lit toutes
 *   - aucune écriture directe client (create / update / delete → false)
 *
 * Projet exclusif : demo-akayis-test
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'
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
const __dirname  = dirname(__filename)
const rulesPath  = resolve(__dirname, '../../firestore.rules')
const rules      = readFileSync(rulesPath, 'utf-8')

let testEnv

beforeAll(async () => {
  const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || ''
  if (!projectId.startsWith('demo-')) throw new Error(`SÉCURITÉ : projectId non-demo. Valeur reçue : "${projectId}"`)
  if (projectId !== 'demo-akayis-test') throw new Error(`SÉCURITÉ : projectId doit être "demo-akayis-test". Valeur reçue : "${projectId}"`)
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-akayis-test',
    firestore: { rules, host: '127.0.0.1', port: 8080 },
  })
})

afterAll(async () => { if (testEnv) await testEnv.cleanup() })
beforeEach(async () => { await testEnv.clearFirestore() })

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

async function seedUsers() {
  await seedDocument(testEnv, 'users', 'dealer-a-uid',       { role: 'dealer',          active: true,  email: 'da@t.t', name: 'DA' })
  await seedDocument(testEnv, 'users', 'dealer-b-uid',       { role: 'dealer',          active: true,  email: 'db@t.t', name: 'DB' })
  await seedDocument(testEnv, 'users', 'system-mgr-uid',     { role: 'system_manager',  active: true,  email: 'mgr@t.t', name: 'Mgr' })
  await seedDocument(testEnv, 'users', 'store-admin-a-uid',  { role: 'store_admin',     active: true,  storeId: 'store-A', storeName: 'Boutique A', email: 'aa@t.t', name: 'AA' })
  await seedDocument(testEnv, 'users', 'store-admin-b-uid',  { role: 'store_admin',     active: true,  storeId: 'store-B', storeName: 'Boutique B', email: 'ab@t.t', name: 'AB' })
  await seedDocument(testEnv, 'users', 'inactive-uid',       { role: 'dealer',          active: false, email: 'in@t.t', name: 'Inactive' })
}

async function seedClosures() {
  const BASE = {
    dealerName: 'DA', dealerEmail: 'da@t.t',
    network: 'Orange', businessDate: '2024-06-15',
    declaredStockBalance: 40000, declaredLiquidityBalance: 20000,
    recordedStockBalance: 40000, recordedLiquidityBalance: 20000,
    stockDifference: 0, liquidityDifference: 0, reason: null,
    status: 'pending',
    createdAt: new Date(), updatedAt: new Date(),
    confirmedBy: null, confirmedAt: null,
    rejectedBy: null, rejectedAt: null, rejectionReason: null,
  }
  // closure-a : appartient à dealer-a, cible store-A
  await seedDocument(testEnv, 'dealerClosures', 'closure-a', {
    ...BASE, dealerUid: 'dealer-a-uid', targetStoreId: 'store-A', targetStoreName: 'Boutique A',
  })
  // closure-b : appartient à dealer-b, cible store-A
  await seedDocument(testEnv, 'dealerClosures', 'closure-b', {
    ...BASE, dealerUid: 'dealer-b-uid', targetStoreId: 'store-A', targetStoreName: 'Boutique A',
  })
  // closure-c : appartient à dealer-a, cible store-B
  await seedDocument(testEnv, 'dealerClosures', 'closure-c', {
    ...BASE, dealerUid: 'dealer-a-uid', targetStoreId: 'store-B', targetStoreName: 'Boutique B',
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// §DC-READ — Lectures autorisées
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-DC-READ — Lectures autorisées', () => {

  it('[DC-R-01] dealer-a lit sa propre clôture → allow', async () => {
    await seedUsers()
    await seedClosures()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'dealerClosures/closure-a')))
  })

  it('[DC-R-02] dealer-a lit closure-c (autre boutique mais sien) → allow', async () => {
    await seedUsers()
    await seedClosures()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'dealerClosures/closure-c')))
  })

  it('[DC-R-03] store-admin-a lit closure-a (cible store-A) → allow', async () => {
    await seedUsers()
    await seedClosures()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'dealerClosures/closure-a')))
  })

  it('[DC-R-04] store-admin-a lit closure-b (autre dealer, même boutique) → allow', async () => {
    await seedUsers()
    await seedClosures()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'dealerClosures/closure-b')))
  })

  it('[DC-R-05] system-manager lit closure-a → allow', async () => {
    await seedUsers()
    await seedClosures()
    const ctx = getAuthenticatedContext(testEnv, 'system-mgr-uid')
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'dealerClosures/closure-a')))
  })

  it('[DC-R-06] system-manager lit closure-c → allow', async () => {
    await seedUsers()
    await seedClosures()
    const ctx = getAuthenticatedContext(testEnv, 'system-mgr-uid')
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'dealerClosures/closure-c')))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §DC-DENY — Lectures interdites
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-DC-DENY — Lectures interdites', () => {

  it('[DC-D-01] non authentifié → deny', async () => {
    await seedUsers()
    await seedClosures()
    const ctx = getUnauthenticatedContext(testEnv)
    await assertFails(getDoc(doc(ctx.firestore(), 'dealerClosures/closure-a')))
  })

  it('[DC-D-02] dealer-b tente de lire closure-a (autre dealer) → deny', async () => {
    await seedUsers()
    await seedClosures()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-b-uid')
    await assertFails(getDoc(doc(ctx.firestore(), 'dealerClosures/closure-a')))
  })

  it('[DC-D-03] store-admin-b tente de lire closure-a (autre boutique) → deny', async () => {
    await seedUsers()
    await seedClosures()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-b-uid')
    await assertFails(getDoc(doc(ctx.firestore(), 'dealerClosures/closure-a')))
  })

  it('[DC-D-04] dealer inactif tente de lire sa propre clôture → deny', async () => {
    await seedUsers()
    // Closure appartenant à inactive-uid
    await seedDocument(testEnv, 'dealerClosures', 'closure-inactive', {
      dealerUid: 'inactive-uid', targetStoreId: 'store-A', targetStoreName: 'Boutique A',
      dealerName: 'Inactive', dealerEmail: 'in@t.t',
      network: 'Orange', businessDate: '2024-06-15',
      declaredStockBalance: 0, declaredLiquidityBalance: 0,
      recordedStockBalance: 0, recordedLiquidityBalance: 0,
      stockDifference: 0, liquidityDifference: 0, reason: null,
      status: 'pending', createdAt: new Date(), updatedAt: new Date(),
      confirmedBy: null, confirmedAt: null,
      rejectedBy: null, rejectedAt: null, rejectionReason: null,
    })
    const ctx = getAuthenticatedContext(testEnv, 'inactive-uid')
    await assertFails(getDoc(doc(ctx.firestore(), 'dealerClosures/closure-inactive')))
  })

  it('[DC-D-05] store-admin-b tente de lire closure-c (cible store-B mais admin de B → allow...)', async () => {
    // closure-c cible store-B → store-admin-b doit pouvoir la lire (sa boutique)
    await seedUsers()
    await seedClosures()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-b-uid')
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'dealerClosures/closure-c')))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §DC-WRITE — Écritures toujours interdites (Cloud Functions seulement)
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-DC-WRITE — Écritures client toujours refusées', () => {

  const closurePayload = {
    dealerUid: 'dealer-a-uid', dealerName: 'DA', dealerEmail: 'da@t.t',
    targetStoreId: 'store-A', targetStoreName: 'Boutique A',
    network: 'Orange', businessDate: '2024-06-15',
    declaredStockBalance: 40000, declaredLiquidityBalance: 20000,
    recordedStockBalance: 40000, recordedLiquidityBalance: 20000,
    stockDifference: 0, liquidityDifference: 0, reason: null,
    status: 'pending', createdAt: new Date(), updatedAt: new Date(),
    confirmedBy: null, confirmedAt: null,
    rejectedBy: null, rejectedAt: null, rejectionReason: null,
  }

  it('[DC-W-01] dealer-a tente de créer une clôture directement → deny', async () => {
    await seedUsers()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerClosures/new-closure'), closurePayload))
  })

  it('[DC-W-02] store-admin-a tente de créer une clôture → deny', async () => {
    await seedUsers()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerClosures/new-closure'), closurePayload))
  })

  it('[DC-W-03] system-manager tente de créer une clôture → deny', async () => {
    await seedUsers()
    const ctx = getAuthenticatedContext(testEnv, 'system-mgr-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerClosures/new-closure'), closurePayload))
  })

  it('[DC-W-04] dealer-a tente de modifier une clôture existante → deny', async () => {
    await seedUsers()
    await seedClosures()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(updateDoc(doc(ctx.firestore(), 'dealerClosures/closure-a'), { status: 'confirmed' }))
  })

  it('[DC-W-05] store-admin-a tente de modifier une clôture → deny', async () => {
    await seedUsers()
    await seedClosures()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertFails(updateDoc(doc(ctx.firestore(), 'dealerClosures/closure-a'), { status: 'confirmed' }))
  })

  it('[DC-W-06] dealer-a tente de supprimer une clôture → deny', async () => {
    await seedUsers()
    await seedClosures()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(deleteDoc(doc(ctx.firestore(), 'dealerClosures/closure-a')))
  })

  it('[DC-W-07] non authentifie tente d\'ecrire → deny', async () => {
    const ctx = getUnauthenticatedContext(testEnv)
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerClosures/new-closure'), closurePayload))
  })
})
