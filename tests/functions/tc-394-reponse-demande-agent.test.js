import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { storeTransactionCommandHandler } from '../../functions/src/storeTransactions/storeTransactionCommand.js'

/**
 * TC-394 — La caissière répond à une demande d'agent : `acceptAgentRequest` et
 * `rejectAgentRequest` (docs/superpowers/specs/2026-11-17-demandes-agent-design.md §5.3).
 *
 * Accepter crée l'opération SOUS L'IDENTIFIANT DE LA DEMANDE, dans la même
 * transaction qui ferme la demande : la trace et l'idempotence d'un seul coup.
 * Un refus (solde, demande annulée, fiche sans code) laisse tout en l'état.
 */

let app
let db
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
const UID = 'demande-caisse'
const STORE = 'demande-boutique'
const request = (data) => ({ auth: { uid: UID }, data })
const HIER = Date.UTC(2026, 10, 16, 10, 42)

beforeAll(() => {
  if (PROJECT !== 'demo-akayis-test' || !/^(127\.0\.0\.1|localhost):\d+$/.test(HOST || '')) throw new Error('Émulateur demo requis')
  app = getApps().length ? getApps()[0] : initializeApp({ projectId: PROJECT })
  db = getFirestore(app)
})
afterAll(async () => { await deleteApp(app) })

const demande = (over = {}) => ({
  distributeurId: 'c2egf', compteOxygen: 'ox-1', liaisonId: 'L1', clientId: 'c1',
  agent: { nom: 'KABORE', prenom: 'Awa', code: '70123456' },
  boutiqueId: STORE, boutiqueNom: 'Boutique D', sens: 'depot', reseau: 'Orange', montant: 30000,
  saisieLe: Timestamp.fromMillis(HIER), etat: 'en_attente', creeLe: Timestamp.fromMillis(HIER),
  reponduLe: null, reponduPar: null, operationId: null,
  ...over,
})

beforeEach(async () => {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await Promise.all([
    db.doc(`users/${UID}`).set({ role: 'member', active: true, storeId: STORE, name: 'Caissière', email: 'c@c2egf.test' }),
    db.doc(`stores/${STORE}`).set({ active: true, name: 'Boutique D' }),
    db.doc(`clients/${STORE}/networkBalances/current`).set({ balances: { Orange: { stock: 100000, liquidite: 50000 } } }),
    db.doc('globalClients/c1').set({ nom: 'KABORE', prenom: 'Awa', orange: '70123456', telephone: '0102' }),
    db.doc(`clients/${STORE}/demandesAgent/d1`).set(demande()),
  ])
})

const call = (data) => storeTransactionCommandHandler(request(data), { db, FieldValue, logWriter: () => {} })
const accepter = (demandeId, statut = 'Validée', over = {}) => call({ action: 'acceptAgentRequest', demandeId, statut, ...over })
const rejeter = (demandeId) => call({ action: 'rejectAgentRequest', demandeId })
const soldes = async () => (await db.doc(`clients/${STORE}/networkBalances/current`).get()).data().balances.Orange
const lireDemande = async (id = 'd1') => (await db.doc(`clients/${STORE}/demandesAgent/${id}`).get()).data()
const compter = async (sous) => (await db.collection(`clients/${STORE}/${sous}`).get()).size
const audits = async () => (await db.collection(`clients/${STORE}/auditLogs`).get()).docs.map((d) => d.data())

