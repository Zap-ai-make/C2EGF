/**
 * Règles Firestore — storeDealerTransfers + dealerBalances (+ auditLogs).
 *
 * Toutes les écritures passent par les Cloud Functions (Admin SDK) → aucune
 * écriture client autorisée. Lectures cloisonnées par rôle :
 *   - storeDealerTransfers : dealer destinataire, boutique concernée, gérant.
 *   - dealerBalances       : le dealer lui-même, le gérant.
 *
 * Projet exclusif : demo-akayis-test. Aucun accès production.
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

const __dirname = dirname(fileURLToPath(import.meta.url))
const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf-8')

let testEnv

beforeAll(async () => {
  const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || ''
  if (projectId !== 'demo-akayis-test') {
    throw new Error(`SÉCURITÉ : projectId doit être "demo-akayis-test". Reçu : "${projectId}"`)
  }
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-akayis-test',
    firestore: { rules, host: '127.0.0.1', port: 8080 },
  })
})

afterAll(async () => { if (testEnv) await testEnv.cleanup() })
beforeEach(async () => { await testEnv.clearFirestore() })

async function seedAll() {
  await seedDocument(testEnv, 'stores', 'store-A', { name: 'Boutique A', active: true, adminUid: 'store-admin-a-uid' })
  await seedDocument(testEnv, 'stores', 'store-B', { name: 'Boutique B', active: true, adminUid: 'store-admin-b-uid' })
  await seedDocument(testEnv, 'users', 'dealer-a-uid', { role: 'dealer', active: true, email: 'da@test.test', name: 'Dealer A' })
  await seedDocument(testEnv, 'users', 'dealer-b-uid', { role: 'dealer', active: true, email: 'db@test.test', name: 'Dealer B' })
  await seedDocument(testEnv, 'users', 'system-mgr-uid', { role: 'system_manager', active: true, email: 'm@test.test', name: 'Mgr' })
  await seedDocument(testEnv, 'users', 'store-admin-a-uid', { role: 'store_admin', active: true, storeId: 'store-A', storeName: 'Boutique A', email: 'aa@test.test', name: 'Admin A' })
  await seedDocument(testEnv, 'users', 'store-admin-b-uid', { role: 'store_admin', active: true, storeId: 'store-B', storeName: 'Boutique B', email: 'ab@test.test', name: 'Admin B' })

  const baseTransfer = {
    storeId: 'store-A', storeName: 'Boutique A', storeAdminUid: 'store-admin-a-uid',
    dealerUid: 'dealer-a-uid', dealerName: 'Dealer A',
    transferType: 'return_stock', network: 'Orange', amount: 5000, status: 'pending',
    previousStoreBalance: 50000, newStoreBalance: 45000,
    previousDealerBalance: null, newDealerBalance: null,
    confirmedBy: null, confirmedAt: null, rejectedBy: null, rejectedAt: null, rejectionReason: null,
  }
  await seedDocument(testEnv, 'storeDealerTransfers', 'tr-a', baseTransfer)
  await seedDocument(testEnv, 'storeDealerTransfers', 'tr-b', { ...baseTransfer, storeId: 'store-B', storeName: 'Boutique B', dealerUid: 'dealer-b-uid', dealerName: 'Dealer B' })

  await seedDocument(testEnv, 'dealerBalances', 'dealer-a-uid', { balances: { Orange: { stock: 5000, liquidite: 0 } } })
  await seedDocument(testEnv, 'dealerBalances/dealer-a-uid/auditLogs', 'log-1', { action: 'STORE_DEALER_TRANSFER_CONFIRMED', amount: 5000 })

  await seedDocument(testEnv, 'dealerPartnerDeposits', 'dep-a', { dealerUid: 'dealer-a-uid', partnerId: '54525263', amount: 5000, status: 'confirmed' })
  await seedDocument(testEnv, 'dealerPartnerDeposits', 'dep-b', { dealerUid: 'dealer-b-uid', partnerId: '75750889', amount: 3000, status: 'confirmed' })
}

const fs = (uid) => getAuthenticatedContext(testEnv, uid).firestore()

// ── storeDealerTransfers : lecture ───────────────────────────────────────────
describe('storeDealerTransfers — lecture', () => {
  it('dealer destinataire lit son transfert → allow', async () => {
    await seedAll()
    await assertSucceeds(getDoc(doc(fs('dealer-a-uid'), 'storeDealerTransfers', 'tr-a')))
  })
  it('dealer non destinataire → deny', async () => {
    await seedAll()
    await assertFails(getDoc(doc(fs('dealer-a-uid'), 'storeDealerTransfers', 'tr-b')))
  })
  it('boutique concernée lit son transfert → allow', async () => {
    await seedAll()
    await assertSucceeds(getDoc(doc(fs('store-admin-a-uid'), 'storeDealerTransfers', 'tr-a')))
  })
  it('autre boutique → deny', async () => {
    await seedAll()
    await assertFails(getDoc(doc(fs('store-admin-b-uid'), 'storeDealerTransfers', 'tr-a')))
  })
  it('system_manager lit → allow', async () => {
    await seedAll()
    await assertSucceeds(getDoc(doc(fs('system-mgr-uid'), 'storeDealerTransfers', 'tr-a')))
  })
  it('non authentifié → deny', async () => {
    await seedAll()
    await assertFails(getDoc(doc(getUnauthenticatedContext(testEnv).firestore(), 'storeDealerTransfers', 'tr-a')))
  })
})

// ── storeDealerTransfers : écritures refusées (CF only) ──────────────────────
describe('storeDealerTransfers — écritures refusées', () => {
  it('boutique crée → deny', async () => {
    await seedAll()
    await assertFails(setDoc(doc(fs('store-admin-a-uid'), 'storeDealerTransfers', 'new'), { storeId: 'store-A', dealerUid: 'dealer-a-uid', status: 'pending', amount: 1000 }))
  })
  it('dealer crée → deny', async () => {
    await seedAll()
    await assertFails(setDoc(doc(fs('dealer-a-uid'), 'storeDealerTransfers', 'new'), { storeId: 'store-A', dealerUid: 'dealer-a-uid', status: 'pending', amount: 1000 }))
  })
  it('dealer update statut → deny', async () => {
    await seedAll()
    await assertFails(updateDoc(doc(fs('dealer-a-uid'), 'storeDealerTransfers', 'tr-a'), { status: 'confirmed' }))
  })
  it('boutique delete → deny', async () => {
    await seedAll()
    await assertFails(deleteDoc(doc(fs('store-admin-a-uid'), 'storeDealerTransfers', 'tr-a')))
  })
})

// ── dealerBalances : lecture + écritures ─────────────────────────────────────
describe('dealerBalances — lecture / écriture', () => {
  it('dealer lit son propre solde → allow', async () => {
    await seedAll()
    await assertSucceeds(getDoc(doc(fs('dealer-a-uid'), 'dealerBalances', 'dealer-a-uid')))
  })
  it('autre dealer → deny', async () => {
    await seedAll()
    await assertFails(getDoc(doc(fs('dealer-b-uid'), 'dealerBalances', 'dealer-a-uid')))
  })
  it('boutique → deny', async () => {
    await seedAll()
    await assertFails(getDoc(doc(fs('store-admin-a-uid'), 'dealerBalances', 'dealer-a-uid')))
  })
  it('system_manager lit → allow', async () => {
    await seedAll()
    await assertSucceeds(getDoc(doc(fs('system-mgr-uid'), 'dealerBalances', 'dealer-a-uid')))
  })
  it('dealer écrit son solde → deny (CF only)', async () => {
    await seedAll()
    await assertFails(setDoc(doc(fs('dealer-a-uid'), 'dealerBalances', 'dealer-a-uid'), { balances: { Orange: { stock: 999999, liquidite: 0 } } }))
  })
  it('dealer lit son propre auditLog → allow', async () => {
    await seedAll()
    await assertSucceeds(getDoc(doc(fs('dealer-a-uid'), 'dealerBalances/dealer-a-uid/auditLogs', 'log-1')))
  })
  it('autre dealer lit auditLog → deny', async () => {
    await seedAll()
    await assertFails(getDoc(doc(fs('dealer-b-uid'), 'dealerBalances/dealer-a-uid/auditLogs', 'log-1')))
  })
  it('dealer écrit un auditLog → deny', async () => {
    await seedAll()
    await assertFails(setDoc(doc(fs('dealer-a-uid'), 'dealerBalances/dealer-a-uid/auditLogs', 'hack'), { action: 'x' }))
  })
})

// ── dealerPartnerDeposits : lecture + écritures ──────────────────────────────
describe('dealerPartnerDeposits — lecture / écriture', () => {
  it('dealer lit son propre dépôt → allow', async () => {
    await seedAll()
    await assertSucceeds(getDoc(doc(fs('dealer-a-uid'), 'dealerPartnerDeposits', 'dep-a')))
  })
  it('dealer ne lit pas le dépôt d’un autre → deny', async () => {
    await seedAll()
    await assertFails(getDoc(doc(fs('dealer-a-uid'), 'dealerPartnerDeposits', 'dep-b')))
  })
  it('boutique → deny', async () => {
    await seedAll()
    await assertFails(getDoc(doc(fs('store-admin-a-uid'), 'dealerPartnerDeposits', 'dep-a')))
  })
  it('system_manager lit → allow', async () => {
    await seedAll()
    await assertSucceeds(getDoc(doc(fs('system-mgr-uid'), 'dealerPartnerDeposits', 'dep-a')))
  })
  it('dealer crée un dépôt directement → deny (CF only)', async () => {
    await seedAll()
    await assertFails(setDoc(doc(fs('dealer-a-uid'), 'dealerPartnerDeposits', 'hack'), { dealerUid: 'dealer-a-uid', partnerId: 'x', amount: 1, status: 'confirmed' }))
  })
})
