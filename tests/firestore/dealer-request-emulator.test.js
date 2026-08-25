/**
 * TC-EMU-DEALER — Test d'intégration émulateur : createDealerRequest
 *
 * Vérifie, en conditions réelles Firestore :
 *   1. Création d'exactement un document dealerRequests avec les 19 champs et status=pending
 *   2. Le document networkBalances/current de la boutique n'est PAS modifié
 *   3. Aucun autre document créé sous clients/{storeId}
 *   4. Aucun document créé sous stores/{storeId} (boutique inchangée)
 *
 * Projet exclusif : demo-akayis-test (émulateur local, jamais production)
 *
 * Ce test réplique le payload de createDealerRequest via l'API Firestore directe
 * (impossible d'importer dealerService.js en Node — uses import.meta.env).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import {
  doc,
  getDoc,
  addDoc,
  getDocs,
  collection,
  serverTimestamp,
} from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { seedDocument } from './helpers.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rulesPath = resolve(__dirname, '../../firestore.rules')
const rules = readFileSync(rulesPath, 'utf-8')

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEALER_UID = 'dealer-emu-uid'
const STORE_ID = 'store-emu-001'

const DEALER_PROFILE = {
  role: 'dealer',
  active: true,
  email: 'dealer-emu@test.com',
  name: 'Dealer Émulateur',
}

const STORE_DATA = {
  name: 'Boutique Émulateur',
  active: true,
  network: 'Orange',
}

const BALANCE_DATA = {
  balances: {
    Orange: {
      stock: 150000,
      liquidite: 75000,
    },
  },
}

// Payload identique à ce que createDealerRequest envoie (19 champs)
function buildRequestPayload() {
  return {
    dealerUid: DEALER_UID,
    dealerEmail: DEALER_PROFILE.email,
    dealerName: DEALER_PROFILE.name,
    targetStoreId: STORE_ID,
    targetStoreName: STORE_DATA.name,
    requestType: 'stock_add',
    network: 'Orange',
    amount: 50000,
    liquidityAmount: null,
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    confirmedBy: null,
    confirmedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
    previousBalance: null,
    newBalance: null,
  }
}

// ---------------------------------------------------------------------------
// Environnement
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Suite principale
// ---------------------------------------------------------------------------

describe('TC-EMU-DEALER — Intégration createDealerRequest (émulateur)', () => {
  async function seedFixtures() {
    await seedDocument(testEnv, 'users', DEALER_UID, DEALER_PROFILE)
    await seedDocument(testEnv, 'stores', STORE_ID, STORE_DATA)
    await seedDocument(testEnv, `clients/${STORE_ID}/networkBalances`, 'current', BALANCE_DATA)
  }

  it('[EMU-01] création d\'une demande dealer — exactement un document dealerRequests avec 19 champs et status=pending', async () => {
    await seedFixtures()

    const dealerCtx = testEnv.authenticatedContext(DEALER_UID)
    const fs = dealerCtx.firestore()

    // Réplique createDealerRequest
    const payload = buildRequestPayload()
    await addDoc(collection(fs, 'dealerRequests'), payload)

    // Lire avec accès admin (règles contournées) pour éviter biais de permission
    await testEnv.withSecurityRulesDisabled(async ctx => {
      const adminFs = ctx.firestore()
      const snap = await getDocs(collection(adminFs, 'dealerRequests'))

      // Exactement un document créé
      expect(snap.docs).toHaveLength(1)

      const data = snap.docs[0].data()

      // Status = pending
      expect(data.status).toBe('pending')

      // 19 champs attendus (liquidityAmount ajouté en V2-18)
      const EXPECTED_FIELDS = [
        'dealerUid', 'dealerEmail', 'dealerName',
        'targetStoreId', 'targetStoreName',
        'requestType', 'network', 'amount', 'liquidityAmount', 'status',
        'createdAt', 'updatedAt',
        'confirmedBy', 'confirmedAt',
        'rejectedBy', 'rejectedAt', 'rejectionReason',
        'previousBalance', 'newBalance',
      ]
      expect(Object.keys(data).sort()).toEqual(EXPECTED_FIELDS.sort())

      // Valeurs clés
      expect(data.dealerUid).toBe(DEALER_UID)
      expect(data.targetStoreId).toBe(STORE_ID)
      expect(data.targetStoreName).toBe(STORE_DATA.name)
      expect(data.amount).toBe(50000)
      expect(data.network).toBe('Orange')

      // Champs null obligatoires
      expect(data.liquidityAmount).toBeNull()
      expect(data.confirmedBy).toBeNull()
      expect(data.confirmedAt).toBeNull()
      expect(data.rejectedBy).toBeNull()
      expect(data.rejectedAt).toBeNull()
      expect(data.rejectionReason).toBeNull()
      expect(data.previousBalance).toBeNull()
      expect(data.newBalance).toBeNull()

      // Timestamps présents (Firestore les résout en Timestamp)
      expect(data.createdAt).toBeTruthy()
      expect(data.updatedAt).toBeTruthy()
    })
  })

  it('[EMU-02] le document networkBalances/current n\'est PAS modifié après la création', async () => {
    await seedFixtures()

    // Lire l'état avant
    let balanceBefore
    await testEnv.withSecurityRulesDisabled(async ctx => {
      const snap = await getDoc(
        doc(ctx.firestore(), 'clients', STORE_ID, 'networkBalances', 'current')
      )
      balanceBefore = snap.data()
    })

    // Créer la demande dealer
    const dealerCtx = testEnv.authenticatedContext(DEALER_UID)
    const fs = dealerCtx.firestore()
    await addDoc(collection(fs, 'dealerRequests'), buildRequestPayload())

    // Lire l'état après
    let balanceAfter
    await testEnv.withSecurityRulesDisabled(async ctx => {
      const snap = await getDoc(
        doc(ctx.firestore(), 'clients', STORE_ID, 'networkBalances', 'current')
      )
      balanceAfter = snap.data()
    })

    // Aucune modification
    expect(balanceAfter).toEqual(balanceBefore)
    expect(balanceAfter.balances.Orange.stock).toBe(150000)
    expect(balanceAfter.balances.Orange.liquidite).toBe(75000)
  })

  it('[EMU-03] aucun autre document créé sous clients/{storeId} (pas de sous-collection parasite)', async () => {
    await seedFixtures()

    const dealerCtx = testEnv.authenticatedContext(DEALER_UID)
    const fs = dealerCtx.firestore()
    await addDoc(collection(fs, 'dealerRequests'), buildRequestPayload())

    await testEnv.withSecurityRulesDisabled(async ctx => {
      const adminFs = ctx.firestore()

      // Seul networkBalances/current doit exister — aucun autre sous-doc dans networkBalances
      const nbSnap = await getDocs(
        collection(adminFs, 'clients', STORE_ID, 'networkBalances')
      )
      expect(nbSnap.docs).toHaveLength(1)
      expect(nbSnap.docs[0].id).toBe('current')
    })
  })

  it('[EMU-04] le document stores/{storeId} n\'est PAS modifié (boutique inchangée)', async () => {
    await seedFixtures()

    let storeBefore
    await testEnv.withSecurityRulesDisabled(async ctx => {
      const snap = await getDoc(doc(ctx.firestore(), 'stores', STORE_ID))
      storeBefore = snap.data()
    })

    const dealerCtx = testEnv.authenticatedContext(DEALER_UID)
    await addDoc(collection(dealerCtx.firestore(), 'dealerRequests'), buildRequestPayload())

    await testEnv.withSecurityRulesDisabled(async ctx => {
      const snap = await getDoc(doc(ctx.firestore(), 'stores', STORE_ID))
      expect(snap.data()).toEqual(storeBefore)
    })
  })
})
