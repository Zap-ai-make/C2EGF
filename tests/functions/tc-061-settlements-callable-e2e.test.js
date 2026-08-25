/**
 * TC-061 — Tests HTTP callable E2E pour addTransactionPayment et addTransactionRefund.
 *
 * Appelle les Cloud Functions via httpsCallable depuis le SDK client,
 * exactement comme le ferait le navigateur.
 *
 * Prérequis :
 *   npm run test:functions:e2e
 *   (firebase emulators:exec --only auth,firestore,functions --project demo-akayis-test)
 *
 * Émulateurs requis : Auth 9099 · Firestore 8080 · Functions 5001
 * Projet exclusif  : demo-akayis-test
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest'

// Admin SDK
import { initializeApp as initAdminApp, getApps as getAdminApps, deleteApp as deleteAdminApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getAuth as getAdminAuth } from 'firebase-admin/auth'

// Client SDK
import { initializeApp as initClientApp, getApps as getClientApps, deleteApp as deleteClientApp } from 'firebase/app'
import { getAuth as getClientAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { getFirestore as getClientFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions'

// ─────────────────────────────────────────────────────────────────────────────
// Garde anti-production
// ─────────────────────────────────────────────────────────────────────────────

const PROJECT_ID     = process.env.GCLOUD_PROJECT
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST
const AUTH_HOST      = process.env.FIREBASE_AUTH_EMULATOR_HOST

if (!FIRESTORE_HOST) throw new Error('SÉCURITÉ : FIRESTORE_EMULATOR_HOST non défini. Lancer via npm run test:functions:e2e')
if (!AUTH_HOST)      throw new Error('SÉCURITÉ : FIREBASE_AUTH_EMULATOR_HOST non défini. Lancer via npm run test:functions:e2e')
if (!PROJECT_ID)     throw new Error('SÉCURITÉ : GCLOUD_PROJECT non défini.')
if (!PROJECT_ID.startsWith('demo-')) throw new Error(`SÉCURITÉ : GCLOUD_PROJECT non-demo : "${PROJECT_ID}"`)
if (PROJECT_ID !== 'demo-akayis-test') throw new Error(`SÉCURITÉ : GCLOUD_PROJECT doit être "demo-akayis-test". Reçu : "${PROJECT_ID}"`)

// ─────────────────────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────────────────────

const ADMIN_UID   = 'e2e-admin-061'
const STORE_ID    = 'store-e2e-061'
const DRAFT_ID    = 'draft-e2e-061'

const ADMIN_EMAIL    = 'admin061@e2e.test'
const ADMIN_PASSWORD = 'test-pass-061'

const ADMIN_PROFILE = {
  role:      'store_admin',
  active:    true,
  storeId:   STORE_ID,
  name:      'Admin E2E 061',
  email:     ADMIN_EMAIL,
}

const BASE_DRAFT = {
  type:     'Dépôt',
  montant:  10000,
  clientId: 'client-e2e-061',
  reseau:   'Orange',
  statut:   'Non Terminées',
  date:     '01/01/2026',
}

const INITIAL_BALANCES = {
  balances: {
    Orange:   { stock: 100000, liquidite: 50000 },
    Moov:     { stock: 20000,  liquidite: 10000 },
    Telecel:  { stock: 5000,   liquidite: 2000  },
    Coris:    { stock: 2000,   liquidite: 500   },
    Sank:     { stock: 1000,   liquidite: 200   },
  },
  updatedAt: FieldValue.serverTimestamp(),
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

let adminApp, adminDb, adminAuth
let clientApp, clientAuth, clientFunctions
let callPayment, callRefund

beforeAll(() => {
  if (getAdminApps().length === 0) adminApp = initAdminApp({ projectId: PROJECT_ID })
  else adminApp = getAdminApps()[0]
  adminDb   = getFirestore(adminApp)
  adminAuth = getAdminAuth(adminApp)

  const clientAppName = 'e2e-settlements-client-061'
  clientApp = getClientApps().find(a => a.name === clientAppName)
    ?? initClientApp({
        apiKey: 'demo-key',
        authDomain: `${PROJECT_ID}.firebaseapp.com`,
        projectId: PROJECT_ID,
      }, clientAppName)

  clientAuth      = getClientAuth(clientApp)
  const clientFs  = getClientFirestore(clientApp)
  clientFunctions = getFunctions(clientApp, 'europe-west1')

  connectAuthEmulator(clientAuth, `http://${AUTH_HOST}`, { disableWarnings: true })
  connectFirestoreEmulator(clientFs, 'localhost', 8080)
  connectFunctionsEmulator(clientFunctions, 'localhost', 5001)

  callPayment = httpsCallable(clientFunctions, 'addTransactionPayment')
  callRefund  = httpsCallable(clientFunctions, 'addTransactionRefund')
})

afterAll(async () => {
  if (clientApp) try { await deleteClientApp(clientApp) } catch { /* ignoré */ }
  if (adminApp)  try { await deleteAdminApp(adminApp) } catch { /* ignoré */ }
})

