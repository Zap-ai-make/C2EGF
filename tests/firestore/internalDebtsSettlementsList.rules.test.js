/**
 * Règles Firestore — LIST des tranches d'une dette, SANS clause `where`.
 *
 * ⚠ C'est le piège du §13.2 du cahier des charges, et il mérite son propre fichier.
 *
 * La page Dettes internes affiche l'historique complet des tranches d'une dette :
 * elle interroge `internalDebts/{debtId}/settlements` avec un simple
 * `orderBy('declaredAt','desc')`, sans aucun filtre.
 *
 * Une règle écrite `allow read: if isStoreAdmin(resource.data.debtorStoreId)` ferait
 * échouer TOUTE la requête (« Property debtorStoreId is undefined ») : sur une LIST,
 * les règles décident de l'ACCÈS, elles ne filtrent pas les RÉSULTATS. Il faut donc
 * interroger le document PARENT — dont l'id `$(debtId)` est fixe pour une requête
 * donnée, ce qui rend la condition évaluable sans connaître les documents retournés.
 *
 * Ce test échouerait si quelqu'un « simplifiait » la règle en revenant à resource.data :
 * les `getDoc` unitaires passeraient encore, la page se viderait en silence.
 *
 * Projet exclusif : demo-akayis-test. Aucun accès Firebase production.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, collection, getDocs, query, orderBy } from 'firebase/firestore'
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
  await seedDocument(testEnv, 'users', 'store-admin-c-uid', { role: 'store_admin', active: true, storeId: 'store-C', email: 'c@test.test', name: 'Admin C' })
  await seedDocument(testEnv, 'users', 'system-mgr-uid', { role: 'system_manager', active: true, email: 'mgr@test.test', name: 'Manager' })

  // A doit à B.
  await seedDocument(testEnv, 'internalDebts', 'debt-ab', {
    debtorStoreId: 'store-A', creditorStoreId: 'store-B',
    network: 'Orange', operationType: 'deposit',
    originalAmount: 20000, settledAmount: 0, remainingAmount: 20000, status: 'open',
  })

  // Trois tranches, statuts variés — comme la vraie page les affiche.
  for (const [id, extra] of [
    ['dst_debt-ab_store-admin-a-uid_k1', { amount: 5000, settlementStatus: 'declared' }],
    ['dst_debt-ab_store-admin-a-uid_k2', { amount: 3000, settlementStatus: 'confirmed' }],
    ['dst_debt-ab_store-admin-a-uid_k3', { amount: 1000, settlementStatus: 'rejected' }],
  ]) {
    await seedDocument(testEnv, 'internalDebts/debt-ab/settlements', id, {
      debtId: 'debt-ab',
      debtorStoreId: 'store-A',
      creditorStoreId: 'store-B',
      method: 'Orange Money',
      declaredBy: 'store-admin-a-uid',
      declaredAt: new Date(),
      ...extra,
    })
  }
}

// La requête EXACTE de la page Dettes internes : aucune clause `where`.
const unconstrainedList = (ctx) => query(
  collection(ctx.firestore(), 'internalDebts', 'debt-ab', 'settlements'),
  orderBy('declaredAt', 'desc'),
)

describe('LIST non contrainte des tranches — le cas qui casse si la règle lit resource.data', () => {
  it('la boutique DÉBITRICE liste les tranches de sa dette', async () => {
    await assertSucceeds(getDocs(unconstrainedList(getAuthenticatedContext(testEnv, 'store-admin-a-uid'))))
  })

  it('la boutique CRÉANCIÈRE liste les tranches de la même dette', async () => {
    await assertSucceeds(getDocs(unconstrainedList(getAuthenticatedContext(testEnv, 'store-admin-b-uid'))))
  })

  it('le gérant liste (supervision)', async () => {
    await assertSucceeds(getDocs(unconstrainedList(getAuthenticatedContext(testEnv, 'system-mgr-uid'))))
  })

  it('une TIERCE boutique ne liste pas', async () => {
    await assertFails(getDocs(unconstrainedList(getAuthenticatedContext(testEnv, 'store-admin-c-uid'))))
  })

  it('un anonyme ne liste pas', async () => {
    await assertFails(getDocs(unconstrainedList(getUnauthenticatedContext(testEnv))))
  })
})

describe('Lecture unitaire d’une tranche — cohérente avec la LIST', () => {
  it('la débitrice lit une tranche précise', async () => {
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'internalDebts', 'debt-ab', 'settlements', 'dst_debt-ab_store-admin-a-uid_k1')))
  })

  it('une tierce boutique ne lit pas une tranche précise', async () => {
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-c-uid')
    await assertFails(getDoc(doc(ctx.firestore(), 'internalDebts', 'debt-ab', 'settlements', 'dst_debt-ab_store-admin-a-uid_k1')))
  })
})

describe('Dette inexistante — la règle refuse au lieu de planter ouvert', () => {
  it('lister les tranches d’une dette qui n’existe pas est refusé', async () => {
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    const q = query(
      collection(ctx.firestore(), 'internalDebts', 'debt-inexistante', 'settlements'),
      orderBy('declaredAt', 'desc'),
    )
    await assertFails(getDocs(q))
  })
})
