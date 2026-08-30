/**
 * Règles Firestore — internalDebts (dettes internes entre boutiques).
 *
 * Une dette naît d'une collaboration confirmée. Elle lie une boutique DÉBITRICE
 * (qui doit, et déclare les remboursements) et une CRÉANCIÈRE (qui confirme).
 * Les deux lisent le même document ; une tierce boutique jamais.
 *
 * Invariant non négociable : AUCUNE écriture client, ni sur la dette ni sur ses
 * tranches. `settledAmount` / `remainingAmount` sont de l'argent : seul le serveur
 * les touche, dans une transaction, avec piste d'audit.
 *
 * Matrice utilisateurs : cf. storeCollaborations.rules.test.js (mêmes principaux).
 * Projet exclusif : demo-akayis-test. Aucun accès Firebase production.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, getDocs, query, where, orderBy,
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

const __dirname = dirname(fileURLToPath(import.meta.url))
const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf-8')

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

beforeEach(async () => {
  await testEnv.clearFirestore()
  await seedAll()
})

// ─────────────────────────────────────────────────────────────
// Fixtures — A doit 20 000 à B (dépôt exécuté par B pour un client de A).
// ─────────────────────────────────────────────────────────────

const BASE_DEBT = Object.freeze({
  collaborationId: 'collab-ab',
  debtorStoreId: 'store-A',
  debtorStoreName: 'Boutique A',
  creditorStoreId: 'store-B',
  creditorStoreName: 'Boutique B',
  network: 'Orange',
  operationType: 'deposit',
  originalAmount: 20000,
  settledAmount: 0,
  remainingAmount: 20000,
  status: 'open',
})

const BASE_SETTLEMENT = Object.freeze({
  debtId: 'debt-ab',
  debtorStoreId: 'store-A',
  creditorStoreId: 'store-B',
  amount: 5000,
  method: 'Orange Money',
  settlementStatus: 'declared',
  idempotencyKey: 'k1',
  previousRemaining: 20000,
  newRemaining: null,
  declaredBy: 'store-admin-a-uid',
})

async function seedAll() {
  await seedDocument(testEnv, 'stores', 'store-A', { name: 'Boutique A', active: true, adminUid: 'store-admin-a-uid' })
  await seedDocument(testEnv, 'stores', 'store-B', { name: 'Boutique B', active: true, adminUid: 'store-admin-b-uid' })
  await seedDocument(testEnv, 'stores', 'store-C', { name: 'Boutique C', active: true, adminUid: 'store-admin-c-uid' })

  await seedDocument(testEnv, 'users', 'store-admin-a-uid', { role: 'store_admin', active: true, storeId: 'store-A', storeName: 'Boutique A', email: 'a@test.test', name: 'Admin A' })
  await seedDocument(testEnv, 'users', 'store-admin-b-uid', { role: 'store_admin', active: true, storeId: 'store-B', storeName: 'Boutique B', email: 'b@test.test', name: 'Admin B' })
  await seedDocument(testEnv, 'users', 'store-admin-c-uid', { role: 'store_admin', active: true, storeId: 'store-C', storeName: 'Boutique C', email: 'c@test.test', name: 'Admin C' })
  await seedDocument(testEnv, 'users', 'system-mgr-uid', { role: 'system_manager', active: true, email: 'mgr@test.test', name: 'Manager' })

  await seedDocument(testEnv, 'internalDebts', 'debt-ab', BASE_DEBT)
  await seedDocument(testEnv, 'internalDebts/debt-ab/settlements', 'dst_debt-ab_store-admin-a-uid_k1', BASE_SETTLEMENT)
  await seedDocument(testEnv, 'internalDebts/debt-ab/settlements', 'dst_debt-ab_store-admin-a-uid_k2', {
    ...BASE_SETTLEMENT, idempotencyKey: 'k2', amount: 3000, settlementStatus: 'confirmed', newRemaining: 12000,
  })
}

const debtRef = (ctx) => doc(ctx.firestore(), 'internalDebts', 'debt-ab')
const settlementsCol = (ctx) => collection(ctx.firestore(), 'internalDebts', 'debt-ab', 'settlements')

// ─────────────────────────────────────────────────────────────

describe('internalDebts — lecture de la dette', () => {
  it('la boutique DÉBITRICE lit sa dette', async () => {
    await assertSucceeds(getDoc(debtRef(getAuthenticatedContext(testEnv, 'store-admin-a-uid'))))
  })

  it('la boutique CRÉANCIÈRE lit la même dette', async () => {
    await assertSucceeds(getDoc(debtRef(getAuthenticatedContext(testEnv, 'store-admin-b-uid'))))
  })

  it('le gérant lit (supervision)', async () => {
    await assertSucceeds(getDoc(debtRef(getAuthenticatedContext(testEnv, 'system-mgr-uid'))))
  })

  it('une TIERCE boutique ne lit pas', async () => {
    await assertFails(getDoc(debtRef(getAuthenticatedContext(testEnv, 'store-admin-c-uid'))))
  })

  it('un anonyme ne lit pas', async () => {
    await assertFails(getDoc(debtRef(getUnauthenticatedContext(testEnv))))
  })
})

describe('internalDebts — requêtes de liste (chemin réel de l’UI)', () => {
  it('« Ce que je dois » : liste par debtorStoreId', async () => {
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    const q = query(
      collection(ctx.firestore(), 'internalDebts'),
      where('debtorStoreId', '==', 'store-A'),
      orderBy('createdAt', 'desc'),
    )
    await assertSucceeds(getDocs(q))
  })

  it('« Ce qu’on me doit » : liste par creditorStoreId', async () => {
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-b-uid')
    const q = query(
      collection(ctx.firestore(), 'internalDebts'),
      where('creditorStoreId', '==', 'store-B'),
      orderBy('createdAt', 'desc'),
    )
    await assertSucceeds(getDocs(q))
  })

  it('une boutique ne liste pas les dettes d’une autre', async () => {
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-c-uid')
    const q = query(collection(ctx.firestore(), 'internalDebts'), where('debtorStoreId', '==', 'store-A'))
    await assertFails(getDocs(q))
  })
})

describe('internalDebts — écritures client toujours refusées (CF-only)', () => {
  it('la débitrice ne s’efface pas sa dette', async () => {
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertFails(updateDoc(debtRef(ctx), { remainingAmount: 0, status: 'settled' }))
  })

  it('la créancière ne gonfle pas sa créance', async () => {
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-b-uid')
    await assertFails(updateDoc(debtRef(ctx), { remainingAmount: 999999 }))
  })

  it('personne ne forge une dette', async () => {
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'internalDebts', 'forge'), BASE_DEBT))
  })

  it('personne ne supprime, pas même le gérant', async () => {
    await assertFails(deleteDoc(debtRef(getAuthenticatedContext(testEnv, 'system-mgr-uid'))))
  })
})

describe('internalDebts/settlements — écritures client toujours refusées', () => {
  it('la débitrice ne déclare pas une tranche en écrivant directement', async () => {
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertFails(setDoc(doc(settlementsCol(ctx), 'forge'), BASE_SETTLEMENT))
  })

  it('la créancière ne confirme pas une tranche en écrivant directement', async () => {
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-b-uid')
    await assertFails(updateDoc(
      doc(settlementsCol(ctx), 'dst_debt-ab_store-admin-a-uid_k1'),
      { settlementStatus: 'confirmed' },
    ))
  })
})
