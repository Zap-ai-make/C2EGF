import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { storeTransactionCommandHandler } from '../../functions/src/storeTransactions/storeTransactionCommand.js'
import { addTransactionPaymentHandler } from '../../functions/src/settlements/addTransactionPayment.js'

/**
 * TC-381 — les gestes GÉNÉRIQUES face à une ligne « Remb. siège ».
 *
 * Le remboursement au siège (docs/superpowers/specs/2026-11-14-remboursement-siege-design.md)
 * a ses propres commandes. Mais une ligne « Remb. siège » vit dans `drafts` et
 * `history`, à côté des dépôts : une application pas encore rechargée peut lui
 * proposer « Modifier », « Annuler » ou « Encaisser » génériques.
 *
 * CE FICHIER FIGE CE QUE CES GESTES FONT AUJOURD'HUI (AGENTS.md : pas de règle
 * métier modifiée sans caractérisation). Trois défauts y sont visibles :
 *   - `deleteDraft`, `trashDraft`, `trashHistory`, `cancelHistory` lèvent un
 *     `Error` nu : la file d'envoi le prend pour une panne et le renvoie toutes
 *     les 30 s, en bloquant les opérations suivantes ;
 *   - `validateDraft` valide la ligne sans toucher aux soldes ;
 *   - `addTransactionPayment` crédite le stock d'une tranche.
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

describe('TC-381 — avant les gardes : ce que les gestes génériques font d’une ligne « Remb. siège »', () => {
  it('[TC-381-C1] `add` refuse le type « Remb. siège » : il n’est pas dans le profil', async () => {
    const erreur = await erreurNue(call({
      action: 'add',
      transaction: { clientId: 'agent-1', type: 'Remb. siège', reseau: 'Orange', montant: 100_000, statut: 'Non Terminées' },
    }))
    expect(erreur.code).toBe('STORE_TRANSACTION_INVALID')
    expect(await soldes()).toEqual(DEPART)
  })

  it('[TC-381-C2] `updateDraft` refuse, par le contrôle du type du profil', async () => {
    await poserBrouillonRembSiege()
    const erreur = await erreurNue(call({ action: 'updateDraft', draftId: 'rs-1', updates: { montant: 90_000 } }))
    expect(erreur.code).toBe('STORE_TRANSACTION_INVALID')
    expect(await soldes()).toEqual(DEPART)
  })

  it('[TC-381-C3] `deleteDraft` lève une erreur NUE', async () => {
    await poserBrouillonRembSiege()
    const erreur = await erreurNue(call({ action: 'deleteDraft', draftId: 'rs-1' }))
    expect(erreur.message).toBe('Type de transaction non reconnu.')
    expect(erreur.code).toBeUndefined()
    expect((await doc('drafts', 'rs-1')).exists).toBe(true)
  })

  it('[TC-381-C4] `trashDraft` lève une erreur NUE', async () => {
    await poserBrouillonRembSiege()
    const erreur = await erreurNue(call({ action: 'trashDraft', draftId: 'rs-1' }))
    expect(erreur.message).toBe('Type de transaction non reconnu.')
    expect(erreur.code).toBeUndefined()
    expect((await doc('drafts', 'rs-1')).exists).toBe(true)
  })

  it('[TC-381-C5] `validateDraft` sans mode valide la ligne SANS toucher aux soldes', async () => {
    await poserBrouillonRembSiege()
    const r = await call({ action: 'validateDraft', draftId: 'rs-1' })
    expect(r.validated).toBe(true)
    expect(await soldes()).toEqual(DEPART)
    expect((await doc('drafts', 'rs-1')).exists).toBe(false)
    expect((await doc('history', r.historyId)).data().statut).toBe('Validée')
  })

  it('[TC-381-C6] `addTransactionPayment` crédite le stock d’une tranche', async () => {
    await poserBrouillonRembSiege()
    await payer({ draftId: 'rs-1', amount: 10_000, paymentMethod: 'Orange Money', idempotencyKey: 'k-1' })
    expect(await soldes()).toEqual({ stock: STOCK_INITIAL + 10_000, liquidite: LIQUIDITE_INITIALE })
  })

  it('[TC-381-C7] `trashHistory` lève une erreur NUE', async () => {
    await poserLigneRembSiegeValidee()
    const erreur = await erreurNue(call({ action: 'trashHistory', historyId: 'rs-2' }))
    expect(erreur.message).toBe('Type de transaction non reconnu.')
    expect(erreur.code).toBeUndefined()
    expect((await doc('history', 'rs-2')).data().statut).toBe('Validée')
  })

  it('[TC-381-C8] `cancelHistory` lève une erreur NUE', async () => {
    await poserLigneRembSiegeValidee()
    const erreur = await erreurNue(call({ action: 'cancelHistory', historyId: 'rs-2' }))
    expect(erreur.message).toBe('Type de transaction non reconnu.')
    expect(erreur.code).toBeUndefined()
    expect((await doc('history', 'rs-2')).data().statut).toBe('Validée')
  })
})
