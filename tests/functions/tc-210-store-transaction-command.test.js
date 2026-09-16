import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { storeTransactionCommandHandler } from '../../functions/src/storeTransactions/storeTransactionCommand.js'

let app
let db
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
const UID = 'store-command-admin'
const STORE = 'store-command-a'
const request = data => ({ auth: { uid: UID }, data })

beforeAll(() => {
  if (PROJECT !== 'demo-akayis-test' || !/^(127\.0\.0\.1|localhost):\d+$/.test(HOST || '')) throw new Error('Émulateur demo requis')
  app = getApps().length ? getApps()[0] : initializeApp({ projectId: PROJECT })
  db = getFirestore(app)
})
afterAll(async () => { await deleteApp(app) })
beforeEach(async () => {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await db.doc(`users/${UID}`).set({ role: 'store_admin', active: true, storeId: STORE, name: 'Gérant', email: 'g@c2egf.test' })
  await db.doc(`stores/${STORE}`).set({ active: true, name: 'Boutique A', adminUid: UID })
})

const call = data => storeTransactionCommandHandler(request(data), { db, FieldValue, logWriter: () => {} })
const tx = overrides => ({ clientId: 'client-a', type: 'Dépôt', reseau: 'Orange', montant: 100, statut: 'Non Terminées', ...overrides })

describe('SEC-01 — mouvements boutique autoritaires et audités', () => {
  it('initialise une seule fois à zéro et ignore toute valeur client', async () => {
    const result = await call({ action: 'ensureBalances', transaction: { balances: { Orange: { stock: 9_000_000 } } } })
    expect(result.balances.Orange).toEqual({ stock: 0, liquidite: 0 })
    const again = await call({ action: 'ensureBalances' })
    expect(again.balances.Orange).toEqual({ stock: 0, liquidite: 0 })
  })

  it('crée un brouillon, modifie le solde et écrit un audit atomiquement', async () => {
    await db.doc(`clients/${STORE}/networkBalances/current`).set({ balances: { Orange: { stock: 500, liquidite: 20 } } })
    const result = await call({ action: 'add', transaction: tx() })
    expect(result.id).toBeTruthy()
    expect((await db.doc(`clients/${STORE}/networkBalances/current`).get()).data().balances.Orange.stock).toBe(400)
    expect((await db.doc(`clients/${STORE}/drafts/${result.id}`).get()).data()).toMatchObject({ storeId: STORE, operatorId: UID, montant: 100 })
    expect((await db.collection(`clients/${STORE}/auditLogs`).get()).size).toBe(1)
  })

  it('refuse type/réseau hors profil et l’édition arbitraire des soldes', async () => {
    await db.doc(`clients/${STORE}/networkBalances/current`).set({ balances: { Orange: { stock: 500, liquidite: 20 } } })
    await expect(call({ action: 'add', transaction: tx({ type: 'Crédit' }) })).rejects.toMatchObject({ code: 'STORE_TRANSACTION_INVALID' })
    await expect(call({ action: 'add', transaction: tx({ reseau: 'Moov' }) })).rejects.toMatchObject({ code: 'STORE_TRANSACTION_INVALID' })
    await expect(call({ action: 'setBalance', network: 'Orange', balanceType: 'stock', balanceAmount: 9_000_000 })).rejects.toMatchObject({ code: 'BALANCE_EDIT_FORBIDDEN' })
  })

  it('refuse suppression d’un parent réglé et annule un historique une seule fois', async () => {
    await db.doc(`clients/${STORE}/networkBalances/current`).set({ balances: { Orange: { stock: 400, liquidite: 20 } } })
    await db.doc(`clients/${STORE}/drafts/partial`).set({ ...tx(), paidAmount: 40, remainingAmount: 60, settlementStatus: 'partial' })
    await expect(call({ action: 'deleteDraft', draftId: 'partial' })).rejects.toMatchObject({ code: 'SETTLED_DRAFT_IMMUTABLE' })

    await db.doc(`clients/${STORE}/history/h1`).set({ ...tx({ statut: 'Validée' }), validatedAt: new Date() })
    expect((await call({ action: 'cancelHistory', historyId: 'h1' })).cancelled).toBe(true)
    await expect(call({ action: 'cancelHistory', historyId: 'h1' })).rejects.toThrow('déjà annulée')
  })

  it('refuse un token existant dès que la boutique est désactivée', async () => {
    await db.doc(`stores/${STORE}`).update({ active: false })
    await expect(call({ action: 'ensureBalances' })).rejects.toMatchObject({ code: 'STORE_INACTIVE' })
  })

  it('sérialise deux créations concurrentes sans perdre de mouvement', async () => {
    await db.doc(`clients/${STORE}/networkBalances/current`).set({ balances: { Orange: { stock: 200, liquidite: 0 } } })
    await Promise.all([call({ action: 'add', transaction: tx() }), call({ action: 'add', transaction: tx() })])
    expect((await db.doc(`clients/${STORE}/networkBalances/current`).get()).data().balances.Orange.stock).toBe(0)
    expect((await db.collection(`clients/${STORE}/drafts`).get()).size).toBe(2)
    expect((await db.collection(`clients/${STORE}/auditLogs`).get()).size).toBe(2)
  })
})
