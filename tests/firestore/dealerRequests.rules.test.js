/**
 * TC-V2-4 — Règles Firestore : dealerRequests, users V2, stores V2,
 *            networkBalances V2, collection group.
 *
 * Matrice utilisateurs :
 *   dealer-a-uid        dealer actif A
 *   dealer-b-uid        dealer actif B
 *   system-mgr-uid      system_manager actif
 *   store-admin-a-uid   store_admin boutique A
 *   store-admin-b-uid   store_admin boutique B
 *   inactive-uid        dealer inactif
 *   unknown-uid         rôle inconnu
 *   (non authentifié)   contexte unauthenticated
 *
 * Projet exclusif : demo-akayis-test
 * Aucun accès Firebase production.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, getDocs, collectionGroup, addDoc,
  query, where, serverTimestamp, Timestamp, writeBatch, deleteField,
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
// Fixtures
// ─────────────────────────────────────────────────────────────

async function seedStores() {
  await seedDocument(testEnv, 'stores', 'store-A', { name: 'Boutique A', active: true, adminUid: 'store-admin-a-uid' })
  await seedDocument(testEnv, 'stores', 'store-B', { name: 'Boutique B', active: true, adminUid: 'store-admin-b-uid' })
  await seedDocument(testEnv, 'stores', 'store-inactive', { name: 'Boutique Inactive', active: false, adminUid: 'store-admin-c-uid' })
}

async function seedUsers() {
  await seedDocument(testEnv, 'users', 'dealer-a-uid', { role: 'dealer', active: true, email: 'dealer-a@test.test', name: 'Dealer A' })
  await seedDocument(testEnv, 'users', 'dealer-b-uid', { role: 'dealer', active: true, email: 'dealer-b@test.test', name: 'Dealer B' })
  await seedDocument(testEnv, 'users', 'system-mgr-uid', { role: 'system_manager', active: true, email: 'mgr@test.test', name: 'Manager' })
  await seedDocument(testEnv, 'users', 'store-admin-a-uid', { role: 'store_admin', active: true, storeId: 'store-A', storeName: 'Boutique A', email: 'admin-a@test.test', name: 'Admin A' })
  await seedDocument(testEnv, 'users', 'store-admin-b-uid', { role: 'store_admin', active: true, storeId: 'store-B', storeName: 'Boutique B', email: 'admin-b@test.test', name: 'Admin B' })
  await seedDocument(testEnv, 'users', 'inactive-uid', { role: 'dealer', active: false, email: 'inactive@test.test', name: 'Inactive' })
  await seedDocument(testEnv, 'users', 'unknown-uid', { role: 'unknown_role', active: true, email: 'unknown@test.test', name: 'Unknown' })
}

async function seedAll() {
  await seedStores()
  await seedUsers()
}

const BASE_REQUEST = {
  dealerUid: 'dealer-a-uid',
  dealerEmail: 'dealer-a@test.test',
  dealerName: 'Dealer A',
  targetStoreId: 'store-A',
  targetStoreName: 'Boutique A',
  requestType: 'stock_add',
  network: 'Orange',
  amount: 10000,
  liquidityAmount: null,
  status: 'pending',
  confirmedBy: null,
  confirmedAt: null,
  rejectedBy: null,
  rejectedAt: null,
  rejectionReason: null,
  previousBalance: null,
  newBalance: null,
}

function validRequest(overrides = {}) {
  return {
    ...BASE_REQUEST,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  }
}

async function seedDealerRequests() {
  const ts = Timestamp.now()
  const base = { ...BASE_REQUEST, createdAt: ts, updatedAt: ts }
  await seedDocument(testEnv, 'dealerRequests', 'req-da-a', { ...base, targetStoreId: 'store-A', targetStoreName: 'Boutique A' })
  await seedDocument(testEnv, 'dealerRequests', 'req-da-b', { ...base, targetStoreId: 'store-B', targetStoreName: 'Boutique B' })
  await seedDocument(testEnv, 'dealerRequests', 'req-db-a', { ...base, dealerUid: 'dealer-b-uid', dealerEmail: 'dealer-b@test.test', dealerName: 'Dealer B', targetStoreId: 'store-A', targetStoreName: 'Boutique A' })
}

async function seedSubCollections() {
  const tx = { type: 'Dépôt', montant: 5000, clientId: 'c1', statut: 'Validée' }
  const dr = { type: 'Dépôt', montant: 1000, clientId: 'c1', statut: 'Non Terminées' }
  await seedDocument(testEnv, 'clients/store-A/history', 'hist-A1', tx)
  await seedDocument(testEnv, 'clients/store-B/history', 'hist-B1', { ...tx, clientId: 'c2' })
  await seedDocument(testEnv, 'clients/store-A/drafts', 'draft-A1', dr)
  await seedDocument(testEnv, 'clients/store-B/drafts', 'draft-B1', { ...dr, clientId: 'c2' })
  await seedDocument(testEnv, 'clients/store-A/networkBalances', 'current', { balances: { Orange: 50000 } })
  await seedDocument(testEnv, 'clients/store-B/networkBalances', 'current', { balances: { Orange: 30000 } })
}

// ─────────────────────────────────────────────────────────────
// TC-V24-DR — Création dealerRequests (autorisée)
// ─────────────────────────────────────────────────────────────

describe('TC-V24-DR — Création dealerRequests valide', () => {
  it('[DR-01] dealer-A crée stock_add valide pour store-A → allow', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertSucceeds(setDoc(doc(ctx.firestore(), 'dealerRequests', 'req-new-1'), validRequest()))
  })

  it('[DR-02] dealer-A crée pour store-B (cross-store autorisé) → allow', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertSucceeds(setDoc(doc(ctx.firestore(), 'dealerRequests', 'req-new-2'), validRequest({
      targetStoreId: 'store-B', targetStoreName: 'Boutique B',
    })))
  })

  it('[DR-03] dealer-A crée liquidity_add → allow', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertSucceeds(setDoc(doc(ctx.firestore(), 'dealerRequests', 'req-new-3'), validRequest({ requestType: 'liquidity_add' })))
  })

  it('[DR-04] amount = 1 (entier positif minimal) → allow', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertSucceeds(setDoc(doc(ctx.firestore(), 'dealerRequests', 'req-new-4'), validRequest({ amount: 1 })))
  })

  it('[DR-05] amount = 9007199254740991 (entier maximal sûr) → allow', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertSucceeds(setDoc(doc(ctx.firestore(), 'dealerRequests', 'req-new-5'), validRequest({ amount: 9007199254740991 })))
  })
})

// ─────────────────────────────────────────────────────────────
// TC-V24-DRF — Création dealerRequests (refusée)
// ─────────────────────────────────────────────────────────────

describe('TC-V24-DRF — Création dealerRequests refusée', () => {
  it('[DRF-01] store_admin crée → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest()))
  })

  it('[DRF-02] system_manager crée → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'system-mgr-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest()))
  })

  it('[DRF-03] non authentifié crée → deny', async () => {
    await seedAll()
    const ctx = getUnauthenticatedContext(testEnv)
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest()))
  })

  it('[DRF-04] dealer inactif crée → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'inactive-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({ dealerUid: 'inactive-uid', dealerEmail: 'inactive@test.test' })))
  })

  it('[DRF-05] rôle inconnu crée → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'unknown-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({ dealerUid: 'unknown-uid', dealerEmail: 'unknown@test.test' })))
  })

  it('[DRF-06] dealerUid != auth.uid → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({ dealerUid: 'dealer-b-uid' })))
  })

  it('[DRF-07] dealerEmail != profil email → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({ dealerEmail: 'wrong@test.test' })))
  })

  it('[DRF-08] dealerName != profil name → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({ dealerName: 'Mauvais Nom' })))
  })

  it('[DRF-09] network = "MTN" → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({ network: 'MTN' })))
  })

  it('[DRF-10] amount = 0 → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({ amount: 0 })))
  })

  it('[DRF-11] amount = -1 → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({ amount: -1 })))
  })

  it('[DRF-12] amount = 1.5 (décimal) → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({ amount: 1.5 })))
  })

  it('[DRF-13] amount = "1000" (string) → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({ amount: '1000' })))
  })

  it('[DRF-14] boutique inexistante → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({ targetStoreId: 'store-ghost', targetStoreName: 'Ghost' })))
  })

  it('[DRF-15] boutique inactive → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({ targetStoreId: 'store-inactive', targetStoreName: 'Boutique Inactive' })))
  })

  it('[DRF-16] status = "confirmed" dès création → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({ status: 'confirmed' })))
  })

  it('[DRF-17] confirmedBy != null → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({ confirmedBy: 'store-admin-a-uid' })))
  })

  it('[DRF-18] previousBalance != null → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({ previousBalance: 50000 })))
  })

  it('[DRF-19] champ supplémentaire → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({ extraField: 'hacked' })))
  })

  it('[DRF-20] champ obligatoire absent (dealerName manquant) → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    const data = validRequest()
    delete data.dealerName
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), data))
  })

  it('[DRF-21] createdAt = timestamp client (pas serverTimestamp) → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({ createdAt: Timestamp.fromMillis(0) })))
  })

  it('[DRF-22] updatedAt = timestamp client (pas serverTimestamp) → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({ updatedAt: Timestamp.fromMillis(0) })))
  })
})

// ─────────────────────────────────────────────────────────────
// TC-V24-DRR — Lecture dealerRequests
// ─────────────────────────────────────────────────────────────

describe('TC-V24-DRR — Lecture dealerRequests', () => {
  it('[DRR-01] dealer-A lit sa propre demande (req-da-a) → allow', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    const snap = await assertSucceeds(getDoc(doc(ctx.firestore(), 'dealerRequests', 'req-da-a')))
    expect(snap.data().dealerUid).toBe('dealer-a-uid')
  })

  it('[DRR-02] dealer-A ne lit pas la demande de dealer-B (req-db-a) → deny', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(getDoc(doc(ctx.firestore(), 'dealerRequests', 'req-db-a')))
  })

  it('[DRR-03] store-admin-A lit demande ciblant store-A (req-da-a) → allow', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    const snap = await assertSucceeds(getDoc(doc(ctx.firestore(), 'dealerRequests', 'req-da-a')))
    expect(snap.data().targetStoreId).toBe('store-A')
  })

  it('[DRR-04] store-admin-A ne lit pas demande ciblant store-B (req-da-b) → deny', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertFails(getDoc(doc(ctx.firestore(), 'dealerRequests', 'req-da-b')))
  })

  it('[DRR-05] system_manager lit req-da-a → allow', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getAuthenticatedContext(testEnv, 'system-mgr-uid')
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'dealerRequests', 'req-da-a')))
  })

  it('[DRR-06] system_manager lit req-db-a → allow', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getAuthenticatedContext(testEnv, 'system-mgr-uid')
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'dealerRequests', 'req-db-a')))
  })

  it('[DRR-07] dealer inactif lit → deny', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getAuthenticatedContext(testEnv, 'inactive-uid')
    await assertFails(getDoc(doc(ctx.firestore(), 'dealerRequests', 'req-da-a')))
  })

  it('[DRR-08] non authentifié lit → deny', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getUnauthenticatedContext(testEnv)
    await assertFails(getDoc(doc(ctx.firestore(), 'dealerRequests', 'req-da-a')))
  })

  it('[DRR-09] dealer-A liste ses demandes (where dealerUid == dealer-a-uid) → allow', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    const q = query(collection(ctx.firestore(), 'dealerRequests'), where('dealerUid', '==', 'dealer-a-uid'))
    const snap = await assertSucceeds(getDocs(q))
    expect(snap.docs.length).toBeGreaterThan(0)
    snap.docs.forEach(d => expect(d.data().dealerUid).toBe('dealer-a-uid'))
  })

  it('[DRR-10] store-admin-A liste demandes ciblant store-A → allow', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    const q = query(collection(ctx.firestore(), 'dealerRequests'), where('targetStoreId', '==', 'store-A'))
    const snap = await assertSucceeds(getDocs(q))
    expect(snap.docs.length).toBeGreaterThan(0)
    snap.docs.forEach(d => expect(d.data().targetStoreId).toBe('store-A'))
  })

  it('[DRR-11] store-admin-A liste demandes ciblant store-B → deny', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    const q = query(collection(ctx.firestore(), 'dealerRequests'), where('targetStoreId', '==', 'store-B'))
    await assertFails(getDocs(q))
  })

  it('[DRR-12] system_manager liste toutes les demandes → allow', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getAuthenticatedContext(testEnv, 'system-mgr-uid')
    const snap = await assertSucceeds(getDocs(collection(ctx.firestore(), 'dealerRequests')))
    expect(snap.docs.length).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────
// TC-V24-DRU — Update/delete dealerRequests refusés
// ─────────────────────────────────────────────────────────────

describe('TC-V24-DRU — Update et delete dealerRequests refusés (tous rôles)', () => {
  it('[DRU-01] dealer update status → deny', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(updateDoc(doc(ctx.firestore(), 'dealerRequests', 'req-da-a'), { status: 'confirmed' }))
  })

  it('[DRU-02] dealer update amount → deny', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(updateDoc(doc(ctx.firestore(), 'dealerRequests', 'req-da-a'), { amount: 99999 }))
  })

  it('[DRU-03] dealer update targetStoreId → deny', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(updateDoc(doc(ctx.firestore(), 'dealerRequests', 'req-da-a'), { targetStoreId: 'store-B' }))
  })

  it('[DRU-04] store-admin-A (boutique ciblée) update status → deny', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertFails(updateDoc(doc(ctx.firestore(), 'dealerRequests', 'req-da-a'), { status: 'confirmed' }))
  })

  it('[DRU-05] system_manager update status → deny', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getAuthenticatedContext(testEnv, 'system-mgr-uid')
    await assertFails(updateDoc(doc(ctx.firestore(), 'dealerRequests', 'req-da-a'), { status: 'confirmed' }))
  })

  it('[DRU-06] dealer delete → deny', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(deleteDoc(doc(ctx.firestore(), 'dealerRequests', 'req-da-a')))
  })

  it('[DRU-07] store-admin delete → deny', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertFails(deleteDoc(doc(ctx.firestore(), 'dealerRequests', 'req-da-a')))
  })

  it('[DRU-08] system_manager delete → deny', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getAuthenticatedContext(testEnv, 'system-mgr-uid')
    await assertFails(deleteDoc(doc(ctx.firestore(), 'dealerRequests', 'req-da-a')))
  })
})

// ─────────────────────────────────────────────────────────────
// TC-V24-USR — Profils utilisateurs V2
// ─────────────────────────────────────────────────────────────

describe('TC-V24-USR — Profils users V2', () => {
  it('[USR-01] system_manager lit profil dealer-a-uid → allow', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'system-mgr-uid')
    const snap = await assertSucceeds(getDoc(doc(ctx.firestore(), 'users', 'dealer-a-uid')))
    expect(snap.data().role).toBe('dealer')
  })

  it('[USR-02] system_manager lit profil store-admin-a-uid → allow', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'system-mgr-uid')
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'users', 'store-admin-a-uid')))
  })

  it('[USR-03] dealer-A lit son propre profil → allow', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    const snap = await assertSucceeds(getDoc(doc(ctx.firestore(), 'users', 'dealer-a-uid')))
    expect(snap.data().role).toBe('dealer')
  })

  it('[USR-04] dealer-A ne lit pas le profil de store-admin-a-uid → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(getDoc(doc(ctx.firestore(), 'users', 'store-admin-a-uid')))
  })

  it('[USR-05] dealer-A ne lit pas le profil de dealer-b-uid → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(getDoc(doc(ctx.firestore(), 'users', 'dealer-b-uid')))
  })

  it('[USR-06] store-admin-A lit son propre profil → allow', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'users', 'store-admin-a-uid')))
  })

  it('[USR-07] store-admin-A ne lit pas le profil de dealer-a-uid → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    // dealer-a-uid n'a pas de storeId → profile().storeId is string évalue false
    await assertFails(getDoc(doc(ctx.firestore(), 'users', 'dealer-a-uid')))
  })

  it('[USR-08] tentative store_admin → dealer (update role) → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertFails(updateDoc(doc(ctx.firestore(), 'users', 'store-admin-a-uid'), { role: 'dealer' }))
  })

  it('[USR-09] dealer update son propre lastLogin → allow (isActiveUser couvre dealer)', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertSucceeds(updateDoc(doc(ctx.firestore(), 'users', 'dealer-a-uid'), { lastLogin: new Date() }))
  })

  it('[USR-10] création dealer via SDK client → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'users', 'new-dealer-uid'), {
      role: 'dealer', active: true, email: 'new@test.test', name: 'New Dealer',
    }))
  })

  it('[USR-11] création system_manager via SDK client → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await seedDocument(testEnv, 'stores', 'store-new', { name: 'New Store', active: true, adminUid: 'store-admin-a-uid' })
    await assertFails(setDoc(doc(ctx.firestore(), 'users', 'store-admin-a-uid'), {
      role: 'system_manager', active: true, storeId: 'store-new', storeName: 'New Store',
    }))
  })
})

// ─────────────────────────────────────────────────────────────
// TC-V24-STR — Boutiques V2
// ─────────────────────────────────────────────────────────────

describe('TC-V24-STR — Boutiques V2', () => {
  it('[STR-01] system_manager lit store-A → allow', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'system-mgr-uid')
    const snap = await assertSucceeds(getDoc(doc(ctx.firestore(), 'stores', 'store-A')))
    expect(snap.data().name).toBe('Boutique A')
  })

  it('[STR-02] dealer lit store-A → allow', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'stores', 'store-A')))
  })

  it('[STR-03] dealer lit store-B → allow', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'stores', 'store-B')))
  })

  it('[STR-04] store-admin-A lit store-A → allow', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'stores', 'store-A')))
  })

  it('[STR-05] store-admin-B ne lit pas store-A → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-b-uid')
    await assertFails(getDoc(doc(ctx.firestore(), 'stores', 'store-A')))
  })

  it('[STR-06] dealer ne modifie pas une boutique → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(updateDoc(doc(ctx.firestore(), 'stores', 'store-A'), { name: 'Hacked' }))
  })

  it('[STR-07] system_manager ne modifie pas une boutique → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'system-mgr-uid')
    await assertFails(updateDoc(doc(ctx.firestore(), 'stores', 'store-A'), { name: 'Hacked' }))
  })
})

// ─────────────────────────────────────────────────────────────
// TC-V24-NB — networkBalances V2
// ─────────────────────────────────────────────────────────────

describe('TC-V24-NB — networkBalances V2', () => {
  it('[NB-01] dealer lit networkBalances store-A → allow', async () => {
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    const snap = await assertSucceeds(getDoc(doc(ctx.firestore(), 'clients', 'store-A', 'networkBalances', 'current')))
    expect(snap.data().balances).toBeDefined()
  })

  it('[NB-02] dealer lit networkBalances store-B → allow', async () => {
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'clients', 'store-B', 'networkBalances', 'current')))
  })

  it('[NB-03] system_manager lit networkBalances store-A → allow', async () => {
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'system-mgr-uid')
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'clients', 'store-A', 'networkBalances', 'current')))
  })

  it('[NB-04] store-admin-A lit networkBalances store-A → allow', async () => {
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'clients', 'store-A', 'networkBalances', 'current')))
  })

  it('[NB-05] store-admin-A ne lit pas networkBalances store-B → deny', async () => {
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertFails(getDoc(doc(ctx.firestore(), 'clients', 'store-B', 'networkBalances', 'current')))
  })

  it('[NB-06] dealer ne modifie pas networkBalances → deny', async () => {
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(updateDoc(doc(ctx.firestore(), 'clients', 'store-A', 'networkBalances', 'current'), { balances: { Orange: 0 } }))
  })

  it('[NB-07] system_manager ne modifie pas networkBalances → deny', async () => {
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'system-mgr-uid')
    await assertFails(updateDoc(doc(ctx.firestore(), 'clients', 'store-A', 'networkBalances', 'current'), { balances: { Orange: 0 } }))
  })

  it('[NB-08] store-admin-B ne modifie pas networkBalances store-A → deny', async () => {
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-b-uid')
    await assertFails(updateDoc(doc(ctx.firestore(), 'clients', 'store-A', 'networkBalances', 'current'), { balances: { Orange: 0 } }))
  })
})

// ─────────────────────────────────────────────────────────────
// TC-V24-CG — Collection group queries
// ─────────────────────────────────────────────────────────────

describe('TC-V24-CG — Collection group system_manager / dealer', () => {
  it('[CG-01] system_manager collectionGroup("history") getDoc direct → allow', async () => {
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'system-mgr-uid')
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'clients', 'store-A', 'history', 'hist-A1')))
  })

  it('[CG-02] system_manager collectionGroup("history") getDocs → allow', async () => {
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'system-mgr-uid')
    const snap = await assertSucceeds(getDocs(collectionGroup(ctx.firestore(), 'history')))
    expect(snap.docs.length).toBeGreaterThanOrEqual(2)
  })

  it('[CG-03] system_manager collectionGroup("drafts") getDocs → allow', async () => {
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'system-mgr-uid')
    const snap = await assertSucceeds(getDocs(collectionGroup(ctx.firestore(), 'drafts')))
    expect(snap.docs.length).toBeGreaterThanOrEqual(2)
  })

  it('[CG-04] system_manager collectionGroup("networkBalances") getDocs → allow', async () => {
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'system-mgr-uid')
    const snap = await assertSucceeds(getDocs(collectionGroup(ctx.firestore(), 'networkBalances')))
    expect(snap.docs.length).toBeGreaterThanOrEqual(2)
  })

  it('[CG-05] dealer collectionGroup("networkBalances") getDocs → allow', async () => {
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    const snap = await assertSucceeds(getDocs(collectionGroup(ctx.firestore(), 'networkBalances')))
    expect(snap.docs.length).toBeGreaterThanOrEqual(2)
  })

  it('[CG-06] dealer collectionGroup("history") getDoc → deny', async () => {
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(getDoc(doc(ctx.firestore(), 'clients', 'store-A', 'history', 'hist-A1')))
  })

  // ⚠ RETOURNÉE le 31/08/2026. Elle exigeait le refus ; la règle a été élargie
  //   sur décision client pour alimenter « Dehors » sur l'accueil dealer. Ce que
  //   la règle N'ouvre PAS reste tenu juste en dessous, par [CG-06] (history,
  //   inchangé) et par le bloc TC-V24-BORNE ajouté en fin de fichier.
  it('[CG-07] dealer lit un draft de store-A → allow (élargi 31/08/2026)', async () => {
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'clients', 'store-A', 'drafts', 'draft-A1')))
  })

  // AGENTS.md : toute règle se teste sur DEUX boutiques. Une règle portée par
  // `isDealer()` ne regarde pas le storeId — si elle ne passait que sur store-A,
  // c'est qu'elle serait écrite autrement qu'on ne le croit.
  it('[CG-07b] dealer lit un draft de store-B → allow', async () => {
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'clients', 'store-B', 'drafts', 'draft-B1')))
  })

  it('[CG-08] store-admin-A lit history store-B directement → deny', async () => {
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertFails(getDoc(doc(ctx.firestore(), 'clients', 'store-B', 'history', 'hist-B1')))
  })
})

// ─────────────────────────────────────────────────────────────
// TC-V24-SC — Sécurité création boutique
// ─────────────────────────────────────────────────────────────

describe('TC-V24-SC — Création boutique : rôles globaux refusés, batch atomique exigé', () => {
  it('[SC-01] dealer crée boutique seule → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'stores', 'store-new'), {
      name: 'New Store', active: true, adminUid: 'dealer-a-uid',
    }))
  })

  it('[SC-02] system_manager crée boutique seule → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'system-mgr-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'stores', 'store-new'), {
      name: 'New Store', active: true, adminUid: 'system-mgr-uid',
    }))
  })

  it('[SC-03] rôle inconnu crée boutique → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'unknown-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'stores', 'store-new'), {
      name: 'New Store', active: true, adminUid: 'unknown-uid',
    }))
  })

  it('[SC-04] store-admin existant crée seconde boutique seule → deny (storeId mismatch)', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    // getAfter(users/store-admin-a-uid).storeId = 'store-A' != 'store-new' → DENY
    await assertFails(setDoc(doc(ctx.firestore(), 'stores', 'store-new'), {
      name: 'New Store', active: true, adminUid: 'store-admin-a-uid',
    }))
  })

  it('[SC-05] nouveau propriétaire batch(boutique + profil store_admin) → allow', async () => {
    const ctx = getAuthenticatedContext(testEnv, 'new-owner-uid')
    const db = ctx.firestore()
    const batch = writeBatch(db)
    batch.set(doc(db, 'stores', 'store-new-owner'), {
      name: 'Ma Boutique', active: true, adminUid: 'new-owner-uid',
    })
    batch.set(doc(db, 'users', 'new-owner-uid'), {
      role: 'store_admin', active: true, storeId: 'store-new-owner', storeName: 'Ma Boutique',
    })
    await assertSucceeds(batch.commit())
  })
})

// ─────────────────────────────────────────────────────────────
// TC-V24-LL — lastLogin pour les trois rôles
// ─────────────────────────────────────────────────────────────

describe('TC-V24-LL — Mise à jour lastLogin : autorisée pour tous les rôles actifs', () => {
  it('[LL-01] store_admin update lastLogin → allow', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertSucceeds(updateDoc(doc(ctx.firestore(), 'users', 'store-admin-a-uid'), { lastLogin: new Date() }))
  })

  it('[LL-02] system_manager update lastLogin → allow', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'system-mgr-uid')
    await assertSucceeds(updateDoc(doc(ctx.firestore(), 'users', 'system-mgr-uid'), { lastLogin: new Date() }))
  })

  it('[LL-03] dealer update lastLogin → allow', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertSucceeds(updateDoc(doc(ctx.firestore(), 'users', 'dealer-a-uid'), { lastLogin: new Date() }))
  })

  it('[LL-04] utilisateur inactif update lastLogin → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'inactive-uid')
    await assertFails(updateDoc(doc(ctx.firestore(), 'users', 'inactive-uid'), { lastLogin: new Date() }))
  })

  it('[LL-05] rôle inconnu update lastLogin → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'unknown-uid')
    await assertFails(updateDoc(doc(ctx.firestore(), 'users', 'unknown-uid'), { lastLogin: new Date() }))
  })

  it('[LL-06] store_admin update lastLogin + role simultané → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertFails(updateDoc(doc(ctx.firestore(), 'users', 'store-admin-a-uid'), {
      lastLogin: new Date(), role: 'system_manager',
    }))
  })

  it('[LL-07] store_admin update lastLogin + active → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertFails(updateDoc(doc(ctx.firestore(), 'users', 'store-admin-a-uid'), {
      lastLogin: new Date(), active: false,
    }))
  })

  it('[LL-08] store_admin update lastLogin + email → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertFails(updateDoc(doc(ctx.firestore(), 'users', 'store-admin-a-uid'), {
      lastLogin: new Date(), email: 'hacked@test.test',
    }))
  })

  it('[LL-09] dealer update lastLogin + ajout storeId → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(updateDoc(doc(ctx.firestore(), 'users', 'dealer-a-uid'), {
      lastLogin: new Date(), storeId: 'store-A',
    }))
  })

  it('[LL-10] store_admin update lastLogin + suppression storeId → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertFails(updateDoc(doc(ctx.firestore(), 'users', 'store-admin-a-uid'), {
      lastLogin: new Date(), storeId: deleteField(),
    }))
  })
})

// ─────────────────────────────────────────────────────────────
// TC-V24-TSN — Validation targetStoreName liée au store réel
// ─────────────────────────────────────────────────────────────

async function seedTSNStores() {
  await seedDocument(testEnv, 'stores', 'store-no-name', {
    active: true, adminUid: 'store-admin-c-uid',
  })
  await seedDocument(testEnv, 'stores', 'store-empty-name', {
    name: '', active: true, adminUid: 'store-admin-c-uid',
  })
}

describe('TC-V24-TSN — targetStoreName doit correspondre au name réel du store', () => {
  it('[TSN-01] bon ID store-A + faux nom → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({
      targetStoreId: 'store-A', targetStoreName: 'Boutique AA',
    })))
  })

  it('[TSN-02] bon ID store-A + nom de store-B → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({
      targetStoreId: 'store-A', targetStoreName: 'Boutique B',
    })))
  })

  it('[TSN-03] bon ID + nom avec espace ajouté → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({
      targetStoreId: 'store-A', targetStoreName: 'Boutique A ',
    })))
  })

  it('[TSN-04] bon ID + nom en minuscules → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({
      targetStoreId: 'store-A', targetStoreName: 'boutique a',
    })))
  })

  it('[TSN-05] store sans champ name → deny', async () => {
    await seedAll(); await seedTSNStores()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({
      targetStoreId: 'store-no-name', targetStoreName: 'Quelconque',
    })))
  })

  it('[TSN-06] store avec name vide → deny', async () => {
    await seedAll(); await seedTSNStores()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({
      targetStoreId: 'store-empty-name', targetStoreName: '',
    })))
  })
})

// ─────────────────────────────────────────────────────────────
// TC-V24-DID — Identité Dealer : types et profil
// ─────────────────────────────────────────────────────────────

async function seedDealerNoEmail() {
  await seedDocument(testEnv, 'users', 'dealer-no-email-uid', {
    role: 'dealer', active: true, name: 'No Email Dealer',
  })
}

async function seedDealerNoName() {
  await seedDocument(testEnv, 'users', 'dealer-no-name-uid', {
    role: 'dealer', active: true, email: 'no-name@test.test',
  })
}

describe('TC-V24-DID — Validation identité dealer (types, profil)', () => {
  it('[DID-01] dealerEmail = nombre entier → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({ dealerEmail: 123 })))
  })

  it('[DID-02] dealerEmail = chaîne vide → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({ dealerEmail: '' })))
  })

  it('[DID-03] dealerName = nombre entier → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({ dealerName: 456 })))
  })

  it('[DID-04] dealerName = chaîne vide → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({ dealerName: '' })))
  })

  it('[DID-05] profil dealer sans champ email → deny', async () => {
    await seedAll(); await seedDealerNoEmail()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-no-email-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({
      dealerUid: 'dealer-no-email-uid', dealerEmail: 'no-email@test.test', dealerName: 'No Email Dealer',
    })))
  })

  it('[DID-06] profil dealer sans champ name → deny', async () => {
    await seedAll(); await seedDealerNoName()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-no-name-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({
      dealerUid: 'dealer-no-name-uid', dealerEmail: 'no-name@test.test', dealerName: 'Some Name',
    })))
  })
})

// ─────────────────────────────────────────────────────────────
// TC-V24-SID — Validation targetStoreId
// ─────────────────────────────────────────────────────────────

async function seedSIDStores() {
  await seedDocument(testEnv, 'stores', 'store-no-active', {
    name: 'Sans Active', adminUid: 'store-admin-c-uid',
  })
  await seedDocument(testEnv, 'stores', 'store-string-active', {
    name: 'String Active', active: 'true', adminUid: 'store-admin-c-uid',
  })
}

describe('TC-V24-SID — Validation targetStoreId (type, taille, boutique)', () => {
  it('[SID-01] targetStoreId = chaîne vide → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({
      targetStoreId: '', targetStoreName: '',
    })))
  })

  it('[SID-02] targetStoreId = nombre → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({
      targetStoreId: 123, targetStoreName: 'Boutique A',
    })))
  })

  it('[SID-03] store sans champ active → deny', async () => {
    await seedAll(); await seedSIDStores()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({
      targetStoreId: 'store-no-active', targetStoreName: 'Sans Active',
    })))
  })

  it('[SID-04] store avec active = "true" (string) → deny', async () => {
    await seedAll(); await seedSIDStores()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r'), validRequest({
      targetStoreId: 'store-string-active', targetStoreName: 'String Active',
    })))
  })
})

// ─────────────────────────────────────────────────────────────
// TC-V24-BYP — Bypass : rôles globaux avec storeId falsifié
// ─────────────────────────────────────────────────────────────

async function seedBypassUsers() {
  // dealer avec storeId : ne doit pas obtenir accès boutique
  await seedDocument(testEnv, 'users', 'dealer-spoof-uid', {
    role: 'dealer', active: true, storeId: 'store-A', storeName: 'Boutique A',
    email: 'spoof@test.test', name: 'Spoof Dealer',
  })
  // system_manager avec storeId : ne doit pas écrire dans les sous-collections boutique
  await seedDocument(testEnv, 'users', 'sm-spoof-uid', {
    role: 'system_manager', active: true, storeId: 'store-A', storeName: 'Boutique A',
    email: 'smspoof@test.test', name: 'SM Spoof',
  })
  // rôle inconnu avec storeId : aucun accès boutique ni global
  await seedDocument(testEnv, 'users', 'unknown-storeId-uid', {
    role: 'unknown_role', active: true, storeId: 'store-A', storeName: 'Boutique A',
    email: 'unk@test.test', name: 'Unknown',
  })
}

describe('TC-V24-BYP — Contournement refusé : rôles globaux avec storeId', () => {
  // ⚠ RETOURNÉE le 31/08/2026, et il faut le dire sans euphémisme : la garde
  //   est `isDealer()`, qui ne regarde PAS le storeId du profil. Un compte
  //   dealer dont le profil porterait un storeId falsifié gagne donc le même
  //   accès en lecture aux brouillons qu'un dealer ordinaire. Ce n'est pas un
  //   défaut d'écriture — c'est ce que « rôle global » veut dire —, mais c'est
  //   une conséquence de l'élargissement, et elle est consignée ici plutôt que
  //   contournée par une règle plus fine qui donnerait l'illusion du contraire.
  //
  //   [BYP-02] juste en dessous n'a PAS bougé : le storeId falsifié ne donne
  //   toujours rien sur `history`. C'est la preuve que le spoof ne « débloque »
  //   rien par lui-même — seul le rôle dealer compte, et seulement sur drafts.
  it('[BYP-01] dealer-spoof lit clients/store-A/drafts → allow (conséquence assumée)', async () => {
    await seedAll(); await seedSubCollections(); await seedBypassUsers()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-spoof-uid')
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'clients', 'store-A', 'drafts', 'draft-A1')))
  })

  it('[BYP-02] dealer-spoof lit clients/store-A/history → deny', async () => {
    await seedAll(); await seedSubCollections(); await seedBypassUsers()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-spoof-uid')
    await assertFails(getDoc(doc(ctx.firestore(), 'clients', 'store-A', 'history', 'hist-A1')))
  })

  it('[BYP-03] dealer-spoof crée globalClient → deny', async () => {
    await seedAll(); await seedBypassUsers()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-spoof-uid')
    await assertFails(addDoc(collection(ctx.firestore(), 'globalClients'), {
      nom: 'Test', prenom: 'Client', registeredStoreId: 'store-A', registeredStoreName: 'Boutique A',
    }))
  })

  it('[BYP-04] sm-spoof crée globalClient → deny', async () => {
    await seedAll(); await seedBypassUsers()
    const ctx = getAuthenticatedContext(testEnv, 'sm-spoof-uid')
    await assertFails(addDoc(collection(ctx.firestore(), 'globalClients'), {
      nom: 'Test', prenom: 'Client', registeredStoreId: 'store-A', registeredStoreName: 'Boutique A',
    }))
  })

  it('[BYP-05] dealer-spoof lit clients/store-A (racine) → deny', async () => {
    await seedAll(); await seedBypassUsers()
    await seedDocument(testEnv, 'clients', 'store-A', { _placeholder: true })
    const ctx = getAuthenticatedContext(testEnv, 'dealer-spoof-uid')
    await assertFails(getDoc(doc(ctx.firestore(), 'clients', 'store-A')))
  })

  it('[BYP-06] rôle inconnu avec storeId lit globalClients → deny', async () => {
    await seedAll(); await seedBypassUsers()
    await seedDocument(testEnv, 'globalClients', 'gc-test', {
      nom: 'Test', prenom: 'Client', registeredStoreId: 'store-A', registeredStoreName: 'Boutique A',
    })
    const ctx = getAuthenticatedContext(testEnv, 'unknown-storeId-uid')
    await assertFails(getDoc(doc(ctx.firestore(), 'globalClients', 'gc-test')))
  })

  it('[BYP-07] dealer-spoof lit profil même boutique → deny (hasProfile() bloqué)', async () => {
    await seedAll(); await seedBypassUsers()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-spoof-uid')
    await assertFails(getDoc(doc(ctx.firestore(), 'users', 'store-admin-a-uid')))
  })

  it('[BYP-08] sm-spoof crée draft dans store-A → deny', async () => {
    await seedAll(); await seedBypassUsers()
    const ctx = getAuthenticatedContext(testEnv, 'sm-spoof-uid')
    await assertFails(addDoc(collection(ctx.firestore(), 'clients', 'store-A', 'drafts'), {
      type: 'Dépôt', montant: 1000, clientId: 'c1', statut: 'Non Terminées', storeId: 'store-A',
    }))
  })
})

// ─────────────────────────────────────────────────────────────
// TC-V24-QRY — Requêtes dealerRequests filtrées vs non filtrées
// ─────────────────────────────────────────────────────────────

describe('TC-V24-QRY — Règles ne servent pas de filtres automatiques', () => {
  it('[QRY-01] dealer-A liste sans filtre → deny (contient docs d\'autres dealers)', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(getDocs(collection(ctx.firestore(), 'dealerRequests')))
  })

  it('[QRY-02] dealer-A requête where(dealerUid == dealer-b-uid) → deny', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    const q = query(collection(ctx.firestore(), 'dealerRequests'), where('dealerUid', '==', 'dealer-b-uid'))
    await assertFails(getDocs(q))
  })

  it('[QRY-03] store-admin-A liste sans filtre → deny (contient docs store-B)', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertFails(getDocs(collection(ctx.firestore(), 'dealerRequests')))
  })

  it('[QRY-04] non authentifié liste sans filtre → deny', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getUnauthenticatedContext(testEnv)
    await assertFails(getDocs(collection(ctx.firestore(), 'dealerRequests')))
  })
})

// ─────────────────────────────────────────────────────────────
// TC-V24-UPD2 — Update/delete complémentaires
// ─────────────────────────────────────────────────────────────

describe('TC-V24-UPD2 — Update et delete : matrice rôles complémentaires', () => {
  it('[UPD2-01] dealer-B (tiers) update req-da-a status → deny', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-b-uid')
    await assertFails(updateDoc(doc(ctx.firestore(), 'dealerRequests', 'req-da-a'), { status: 'confirmed' }))
  })

  it('[UPD2-02] store-admin-B update req-da-a (autre boutique) → deny', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-b-uid')
    await assertFails(updateDoc(doc(ctx.firestore(), 'dealerRequests', 'req-da-a'), { status: 'confirmed' }))
  })

  it('[UPD2-03] utilisateur inactif update → deny', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getAuthenticatedContext(testEnv, 'inactive-uid')
    await assertFails(updateDoc(doc(ctx.firestore(), 'dealerRequests', 'req-da-a'), { status: 'confirmed' }))
  })

  it('[UPD2-04] non authentifié update → deny', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getUnauthenticatedContext(testEnv)
    await assertFails(updateDoc(doc(ctx.firestore(), 'dealerRequests', 'req-da-a'), { status: 'confirmed' }))
  })

  it('[UPD2-05] utilisateur inactif delete → deny', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getAuthenticatedContext(testEnv, 'inactive-uid')
    await assertFails(deleteDoc(doc(ctx.firestore(), 'dealerRequests', 'req-da-a')))
  })

  it('[UPD2-06] non authentifié delete → deny', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getUnauthenticatedContext(testEnv)
    await assertFails(deleteDoc(doc(ctx.firestore(), 'dealerRequests', 'req-da-a')))
  })

  it('[UPD2-07] dealer update uniquement updatedAt → deny (update: if false)', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(updateDoc(doc(ctx.firestore(), 'dealerRequests', 'req-da-a'), { updatedAt: new Date() }))
  })

  it('[UPD2-08] dealer update pending → rejected → deny', async () => {
    await seedAll(); await seedDealerRequests()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(updateDoc(doc(ctx.firestore(), 'dealerRequests', 'req-da-a'), {
      status: 'rejected', rejectedBy: 'dealer-a-uid', rejectedAt: new Date(),
    }))
  })
})

// ─────────────────────────────────────────────────────────────
// TC-V24-CGN — Collection group négatifs complémentaires
// ─────────────────────────────────────────────────────────────

describe('TC-V24-CGN — Collection group : négatifs étendus', () => {
  it('[CGN-01] store-admin-A collectionGroup("history") getDocs → deny (contient store-B)', async () => {
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertFails(getDocs(collectionGroup(ctx.firestore(), 'history')))
  })

  it('[CGN-02] store-admin-A collectionGroup("drafts") getDocs → deny', async () => {
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertFails(getDocs(collectionGroup(ctx.firestore(), 'drafts')))
  })

  it('[CGN-03] store-admin-A collectionGroup("networkBalances") getDocs → deny (contient store-B)', async () => {
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertFails(getDocs(collectionGroup(ctx.firestore(), 'networkBalances')))
  })

  it('[CGN-04] dealer collectionGroup("history") getDocs → deny', async () => {
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(getDocs(collectionGroup(ctx.firestore(), 'history')))
  })

  // ⚠ RETOURNÉE le 31/08/2026 — c'est CETTE requête que l'accueil emploie :
  //   `listArgentDehors` lit le groupe entier en un aller-retour, comme
  //   `listNetworkCaisses` le fait pour les soldes. [CGN-04] (history) juste
  //   au-dessus n'a pas bougé : l'écart entre les deux est voulu.
  it('[CGN-05] dealer collectionGroup("drafts") getDocs → allow (élargi 31/08/2026)', async () => {
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    const snap = await assertSucceeds(getDocs(collectionGroup(ctx.firestore(), 'drafts')))
    // Deux boutiques au moins : c'est ce que la fonction agrège.
    expect(snap.docs.length).toBeGreaterThanOrEqual(2)
  })

  it('[CGN-06] utilisateur inactif collectionGroup("history") → deny', async () => {
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'inactive-uid')
    await assertFails(getDocs(collectionGroup(ctx.firestore(), 'history')))
  })

  it('[CGN-07] non authentifié collectionGroup("networkBalances") → deny', async () => {
    await seedAll(); await seedSubCollections()
    const ctx = getUnauthenticatedContext(testEnv)
    await assertFails(getDocs(collectionGroup(ctx.firestore(), 'networkBalances')))
  })

  it('[CGN-08] rôle inconnu collectionGroup("history") → deny', async () => {
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'unknown-uid')
    await assertFails(getDocs(collectionGroup(ctx.firestore(), 'history')))
  })
})

// ─────────────────────────────────────────────────────────────
// TC-V24-GCL — globalClients : system_manager lecture seule
// ─────────────────────────────────────────────────────────────

async function seedGlobalClients() {
  await seedDocument(testEnv, 'globalClients', 'gc-A1', {
    nom: 'Dupont', prenom: 'Jean', registeredStoreId: 'store-A', registeredStoreName: 'Boutique A',
  })
  await seedDocument(testEnv, 'globalClients', 'gc-B1', {
    nom: 'Martin', prenom: 'Marie', registeredStoreId: 'store-B', registeredStoreName: 'Boutique B',
  })
}

describe('TC-V24-GCL — globalClients : system_manager lecture seule, dealer refusé', () => {
  it('[GCL-01] system_manager lit un globalClient → allow', async () => {
    await seedAll(); await seedGlobalClients()
    const ctx = getAuthenticatedContext(testEnv, 'system-mgr-uid')
    const snap = await assertSucceeds(getDoc(doc(ctx.firestore(), 'globalClients', 'gc-A1')))
    expect(snap.data().nom).toBe('Dupont')
  })

  it('[GCL-02] system_manager liste les globalClients → allow', async () => {
    await seedAll(); await seedGlobalClients()
    const ctx = getAuthenticatedContext(testEnv, 'system-mgr-uid')
    const snap = await assertSucceeds(getDocs(collection(ctx.firestore(), 'globalClients')))
    expect(snap.docs.length).toBeGreaterThanOrEqual(2)
  })

  it('[GCL-03] system_manager ne crée pas globalClient → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'system-mgr-uid')
    await assertFails(addDoc(collection(ctx.firestore(), 'globalClients'), {
      nom: 'Test', prenom: 'Client', registeredStoreId: 'store-A', registeredStoreName: 'Boutique A',
    }))
  })

  it('[GCL-04] system_manager ne modifie pas globalClient → deny', async () => {
    await seedAll(); await seedGlobalClients()
    const ctx = getAuthenticatedContext(testEnv, 'system-mgr-uid')
    await assertFails(updateDoc(doc(ctx.firestore(), 'globalClients', 'gc-A1'), {
      nom: 'Modifié', prenom: 'Jean', registeredStoreId: 'store-A', registeredStoreName: 'Boutique A',
    }))
  })

  it('[GCL-05] system_manager ne supprime pas globalClient → deny', async () => {
    await seedAll(); await seedGlobalClients()
    const ctx = getAuthenticatedContext(testEnv, 'system-mgr-uid')
    await assertFails(deleteDoc(doc(ctx.firestore(), 'globalClients', 'gc-A1')))
  })

  it('[GCL-06] dealer ne lit pas globalClient → deny', async () => {
    await seedAll(); await seedGlobalClients()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(getDoc(doc(ctx.firestore(), 'globalClients', 'gc-A1')))
  })

  it('[GCL-07] dealer avec storeId falsifié ne lit pas globalClient → deny', async () => {
    await seedAll(); await seedGlobalClients(); await seedBypassUsers()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-spoof-uid')
    await assertFails(getDoc(doc(ctx.firestore(), 'globalClients', 'gc-A1')))
  })
})

// ─────────────────────────────────────────────────────────────
// TC-V24-AMT — Montant élevé : caractérisation sans plafond
// ─────────────────────────────────────────────────────────────

describe('TC-V24-AMT — Montant : absence de plafond métier caractérisée', () => {
  it('[AMT-01] amount = 1 000 000 000 (entier positif, sans plafond règle) → allow', async () => {
    /**
     * Risque documenté : aucun plafond métier dans les règles Firestore.
     * La future Cloud Function de confirmation devra appliquer une limite.
     * L'interface Dealer devra demander une confirmation explicite au-delà d'un seuil.
     */
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertSucceeds(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r-amt'), validRequest({ amount: 1000000000 })))
  })
})

