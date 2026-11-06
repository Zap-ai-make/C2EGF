import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { storeTransactionCommandHandler } from '../../functions/src/storeTransactions/storeTransactionCommand.js'

/**
 * TC-357 — le ravitaillement, son retour, la modification et l'annulation
 * renvoyés sans double effet (lot G4a, docs/rester-dans-le-quota-gratuit.md §G4).
 *
 * Le même trou que TC-351 pour la saisie : une réponse perdue fait renvoyer le
 * geste. Sans garde, un ravitaillement renvoyé crédite deux fois le stock, et une
 * annulation renvoyée est refusée à tort (« déjà défaite »), alors qu'elle a eu
 * lieu : la caissière lirait « Refusée » sur un geste qui a réussi.
 *
 * CAR-xx caractérisent le comportement SANS `commandeId`, qui ne doit pas bouger.
 */

let app
let db
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
const UID = 'g4a-gerant'
const STORE = 'g4a-boutique'
const AUTRE_UID = 'g4a-autre-gerant'
const AUTRE_STORE = 'g4a-autre-boutique'

beforeAll(() => {
  if (PROJECT !== 'demo-akayis-test' || !/^(127\.0\.0\.1|localhost):\d+$/.test(HOST || '')) throw new Error('Émulateur demo requis')
  app = getApps().length ? getApps()[0] : initializeApp({ projectId: PROJECT })
  db = getFirestore(app)
})
afterAll(async () => { await deleteApp(app) })
beforeEach(async () => {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  for (const [uid, store] of [[UID, STORE], [AUTRE_UID, AUTRE_STORE]]) {
    await db.doc(`users/${uid}`).set({ role: 'store_admin', active: true, storeId: store, name: 'Gérant', email: 'g@c2egf.test' })
    await db.doc(`stores/${store}`).set({ active: true, name: 'Boutique G4', adminUid: uid })
    await db.doc(`clients/${store}/networkBalances/current`).set({ balances: { Orange: { stock: 1000, liquidite: 500 } } })
  }
})

const call = (data, uid = UID) => storeTransactionCommandHandler({ auth: { uid }, data }, { db, FieldValue, logWriter: () => {} })
const tx = overrides => ({ clientId: 'client-a', type: 'Dépôt', reseau: 'Orange', montant: 100, statut: 'Non Terminées', ...overrides })
const soldes = async (store = STORE) => (await db.doc(`clients/${store}/networkBalances/current`).get()).data().balances.Orange
const compter = async (sous, store = STORE) => (await db.collection(`clients/${store}/${sous}`).get()).size
const ligne = async (id, sous = 'history') => (await db.doc(`clients/${STORE}/${sous}/${id}`).get()).data()
const ravitailler = extra => ({ action: 'replenish', amount: 300, balanceType: 'stock', expediteur: 'Mme Sawadogo', ...extra })

