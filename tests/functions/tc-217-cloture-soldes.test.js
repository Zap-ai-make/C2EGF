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

/**
 * TC-217 — Un ravitaillement non retourné interdit de vider les soldes.
 *
 * POURQUOI CE GARDE-FOU EXISTE
 * ────────────────────────────
 * Un ravitaillement AJOUTE aux soldes ; un retour les PONCTIONNE. L'argent que
 * la boutique doit rendre au dealer est donc assis dans les soldes. Les vider
 * détruit les fonds enregistrés qui serviraient au retour — pendant que la
 * dette, elle, survit sur la ligne de ravitaillement (`remainingAmount`). La
 * boutique se retrouverait devant une dette sans rien d'inscrit pour l'honorer.
 *
 * ⚠ LE REFUS EST SERVEUR, PAS SEULEMENT À L'ÉCRAN. L'écran peut être périmé ou
 *   contourné ; sur de l'argent, c'est le serveur qui décide.
 */
describe('TC-217 — un ravitaillement dû bloque la clôture', () => {
  const poserRavitaillement = (id, champs) => db.doc(`clients/${STORE}/history/${id}`).set({
    type: 'Ravitaillement',
    montant: 500_000,
    reseau: 'Orange',
    statut: 'Validée',
    storeId: STORE,
    createdAt: FieldValue.serverTimestamp(),
    ...champs,
  })

  it('[TC-217-10] refuse quand un ravitaillement reste dû', async () => {
    await poserRavitaillement('rav-1', { remainingAmount: 350_000 })

    await expect(call({ action: 'closeDay' })).rejects.toMatchObject({
      code: 'STORE_CLOSURE_BLOCKED',
    })
  })

  /** ⚠ Et les soldes ne bougent pas : un refus qui solde quand même ne refuse rien. */
  it('[TC-217-11] le refus laisse les soldes intacts', async () => {
    await poserRavitaillement('rav-1', { remainingAmount: 350_000 })

    await expect(call({ action: 'closeDay' })).rejects.toThrow()

    expect(await soldes()).toEqual({ stock: 600_066, liquidite: 401_934 })
    const lignes = await db.collection(`clients/${STORE}/history`).get()
    expect(lignes.docs.filter((d) => d.data().type === 'Clôture')).toHaveLength(0)
  })

  /** Le message nomme ce qui bloque : combien de livraisons, et combien d'argent. */
  it('[TC-217-12] le message dit combien, et combien', async () => {
    await poserRavitaillement('rav-1', { remainingAmount: 350_000 })
    await poserRavitaillement('rav-2', { remainingAmount: 150_000 })

    await expect(call({ action: 'closeDay' })).rejects.toThrow(/2 ravitaillements.*500\s?000/s)
  })

  it('[TC-217-13] un ravitaillement entièrement rendu ne bloque pas', async () => {
    await poserRavitaillement('rav-1', { remainingAmount: 0, replenishmentStatus: 'settled' })

    const result = await call({ action: 'closeDay' })
    expect(result.type).toBe('Clôture')
  })

  /**
   * ⚠ LES LIVRAISONS D'AVANT S8 N'ONT PAS DE RESTE DÛ, et il est inconnaissable :
   *   ce qui en a été rendu ne fut jamais enregistré. `estRavitaillementEnCours`
   *   les compte pour soldées côté écran ; le serveur doit dire la même chose,
   *   sinon une boutique ne pourrait plus JAMAIS vider ses soldes.
   */
  it('[TC-217-14] un ravitaillement sans reste dû ne bloque pas', async () => {
    await poserRavitaillement('rav-ancien', {})

    const result = await call({ action: 'closeDay' })
    expect(result.type).toBe('Clôture')
  })

  it('[TC-217-15] un ravitaillement mis à la corbeille ne bloque pas', async () => {
    await poserRavitaillement('rav-1', { remainingAmount: 350_000, deletedAt: FieldValue.serverTimestamp() })

    const result = await call({ action: 'closeDay' })
    expect(result.type).toBe('Clôture')
  })

  /** Le garde-fou ne regarde que SA boutique. */
  it('[TC-217-16] un ravitaillement dû chez une autre boutique ne bloque pas', async () => {
    await db.doc('clients/store-closeday-b/history/rav-x').set({
      type: 'Ravitaillement', montant: 500_000, remainingAmount: 500_000,
      storeId: 'store-closeday-b', createdAt: FieldValue.serverTimestamp(),
    })

    const result = await call({ action: 'closeDay' })
    expect(result.type).toBe('Clôture')
  })
})
