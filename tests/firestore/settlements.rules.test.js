/**
 * TC-062 — Règles Firestore pour la sous-collection settlements.
 *
 * Chemins couverts :
 *   - clients/{storeId}/drafts/{draftId}/settlements/{settlementId}
 *   - clients/{storeId}/history/{historyId}/settlements/{settlementId}
 *
 * Politique :
 *   - Lecture : isStoreMember(storeId) || isSystemManager()
 *   - Écriture : false (Cloud Functions Admin SDK uniquement)
 *
 * Cas couverts :
 *   [TC-062-01]  cashier actif bonne boutique — getDoc drafts/settlements — allow
 *   [TC-062-02]  store_admin actif bonne boutique — getDoc drafts/settlements — allow
 *   [TC-062-03]  system_manager — getDoc drafts/settlements — allow
 *   [TC-062-04]  autre boutique — getDoc drafts/settlements — deny
 *   [TC-062-05]  dealer — getDoc drafts/settlements — deny
 *   [TC-062-06]  utilisateur inactif — getDoc drafts/settlements — deny
 *   [TC-062-07]  non connecté — getDoc drafts/settlements — deny
 *   [TC-062-08]  cashier actif bonne boutique — create direct drafts/settlements — deny
 *   [TC-062-09]  cashier actif bonne boutique — update direct drafts/settlements — deny
 *   [TC-062-10]  cashier actif bonne boutique — delete direct drafts/settlements — deny
 *   [TC-062-11]  system_manager — create direct — deny
 *   [TC-062-12]  system_manager — getDoc autre boutique par chemin complet — allow
 *   [TC-062-13]  member boutique A — getDoc settlement boutique B — deny
 *   [TC-062-14]  cashier actif bonne boutique — getDoc history/settlements — allow
 *   [TC-062-15]  autre boutique — getDoc history/settlements — deny
 *   [TC-062-16]  system_manager — getDoc history/settlements — allow
 *   [TC-062-17]  non connecté — getDoc history/settlements — deny
 *   [TC-062-18]  cashier actif bonne boutique — create history/settlements — deny
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
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

// ─────────────────────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────────────────────

const STORE_A      = 'store-062-aaa'
const STORE_B      = 'store-062-bbb'
const DRAFT_ID     = 'draft-062-001'
const HISTORY_ID   = 'hist-062-001'
const SETTLE_ID    = 'pmt_draft-062-001_actor_k1'
const H_SETTLE_ID  = 'pmt_draft-062-001_actor_k2'

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

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

afterAll(async () => {
  if (testEnv) await testEnv.cleanup()
})

beforeEach(async () => {
  await testEnv.clearFirestore()
})

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const SETTLEMENT_DOC = {
  type:         'payment',
  amount:       5000,
  paymentMethod:'Cash',
  actorUid:     'uid-member-062-aaa',
  actorRole:    'member',
  actorStoreId: STORE_A,
  draftId:      DRAFT_ID,
  idempotencyKey: 'k1',
  createdAt:    '2026-07-01T10:00:00.000Z',
}

async function seedAll() {
  // Profils boutique A
  await seedDocument(testEnv, 'users', 'uid-member-062-aaa', {
    active: true, role: 'member', storeId: STORE_A, storeName: 'Store 062 A',
  })
  await seedDocument(testEnv, 'users', 'uid-admin-062-aaa', {
    active: true, role: 'store_admin', storeId: STORE_A, storeName: 'Store 062 A',
  })
  // Profil boutique B
  await seedDocument(testEnv, 'users', 'uid-member-062-bbb', {
    active: true, role: 'member', storeId: STORE_B, storeName: 'Store 062 B',
  })
  // Profil inactif boutique A
  await seedDocument(testEnv, 'users', 'uid-inactive-062-aaa', {
    active: false, role: 'member', storeId: STORE_A, storeName: 'Store 062 A',
  })
  // Dealer global
  await seedDocument(testEnv, 'users', 'uid-dealer-062', {
    active: true, role: 'dealer', storeName: 'N/A',
  })
  // system_manager global
  await seedDocument(testEnv, 'users', 'uid-sysmanager-062', {
    active: true, role: 'system_manager', storeName: 'N/A',
  })
  // Settlement sous draft
  await seedDocument(
    testEnv,
    `clients/${STORE_A}/drafts/${DRAFT_ID}/settlements`,
    SETTLE_ID,
    SETTLEMENT_DOC
  )
  // Settlement archivé sous history (copie lors du paiement final)
  await seedDocument(
    testEnv,
    `clients/${STORE_A}/history/${HISTORY_ID}/settlements`,
    H_SETTLE_ID,
    { ...SETTLEMENT_DOC, historyId: HISTORY_ID, fullySettled: true }
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function settlementRef(ctx) {
  return doc(ctx.firestore(), 'clients', STORE_A, 'drafts', DRAFT_ID, 'settlements', SETTLE_ID)
}

function historySettlementRef(ctx, storeId = STORE_A) {
  return doc(ctx.firestore(), 'clients', storeId, 'history', HISTORY_ID, 'settlements', H_SETTLE_ID)
}

// ─────────────────────────────────────────────────────────────────────────────
// TC-062 — Règles Firestore settlements
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-062 — Règles Firestore settlements (read)', () => {
  it('[TC-062-01] cashier actif bonne boutique — getDoc — allow', async () => {
    await seedAll()
    const ctx  = getAuthenticatedContext(testEnv, 'uid-member-062-aaa')
    const snap = await assertSucceeds(getDoc(settlementRef(ctx)))
    expect(snap.exists()).toBe(true)
    expect(snap.data().amount).toBe(5000)
  })

  it('[TC-062-02] store_admin actif bonne boutique — getDoc — allow', async () => {
    await seedAll()
    const ctx  = getAuthenticatedContext(testEnv, 'uid-admin-062-aaa')
    const snap = await assertSucceeds(getDoc(settlementRef(ctx)))
    expect(snap.exists()).toBe(true)
  })

  it('[TC-062-03] system_manager — getDoc — allow', async () => {
    await seedAll()
    const ctx  = getAuthenticatedContext(testEnv, 'uid-sysmanager-062')
    const snap = await assertSucceeds(getDoc(settlementRef(ctx)))
    expect(snap.exists()).toBe(true)
  })

  it('[TC-062-04] autre boutique (storeB) — getDoc — deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-062-bbb')
    await assertFails(getDoc(settlementRef(ctx)))
  })

  it('[TC-062-05] dealer — getDoc — deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'uid-dealer-062')
    await assertFails(getDoc(settlementRef(ctx)))
  })

  it('[TC-062-06] utilisateur inactif — getDoc — deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'uid-inactive-062-aaa')
    await assertFails(getDoc(settlementRef(ctx)))
  })

  it('[TC-062-07] non connecté — getDoc — deny', async () => {
    await seedAll()
    const ctx = getUnauthenticatedContext(testEnv)
    await assertFails(getDoc(settlementRef(ctx)))
  })
})

describe('TC-062 — Règles Firestore settlements (write — toujours refusé)', () => {
  it('[TC-062-08] cashier actif bonne boutique — create direct — deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-062-aaa')
    const newRef = doc(ctx.firestore(), 'clients', STORE_A, 'drafts', DRAFT_ID, 'settlements', 'pmt_new')
    await assertFails(setDoc(newRef, { type: 'payment', amount: 1000 }))
  })

  it('[TC-062-09] cashier actif bonne boutique — update direct — deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-062-aaa')
    await assertFails(updateDoc(settlementRef(ctx), { amount: 9999 }))
  })

  it('[TC-062-10] cashier actif bonne boutique — delete direct — deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-062-aaa')
    await assertFails(deleteDoc(settlementRef(ctx)))
  })

  it('[TC-062-11] system_manager — create direct — deny', async () => {
    await seedAll()
    const ctx    = getAuthenticatedContext(testEnv, 'uid-sysmanager-062')
    const newRef = doc(ctx.firestore(), 'clients', STORE_A, 'drafts', DRAFT_ID, 'settlements', 'pmt_sys')
    await assertFails(setDoc(newRef, { type: 'payment', amount: 1000 }))
  })
})

describe('TC-062 — Règles Firestore settlements (accès cross-boutique)', () => {
  it('[TC-062-12] system_manager — getDoc d\'une autre boutique par chemin direct — allow', async () => {
    /**
     * La règle `allow read: if isStoreMember(storeId) || isSystemManager()` n'est pas
     * restreinte par boutique pour isSystemManager(). Un system_manager peut lire les
     * settlements de toutes les boutiques via leur chemin complet.
     * Ce comportement est intentionnel : l'Admin SDK (Cloud Functions) écrit, le
     * system_manager peut auditer n'importe quelle boutique.
     *
     * Note : il n'existe pas de règle `match /{path=**}/settlements/{docId}` — les
     * collection group queries sur "settlements" sont donc refusées par la règle par
     * défaut (allow read, write: if false). Seul l'accès par chemin complet est autorisé.
     */
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'uid-sysmanager-062')
    // Le document n'existe pas dans autre-store, mais les règles autorisent l'accès.
    const outRef = doc(
      ctx.firestore(),
      'clients', 'autre-store', 'drafts', DRAFT_ID, 'settlements', SETTLE_ID
    )
    const snap = await assertSucceeds(getDoc(outRef))
    // Le document n'existe pas dans cette boutique → exists() === false
    expect(snap.exists()).toBe(false)
  })

  it('[TC-062-13] member boutique A — getDoc settlement boutique B par chemin direct — deny', async () => {
    /**
     * isStoreMember(storeId) vérifie que le profil.storeId === storeId.
     * Un member de STORE_A ne peut pas lire les settlements de STORE_B (autre storeId).
     * isSystemManager() ne s'applique pas (role=member).
     */
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-062-aaa')
    const outRef = doc(
      ctx.firestore(),
      'clients', STORE_B, 'drafts', DRAFT_ID, 'settlements', SETTLE_ID
    )
    await assertFails(getDoc(outRef))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-062 — history/{historyId}/settlements/{settlementId}
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-062 — Règles Firestore history/settlements', () => {
  it('[TC-062-14] cashier actif bonne boutique — getDoc history/settlements — allow', async () => {
    await seedAll()
    const ctx  = getAuthenticatedContext(testEnv, 'uid-member-062-aaa')
    const snap = await assertSucceeds(getDoc(historySettlementRef(ctx)))
    expect(snap.exists()).toBe(true)
    expect(snap.data().fullySettled).toBe(true)
  })

  it('[TC-062-15] autre boutique — getDoc history/settlements — deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-062-bbb')
    await assertFails(getDoc(historySettlementRef(ctx)))
  })

  it('[TC-062-16] system_manager — getDoc history/settlements — allow', async () => {
    await seedAll()
    const ctx  = getAuthenticatedContext(testEnv, 'uid-sysmanager-062')
    const snap = await assertSucceeds(getDoc(historySettlementRef(ctx)))
    expect(snap.exists()).toBe(true)
  })

  it('[TC-062-17] non connecté — getDoc history/settlements — deny', async () => {
    await seedAll()
    const ctx = getUnauthenticatedContext(testEnv)
    await assertFails(getDoc(historySettlementRef(ctx)))
  })

  it('[TC-062-18] cashier actif bonne boutique — create history/settlements — deny', async () => {
    await seedAll()
    const ctx    = getAuthenticatedContext(testEnv, 'uid-member-062-aaa')
    const newRef = doc(ctx.firestore(), 'clients', STORE_A, 'history', HISTORY_ID, 'settlements', 'pmt_new')
    await assertFails(setDoc(newRef, { type: 'payment', amount: 1000 }))
  })
})
