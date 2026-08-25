/**
 * TC-067 — Transferts boutique → dealer (retours de stock/liquidité).
 *   Handler integration avec Firestore Emulator, { db, FieldValue } injectés.
 *
 * Comportement protégé (sens unique) :
 *   create  : débite le solde boutique au clic, crée le transfert pending, audite.
 *   confirm : crédite l'inventaire dealer (crée le doc si absent), audite.
 *   reject  : restaure EXACTEMENT le solde boutique, audite (boutique + dealer).
 *
 * Exécution : npm run test:functions (émulateur Firestore, projet demo-akayis-test).
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { createStoreDealerTransferHandler } from '../../functions/src/storeTransfers/createStoreDealerTransfer.js'
import { confirmStoreDealerTransferHandler } from '../../functions/src/storeTransfers/confirmStoreDealerTransfer.js'
import { rejectStoreDealerTransferHandler } from '../../functions/src/storeTransfers/rejectStoreDealerTransfer.js'
import { replenishDealerInventoryHandler } from '../../functions/src/storeTransfers/replenishDealerInventory.js'

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

afterAll(async () => {
  if (adminApp) await deleteApp(adminApp)
})

async function clearFirestoreEmulator() {
  const url = `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`
  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Impossible de vider l'émulateur : HTTP ${res.status}`)
}

beforeEach(async () => { await clearFirestoreEmulator() })

// ── Fixtures ─────────────────────────────────────────────────────────────────
const STORE_ADMIN_UID = 'store-admin-uid'
const DEALER_UID      = 'dealer-uid'
const OTHER_DEALER_UID = 'other-dealer-uid'
const STORE_A         = 'store-A'

const STORE_ADMIN_PROFILE = { role: 'store_admin', active: true, storeId: STORE_A, email: 'admin@t.test', name: 'Admin A' }
const DEALER_PROFILE      = { role: 'dealer', active: true, email: 'dealer@t.test', name: 'Dealer Test' }

const BASE_BALANCE = {
  balances: {
    Orange:  { stock: 50000, liquidite: 30000 },
    Moov:    { stock: 10000, liquidite:  5000 },
  },
  updatedAt: new Date('2024-01-01T00:00:00Z'),
}

function basePendingTransfer(overrides = {}) {
  return {
    storeId: STORE_A,
    storeName: 'Boutique A',
    storeAdminUid: STORE_ADMIN_UID,
    dealerUid: DEALER_UID,
    dealerName: 'Dealer Test',
    transferType: 'return_stock',
    network: 'Orange',
    amount: 5000,
    status: 'pending',
    previousStoreBalance: 50000,
    newStoreBalance: 45000,
    previousDealerBalance: null,
    newDealerBalance: null,
    createdAt: new Date('2024-01-02T10:00:00Z'),
    updatedAt: new Date('2024-01-02T10:00:00Z'),
    confirmedBy: null, confirmedAt: null,
    rejectedBy: null, rejectedAt: null, rejectionReason: null,
    ...overrides,
  }
}

const seedUser = (uid, data) => db.doc(`users/${uid}`).set(data)
const seedBalance = (storeId, data) => db.doc(`clients/${storeId}/networkBalances/current`).set(data)
const seedTransfer = (id, data) => db.doc(`storeDealerTransfers/${id}`).set(data)
const makeRequest = (uid, data) => ({ auth: uid ? { uid, token: {} } : null, data: data ?? {} })

async function expectError(promise, code) {
  await expect(promise).rejects.toMatchObject({ code })
}

// ── §CR — createStoreDealerTransferHandler ───────────────────────────────────
describe('TC-067-CR — create', () => {
  it('[CR-01] succès return_stock : débit boutique + transfert pending + audit', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await seedBalance(STORE_A, BASE_BALANCE)

    const res = await createStoreDealerTransferHandler(
      makeRequest(STORE_ADMIN_UID, { transferType: 'return_stock', amount: 5000 }),
      { db, FieldValue },
    )
    expect(res.success).toBe(true)
    expect(res.previousStoreBalance).toBe(50000)
    expect(res.newStoreBalance).toBe(45000)

    const bal = (await db.doc(`clients/${STORE_A}/networkBalances/current`).get()).data()
    expect(bal.balances.Orange.stock).toBe(45000)
    expect(bal.balances.Orange.liquidite).toBe(30000) // préservé
    expect(bal.balances.Moov.stock).toBe(10000)       // préservé

    const tr = (await db.doc(`storeDealerTransfers/${res.transferId}`).get()).data()
    expect(tr.status).toBe('pending')
    expect(tr.transferType).toBe('return_stock')
    expect(tr.amount).toBe(5000)
    expect(tr.dealerUid).toBe(DEALER_UID)
    expect(tr.storeId).toBe(STORE_A)

    const audit = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(audit.size).toBe(1)
    expect(audit.docs[0].data().action).toBe('STORE_DEALER_TRANSFER_CREATED')
  })

  it('[CR-02] succès return_liquidity : liquidite débitée, stock préservé', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await seedBalance(STORE_A, BASE_BALANCE)

    const res = await createStoreDealerTransferHandler(
      makeRequest(STORE_ADMIN_UID, { transferType: 'return_liquidity', amount: 5000 }),
      { db, FieldValue },
    )
    expect(res.newStoreBalance).toBe(25000)
    const bal = (await db.doc(`clients/${STORE_A}/networkBalances/current`).get()).data()
    expect(bal.balances.Orange.liquidite).toBe(25000)
    expect(bal.balances.Orange.stock).toBe(50000)
  })

  it('[CR-03] solde insuffisant → INSUFFICIENT_STORE_BALANCE, aucune écriture', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await seedBalance(STORE_A, BASE_BALANCE)

    await expectError(
      createStoreDealerTransferHandler(
        makeRequest(STORE_ADMIN_UID, { transferType: 'return_stock', amount: 999999 }),
        { db, FieldValue },
      ),
      'INSUFFICIENT_STORE_BALANCE',
    )
    const bal = (await db.doc(`clients/${STORE_A}/networkBalances/current`).get()).data()
    expect(bal.balances.Orange.stock).toBe(50000) // inchangé
    const transfers = await db.collection('storeDealerTransfers').get()
    expect(transfers.size).toBe(0)
  })

  it('[CR-04] appelant non store_admin → ROLE_FORBIDDEN', async () => {
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await seedBalance(STORE_A, BASE_BALANCE)
    await expectError(
      createStoreDealerTransferHandler(
        makeRequest(DEALER_UID, { transferType: 'return_stock', amount: 5000 }),
        { db, FieldValue },
      ),
      'ROLE_FORBIDDEN',
    )
  })

  it('[CR-05] aucun dealer actif → DEALER_NOT_FOUND', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedBalance(STORE_A, BASE_BALANCE)
    await expectError(
      createStoreDealerTransferHandler(
        makeRequest(STORE_ADMIN_UID, { transferType: 'return_stock', amount: 5000 }),
        { db, FieldValue },
      ),
      'DEALER_NOT_FOUND',
    )
  })

  it('[CR-06] type invalide → INVALID_TRANSFER_TYPE', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await expectError(
      createStoreDealerTransferHandler(
        makeRequest(STORE_ADMIN_UID, { transferType: 'return_cash', amount: 5000 }),
        { db, FieldValue },
      ),
      'INVALID_TRANSFER_TYPE',
    )
  })

  it('[CR-07] montant invalide → INVALID_TRANSFER_AMOUNT', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await expectError(
      createStoreDealerTransferHandler(
        makeRequest(STORE_ADMIN_UID, { transferType: 'return_stock', amount: -5 }),
        { db, FieldValue },
      ),
      'INVALID_TRANSFER_AMOUNT',
    )
  })

  it('[CR-08] deux dealers actifs → MULTIPLE_DEALERS_ACTIVE, aucun débit, aucun transfert', async () => {
    // Invariant métier violé : plus d'un dealer actif dans le système.
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await seedUser(OTHER_DEALER_UID, DEALER_PROFILE)
    await seedBalance(STORE_A, BASE_BALANCE)

    await expectError(
      createStoreDealerTransferHandler(
        makeRequest(STORE_ADMIN_UID, { transferType: 'return_stock', amount: 5000 }),
        { db, FieldValue },
      ),
      'MULTIPLE_DEALERS_ACTIVE',
    )

    // Aucune écriture : solde boutique intact, aucun transfert créé.
    const bal = (await db.doc(`clients/${STORE_A}/networkBalances/current`).get()).data()
    expect(bal.balances.Orange.stock).toBe(50000)
    const transfers = await db.collection('storeDealerTransfers').get()
    expect(transfers.size).toBe(0)
  })
})

// ── §CO — confirmStoreDealerTransferHandler ──────────────────────────────────
describe('TC-067-CO — confirm', () => {
  it('[CO-01] succès : inventaire dealer créé + crédité, transfert confirmé, audit', async () => {
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await seedTransfer('t-1', basePendingTransfer())

    const res = await confirmStoreDealerTransferHandler(
      makeRequest(DEALER_UID, { transferId: 't-1' }),
      { db, FieldValue },
    )
    expect(res.success).toBe(true)
    expect(res.previousDealerBalance).toBe(0)
    expect(res.newDealerBalance).toBe(5000)

    const dbal = (await db.doc(`dealerBalances/${DEALER_UID}`).get()).data()
    expect(dbal.balances.Orange.stock).toBe(5000)

    const tr = (await db.doc('storeDealerTransfers/t-1').get()).data()
    expect(tr.status).toBe('confirmed')
    expect(tr.confirmedBy).toBe(DEALER_UID)
    expect(tr.newDealerBalance).toBe(5000)

    const audit = await db.collection(`dealerBalances/${DEALER_UID}/auditLogs`).get()
    expect(audit.size).toBe(1)
    expect(audit.docs[0].data().action).toBe('STORE_DEALER_TRANSFER_CONFIRMED')
  })

  it('[CO-02] envoi de liquidité : liquidité dealer NON créditée, transfert confirmé, audit sans impact', async () => {
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await db.doc(`dealerBalances/${DEALER_UID}`).set({ balances: { Orange: { stock: 2000, liquidite: 1000 } } })
    await seedTransfer('t-liq', basePendingTransfer({ transferType: 'return_liquidity', amount: 3000 }))

    const res = await confirmStoreDealerTransferHandler(
      makeRequest(DEALER_UID, { transferId: 't-liq' }),
      { db, FieldValue },
    )
    expect(res.success).toBe(true)
    expect(res.newDealerBalance).toBeNull()
    expect(res.previousDealerBalance).toBeNull()

    const dbal = (await db.doc(`dealerBalances/${DEALER_UID}`).get()).data()
    expect(dbal.balances.Orange.liquidite).toBe(1000) // INCHANGÉ : aucun crédit
    expect(dbal.balances.Orange.stock).toBe(2000)     // préservé

    const tr = (await db.doc('storeDealerTransfers/t-liq').get()).data()
    expect(tr.status).toBe('confirmed')
    expect(tr.newDealerBalance).toBeNull()

    const audit = await db.collection(`dealerBalances/${DEALER_UID}/auditLogs`).get()
    expect(audit.size).toBe(1)
    expect(audit.docs[0].data().action).toBe('STORE_DEALER_TRANSFER_CONFIRMED')
    expect(audit.docs[0].data().newBalance).toBeNull()
  })

  it('[CO-07] envoi de liquidité sans inventaire préexistant : aucun crédit ni doc dealerBalances, confirmé', async () => {
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await seedTransfer('t-liq2', basePendingTransfer({ transferType: 'return_liquidity', amount: 5000 }))

    const res = await confirmStoreDealerTransferHandler(
      makeRequest(DEALER_UID, { transferId: 't-liq2' }),
      { db, FieldValue },
    )
    expect(res.success).toBe(true)
    expect(res.newDealerBalance).toBeNull()

    // Écrire l'audit (sous-collection) ne crée pas le document dealerBalances parent.
    const balDoc = await db.doc(`dealerBalances/${DEALER_UID}`).get()
    expect(balDoc.exists).toBe(false)

    const tr = (await db.doc('storeDealerTransfers/t-liq2').get()).data()
    expect(tr.status).toBe('confirmed')
  })

  it('[CO-03] appelant non dealer → ROLE_FORBIDDEN', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedTransfer('t-1', basePendingTransfer())
    await expectError(
      confirmStoreDealerTransferHandler(makeRequest(STORE_ADMIN_UID, { transferId: 't-1' }), { db, FieldValue }),
      'ROLE_FORBIDDEN',
    )
  })

  it('[CO-04] transfert introuvable → TRANSFER_NOT_FOUND', async () => {
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await expectError(
      confirmStoreDealerTransferHandler(makeRequest(DEALER_UID, { transferId: 'nope' }), { db, FieldValue }),
      'TRANSFER_NOT_FOUND',
    )
  })

  it('[CO-05] déjà traité → TRANSFER_NOT_PENDING', async () => {
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await seedTransfer('t-done', basePendingTransfer({ status: 'confirmed' }))
    await expectError(
      confirmStoreDealerTransferHandler(makeRequest(DEALER_UID, { transferId: 't-done' }), { db, FieldValue }),
      'TRANSFER_NOT_PENDING',
    )
  })

  it('[CO-06] dealer différent → TRANSFER_DEALER_MISMATCH', async () => {
    await seedUser(OTHER_DEALER_UID, DEALER_PROFILE)
    await seedTransfer('t-1', basePendingTransfer()) // dealerUid = DEALER_UID
    await expectError(
      confirmStoreDealerTransferHandler(makeRequest(OTHER_DEALER_UID, { transferId: 't-1' }), { db, FieldValue }),
      'TRANSFER_DEALER_MISMATCH',
    )
  })
})

// ── §RJ — rejectStoreDealerTransferHandler ───────────────────────────────────
describe('TC-067-RJ — reject', () => {
  it('[RJ-01] succès : solde boutique restauré exactement, transfert rejeté, audits', async () => {
    await seedUser(DEALER_UID, DEALER_PROFILE)
    // Boutique déjà débitée (post-création) : stock à 45000
    await seedBalance(STORE_A, { balances: { Orange: { stock: 45000, liquidite: 30000 } } })
    await seedTransfer('t-1', basePendingTransfer())

    const res = await rejectStoreDealerTransferHandler(
      makeRequest(DEALER_UID, { transferId: 't-1', rejectionReason: 'Montant erroné' }),
      { db, FieldValue },
    )
    expect(res.success).toBe(true)

    const bal = (await db.doc(`clients/${STORE_A}/networkBalances/current`).get()).data()
    expect(bal.balances.Orange.stock).toBe(50000)     // restauré (+5000)
    expect(bal.balances.Orange.liquidite).toBe(30000) // préservé

    const tr = (await db.doc('storeDealerTransfers/t-1').get()).data()
    expect(tr.status).toBe('rejected')
    expect(tr.rejectionReason).toBe('Montant erroné')

    const storeAudit = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(storeAudit.size).toBe(1)
    expect(storeAudit.docs[0].data().action).toBe('STORE_DEALER_TRANSFER_REJECTED')
    const dealerAudit = await db.collection(`dealerBalances/${DEALER_UID}/auditLogs`).get()
    expect(dealerAudit.size).toBe(1)
  })

  it('[RJ-02] motif trop court → INVALID_REJECTION_REASON', async () => {
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await seedTransfer('t-1', basePendingTransfer())
    await expectError(
      rejectStoreDealerTransferHandler(makeRequest(DEALER_UID, { transferId: 't-1', rejectionReason: 'ab' }), { db, FieldValue }),
      'INVALID_REJECTION_REASON',
    )
  })

  it('[RJ-03] déjà traité → TRANSFER_NOT_PENDING (solde inchangé)', async () => {
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await seedBalance(STORE_A, { balances: { Orange: { stock: 45000, liquidite: 30000 } } })
    await seedTransfer('t-rej', basePendingTransfer({ status: 'rejected' }))
    await expectError(
      rejectStoreDealerTransferHandler(makeRequest(DEALER_UID, { transferId: 't-rej', rejectionReason: 'Motif valide' }), { db, FieldValue }),
      'TRANSFER_NOT_PENDING',
    )
    const bal = (await db.doc(`clients/${STORE_A}/networkBalances/current`).get()).data()
    expect(bal.balances.Orange.stock).toBe(45000) // inchangé
  })

  it('[RJ-04] dealer différent → TRANSFER_DEALER_MISMATCH', async () => {
    await seedUser(OTHER_DEALER_UID, DEALER_PROFILE)
    await seedTransfer('t-1', basePendingTransfer())
    await expectError(
      rejectStoreDealerTransferHandler(makeRequest(OTHER_DEALER_UID, { transferId: 't-1', rejectionReason: 'Motif valide' }), { db, FieldValue }),
      'TRANSFER_DEALER_MISMATCH',
    )
  })
})

// ── §RP — replenishDealerInventoryHandler ────────────────────────────────────
describe('TC-067-RP — replenish', () => {
  it('[RP-01] amorçage : crée le solde et crédite le stock', async () => {
    await seedUser(DEALER_UID, DEALER_PROFILE)
    const res = await replenishDealerInventoryHandler(
      makeRequest(DEALER_UID, { resource: 'stock', amount: 20000 }),
      { db, FieldValue },
    )
    expect(res.success).toBe(true)
    expect(res.previousBalance).toBe(0)
    expect(res.newBalance).toBe(20000)
    const dbal = (await db.doc(`dealerBalances/${DEALER_UID}`).get()).data()
    expect(dbal.balances.Orange.stock).toBe(20000)
    const audit = await db.collection(`dealerBalances/${DEALER_UID}/auditLogs`).get()
    expect(audit.size).toBe(1)
    expect(audit.docs[0].data().action).toBe('DEALER_INVENTORY_REPLENISHED')
  })

  it('[RP-02] cumul liquidité + préservation du stock', async () => {
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await db.doc(`dealerBalances/${DEALER_UID}`).set({ balances: { Orange: { stock: 5000, liquidite: 1000 } } })
    const res = await replenishDealerInventoryHandler(
      makeRequest(DEALER_UID, { resource: 'liquidite', amount: 3000 }),
      { db, FieldValue },
    )
    expect(res.newBalance).toBe(4000)
    const dbal = (await db.doc(`dealerBalances/${DEALER_UID}`).get()).data()
    expect(dbal.balances.Orange.liquidite).toBe(4000)
    expect(dbal.balances.Orange.stock).toBe(5000)
  })

  it('[RP-03] appelant non dealer → ROLE_FORBIDDEN', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await expectError(
      replenishDealerInventoryHandler(makeRequest(STORE_ADMIN_UID, { resource: 'stock', amount: 1000 }), { db, FieldValue }),
      'ROLE_FORBIDDEN',
    )
  })

  it('[RP-04] ressource invalide → INVALID_INVENTORY_RESOURCE', async () => {
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await expectError(
      replenishDealerInventoryHandler(makeRequest(DEALER_UID, { resource: 'cash', amount: 1000 }), { db, FieldValue }),
      'INVALID_INVENTORY_RESOURCE',
    )
  })

  it('[RP-05] montant invalide → INVALID_TRANSFER_AMOUNT', async () => {
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await expectError(
      replenishDealerInventoryHandler(makeRequest(DEALER_UID, { resource: 'stock', amount: 0 }), { db, FieldValue }),
      'INVALID_TRANSFER_AMOUNT',
    )
  })
})

// ── §MN — multi-réseaux : réseau porté par l'opération (balances[network]) ───
// Profil dealer multi-réseaux injecté (dealerNetworks:['Orange','Moov']). Prouve
// qu'une opération sur Moov n'écrit QUE balances.Moov (Orange préservé) et que le
// document + l'audit portent network:'Moov' ; réseau hors profil ou requis manquant
// → INVALID_TRANSFER_NETWORK sans aucune écriture. BASE_BALANCE contient déjà Moov.
describe('TC-067-MN — multi-réseaux (réseau porté)', () => {
  const MULTI = ['Orange', 'Moov']

  it('[MN-01] create return_stock Moov : débite balances.Moov.stock, Orange préservé, doc + audit network=Moov', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await seedBalance(STORE_A, BASE_BALANCE)

    const res = await createStoreDealerTransferHandler(
      makeRequest(STORE_ADMIN_UID, { transferType: 'return_stock', amount: 4000, network: 'Moov' }),
      { db, FieldValue, dealerNetworks: MULTI },
    )
    expect(res.success).toBe(true)
    expect(res.previousStoreBalance).toBe(10000) // Moov.stock
    expect(res.newStoreBalance).toBe(6000)       // 10000 - 4000

    const bal = (await db.doc(`clients/${STORE_A}/networkBalances/current`).get()).data()
    expect(bal.balances.Moov.stock).toBe(6000)
    expect(bal.balances.Orange.stock).toBe(50000)     // préservé
    expect(bal.balances.Orange.liquidite).toBe(30000) // préservé

    const tr = (await db.doc(`storeDealerTransfers/${res.transferId}`).get()).data()
    expect(tr.network).toBe('Moov')
    const audit = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(audit.docs[0].data().network).toBe('Moov')
  })

  it('[MN-02] confirm lit transfer.network=Moov : crédite balances.Moov.stock, Orange dealer préservé', async () => {
    await seedUser(DEALER_UID, DEALER_PROFILE)
    // Le dealer possède déjà de l'Orange : le crédit Moov ne doit pas l'écraser (merge).
    await db.doc(`dealerBalances/${DEALER_UID}`).set({ balances: { Orange: { stock: 7000, liquidite: 1000 } } })
    await seedTransfer('t-moov', basePendingTransfer({ network: 'Moov', amount: 4000 }))

    const res = await confirmStoreDealerTransferHandler(
      makeRequest(DEALER_UID, { transferId: 't-moov' }),
      { db, FieldValue, dealerNetworks: MULTI },
    )
    expect(res.newDealerBalance).toBe(4000)

    const dbal = (await db.doc(`dealerBalances/${DEALER_UID}`).get()).data()
    expect(dbal.balances.Moov.stock).toBe(4000)
    expect(dbal.balances.Orange.stock).toBe(7000) // préservé
    const audit = await db.collection(`dealerBalances/${DEALER_UID}/auditLogs`).get()
    expect(audit.docs[0].data().network).toBe('Moov')
  })

  it('[MN-03] reject Moov : restaure exactement balances.Moov.stock, Orange préservé', async () => {
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await seedBalance(STORE_A, BASE_BALANCE) // boutique post-débit fictif : Moov.stock=10000
    await seedTransfer('t-moov-r', basePendingTransfer({ network: 'Moov', amount: 4000 }))

    const res = await rejectStoreDealerTransferHandler(
      makeRequest(DEALER_UID, { transferId: 't-moov-r', rejectionReason: 'Stock erroné' }),
      { db, FieldValue, dealerNetworks: MULTI },
    )
    expect(res.success).toBe(true)

    const bal = (await db.doc(`clients/${STORE_A}/networkBalances/current`).get()).data()
    expect(bal.balances.Moov.stock).toBe(14000)   // 10000 + 4000 restauré
    expect(bal.balances.Orange.stock).toBe(50000) // préservé
  })

  it('[MN-04] replenish Moov : crédite balances.Moov.stock (crée le doc), audit network=Moov', async () => {
    await seedUser(DEALER_UID, DEALER_PROFILE)
    const res = await replenishDealerInventoryHandler(
      makeRequest(DEALER_UID, { resource: 'stock', amount: 8000, network: 'Moov' }),
      { db, FieldValue, dealerNetworks: MULTI },
    )
    expect(res.newBalance).toBe(8000)
    const dbal = (await db.doc(`dealerBalances/${DEALER_UID}`).get()).data()
    expect(dbal.balances.Moov.stock).toBe(8000)
    const audit = await db.collection(`dealerBalances/${DEALER_UID}/auditLogs`).get()
    expect(audit.docs[0].data().network).toBe('Moov')
  })

  it('[MN-05] réseau hors profil (mono Orange) → INVALID_TRANSFER_NETWORK, aucune écriture', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await seedBalance(STORE_A, BASE_BALANCE)

    await expectError(
      createStoreDealerTransferHandler(
        makeRequest(STORE_ADMIN_UID, { transferType: 'return_stock', amount: 4000, network: 'Moov' }),
        { db, FieldValue, dealerNetworks: ['Orange'] },
      ),
      'INVALID_TRANSFER_NETWORK',
    )
    const bal = (await db.doc(`clients/${STORE_A}/networkBalances/current`).get()).data()
    expect(bal.balances.Orange.stock).toBe(50000) // inchangé
    expect(bal.balances.Moov.stock).toBe(10000)   // inchangé
    expect((await db.collection('storeDealerTransfers').get()).size).toBe(0)
  })

  it('[MN-06] profil multi-réseaux + network omis → INVALID_TRANSFER_NETWORK (réseau requis)', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await seedBalance(STORE_A, BASE_BALANCE)

    await expectError(
      createStoreDealerTransferHandler(
        makeRequest(STORE_ADMIN_UID, { transferType: 'return_stock', amount: 4000 }),
        { db, FieldValue, dealerNetworks: MULTI },
      ),
      'INVALID_TRANSFER_NETWORK',
    )
    expect((await db.collection('storeDealerTransfers').get()).size).toBe(0)
  })
})
