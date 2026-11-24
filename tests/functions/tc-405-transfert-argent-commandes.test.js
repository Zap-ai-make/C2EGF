import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { storeTransactionCommandHandler } from '../../functions/src/storeTransactions/storeTransactionCommand.js'

/**
 * TC-405 — les quatre commandes des transferts d'argent
 * (docs/superpowers/specs/2026-11-23-transferts-argent-design.md, « Les commandes
 * du serveur » et « Tests d'acceptation »).
 *
 * Boutique A : option cochée. Boutique B : sans l'option. Soldes de départ :
 * stock 300 000, espèce 200 000.
 */

let app
let db
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
const A = { uid: 'ta-gerant-a', store: 'ta-boutique-a' }
const B = { uid: 'ta-gerant-b', store: 'ta-boutique-b' }

beforeAll(() => {
  if (PROJECT !== 'demo-akayis-test' || !/^(127\.0\.0\.1|localhost):\d+$/.test(HOST || '')) throw new Error('Émulateur demo requis')
  app = getApps().length ? getApps()[0] : initializeApp({ projectId: PROJECT })
  db = getFirestore(app)
})
afterAll(async () => { await deleteApp(app) })
beforeEach(async () => {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  for (const [{ uid, store }, option] of [[A, true], [B, false]]) {
    await db.doc(`users/${uid}`).set({ role: 'store_admin', active: true, storeId: store, name: 'Awa', email: `${uid}@c2egf.test` })
    await db.doc(`stores/${store}`).set({ active: true, name: store, adminUid: uid, transfertsArgent: option })
    await db.doc(`clients/${store}/networkBalances/current`).set({ balances: { Orange: { stock: 300_000, liquidite: 200_000 } } })
  }
})

const call = (data, qui = A) => storeTransactionCommandHandler({ auth: { uid: qui.uid }, data }, { db, FieldValue, logWriter: () => {} })
const soldes = async (qui = A) => (await db.doc(`clients/${qui.store}/networkBalances/current`).get()).data().balances.Orange
const lire = async (sous, id) => (await db.doc(`clients/${A.store}/${sous}/${id}`).get())
const refus = async promesse => promesse.then(() => { throw new Error('Aucun refus') }, e => e)

const saisie = overrides => ({
  service: 'Western Union',
  operation: 'transfert',
  nomClient: 'DIALLO Awa',
  montant: 50_000,
  balanceType: 'liquidite',
  ...overrides,
})
const ajouter = async (overrides, extra = {}) => (await call({ action: 'addMoneyTransfer', transaction: saisie(overrides), ...extra })).id

