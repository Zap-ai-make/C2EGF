import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { storeTransactionCommandHandler } from '../../functions/src/storeTransactions/storeTransactionCommand.js'

/**
 * TC-351 — la saisie et la validation rejouées sans double effet (lot G3a,
 * docs/rester-dans-le-quota-gratuit.md §G3).
 *
 * Hors connexion, une opération attend dans une file d'envoi et part au retour
 * du réseau. Une réponse perdue en route fait renvoyer la même opération : le
 * serveur doit la reconnaître à son `commandeId` et ne pas l'appliquer deux
 * fois. Le règlement par tranche a déjà cette garde (`idempotencyKey`).
 *
 * CAR-xx caractérisent le comportement SANS `commandeId`, qui ne doit pas
 * bouger : ce sont tous les appels d'aujourd'hui.
 */

let app
let db
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
const UID = 'g3a-gerant'
const STORE = 'g3a-boutique'
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
  await db.doc(`stores/${STORE}`).set({ active: true, name: 'Boutique G3', adminUid: UID })
  await db.doc(`clients/${STORE}/networkBalances/current`).set({ balances: { Orange: { stock: 1000, liquidite: 500 } } })
})

const call = data => storeTransactionCommandHandler(request(data), { db, FieldValue, logWriter: () => {} })
const tx = overrides => ({ clientId: 'client-a', type: 'Dépôt', reseau: 'Orange', montant: 100, statut: 'Non Terminées', ...overrides })
const soldes = async () => (await db.doc(`clients/${STORE}/networkBalances/current`).get()).data().balances.Orange
const compter = async (sous) => (await db.collection(`clients/${STORE}/${sous}`).get()).size

describe('TC-351 — sans commandeId, rien ne change', () => {
  it('[CAR-01] une non terminée prend un identifiant tiré par le serveur et retire le stock', async () => {
    const r = await call({ action: 'add', transaction: tx() })
    expect(r.id).toMatch(/^[A-Za-z0-9]{20}$/)
    expect(await soldes()).toEqual({ stock: 900, liquidite: 500 })
    expect(await compter('drafts')).toBe(1)
    expect(await compter('auditLogs')).toBe(1)
  })

  it('[CAR-02] une validée d’un geste va dans l’historique avec ses deux jambes', async () => {
    const r = await call({ action: 'add', transaction: tx({ statut: 'Validée' }) })
    expect((await db.doc(`clients/${STORE}/history/${r.id}`).get()).data()).toMatchObject({ directValidation: true, montant: 100 })
    expect(await soldes()).toEqual({ stock: 900, liquidite: 600 })
  })

  it('[CAR-03] la même saisie envoyée deux fois s’applique deux fois : c’est le trou que G3a ferme', async () => {
    await call({ action: 'add', transaction: tx() })
    await call({ action: 'add', transaction: tx() })
    expect(await compter('drafts')).toBe(2)
    expect(await soldes()).toEqual({ stock: 800, liquidite: 500 })
  })

  it('[CAR-04] une validation rejouée rend `validated: false` sans toucher aux soldes', async () => {
    const { id } = await call({ action: 'add', transaction: tx() })
    const v = await call({ action: 'validateDraft', draftId: id, direct: true })
    expect(v.validated).toBe(true)
    expect(v.historyId).toMatch(/^[A-Za-z0-9]{20}$/)
    const apres = await soldes()
    expect(await call({ action: 'validateDraft', draftId: id, direct: true })).toEqual({ validated: false })
    expect(await soldes()).toEqual(apres)
  })

  it('[CAR-05] un solde insuffisant est refusé avec un code métier', async () => {
    await expect(call({ action: 'add', transaction: tx({ montant: 5000 }) }))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_STORE_BALANCE' })
    expect(await compter('drafts')).toBe(0)
  })
})