// ─────────────────────────────────────────────────────────────
// TC-V24-LQA — Validation liquidityAmount
// Contrat : null pour stock_add / liquidity_add, int > 0 pour open_day
// ─────────────────────────────────────────────────────────────

describe('TC-V24-LQA — Validation liquidityAmount', () => {
  it('[LQA-01] liquidityAmount null + requestType stock_add → allow', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertSucceeds(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r-lqa-01'),
      validRequest({ requestType: 'stock_add', liquidityAmount: null })))
  })

  it('[LQA-02] liquidityAmount null + requestType liquidity_add → allow', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertSucceeds(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r-lqa-02'),
      validRequest({ requestType: 'liquidity_add', liquidityAmount: null })))
  })

  it('[LQA-03] liquidityAmount champ absent (obligatoire) → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    const data = validRequest()
    delete data.liquidityAmount
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r-lqa-03'), data))
  })

  it('[LQA-04] liquidityAmount = "string" + stock_add → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r-lqa-04'),
      validRequest({ liquidityAmount: 'abc' })))
  })

  it('[LQA-05] liquidityAmount = -1 + stock_add → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r-lqa-05'),
      validRequest({ liquidityAmount: -1 })))
  })

  it('[LQA-06] liquidityAmount = 1.5 (décimal) + stock_add → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r-lqa-06'),
      validRequest({ liquidityAmount: 1.5 })))
  })

  it('[LQA-07] liquidityAmount = 0 + stock_add → deny (non null et non int > 0)', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r-lqa-07'),
      validRequest({ liquidityAmount: 0 })))
  })

  it('[LQA-08] liquidityAmount = 50000 + requestType stock_add → deny (doit être null pour types standard)', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r-lqa-08'),
      validRequest({ requestType: 'stock_add', liquidityAmount: 50000 })))
  })

  it('[LQA-09] liquidityAmount = 50000 + requestType liquidity_add → deny (doit être null pour types standard)', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r-lqa-09'),
      validRequest({ requestType: 'liquidity_add', liquidityAmount: 50000 })))
  })

  it('[LQA-10] open_day + liquidityAmount int > 0 → allow', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertSucceeds(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r-lqa-10'),
      validRequest({ requestType: 'open_day', liquidityAmount: 75000 })))
  })

  it('[LQA-11] open_day + liquidityAmount null → deny (obligatoire pour open_day)', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r-lqa-11'),
      validRequest({ requestType: 'open_day', liquidityAmount: null })))
  })

  it('[LQA-12] open_day + liquidityAmount = 0 → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r-lqa-12'),
      validRequest({ requestType: 'open_day', liquidityAmount: 0 })))
  })

  it('[LQA-13] open_day + liquidityAmount négatif → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r-lqa-13'),
      validRequest({ requestType: 'open_day', liquidityAmount: -5000 })))
  })

  it('[LQA-14] open_day + liquidityAmount string → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'dealerRequests', 'r-lqa-14'),
      validRequest({ requestType: 'open_day', liquidityAmount: '75000' })))
  })
})

