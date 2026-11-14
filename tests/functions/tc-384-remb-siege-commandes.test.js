import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { storeTransactionCommandHandler } from '../../functions/src/storeTransactions/storeTransactionCommand.js'

/**
 * TC-384 — les commandes du remboursement au siège
 * (docs/superpowers/specs/2026-11-14-remboursement-siege-design.md).
 *
 * L'agent rembourse à la boutique ce que le siège lui a donné à crédit la nuit ;
 * la caissière envoie cet argent au siège, tout de suite ou par tranches. Les
 * soldes suivent la caisse réelle à chaque geste, et une seule réserve bouge à
 * la fois. Les cas numérotés sont ceux de la spec (« Les cas réels »).
 */

let app
let db
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
const UID = 'rs-cmd-gerant'
const STORE = 'rs-cmd-boutique'
const STOCK_INITIAL = 500_000
const LIQUIDITE_INITIALE = 300_000
const SETTLEMENT_FIELDS = [
  'originalAmount', 'paidAmount', 'refundedAmount', 'remainingAmount',
  'settlementStatus', 'settlementSummary', 'settlementUpdatedAt',
  'settlementAmount', 'settlementType',
]

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
  await poserSoldes(STOCK_INITIAL, LIQUIDITE_INITIALE)
})

const call = data => storeTransactionCommandHandler({ auth: { uid: UID }, data }, { db, FieldValue, logWriter: () => {} })
const soldes = async () => (await db.doc(`clients/${STORE}/networkBalances/current`).get()).data().balances.Orange
const poserSoldes = (stock, liquidite) =>
  db.doc(`clients/${STORE}/networkBalances/current`).set({ balances: { Orange: { stock, liquidite } } })
const lire = async (sous, id) => (await db.doc(`clients/${STORE}/${sous}/${id}`).get())
const compter = async sous => (await db.collection(`clients/${STORE}/${sous}`).get()).size
const refus = async promesse => promesse.then(() => { throw new Error('Aucun refus') }, e => e)

const AGENT = { id: 'agent-1', nom: 'KABORE', prenom: 'Issa', orange: '1234567' }
const tx = overrides => ({
  client: AGENT,
  clientId: AGENT.id,
  code: AGENT.orange,
  montant: 100_000,
  balanceType: 'liquidite',
  statut: 'Non Terminées',
  ...overrides,
})
const saisir = (overrides, extra) => call({ action: 'addSiegeRepayment', transaction: tx(overrides), ...extra })
const envoyer = (draftId, amount, extra) => call({ action: 'sendToSiege', draftId, amount, ...extra })

// ═══════════════════════════════════════════════════════════════════════════
// La saisie
// ═══════════════════════════════════════════════════════════════════════════

