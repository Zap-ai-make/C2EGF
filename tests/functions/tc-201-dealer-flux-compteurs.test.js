/**
 * TC-201 — Les compteurs de flux du dealer (spec S2).
 *
 * CE QU'ILS SONT
 * ──────────────
 * Deux cumuls sur `dealerBalances/{uid}`, sous la clé `flux` :
 *
 *   flux.envoyeCumul   total envoyé aux boutiques depuis l'origine
 *   flux.revenuCumul   total revenu des boutiques depuis l'origine
 *
 * Leur différence est « l'argent du dealer qui est dehors ». Ce sont des
 * compteurs, pas des soldes : ils n'entrent dans aucun calcul de solde.
 *
 * LE PIÈGE QUE CE FICHIER PROTÈGE
 * ───────────────────────────────
 * `confirmDealerRequest` porte une garde d'amorçage : sans document
 * `dealerBalances`, la confirmation n'affecte pas l'inventaire du dealer
 * (tc-069 [CO-A]). Cette garde teste l'EXISTENCE DU DOCUMENT.
 *
 * Un compteur écrit en `set(merge)` sur un document absent le créerait — avec
 * un `flux` et sans `balances`. La confirmation suivante verrait un document
 * existant, entrerait dans la branche de débit, y lirait un solde à 0, et
 * lèverait INSUFFICIENT_DEALER_BALANCE. Un compteur d'affichage aurait bloqué
 * les approvisionnements du dealer.
 *
 * Les deux handlers écrivent donc leur compteur UNIQUEMENT sur un document qui
 * existe déjà (ou que la même transaction vient de créer avec ses soldes). Les
 * cas [FX-C], [FX-D] et [FX-G] tiennent cette règle, et ils sont la raison
 * d'être de ce fichier autant que les compteurs eux-mêmes.
 *
 * Exécution : npm run test:functions (émulateur, demo-akayis-test).
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { confirmDealerRequestHandler } from '../../functions/src/dealerRequests/confirmDealerRequest.js'
import { confirmStoreDealerTransferHandler } from '../../functions/src/storeTransfers/confirmStoreDealerTransfer.js'

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

// ── Acteurs ────────────────────────────────────────────────────────────────
// Deux boutiques : AGENTS.md impose de vérifier avec plus d'une.
const STORE_ADMIN_A = 'store-admin-a'
const STORE_ADMIN_B = 'store-admin-b'
const DEALER_UID = 'dealer-uid'
const STORE_A = 'store-A'
const STORE_B = 'store-B'

const adminProfile = (storeId) => ({
  role: 'store_admin', active: true, storeId, email: `${storeId}@t.test`, name: `Admin ${storeId}`,
})
const DEALER_PROFILE = { role: 'dealer', active: true, email: 'd@t.test', name: 'Dealer' }

const BASE_REQ = {
  dealerUid: DEALER_UID, dealerEmail: 'd@t.test', dealerName: 'Dealer',
  targetStoreId: STORE_A, targetStoreName: 'Boutique A',
  requestType: 'stock_add', network: 'Orange', amount: 10000, liquidityAmount: null,
  status: 'pending',
  confirmedBy: null, confirmedAt: null, rejectedBy: null, rejectedAt: null, rejectionReason: null,
  previousBalance: null, newBalance: null,
  createdAt: new Date('2026-08-01T10:00:00Z'), updatedAt: new Date('2026-08-01T10:00:00Z'),
}

const BASE_TRANSFER = {
  storeId: STORE_A, storeName: 'Boutique A', storeAdminUid: STORE_ADMIN_A,
  dealerUid: DEALER_UID, dealerName: 'Dealer',
  transferType: 'return_stock', network: 'Orange', amount: 4000,
  status: 'pending',
  previousStoreBalance: 50000, newStoreBalance: 46000,
  previousDealerBalance: null, newDealerBalance: null,
  createdAt: new Date('2026-08-02T10:00:00Z'), updatedAt: new Date('2026-08-02T10:00:00Z'),
  confirmedBy: null, confirmedAt: null, rejectedBy: null, rejectedAt: null, rejectionReason: null,
}

const seedAdmin = (uid, storeId) => db.doc(`users/${uid}`).set(adminProfile(storeId))
const seedDealerUser = () => db.doc(`users/${DEALER_UID}`).set(DEALER_PROFILE)
const seedReq = (id, o = {}) => db.doc(`dealerRequests/${id}`).set({ ...BASE_REQ, ...o })
const seedTransfer = (id, o = {}) => db.doc(`storeDealerTransfers/${id}`).set({ ...BASE_TRANSFER, ...o })
const seedStoreBal = (storeId) =>
  db.doc(`clients/${storeId}/networkBalances/current`).set({
    balances: { Orange: { stock: 50000, liquidite: 30000 } },
  })
const seedDealerBal = (data) => db.doc(`dealerBalances/${DEALER_UID}`).set(data)
const dealerDoc = async () => (await db.doc(`dealerBalances/${DEALER_UID}`).get())
const asAdmin = (uid, data) => ({ auth: { uid, token: {} }, data })
const asDealer = (data) => ({ auth: { uid: DEALER_UID, token: {} }, data })

// ═══════════════════════════════════════════════════════════════════════════
describe('TC-201 — compteur « envoyé » (confirmDealerRequest)', () => {
// ═══════════════════════════════════════════════════════════════════════════

  it('[FX-A] une confirmation avance le compteur du montant envoyé', async () => {
    await seedAdmin(STORE_ADMIN_A, STORE_A); await seedReq('r1'); await seedStoreBal(STORE_A)
    await seedDealerBal({ balances: { Orange: { stock: 40000, liquidite: 20000 } } })

    await confirmDealerRequestHandler(asAdmin(STORE_ADMIN_A, { requestId: 'r1' }), { db, FieldValue })

    const d = (await dealerDoc()).data()
    expect(d.flux.envoyeCumul).toBe(10000)
    // Le solde suit sa propre règle, inchangée par ce lot.
    expect(d.balances.Orange.stock).toBe(30000)
  })

  it('[FX-B] deux confirmations, depuis deux boutiques, cumulent sur le même compteur', async () => {
    await seedAdmin(STORE_ADMIN_A, STORE_A); await seedAdmin(STORE_ADMIN_B, STORE_B)
    await seedStoreBal(STORE_A); await seedStoreBal(STORE_B)
    await seedReq('r1', { targetStoreId: STORE_A, amount: 10000 })
    await seedReq('r2', { targetStoreId: STORE_B, targetStoreName: 'Boutique B', amount: 25000 })
    await seedDealerBal({ balances: { Orange: { stock: 100000, liquidite: 20000 } } })

    await confirmDealerRequestHandler(asAdmin(STORE_ADMIN_A, { requestId: 'r1' }), { db, FieldValue })
    await confirmDealerRequestHandler(asAdmin(STORE_ADMIN_B, { requestId: 'r2' }), { db, FieldValue })

    expect((await dealerDoc()).data().flux.envoyeCumul).toBe(35000)
  })

  it('[FX-C] sans inventaire amorcé : aucun compteur, ET AUCUN DOCUMENT CRÉÉ', async () => {
    // C'est la règle qui protège la garde d'amorçage de tc-069 [CO-A].
    await seedAdmin(STORE_ADMIN_A, STORE_A); await seedReq('r1'); await seedStoreBal(STORE_A)

    await confirmDealerRequestHandler(asAdmin(STORE_ADMIN_A, { requestId: 'r1' }), { db, FieldValue })

    expect((await dealerDoc()).exists).toBe(false)
  })

  it('[FX-D] un envoi non compté ne bloque pas l’approvisionnement suivant', async () => {
    // La régression que [FX-C] évite, vérifiée par son effet : si le compteur
    // avait créé le document, cette seconde confirmation lèverait
    // INSUFFICIENT_DEALER_BALANCE au lieu de passer.
    await seedAdmin(STORE_ADMIN_A, STORE_A); await seedStoreBal(STORE_A)
    await seedReq('r1'); await seedReq('r2')

    await confirmDealerRequestHandler(asAdmin(STORE_ADMIN_A, { requestId: 'r1' }), { db, FieldValue })
    const res = await confirmDealerRequestHandler(asAdmin(STORE_ADMIN_A, { requestId: 'r2' }), { db, FieldValue })

    expect(res.success).toBe(true)
    expect((await dealerDoc()).exists).toBe(false)
  })

  it('[FX-E] open_day n’avance pas le compteur : rien n’est parti du dealer', async () => {
    await seedAdmin(STORE_ADMIN_A, STORE_A); await seedStoreBal(STORE_A)
    await seedReq('r1', { requestType: 'open_day', amount: 70000, liquidityAmount: 40000 })
    await seedDealerBal({ balances: { Orange: { stock: 100000, liquidite: 50000 } }, flux: { envoyeCumul: 5000 } })

    await confirmDealerRequestHandler(asAdmin(STORE_ADMIN_A, { requestId: 'r1' }), { db, FieldValue })

    expect((await dealerDoc()).data().flux.envoyeCumul).toBe(5000) // inchangé
  })

  it('[FX-F] une confirmation qui échoue ne laisse pas le compteur avancé', async () => {
    await seedAdmin(STORE_ADMIN_A, STORE_A); await seedReq('r1', { amount: 999999 }); await seedStoreBal(STORE_A)
    // Inventaire insuffisant → la transaction entière doit être annulée.
    await seedDealerBal({ balances: { Orange: { stock: 1000, liquidite: 0 } }, flux: { envoyeCumul: 5000 } })

    await expect(
      confirmDealerRequestHandler(asAdmin(STORE_ADMIN_A, { requestId: 'r1' }), { db, FieldValue }),
    ).rejects.toThrow()

    expect((await dealerDoc()).data().flux.envoyeCumul).toBe(5000)
    const req = (await db.doc('dealerRequests/r1').get()).data()
    expect(req.status).toBe('pending')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('TC-201 — compteur « revenu » (confirmStoreDealerTransfer)', () => {
// ═══════════════════════════════════════════════════════════════════════════

  it('[FX-G] un retour de stock avance le compteur et crédite l’inventaire', async () => {
    await seedDealerUser(); await seedTransfer('t1')
    await seedDealerBal({ balances: { Orange: { stock: 40000, liquidite: 20000 } } })

    await confirmStoreDealerTransferHandler(asDealer({ transferId: 't1' }), { db, FieldValue })

    const d = (await dealerDoc()).data()
    expect(d.flux.revenuCumul).toBe(4000)
    expect(d.balances.Orange.stock).toBe(44000)
  })

  it('[FX-H] un envoi de liquidité avance le compteur SANS créditer l’inventaire', async () => {
    // Règle métier existante : la liquidité renvoyée part vers Orange, hors
    // inventaire suivi. Elle a pourtant bien quitté la caisse de la boutique —
    // c'est ce que le compteur mesure, et pourquoi il compte les deux types.
    await seedDealerUser(); await seedTransfer('t1', { transferType: 'return_liquidity', amount: 7000 })
    await seedDealerBal({ balances: { Orange: { stock: 40000, liquidite: 20000 } } })

    await confirmStoreDealerTransferHandler(asDealer({ transferId: 't1' }), { db, FieldValue })

    const d = (await dealerDoc()).data()
    expect(d.flux.revenuCumul).toBe(7000)
    expect(d.balances.Orange.liquidite).toBe(20000) // inchangé
    expect(d.balances.Orange.stock).toBe(40000)     // inchangé
  })

  it('[FX-I] un envoi de liquidité sur un dealer non amorcé ne crée pas le document', async () => {
    // Sinon le document naîtrait avec un `flux` et sans `balances`, et
    // bloquerait ensuite les approvisionnements — depuis un autre fichier.
    await seedDealerUser(); await seedTransfer('t1', { transferType: 'return_liquidity', amount: 7000 })

    await confirmStoreDealerTransferHandler(asDealer({ transferId: 't1' }), { db, FieldValue })

    expect((await dealerDoc()).exists).toBe(false)
  })

  it('[FX-J] envoyé et revenu se cumulent séparément : c’est leur écart qui est dehors', async () => {
    await seedAdmin(STORE_ADMIN_A, STORE_A); await seedDealerUser()
    await seedStoreBal(STORE_A)
    await seedReq('r1', { amount: 30000 })
    await seedTransfer('t1', { amount: 4000 })
    await seedDealerBal({ balances: { Orange: { stock: 100000, liquidite: 20000 } } })

    await confirmDealerRequestHandler(asAdmin(STORE_ADMIN_A, { requestId: 'r1' }), { db, FieldValue })
    await confirmStoreDealerTransferHandler(asDealer({ transferId: 't1' }), { db, FieldValue })

    const { flux } = (await dealerDoc()).data()
    expect(flux.envoyeCumul).toBe(30000)
    expect(flux.revenuCumul).toBe(4000)
    expect(flux.envoyeCumul - flux.revenuCumul).toBe(26000)
  })
})