describe('TC-405 — la saisie', () => {
  it('[TC-405-01] T1 : transfert WU 50 000 reçu en Espèce, brouillon complet, sans champ d’agent', async () => {
    const id = await ajouter({ telephone: '70123456', codeTransfert: 'MTCN 123' })
    expect(await soldes()).toEqual({ stock: 300_000, liquidite: 250_000 })
    const ligne = (await lire('drafts', id)).data()
    expect(ligne).toMatchObject({
      type: 'Transfert argent', service: 'Western Union', operation: 'transfert', nomClient: 'DIALLO Awa',
      telephone: '70123456', codeTransfert: 'MTCN 123', balanceType: 'liquidite', montant: 50_000,
      montantTraite: 0, resteATraiter: 50_000, tranches: [], reseau: 'Orange', statut: 'Non Terminées',
      storeId: A.store, operatorId: A.uid,
    })
    expect(ligne).not.toHaveProperty('client')
    expect(ligne).not.toHaveProperty('clientId')
    expect(ligne).not.toHaveProperty('code')
  })

  it('[TC-405-02] nom compacté, téléphone sans espaces, lettres refusées', async () => {
    const id = await ajouter({ nomClient: '  DIALLO   Awa ', telephone: '70 12 34 56' })
    expect((await lire('drafts', id)).data()).toMatchObject({ nomClient: 'DIALLO Awa', telephone: '70123456' })
    const erreur = await refus(call({ action: 'addMoneyTransfer', transaction: saisie({ telephone: '70AB' }) }))
    expect(erreur.code).toBe('STORE_TRANSACTION_INVALID')
    expect(erreur.message).toBe('Téléphone : chiffres seulement.')
    expect((await refus(call({ action: 'addMoneyTransfer', transaction: saisie({ nomClient: '   ' }) }))).message)
      .toBe('Nom du client obligatoire (60 caractères au plus).')
    expect((await refus(call({ action: 'addMoneyTransfer', transaction: saisie({ service: 'Wari' }) }))).message)
      .toBe('Service : Western Union, Ria, MoneyGram ou Autres.')
  })

  it('[TC-405-03] « Précisez » n’est gardé qu’avec Autres', async () => {
    const wu = await ajouter({ servicePrecise: 'Wari' })
    expect((await lire('drafts', wu)).data()).not.toHaveProperty('servicePrecise')
    const autre = await ajouter({ service: 'Autres', servicePrecise: '  Wari ' })
    expect((await lire('drafts', autre)).data().servicePrecise).toBe('Wari')
  })

  it('[TC-405-04] R3 : retrait 250 000 payé en Espèce refusé, soldes intacts', async () => {
    const erreur = await refus(call({ action: 'addMoneyTransfer', transaction: saisie({ operation: 'retrait', montant: 250_000 }) }))
    expect(erreur).toBeInstanceOf(Error)
    expect(await soldes()).toEqual({ stock: 300_000, liquidite: 200_000 })
    expect((await db.collection(`clients/${A.store}/drafts`).get()).size).toBe(0)
  })
})

describe('TC-405 — les tranches', () => {
  it('[TC-405-05] T2 : transfert Ria 50 000 reçu en Stock, envoyé en 20 000 puis 30 000', async () => {
    const id = await ajouter({ service: 'Ria', balanceType: 'stock' })
    expect(await soldes()).toEqual({ stock: 350_000, liquidite: 200_000 })
    expect(await call({ action: 'settleMoneyTransfer', draftId: id, amount: 20_000 })).toEqual({ settled: true, resteATraiter: 30_000 })
    expect((await lire('drafts', id)).data()).toMatchObject({ montantTraite: 20_000, resteATraiter: 30_000 })
    expect(await call({ action: 'settleMoneyTransfer', draftId: id, amount: 30_000 })).toEqual({ settled: true, resteATraiter: 0, historyId: id })
    expect((await lire('drafts', id)).exists).toBe(false)
    const ligne = (await lire('history', id)).data()
    expect(ligne).toMatchObject({ statut: 'Validée', montantTraite: 50_000, resteATraiter: 0 })
    expect(ligne.tranches.map(t => t.montant)).toEqual([20_000, 30_000])
    expect(await soldes()).toEqual({ stock: 300_000, liquidite: 200_000 })
  })

  it('[TC-405-06] R1 : retrait MoneyGram 75 000 payé en Espèce, puis encaissé', async () => {
    const id = await ajouter({ service: 'MoneyGram', operation: 'retrait', montant: 75_000 })
    expect(await soldes()).toEqual({ stock: 300_000, liquidite: 125_000 })
    await call({ action: 'settleMoneyTransfer', draftId: id, amount: 75_000 })
    expect(await soldes()).toEqual({ stock: 375_000, liquidite: 125_000 })
    expect((await lire('history', id)).data().statut).toBe('Validée')
  })

  it('[TC-405-07] tranche au-delà du reste, ou d’un transfert au-delà du stock : refusée', async () => {
    const id = await ajouter({ montant: 50_000 })
    expect((await refus(call({ action: 'settleMoneyTransfer', draftId: id, amount: 60_000 }))).message).toMatch(/^Montant supérieur au reste\. Reste : 50/)
    await db.doc(`clients/${A.store}/networkBalances/current`).set({ balances: { Orange: { stock: 10_000, liquidite: 250_000 } } })
    expect(await refus(call({ action: 'settleMoneyTransfer', draftId: id, amount: 20_000 }))).toBeInstanceOf(Error)
    expect((await lire('drafts', id)).data().montantTraite).toBe(0)
  })
})