describe('TC-384 — la saisie', () => {
  it('[TC-384-1] cas 1 : reçu en Stock, validé, stock à zéro — rien ne bouge, la ligne est au nom de l’agent', async () => {
    await poserSoldes(0, LIQUIDITE_INITIALE)
    const { id } = await saisir({ balanceType: 'stock', statut: 'Validée' })
    expect(await soldes()).toEqual({ stock: 0, liquidite: LIQUIDITE_INITIALE })
    const ligne = (await lire('history', id)).data()
    expect(ligne).toMatchObject({
      type: 'Remb. siège',
      statut: 'Validée',
      directValidation: true,
      envoyeAuSiege: 100_000,
      resteAuSiege: 0,
      clientId: 'agent-1',
      balanceType: 'stock',
      montant: 100_000,
    })
  })

  it('[TC-384-2] cas 2 : reçu en Espèce, validé — l’espèce monte, le stock part au siège', async () => {
    await saisir({ statut: 'Validée' })
    expect(await soldes()).toEqual({ stock: 400_000, liquidite: 400_000 })
  })

  it('[TC-384-3] cas 2b : reçu en Espèce, validé, stock trop bas — refusé, rien n’est écrit', async () => {
    await poserSoldes(50_000, LIQUIDITE_INITIALE)
    const erreur = await refus(saisir({ statut: 'Validée' }))
    expect(erreur.code).toBe('INSUFFICIENT_STORE_BALANCE')
    expect(await soldes()).toEqual({ stock: 50_000, liquidite: LIQUIDITE_INITIALE })
    expect(await compter('history')).toBe(0)
    expect(await compter('drafts')).toBe(0)
  })

  it('[TC-384-4] reçu en Espèce, Non Terminées — l’espèce monte tout de suite, la ligne attend l’envoi', async () => {
    const { id } = await saisir()
    expect(await soldes()).toEqual({ stock: STOCK_INITIAL, liquidite: 400_000 })
    const ligne = (await lire('drafts', id)).data()
    expect(ligne).toMatchObject({ type: 'Remb. siège', statut: 'Non Terminées', envoyeAuSiege: 0, resteAuSiege: 100_000, envoisSiege: [] })
    for (const champ of SETTLEMENT_FIELDS) expect(Object.hasOwn(ligne, champ)).toBe(false)
  })

  it('[TC-384-5] sans « Reçu en », ou avec une réserve inconnue — refusé', async () => {
    expect((await refus(saisir({ balanceType: undefined }))).code).toBe('STORE_TRANSACTION_INVALID')
    expect((await refus(saisir({ balanceType: 'banque' }))).code).toBe('STORE_TRANSACTION_INVALID')
  })

  it('[TC-384-6] le réseau soufflé par le navigateur est ignoré', async () => {
    const { id } = await saisir({ reseau: 'Moov' })
    expect((await lire('drafts', id)).data().reseau).toBe('Orange')
  })

  it('[TC-384-7] renvoyée avec le même commandeId — comptée une fois', async () => {
    await saisir({}, { commandeId: 'cmd-rs-1' })
    const encore = await saisir({}, { commandeId: 'cmd-rs-1' })
    expect(encore.idempotent).toBe(true)
    expect(await soldes()).toEqual({ stock: STOCK_INITIAL, liquidite: 400_000 })
    expect(await compter('drafts')).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// L'envoi au siège
// ═══════════════════════════════════════════════════════════════════════════

describe('TC-384 — l’envoi au siège', () => {
  it('[TC-384-8] cas 3 : reçu en Espèce, envoyé en deux tranches — la ligne part dans l’historique sous son identifiant', async () => {
    const { id } = await saisir()
    const premier = await envoyer(id, 60_000)
    expect(premier.resteAuSiege).toBe(40_000)
    expect(await soldes()).toEqual({ stock: 440_000, liquidite: 400_000 })
    await envoyer(id, 40_000)
    expect(await soldes()).toEqual({ stock: 400_000, liquidite: 400_000 })
    expect((await lire('drafts', id)).exists).toBe(false)
    const ligne = (await lire('history', id)).data()
    expect(ligne).toMatchObject({ statut: 'Validée', envoyeAuSiege: 100_000, resteAuSiege: 0 })
    expect(ligne.envoisSiege.map(e => e.montant)).toEqual([60_000, 40_000])
  })

  it('[TC-384-9] cas 4 : reçu en Stock, envoyé plus tard — le stock monte puis redescend', async () => {
    const { id } = await saisir({ balanceType: 'stock' })
    expect(await soldes()).toEqual({ stock: 600_000, liquidite: LIQUIDITE_INITIALE })
    await envoyer(id, 100_000)
    expect(await soldes()).toEqual({ stock: STOCK_INITIAL, liquidite: LIQUIDITE_INITIALE })
  })

  it('[TC-384-10] une tranche au-delà du reste — refusée, le message dit le reste', async () => {
    const { id } = await saisir()
    const erreur = await refus(envoyer(id, 120_000))
    expect(erreur.code).toBe('STORE_TRANSACTION_INVALID')
    expect(erreur.message).toContain('100')
  })

  it('[TC-384-11] une tranche au-delà du stock — refusée', async () => {
    const { id } = await saisir()
    await poserSoldes(50_000, 400_000)
    expect((await refus(envoyer(id, 60_000))).code).toBe('INSUFFICIENT_STORE_BALANCE')
  })

  it('[TC-384-12] une tranche sur un dépôt en attente — refusée', async () => {
    await db.doc(`clients/${STORE}/drafts/depot-1`).set({ type: 'Dépôt', montant: 100_000, reseau: 'Orange', statut: 'Non Terminées', clientId: 'agent-1' })
    expect((await refus(envoyer('depot-1', 10_000))).code).toBe('STORE_TRANSACTION_INVALID')
  })

  it('[TC-384-13] une tranche renvoyée — y compris celle qui solde — débite le stock une fois', async () => {
    const { id } = await saisir()
    await envoyer(id, 60_000, { commandeId: 'env-1' })
    expect((await envoyer(id, 60_000, { commandeId: 'env-1' })).idempotent).toBe(true)
    await envoyer(id, 40_000, { commandeId: 'env-2' })
    expect((await envoyer(id, 40_000, { commandeId: 'env-2' })).idempotent).toBe(true)
    expect(await soldes()).toEqual({ stock: 400_000, liquidite: 400_000 })
  })

  it('[TC-384-14] la tranche finale ne réécrit pas une autre ligne d’historique de même identifiant', async () => {
    const { id } = await saisir()
    await db.doc(`clients/${STORE}/history/${id}`).set({ type: 'Dépôt', montant: 5, statut: 'Validée' })
    expect((await refus(envoyer(id, 100_000))).code).toBe('IDEMPOTENCY_CONFLICT')
    expect(await soldes()).toEqual({ stock: STOCK_INITIAL, liquidite: 400_000 })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// La modification
// ═══════════════════════════════════════════════════════════════════════════

describe('TC-384 — la modification', () => {
  it('[TC-384-15] 100 000 en Stock devient 80 000 en Espèce, et le journal le dit', async () => {
    const { id } = await saisir({ balanceType: 'stock' })
    await call({ action: 'updateSiegeRepayment', draftId: id, updates: { montant: 80_000, balanceType: 'liquidite' } })
    expect(await soldes()).toEqual({ stock: STOCK_INITIAL, liquidite: 380_000 })
    const ligne = (await lire('drafts', id)).data()
    expect(ligne).toMatchObject({ montant: 80_000, balanceType: 'liquidite', resteAuSiege: 80_000 })
    expect(ligne.modifications).toHaveLength(1)
    expect(ligne.modifications[0]).toMatchObject({ avant: 100_000, apres: 80_000 })
  })

  it('[TC-384-16] après une tranche, plus de modification', async () => {
    const { id } = await saisir()
    await envoyer(id, 10_000)
    const erreur = await refus(call({ action: 'updateSiegeRepayment', draftId: id, updates: { montant: 80_000 } }))
    expect(erreur.code).toBe('SETTLED_DRAFT_IMMUTABLE')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// L'annulation
// ═══════════════════════════════════════════════════════════════════════════

describe('TC-384 — l’annulation', () => {
  it('[TC-384-17] cas A : annulée après un envoi de 60 000 — les deux jambes sont défaites, la ligne va à la corbeille', async () => {
    const { id } = await saisir()
    await envoyer(id, 60_000)
    const r = await call({ action: 'trashSiegeRepayment', draftId: id })
    expect(await soldes()).toEqual({ stock: STOCK_INITIAL, liquidite: LIQUIDITE_INITIALE })
    expect((await lire('drafts', id)).exists).toBe(false)
    expect((await lire('history', r.historyId)).data()).toMatchObject({ type: 'Remb. siège', statut: 'Supprimée', origin: 'draft' })
  })

  it('[TC-384-18] une ligne validée annulée rend les soldes de départ', async () => {
    const { id } = await saisir({ statut: 'Validée' })
    await call({ action: 'trashSiegeRepayment', historyId: id })
    expect(await soldes()).toEqual({ stock: STOCK_INITIAL, liquidite: LIQUIDITE_INITIALE })
    expect((await lire('history', id)).data()).toMatchObject({ statut: 'Supprimée', origin: 'history' })
  })

  it('[TC-384-19] l’espèce reçue déjà dépensée — refusé, rien ne bouge', async () => {
    const { id } = await saisir()
    await poserSoldes(STOCK_INITIAL, 0)
    expect((await refus(call({ action: 'trashSiegeRepayment', draftId: id }))).code).toBe('INSUFFICIENT_STORE_BALANCE')
    expect((await lire('drafts', id)).exists).toBe(true)
    expect(await soldes()).toEqual({ stock: STOCK_INITIAL, liquidite: 0 })
  })

  it('[TC-384-20] une annulation renvoyée n’est pas refusée, et ne rend qu’une fois', async () => {
    const enAttente = await saisir()
    await call({ action: 'trashSiegeRepayment', draftId: enAttente.id, commandeId: 'ann-1' })
    expect((await call({ action: 'trashSiegeRepayment', draftId: enAttente.id, commandeId: 'ann-1' })).idempotent).toBe(true)
    const validee = await saisir({ statut: 'Validée' })
    await call({ action: 'trashSiegeRepayment', historyId: validee.id, commandeId: 'ann-2' })
    expect((await call({ action: 'trashSiegeRepayment', historyId: validee.id, commandeId: 'ann-2' })).idempotent).toBe(true)
    expect(await soldes()).toEqual({ stock: STOCK_INITIAL, liquidite: LIQUIDITE_INITIALE })
  })
})
