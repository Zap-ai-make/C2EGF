import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

/**
 * TC-405-16 — drapeau éteint, les quatre commandes des transferts d'argent
 * refusent. Fichier à part : `vi.mock` vaut pour tout le fichier.
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
const UID = 'ta-off-gerant'
const STORE = 'ta-off-boutique'

beforeAll(() => {
  if (PROJECT !== 'demo-akayis-test' || !/^(127\.0\.0\.1|localhost):\d+$/.test(HOST || '')) throw new Error('Émulateur demo requis')
  app = getApps().length ? getApps()[0] : initializeApp({ projectId: PROJECT })
  db = getFirestore(app)
})
afterAll(async () => { await deleteApp(app) })
beforeEach(async () => {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await db.doc(`users/${UID}`).set({ role: 'store_admin', active: true, storeId: STORE, name: 'Awa', email: 'awa@c2egf.test' })
  await db.doc(`stores/${STORE}`).set({ active: true, name: 'Boutique TA', adminUid: UID, transfertsArgent: true })
  await db.doc(`clients/${STORE}/networkBalances/current`).set({ balances: { Orange: { stock: 300_000, liquidite: 200_000 } } })
  await db.doc(`clients/${STORE}/drafts/ta-1`).set({
    type: 'Transfert argent', service: 'Ria', operation: 'transfert', nomClient: 'DIALLO Awa', balanceType: 'stock',
    montant: 50_000, montantTraite: 0, resteATraiter: 50_000, tranches: [], reseau: 'Orange', statut: 'Non Terminées', storeId: STORE,
  })
})

const call = data => storeTransactionCommandHandler({ auth: { uid: UID }, data }, { db, FieldValue, logWriter: () => {} })

describe('TC-405 — drapeau éteint', () => {
  it('[TC-405-16] les quatre commandes refusent', async () => {
    const commandes = [
      { action: 'addMoneyTransfer', transaction: { service: 'Ria', operation: 'transfert', nomClient: 'X', montant: 1_000, balanceType: 'stock' } },
      { action: 'settleMoneyTransfer', draftId: 'ta-1', amount: 10_000 },
      { action: 'updateMoneyTransfer', draftId: 'ta-1', updates: { montant: 40_000 } },
      { action: 'trashMoneyTransfer', draftId: 'ta-1' },
    ]
    for (const commande of commandes) {
      const erreur = await call(commande).then(() => null, e => e)
      expect(erreur?.code, commande.action).toBe('STORE_TRANSACTION_INVALID')
      expect(erreur.message, commande.action).toBe('Les transferts d’argent sont désactivés.')
    }
    expect((await db.doc(`clients/${STORE}/networkBalances/current`).get()).data().balances.Orange).toEqual({ stock: 300_000, liquidite: 200_000 })
  })
})
