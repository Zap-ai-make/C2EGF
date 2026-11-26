import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { storeTransactionCommandHandler } from '../../functions/src/storeTransactions/storeTransactionCommand.js'
import { addTransactionPaymentHandler } from '../../functions/src/settlements/addTransactionPayment.js'

/**
 * TC-421 — La caissière accepte le remboursement que l'agent a lancé depuis
 * l'app (contrat demande-operation v10 §11.3).
 *
 * Accepter fait EXACTEMENT ce que fait « Encaisser » (`addTransactionPayment`),
 * avec le montant et le mode de l'agent, dans la transaction qui ferme la
 * demande. Tout se revérifie : la ligne a pu bouger depuis la demande. Un
 * remboursement siège devient une ligne « Remb. siège » toujours Non Terminées.
 */

let app
let db
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
const UID = 'remb-caisse'
const STORE = 'remb-boutique'
const HIER = Date.UTC(2026, 10, 25, 10, 42)

beforeAll(() => {
  if (PROJECT !== 'demo-akayis-test' || !/^(127\.0\.0\.1|localhost):\d+$/.test(HOST || '')) throw new Error('Émulateur demo requis')
  app = getApps().length ? getApps()[0] : initializeApp({ projectId: PROJECT })
  db = getFirestore(app)
})
afterAll(async () => { await deleteApp(app) })

const demande = (over = {}) => ({
  distributeurId: 'c2egf', compteOxygen: 'ox-1', liaisonId: 'L1', clientId: 'c1',
  agent: { nom: 'KABORE', prenom: 'Awa', code: '70123456' },
  boutiqueId: STORE, boutiqueNom: 'Boutique R', sens: 'depot', reseau: 'Orange', montant: 5000,
  saisieLe: Timestamp.fromMillis(HIER), etat: 'en_attente', creeLe: Timestamp.fromMillis(HIER),
  reponduLe: null, reponduPar: null, operationId: null,
  nature: 'remboursement', cibleId: 'op-1', mode: 'Cash',
  ...over,
})

const credit = (over = {}) => ({
  type: 'Dépôt', montant: 20_000, clientId: 'c1', client: { nom: 'KABORE', prenom: 'Awa' }, code: '70123456',
  reseau: 'Orange', statut: 'Non Terminées', storeId: STORE, createdAt: Timestamp.fromMillis(HIER), ...over,
})

beforeEach(async () => {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await Promise.all([
    db.doc(`users/${UID}`).set({ role: 'member', active: true, storeId: STORE, name: 'Caissière', email: 'c@c2egf.test' }),
    db.doc(`stores/${STORE}`).set({ active: true, name: 'Boutique R' }),
    db.doc(`clients/${STORE}/networkBalances/current`).set({ balances: { Orange: { stock: 100_000, liquidite: 50_000 } } }),
    db.doc('globalClients/c1').set({ nom: 'KABORE', prenom: 'Awa', orange: '70123456' }),
    db.doc(`clients/${STORE}/drafts/op-1`).set(credit()),
    db.doc(`clients/${STORE}/demandesAgent/r1`).set(demande()),
    db.doc(`clients/${STORE}/demandesAgent/r2`).set(demande({ montant: 20_000, mode: 'Orange Money' })),
    db.doc(`clients/${STORE}/demandesAgent/s1`).set(demande({ nature: 'remb_siege', cibleId: null, mode: 'Orange Money', montant: 3000 })),
    db.doc(`clients/${STORE}/demandesAgent/s2`).set(demande({ nature: 'remb_siege', cibleId: null, mode: 'Cash', montant: 3000 })),
  ])
})

const deps = () => ({ db, FieldValue, logWriter: () => {}, signalerOxygen: async () => {} })
const call = (data) => storeTransactionCommandHandler({ auth: { uid: UID }, data }, deps())
const accepter = (demandeId, enPlus = {}) => call({ action: 'acceptAgentRequest', demandeId, ...enPlus })
const rejeter = (demandeId) => call({ action: 'rejectAgentRequest', demandeId })
const encaisser = (amount, idempotencyKey) => addTransactionPaymentHandler(
  { auth: { uid: UID }, data: { draftId: 'op-1', amount, paymentMethod: 'Cash', idempotencyKey } },
  { db, FieldValue, logWriter: () => {} },
)
const soldes = async () => (await db.doc(`clients/${STORE}/networkBalances/current`).get()).data().balances.Orange
const lire = async (chemin) => (await db.doc(`clients/${STORE}/${chemin}`).get()).data()
const refus = async (promesse) => (await promesse.then(() => null, (e) => e))