describe('TC-405 — la modification', () => {
  it('[TC-405-08] avant tranche : soldes recalculés et journal ; après tranche : figée ; l’opération ne change pas', async () => {
    const id = await ajouter({ operation: 'retrait', balanceType: 'stock', montant: 75_000 })
    expect(await soldes()).toEqual({ stock: 225_000, liquidite: 200_000 })
    await call({ action: 'updateMoneyTransfer', draftId: id, updates: { montant: 60_000, balanceType: 'liquidite', operation: 'transfert', nomClient: 'OUEDRAOGO Paul' } })
    expect(await soldes()).toEqual({ stock: 300_000, liquidite: 140_000 })
    const ligne = (await lire('drafts', id)).data()
    expect(ligne).toMatchObject({ operation: 'retrait', montant: 60_000, balanceType: 'liquidite', resteATraiter: 60_000, nomClient: 'OUEDRAOGO Paul' })
    expect(ligne.modifications.map(m => [m.avant, m.apres])).toEqual([[75_000, 60_000]])

    await call({ action: 'settleMoneyTransfer', draftId: id, amount: 10_000 })
    const erreur = await refus(call({ action: 'updateMoneyTransfer', draftId: id, updates: { montant: 50_000 } }))
    expect(erreur.code).toBe('SETTLED_DRAFT_IMMUTABLE')
    expect(erreur.message).toBe('Une opération déjà traitée en partie ne se modifie plus.')
  })
})

describe('TC-405 — l’annulation', () => {
  it('[TC-405-09] A1 : T2 annulé après l’envoi de 20 000', async () => {
    const id = await ajouter({ service: 'Ria', balanceType: 'stock' })
    await call({ action: 'settleMoneyTransfer', draftId: id, amount: 20_000 })
    expect(await soldes()).toEqual({ stock: 330_000, liquidite: 200_000 })
    const { historyId } = await call({ action: 'trashMoneyTransfer', draftId: id })
    expect(await soldes()).toEqual({ stock: 300_000, liquidite: 200_000 })
    expect((await lire('drafts', id)).exists).toBe(false)
    expect((await lire('history', historyId)).data()).toMatchObject({ statut: 'Supprimée', origin: 'draft', type: 'Transfert argent' })
  })

  it('[TC-405-10] A2 : R1 annulé avant encaissement', async () => {
    const id = await ajouter({ operation: 'retrait', montant: 75_000 })
    await call({ action: 'trashMoneyTransfer', draftId: id })
    expect(await soldes()).toEqual({ stock: 300_000, liquidite: 200_000 })
  })

  it('[TC-405-11] une ligne validée s’annule ; deux fois : refus sans commandeId, idempotent avec', async () => {
    const id = await ajouter({ balanceType: 'stock' })
    await call({ action: 'settleMoneyTransfer', draftId: id, amount: 50_000 })
    expect(await call({ action: 'trashMoneyTransfer', historyId: id })).toEqual({ trashed: true, historyId: id })
    expect(await soldes()).toEqual({ stock: 300_000, liquidite: 200_000 })
    expect((await refus(call({ action: 'trashMoneyTransfer', historyId: id }))).message).toBe('Cette opération a déjà été annulée.')
    expect(await call({ action: 'trashMoneyTransfer', historyId: id, commandeId: 'cmd-x' })).toMatchObject({ trashed: true, idempotent: true })
    expect(await soldes()).toEqual({ stock: 300_000, liquidite: 200_000 })
  })
})

