/**
 * TC-069 — Cohérence inventaire dealer à l'approvisionnement (confirmDealerRequest).
 *
 * Comportement protégé (Lot 3) :
 *   - Garde d'amorçage : SANS document dealerBalances, la confirmation n'affecte
 *     PAS le dealer (rétro-compatible avec le flux prod existant).
 *   - AVEC inventaire amorcé : la confirmation décrémente le dealer (même champ)
 *     et écrit un audit dealer.
 *   - Inventaire dealer insuffisant → INSUFFICIENT_DEALER_BALANCE, aucune écriture.
 *   - open_day n'affecte jamais l'inventaire dealer.
 *
 * Exécution : npm run test:functions (émulateur, demo-akayis-test).
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { confirmDealerRequestHandler } from '../../functions/src/dealerRequests/confirmDealerRequest.js'

let adminApp
let db
const PROJECT_ID = process.env.GCLOUD_PROJECT
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST

beforeAll(() => {
  if (!FIRESTORE_HOST) throw new Error('SÉCURITÉ : FIRESTORE_EMULATOR_HOST non défini. Lancer via : npm run test:functions')
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

const STORE_ADMIN_UID = 'store-admin-uid'
const DEALER_UID = 'dealer-uid'
const STORE_A = 'store-A'
const STORE_ADMIN_PROFILE = { role: 'store_admin', active: true, storeId: STORE_A, email: 'a@t.test', name: 'Admin' }

const BASE_REQ = {
  dealerUid: DEALER_UID, dealerEmail: 'd@t.test', dealerName: 'Dealer',
  targetStoreId: STORE_A, targetStoreName: 'Boutique A',
  requestType: 'stock_add', network: 'Orange', amount: 10000, liquidityAmount: null,
  status: 'pending',
  confirmedBy: null, confirmedAt: null, rejectedBy: null, rejectedAt: null, rejectionReason: null,
  previousBalance: null, newBalance: null,
  createdAt: new Date('2024-01-01T10:00:00Z'), updatedAt: new Date('2024-01-01T10:00:00Z'),
}
const STORE_BALANCE = { balances: { Orange: { stock: 50000, liquidite: 30000 }, Moov: { stock: 1000, liquidite: 500 } } }

const seedUser = () => db.doc(`users/${STORE_ADMIN_UID}`).set(STORE_ADMIN_PROFILE)
const seedReq = (id, o = {}) => db.doc(`dealerRequests/${id}`).set({ ...BASE_REQ, ...o })
const seedStoreBal = () => db.doc(`clients/${STORE_A}/networkBalances/current`).set(STORE_BALANCE)
const seedDealerBal = (orange) => db.doc(`dealerBalances/${DEALER_UID}`).set({ balances: { Orange: orange } })
const req = (data) => ({ auth: { uid: STORE_ADMIN_UID, token: {} }, data })

describe('TC-069 — cohérence inventaire dealer', () => {
  it('[CO-A] sans inventaire dealer → confirmation OK, dealer NON affecté (garde amorçage)', async () => {
    await seedUser(); await seedReq('r1'); await seedStoreBal()
    const res = await confirmDealerRequestHandler(req({ requestId: 'r1' }), { db, FieldValue })
    expect(res.success).toBe(true)
    // boutique incrémentée
    const bal = (await db.doc(`clients/${STORE_A}/networkBalances/current`).get()).data()
    expect(bal.balances.Orange.stock).toBe(60000)
    // aucun document dealerBalances créé
    expect((await db.doc(`dealerBalances/${DEALER_UID}`).get()).exists).toBe(false)
  })

  it('[CO-B] inventaire amorcé suffisant → dealer décrémenté + audit dealer', async () => {
    await seedUser(); await seedReq('r1'); await seedStoreBal()
    await seedDealerBal({ stock: 40000, liquidite: 20000 })
    await confirmDealerRequestHandler(req({ requestId: 'r1' }), { db, FieldValue })
    const dbal = (await db.doc(`dealerBalances/${DEALER_UID}`).get()).data()
    expect(dbal.balances.Orange.stock).toBe(30000)     // 40000 - 10000
    expect(dbal.balances.Orange.liquidite).toBe(20000) // préservé
    const audit = await db.collection(`dealerBalances/${DEALER_UID}/auditLogs`).get()
    expect(audit.size).toBe(1)
    expect(audit.docs[0].data().action).toBe('DEALER_SUPPLY_DEBIT')
    expect(audit.docs[0].data().newBalance).toBe(30000)
  })

  it('[CO-C] inventaire insuffisant → INSUFFICIENT_DEALER_BALANCE, aucune écriture', async () => {
    await seedUser(); await seedReq('r1'); await seedStoreBal()
    await seedDealerBal({ stock: 5000, liquidite: 20000 })
    await expect(
      confirmDealerRequestHandler(req({ requestId: 'r1' }), { db, FieldValue })
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_DEALER_BALANCE' })
    // boutique inchangée, demande toujours pending, dealer inchangé
    const bal = (await db.doc(`clients/${STORE_A}/networkBalances/current`).get()).data()
    expect(bal.balances.Orange.stock).toBe(50000)
    expect((await db.doc('dealerRequests/r1').get()).data().status).toBe('pending')
    const dbal = (await db.doc(`dealerBalances/${DEALER_UID}`).get()).data()
    expect(dbal.balances.Orange.stock).toBe(5000)
  })

  it('[CO-D] liquidity_add → liquidité dealer décrémentée, stock préservé', async () => {
    await seedUser(); await seedReq('r-liq', { requestType: 'liquidity_add', amount: 8000 }); await seedStoreBal()
    await seedDealerBal({ stock: 40000, liquidite: 20000 })
    await confirmDealerRequestHandler(req({ requestId: 'r-liq' }), { db, FieldValue })
    const dbal = (await db.doc(`dealerBalances/${DEALER_UID}`).get()).data()
    expect(dbal.balances.Orange.liquidite).toBe(12000) // 20000 - 8000
    expect(dbal.balances.Orange.stock).toBe(40000)     // préservé
  })

  it('[CO-E] open_day n’affecte pas l’inventaire dealer', async () => {
    await seedUser()
    await seedReq('r-open', { requestType: 'open_day', amount: 15000, liquidityAmount: 7000 })
    await seedStoreBal()
    await seedDealerBal({ stock: 40000, liquidite: 20000 })
    await confirmDealerRequestHandler(req({ requestId: 'r-open' }), { db, FieldValue })
    const dbal = (await db.doc(`dealerBalances/${DEALER_UID}`).get()).data()
    expect(dbal.balances.Orange.stock).toBe(40000)     // inchangé
    expect(dbal.balances.Orange.liquidite).toBe(20000) // inchangé
    // boutique bien positionnée par open_day
    const bal = (await db.doc(`clients/${STORE_A}/networkBalances/current`).get()).data()
    expect(bal.balances.Orange.stock).toBe(15000)
    expect(bal.balances.Orange.liquidite).toBe(7000)
  })
})