// ===========================================================================
// TC-V24-BORNE — l'élargissement de `drafts` s'arrête où il doit s'arrêter
//
// Le 31/08/2026, `clients/{storeId}/drafts` est passé en lecture pour le rôle
// dealer (décision client, cf. § Demandes Dealer de firestore.rules). Un
// élargissement ne se teste pas seulement par ce qu'il ouvre : il se teste par
// ce qu'il LAISSE FERMÉ. Ce bloc est la borne.
//
// Chaque cas est vérifié sur DEUX boutiques quand le chemin en dépend
// (AGENTS.md), parce qu'une règle portée par `isDealer()` ne regarde pas le
// storeId — et que si elle ne passait que sur store-A, c'est qu'elle ne serait
// pas celle qu'on croit avoir écrite.
// ===========================================================================

describe('TC-V24-BORNE — ce que l’élargissement de drafts ne donne PAS', () => {
  it('[BOR-01] dealer ne CRÉE pas un draft (store-A)', async () => {
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'clients', 'store-A', 'drafts', 'forge-A'),
      { type: 'Dépôt', montant: 1000, clientId: 'c1', statut: 'Non Terminées' }))
  })

  it('[BOR-02] dealer ne CRÉE pas un draft (store-B)', async () => {
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-b-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'clients', 'store-B', 'drafts', 'forge-B'),
      { type: 'Dépôt', montant: 1000, clientId: 'c2', statut: 'Non Terminées' }))
  })

  it('[BOR-03] dealer ne MODIFIE pas un draft', async () => {
    // Le montant restant dû est lu par le dealer et sert à afficher « Dehors ».
    // S'il pouvait l'écrire, il fabriquerait son propre rapprochement.
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(updateDoc(doc(ctx.firestore(), 'clients', 'store-A', 'drafts', 'draft-A1'),
      { montant: 999999 }))
  })

  it('[BOR-04] dealer ne SUPPRIME pas un draft', async () => {
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(deleteDoc(doc(ctx.firestore(), 'clients', 'store-A', 'drafts', 'draft-A1')))
  })

  it('[BOR-05] dealer ne lit pas les règlements d’un draft (store-A)', async () => {
    // Inutile ET refusé : le reste dû est porté par le document `drafts`
    // lui-même (`remainingAmount`, écrit par addTransactionPayment). La
    // sous-collection, elle, détaille qui a payé quoi et quand.
    await seedAll(); await seedSubCollections()
    await seedDocument(testEnv, 'clients/store-A/drafts/draft-A1/settlements', 's1',
      { amount: 500, action: 'encaisser' })
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(getDoc(doc(ctx.firestore(),
      'clients', 'store-A', 'drafts', 'draft-A1', 'settlements', 's1')))
  })

  it('[BOR-06] dealer ne lit pas les règlements d’un draft (store-B)', async () => {
    await seedAll(); await seedSubCollections()
    await seedDocument(testEnv, 'clients/store-B/drafts/draft-B1/settlements', 's1',
      { amount: 500, action: 'encaisser' })
    const ctx = getAuthenticatedContext(testEnv, 'dealer-b-uid')
    await assertFails(getDoc(doc(ctx.firestore(),
      'clients', 'store-B', 'drafts', 'draft-B1', 'settlements', 's1')))
  })

  it('[BOR-07] dealer ne lit toujours pas l’historique (store-A et store-B)', async () => {
    // C'est l'écart voulu : un brouillon est une opération en COURS, dont le
    // solde manque au rapprochement ; l'historique est l'activité client
    // passée, qui ne lui a jamais été nécessaire.
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(getDoc(doc(ctx.firestore(), 'clients', 'store-A', 'history', 'hist-A1')))
    await assertFails(getDoc(doc(ctx.firestore(), 'clients', 'store-B', 'history', 'hist-B1')))
  })

  it('[BOR-08] dealer ne lit pas le document racine d’une boutique', async () => {
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(getDoc(doc(ctx.firestore(), 'clients', 'store-A')))
    await assertFails(getDoc(doc(ctx.firestore(), 'clients', 'store-B')))
  })

  it('[BOR-09] dealer ne lit pas les sessions ni les journaux d’audit', async () => {
    await seedAll(); await seedSubCollections()
    await seedDocument(testEnv, 'clients/store-A/sessions', 'sess-1', { open: true })
    await seedDocument(testEnv, 'clients/store-A/auditLogs', 'log-1', { action: 'x' })
    const ctx = getAuthenticatedContext(testEnv, 'dealer-a-uid')
    await assertFails(getDoc(doc(ctx.firestore(), 'clients', 'store-A', 'sessions', 'sess-1')))
    await assertFails(getDoc(doc(ctx.firestore(), 'clients', 'store-A', 'auditLogs', 'log-1')))
  })

  it('[BOR-10] un utilisateur INACTIF ne profite pas de l’élargissement', async () => {
    // `isDealer()` passe par `isActiveUser()` : désactiver un compte doit lui
    // retirer l'accès le jour même, sans changer une règle.
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'inactive-uid')
    await assertFails(getDoc(doc(ctx.firestore(), 'clients', 'store-A', 'drafts', 'draft-A1')))
    await assertFails(getDocs(collectionGroup(ctx.firestore(), 'drafts')))
  })

  it('[BOR-11] un rôle inconnu et un anonyme ne lisent aucun draft', async () => {
    await seedAll(); await seedSubCollections()
    const inconnu = getAuthenticatedContext(testEnv, 'unknown-uid')
    await assertFails(getDoc(doc(inconnu.firestore(), 'clients', 'store-A', 'drafts', 'draft-A1')))
    const anon = getUnauthenticatedContext(testEnv)
    await assertFails(getDoc(doc(anon.firestore(), 'clients', 'store-A', 'drafts', 'draft-A1')))
    await assertFails(getDocs(collectionGroup(anon.firestore(), 'drafts')))
  })

  it('[BOR-12] un store_admin ne lit toujours pas les drafts d’une AUTRE boutique', async () => {
    // L'élargissement porte sur le rôle dealer, et sur lui seul : le
    // cloisonnement entre boutiques n'a pas bougé d'un pouce.
    await seedAll(); await seedSubCollections()
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'clients', 'store-A', 'drafts', 'draft-A1')))
    await assertFails(getDoc(doc(ctx.firestore(), 'clients', 'store-B', 'drafts', 'draft-B1')))
    await assertFails(getDocs(collectionGroup(ctx.firestore(), 'drafts')))
  })
})