describe('TC-394 — accepter une demande', () => {
  it('[TC-394-01] Valider écrit l’opération sous l’id de la demande, avec ses deux jambes, et ferme la demande', async () => {
    expect(await accepter('d1')).toEqual({ accepted: true, operationId: 'd1', statut: 'Validée' })
    const op = (await db.doc(`clients/${STORE}/history/d1`).get()).data()
    expect(op).toMatchObject({
      type: 'Dépôt', reseau: 'Orange', montant: 30000, code: '70123456', clientId: 'c1', statut: 'Validée',
      directValidation: true, storeId: STORE, operatorId: UID,
      client: { id: 'c1', nom: 'KABORE', prenom: 'Awa', orange: '70123456' },
    })
    expect(op.client).not.toHaveProperty('telephone')
    expect(await lireDemande()).toMatchObject({ etat: 'validee', operationId: 'd1', reponduPar: UID })
    expect((await lireDemande()).reponduLe).toBeInstanceOf(Timestamp)
    expect(await soldes()).toEqual({ stock: 70000, liquidite: 80000 })
    expect(await audits()).toEqual([expect.objectContaining({ action: 'acceptAgentRequest', demandeId: 'd1', transactionId: 'd1' })])
  })

  it('[TC-394-02] Non terminée écrit un brouillon ordinaire : le stock sort, les espèces attendent', async () => {
    expect(await accepter('d1', 'Non Terminées')).toEqual({ accepted: true, operationId: 'd1', statut: 'Non Terminées' })
    expect((await db.doc(`clients/${STORE}/drafts/d1`).get()).data()).toMatchObject({ statut: 'Non Terminées', montant: 30000 })
    expect((await db.doc(`clients/${STORE}/history/d1`).get()).exists).toBe(false)
    expect(await soldes()).toEqual({ stock: 70000, liquidite: 50000 })
    expect(await lireDemande()).toMatchObject({ etat: 'validee', operationId: 'd1' })
  })

  it('[TC-394-03] rejouée après une réponse perdue, l’acceptation ne s’applique pas deux fois', async () => {
    await accepter('d1')
    const apres = await soldes()
    expect(await accepter('d1')).toEqual({ accepted: true, operationId: 'd1', idempotent: true })
    expect(await compter('history')).toBe(1)
    expect(await soldes()).toEqual(apres)
  })

  it('[TC-394-15] Non terminée sur un poste, Valider sur l’autre : le second apprend que la demande est déjà acceptée', async () => {
    // Rejouer, c'est redemander LE MÊME geste. Un autre statut n'est pas une
    // réponse perdue : c'est une deuxième caisse, qui ne doit pas croire avoir
    // validé ce qui attend encore d'être réglé.
    await accepter('d1', 'Non Terminées')
    const apres = await soldes()
    expect(await lireDemande()).toMatchObject({ etat: 'validee', statutInitial: 'Non Terminées' })
    await expect(accepter('d1', 'Validée')).rejects.toMatchObject({ code: 'DEMANDE_CLOSE', message: 'Cette demande a déjà été acceptée.' })
    expect(await accepter('d1', 'Non Terminées')).toEqual({ accepted: true, operationId: 'd1', idempotent: true })
    expect(await compter('history')).toBe(0)
    expect(await soldes()).toEqual(apres)
  })

  it('[TC-394-04] l’opération est datée de sa validation, côté serveur : ni l’heure du téléphone, ni un ageMs', async () => {
    const debut = Date.now() - 5000
    await accepter('d1', 'Validée', { ageMs: 3_600_000 })
    const op = (await db.doc(`clients/${STORE}/history/d1`).get()).data()
    expect(op.createdAt).toBeInstanceOf(Timestamp)
    expect(op.createdAt.toMillis()).toBeGreaterThanOrEqual(debut)
    expect(op).not.toHaveProperty('recuLe')
  })

  it('[TC-394-05] une demande que l’agent vient d’annuler ne se valide plus, et rien ne bouge', async () => {
    await db.doc(`clients/${STORE}/demandesAgent/d1`).update({ etat: 'annulee_agent', reponduLe: Timestamp.now() })
    await expect(accepter('d1')).rejects.toMatchObject({ code: 'DEMANDE_CLOSE', message: 'L’agent a annulé cette demande.' })
    expect(await compter('history')).toBe(0)
    expect(await compter('drafts')).toBe(0)
    expect(await soldes()).toEqual({ stock: 100000, liquidite: 50000 })
  })

  it('[TC-394-06] solde insuffisant : refus métier, la demande reste en attente, les soldes intacts', async () => {
    await db.doc(`clients/${STORE}/demandesAgent/d2`).set(demande({ sens: 'retrait', montant: 90000 }))
    await expect(accepter('d2')).rejects.toMatchObject({ code: 'INSUFFICIENT_STORE_BALANCE' })
    expect((await lireDemande('d2')).etat).toBe('en_attente')
    expect(await soldes()).toEqual({ stock: 100000, liquidite: 50000 })
  })

  it('[TC-394-07] demande absente, statut ou identifiant invalides, place déjà prise', async () => {
    await expect(accepter('d404')).rejects.toMatchObject({ code: 'STORE_TRANSACTION_NOT_FOUND' })
    await expect(accepter('d1', 'Annulée')).rejects.toMatchObject({ code: 'STORE_TRANSACTION_INVALID' })
    await expect(accepter('a/b')).rejects.toMatchObject({ code: 'STORE_TRANSACTION_INVALID' })
    await db.doc(`clients/${STORE}/demandesAgent/d3`).set(demande())
    await db.doc(`clients/${STORE}/drafts/d3`).set({ type: 'Dépôt', montant: 1 })
    await expect(accepter('d3', 'Non Terminées')).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    expect((await lireDemande('d3')).etat).toBe('en_attente')
  })

  it('[TC-394-08] une fiche qui a perdu son code Orange, ou disparue : refus clair, la demande attend', async () => {
    await db.doc('globalClients/c1').set({ nom: 'KABORE', prenom: 'Awa', codeAgent: '', numeroAgent: '' })
    await expect(accepter('d1')).rejects.toMatchObject({ code: 'STORE_TRANSACTION_INVALID' })
    await db.doc('globalClients/c1').delete()
    await expect(accepter('d1')).rejects.toMatchObject({ code: 'STORE_TRANSACTION_NOT_FOUND' })
    expect((await lireDemande()).etat).toBe('en_attente')
    expect(await soldes()).toEqual({ stock: 100000, liquidite: 50000 })
  })
})

