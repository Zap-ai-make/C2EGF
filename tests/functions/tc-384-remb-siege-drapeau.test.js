import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

/**
 * TC-384-21 — drapeau éteint, les quatre commandes du remboursement au siège
 * refusent. Fichier à part : `vi.mock` vaut pour tout le fichier, et
 * éteindrait le drapeau pour les autres tests de TC-384.
 */
vi.mock('../../functions/src/config/storeProfile.js', async (original) => ({
  ...(await original()),
  SIEGE_REPAYMENT_ENABLED: false,
}))

const { storeTransactionCommandHandler } = await import('../../functions/src/storeTransactions/storeTransactionCommand.js')

let app
let db
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
const UID = 'rs-off-gerant'
const STORE = 'rs-off-boutique'

beforeAll(() => {
  if (PROJECT !== 'demo-akayis-test' || !/^(127\.0\.0\.1|localhost):\d+$/.test(HOST || '')) throw new Error('Émulateur demo requis')
  app = getApps().length ? getApps()[0] : initializeApp({ projectId: PROJECT })
  db = getFirestore(app)
})
afterAll(async () => { await deleteApp(app) })
beforeEach(async () => {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await db.doc(`users/${UID}`).set({ role: 'store_admin', active: true, storeId: STORE, name: 'Awa', email: 'awa@c2egf.test' })
  await db.doc(`stores/${STORE}`).set({ active: true, name: 'Boutique RS', adminUid: UID })
  await db.doc(`clients/${STORE}/networkBalances/current`).set({ balances: { Orange: { stock: 500_000, liquidite: 300_000 } } })
  await db.doc(`clients/${STORE}/drafts/rs-1`).set({
    type: 'Remb. siège', balanceType: 'liquidite', montant: 100_000, envoyeAuSiege: 0, resteAuSiege: 100_000,
    envoisSiege: [], reseau: 'Orange', statut: 'Non Terminées', clientId: 'agent-1', storeId: STORE,
  })
})

const call = data => storeTransactionCommandHandler({ auth: { uid: UID }, data }, { db, FieldValue, logWriter: () => {} })

describe('TC-384 — drapeau éteint', () => {
  it('[TC-384-21] les quatre commandes refusent', async () => {
    const commandes = [
      { action: 'addSiegeRepayment', transaction: { clientId: 'agent-1', montant: 100_000, balanceType: 'stock', statut: 'Validée' } },
      { action: 'sendToSiege', draftId: 'rs-1', amount: 10_000 },
      { action: 'updateSiegeRepayment', draftId: 'rs-1', updates: { montant: 90_000 } },
      { action: 'trashSiegeRepayment', draftId: 'rs-1' },
    ]
    for (const commande of commandes) {
      const erreur = await call(commande).then(() => null, e => e)
      expect(erreur?.code, commande.action).toBe('STORE_TRANSACTION_INVALID')
      expect(erreur.message, commande.action).toMatch(/désactivé/)
    }
    expect((await db.doc(`clients/${STORE}/networkBalances/current`).get()).data().balances.Orange).toEqual({ stock: 500_000, liquidite: 300_000 })
  })
})