describe('TC-357 — sans commandeId, rien ne change', () => {
  it('[CAR-01] un ravitaillement prend un identifiant tiré par le serveur ; envoyé deux fois, il crédite deux fois', async () => {
    const r = await call(ravitailler())
    expect(r.id).toMatch(/^[A-Za-z0-9]{20}$/)
    await call(ravitailler())
    expect(await compter('history')).toBe(2)
    expect(await soldes()).toEqual({ stock: 1600, liquidite: 500 })
  })

  it('[CAR-02] un retour envoyé deux fois rend deux fois', async () => {
    const { id } = await call(ravitailler())
    const retour = { action: 'returnReplenishment', replenishmentId: id, amount: 100, balanceType: 'stock' }
    await call(retour)
    await call(retour)
    expect(await compter('history')).toBe(3)
    expect((await ligne(id)).remainingAmount).toBe(100)
    expect(await soldes()).toEqual({ stock: 1100, liquidite: 500 })
  })

  it('[CAR-03] une modification rejouée ne bouge plus les soldes et ne regarnit pas le journal', async () => {
    const { id } = await call({ action: 'add', transaction: tx() })
    await call({ action: 'updateDraft', draftId: id, updates: { montant: 150 } })
    await call({ action: 'updateDraft', draftId: id, updates: { montant: 150 } })
    expect(await soldes()).toEqual({ stock: 850, liquidite: 500 })
    expect((await ligne(id, 'drafts')).modifications).toHaveLength(1)
  })

  it('[CAR-04] une annulation de non terminée renvoyée est refusée', async () => {
    const { id } = await call({ action: 'add', transaction: tx() })
    await call({ action: 'trashDraft', draftId: id })
    await expect(call({ action: 'trashDraft', draftId: id })).rejects.toMatchObject({ code: 'SETTLEMENT_DRAFT_NOT_FOUND' })
    expect(await soldes()).toEqual({ stock: 1000, liquidite: 500 })
  })

  it('[CAR-05] une annulation de validée renvoyée est refusée', async () => {
    const { id } = await call({ action: 'add', transaction: tx({ statut: 'Validée' }) })
    await call({ action: 'trashHistory', historyId: id })
    await expect(call({ action: 'trashHistory', historyId: id })).rejects.toMatchObject({ code: 'STORE_TRANSACTION_INVALID' })
    expect(await soldes()).toEqual({ stock: 1000, liquidite: 500 })
  })

  it('[CAR-06] l’annulation d’un retour renvoyée est refusée', async () => {
    const { id } = await call(ravitailler())
    const { id: returnId } = await call({ action: 'returnReplenishment', replenishmentId: id, amount: 100, balanceType: 'stock' })
    await call({ action: 'trashReplenishmentReturn', returnId })
    await expect(call({ action: 'trashReplenishmentReturn', returnId })).rejects.toMatchObject({ code: 'STORE_TRANSACTION_INVALID' })
    expect(await soldes()).toEqual({ stock: 1300, liquidite: 500 })
  })

  it('[CAR-07] une ligne de ravitaillement ne se met pas à la corbeille', async () => {
    const { id } = await call(ravitailler())
    await expect(call({ action: 'trashHistory', historyId: id, commandeId: 'cmd-x' })).rejects.toMatchObject({ code: 'STORE_TRANSACTION_INVALID' })
    expect(await soldes()).toEqual({ stock: 1300, liquidite: 500 })
  })
})

describe('TC-357 — le ravitaillement et son retour', () => {
  it('[IDEM-01] le ravitaillement prend le commandeId ; renvoyé, il ne crédite pas une seconde fois', async () => {
    const r = await call(ravitailler({ commandeId: 'cmd-rav' }))
    expect(r.id).toBe('cmd-rav')
    expect(await ligne('cmd-rav')).toMatchObject({ type: 'Ravitaillement', montant: 300, remainingAmount: 300, expediteur: 'Mme Sawadogo' })

    expect(await call(ravitailler({ commandeId: 'cmd-rav' }))).toEqual({ id: 'cmd-rav', idempotent: true })
    expect(await soldes()).toEqual({ stock: 1300, liquidite: 500 })
    expect(await compter('history')).toBe(1)
    expect(await compter('auditLogs')).toBe(1)
  })

  it('[IDEM-02] renvoyé, un nom nouveau ne s’inscrit qu’une fois sur la boutique', async () => {
    for (let i = 0; i < 2; i += 1) await call(ravitailler({ expediteur: 'Tante Awa', commandeId: 'cmd-nom' }))
    expect((await db.doc(`stores/${STORE}`).get()).data().ravitaillementExpediteurs).toEqual(['Tante Awa'])
  })

  it('[IDEM-03] le retour prend le commandeId ; renvoyé, il ne rend pas une seconde fois', async () => {
    await call(ravitailler({ commandeId: 'cmd-rav' }))
    const retour = { action: 'returnReplenishment', replenishmentId: 'cmd-rav', amount: 100, balanceType: 'stock', commandeId: 'cmd-ret' }
    expect((await call(retour)).id).toBe('cmd-ret')
    expect(await call(retour)).toEqual({ id: 'cmd-ret', idempotent: true })
    expect((await ligne('cmd-rav')).remainingAmount).toBe(200)
    expect(await soldes()).toEqual({ stock: 1200, liquidite: 500 })
  })

  it('[IDEM-04] renvoyé quand la livraison est soldée, le retour répond « déjà fait », sans refus', async () => {
    await call(ravitailler({ commandeId: 'cmd-rav' }))
    const retour = { action: 'returnReplenishment', replenishmentId: 'cmd-rav', amount: 300, balanceType: 'stock', commandeId: 'cmd-ret' }
    await call(retour)
    expect((await ligne('cmd-rav')).remainingAmount).toBe(0)
    expect(await call(retour)).toEqual({ id: 'cmd-ret', idempotent: true })
  })
})