async function clearFirestore() {
  const url = `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`
  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Clear Firestore: ${res.status}`)
}

async function clearAuth() {
  const url = `http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`
  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok && res.status !== 404) throw new Error(`Clear Auth: ${res.status}`)
}

async function seed() {
  await adminAuth.createUser({ uid: ADMIN_UID, email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  await adminDb.doc(`users/${ADMIN_UID}`).set(ADMIN_PROFILE)
  await adminDb.doc(`clients/${STORE_ID}/drafts/${DRAFT_ID}`).set(BASE_DRAFT)
  await adminDb.doc(`clients/${STORE_ID}/networkBalances/current`).set(INITIAL_BALANCES)
}

beforeEach(async () => {
  await signOut(clientAuth).catch(() => {})
  await clearFirestore()
  await clearAuth()
  await seed()
  await signInWithEmailAndPassword(clientAuth, ADMIN_EMAIL, ADMIN_PASSWORD)
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-061-PAY — addTransactionPayment
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-061-PAY — addTransactionPayment', () => {
  it('paiement complet : draft → history, draft supprimé, balances mises à jour', async () => {
    const res = await callPayment({
      draftId: DRAFT_ID, amount: 10000, paymentMethod: 'Orange Money', idempotencyKey: 'e2e-full-1',
    })

    expect(res.data.success).toBe(true)
    expect(res.data.fullySettled).toBe(true)

    // Draft supprimé
    const draftSnap = await adminDb.doc(`clients/${STORE_ID}/drafts/${DRAFT_ID}`).get()
    expect(draftSnap.exists).toBe(false)

    // History créé
    const historySnap = await adminDb.collection(`clients/${STORE_ID}/history`).get()
    expect(historySnap.size).toBe(1)
    const h = historySnap.docs[0].data()
    expect(h.statut).toBe('Encaissé par Orange Money')
    expect(h.settlementStatus).toBe('settled')
    expect(h.remainingAmount).toBe(0)
    expect(h.paidAmount).toBe(10000)

    // Solde Orange stock augmenté de 10000
    const balSnap = await adminDb.doc(`clients/${STORE_ID}/networkBalances/current`).get()
    expect(balSnap.data().balances.Orange.stock).toBe(110000)
  })

  it('paiement partiel : draft mis à jour, pas de history', async () => {
    const res = await callPayment({
      draftId: DRAFT_ID, amount: 4000, paymentMethod: 'Orange Money', idempotencyKey: 'e2e-partial-1',
    })

    expect(res.data.success).toBe(true)
    expect(res.data.fullySettled).toBe(false)

    // Draft toujours présent avec champs mis à jour
    const draftSnap = await adminDb.doc(`clients/${STORE_ID}/drafts/${DRAFT_ID}`).get()
    expect(draftSnap.exists).toBe(true)
    const d = draftSnap.data()
    expect(d.paidAmount).toBe(4000)
    expect(d.remainingAmount).toBe(6000)
    expect(d.settlementStatus).toBe('partial')

    // Settlement doc créé
    const sSnap = await adminDb.collection(`clients/${STORE_ID}/drafts/${DRAFT_ID}/settlements`).get()
    expect(sSnap.size).toBe(1)
    expect(sSnap.docs[0].data().type).toBe('payment')
    expect(sSnap.docs[0].data().amount).toBe(4000)

    // Pas d'history
    const hSnap = await adminDb.collection(`clients/${STORE_ID}/history`).get()
    expect(hSnap.size).toBe(0)
  })

  it('idempotence : double appel même clé → idempotent:true, 1 seul settlement', async () => {
    await callPayment({ draftId: DRAFT_ID, amount: 4000, paymentMethod: 'Orange Money', idempotencyKey: 'e2e-idem-1' })
    const res2 = await callPayment({ draftId: DRAFT_ID, amount: 4000, paymentMethod: 'Orange Money', idempotencyKey: 'e2e-idem-1' })

    expect(res2.data.idempotent).toBe(true)

    const sSnap = await adminDb.collection(`clients/${STORE_ID}/drafts/${DRAFT_ID}/settlements`).get()
    expect(sSnap.size).toBe(1)
  })

  it('rejette si montant dépasse le reste dû (après paiement partiel)', async () => {
    await callPayment({ draftId: DRAFT_ID, amount: 7000, paymentMethod: 'Orange Money', idempotencyKey: 'e2e-over-1' })

    await expect(
      callPayment({ draftId: DRAFT_ID, amount: 5000, paymentMethod: 'Orange Money', idempotencyKey: 'e2e-over-2' })
    ).rejects.toMatchObject({ code: 'functions/failed-precondition' })
  })

  it('non authentifié → functions/unauthenticated', async () => {
    await signOut(clientAuth)
    await expect(
      callPayment({ draftId: DRAFT_ID, amount: 5000, paymentMethod: 'Cash', idempotencyKey: 'e2e-anon-1' })
    ).rejects.toMatchObject({ code: 'functions/unauthenticated' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-061-REF — addTransactionRefund
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-061-REF — addTransactionRefund', () => {
  it('remboursement après paiement partiel : draft mis à jour, remaining augmenté', async () => {
    // D'abord payer 7000
    await callPayment({ draftId: DRAFT_ID, amount: 7000, paymentMethod: 'Cash', idempotencyKey: 'ref-prep-1' })

    // Puis rembourser 2000
    const res = await callRefund({
      draftId: DRAFT_ID, amount: 2000, paymentMethod: 'Cash', idempotencyKey: 'ref-1',
    })

    expect(res.data.success).toBe(true)

    const draftSnap = await adminDb.doc(`clients/${STORE_ID}/drafts/${DRAFT_ID}`).get()
    const d = draftSnap.data()
    expect(d.refundedAmount).toBe(2000)
    expect(d.remainingAmount).toBe(5000) // 3000 (avant remb) + 2000 = 5000
    expect(d.settlementStatus).toBe('partial')

    // Settlement de type refund créé
    const sSnap = await adminDb.collection(`clients/${STORE_ID}/drafts/${DRAFT_ID}/settlements`).get()
    const refundDocs = sSnap.docs.filter(d => d.data().type === 'refund')
    expect(refundDocs).toHaveLength(1)
    expect(refundDocs[0].data().amount).toBe(2000)
  })

  it('rejette si aucun paiement net (rien à rembourser)', async () => {
    await expect(
      callRefund({ draftId: DRAFT_ID, amount: 1000, paymentMethod: 'Cash', idempotencyKey: 'ref-nopay-1' })
    ).rejects.toMatchObject({ code: 'functions/failed-precondition' })
  })

  it('rejette si remboursement > net payé', async () => {
    await callPayment({ draftId: DRAFT_ID, amount: 3000, paymentMethod: 'Cash', idempotencyKey: 'ref-over-prep' })

    await expect(
      callRefund({ draftId: DRAFT_ID, amount: 5000, paymentMethod: 'Cash', idempotencyKey: 'ref-over-1' })
    ).rejects.toMatchObject({ code: 'functions/failed-precondition' })
  })

  it('idempotence remboursement : même clé → idempotent:true', async () => {
    await callPayment({ draftId: DRAFT_ID, amount: 5000, paymentMethod: 'Cash', idempotencyKey: 'ref-idem-prep' })
    await callRefund({ draftId: DRAFT_ID, amount: 1000, paymentMethod: 'Cash', idempotencyKey: 'ref-idem-1' })
    const res2 = await callRefund({ draftId: DRAFT_ID, amount: 1000, paymentMethod: 'Cash', idempotencyKey: 'ref-idem-1' })

    expect(res2.data.idempotent).toBe(true)

    const sSnap = await adminDb.collection(`clients/${STORE_ID}/drafts/${DRAFT_ID}/settlements`).get()
    const refunds = sSnap.docs.filter(d => d.data().type === 'refund')
    expect(refunds).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-061-CONF — IDEMPOTENCY_CONFLICT : même clé + payload différent
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-061-CONF — IDEMPOTENCY_CONFLICT', () => {
  it('même clé + montant différent → functions/failed-precondition', async () => {
    await callPayment({ draftId: DRAFT_ID, amount: 3000, paymentMethod: 'Cash', idempotencyKey: 'conf-key-1' })

    await expect(
      callPayment({ draftId: DRAFT_ID, amount: 9000, paymentMethod: 'Cash', idempotencyKey: 'conf-key-1' })
    ).rejects.toMatchObject({ code: 'functions/failed-precondition' })
  })

  it('même clé + méthode différente → functions/failed-precondition', async () => {
    await callPayment({ draftId: DRAFT_ID, amount: 3000, paymentMethod: 'Cash', idempotencyKey: 'conf-key-2' })

    await expect(
      callPayment({ draftId: DRAFT_ID, amount: 3000, paymentMethod: 'Orange Money', idempotencyKey: 'conf-key-2' })
    ).rejects.toMatchObject({ code: 'functions/failed-precondition' })
  })

  it('refund : même clé + montant différent → functions/failed-precondition', async () => {
    await callPayment({ draftId: DRAFT_ID, amount: 7000, paymentMethod: 'Cash', idempotencyKey: 'conf-prep' })
    await callRefund({ draftId: DRAFT_ID, amount: 1000, paymentMethod: 'Cash', idempotencyKey: 'conf-ref-key' })

    await expect(
      callRefund({ draftId: DRAFT_ID, amount: 2000, paymentMethod: 'Cash', idempotencyKey: 'conf-ref-key' })
    ).rejects.toMatchObject({ code: 'functions/failed-precondition' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-061-CONC — Concurrence réelle : Promise.all
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-061-CONC — Concurrence réelle (Promise.all)', () => {
  it('deux paiements partiels simultanés avec clés distinctes → un seul réussit ou les deux réussissent sans incohérence', async () => {
    // Les deux appels simultanés ciblent le même draft.
    // Firestore runTransaction guarantit l'atomicité : l'un des deux peut échouer si le
    // contention est détecté, ou les deux réussissent si les montants cumulés ne dépassent pas montant.
    const [res1, res2] = await Promise.allSettled([
      callPayment({ draftId: DRAFT_ID, amount: 3000, paymentMethod: 'Cash', idempotencyKey: 'conc-a' }),
      callPayment({ draftId: DRAFT_ID, amount: 4000, paymentMethod: 'Orange Money', idempotencyKey: 'conc-b' }),
    ])

    // Au moins l'un doit réussir
    const succeeded = [res1, res2].filter(r => r.status === 'fulfilled')
    expect(succeeded.length).toBeGreaterThanOrEqual(1)

    // L'état Firestore doit être cohérent : paidAmount = somme des succès
    const draftSnap = await adminDb.doc(`clients/${STORE_ID}/drafts/${DRAFT_ID}`).get()
    if (draftSnap.exists) {
      const d = draftSnap.data()
      const paidAmount     = d.paidAmount     ?? 0
      const remainingAmount = d.remainingAmount ?? d.montant
      const originalAmount  = d.originalAmount  ?? d.montant
      // Invariant fondamental : paid + remaining == original (+ refunded)
      expect(paidAmount + remainingAmount).toBe(originalAmount + (d.refundedAmount ?? 0))
      expect(paidAmount).toBeGreaterThan(0)
    }
    // Si draft n'existe plus → paiement complet (deux tranches = 7000 < 10000, improbable mais possible si montant=7000)
  })

  it('même clé envoyée en double simultanément → idempotent ou exactement une écriture', async () => {
    // Simule un double-clic ou un retry réseau simultané
    const [r1, r2] = await Promise.allSettled([
      callPayment({ draftId: DRAFT_ID, amount: 5000, paymentMethod: 'Cash', idempotencyKey: 'conc-same-key' }),
      callPayment({ draftId: DRAFT_ID, amount: 5000, paymentMethod: 'Cash', idempotencyKey: 'conc-same-key' }),
    ])

    // Les deux doivent avoir soit réussi (idempotent ou non) soit l'un a échoué proprement
    const results = [r1, r2].map(r => r.status)
    // Au moins un fulfilled
    expect(results).toContain('fulfilled')

    // 1 seul settlement doit exister pour cette clé
    const sSnap = await adminDb.collection(`clients/${STORE_ID}/drafts/${DRAFT_ID}/settlements`).get()
    const matching = sSnap.docs.filter(d => d.data().idempotencyKey === 'conc-same-key')
    expect(matching).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-061-HIST — Paiement complet : settlement copié sous history
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-061-HIST — Paiement complet : persistence dual history/settlements', () => {
  it('settlement copié sous history/{historyId}/settlements/ lors du paiement final', async () => {
    const res = await callPayment({
      draftId: DRAFT_ID, amount: 10000, paymentMethod: 'Orange Money', idempotencyKey: 'hist-settle-1',
    })

    expect(res.data.fullySettled).toBe(true)
    const historyId = res.data.historyId
    expect(typeof historyId).toBe('string')

    // Le settlement doit exister sous history
    const hSettleSnap = await adminDb
      .collection(`clients/${STORE_ID}/history/${historyId}/settlements`)
      .get()
    expect(hSettleSnap.size).toBeGreaterThanOrEqual(1)

    const settlementDoc = hSettleSnap.docs[0].data()
    expect(settlementDoc.type).toBe('payment')
    expect(settlementDoc.amount).toBe(10000)
    expect(settlementDoc.fullySettled).toBe(true)
    expect(settlementDoc.historyId).toBe(historyId)

    // settlementSummary doit être présent sur le doc history
    const histSnap = await adminDb.doc(`clients/${STORE_ID}/history/${historyId}`).get()
    const h = histSnap.data()
    expect(h.settlementSummary).toBeDefined()
    expect(h.settlementSummary.netByNetwork).toBeDefined()
    expect(h.settlementSummary.totalPaid).toBe(10000)
  })
})
