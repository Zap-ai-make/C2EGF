import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { storeTransactionCommandHandler } from '../../functions/src/storeTransactions/storeTransactionCommand.js'

/**
 * TC-404 — `updateStoreSettings` : la boutique coche ou décoche elle-même
 * l'option des transferts d'argent
 * (docs/superpowers/specs/2026-11-23-transferts-argent-design.md, « L'option de
 * la boutique »). Écrite par le serveur, jamais par la file d'envoi ; journal
 * avec l'avant et l'après.
 */

let app
let db
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
const A = { uid: 'rg-gerant-a', store: 'rg-boutique-a' }
const B = { uid: 'rg-gerant-b', store: 'rg-boutique-b' }

beforeAll(() => {
  if (PROJECT !== 'demo-akayis-test' || !/^(127\.0\.0\.1|localhost):\d+$/.test(HOST || '')) throw new Error('Émulateur demo requis')
  app = getApps().length ? getApps()[0] : initializeApp({ projectId: PROJECT })
  db = getFirestore(app)
})
afterAll(async () => { await deleteApp(app) })
beforeEach(async () => {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  for (const { uid, store } of [A, B]) {
    await db.doc(`users/${uid}`).set({ role: 'store_admin', active: true, storeId: store, name: 'Awa', email: `${uid}@c2egf.test` })
    await db.doc(`stores/${store}`).set({ active: true, name: store, adminUid: uid })
  }
  // A seule a des soldes : B, toute neuve, doit pouvoir régler quand même.
  await db.doc(`clients/${A.store}/networkBalances/current`).set({ balances: { Orange: { stock: 0, liquidite: 0 } } })
})

const call = (uid, data) => storeTransactionCommandHandler({ auth: { uid }, data }, { db, FieldValue, logWriter: () => {} })
const journaux = async (store) => (await db.collection(`clients/${store}/auditLogs`).where('action', '==', 'updateStoreSettings').get()).docs.map(d => d.data())

describe('TC-404 — updateStoreSettings', () => {
  it('[TC-404-01] coche puis décoche : la fiche suit, l’autre boutique n’est pas touchée, deux journaux', async () => {
    expect(await call(A.uid, { action: 'updateStoreSettings', transfertsArgent: true })).toEqual({ transfertsArgent: true })
    expect((await db.doc(`stores/${A.store}`).get()).data().transfertsArgent).toBe(true)
    expect((await db.doc(`stores/${A.store}`).get()).data().reglagesModifiesLe).toBeDefined()
    expect(await call(A.uid, { action: 'updateStoreSettings', transfertsArgent: false })).toEqual({ transfertsArgent: false })
    expect((await db.doc(`stores/${A.store}`).get()).data().transfertsArgent).toBe(false)
    expect((await db.doc(`stores/${B.store}`).get()).data().transfertsArgent).toBeUndefined()
    const lus = await journaux(A.store)
    expect(lus.map(j => [j.avant, j.apres])).toEqual(expect.arrayContaining([
      [{ transfertsArgent: false }, { transfertsArgent: true }],
      [{ transfertsArgent: true }, { transfertsArgent: false }],
    ]))
    expect(lus).toHaveLength(2)
  })

  it('[TC-404-02] même valeur : inchangé, aucun journal', async () => {
    expect(await call(A.uid, { action: 'updateStoreSettings', transfertsArgent: false })).toEqual({ transfertsArgent: false, inchange: true })
    expect(await journaux(A.store)).toHaveLength(0)
  })

  it('[TC-404-03] une valeur non booléenne est refusée', async () => {
    const erreur = await call(A.uid, { action: 'updateStoreSettings', transfertsArgent: 'oui' }).then(() => null, e => e)
    expect(erreur?.code).toBe('STORE_TRANSACTION_INVALID')
    expect(erreur.message).toBe('Réglage invalide.')
  })

  it('[TC-404-04] un compte qui n’est pas la boutique est refusé', async () => {
    await db.doc(`users/${A.uid}`).update({ role: 'member' })
    const erreur = await call(A.uid, { action: 'updateStoreSettings', transfertsArgent: true }).then(() => null, e => e)
    expect(erreur?.code).toBe('ROLE_FORBIDDEN')
    expect(erreur.message).toBe('Seul le compte boutique modifie ses réglages.')
  })

  it('[TC-404-05] une boutique sans soldes règle quand même', async () => {
    expect(await call(B.uid, { action: 'updateStoreSettings', transfertsArgent: true })).toEqual({ transfertsArgent: true })
  })
})
