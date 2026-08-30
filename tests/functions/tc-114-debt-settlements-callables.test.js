/**
 * TC-114 — Règlements de dette interne (declare / confirm / reject).
 *   Handler integration avec Firestore Emulator, { db, FieldValue } injectés.
 *
 * Comportement protégé :
 *   declare : n'impute RIEN. Écrit une tranche `declared` qui RÉSERVE du montant.
 *             Idempotent sur (dette, acteur, clé) : rejeu exact = no-op, payload
 *             différent = conflit.
 *   confirm : impute la dette, et déplace RÉELLEMENT du float si la méthode est
 *             du Mobile Money. Cash et Banque : aucun solde ne bouge.
 *   reject  : dette intacte, et le montant réservé redevient déclarable.
 *
 * Scénario de référence : A doit 20 000 à B (dépôt exécuté par B pour un client de A).
 *
 * Exécution : npm run test:functions (émulateur Firestore, projet demo-akayis-test).
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { declareInternalDebtSettlementHandler } from '../../functions/src/collaborations/declareInternalDebtSettlement.js'
import { confirmInternalDebtSettlementHandler } from '../../functions/src/collaborations/confirmInternalDebtSettlement.js'
import { rejectInternalDebtSettlementHandler } from '../../functions/src/collaborations/rejectInternalDebtSettlement.js'

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

// ── Fixtures ─────────────────────────────────────────────────────────────────
const ADMIN_A = 'store-admin-a-uid'   // DÉBITRICE
const ADMIN_B = 'store-admin-b-uid'   // CRÉANCIÈRE
const ADMIN_C = 'store-admin-c-uid'   // tiers
const STORE_A = 'store-A'
const STORE_B = 'store-B'
const STORE_C = 'store-C'
const DEBT_ID = 'debt-ab'

const deps = () => ({
  db, FieldValue,
  collaborationsEnabled: true,
  storeNetworks: ['Orange'],
  settlementMethods: ['Orange Money', 'Cash', 'Banque'],
})
const makeRequest = (uid, data) => ({ auth: uid ? { uid, token: {} } : null, data: data ?? {} })
const expectError = (promise, code) => expect(promise).rejects.toMatchObject({ code })

async function seedBase({ stockA = 50000, stockB = 10000 } = {}) {
  await db.doc(`users/${ADMIN_A}`).set({ role: 'store_admin', active: true, storeId: STORE_A, email: 'a@t.test', name: 'Admin A' })
  await db.doc(`users/${ADMIN_B}`).set({ role: 'store_admin', active: true, storeId: STORE_B, email: 'b@t.test', name: 'Admin B' })
  await db.doc(`users/${ADMIN_C}`).set({ role: 'store_admin', active: true, storeId: STORE_C, email: 'c@t.test', name: 'Admin C' })

  await db.doc(`internalDebts/${DEBT_ID}`).set({
    collaborationId: 'collab-ab',
    debtorStoreId: STORE_A, debtorStoreName: 'Boutique A',
    creditorStoreId: STORE_B, creditorStoreName: 'Boutique B',
    network: 'Orange', operationType: 'deposit',
    originalAmount: 20000, settledAmount: 0, remainingAmount: 20000, status: 'open',
    createdAt: new Date('2024-01-01T00:00:00Z'),
  })

  await db.doc(`clients/${STORE_A}/networkBalances/current`).set({
    balances: { Orange: { stock: stockA, liquidite: 80000 } },
  })
  await db.doc(`clients/${STORE_B}/networkBalances/current`).set({
    balances: { Orange: { stock: stockB, liquidite: 30000 } },
  })
}

const declare = (uid, data) => declareInternalDebtSettlementHandler(makeRequest(uid, data), deps())
const confirm = (uid, data) => confirmInternalDebtSettlementHandler(makeRequest(uid, data), deps())
const reject = (uid, data) => rejectInternalDebtSettlementHandler(makeRequest(uid, data), deps())

const validDeclare = (o = {}) => ({ debtId: DEBT_ID, amount: 5000, method: 'Orange Money', idempotencyKey: 'k1', ...o })

const debtDoc = async () => (await db.doc(`internalDebts/${DEBT_ID}`).get()).data()
const settlementDoc = async (id) => (await db.doc(`internalDebts/${DEBT_ID}/settlements/${id}`).get()).data()
const settlementCount = async () => (await db.collection(`internalDebts/${DEBT_ID}/settlements`).get()).size
const stockOf = async (s) => (await db.doc(`clients/${s}/networkBalances/current`).get()).data().balances.Orange.stock
const liquiditeOf = async (s) => (await db.doc(`clients/${s}/networkBalances/current`).get()).data().balances.Orange.liquidite
const auditsOf = async (s) => (await db.collection(`clients/${s}/auditLogs`).get()).docs.map((d) => d.data())

beforeEach(async () => {
  await clearFirestoreEmulator()
  await seedBase()
})

// ═════════════════════════════════════════════════════════════════════════════

describe('TC-114-DE — declareInternalDebtSettlement', () => {
  it('[DE-01] écrit une tranche declared SANS toucher la dette ni les soldes', async () => {
    const res = await declare(ADMIN_A, validDeclare())
    expect(res.settlementId).toBe(`dst_${DEBT_ID}_${ADMIN_A}_k1`)
    expect(res.idempotent).toBe(false)

    const s = await settlementDoc(res.settlementId)
    expect(s.settlementStatus).toBe('declared')
    expect(s.amount).toBe(5000)
    expect(s.previousRemaining).toBe(20000)
    expect(s.newRemaining).toBeNull()
    expect(s.declaredBy).toBe(ADMIN_A)

    const d = await debtDoc()
    expect(d.remainingAmount).toBe(20000)
    expect(d.settledAmount).toBe(0)
    expect(d.status).toBe('open')

    expect(await stockOf(STORE_A)).toBe(50000)
    expect(await stockOf(STORE_B)).toBe(10000)
  })

  it('[DE-02] la tranche porte les deux storeId dénormalisés (compteur collection-group)', async () => {
    const { settlementId } = await declare(ADMIN_A, validDeclare())
    const s = await settlementDoc(settlementId)
    expect(s.debtorStoreId).toBe(STORE_A)
    expect(s.creditorStoreId).toBe(STORE_B)
  })

  it('[DE-03] rejeu EXACT de la même clé → no-op idempotent, une SEULE tranche', async () => {
    const first = await declare(ADMIN_A, validDeclare())
    const second = await declare(ADMIN_A, validDeclare())
    expect(second.settlementId).toBe(first.settlementId)
    expect(second.idempotent).toBe(true)
    expect(await settlementCount()).toBe(1)
  })

  it('[DE-04] même clé, MONTANT différent → conflit', async () => {
    await declare(ADMIN_A, validDeclare())
    await expectError(declare(ADMIN_A, validDeclare({ amount: 7000 })), 'IDEMPOTENCY_CONFLICT')
    expect(await settlementCount()).toBe(1)
  })

  it('[DE-05] même clé, MÉTHODE différente → conflit', async () => {
    await declare(ADMIN_A, validDeclare())
    await expectError(declare(ADMIN_A, validDeclare({ method: 'Cash' })), 'IDEMPOTENCY_CONFLICT')
  })

  it('[DE-06] l’idempotence court-circuite AVANT le calcul du reste dû', async () => {
    // Le piège : si la tranche déjà écrite se comptait dans les montants réservés,
    // ce rejeu échouerait en SETTLEMENT_EXCEEDS_REMAINING au lieu d'être un no-op.
    await declare(ADMIN_A, validDeclare({ amount: 20000 }))   // réserve TOUT le reste dû
    const again = await declare(ADMIN_A, validDeclare({ amount: 20000 }))
    expect(again.idempotent).toBe(true)
    expect(await settlementCount()).toBe(1)
  })

  it('[DE-07] réservation : deux tranches déclarées bloquent la troisième', async () => {
    await declare(ADMIN_A, validDeclare({ amount: 5000, idempotencyKey: 'k1' }))
    await declare(ADMIN_A, validDeclare({ amount: 5000, idempotencyKey: 'k2' }))
    // 20 000 − 10 000 en attente = 10 000 disponibles.
    await expectError(
      declare(ADMIN_A, validDeclare({ amount: 12000, idempotencyKey: 'k3' })),
      'SETTLEMENT_EXCEEDS_REMAINING',
    )
    await declare(ADMIN_A, validDeclare({ amount: 10000, idempotencyKey: 'k4' }))
    expect(await settlementCount()).toBe(3)
  })

  it('[DE-08] déclarer plus que le reste dû → refus', async () => {
    await expectError(declare(ADMIN_A, validDeclare({ amount: 25000 })), 'SETTLEMENT_EXCEEDS_REMAINING')
  })

  it('[DE-09] la CRÉANCIÈRE ne déclare pas : c’est la débitrice qui rembourse', async () => {
    await expectError(declare(ADMIN_B, validDeclare()), 'DEBT_STORE_MISMATCH')
  })

  it('[DE-10] une tierce boutique ne déclare pas', async () => {
    await expectError(declare(ADMIN_C, validDeclare()), 'DEBT_STORE_MISMATCH')
  })

  it('[DE-11] dette réglée → refus', async () => {
    await db.doc(`internalDebts/${DEBT_ID}`).update({ settledAmount: 20000, remainingAmount: 0, status: 'settled' })
    await expectError(declare(ADMIN_A, validDeclare()), 'DEBT_ALREADY_SETTLED')
  })

  it('[DE-12] dette inexistante → refus', async () => {
    await expectError(declare(ADMIN_A, validDeclare({ debtId: 'nope' })), 'DEBT_NOT_FOUND')
  })

  it('[DE-13] méthode hors profil → refus', async () => {
    await expectError(declare(ADMIN_A, validDeclare({ method: 'Moov Money' })), 'INVALID_SETTLEMENT_METHOD')
  })

  it('[DE-14] « compensation » n’est pas déclarable par ce chemin', async () => {
    await expectError(declare(ADMIN_A, validDeclare({ method: 'compensation' })), 'INVALID_SETTLEMENT_METHOD')
  })

  it('[DE-15] clé d’idempotence invalide → refus', async () => {
    await expectError(declare(ADMIN_A, validDeclare({ idempotencyKey: 'a/b' })), 'INVALID_IDEMPOTENCY_KEY')
    await expectError(declare(ADMIN_A, validDeclare({ idempotencyKey: '' })), 'INVALID_IDEMPOTENCY_KEY')
  })

  it('[DE-16] deux acteurs différents, même clé → deux tranches distinctes', async () => {
    // L'uid entre dans l'identifiant : deux gérants de la même boutique ne se
    // marchent pas dessus s'ils génèrent la même clé.
    await db.doc(`users/second-admin-a`).set({ role: 'store_admin', active: true, storeId: STORE_A, email: 'a2@t.test', name: 'Admin A2' })
    const r1 = await declare(ADMIN_A, validDeclare({ amount: 5000 }))
    const r2 = await declare('second-admin-a', validDeclare({ amount: 5000 }))
    expect(r1.settlementId).not.toBe(r2.settlementId)
    expect(await settlementCount()).toBe(2)
  })

  it('[DE-17] audit chez la débitrice', async () => {
    await declare(ADMIN_A, validDeclare())
    expect((await auditsOf(STORE_A)).map((l) => l.action)).toContain('INTERNAL_DEBT_SETTLEMENT_DECLARED')
  })

  it('[DE-18] module désactivé → refus', async () => {
    await expectError(
      declareInternalDebtSettlementHandler(makeRequest(ADMIN_A, validDeclare()), { ...deps(), collaborationsEnabled: false }),
      'COLLABORATIONS_DISABLED',
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════

describe('TC-114-CF — confirmInternalDebtSettlement : Mobile Money déplace du float', () => {
  it('[CF-01] Orange Money : stock débitrice −, stock créancière +, dette imputée', async () => {
    const { settlementId } = await declare(ADMIN_A, validDeclare({ amount: 5000, method: 'Orange Money' }))
    const res = await confirm(ADMIN_B, { debtId: DEBT_ID, settlementId })

    expect(await stockOf(STORE_A)).toBe(45000)
    expect(await stockOf(STORE_B)).toBe(15000)

    const d = await debtDoc()
    expect(d.remainingAmount).toBe(15000)
    expect(d.settledAmount).toBe(5000)
    expect(d.status).toBe('partially_settled')
    expect(res.movedStock).toBe(true)
  })

  it('[CF-02] deux audits BALANCE_MOVED, un DEBITED et un CREDITED', async () => {
    const { settlementId } = await declare(ADMIN_A, validDeclare())
    await confirm(ADMIN_B, { debtId: DEBT_ID, settlementId })

    const moveA = (await auditsOf(STORE_A)).find((l) => l.action === 'INTERNAL_DEBT_SETTLEMENT_BALANCE_MOVED')
    const moveB = (await auditsOf(STORE_B)).find((l) => l.action === 'INTERNAL_DEBT_SETTLEMENT_BALANCE_MOVED')

    expect(moveA.direction).toBe('DEBITED')
    expect(moveA.previousBalance).toBe(50000)
    expect(moveA.newBalance).toBe(45000)
    expect(moveB.direction).toBe('CREDITED')
    expect(moveB.previousBalance).toBe(10000)
    expect(moveB.newBalance).toBe(15000)
  })

  it('[CF-03] la tranche devient confirmed avec ancien et nouveau reste dû', async () => {
    const { settlementId } = await declare(ADMIN_A, validDeclare())
    await confirm(ADMIN_B, { debtId: DEBT_ID, settlementId })
    const s = await settlementDoc(settlementId)
    expect(s.settlementStatus).toBe('confirmed')
    expect(s.confirmedBy).toBe(ADMIN_B)
    expect(s.previousRemaining).toBe(20000)
    expect(s.newRemaining).toBe(15000)
  })

  it('[CF-04] la dernière tranche solde la dette', async () => {
    const a = await declare(ADMIN_A, validDeclare({ amount: 15000, idempotencyKey: 'k1' }))
    await confirm(ADMIN_B, { debtId: DEBT_ID, settlementId: a.settlementId })
    const b = await declare(ADMIN_A, validDeclare({ amount: 5000, idempotencyKey: 'k2' }))
    await confirm(ADMIN_B, { debtId: DEBT_ID, settlementId: b.settlementId })

    const d = await debtDoc()
    expect(d.remainingAmount).toBe(0)
    expect(d.settledAmount).toBe(20000)
    expect(d.status).toBe('settled')
    expect(d.settledAmount + d.remainingAmount).toBe(d.originalAmount)
  })

  it('[CF-05] stock insuffisant chez la débitrice → refus, rien ne bouge', async () => {
    await clearFirestoreEmulator()
    await seedBase({ stockA: 1000 })
    const { settlementId } = await declare(ADMIN_A, validDeclare({ amount: 5000 }))
    await expectError(confirm(ADMIN_B, { debtId: DEBT_ID, settlementId }), 'SETTLEMENT_INSUFFICIENT_BALANCE')

    expect(await stockOf(STORE_A)).toBe(1000)
    expect(await stockOf(STORE_B)).toBe(10000)
    expect((await debtDoc()).remainingAmount).toBe(20000)
    expect((await settlementDoc(settlementId)).settlementStatus).toBe('declared')
  })

  it('[CF-06] double confirmation → une SEULE imputation', async () => {
    const { settlementId } = await declare(ADMIN_A, validDeclare())
    await confirm(ADMIN_B, { debtId: DEBT_ID, settlementId })
    await expectError(confirm(ADMIN_B, { debtId: DEBT_ID, settlementId }), 'SETTLEMENT_NOT_DECLARED')
    expect((await debtDoc()).remainingAmount).toBe(15000)
    expect(await stockOf(STORE_A)).toBe(45000)
  })

  it('[CF-07] la DÉBITRICE ne confirme pas sa propre tranche', async () => {
    const { settlementId } = await declare(ADMIN_A, validDeclare())
    await expectError(confirm(ADMIN_A, { debtId: DEBT_ID, settlementId }), 'DEBT_STORE_MISMATCH')
    expect(await stockOf(STORE_A)).toBe(50000)
  })

  it('[CF-08] tranche inexistante → refus', async () => {
    await expectError(confirm(ADMIN_B, { debtId: DEBT_ID, settlementId: 'dst_nope' }), 'SETTLEMENT_NOT_FOUND')
  })
})

describe('TC-114-CF — confirmInternalDebtSettlement : Cash et Banque ne bougent rien', () => {
  it('[CF-20] Cash : dette imputée, AUCUN solde touché, aucun audit BALANCE_MOVED', async () => {
    const { settlementId } = await declare(ADMIN_A, validDeclare({ amount: 5000, method: 'Cash' }))
    const res = await confirm(ADMIN_B, { debtId: DEBT_ID, settlementId })

    expect((await debtDoc()).remainingAmount).toBe(15000)
    expect(await stockOf(STORE_A)).toBe(50000)
    expect(await stockOf(STORE_B)).toBe(10000)
    expect(await liquiditeOf(STORE_A)).toBe(80000)
    expect(await liquiditeOf(STORE_B)).toBe(30000)
    expect(res.movedStock).toBe(false)

    const moves = [...(await auditsOf(STORE_A)), ...(await auditsOf(STORE_B))]
      .filter((l) => l.action === 'INTERNAL_DEBT_SETTLEMENT_BALANCE_MOVED')
    expect(moves).toHaveLength(0)
  })

  it('[CF-21] Banque : même comportement que Cash', async () => {
    const { settlementId } = await declare(ADMIN_A, validDeclare({ amount: 5000, method: 'Banque' }))
    const res = await confirm(ADMIN_B, { debtId: DEBT_ID, settlementId })
    expect((await debtDoc()).remainingAmount).toBe(15000)
    expect(await stockOf(STORE_A)).toBe(50000)
    expect(res.movedStock).toBe(false)
  })

  it('[CF-22] Cash passe même avec un stock à zéro chez la débitrice', async () => {
    await clearFirestoreEmulator()
    await seedBase({ stockA: 0 })
    const { settlementId } = await declare(ADMIN_A, validDeclare({ amount: 5000, method: 'Cash' }))
    await confirm(ADMIN_B, { debtId: DEBT_ID, settlementId })
    expect((await debtDoc()).remainingAmount).toBe(15000)
  })

  it('[CF-23] la méthode n’est PAS revalidée : un code historique reste confirmable', async () => {
    // Décision délibérée : refuser la confirmation figerait pour toujours les
    // tranches portant d'anciens codes dans la file d'attente de la créancière.
    const settlementId = `dst_${DEBT_ID}_${ADMIN_A}_legacy`
    await db.doc(`internalDebts/${DEBT_ID}/settlements/${settlementId}`).set({
      debtId: DEBT_ID, debtorStoreId: STORE_A, creditorStoreId: STORE_B,
      amount: 5000, method: 'especes', settlementStatus: 'declared',
      idempotencyKey: 'legacy', previousRemaining: 20000, newRemaining: null,
      declaredBy: ADMIN_A, declaredAt: new Date(),
    })
    await confirm(ADMIN_B, { debtId: DEBT_ID, settlementId })
    expect((await debtDoc()).remainingAmount).toBe(15000)
    // Code inconnu → ne mappe sur aucun réseau → aucun mouvement de stock.
    expect(await stockOf(STORE_A)).toBe(50000)
  })

  it('[CF-24] une tranche de compensation est refusée par ce chemin', async () => {
    // L'imputer ici ne toucherait qu'UNE des deux dettes.
    const settlementId = `dcp_${DEBT_ID}_${ADMIN_A}_k9`
    await db.doc(`internalDebts/${DEBT_ID}/settlements/${settlementId}`).set({
      debtId: DEBT_ID, oppositeDebtId: 'debt-ba',
      debtorStoreId: STORE_A, creditorStoreId: STORE_B,
      amount: 5000, method: 'compensation', settlementStatus: 'declared',
      idempotencyKey: 'k9', declaredBy: ADMIN_A, declaredAt: new Date(),
    })
    await expectError(confirm(ADMIN_B, { debtId: DEBT_ID, settlementId }), 'SETTLEMENT_NOT_FOUND')
    expect((await debtDoc()).remainingAmount).toBe(20000)
  })
})

// ═════════════════════════════════════════════════════════════════════════════

describe('TC-114-RJ — rejectInternalDebtSettlement', () => {
  it('[RJ-01] tranche rejetée, dette INTACTE, aucun solde touché', async () => {
    const { settlementId } = await declare(ADMIN_A, validDeclare())
    await reject(ADMIN_B, { debtId: DEBT_ID, settlementId, rejectionReason: 'Non reçu' })

    const s = await settlementDoc(settlementId)
    expect(s.settlementStatus).toBe('rejected')
    expect(s.rejectionReason).toBe('Non reçu')
    expect(s.rejectedBy).toBe(ADMIN_B)

    const d = await debtDoc()
    expect(d.remainingAmount).toBe(20000)
    expect(d.settledAmount).toBe(0)
    expect(d.status).toBe('open')
    expect(await stockOf(STORE_A)).toBe(50000)
    expect(await stockOf(STORE_B)).toBe(10000)
  })

  it('[RJ-02] le montant réservé redevient déclarable', async () => {
    const first = await declare(ADMIN_A, validDeclare({ amount: 20000, idempotencyKey: 'k1' }))
    // Tout est réservé : une seconde déclaration est impossible.
    await expectError(
      declare(ADMIN_A, validDeclare({ amount: 5000, idempotencyKey: 'k2' })),
      'SETTLEMENT_EXCEEDS_REMAINING',
    )
    await reject(ADMIN_B, { debtId: DEBT_ID, settlementId: first.settlementId, rejectionReason: 'Non reçu' })
    // Après rejet, la réservation est libérée.
    await declare(ADMIN_A, validDeclare({ amount: 20000, idempotencyKey: 'k3' }))
    expect((await debtDoc()).remainingAmount).toBe(20000)
  })

  it('[RJ-03] une tranche rejetée n’est jamais réactivable', async () => {
    const { settlementId } = await declare(ADMIN_A, validDeclare())
    await reject(ADMIN_B, { debtId: DEBT_ID, settlementId, rejectionReason: 'Non reçu' })
    await expectError(confirm(ADMIN_B, { debtId: DEBT_ID, settlementId }), 'SETTLEMENT_NOT_DECLARED')
    await expectError(
      reject(ADMIN_B, { debtId: DEBT_ID, settlementId, rejectionReason: 'Encore non reçu' }),
      'SETTLEMENT_NOT_DECLARED',
    )
  })

  it('[RJ-04] la DÉBITRICE ne rejette pas sa propre tranche', async () => {
    const { settlementId } = await declare(ADMIN_A, validDeclare())
    await expectError(
      reject(ADMIN_A, { debtId: DEBT_ID, settlementId, rejectionReason: 'Annulation' }),
      'DEBT_STORE_MISMATCH',
    )
  })

  it('[RJ-05] motif trop court → refus', async () => {
    const { settlementId } = await declare(ADMIN_A, validDeclare())
    await expectError(
      reject(ADMIN_B, { debtId: DEBT_ID, settlementId, rejectionReason: 'no' }),
      'INVALID_REJECTION_REASON',
    )
    expect((await settlementDoc(settlementId)).settlementStatus).toBe('declared')
  })

  it('[RJ-06] audit chez la créancière avec le motif', async () => {
    const { settlementId } = await declare(ADMIN_A, validDeclare())
    await reject(ADMIN_B, { debtId: DEBT_ID, settlementId, rejectionReason: 'Non reçu' })
    const entry = (await auditsOf(STORE_B)).find((l) => l.action === 'INTERNAL_DEBT_SETTLEMENT_REJECTED')
    expect(entry.rejectionReason).toBe('Non reçu')
  })
})

// ═════════════════════════════════════════════════════════════════════════════

describe('TC-114-IV — invariants après un cycle complet', () => {
  it('[IV-01] réglé + reste dû === montant initial à chaque étape', async () => {
    const amounts = [3000, 7000, 10000]
    let i = 0
    for (const amount of amounts) {
      const { settlementId } = await declare(ADMIN_A, validDeclare({ amount, idempotencyKey: `k${i++}` }))
      await confirm(ADMIN_B, { debtId: DEBT_ID, settlementId })
      const d = await debtDoc()
      expect(d.settledAmount + d.remainingAmount).toBe(d.originalAmount)
    }
    const d = await debtDoc()
    expect(d.status).toBe('settled')
    expect(d.remainingAmount).toBe(0)
  })

  it('[IV-02] le float total des deux boutiques est conservé', async () => {
    const before = (await stockOf(STORE_A)) + (await stockOf(STORE_B))
    const { settlementId } = await declare(ADMIN_A, validDeclare({ amount: 5000, method: 'Orange Money' }))
    await confirm(ADMIN_B, { debtId: DEBT_ID, settlementId })
    expect((await stockOf(STORE_A)) + (await stockOf(STORE_B))).toBe(before)
  })

  it('[IV-03] les autres réseaux ne sont jamais écrasés par le merge', async () => {
    await db.doc(`clients/${STORE_A}/networkBalances/current`).set({
      balances: { Orange: { stock: 50000, liquidite: 80000 }, Moov: { stock: 4242, liquidite: 2121 } },
    })
    const { settlementId } = await declare(ADMIN_A, validDeclare())
    await confirm(ADMIN_B, { debtId: DEBT_ID, settlementId })
    const balances = (await db.doc(`clients/${STORE_A}/networkBalances/current`).get()).data().balances
    expect(balances.Orange.stock).toBe(45000)
    expect(balances.Orange.liquidite).toBe(80000)
    expect(balances.Moov).toEqual({ stock: 4242, liquidite: 2121 })
  })
})