describe('TC-421 — accepter un remboursement', () => {
  it('[TC-421-01] une tranche Cash de 5 000 sur la ligne visée, et la demande fermée', async () => {
    expect(await accepter('r1')).toMatchObject({ accepted: true, operationId: 'op-1', fullySettled: false })
    expect(await lire('demandesAgent/r1')).toMatchObject({ etat: 'validee', operationId: 'op-1', reponduPar: UID })
    const ligne = await lire('drafts/op-1')
    expect(ligne).toMatchObject({ paidAmount: 5000, remainingAmount: 15_000, settlementStatus: 'partial', statut: 'Non Terminées' })
    expect(ligne.reglements.map((r) => [r.montant, r.mode])).toEqual([[5000, 'Cash']])
    expect(await soldes()).toEqual({ stock: 100_000, liquidite: 55_000 })
    expect(await lire('drafts/op-1/settlements/pmt_op-1_demande_r1')).toMatchObject({ amount: 5000, paymentMethod: 'Cash', actorUid: UID })
  })

  it('[TC-421-02] le reste entier en Orange Money : la ligne passe dans l’historique, encaissée', async () => {
    expect(await accepter('r2')).toMatchObject({ accepted: true, operationId: 'op-1', fullySettled: true })
    expect(await lire('drafts/op-1')).toBeUndefined()
    const ligne = await lire('history/op-1')
    expect(ligne).toMatchObject({ statut: 'Encaissé par Orange Money', paymentMethod: 'Orange Money', remainingAmount: 0, paidAmount: 20_000 })
    expect(ligne.validatedAt).toBeDefined()
    expect(await soldes()).toEqual({ stock: 120_000, liquidite: 50_000 })
  })

  it('[TC-421-03] rejouée, l’acceptation ne fait pas de seconde tranche', async () => {
    await accepter('r1')
    expect(await accepter('r1')).toMatchObject({ accepted: true, operationId: 'op-1', idempotent: true })
    expect((await lire('drafts/op-1')).paidAmount).toBe(5000)
    expect(await soldes()).toEqual({ stock: 100_000, liquidite: 55_000 })
  })

  it('[TC-421-04] la caissière a encaissé entre-temps : le montant dépasse le reste, la demande attend', async () => {
    await db.doc(`clients/${STORE}/demandesAgent/r3`).set(demande({ montant: 15_000 }))
    await encaisser(10_000, 'k-1')
    const erreur = await refus(accepter('r3'))
    expect(erreur?.message).toBe(`Montant supérieur au reste dû (${(10_000).toLocaleString('fr-FR')} FCFA) : rejetez la demande.`)
    expect((await lire('demandesAgent/r3')).etat).toBe('en_attente')
    expect((await lire('drafts/op-1')).paidAmount).toBe(10_000)
  })

  it('[TC-421-05] la ligne est partie, ou a changé : « Accepter » refusé, « Rejeter » marche', async () => {
    await db.doc(`clients/${STORE}/drafts/op-1`).delete()
    expect((await refus(accepter('r1')))?.message).toBe('Cette ligne n’est plus en attente.')

    await db.doc(`clients/${STORE}/drafts/op-1`).set(credit({ clientId: 'c2' }))
    expect((await refus(accepter('r1')))?.message).toBe('Cette ligne a changé depuis la demande : rejetez-la.')
    await db.doc(`clients/${STORE}/drafts/op-1`).set(credit({ type: 'Retrait' }))
    expect((await refus(accepter('r1')))?.message).toBe('Cette ligne a changé depuis la demande : rejetez-la.')

    expect(await rejeter('r1')).toMatchObject({ rejected: true })
    expect(await soldes()).toEqual({ stock: 100_000, liquidite: 50_000 })
  })
})

describe('TC-421 — accepter un remboursement siège', () => {
  it('[TC-421-06] une ligne « Remb. siège » Non Terminées, dans la réserve du mode', async () => {
    expect(await accepter('s1')).toMatchObject({ accepted: true, operationId: 's1' })
    expect(await lire('drafts/s1')).toMatchObject({
      type: 'Remb. siège', statut: 'Non Terminées', balanceType: 'stock', montant: 3000,
      envoyeAuSiege: 0, resteAuSiege: 3000, clientId: 'c1', code: '70123456', demandeId: 's1',
    })
    expect(await soldes()).toEqual({ stock: 103_000, liquidite: 50_000 })

    await accepter('s2', { statut: 'Validée' })
    expect(await lire('drafts/s2')).toMatchObject({ statut: 'Non Terminées', balanceType: 'liquidite' })
    expect(await soldes()).toEqual({ stock: 103_000, liquidite: 53_000 })
  })
})

describe('TC-421 — une demande d’opération reste ce qu’elle était', () => {
  it('[TC-421-07] sans statut valable, refusée comme avant', async () => {
    const { nature: _nature, cibleId: _cible, mode: _mode, ...operation } = demande({ montant: 30_000 })
    await db.doc(`clients/${STORE}/demandesAgent/o1`).set(operation)
    expect((await refus(accepter('o1')))?.message).toBe('Statut initial non autorisé.')
  })
})
