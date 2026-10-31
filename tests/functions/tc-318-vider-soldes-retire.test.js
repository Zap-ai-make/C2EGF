import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { storeTransactionCommandHandler } from '../../functions/src/storeTransactions/storeTransactionCommand.js'

/**
 * TC-318 — « Vider les soldes » est retiré, jusqu'au serveur.
 *
 * Retiré le 31 octobre 2026 à la demande du responsable, avec toute sa
 * logique : `closeDay` (vider) et `cancelClosure` (défaire une clôture du
 * jour). Un navigateur resté sur une ancienne version ne doit plus pouvoir
 * vider une caisse : le serveur refuse, et RIEN ne bouge.
 *
 * Les clôtures déjà écrites restent dans l'historique. Aucune commande
 * générique ne doit les défaire : le type reste dans UNCANCELLABLE_TYPES.
 *
 * Remplace TC-217 (vider) et TC-244 (annuler une clôture), qui figeaient le
 * geste retiré.
 */

let app
let db
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
const UID = 'store-318-admin'
const STORE = 'store-318'
const SOLDES = { Orange: { stock: 600_066, liquidite: 401_934 } }

beforeAll(() => {
  if (PROJECT !== 'demo-akayis-test' || !/^(127\.0\.0\.1|localhost):\d+$/.test(HOST || '')) throw new Error('Émulateur demo requis')
  app = getApps().length ? getApps()[0] : initializeApp({ projectId: PROJECT })
  db = getFirestore(app)
})
afterAll(async () => { await deleteApp(app) })
beforeEach(async () => {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await db.doc(`users/${UID}`).set({ role: 'store_admin', active: true, storeId: STORE, name: 'Gérant', email: 'g@c2egf.test' })
  await db.doc(`stores/${STORE}`).set({ active: true, name: 'Boutique 318', adminUid: UID })
  await db.doc(`clients/${STORE}/networkBalances/current`).set({ balances: SOLDES })
})

const call = (data) => storeTransactionCommandHandler({ auth: { uid: UID }, data }, { db, FieldValue, logWriter: () => {} })
const soldes = async () => (await db.doc(`clients/${STORE}/networkBalances/current`).get()).data().balances
const nombre = async (collection) => (await db.collection(`clients/${STORE}/${collection}`).get()).size

/** Une clôture écrite avant le retrait, telle que `closeDay` la laissait. */
const ancienneCloture = async (over = {}) => {
  const ref = db.collection(`clients/${STORE}/history`).doc()
  await ref.set({
    type: 'Clôture',
    montant: 870_500,
    reseau: 'Orange',
    soldes: [{ network: 'Orange', stock: 500_000, liquidite: 370_500 }],
    statut: 'Validée',
    storeId: STORE,
    date: '30/10/2026',
    createdAt: FieldValue.serverTimestamp(),
    validatedAt: FieldValue.serverTimestamp(),
    ...over,
  })
  return ref.id
}

describe('TC-318 — les deux commandes n’existent plus', () => {
  it('[TC-318-1] vider les soldes est refusé, et la caisse ne bouge pas', async () => {
    await expect(call({ action: 'closeDay' })).rejects.toMatchObject({ code: 'STORE_TRANSACTION_INVALID', message: 'Commande inconnue.' })
    expect(await soldes()).toEqual(SOLDES)
    expect(await nombre('history')).toBe(0)
    expect(await nombre('auditLogs')).toBe(0)
  })

  it('[TC-318-2] défaire une clôture est refusé, même sur une clôture du jour', async () => {
    const historyId = await ancienneCloture()
    await expect(call({ action: 'cancelClosure', historyId })).rejects.toMatchObject({ message: 'Commande inconnue.' })
    expect(await soldes()).toEqual(SOLDES)
    expect((await db.doc(`clients/${STORE}/history/${historyId}`).get()).data().statut).toBe('Validée')
  })
})

describe('TC-318 — une ancienne clôture reste intouchable', () => {
  it.each(['cancelHistory', 'trashHistory', 'reopenHistory'])(
    '[TC-318-3] %s la refuse, et rien ne bouge',
    async (action) => {
      const historyId = await ancienneCloture()
      await expect(call({ action, historyId })).rejects.toMatchObject({ code: 'STORE_TRANSACTION_INVALID' })
      expect(await soldes()).toEqual(SOLDES)
      expect((await db.doc(`clients/${STORE}/history/${historyId}`).get()).data().statut).toBe('Validée')
    },
  )
})
