/**
 * Règles Firestore — clients/{storeId}/networkBalances/current (soldes réseau).
 *
 * Donnée financière : schéma STRICT. L'UI écrit encore directement ce document
 * (BalanceService.setNetworkBalance) → on ne casse pas ce flux, mais on refuse
 * toute structure hors-schéma : réseau inconnu, champ parasite, valeur non
 * numérique/négative, clé de premier niveau étrangère.
 *
 * Caractérisation (avant/après) :
 *   - Le flux métier légitime (write bien formé par la même boutique) reste VERT.
 *   - Une boutique compromise NE PEUT PAS écrire une structure arbitraire.
 *   - Cloisonnement : une autre boutique ne peut ni lire ni écrire.
 *
 * Projet exclusif : demo-akayis-test. Aucun accès production.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertSucceeds,
  assertFails,
  getAuthenticatedContext,
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
  await seedDocument(testEnv, 'stores', 'store-A', { name: 'Boutique A', active: true, adminUid: 'admin-a-uid' })
  await seedDocument(testEnv, 'stores', 'store-B', { name: 'Boutique B', active: true, adminUid: 'admin-b-uid' })
  await seedDocument(testEnv, 'users', 'admin-a-uid', { role: 'store_admin', active: true, storeId: 'store-A', storeName: 'Boutique A', email: 'aa@test.test', name: 'Admin A' })
  await seedDocument(testEnv, 'users', 'admin-b-uid', { role: 'store_admin', active: true, storeId: 'store-B', storeName: 'Boutique B', email: 'ab@test.test', name: 'Admin B' })
  await seedDocument(testEnv, 'users', 'dealer-uid', { role: 'dealer', active: true, email: 'd@test.test', name: 'Dealer' })
  await seedDocument(testEnv, 'users', 'mgr-uid', { role: 'system_manager', active: true, email: 'm@test.test', name: 'Mgr' })
  // Solde existant pour tester les updates
  await seedDocument(testEnv, 'clients/store-A/networkBalances', 'current', {
    balances: { Orange: { stock: 50000, liquidite: 30000 } },
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  })
}

const fs = (uid) => getAuthenticatedContext(testEnv, uid).firestore()
const balDoc = (uid, storeId) => doc(fs(uid), 'clients', storeId, 'networkBalances', 'current')

// ── Flux métier légitime (caractérisation : reste VERT) ──────────────────────
describe('networkBalances — flux métier légitime', () => {
  it('même boutique écrit un solde bien formé (create) → allow', async () => {
    await seedDocument(testEnv, 'stores', 'store-A', { name: 'Boutique A', active: true, adminUid: 'admin-a-uid' })
    await seedDocument(testEnv, 'users', 'admin-a-uid', { role: 'store_admin', active: true, storeId: 'store-A', storeName: 'Boutique A', email: 'aa@test.test', name: 'Admin A' })
    await assertSucceeds(setDoc(balDoc('admin-a-uid', 'store-A'), {
      balances: { Orange: { stock: 45000, liquidite: 30000 } },
      updatedAt: serverTimestamp(),
    }))
  })

  it('même boutique met à jour un solde bien formé (merge) → allow', async () => {
    await seedAll()
    await assertSucceeds(setDoc(balDoc('admin-a-uid', 'store-A'), {
      balances: { Orange: { stock: 40000, liquidite: 30000 } },
      updatedAt: serverTimestamp(),
    }, { merge: true }))
  })

  it('plusieurs réseaux autorisés bien formés → allow', async () => {
    await seedAll()
    await assertSucceeds(setDoc(balDoc('admin-a-uid', 'store-A'), {
      balances: {
        Orange: { stock: 1, liquidite: 2 },
        Moov: { stock: 3, liquidite: 4 },
        Sank: { stock: 0, liquidite: 0 },
      },
      updatedAt: serverTimestamp(),
    }))
  })

  it('stock à la limite entier sûr (2^53 - 1) → allow', async () => {
    await seedAll()
    await assertSucceeds(setDoc(balDoc('admin-a-uid', 'store-A'), {
      balances: { Orange: { stock: 9007199254740991, liquidite: 0 } },
      updatedAt: serverTimestamp(),
    }))
  })

  it('liquidite à la limite entier sûr (2^53 - 1) → allow', async () => {
    await seedAll()
    await assertSucceeds(setDoc(balDoc('admin-a-uid', 'store-A'), {
      balances: { Orange: { stock: 0, liquidite: 9007199254740991 } },
      updatedAt: serverTimestamp(),
    }))
  })
})

// ── Boutique compromise : structures arbitraires refusées ────────────────────
describe('networkBalances — écritures hors-schéma refusées', () => {
  it('réseau inconnu + champ parasite → deny', async () => {
    await seedAll()
    await assertFails(setDoc(balDoc('admin-a-uid', 'store-A'), {
      balances: { FakeNetwork: { stock: 999999999, x: 'bad' } },
      updatedAt: serverTimestamp(),
    }))
  })

  it('champ parasite sur un réseau connu → deny', async () => {
    await seedAll()
    await assertFails(setDoc(balDoc('admin-a-uid', 'store-A'), {
      balances: { Orange: { stock: 100, liquidite: 0, hacked: 1 } },
      updatedAt: serverTimestamp(),
    }))
  })

  it('valeur non numérique → deny', async () => {
    await seedAll()
    await assertFails(setDoc(balDoc('admin-a-uid', 'store-A'), {
      balances: { Orange: { stock: 'beaucoup', liquidite: 0 } },
      updatedAt: serverTimestamp(),
    }))
  })

  it('valeur négative → deny', async () => {
    await seedAll()
    await assertFails(setDoc(balDoc('admin-a-uid', 'store-A'), {
      balances: { Orange: { stock: -5, liquidite: 0 } },
      updatedAt: serverTimestamp(),
    }))
  })

  it('stock décimal (100.5) → deny', async () => {
    await seedAll()
    await assertFails(setDoc(balDoc('admin-a-uid', 'store-A'), {
      balances: { Orange: { stock: 100.5, liquidite: 0 } },
      updatedAt: serverTimestamp(),
    }))
  })

  it('liquidite décimale (100.5) → deny', async () => {
    await seedAll()
    await assertFails(setDoc(balDoc('admin-a-uid', 'store-A'), {
      balances: { Orange: { stock: 0, liquidite: 100.5 } },
      updatedAt: serverTimestamp(),
    }))
  })

  it('stock hors entier sûr (2^53) → deny', async () => {
    await seedAll()
    await assertFails(setDoc(balDoc('admin-a-uid', 'store-A'), {
      balances: { Orange: { stock: 9007199254740992, liquidite: 0 } },
      updatedAt: serverTimestamp(),
    }))
  })

  it('liquidite hors entier sûr (2^53) → deny', async () => {
    await seedAll()
    await assertFails(setDoc(balDoc('admin-a-uid', 'store-A'), {
      balances: { Orange: { stock: 0, liquidite: 9007199254740992 } },
      updatedAt: serverTimestamp(),
    }))
  })

  it('clé de premier niveau étrangère → deny', async () => {
    await seedAll()
    await assertFails(setDoc(balDoc('admin-a-uid', 'store-A'), {
      balances: { Orange: { stock: 1, liquidite: 0 } },
      updatedAt: serverTimestamp(),
      hacked: true,
    }))
  })

  it('balances absent / non-map → deny', async () => {
    await seedAll()
    await assertFails(setDoc(balDoc('admin-a-uid', 'store-A'), {
      balances: 'nope',
      updatedAt: serverTimestamp(),
    }))
  })

  it('suppression du document → deny', async () => {
    await seedAll()
    await assertFails(deleteDoc(balDoc('admin-a-uid', 'store-A')))
  })
})

// ── Cloisonnement inter-boutiques ────────────────────────────────────────────
describe('networkBalances — cloisonnement', () => {
  it('autre boutique écrit le solde d’une boutique A → deny', async () => {
    await seedAll()
    await assertFails(setDoc(balDoc('admin-b-uid', 'store-A'), {
      balances: { Orange: { stock: 1, liquidite: 0 } },
      updatedAt: serverTimestamp(),
    }))
  })

  it('dealer écrit un solde boutique → deny', async () => {
    await seedAll()
    await assertFails(setDoc(balDoc('dealer-uid', 'store-A'), {
      balances: { Orange: { stock: 1, liquidite: 0 } },
      updatedAt: serverTimestamp(),
    }))
  })

  it('membre de la boutique lit son solde → allow', async () => {
    await seedAll()
    await assertSucceeds(getDoc(balDoc('admin-a-uid', 'store-A')))
  })

  it('dealer lit un solde boutique → allow (rôle global)', async () => {
    await seedAll()
    await assertSucceeds(getDoc(balDoc('dealer-uid', 'store-A')))
  })

  it('system_manager lit un solde boutique → allow', async () => {
    await seedAll()
    await assertSucceeds(getDoc(balDoc('mgr-uid', 'store-A')))
  })

  it('autre boutique lit le solde d’une boutique A → deny', async () => {
    await seedAll()
    await assertFails(getDoc(balDoc('admin-b-uid', 'store-A')))
  })
})
