/**
 * TC-115 — Compensation de dettes internes (declare / confirm / reject).
 *   Handler integration avec Firestore Emulator, { db, FieldValue } injectés.
 *
 * Compenser, c'est solder D1 (A→B) contre la dette opposée D2 (B→A).
 *
 * Comportement protégé :
 *   declare : n'impute rien ; paire opposée obligatoire ; plafond = le plus petit
 *             des deux restes disponibles ; idempotent.
 *   confirm : impute les DEUX dettes atomiquement, écrit une tranche MIROIR sous
 *             D2, audite chez LES DEUX boutiques, et ne déplace AUCUN float.
 *   reject  : les deux dettes intactes, aucun miroir.
 *
 * Scénario de référence : A doit 20 000 à B (D1), B doit 12 000 à A (D2).
 * Compensable : 12 000. Après compensation : D1 reste 8 000, D2 est soldée.
 *
 * Exécution : npm run test:functions (émulateur Firestore, projet demo-akayis-test).
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { declareInternalDebtCompensationHandler } from '../../functions/src/collaborations/declareInternalDebtCompensation.js'
import { confirmInternalDebtCompensationHandler } from '../../functions/src/collaborations/confirmInternalDebtCompensation.js'
import { rejectInternalDebtCompensationHandler } from '../../functions/src/collaborations/rejectInternalDebtCompensation.js'
import { confirmInternalDebtSettlementHandler } from '../../functions/src/collaborations/confirmInternalDebtSettlement.js'

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
const ADMIN_A = 'store-admin-a-uid'
const ADMIN_B = 'store-admin-b-uid'
const ADMIN_C = 'store-admin-c-uid'
const STORE_A = 'store-A'
const STORE_B = 'store-B'
const STORE_C = 'store-C'
const D1 = 'debt-ab'   // A doit 20 000 à B
const D2 = 'debt-ba'   // B doit 12 000 à A
const D3 = 'debt-ac'   // A doit 5 000 à C — pour tester la paire non opposée
const D4 = 'debt-ba-2' // B doit 5 000 à A — seconde opposée VALIDE, pour l'idempotence

const deps = () => ({ db, FieldValue, collaborationsEnabled: true, storeNetworks: ['Orange'] })
const makeRequest = (uid, data) => ({ auth: uid ? { uid, token: {} } : null, data: data ?? {} })
const expectError = (promise, code) => expect(promise).rejects.toMatchObject({ code })

const debtDoc = (id, over = {}) => ({
  network: 'Orange', operationType: 'deposit',
  createdAt: new Date('2024-01-01T00:00:00Z'), ...over,
})

async function seedBase({ d1 = 20000, d2 = 12000 } = {}) {
  await db.doc(`users/${ADMIN_A}`).set({ role: 'store_admin', active: true, storeId: STORE_A, email: 'a@t.test', name: 'Admin A' })
  await db.doc(`users/${ADMIN_B}`).set({ role: 'store_admin', active: true, storeId: STORE_B, email: 'b@t.test', name: 'Admin B' })
  await db.doc(`users/${ADMIN_C}`).set({ role: 'store_admin', active: true, storeId: STORE_C, email: 'c@t.test', name: 'Admin C' })

  await db.doc(`internalDebts/${D1}`).set(debtDoc(D1, {
    debtorStoreId: STORE_A, debtorStoreName: 'Boutique A',
    creditorStoreId: STORE_B, creditorStoreName: 'Boutique B',
    originalAmount: d1, settledAmount: 0, remainingAmount: d1, status: 'open',
  }))
  await db.doc(`internalDebts/${D2}`).set(debtDoc(D2, {
    debtorStoreId: STORE_B, debtorStoreName: 'Boutique B',
    creditorStoreId: STORE_A, creditorStoreName: 'Boutique A',
    originalAmount: d2, settledAmount: 0, remainingAmount: d2, status: 'open',
  }))
  await db.doc(`internalDebts/${D4}`).set(debtDoc(D4, {
    debtorStoreId: STORE_B, debtorStoreName: 'Boutique B',
    creditorStoreId: STORE_A, creditorStoreName: 'Boutique A',
    originalAmount: 5000, settledAmount: 0, remainingAmount: 5000, status: 'open',
  }))
  await db.doc(`internalDebts/${D3}`).set(debtDoc(D3, {
    debtorStoreId: STORE_A, debtorStoreName: 'Boutique A',
    creditorStoreId: STORE_C, creditorStoreName: 'Boutique C',
    originalAmount: 5000, settledAmount: 0, remainingAmount: 5000, status: 'open',
  }))

  for (const s of [STORE_A, STORE_B]) {
    await db.doc(`clients/${s}/networkBalances/current`).set({
      balances: { Orange: { stock: 50000, liquidite: 30000 } },
    })
  }
}

const declare = (uid, data) => declareInternalDebtCompensationHandler(makeRequest(uid, data), deps())
const confirm = (uid, data) => confirmInternalDebtCompensationHandler(makeRequest(uid, data), deps())
const reject = (uid, data) => rejectInternalDebtCompensationHandler(makeRequest(uid, data), deps())

const validDeclare = (o = {}) => ({ debtId: D1, oppositeDebtId: D2, amount: 12000, idempotencyKey: 'k1', ...o })

const getDebt = async (id) => (await db.doc(`internalDebts/${id}`).get()).data()
const getSlice = async (debtId, id) => (await db.doc(`internalDebts/${debtId}/settlements/${id}`).get()).data()
const slicesOf = async (debtId) => (await db.collection(`internalDebts/${debtId}/settlements`).get()).docs
const stockOf = async (s) => (await db.doc(`clients/${s}/networkBalances/current`).get()).data().balances.Orange.stock
const auditsOf = async (s) => (await db.collection(`clients/${s}/auditLogs`).get()).docs.map((d) => d.data())

beforeEach(async () => {
  await clearFirestoreEmulator()
  await seedBase()
})

// ═════════════════════════════════════════════════════════════════════════════

describe('TC-115-DE — declareInternalDebtCompensation', () => {
  it('[DE-01] écrit une tranche declared sous D1, sans toucher aucune dette', async () => {
    const res = await declare(ADMIN_A, validDeclare())
    expect(res.settlementId).toBe(`dcp_${D1}_${ADMIN_A}_k1`)

    const s = await getSlice(D1, res.settlementId)
    expect(s.method).toBe('compensation')
    expect(s.settlementStatus).toBe('declared')
    expect(s.oppositeDebtId).toBe(D2)
    expect(s.amount).toBe(12000)

    expect((await getDebt(D1)).remainingAmount).toBe(20000)
    expect((await getDebt(D2)).remainingAmount).toBe(12000)
    expect(await slicesOf(D2)).toHaveLength(0)
  })

  it('[DE-02] c’est la DÉBITRICE de D1 qui propose', async () => {
    await expectError(declare(ADMIN_B, validDeclare()), 'DEBT_STORE_MISMATCH')
  })

  it('[DE-03] paire NON opposée → refus', async () => {
    // D3 lie A et C : ce n'est pas l'opposé de D1 (A↔B).
    await expectError(declare(ADMIN_A, validDeclare({ oppositeDebtId: D3, amount: 5000 })), 'NOT_OPPOSITE_PAIR')
  })

  it('[DE-04] compenser une dette avec elle-même → refus', async () => {
    await expectError(declare(ADMIN_A, validDeclare({ oppositeDebtId: D1 })), 'INVALID_OPPOSITE_DEBT')
  })

  it('[DE-05] dette opposée inexistante → refus', async () => {
    await expectError(declare(ADMIN_A, validDeclare({ oppositeDebtId: 'nope' })), 'DEBT_NOT_FOUND')
  })

  it('[DE-06] plafond = le plus petit des deux restes', async () => {
    // D2 ne porte que 12 000 : on ne peut pas compenser 12 001.
    await expectError(declare(ADMIN_A, validDeclare({ amount: 12001 })), 'COMPENSATION_EXCEEDS_REMAINING')
    await declare(ADMIN_A, validDeclare({ amount: 12000 }))
  })

  it('[DE-07] les tranches en attente des DEUX dettes réduisent le plafond', async () => {
    // Une tranche déclarée de 10 000 sur D2 ne laisse que 2 000 compensables.
    await db.doc(`internalDebts/${D2}/settlements/dst_${D2}_${ADMIN_B}_x`).set({
      debtId: D2, debtorStoreId: STORE_B, creditorStoreId: STORE_A,
      amount: 10000, method: 'Cash', settlementStatus: 'declared',
      idempotencyKey: 'x', declaredBy: ADMIN_B, declaredAt: new Date(),
    })
    await expectError(declare(ADMIN_A, validDeclare({ amount: 3000 })), 'COMPENSATION_EXCEEDS_REMAINING')
    await declare(ADMIN_A, validDeclare({ amount: 2000 }))
  })

  it('[DE-08] rejeu exact → no-op idempotent', async () => {
    const first = await declare(ADMIN_A, validDeclare())
    const second = await declare(ADMIN_A, validDeclare())
    expect(second.settlementId).toBe(first.settlementId)
    expect(second.idempotent).toBe(true)
    expect(await slicesOf(D1)).toHaveLength(1)
  })

  it('[DE-09] même clé, montant différent → conflit', async () => {
    await declare(ADMIN_A, validDeclare())
    await expectError(declare(ADMIN_A, validDeclare({ amount: 5000 })), 'IDEMPOTENCY_CONFLICT')
  })

  it('[DE-10] même clé, dette opposée différente → conflit', async () => {
    // D4 est une opposée VALIDE (B→A) mais distincte de D2 : la validation de
    // paire passe, et c'est bien le contrôle d'idempotence qui tranche.
    await declare(ADMIN_A, validDeclare({ amount: 5000 }))
    await expectError(declare(ADMIN_A, validDeclare({ amount: 5000, oppositeDebtId: D4 })), 'IDEMPOTENCY_CONFLICT')
  })

  it('[DE-11] la paire opposée est validée AVANT l’idempotence', async () => {
    // Ordre du §8.1.3 : débitrice, puis paire, puis idempotence. Une opposée
    // invalide est donc refusée pour ce qu'elle est, pas pour un conflit de clé.
    await declare(ADMIN_A, validDeclare({ amount: 5000 }))
    await expectError(declare(ADMIN_A, validDeclare({ amount: 5000, oppositeDebtId: D3 })), 'NOT_OPPOSITE_PAIR')
  })

  it('[DE-11] dette déjà réglée → refus', async () => {
    await db.doc(`internalDebts/${D2}`).update({ settledAmount: 12000, remainingAmount: 0, status: 'settled' })
    await expectError(declare(ADMIN_A, validDeclare()), 'DEBT_ALREADY_SETTLED')
  })

  it('[DE-12] audit chez la débitrice de D1', async () => {
    await declare(ADMIN_A, validDeclare())
    expect((await auditsOf(STORE_A)).map((l) => l.action)).toContain('INTERNAL_DEBT_COMPENSATION_DECLARED')
  })
})

// ═════════════════════════════════════════════════════════════════════════════

describe('TC-115-CF — confirmInternalDebtCompensation', () => {
  it('[CF-01] impute les DEUX dettes : D1 reste 8 000, D2 soldée', async () => {
    const { settlementId } = await declare(ADMIN_A, validDeclare())
    const res = await confirm(ADMIN_B, { debtId: D1, settlementId })

    const d1 = await getDebt(D1)
    expect(d1.remainingAmount).toBe(8000)
    expect(d1.settledAmount).toBe(12000)
    expect(d1.status).toBe('partially_settled')

    const d2 = await getDebt(D2)
    expect(d2.remainingAmount).toBe(0)
    expect(d2.settledAmount).toBe(12000)
    expect(d2.status).toBe('settled')

    expect(res.debtStatus).toBe('partially_settled')
    expect(res.oppositeDebtStatus).toBe('settled')
  })

  it('[CF-02] AUCUN float ne bouge', async () => {
    const { settlementId } = await declare(ADMIN_A, validDeclare())
    await confirm(ADMIN_B, { debtId: D1, settlementId })
    expect(await stockOf(STORE_A)).toBe(50000)
    expect(await stockOf(STORE_B)).toBe(50000)

    const moves = [...(await auditsOf(STORE_A)), ...(await auditsOf(STORE_B))]
      .filter((l) => l.action === 'INTERNAL_DEBT_SETTLEMENT_BALANCE_MOVED')
    expect(moves).toHaveLength(0)
  })

  it('[CF-03] une tranche MIROIR est écrite sous D2', async () => {
    const { settlementId } = await declare(ADMIN_A, validDeclare())
    const res = await confirm(ADMIN_B, { debtId: D1, settlementId })

    const mirror = await getSlice(D2, res.mirrorSettlementId)
    expect(res.mirrorSettlementId).toBe(`comp_${D1}_${settlementId}`)
    expect(mirror.settlementStatus).toBe('confirmed')
    expect(mirror.mirrorOf).toBe(settlementId)
    expect(mirror.amount).toBe(12000)
    expect(mirror.method).toBe('compensation')
    // Le miroir porte les restes dus de D2, pas ceux de D1.
    expect(mirror.previousRemaining).toBe(12000)
    expect(mirror.newRemaining).toBe(0)
    // Et les storeId de D2, pour le compteur collection-group.
    expect(mirror.debtorStoreId).toBe(STORE_B)
    expect(mirror.creditorStoreId).toBe(STORE_A)
  })

  it('[CF-04] le miroir attribue la déclaration à son auteur RÉEL', async () => {
    // declaredBy est recopié de la source : ce n'est pas celui qui confirme.
    const { settlementId } = await declare(ADMIN_A, validDeclare())
    const res = await confirm(ADMIN_B, { debtId: D1, settlementId })
    const mirror = await getSlice(D2, res.mirrorSettlementId)
    expect(mirror.declaredBy).toBe(ADMIN_A)
    expect(mirror.confirmedBy).toBe(ADMIN_B)
  })

  it('[CF-05] la tranche source porte les restes dus de D1', async () => {
    const { settlementId } = await declare(ADMIN_A, validDeclare())
    await confirm(ADMIN_B, { debtId: D1, settlementId })
    const s = await getSlice(D1, settlementId)
    expect(s.settlementStatus).toBe('confirmed')
    expect(s.previousRemaining).toBe(20000)
    expect(s.newRemaining).toBe(8000)
  })

  it('[CF-06] audit chez LES DEUX boutiques', async () => {
    const { settlementId } = await declare(ADMIN_A, validDeclare())
    await confirm(ADMIN_B, { debtId: D1, settlementId })
    for (const store of [STORE_A, STORE_B]) {
      const entry = (await auditsOf(store)).find((l) => l.action === 'INTERNAL_DEBT_COMPENSATION_CONFIRMED')
      expect(entry, `audit manquant chez ${store}`).toBeDefined()
      expect(entry.amount).toBe(12000)
      expect(entry.debtStatus).toBe('partially_settled')
      expect(entry.oppositeDebtStatus).toBe('settled')
    }
  })

  it('[CF-07] seule la CRÉANCIÈRE de D1 confirme', async () => {
    const { settlementId } = await declare(ADMIN_A, validDeclare())
    await expectError(confirm(ADMIN_A, { debtId: D1, settlementId }), 'DEBT_STORE_MISMATCH')
    expect((await getDebt(D1)).remainingAmount).toBe(20000)
    expect((await getDebt(D2)).remainingAmount).toBe(12000)
  })

  it('[CF-08] double confirmation → une seule imputation', async () => {
    const { settlementId } = await declare(ADMIN_A, validDeclare())
    await confirm(ADMIN_B, { debtId: D1, settlementId })
    await expectError(confirm(ADMIN_B, { debtId: D1, settlementId }), 'SETTLEMENT_NOT_DECLARED')
    expect((await getDebt(D1)).remainingAmount).toBe(8000)
    expect((await getDebt(D2)).remainingAmount).toBe(0)
  })

  it('[CF-09] plafond REVALIDÉ au moment présent (garde-fou anti-dérive)', async () => {
    // On déclare 12 000, puis D2 est réduite par un autre règlement confirmé.
    const { settlementId } = await declare(ADMIN_A, validDeclare({ amount: 12000 }))
    await db.doc(`internalDebts/${D2}/settlements/dst_${D2}_${ADMIN_B}_y`).set({
      debtId: D2, debtorStoreId: STORE_B, creditorStoreId: STORE_A,
      amount: 10000, method: 'Cash', settlementStatus: 'declared',
      idempotencyKey: 'y', declaredBy: ADMIN_B, declaredAt: new Date(),
    })
    await confirmInternalDebtSettlementHandler(
      makeRequest(ADMIN_A, { debtId: D2, settlementId: `dst_${D2}_${ADMIN_B}_y` }), deps(),
    )
    expect((await getDebt(D2)).remainingAmount).toBe(2000)

    // La compensation de 12 000 n'est plus tenable.
    await expectError(confirm(ADMIN_B, { debtId: D1, settlementId }), 'COMPENSATION_EXCEEDS_REMAINING')
    expect((await getDebt(D1)).remainingAmount).toBe(20000)
    expect((await getDebt(D2)).remainingAmount).toBe(2000)
  })

  it('[CF-09b] deux compensations en attente sur-réservent D2 → la 2e est arrêtée à la confirmation', async () => {
    // ⚠ Asymétrie structurelle : une tranche de compensation vit sous D1, donc
    // elle réserve du montant sur D1 mais RIEN sur D2 — pendingD2 ne la voit pas.
    // Deux déclarations peuvent donc totaliser plus que le reste dû de D2.
    // C'est précisément pour ça que le plafond est revalidé à la confirmation :
    // c'est LUI qui protège D2, pas le contrôle de déclaration.
    const c1 = await declare(ADMIN_A, validDeclare({ amount: 12000, idempotencyKey: 'k1' }))
    const c2 = await declare(ADMIN_A, validDeclare({ amount: 8000, idempotencyKey: 'k2' }))
    // Les deux passent : 12 000 + 8 000 = 20 000, le reste dû de D1.
    expect(await slicesOf(D1)).toHaveLength(2)

    await confirm(ADMIN_B, { debtId: D1, settlementId: c1.settlementId })
    expect((await getDebt(D2)).remainingAmount).toBe(0)

    // La seconde n'a plus de contrepartie : refusée, et les dettes ne bougent plus.
    await expectError(confirm(ADMIN_B, { debtId: D1, settlementId: c2.settlementId }), 'COMPENSATION_EXCEEDS_REMAINING')
    expect((await getDebt(D1)).remainingAmount).toBe(8000)
    expect((await getDebt(D2)).remainingAmount).toBe(0)
  })

  it('[CF-10] une tranche de RÈGLEMENT ordinaire est refusée par ce chemin', async () => {
    await db.doc(`internalDebts/${D1}/settlements/dst_${D1}_${ADMIN_A}_z`).set({
      debtId: D1, debtorStoreId: STORE_A, creditorStoreId: STORE_B,
      amount: 5000, method: 'Cash', settlementStatus: 'declared',
      idempotencyKey: 'z', declaredBy: ADMIN_A, declaredAt: new Date(),
    })
    await expectError(confirm(ADMIN_B, { debtId: D1, settlementId: `dst_${D1}_${ADMIN_A}_z` }), 'SETTLEMENT_NOT_FOUND')
  })

  it('[CF-11] compensation totale : les deux dettes soldées d’un coup', async () => {
    await clearFirestoreEmulator()
    await seedBase({ d1: 12000, d2: 12000 })
    const { settlementId } = await declare(ADMIN_A, validDeclare({ amount: 12000 }))
    await confirm(ADMIN_B, { debtId: D1, settlementId })
    expect((await getDebt(D1)).status).toBe('settled')
    expect((await getDebt(D2)).status).toBe('settled')
  })
})

// ═════════════════════════════════════════════════════════════════════════════

describe('TC-115-RJ — rejectInternalDebtCompensation', () => {
  it('[RJ-01] les DEUX dettes restent intactes, aucun miroir', async () => {
    const { settlementId } = await declare(ADMIN_A, validDeclare())
    await reject(ADMIN_B, { debtId: D1, settlementId, rejectionReason: 'Refusée' })

    expect((await getSlice(D1, settlementId)).settlementStatus).toBe('rejected')
    expect((await getDebt(D1)).remainingAmount).toBe(20000)
    expect((await getDebt(D2)).remainingAmount).toBe(12000)
    expect(await slicesOf(D2)).toHaveLength(0)
  })

  it('[RJ-02] le montant réservé redevient compensable', async () => {
    // La tranche vit sous D1 : elle réserve donc 12 000 du reste dû de D1
    // (20 000 → 8 000 encore déclarables). Une seconde de 9 000 dépasse.
    const first = await declare(ADMIN_A, validDeclare({ amount: 12000, idempotencyKey: 'k1' }))
    await expectError(declare(ADMIN_A, validDeclare({ amount: 9000, idempotencyKey: 'k2' })), 'COMPENSATION_EXCEEDS_REMAINING')
    await reject(ADMIN_B, { debtId: D1, settlementId: first.settlementId, rejectionReason: 'Refusée' })
    // Après rejet, la réservation est libérée : les 12 000 repassent.
    await declare(ADMIN_A, validDeclare({ amount: 12000, idempotencyKey: 'k3' }))
  })

  it('[RJ-03] seule la créancière de D1 rejette', async () => {
    const { settlementId } = await declare(ADMIN_A, validDeclare())
    await expectError(
      reject(ADMIN_A, { debtId: D1, settlementId, rejectionReason: 'Annulation' }),
      'DEBT_STORE_MISMATCH',
    )
  })

  it('[RJ-04] une compensation rejetée n’est jamais réactivable', async () => {
    const { settlementId } = await declare(ADMIN_A, validDeclare())
    await reject(ADMIN_B, { debtId: D1, settlementId, rejectionReason: 'Refusée' })
    await expectError(confirm(ADMIN_B, { debtId: D1, settlementId }), 'SETTLEMENT_NOT_DECLARED')
  })

  it('[RJ-05] motif trop court → refus', async () => {
    const { settlementId } = await declare(ADMIN_A, validDeclare())
    await expectError(
      reject(ADMIN_B, { debtId: D1, settlementId, rejectionReason: 'no' }),
      'INVALID_REJECTION_REASON',
    )
  })

  it('[RJ-06] audit chez la créancière de D1', async () => {
    const { settlementId } = await declare(ADMIN_A, validDeclare())
    await reject(ADMIN_B, { debtId: D1, settlementId, rejectionReason: 'Refusée' })
    const entry = (await auditsOf(STORE_B)).find((l) => l.action === 'INTERNAL_DEBT_COMPENSATION_REJECTED')
    expect(entry.rejectionReason).toBe('Refusée')
    expect(entry.oppositeDebtId).toBe(D2)
  })
})

// ═════════════════════════════════════════════════════════════════════════════

describe('TC-115-IV — invariants', () => {
  it('[IV-01] l’invariant des deux dettes tient après compensation', async () => {
    const { settlementId } = await declare(ADMIN_A, validDeclare())
    await confirm(ADMIN_B, { debtId: D1, settlementId })
    for (const id of [D1, D2]) {
      const d = await getDebt(id)
      expect(d.settledAmount + d.remainingAmount).toBe(d.originalAmount)
    }
  })

  it('[IV-02] compensations successives : une seule cible à la fois', async () => {
    // Limite connue et assumée : on compense contre UNE dette opposée par tranche.
    const first = await declare(ADMIN_A, validDeclare({ amount: 6000, idempotencyKey: 'k1' }))
    await confirm(ADMIN_B, { debtId: D1, settlementId: first.settlementId })
    const second = await declare(ADMIN_A, validDeclare({ amount: 6000, idempotencyKey: 'k2' }))
    await confirm(ADMIN_B, { debtId: D1, settlementId: second.settlementId })

    expect((await getDebt(D1)).remainingAmount).toBe(8000)
    expect((await getDebt(D2)).remainingAmount).toBe(0)
    expect((await getDebt(D2)).status).toBe('settled')
    expect(await slicesOf(D2)).toHaveLength(2) // deux miroirs
  })

  it('[IV-03] compensation et règlement cohabitent sur la même dette', async () => {
    const comp = await declare(ADMIN_A, validDeclare({ amount: 12000, idempotencyKey: 'k1' }))
    await confirm(ADMIN_B, { debtId: D1, settlementId: comp.settlementId })

    // Reste 8 000 sur D1, réglés en Cash.
    await db.doc(`internalDebts/${D1}/settlements/dst_${D1}_${ADMIN_A}_c`).set({
      debtId: D1, debtorStoreId: STORE_A, creditorStoreId: STORE_B,
      amount: 8000, method: 'Cash', settlementStatus: 'declared',
      idempotencyKey: 'c', declaredBy: ADMIN_A, declaredAt: new Date(),
    })
    await confirmInternalDebtSettlementHandler(
      makeRequest(ADMIN_B, { debtId: D1, settlementId: `dst_${D1}_${ADMIN_A}_c` }), deps(),
    )

    const d1 = await getDebt(D1)
    expect(d1.remainingAmount).toBe(0)
    expect(d1.status).toBe('settled')
    expect(d1.settledAmount).toBe(20000)
  })
})