describe('TC-394 — rejeter une demande', () => {
  it('[TC-394-09] Rejeter ferme la demande sans toucher aux soldes ; rejoué, rien de plus', async () => {
    expect(await rejeter('d1')).toEqual({ rejected: true })
    const d = await lireDemande()
    expect(d).toMatchObject({ etat: 'rejetee', reponduPar: UID, operationId: null })
    expect(d.reponduLe).toBeInstanceOf(Timestamp)
    expect(await soldes()).toEqual({ stock: 100000, liquidite: 50000 })
    expect(await audits()).toEqual([expect.objectContaining({ action: 'rejectAgentRequest', demandeId: 'd1' })])
    expect(await rejeter('d1')).toEqual({ rejected: true, idempotent: true })
    expect(await audits()).toHaveLength(1)
  })

  it('[TC-394-10] une demande déjà fermée autrement ne se rejette ni ne s’accepte', async () => {
    await accepter('d1')
    await expect(rejeter('d1')).rejects.toMatchObject({ code: 'DEMANDE_CLOSE' })
    await db.doc(`clients/${STORE}/demandesAgent/d2`).set(demande({ etat: 'rejetee' }))
    await expect(accepter('d2')).rejects.toMatchObject({ code: 'DEMANDE_CLOSE', message: 'Cette demande a déjà été rejetée.' })
    await db.doc(`clients/${STORE}/demandesAgent/d3`).set(demande({ etat: 'annulee_agent' }))
    await expect(rejeter('d3')).rejects.toMatchObject({ code: 'DEMANDE_CLOSE', message: 'L’agent a annulé cette demande.' })
  })

  it('[TC-394-11] la demande d’une autre boutique est introuvable pour cette caissière', async () => {
    await db.doc('clients/autre-boutique/demandesAgent/d9').set(demande({ boutiqueId: 'autre-boutique' }))
    await expect(accepter('d9')).rejects.toMatchObject({ code: 'STORE_TRANSACTION_NOT_FOUND' })
    await expect(rejeter('d9')).rejects.toMatchObject({ code: 'STORE_TRANSACTION_NOT_FOUND' })
    expect((await db.doc('clients/autre-boutique/demandesAgent/d9').get()).data().etat).toBe('en_attente')
  })
})

describe('TC-394 — l’opération garde la trace de sa demande (contrat §4.2)', () => {
  const historiques = async () => (await db.collection(`clients/${STORE}/history`).get()).docs.map((d) => d.data())

  it('[TC-394-12] validée d’un geste, la ligne d’historique porte demandeId', async () => {
    await accepter('d1')
    expect((await db.doc(`clients/${STORE}/history/d1`).get()).data().demandeId).toBe('d1')
  })

  it('[TC-394-13] passée en Non terminée puis validée, la ligne d’historique porte toujours demandeId', async () => {
    await accepter('d1', 'Non Terminées')
    expect((await db.doc(`clients/${STORE}/drafts/d1`).get()).data().demandeId).toBe('d1')
    await call({ action: 'validateDraft', draftId: 'd1', direct: true })
    expect(await historiques()).toEqual([expect.objectContaining({ demandeId: 'd1', statut: 'Validée' })])
  })

  it('[TC-394-14] une ligne rouverte pour correction garde demandeId', async () => {
    await accepter('d1')
    const { draftId } = await call({ action: 'reopenHistory', historyId: 'd1' })
    expect((await db.doc(`clients/${STORE}/drafts/${draftId}`).get()).data().demandeId).toBe('d1')
  })
})