describe('TC-357 — la modification d’une non terminée', () => {
  it('[IDEM-05] renvoyée, elle ne s’applique pas deux fois et le journal ne compte qu’une ligne', async () => {
    await call({ action: 'add', transaction: tx(), commandeId: 'cmd-s' })
    const modif = { action: 'updateDraft', draftId: 'cmd-s', updates: { montant: 150 }, commandeId: 'cmd-m1' }
    await call(modif)
    expect(await call(modif)).toEqual({ id: 'cmd-s', idempotent: true })
    expect(await soldes()).toEqual({ stock: 850, liquidite: 500 })
    expect((await ligne('cmd-s', 'drafts')).modifications).toHaveLength(1)
    expect(await compter('auditLogs')).toBe(2)
  })

  it('[IDEM-06] renvoyée alors que le stock d’un retrait est déjà reparti, elle ne se croit pas refusée', async () => {
    await call({ action: 'add', transaction: tx({ type: 'Retrait', montant: 400 }), commandeId: 'cmd-retrait' })
    const modif = { action: 'updateDraft', draftId: 'cmd-retrait', updates: { montant: 500 }, commandeId: 'cmd-m' }
    await call(modif)
    expect(await soldes()).toEqual({ stock: 1500, liquidite: 500 })
    await call({ action: 'add', transaction: tx({ montant: 1400 }) })
    expect(await soldes()).toEqual({ stock: 100, liquidite: 500 })

    expect(await call(modif)).toEqual({ id: 'cmd-retrait', idempotent: true })
    expect(await soldes()).toEqual({ stock: 100, liquidite: 500 })
  })

  it('[IDEM-07] deux modifications distinctes s’appliquent toutes les deux, dans l’ordre', async () => {
    await call({ action: 'add', transaction: tx(), commandeId: 'cmd-s' })
    await call({ action: 'updateDraft', draftId: 'cmd-s', updates: { montant: 150 }, commandeId: 'cmd-m1' })
    await call({ action: 'updateDraft', draftId: 'cmd-s', updates: { montant: 120 }, commandeId: 'cmd-m2' })
    expect(await soldes()).toEqual({ stock: 880, liquidite: 500 })
    expect((await ligne('cmd-s', 'drafts')).modifications.map((m) => m.apres)).toEqual([150, 120])
  })

  it('[IDEM-08] la marque du renvoi ne gêne pas une modification suivante, même sans commandeId', async () => {
    await call({ action: 'add', transaction: tx(), commandeId: 'cmd-s' })
    await call({ action: 'updateDraft', draftId: 'cmd-s', updates: { montant: 150 }, commandeId: 'cmd-m1' })
    await call({ action: 'updateDraft', draftId: 'cmd-s', updates: { montant: 170 } })
    expect((await ligne('cmd-s', 'drafts')).montant).toBe(170)
  })
})

