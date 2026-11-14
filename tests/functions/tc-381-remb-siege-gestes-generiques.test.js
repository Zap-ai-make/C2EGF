import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { storeTransactionCommandHandler } from '../../functions/src/storeTransactions/storeTransactionCommand.js'
import { addTransactionPaymentHandler } from '../../functions/src/settlements/addTransactionPayment.js'
import { addTransactionRefundHandler } from '../../functions/src/settlements/addTransactionRefund.js'
import { MESSAGE_GESTE_GENERIQUE } from '../../functions/src/storeTransactions/rembSiege.js'

/**
 * TC-381 — les gestes GÉNÉRIQUES face à une ligne « Remb. siège ».
 *
 * Le remboursement au siège (docs/superpowers/specs/2026-11-14-remboursement-siege-design.md)
 * a ses propres commandes. Mais une ligne « Remb. siège » vit dans `drafts` et
 * `history`, à côté des dépôts : une application pas encore rechargée peut lui
 * proposer « Modifier », « Annuler » ou « Encaisser » génériques.
 *
 * AVANT LES GARDES (caractérisation, commit f5a699d), trois défauts :
 *   - `deleteDraft`, `trashDraft`, `trashHistory`, `cancelHistory` levaient un
 *     `Error` nu : la file d'envoi le prenait pour une panne et le renvoyait
 *     toutes les 30 s, en bloquant les opérations suivantes ;
 *   - `validateDraft` validait la ligne sans toucher aux soldes ;
 *   - `addTransactionPayment` créditait le stock d'une tranche.
 *
 * DEPUIS LES GARDES, chacun refuse par un code métier — un refus DÉFINITIF pour
 * la file — sans toucher aux soldes ni aux lignes.
 */

let app
let db
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
const UID = 'rs-gerant'
const STORE = 'rs-boutique'
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
  await db.doc(`stores/${STORE}`).set({ active: true, name: 'Boutique RS', adminUid: UID })
  await db.doc(`clients/${STORE}/networkBalances/current`).set({
    balances: { Orange: { stock: STOCK_INITIAL, liquidite: LIQUIDITE_INITIALE } },
  })
})

const call = data => storeTransactionCommandHandler({ auth: { uid: UID }, data }, { db, FieldValue, logWriter: () => {} })
const payer = data => addTransactionPaymentHandler({ auth: { uid: UID }, data }, { db, FieldValue, logWriter: () => {} })
const soldes = async () => (await db.doc(`clients/${STORE}/networkBalances/current`).get()).data().balances.Orange
const doc = async (sous, id) => (await db.doc(`clients/${STORE}/${sous}/${id}`).get())
const DEPART = { stock: STOCK_INITIAL, liquidite: LIQUIDITE_INITIALE }

const REMB = {
  type: 'Remb. siège',
  balanceType: 'liquidite',
  montant: 100_000,
  envoyeAuSiege: 0,
  resteAuSiege: 100_000,
  envoisSiege: [],
  reseau: 'Orange',
  statut: 'Non Terminées',
  clientId: 'agent-1',
  code: '1234567',
  storeId: STORE,
}

/** Un remboursement en attente d'envoi, posé directement : `drafts/rs-1`. */
const poserBrouillonRembSiege = () => db.doc(`clients/${STORE}/drafts/rs-1`).set(REMB)

