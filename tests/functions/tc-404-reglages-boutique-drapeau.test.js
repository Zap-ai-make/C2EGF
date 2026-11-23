import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

/**
 * TC-404-06 — drapeau de profil éteint : la case n'existe pas et le serveur
 * refuse le réglage. Fichier à part : `vi.mock` vaut pour tout le fichier.
 */
vi.mock('../../functions/src/config/storeProfile.js', async (original) => ({
  ...(await original()),
  MONEY_TRANSFER_ENABLED: false,
}))

const { storeTransactionCommandHandler } = await import('../../functions/src/storeTransactions/storeTransactionCommand.js')

let app
let db
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
const UID = 'rg-off-gerant'
const STORE = 'rg-off-boutique'

beforeAll(() => {
  if (PROJECT !== 'demo-akayis-test' || !/^(127\.0\.0\.1|localhost):\d+$/.test(HOST || '')) throw new Error('Émulateur demo requis')
  app = getApps().length ? getApps()[0] : initializeApp({ projectId: PROJECT })
  db = getFirestore(app)
})
afterAll(async () => { await deleteApp(app) })
beforeEach(async () => {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await db.doc(`users/${UID}`).set({ role: 'store_admin', active: true, storeId: STORE, name: 'Awa', email: 'awa@c2egf.test' })
  await db.doc(`stores/${STORE}`).set({ active: true, name: 'Boutique RG', adminUid: UID })
})

describe('TC-404 — drapeau éteint', () => {
  it('[TC-404-06] le réglage est refusé', async () => {
    const erreur = await storeTransactionCommandHandler(
      { auth: { uid: UID }, data: { action: 'updateStoreSettings', transfertsArgent: true } },
      { db, FieldValue, logWriter: () => {} },
    ).then(() => null, e => e)
    expect(erreur?.code).toBe('STORE_TRANSACTION_INVALID')
    expect(erreur.message).toBe('Les transferts d’argent sont désactivés.')
    expect((await db.doc(`stores/${STORE}`).get()).data().transfertsArgent).toBeUndefined()
  })
})