describe('TC-394 — le signal à Oxygen quand la demande se ferme (contrat v9 §10)', () => {
  // Le signal relit la demande au moment où il part : il doit partir après l'écriture.
  const espion = () => {
    const appels = []
    const signalerOxygen = async (demandeId) => { appels.push({ demandeId, etat: (await lireDemande(demandeId)).etat }) }
    return { appels, signalerOxygen }
  }
  const avec = (deps) => (data) => storeTransactionCommandHandler(request(data), { db, FieldValue, logWriter: () => {}, ...deps })

  it('[TC-394-16] Valider signale la demande, déjà validée quand le signal part', async () => {
    const { appels, signalerOxygen } = espion()
    await avec({ signalerOxygen })({ action: 'acceptAgentRequest', demandeId: 'd1', statut: 'Validée' })
    expect(appels).toEqual([{ demandeId: 'd1', etat: 'validee' }])
  })

  it('[TC-394-17] Rejeter signale la demande, déjà rejetée quand le signal part', async () => {
    const { appels, signalerOxygen } = espion()
    await avec({ signalerOxygen })({ action: 'rejectAgentRequest', demandeId: 'd1' })
    expect(appels).toEqual([{ demandeId: 'd1', etat: 'rejetee' }])
  })

  it('[TC-394-18] ni le rejeu du même geste, ni un refus, ni une autre commande ne signalent', async () => {
    const { appels, signalerOxygen } = espion()
    const appeler = avec({ signalerOxygen })
    await appeler({ action: 'acceptAgentRequest', demandeId: 'd1', statut: 'Non Terminées' })
    await appeler({ action: 'acceptAgentRequest', demandeId: 'd1', statut: 'Non Terminées' })
    await appeler({ action: 'validateDraft', draftId: 'd1', direct: true })
    await db.doc(`clients/${STORE}/demandesAgent/d2`).set(demande({ sens: 'retrait', montant: 90000 }))
    await expect(appeler({ action: 'acceptAgentRequest', demandeId: 'd2', statut: 'Validée' })).rejects.toMatchObject({ code: 'INSUFFICIENT_STORE_BALANCE' })
    await db.doc(`clients/${STORE}/demandesAgent/d3`).set(demande())
    await appeler({ action: 'rejectAgentRequest', demandeId: 'd3' })
    await appeler({ action: 'rejectAgentRequest', demandeId: 'd3' })
    expect(appels.map((a) => a.demandeId)).toEqual(['d1', 'd3'])
  })

  it('[TC-394-19] un signal qui échoue ne change rien pour la caissière : une ligne de journal, c’est tout', async () => {
    const journal = []
    const signalerOxygen = async () => { throw Object.assign(new Error('Signal Oxygen : envoi 400'), { statut: 400 }) }
    const reponse = await avec({ signalerOxygen, logWriter: (ligne) => journal.push(ligne) })({ action: 'acceptAgentRequest', demandeId: 'd1', statut: 'Validée' })
    expect(reponse).toEqual({ accepted: true, operationId: 'd1', statut: 'Validée' })
    expect((await lireDemande()).etat).toBe('validee')
    expect(journal).toContainEqual({ severity: 'WARNING', event: 'OXYGEN_SIGNAL_ECHEC', demandeId: 'd1', statut: 400 })

    const lent = async () => { throw new DOMException('délai', 'TimeoutError') }
    await db.doc(`clients/${STORE}/demandesAgent/d2`).set(demande())
    expect(await avec({ signalerOxygen: lent, logWriter: (ligne) => journal.push(ligne) })({ action: 'rejectAgentRequest', demandeId: 'd2' })).toEqual({ rejected: true })
    expect(journal).toContainEqual({ severity: 'WARNING', event: 'OXYGEN_SIGNAL_ECHEC', demandeId: 'd2', erreur: 'TimeoutError' })
  })
})
