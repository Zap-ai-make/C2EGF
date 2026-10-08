import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { storeTransactionCommandHandler } from '../../functions/src/storeTransactions/storeTransactionCommand.js'

/**
 * TC-215 — Le ravitaillement du dealer.
 *
 * C'est la SEULE opération qui fait monter la somme stock + liquidité : une
 * transaction client ne fait que la déplacer d'un vase à l'autre. D'où le soin
 * porté ici à ce que rien ne vienne du client sauf le montant, le vase, la note
 * et l'expéditeur — le réseau, l'auteur et la date sont résolus côté serveur.
 *
 * ⚠ TOUS LES APPELS DE CE FICHIER ONT GAGNÉ UN `expediteur`, ET C'EST VOULU.
 *   S8 rend ce champ obligatoire : l'argent vient de personnes différentes, et
 *   la boutique doit rendre à CHACUNE ce qu'elle a reçu d'elle. Une livraison
 *   sans expéditeur ne peut entrer dans aucune liste groupée par créancier —
 *   elle serait une dette envers personne. Le refus lui-même est figé par
 *   TC-227-2 ; ici on se contente de nourrir les appels.
 *
 *   Le mot « centrale » a quitté ce fichier au passage : au comptoir on dit
 *   « le dealer » (cf. `src/content/aideFiches.js`).
 */

let app
let db
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
const UID = 'store-replenish-admin'
const STORE = 'store-replenish-a'
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
  await db.doc(`clients/${STORE}/networkBalances/current`).set({ balances: { Orange: { stock: 500, liquidite: 20 } } })
})

const call = data => storeTransactionCommandHandler(request(data), { db, FieldValue, logWriter: () => {} })
const soldes = async () => (await db.doc(`clients/${STORE}/networkBalances/current`).get()).data().balances.Orange

describe('TC-215 — ravitaillement boutique', () => {
  it('crédite le stock, écrit l’historique et l’audit atomiquement', async () => {
    const result = await call({ action: 'replenish', expediteur: 'Patron', amount: 300, balanceType: 'stock', note: 'Livraison du matin' })

    expect(await soldes()).toEqual({ stock: 800, liquidite: 20 })

    const entree = (await db.doc(`clients/${STORE}/history/${result.id}`).get()).data()
    expect(entree).toMatchObject({
      type: 'Ravitaillement',
      montant: 300,
      reseau: 'Orange',
      balanceType: 'stock',
      statut: 'Validée',
      note: 'Livraison du matin',
      storeId: STORE,
      operatorId: UID,
    })

    const audits = await db.collection(`clients/${STORE}/auditLogs`).get()
    expect(audits.size).toBe(1)
    expect(audits.docs[0].data()).toMatchObject({
      action: 'replenish',
      expediteur: 'Patron',
      uid: UID,
      beforeBalances: { Orange: { stock: 500, liquidite: 20 } },
      afterBalances: { Orange: { stock: 800, liquidite: 20 } },
    })
  })

  it('crédite la liquidité sans toucher au stock', async () => {
    await call({ action: 'replenish', expediteur: 'Patron', amount: 1_000, balanceType: 'liquidite' })
    expect(await soldes()).toEqual({ stock: 500, liquidite: 1_020 })
  })

  it('accepte l’absence de note et la réduit à une chaîne vide', async () => {
    const result = await call({ action: 'replenish', expediteur: 'Patron', amount: 50, balanceType: 'stock' })
    expect((await db.doc(`clients/${STORE}/history/${result.id}`).get()).data().note).toBe('')
  })

  it('résout le réseau côté serveur et ignore celui envoyé par le client', async () => {
    const result = await call({ action: 'replenish', expediteur: 'Patron', amount: 70, balanceType: 'stock', network: 'Moov' })
    expect((await db.doc(`clients/${STORE}/history/${result.id}`).get()).data().reseau).toBe('Orange')
    expect(await soldes()).toEqual({ stock: 570, liquidite: 20 })
  })

  it('refuse un montant non entier, nul ou négatif', async () => {
    for (const amount of [0, -100, 12.5, '300', null]) {
      await expect(call({ action: 'replenish', expediteur: 'Patron', amount, balanceType: 'stock' })).rejects.toMatchObject({ code: 'STORE_TRANSACTION_INVALID' })
    }
    expect(await soldes()).toEqual({ stock: 500, liquidite: 20 })
  })

  it('refuse un vase inconnu', async () => {
    for (const balanceType of ['dette', '', null, 'STOCK']) {
      await expect(call({ action: 'replenish', expediteur: 'Patron', amount: 100, balanceType })).rejects.toMatchObject({ code: 'STORE_TRANSACTION_INVALID' })
    }
    expect(await soldes()).toEqual({ stock: 500, liquidite: 20 })
  })

  it('refuse une note non textuelle ou démesurée', async () => {
    await expect(call({ action: 'replenish', expediteur: 'Patron', amount: 100, balanceType: 'stock', note: 42 })).rejects.toMatchObject({ code: 'STORE_TRANSACTION_INVALID' })
    await expect(call({ action: 'replenish', expediteur: 'Patron', amount: 100, balanceType: 'stock', note: 'x'.repeat(281) })).rejects.toMatchObject({ code: 'STORE_TRANSACTION_INVALID' })
  })

  it('refuse l’annulation d’un ravitaillement depuis l’historique', async () => {
    const result = await call({ action: 'replenish', expediteur: 'Patron', amount: 300, balanceType: 'stock' })
    await expect(call({ action: 'cancelHistory', historyId: result.id })).rejects.toMatchObject({ code: 'STORE_TRANSACTION_INVALID' })
    expect(await soldes()).toEqual({ stock: 800, liquidite: 20 })
    expect((await db.doc(`clients/${STORE}/history/${result.id}`).get()).data().statut).toBe('Validée')
  })
})