describe('TC-351 — avec commandeId, une opération ne s’applique qu’une fois', () => {
  it('[IDEM-01] la non terminée prend le commandeId pour identifiant ; rejouée, elle ne retire rien de plus', async () => {
    const r = await call({ action: 'add', transaction: tx(), commandeId: 'cmd-saisie-1' })
    expect(r.id).toBe('cmd-saisie-1')
    expect((await db.doc(`clients/${STORE}/drafts/cmd-saisie-1`).get()).data()).toMatchObject({ montant: 100, operatorId: UID })

    const rejouee = await call({ action: 'add', transaction: tx(), commandeId: 'cmd-saisie-1' })
    expect(rejouee).toEqual({ id: 'cmd-saisie-1', idempotent: true })
    expect(await compter('drafts')).toBe(1)
    expect(await compter('auditLogs')).toBe(1)
    expect(await soldes()).toEqual({ stock: 900, liquidite: 500 })
  })

  it('[IDEM-02] la validée d’un geste aussi, dans l’historique', async () => {
    await call({ action: 'add', transaction: tx({ statut: 'Validée' }), commandeId: 'cmd-directe-1' })
    expect(await call({ action: 'add', transaction: tx({ statut: 'Validée' }), commandeId: 'cmd-directe-1' }))
      .toEqual({ id: 'cmd-directe-1', idempotent: true })
    expect(await compter('history')).toBe(1)
    expect(await soldes()).toEqual({ stock: 900, liquidite: 600 })
  })

  it('[IDEM-03] rejouée alors que le solde ne suffirait plus, elle répond quand même « déjà faite »', async () => {
    await call({ action: 'add', transaction: tx({ montant: 1000 }), commandeId: 'cmd-tout' })
    expect(await soldes()).toEqual({ stock: 0, liquidite: 500 })
    expect(await call({ action: 'add', transaction: tx({ montant: 1000 }), commandeId: 'cmd-tout' }))
      .toEqual({ id: 'cmd-tout', idempotent: true })
  })

  it('[IDEM-04] la validation prend le commandeId pour ligne d’historique ; rejouée, elle répond « validée » sans rien refaire', async () => {
    await call({ action: 'add', transaction: tx(), commandeId: 'cmd-saisie-2' })
    const v = await call({ action: 'validateDraft', draftId: 'cmd-saisie-2', direct: true, commandeId: 'cmd-valide-2' })
    expect(v).toEqual({ validated: true, historyId: 'cmd-valide-2' })
    const apres = await soldes()

    const rejouee = await call({ action: 'validateDraft', draftId: 'cmd-saisie-2', direct: true, commandeId: 'cmd-valide-2' })
    expect(rejouee).toEqual({ validated: true, historyId: 'cmd-valide-2', idempotent: true })
    expect(await soldes()).toEqual(apres)
    expect(await compter('history')).toBe(1)
    expect(await compter('auditLogs')).toBe(2)
  })

  it('[IDEM-05] la saisie puis la validation, chacune envoyée deux fois, valent une saisie et une validation', async () => {
    for (let i = 0; i < 2; i += 1) await call({ action: 'add', transaction: tx(), commandeId: 'cmd-s' })
    for (let i = 0; i < 2; i += 1) await call({ action: 'validateDraft', draftId: 'cmd-s', paymentMethod: 'Cash', commandeId: 'cmd-v' })
    expect(await compter('drafts')).toBe(0)
    expect(await compter('history')).toBe(1)
    expect((await db.doc(`clients/${STORE}/history/cmd-v`).get()).data()).toMatchObject({ statut: 'Encaissé par Cash', montant: 100 })
  })

  it('[IDEM-06] un commandeId déjà pris par une autre ligne n’écrase rien', async () => {
    await call({ action: 'add', transaction: tx({ statut: 'Validée' }), commandeId: 'cmd-pris' })
    const { id } = await call({ action: 'add', transaction: tx() })
    await expect(call({ action: 'validateDraft', draftId: id, direct: true, commandeId: 'cmd-pris' }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    expect((await db.doc(`clients/${STORE}/drafts/${id}`).get()).exists).toBe(true)
    expect((await db.doc(`clients/${STORE}/history/cmd-pris`).get()).data()).toMatchObject({ directValidation: true })
  })

  it('[IDEM-07] un commandeId mal formé est refusé', async () => {
    await expect(call({ action: 'add', transaction: tx(), commandeId: '../drafts/x' }))
      .rejects.toMatchObject({ code: 'STORE_TRANSACTION_INVALID' })
    await expect(call({ action: 'add', transaction: tx(), commandeId: 42 }))
      .rejects.toMatchObject({ code: 'STORE_TRANSACTION_INVALID' })
  })

  // ⚠ L'ÉMULATEUR FERME PARFOIS L'UNE DES DEUX TRANSACTIONS sous contention
  //   (« Transaction is invalid or closed ») au lieu de la rejouer. Ce n'est
  //   pas un refus métier : la file d'envoi la renverra. Ce qui compte, et ce
  //   que ce test fige : jamais deux saisies, et le renvoi répond « déjà faite ».
  it('[IDEM-08] deux envois simultanés de la même saisie n’en font jamais deux', async () => {
    const issues = await Promise.allSettled([
      call({ action: 'add', transaction: tx(), commandeId: 'cmd-double' }),
      call({ action: 'add', transaction: tx(), commandeId: 'cmd-double' }),
    ])
    for (const i of issues.filter((x) => x.status === 'rejected')) {
      expect(String(i.reason?.code)).not.toMatch(/^[A-Z][A-Z0-9_]+$/)
    }
    // Le renvoi, comme le ferait la file : il applique la saisie si les deux
    // envois sont tombés, et répond « déjà faite » sinon. Jamais un second effet.
    await call({ action: 'add', transaction: tx(), commandeId: 'cmd-double' })
    expect(await call({ action: 'add', transaction: tx(), commandeId: 'cmd-double' }))
      .toEqual({ id: 'cmd-double', idempotent: true })
    expect(await compter('drafts')).toBe(1)
    expect(await soldes()).toEqual({ stock: 900, liquidite: 500 })
  }, 40000)
})
