import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { storeTransactionCommandHandler } from '../../functions/src/storeTransactions/storeTransactionCommand.js'
import { addTransactionPaymentHandler } from '../../functions/src/settlements/addTransactionPayment.js'
import { addTransactionRefundHandler } from '../../functions/src/settlements/addTransactionRefund.js'
import { MESSAGE_GESTE_TRANSFERT } from '../../functions/src/storeTransactions/transfertArgent.js'

/**
 * TC-406 — les gestes GÉNÉRIQUES face à une ligne de transfert d'argent
 * (docs/superpowers/specs/2026-11-23-transferts-argent-design.md, « Les gardes
 * sur les commandes existantes »).
 *
 * Calqué sur TC-381 : une application pas encore rechargée peut proposer
 * « Modifier », « Annuler » ou « Encaisser » génériques sur cette ligne. Chacun
 * doit refuser par un code métier — définitif pour la file — sans toucher aux
 * soldes ni aux lignes.
 */

let app
let db
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
const UID = 'tg-gerant'
const STORE = 'tg-boutique'
const STOCK_INITIAL = 500_000
const LIQUIDITE_INITIALE = 300_000

beforeAll(() => {
  if (PROJECT !== 'demo-akayis-test' || !/^(127\.0\.0\.1|localhost):\d+$/.test(HOST || '')) throw new Error('Émulateur demo requis')
  app = getApps().length ? getApps()[0] : initializeApp({ projectId: PROJECT })
  db = getFirestore(app)
})
afterAll(async () => { await deleteApp(app) })
beforeEach(async () => {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await db.doc(`users/${UID}`).set({ role: 'store_admin', active: true, storeId: STORE, name: 'Awa', email: 'awa@c2egf.test' })
  await db.doc(`stores/${STORE}`).set({ active: true, name: 'Boutique TG', adminUid: UID, transfertsArgent: true })
  await db.doc(`clients/${STORE}/networkBalances/current`).set({
    balances: { Orange: { stock: STOCK_INITIAL, liquidite: LIQUIDITE_INITIALE } },
  })
})

const call = data => storeTransactionCommandHandler({ auth: { uid: UID }, data }, { db, FieldValue, logWriter: () => {} })
const payer = data => addTransactionPaymentHandler({ auth: { uid: UID }, data }, { db, FieldValue, logWriter: () => {} })
const soldes = async () => (await db.doc(`clients/${STORE}/networkBalances/current`).get()).data().balances.Orange
const doc = async (sous, id) => (await db.doc(`clients/${STORE}/${sous}/${id}`).get())
const DEPART = { stock: STOCK_INITIAL, liquidite: LIQUIDITE_INITIALE }

const TRANSFERT = {
  type: 'Transfert argent',
  service: 'Western Union',
  operation: 'transfert',
  nomClient: 'DIALLO Awa',
  balanceType: 'liquidite',
  montant: 100_000,
  montantTraite: 0,
  resteATraiter: 100_000,
  tranches: [],
  reseau: 'Orange',
  statut: 'Non Terminées',
  storeId: STORE,
}

/** Un transfert en attente d'envoi au siège, posé directement : `drafts/ta-1`. */
const poserBrouillonTransfert = () => db.doc(`clients/${STORE}/drafts/ta-1`).set(TRANSFERT)

/** Un transfert entièrement envoyé au siège : `history/ta-2`. */
const poserLigneTransfertValidee = () => db.doc(`clients/${STORE}/history/ta-2`).set({
  ...TRANSFERT,
  statut: 'Validée',
  montantTraite: 100_000,
  resteATraiter: 0,
})

/** Un refus qui n'est PAS métier : pas de code, la file le renverrait. */
const erreurNue = async (promesse) => {
  const erreur = await promesse.then(() => null, (e) => e)
  expect(erreur).toBeInstanceOf(Error)
  return erreur
}

const rembourser = data => addTransactionRefundHandler({ auth: { uid: UID }, data }, { db, FieldValue, logWriter: () => {} })

/** Un refus métier : le code dit à la file de ne pas renvoyer. */
const refusMetier = async (promesse) => {
  const erreur = await erreurNue(promesse)
  expect(erreur.code).toBe('STORE_TRANSACTION_INVALID')
  return erreur
}

/** Le brouillon et les soldes n'ont pas bougé. */
const brouillonIntact = async () => {
  expect((await doc('drafts', 'ta-1')).data()).toMatchObject({ statut: 'Non Terminées', montant: 100_000, resteATraiter: 100_000 })
  expect(await soldes()).toEqual(DEPART)
}