/** Un remboursement validé d'un geste (reçu en espèce, envoyé) : `history/rs-2`. */
const poserLigneRembSiegeValidee = () => db.doc(`clients/${STORE}/history/rs-2`).set({
  ...REMB,
  statut: 'Validée',
  directValidation: true,
  envoyeAuSiege: 100_000,
  resteAuSiege: 0,
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
  expect((await doc('drafts', 'rs-1')).data()).toMatchObject({ statut: 'Non Terminées', montant: 100_000, resteAuSiege: 100_000 })
  expect(await soldes()).toEqual(DEPART)
}

/** La ligne validée et les soldes n'ont pas bougé. */
const ligneIntacte = async () => {
  expect((await doc('history', 'rs-2')).data().statut).toBe('Validée')
  expect(await soldes()).toEqual(DEPART)
}

describe('TC-381 — les gestes génériques refusent une ligne « Remb. siège »', () => {
  it('[TC-381-C1] `add` refuse le type « Remb. siège » : il n’est pas dans le profil', async () => {
    const erreur = await erreurNue(call({
      action: 'add',
      transaction: { clientId: 'agent-1', type: 'Remb. siège', reseau: 'Orange', montant: 100_000, statut: 'Non Terminées' },
    }))
    expect(erreur.code).toBe('STORE_TRANSACTION_INVALID')
    expect(await soldes()).toEqual(DEPART)
  })

  it('[TC-381-G2] `updateDraft` refuse par le message de la garde', async () => {
    await poserBrouillonRembSiege()
    const erreur = await refusMetier(call({ action: 'updateDraft', draftId: 'rs-1', updates: { montant: 90_000 } }))
    expect(erreur.message).toBe(MESSAGE_GESTE_GENERIQUE)
    await brouillonIntact()
  })

  it('[TC-381-G3] `deleteDraft` refuse par un code métier', async () => {
    await poserBrouillonRembSiege()
    const erreur = await refusMetier(call({ action: 'deleteDraft', draftId: 'rs-1' }))
    expect(erreur.message).toBe(MESSAGE_GESTE_GENERIQUE)
    await brouillonIntact()
  })

  it('[TC-381-G4] `trashDraft` refuse par un code métier', async () => {
    await poserBrouillonRembSiege()
    const erreur = await refusMetier(call({ action: 'trashDraft', draftId: 'rs-1' }))
    expect(erreur.message).toBe(MESSAGE_GESTE_GENERIQUE)
    await brouillonIntact()
  })

  it('[TC-381-G5] `validateDraft` refuse, et la ligne ne part pas dans l’historique', async () => {
    await poserBrouillonRembSiege()
    const erreur = await refusMetier(call({ action: 'validateDraft', draftId: 'rs-1' }))
    expect(erreur.message).toBe(MESSAGE_GESTE_GENERIQUE)
    await brouillonIntact()
    expect((await db.collection(`clients/${STORE}/history`).get()).size).toBe(0)
  })

  it('[TC-381-G6] `addTransactionPayment` refuse, le stock ne bouge pas', async () => {
    await poserBrouillonRembSiege()
    const erreur = await refusMetier(payer({ draftId: 'rs-1', amount: 10_000, paymentMethod: 'Orange Money', idempotencyKey: 'k-1' }))
    expect(erreur.message).toBe(MESSAGE_GESTE_GENERIQUE)
    await brouillonIntact()
  })

  it('[TC-381-G7] `trashHistory` refuse par un code métier', async () => {
    await poserLigneRembSiegeValidee()
    const erreur = await refusMetier(call({ action: 'trashHistory', historyId: 'rs-2' }))
    expect(erreur.message).toContain('« Remb. siège »')
    await ligneIntacte()
  })

  it('[TC-381-G8] `cancelHistory` refuse par un code métier', async () => {
    await poserLigneRembSiegeValidee()
    const erreur = await refusMetier(call({ action: 'cancelHistory', historyId: 'rs-2' }))
    expect(erreur.message).toContain('« Remb. siège »')
    await ligneIntacte()
  })

  it('[TC-381-G9] `addTransactionRefund` refuse par le message de la garde', async () => {
    await poserBrouillonRembSiege()
    const erreur = await refusMetier(rembourser({ draftId: 'rs-1', amount: 10_000, paymentMethod: 'Orange Money', idempotencyKey: 'k-2' }))
    expect(erreur.message).toBe(MESSAGE_GESTE_GENERIQUE)
    await brouillonIntact()
  })

  it('[TC-381-G10] `reopenHistory` refuse par un code métier', async () => {
    await poserLigneRembSiegeValidee()
    const erreur = await refusMetier(call({ action: 'reopenHistory', historyId: 'rs-2' }))
    expect(erreur.message).toContain('« Remb. siège »')
    await ligneIntacte()
  })

  it('[TC-381-G11] `correctHistory` refuse par un code métier', async () => {
    await poserLigneRembSiegeValidee()
    const erreur = await refusMetier(call({ action: 'correctHistory', historyId: 'rs-2', updates: { montant: 90_000 } }))
    expect(erreur.message).toContain('« Remb. siège »')
    await ligneIntacte()
  })
})