describe('TC-357 — l’annulation', () => {
  it('[IDEM-09] d’une non terminée : elle part dans la corbeille sous le commandeId ; renvoyée, elle répond « déjà faite »', async () => {
    await call({ action: 'add', transaction: tx(), commandeId: 'cmd-s' })
    const annuler = { action: 'trashDraft', draftId: 'cmd-s', commandeId: 'cmd-a' }
    expect(await call(annuler)).toEqual({ trashed: true, historyId: 'cmd-a' })
    expect(await ligne('cmd-a')).toMatchObject({ statut: 'Supprimée', origin: 'draft' })

    expect(await call(annuler)).toEqual({ trashed: true, historyId: 'cmd-a', idempotent: true })
    expect(await soldes()).toEqual({ stock: 1000, liquidite: 500 })
    expect(await compter('history')).toBe(1)
  })

  it('[IDEM-10] d’une validée : renvoyée, elle répond « déjà faite » et ne rend le montant qu’une fois', async () => {
    await call({ action: 'add', transaction: tx({ statut: 'Validée' }), commandeId: 'cmd-v' })
    const annuler = { action: 'trashHistory', historyId: 'cmd-v', commandeId: 'cmd-a' }
    await call(annuler)
    expect(await soldes()).toEqual({ stock: 1000, liquidite: 500 })

    expect(await call(annuler)).toEqual({ trashed: true, historyId: 'cmd-v', idempotent: true })
    expect(await soldes()).toEqual({ stock: 1000, liquidite: 500 })
    expect(await compter('auditLogs')).toBe(2)
  })

  it('[IDEM-11] d’une ligne déjà annulée depuis un autre poste : le but est atteint, rien ne bouge', async () => {
    await call({ action: 'add', transaction: tx({ statut: 'Validée' }), commandeId: 'cmd-v' })
    await call({ action: 'trashHistory', historyId: 'cmd-v' })
    expect(await call({ action: 'trashHistory', historyId: 'cmd-v', commandeId: 'cmd-a' }))
      .toEqual({ trashed: true, historyId: 'cmd-v', idempotent: true })
    expect(await soldes()).toEqual({ stock: 1000, liquidite: 500 })
  })

  it('[IDEM-12] d’un retour : renvoyée, elle ne remonte le reste dû qu’une fois', async () => {
    await call(ravitailler({ commandeId: 'cmd-rav' }))
    await call({ action: 'returnReplenishment', replenishmentId: 'cmd-rav', amount: 100, balanceType: 'stock', commandeId: 'cmd-ret' })
    const annuler = { action: 'trashReplenishmentReturn', returnId: 'cmd-ret', commandeId: 'cmd-a' }
    await call(annuler)
    expect(await call(annuler)).toEqual({ trashed: true, returnId: 'cmd-ret', idempotent: true })
    expect((await ligne('cmd-rav')).remainingAmount).toBe(300)
    expect(await soldes()).toEqual({ stock: 1300, liquidite: 500 })
  })

  it('[IDEM-13] une validée partiellement réglée reste refusée, même avec un commandeId', async () => {
    await call({ action: 'add', transaction: tx({ statut: 'Validée' }), commandeId: 'cmd-v' })
    await db.doc(`clients/${STORE}/history/cmd-v`).update({ remainingAmount: 40, settlementStatus: 'partial' })
    await expect(call({ action: 'trashHistory', historyId: 'cmd-v', commandeId: 'cmd-a' }))
      .rejects.toMatchObject({ code: 'SETTLED_DRAFT_IMMUTABLE' })
  })
})

describe('TC-357 — deux boutiques', () => {
  it('[ISO-01] le même commandeId dans une autre boutique est une autre opération', async () => {
    await call(ravitailler({ commandeId: 'cmd-commun' }))
    const r = await call(ravitailler({ commandeId: 'cmd-commun' }), AUTRE_UID)
    expect(r.idempotent).toBeUndefined()
    expect(await soldes(AUTRE_STORE)).toEqual({ stock: 1300, liquidite: 500 })
    expect(await soldes()).toEqual({ stock: 1300, liquidite: 500 })
  })

  it('[ISO-02] une boutique ne peut ni annuler ni modifier la ligne d’une autre', async () => {
    await call({ action: 'add', transaction: tx(), commandeId: 'cmd-s' })
    await call({ action: 'add', transaction: tx({ statut: 'Validée' }), commandeId: 'cmd-v' })
    await expect(call({ action: 'trashDraft', draftId: 'cmd-s', commandeId: 'cmd-a1' }, AUTRE_UID)).rejects.toMatchObject({ code: 'SETTLEMENT_DRAFT_NOT_FOUND' })
    await expect(call({ action: 'trashHistory', historyId: 'cmd-v', commandeId: 'cmd-a2' }, AUTRE_UID)).rejects.toMatchObject({ code: 'STORE_TRANSACTION_NOT_FOUND' })
    await expect(call({ action: 'updateDraft', draftId: 'cmd-s', updates: { montant: 150 }, commandeId: 'cmd-m' }, AUTRE_UID)).rejects.toMatchObject({ code: 'SETTLEMENT_DRAFT_NOT_FOUND' })
    expect(await soldes()).toEqual({ stock: 800, liquidite: 600 })
    expect(await soldes(AUTRE_STORE)).toEqual({ stock: 1000, liquidite: 500 })
  })
})