/** La ligne validée et les soldes n'ont pas bougé. */
const ligneIntacte = async () => {
  expect((await doc('history', 'ta-2')).data().statut).toBe('Validée')
  expect(await soldes()).toEqual(DEPART)
}

describe('TC-406 — les gestes génériques refusent une ligne de transfert', () => {
  it('[TC-406-C1] `add` refuse le type « Transfert argent » : il n’est pas dans le profil', async () => {
    const erreur = await erreurNue(call({
      action: 'add',
      transaction: { clientId: 'agent-1', type: 'Transfert argent', reseau: 'Orange', montant: 100_000, statut: 'Non Terminées' },
    }))
    expect(erreur.code).toBe('STORE_TRANSACTION_INVALID')
    expect(await soldes()).toEqual(DEPART)
  })

  it('[TC-406-G2] `updateDraft` refuse par le message de la garde', async () => {
    await poserBrouillonTransfert()
    const erreur = await refusMetier(call({ action: 'updateDraft', draftId: 'ta-1', updates: { montant: 90_000 } }))
    expect(erreur.message).toBe(MESSAGE_GESTE_TRANSFERT)
    await brouillonIntact()
  })

  it('[TC-406-G3] `deleteDraft` refuse par un code métier', async () => {
    await poserBrouillonTransfert()
    const erreur = await refusMetier(call({ action: 'deleteDraft', draftId: 'ta-1' }))
    expect(erreur.message).toBe(MESSAGE_GESTE_TRANSFERT)
    await brouillonIntact()
  })

  it('[TC-406-G4] `trashDraft` refuse par un code métier', async () => {
    await poserBrouillonTransfert()
    const erreur = await refusMetier(call({ action: 'trashDraft', draftId: 'ta-1' }))
    expect(erreur.message).toBe(MESSAGE_GESTE_TRANSFERT)
    await brouillonIntact()
  })

  it('[TC-406-G5] `validateDraft` refuse, et la ligne ne part pas dans l’historique', async () => {
    await poserBrouillonTransfert()
    const erreur = await refusMetier(call({ action: 'validateDraft', draftId: 'ta-1' }))
    expect(erreur.message).toBe(MESSAGE_GESTE_TRANSFERT)
    await brouillonIntact()
    expect((await db.collection(`clients/${STORE}/history`).get()).size).toBe(0)
  })

  it('[TC-406-G6] `addTransactionPayment` refuse, le stock ne bouge pas', async () => {
    await poserBrouillonTransfert()
    const erreur = await refusMetier(payer({ draftId: 'ta-1', amount: 10_000, paymentMethod: 'Orange Money', idempotencyKey: 'k-1' }))
    expect(erreur.message).toBe(MESSAGE_GESTE_TRANSFERT)
    await brouillonIntact()
  })

  it('[TC-406-G7] `trashHistory` refuse par un code métier', async () => {
    await poserLigneTransfertValidee()
    const erreur = await refusMetier(call({ action: 'trashHistory', historyId: 'ta-2' }))
    expect(erreur.message).toBe(MESSAGE_GESTE_TRANSFERT)
    await ligneIntacte()
  })

  it('[TC-406-G8] `cancelHistory` refuse par un code métier', async () => {
    await poserLigneTransfertValidee()
    const erreur = await refusMetier(call({ action: 'cancelHistory', historyId: 'ta-2' }))
    expect(erreur.message).toBe(MESSAGE_GESTE_TRANSFERT)
    await ligneIntacte()
  })

  it('[TC-406-G9] `addTransactionRefund` refuse par le message de la garde', async () => {
    await poserBrouillonTransfert()
    const erreur = await refusMetier(rembourser({ draftId: 'ta-1', amount: 10_000, paymentMethod: 'Orange Money', idempotencyKey: 'k-2' }))
    expect(erreur.message).toBe(MESSAGE_GESTE_TRANSFERT)
    await brouillonIntact()
  })

  it('[TC-406-G10] `reopenHistory` refuse par un code métier', async () => {
    await poserLigneTransfertValidee()
    const erreur = await refusMetier(call({ action: 'reopenHistory', historyId: 'ta-2' }))
    expect(erreur.message).toBe(MESSAGE_GESTE_TRANSFERT)
    await ligneIntacte()
  })

  it('[TC-406-G11] `correctHistory` refuse par un code métier', async () => {
    await poserLigneTransfertValidee()
    const erreur = await refusMetier(call({ action: 'correctHistory', historyId: 'ta-2', updates: { montant: 90_000 } }))
    expect(erreur.message).toBe(MESSAGE_GESTE_TRANSFERT)
    await ligneIntacte()
  })
})
