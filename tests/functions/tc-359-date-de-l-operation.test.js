import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { storeTransactionCommandHandler } from '../../functions/src/storeTransactions/storeTransactionCommand.js'
import { addTransactionPaymentHandler } from '../../functions/src/settlements/addTransactionPayment.js'
import { instantDeLaCaisse } from '../../functions/src/instantDeLaCaisse.js'
import { STORE_TIME_ZONE } from '../../functions/src/config/storeProfile.js'

/**
 * TC-359 — une opération partie en retard garde le jour où elle a eu lieu (lot G4a,
 * docs/rester-dans-le-quota-gratuit.md §G4).
 *
 * La machine est éteinte le soir : une saisie de lundi soir, sans réseau, part mardi
 * matin. Datée de son envoi, elle compterait mardi dans l'historique et les rapports.
 *
 * La file envoie l'ÂGE de l'opération, pas une date : le serveur la situe sur sa
 * propre horloge. Une machine à l'heure fausse donne donc le bon jour, tant que
 * l'heure n'a pas changé entre la saisie et l'envoi.
 */

let app
let db
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
const UID = 'g4d-gerant'
const STORE = 'g4d-boutique'
const HEURE = 3_600_000
const JOUR = 24 * HEURE

beforeAll(() => {
  if (PROJECT !== 'demo-akayis-test' || !/^(127\.0\.0\.1|localhost):\d+$/.test(HOST || '')) throw new Error('Émulateur demo requis')
  app = getApps().length ? getApps()[0] : initializeApp({ projectId: PROJECT })
  db = getFirestore(app)
})
afterAll(async () => { await deleteApp(app) })
beforeEach(async () => {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await db.doc(`users/${UID}`).set({ role: 'store_admin', active: true, storeId: STORE, name: 'Gérant', email: 'g@c2egf.test' })
  await db.doc(`stores/${STORE}`).set({ active: true, name: 'Boutique', adminUid: UID })
  await db.doc(`clients/${STORE}/networkBalances/current`).set({ balances: { Orange: { stock: 1000, liquidite: 500 } } })
})

const deps = () => ({ db, FieldValue, logWriter: () => {} })
const call = (data) => storeTransactionCommandHandler({ auth: { uid: UID }, data }, deps())
const payer = (data) => addTransactionPaymentHandler({ auth: { uid: UID }, data }, deps())
const lire = async (id, sous = 'history') => (await db.doc(`clients/${STORE}/${sous}/${id}`).get()).data()
const tx = (extra) => ({ clientId: 'client-a', type: 'Dépôt', reseau: 'Orange', montant: 100, statut: 'Non Terminées', ...extra })
const jourFr = (ms) => new Intl.DateTimeFormat('fr-FR', { timeZone: STORE_TIME_ZONE }).format(new Date(ms))
const pres = (timestamp, attendu) => expect(Math.abs(timestamp.toMillis() - attendu)).toBeLessThan(30_000)

describe('TC-359 — instantDeLaCaisse', () => {
  const maintenant = 1_800_000_000_000
  it.each([
    ['une minute', 60_000],
    ['quatorze heures', 14 * HEURE],
    ['sept jours pile', 7 * JOUR],
  ])('[DAT-01] un âge de %s situe l’opération dans le passé', (_nom, age) => {
    expect(instantDeLaCaisse(age, maintenant)).toEqual(new Date(maintenant - age))
  })

  it.each([
    ['absent', undefined],
    ['nul', null],
    ['moins d’une minute : partie aussitôt', 59_999],
    ['négatif : l’horloge a reculé', -5_000],
    ['au-delà de sept jours', 7 * JOUR + 1],
    ['à virgule', 90_000.5],
    ['une chaîne', '90000'],
  ])('[DAT-02] un âge %s laisse la date du serveur', (_nom, age) => {
    expect(instantDeLaCaisse(age, maintenant)).toBeNull()
  })
})

