/**
 * Règles Firestore — requête COLLECTION GROUP sur `settlements`.
 *
 * ⚠ Le nom `settlements` est PARTAGÉ dans ce dépôt. Il désigne :
 *   • les tranches de dette interne — internalDebts/{debtId}/settlements
 *   • les règlements du moteur de transactions client :
 *       clients/{storeId}/drafts/{draftId}/settlements
 *       clients/{storeId}/history/{historyId}/settlements
 *
 * Le badge de navigation « règlements à confirmer » compte les tranches en attente
 * via une requête de GROUPE. Ce joker traverse donc aussi les règlements du moteur
 * de transactions. La garde `'creditorStoreId' in resource.data` est ce qui les
 * exclut : ces documents-là n'ont pas ce champ dénormalisé.
 *
 * Ce fichier existe pour prouver la NON-FUITE. Sans la garde, une boutique pourrait
 * moissonner les règlements de transactions clients d'autres boutiques par ce chemin.
 *
 * Ne pas confondre avec settlements.rules.test.js, qui couvre les règlements du
 * moteur de transactions par leur chemin nominal.
 *
 * Projet exclusif : demo-akayis-test. Aucun accès Firebase production.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collectionGroup, getDocs, query, where } from 'firebase/firestore'
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

async function seedAll() {
  await seedDocument(testEnv, 'users', 'store-admin-a-uid', { role: 'store_admin', active: true, storeId: 'store-A', email: 'a@test.test', name: 'Admin A' })
  await seedDocument(testEnv, 'users', 'store-admin-b-uid', { role: 'store_admin', active: true, storeId: 'store-B', email: 'b@test.test', name: 'Admin B' })
  await seedDocument(testEnv, 'users', 'system-mgr-uid', { role: 'system_manager', active: true, email: 'mgr@test.test', name: 'Manager' })

  // ── Tranches de dette interne : PORTENT creditorStoreId ────────────────────
  await seedDocument(testEnv, 'internalDebts', 'debt-ab', {
    debtorStoreId: 'store-A', creditorStoreId: 'store-B',
    originalAmount: 20000, settledAmount: 0, remainingAmount: 20000, status: 'open',
  })
  await seedDocument(testEnv, 'internalDebts/debt-ab/settlements', 'dst_debt-ab_uid_k1', {
    debtId: 'debt-ab', debtorStoreId: 'store-A', creditorStoreId: 'store-B',
    amount: 5000, method: 'Orange Money', settlementStatus: 'declared',
  })
  await seedDocument(testEnv, 'internalDebts/debt-ab/settlements', 'dst_debt-ab_uid_k2', {
    debtId: 'debt-ab', debtorStoreId: 'store-A', creditorStoreId: 'store-B',
    amount: 3000, method: 'Cash', settlementStatus: 'confirmed',
  })

  // ── Règlements du moteur de transactions client : PAS de creditorStoreId ───
  // Ce sont eux qui ne doivent JAMAIS remonter par la requête de groupe.
  await seedDocument(testEnv, 'clients/store-A/drafts/draft-1/settlements', 'set-1', {
    draftId: 'draft-1', storeId: 'store-A', montant: 1000, paymentMethod: 'Cash',
  })
  await seedDocument(testEnv, 'clients/store-B/history/hist-1/settlements', 'set-2', {
    historyId: 'hist-1', storeId: 'store-B', montant: 2000, paymentMethod: 'Orange Money',
  })
}

// La requête EXACTE du badge de navigation.
const badgeQuery = (ctx, storeId) => query(
  collectionGroup(ctx.firestore(), 'settlements'),
  where('creditorStoreId', '==', storeId),
  where('settlementStatus', '==', 'declared'),
)

describe('Requête de groupe filtrée sur creditorStoreId — le badge « règlements à confirmer »', () => {
  it('la boutique CRÉANCIÈRE compte ses tranches à confirmer', async () => {
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-b-uid')
    const snap = await assertSucceeds(getDocs(badgeQuery(ctx, 'store-B')))
    expect(snap.size).toBe(1)
  })

  it('une boutique ne peut pas compter les tranches d’une autre', async () => {
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertFails(getDocs(badgeQuery(ctx, 'store-B')))
  })

  it('un anonyme ne compte rien', async () => {
    await assertFails(getDocs(badgeQuery(getUnauthenticatedContext(testEnv), 'store-B')))
  })
})

describe('Non-fuite : les règlements du moteur de transactions restent hors d’atteinte', () => {
  it('une requête de groupe SANS le filtre creditorStoreId est refusée', async () => {
    // C'est cette requête-là qui moissonnerait les deux mondes.
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertFails(getDocs(collectionGroup(ctx.firestore(), 'settlements')))
  })

  it('un filtre sur storeId (le champ du moteur de transactions) ne passe pas par ce chemin', async () => {
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    const q = query(collectionGroup(ctx.firestore(), 'settlements'), where('storeId', '==', 'store-A'))
    await assertFails(getDocs(q))
  })

  it('la requête autorisée ne retourne QUE des tranches de dette', async () => {
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-b-uid')
    const q = query(collectionGroup(ctx.firestore(), 'settlements'), where('creditorStoreId', '==', 'store-B'))
    const snap = await assertSucceeds(getDocs(q))
    expect(snap.size).toBe(2)
    for (const d of snap.docs) {
      expect(d.ref.path.startsWith('internalDebts/')).toBe(true)
      expect(d.data().creditorStoreId).toBe('store-B')
    }
  })
})

describe('Moindre privilège : le gérant n’a pas d’accès par ce joker', () => {
  it('le gérant passe par les blocs dédiés, pas par la requête de groupe', async () => {
    // Le badge est un besoin de la boutique créancière uniquement. Le gérant garde
    // ses accès par /internalDebts/{debtId} et sa sous-collection.
    const ctx = getAuthenticatedContext(testEnv, 'system-mgr-uid')
    await assertFails(getDocs(collectionGroup(ctx.firestore(), 'settlements')))
  })
})