describe('TC-405 — idempotence', () => {
  it('[TC-405-12] chaque commande rejouée avec son commandeId ne s’applique qu’une fois', async () => {
    const charge = { action: 'addMoneyTransfer', transaction: saisie({ balanceType: 'stock' }), commandeId: 'cmd-add' }
    expect(await call(charge)).toEqual({ id: 'cmd-add' })
    expect(await call(charge)).toEqual({ id: 'cmd-add', idempotent: true })
    expect(await soldes()).toEqual({ stock: 350_000, liquidite: 200_000 })

    const modif = { action: 'updateMoneyTransfer', draftId: 'cmd-add', updates: { montant: 40_000 }, commandeId: 'cmd-upd' }
    await call(modif)
    expect(await call(modif)).toMatchObject({ idempotent: true })
    expect(await soldes()).toEqual({ stock: 340_000, liquidite: 200_000 })

    const tranche = { action: 'settleMoneyTransfer', draftId: 'cmd-add', amount: 10_000, commandeId: 'cmd-t1' }
    await call(tranche)
    expect(await call(tranche)).toMatchObject({ idempotent: true })
    expect(await soldes()).toEqual({ stock: 330_000, liquidite: 200_000 })

    // La tranche qui solde, rejouée après le passage à l'historique.
    const derniere = { action: 'settleMoneyTransfer', draftId: 'cmd-add', amount: 30_000, commandeId: 'cmd-t2' }
    await call(derniere)
    expect(await call(derniere)).toMatchObject({ settled: true, resteATraiter: 0, historyId: 'cmd-add', idempotent: true })
    expect(await soldes()).toEqual({ stock: 300_000, liquidite: 200_000 })

    const corbeille = { action: 'trashMoneyTransfer', historyId: 'cmd-add', commandeId: 'cmd-del' }
    await call(corbeille)
    expect(await call(corbeille)).toMatchObject({ idempotent: true })
    expect(await soldes()).toEqual({ stock: 300_000, liquidite: 200_000 })
  })
})

describe('TC-405 — l’option de la boutique', () => {
  it('[TC-405-13] O2 : boutique sans l’option, la saisie est refusée', async () => {
    const erreur = await refus(call({ action: 'addMoneyTransfer', transaction: saisie() }, B))
    expect(erreur.code).toBe('STORE_TRANSACTION_INVALID')
    expect(erreur.message).toBe('Transferts d’argent non activés pour cette boutique.')
    expect(await soldes(B)).toEqual({ stock: 300_000, liquidite: 200_000 })
  })

  it('[TC-405-14] O1 : option décochée après saisie, la ligne se traite, se modifie et s’annule', async () => {
    const id = await ajouter({ balanceType: 'stock' })
    const autre = await ajouter({ balanceType: 'stock' })
    await db.doc(`stores/${A.store}`).update({ transfertsArgent: false })
    await call({ action: 'updateMoneyTransfer', draftId: id, updates: { montant: 40_000 } })
    await call({ action: 'settleMoneyTransfer', draftId: id, amount: 40_000 })
    await call({ action: 'trashMoneyTransfer', draftId: autre })
    expect(await soldes()).toEqual({ stock: 300_000, liquidite: 200_000 })
  })
})

describe('TC-405 — familles séparées', () => {
  it('[TC-405-15] les commandes du transfert refusent un remboursement au siège, et inversement', async () => {
    await db.doc(`clients/${A.store}/drafts/rs-1`).set({
      type: 'Remb. siège', balanceType: 'liquidite', montant: 100_000, envoyeAuSiege: 0, resteAuSiege: 100_000,
      envoisSiege: [], reseau: 'Orange', statut: 'Non Terminées', clientId: 'agent-1', storeId: A.store,
    })
    for (const commande of [
      { action: 'settleMoneyTransfer', draftId: 'rs-1', amount: 10_000 },
      { action: 'updateMoneyTransfer', draftId: 'rs-1', updates: { montant: 90_000 } },
      { action: 'trashMoneyTransfer', draftId: 'rs-1' },
    ]) {
      expect((await refus(call(commande))).message, commande.action).toBe('Cette ligne n’est pas un transfert d’argent.')
    }
    const id = await ajouter()
    for (const commande of [
      { action: 'sendToSiege', draftId: id, amount: 10_000 },
      { action: 'updateSiegeRepayment', draftId: id, updates: { montant: 40_000 } },
      { action: 'trashSiegeRepayment', draftId: id },
    ]) {
      expect((await refus(call(commande))).code, commande.action).toBe('STORE_TRANSACTION_INVALID')
    }
    expect(await soldes()).toEqual({ stock: 300_000, liquidite: 250_000 })
  })
})