describe('TC-359 — ce qui prend la date réelle', () => {
  it('[DAT-03] une saisie de la veille est datée de la veille, et garde l’heure de réception', async () => {
    const debut = Date.now()
    await call({ action: 'add', transaction: tx(), commandeId: 'cmd-s', ageMs: 26 * HEURE })
    const d = await lire('cmd-s', 'drafts')
    expect(d.date).toBe(jourFr(debut - 26 * HEURE))
    pres(d.createdAt, debut - 26 * HEURE)
    pres(d.recuLe, debut)
  })

  it('[DAT-04] une validée d’un geste aussi', async () => {
    const debut = Date.now()
    await call({ action: 'add', transaction: tx({ statut: 'Validée' }), commandeId: 'cmd-v', ageMs: 26 * HEURE })
    const d = await lire('cmd-v')
    expect(d.date).toBe(jourFr(debut - 26 * HEURE))
    pres(d.createdAt, debut - 26 * HEURE)
  })

  it('[DAT-05] un ravitaillement et son retour aussi', async () => {
    const debut = Date.now()
    await call({ action: 'replenish', amount: 300, balanceType: 'stock', expediteur: 'Mme Sawadogo', commandeId: 'cmd-r', ageMs: 30 * HEURE })
    await call({ action: 'returnReplenishment', replenishmentId: 'cmd-r', amount: 100, balanceType: 'stock', commandeId: 'cmd-t', ageMs: 29 * HEURE })
    const r = await lire('cmd-r')
    const t = await lire('cmd-t')
    expect(r.date).toBe(jourFr(debut - 30 * HEURE))
    pres(r.createdAt, debut - 30 * HEURE)
    pres(r.validatedAt, debut - 30 * HEURE)
    pres(r.recuLe, debut)
    expect(t.date).toBe(jourFr(debut - 29 * HEURE))
    pres(t.validatedAt, debut - 29 * HEURE)
  })

  it('[DAT-06] l’encaissement complet dit quand il a eu lieu, sans toucher à la date de saisie', async () => {
    const debut = Date.now()
    await call({ action: 'add', transaction: tx(), commandeId: 'cmd-s', ageMs: 30 * HEURE })
    await payer({ draftId: 'cmd-s', amount: 100, paymentMethod: 'Cash', idempotencyKey: 'k', ageMs: 26 * HEURE })
    const d = await lire('cmd-s')
    pres(d.createdAt, debut - 30 * HEURE)
    pres(d.validatedAt, debut - 26 * HEURE)
    pres(d.recuLe, debut)
  })

  it('[DAT-07] la correction : la ligne garde son jour, la revalidation et le journal disent quand', async () => {
    const debut = Date.now()
    await call({ action: 'add', transaction: tx({ statut: 'Validée' }), commandeId: 'cmd-v', ageMs: 30 * HEURE })
    await call({ action: 'correctHistory', historyId: 'cmd-v', updates: { montant: 80 }, commandeId: 'cmd-c', ageMs: 26 * HEURE })
    const d = await lire('cmd-c')
    expect(d.date).toBe(jourFr(debut - 30 * HEURE))
    pres(d.createdAt, debut - 30 * HEURE)
    pres(d.validatedAt, debut - 26 * HEURE)
    pres(d.modifications[0].at, debut - 26 * HEURE)
    pres(d.recuLe, debut)
  })

  it('[DAT-08] la modification et l’annulation : le journal et la corbeille disent quand', async () => {
    const debut = Date.now()
    await call({ action: 'add', transaction: tx(), commandeId: 'cmd-s', ageMs: 30 * HEURE })
    await call({ action: 'updateDraft', draftId: 'cmd-s', updates: { montant: 80 }, commandeId: 'cmd-m', ageMs: 29 * HEURE })
    pres((await lire('cmd-s', 'drafts')).modifications[0].at, debut - 29 * HEURE)

    await call({ action: 'trashDraft', draftId: 'cmd-s', commandeId: 'cmd-a', ageMs: 28 * HEURE })
    pres((await lire('cmd-a')).deletedAt, debut - 28 * HEURE)
    pres((await lire('cmd-a')).recuLe, debut)

    await call({ action: 'add', transaction: tx({ statut: 'Validée' }), commandeId: 'cmd-v' })
    await call({ action: 'trashHistory', historyId: 'cmd-v', commandeId: 'cmd-b', ageMs: 27 * HEURE })
    pres((await lire('cmd-v')).deletedAt, debut - 27 * HEURE)

    await call({ action: 'replenish', amount: 300, balanceType: 'stock', expediteur: 'Mme Sawadogo', commandeId: 'cmd-r' })
    await call({ action: 'returnReplenishment', replenishmentId: 'cmd-r', amount: 100, balanceType: 'stock', commandeId: 'cmd-t' })
    await call({ action: 'trashReplenishmentReturn', returnId: 'cmd-t', commandeId: 'cmd-u', ageMs: 26 * HEURE })
    pres((await lire('cmd-t')).deletedAt, debut - 26 * HEURE)
  })

  it('[DAT-09] sans âge, rien ne change : la date du serveur et pas d’heure de réception', async () => {
    const debut = Date.now()
    await call({ action: 'add', transaction: tx(), commandeId: 'cmd-s' })
    const d = await lire('cmd-s', 'drafts')
    expect(d.date).toBe(jourFr(debut))
    pres(d.createdAt, debut)
    expect(d.recuLe).toBeUndefined()
  })

  it('[DAT-10] un âge hors bornes est ignoré, l’opération passe quand même', async () => {
    const debut = Date.now()
    await call({ action: 'add', transaction: tx(), commandeId: 'cmd-s', ageMs: 8 * JOUR })
    const d = await lire('cmd-s', 'drafts')
    expect(d.date).toBe(jourFr(debut))
    expect(d.recuLe).toBeUndefined()
  })
})
