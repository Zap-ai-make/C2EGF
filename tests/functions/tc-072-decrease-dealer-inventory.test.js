/**
 * TC-072 — Diminution de l'inventaire dealer (decreaseDealerInventory).
 *   Handler integration avec Firestore Emulator, { db, FieldValue } injectés.
 *
 * Comportement protégé :
 *   - débit correct (stock ou liquidité), autre champ préservé, audit écrit ;
 *   - blocage sous zéro (INSUFFICIENT_DEALER_BALANCE), AUCUNE écriture ;
 *   - gardes de rôle / ressource / montant.
 *
 * Exécution : npm run test:functions (émulateur Firestore, projet demo-akayis-test).
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { decreaseDealerInventoryHandler } from '../../functions/src/storeTransfers/decreaseDealerInventory.js'

let adminApp
let db

const PROJECT_ID = process.env.GCLOUD_PROJECT
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST

beforeAll(() => {
  if (!FIRESTORE_HOST) throw new Error('SÉCURITÉ : FIRESTORE_EMULATOR_HOST non défini. Lancer via : npm run test:functions')
  if (!PROJECT_ID) throw new Error('SÉCURITÉ : GCLOUD_PROJECT non défini. Lancer via : npm run test:functions')
  if (PROJECT_ID !== 'demo-akayis-test') throw new Error(`SÉCURITÉ : projectId doit être "demo-akayis-test". Reçu : "${PROJECT_ID}"`)
  adminApp = getApps().length === 0 ? initializeApp({ projectId: PROJECT_ID }) : getApps()[0]
  db = getFirestore(adminApp)
})

afterAll(async () => { if (adminApp) await deleteApp(adminApp) })

async function clearFirestoreEmulator() {
  const url = `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`
  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Impossible de vider l'émulateur : HTTP ${res.status}`)
}
beforeEach(async () => { await clearFirestoreEmulator() })

const DEALER_UID = 'dealer-uid'
const STORE_ADMIN_UID = 'store-admin-uid'
const DEALER_PROFILE = { role: 'dealer', active: true, email: 'dealer@t.test', name: 'Dealer Test' }
const STORE_ADMIN_PROFILE = { role: 'store_admin', active: true, storeId: 'store-A', email: 'admin@t.test', name: 'Admin A' }

const seedUser = (uid, data) => db.doc(`users/${uid}`).set(data)
const seedDealerBalance = (uid, orange) => db.doc(`dealerBalances/${uid}`).set({ balances: { Orange: orange } })
const makeRequest = (uid, data) => ({ auth: uid ? { uid, token: {} } : null, data: data ?? {} })

async function expectError(promise, code) {
  await expect(promise).rejects.toMatchObject({ code })
}

describe('TC-072 — decreaseDealerInventory', () => {
  it('[DE-01] succès stock : débit correct, liquidité préservée, audit', async () => {
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await seedDealerBalance(DEALER_UID, { stock: 20000, liquidite: 5000 })

    const res = await decreaseDealerInventoryHandler(
      makeRequest(DEALER_UID, { resource: 'stock', amount: 5000 }), { db, FieldValue },
    )
    expect(res.success).toBe(true)
    expect(res.previousBalance).toBe(20000)
    expect(res.newBalance).toBe(15000)

    const bal = (await db.doc(`dealerBalances/${DEALER_UID}`).get()).data()
    expect(bal.balances.Orange.stock).toBe(15000)
    expect(bal.balances.Orange.liquidite).toBe(5000) // préservé

    const audit = await db.collection(`dealerBalances/${DEALER_UID}/auditLogs`).get()
    expect(audit.size).toBe(1)
    expect(audit.docs[0].data().action).toBe('DEALER_INVENTORY_DECREASED')
    expect(audit.docs[0].data().amount).toBe(5000)
  })

  it('[DE-02] succès liquidité : débit correct, stock préservé', async () => {
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await seedDealerBalance(DEALER_UID, { stock: 20000, liquidite: 8000 })
    const res = await decreaseDealerInventoryHandler(
      makeRequest(DEALER_UID, { resource: 'liquidite', amount: 3000 }), { db, FieldValue },
    )
    expect(res.newBalance).toBe(5000)
    const bal = (await db.doc(`dealerBalances/${DEALER_UID}`).get()).data()
    expect(bal.balances.Orange.liquidite).toBe(5000)
    expect(bal.balances.Orange.stock).toBe(20000)
  })

  it('[DE-03] solde insuffisant → INSUFFICIENT_DEALER_BALANCE, aucune écriture', async () => {
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await seedDealerBalance(DEALER_UID, { stock: 4000, liquidite: 0 })
    await expectError(
      decreaseDealerInventoryHandler(makeRequest(DEALER_UID, { resource: 'stock', amount: 5000 }), { db, FieldValue }),
      'INSUFFICIENT_DEALER_BALANCE',
    )
    const bal = (await db.doc(`dealerBalances/${DEALER_UID}`).get()).data()
    expect(bal.balances.Orange.stock).toBe(4000) // inchangé
    const audit = await db.collection(`dealerBalances/${DEALER_UID}/auditLogs`).get()
    expect(audit.size).toBe(0)
  })

  it('[DE-04] descendre exactement à zéro → autorisé', async () => {
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await seedDealerBalance(DEALER_UID, { stock: 5000, liquidite: 0 })
    const res = await decreaseDealerInventoryHandler(
      makeRequest(DEALER_UID, { resource: 'stock', amount: 5000 }), { db, FieldValue },
    )
    expect(res.newBalance).toBe(0)
    const bal = (await db.doc(`dealerBalances/${DEALER_UID}`).get()).data()
    expect(bal.balances.Orange.stock).toBe(0)
  })

  it('[DE-05] inventaire absent (solde 0) → INSUFFICIENT_DEALER_BALANCE', async () => {
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await expectError(
      decreaseDealerInventoryHandler(makeRequest(DEALER_UID, { resource: 'stock', amount: 1000 }), { db, FieldValue }),
      'INSUFFICIENT_DEALER_BALANCE',
    )
    const exists = (await db.doc(`dealerBalances/${DEALER_UID}`).get()).exists
    expect(exists).toBe(false)
  })

  it('[DE-06] appelant non-dealer → ROLE_FORBIDDEN', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await expectError(
      decreaseDealerInventoryHandler(makeRequest(STORE_ADMIN_UID, { resource: 'stock', amount: 1000 }), { db, FieldValue }),
      'ROLE_FORBIDDEN',
    )
  })

  it('[DE-07] ressource invalide → INVALID_INVENTORY_RESOURCE', async () => {
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await expectError(
      decreaseDealerInventoryHandler(makeRequest(DEALER_UID, { resource: 'cash', amount: 1000 }), { db, FieldValue }),
      'INVALID_INVENTORY_RESOURCE',
    )
  })

  it('[DE-08] montant invalide → INVALID_TRANSFER_AMOUNT', async () => {
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await expectError(
      decreaseDealerInventoryHandler(makeRequest(DEALER_UID, { resource: 'stock', amount: 0 }), { db, FieldValue }),
      'INVALID_TRANSFER_AMOUNT',
    )
  })
})

// ── §MN — multi-réseaux : réseau porté par l'opération (balances[network]) ───
// Profil dealer multi-réseaux injecté. Une diminution Moov ne touche QUE balances.Moov
// (Orange préservé) et l'audit porte network:'Moov'. Réseau hors profil →
// INVALID_TRANSFER_NETWORK sans aucune écriture.
describe('TC-072-MN — multi-réseaux (réseau porté)', () => {
  it('[DE-MN-01] décrément Moov : débite balances.Moov.stock, Orange préservé, audit network=Moov', async () => {
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await db.doc(`dealerBalances/${DEALER_UID}`).set({ balances: {
      Orange: { stock: 20000, liquidite: 5000 },
      Moov:   { stock: 12000, liquidite: 3000 },
    } })

    const res = await decreaseDealerInventoryHandler(
      makeRequest(DEALER_UID, { resource: 'stock', amount: 4000, network: 'Moov' }),
      { db, FieldValue, dealerNetworks: ['Orange', 'Moov'] },
    )
    expect(res.newBalance).toBe(8000) // 12000 - 4000 (Moov)

    const bal = (await db.doc(`dealerBalances/${DEALER_UID}`).get()).data()
    expect(bal.balances.Moov.stock).toBe(8000)
    expect(bal.balances.Orange.stock).toBe(20000)    // préservé
    expect(bal.balances.Orange.liquidite).toBe(5000) // préservé
    const audit = await db.collection(`dealerBalances/${DEALER_UID}/auditLogs`).get()
    expect(audit.docs[0].data().network).toBe('Moov')
  })

  it('[DE-MN-02] réseau hors profil (mono Orange) → INVALID_TRANSFER_NETWORK, aucune écriture', async () => {
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await seedDealerBalance(DEALER_UID, { stock: 20000, liquidite: 5000 })
    await expectError(
      decreaseDealerInventoryHandler(
        makeRequest(DEALER_UID, { resource: 'stock', amount: 4000, network: 'Moov' }),
        { db, FieldValue, dealerNetworks: ['Orange'] },
      ),
      'INVALID_TRANSFER_NETWORK',
    )
    const bal = (await db.doc(`dealerBalances/${DEALER_UID}`).get()).data()
    expect(bal.balances.Orange.stock).toBe(20000) // inchangé
    expect((await db.collection(`dealerBalances/${DEALER_UID}/auditLogs`).get()).size).toBe(0)
  })
})
