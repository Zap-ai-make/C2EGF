import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { storeTransactionCommandHandler } from '../../functions/src/storeTransactions/storeTransactionCommand.js'

/**
 * TC-217 — Vider les soldes (clôture de journée).
 *
 * La boutique repart de zéro chaque matin. Vider sans trace ferait disparaître
 * de l'argent des livres : la clôture écrit d'abord ce qu'elle solde, puis
 * remet à zéro. Le serveur solde CE QU'IL LIT — aucun montant ne vient du
 * navigateur.
 */

let app
let db
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
const UID = 'store-closeday-admin'
const STORE = 'store-closeday-a'
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
  await db.doc(`clients/${STORE}/networkBalances/current`).set({ balances: { Orange: { stock: 600_066, liquidite: 401_934 } } })
})

const call = data => storeTransactionCommandHandler(request(data), { db, FieldValue, logWriter: () => {} })
const soldes = async () => (await db.doc(`clients/${STORE}/networkBalances/current`).get()).data().balances.Orange

describe('TC-217 — vider les soldes', () => {
  it('écrit la clôture puis remet les deux réserves à zéro', async () => {
    const result = await call({ action: 'closeDay' })

    expect(await soldes()).toEqual({ stock: 0, liquidite: 0 })

    const entree = (await db.doc(`clients/${STORE}/history/${result.id}`).get()).data()
    expect(entree).toMatchObject({
      type: 'Clôture',
      reseau: 'Orange',
      stockSolde: 600_066,
      liquiditeSoldee: 401_934,
      montant: 1_002_000,
      statut: 'Validée',
      storeId: STORE,
      operatorId: UID,
    })
  })

  it('journalise les soldes avant et après', async () => {
    await call({ action: 'closeDay' })
    const audits = await db.collection(`clients/${STORE}/auditLogs`).get()
    expect(audits.size).toBe(1)
    expect(audits.docs[0].data()).toMatchObject({
      action: 'closeDay',
      uid: UID,
      beforeBalances: { Orange: { stock: 600_066, liquidite: 401_934 } },
      afterBalances: { Orange: { stock: 0, liquidite: 0 } },
    })
  })

  it('refuse une clôture quand tout est déjà à zéro', async () => {
    await call({ action: 'closeDay' })
    await expect(call({ action: 'closeDay' })).rejects.toMatchObject({ code: 'STORE_TRANSACTION_INVALID' })
    expect((await db.collection(`clients/${STORE}/history`).get()).size).toBe(1)
    expect((await db.collection(`clients/${STORE}/auditLogs`).get()).size).toBe(1)
  })

  it('solde une seule réserve quand l’autre est déjà vide', async () => {
    await db.doc(`clients/${STORE}/networkBalances/current`).set({ balances: { Orange: { stock: 0, liquidite: 5_000 } } })
    const result = await call({ action: 'closeDay' })
    expect(await soldes()).toEqual({ stock: 0, liquidite: 0 })
    expect((await db.doc(`clients/${STORE}/history/${result.id}`).get()).data()).toMatchObject({
      stockSolde: 0,
      liquiditeSoldee: 5_000,
      montant: 5_000,
    })
  })

  it('ignore tout montant soufflé par le client', async () => {
    await expect(call({ action: 'closeDay', amount: 1 })).resolves.toMatchObject({ montant: 1_002_000 })
  })

  it('refuse l’annulation d’une clôture depuis l’historique', async () => {
    const result = await call({ action: 'closeDay' })
    await expect(call({ action: 'cancelHistory', historyId: result.id })).rejects.toMatchObject({ code: 'STORE_TRANSACTION_INVALID' })
    expect(await soldes()).toEqual({ stock: 0, liquidite: 0 })
  })
})
