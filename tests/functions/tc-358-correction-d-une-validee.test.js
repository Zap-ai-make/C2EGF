import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { storeTransactionCommandHandler } from '../../functions/src/storeTransactions/storeTransactionCommand.js'
import { addTransactionPaymentHandler } from '../../functions/src/settlements/addTransactionPayment.js'

/**
 * TC-358 — corriger une ligne validée d'un seul geste (lot G4a,
 * docs/rester-dans-le-quota-gratuit.md §G4).
 *
 * Hors connexion, la réouverture ne peut pas précéder le formulaire : la correction
 * part donc en une seule commande, `correctHistory`, qui fait dans une transaction
 * ce que `reopenHistory`, `updateDraft` et `validateDraft` font en trois.
 *
 * La référence de ce fichier est l'ENCHAÎNEMENT. Chaque sorte de ligne est corrigée
 * des deux façons, dans deux boutiques parties du même état : soldes et ligne
 * d'arrivée doivent être identiques. Une règle financière qui ne passerait que par
 * l'une des deux routes ferait échouer le test.
 */

let app
let db
const PROJECT = process.env.GCLOUD_PROJECT
const HOST = process.env.FIRESTORE_EMULATOR_HOST
const CHAINE = { uid: 'g4-chaine', store: 'g4-boutique-chaine' }
const GESTE = { uid: 'g4-geste', store: 'g4-boutique-geste' }

beforeAll(() => {
  if (PROJECT !== 'demo-akayis-test' || !/^(127\.0\.0\.1|localhost):\d+$/.test(HOST || '')) throw new Error('Émulateur demo requis')
  app = getApps().length ? getApps()[0] : initializeApp({ projectId: PROJECT })
  db = getFirestore(app)
})
afterAll(async () => { await deleteApp(app) })
beforeEach(async () => {
  await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  for (const { uid, store } of [CHAINE, GESTE]) {
    await db.doc(`users/${uid}`).set({ role: 'store_admin', active: true, storeId: store, name: 'Awa', email: 'awa@c2egf.test' })
    await db.doc(`stores/${store}`).set({ active: true, name: 'Boutique', adminUid: uid })
    await db.doc(`clients/${store}/networkBalances/current`).set({ balances: { Orange: { stock: 500_000, liquidite: 300_000 } } })
  }
})

const deps = () => ({ db, FieldValue, logWriter: () => {} })
const commande = ({ uid }, data) => storeTransactionCommandHandler({ auth: { uid }, data }, deps())
const payer = ({ uid }, data) => addTransactionPaymentHandler({ auth: { uid }, data }, deps())
const soldes = async ({ store }) => (await db.doc(`clients/${store}/networkBalances/current`).get()).data().balances.Orange
const ligne = async ({ store }, id) => (await db.doc(`clients/${store}/history/${id}`).get()).data()
const compter = async ({ store }, sous) => (await db.collection(`clients/${store}/${sous}`).get()).size

const transaction = (extra) => ({ clientId: 'client-1', client: { nom: 'Ouedraogo', prenom: 'Kader' }, type: 'Dépôt', reseau: 'Orange', code: '000111', montant: 100_000, statut: 'Non Terminées', ...extra })

/**
 * Les sortes de lignes validées qui existent en production, par leur vrai chemin.
 * Pas de crédit : le profil C2EGF n'autorise que le dépôt et le retrait.
 */
const SORTES = {
  'dépôt validé d’un geste': async (b) => (await commande(b, { action: 'add', transaction: transaction({ statut: 'Validée' }) })).id,
  'retrait validé d’un geste': async (b) => (await commande(b, { action: 'add', transaction: transaction({ type: 'Retrait', statut: 'Validée' }) })).id,
  'dépôt encaissé en Cash': async (b) => {
    const { id } = await commande(b, { action: 'add', transaction: transaction() })
    return (await commande(b, { action: 'validateDraft', draftId: id, paymentMethod: 'Cash' })).historyId
  },
  'retrait payé en Cash': async (b) => {
    const { id } = await commande(b, { action: 'add', transaction: transaction({ type: 'Retrait' }) })
    return (await commande(b, { action: 'validateDraft', draftId: id, paymentMethod: 'Cash' })).historyId
  },
  'dépôt encaissé en Orange Money': async (b) => {
    const { id } = await commande(b, { action: 'add', transaction: transaction() })
    return (await commande(b, { action: 'validateDraft', draftId: id, paymentMethod: 'Orange Money' })).historyId
  },
  'non terminée validée d’un geste': async (b) => {
    const { id } = await commande(b, { action: 'add', transaction: transaction() })
    return (await commande(b, { action: 'validateDraft', draftId: id, direct: true })).historyId
  },
  'validée sans règlement ni drapeau': async (b) => {
    const { id } = await commande(b, { action: 'add', transaction: transaction() })
    return (await commande(b, { action: 'validateDraft', draftId: id })).historyId
  },
  'dépôt réglé en deux tranches': async (b) => {
    const { id } = await commande(b, { action: 'add', transaction: transaction() })
    await payer(b, { draftId: id, amount: 40_000, paymentMethod: 'Cash', idempotencyKey: 'tranche-1' })
    await payer(b, { draftId: id, amount: 60_000, paymentMethod: 'Orange Money', idempotencyKey: 'tranche-2' })
    return (await db.collection(`clients/${b.store}/history`).get()).docs[0].id
  },
}

const CORRECTIONS = {
  'le montant baisse': { montant: 80_000 },
  'le montant monte': { montant: 130_000 },
  'le montant ne change pas': { code: '000222' },
}

/** L'enchaînement qui fait référence : ce que le navigateur faisait jusqu'ici. */
async function corrigerParLaChaine(b, historyId, updates) {
  const { draftId, direct } = await commande(b, { action: 'reopenHistory', historyId })
  const reouverte = (await db.doc(`clients/${b.store}/drafts/${draftId}`).get()).data()
  await commande(b, { action: 'updateDraft', draftId, updates })
  return (await commande(b, {
    action: 'validateDraft',
    draftId,
    paymentMethod: reouverte.reopenedPaymentMethod ?? null,
    amount: null,
    direct,
  })).historyId
}

// Ce qui diffère légitimement entre deux boutiques et deux instants.
const VOLATILS = ['createdAt', 'updatedAt', 'validatedAt', 'settlementUpdatedAt', 'reopenedAt', 'reopenedBy', 'reopenedFromHistoryId', 'storeId', 'operatorId', 'date']
const sansVolatils = (doc) => {
  const copie = { ...doc }
  for (const champ of VOLATILS) delete copie[champ]
  if (copie.modifications) copie.modifications = copie.modifications.map(({ avant, apres, byName }) => ({ avant, apres, byName }))
  return copie
}

describe('TC-358 — le geste vaut l’enchaînement', () => {
  for (const [sorte, creer] of Object.entries(SORTES)) {
    for (const [cas, updates] of Object.entries(CORRECTIONS)) {
      it(`${sorte}, ${cas}`, async () => {
        const idChaine = await creer(CHAINE)
        const idGeste = await creer(GESTE)
        expect(await soldes(GESTE)).toEqual(await soldes(CHAINE))

        const finChaine = await corrigerParLaChaine(CHAINE, idChaine, updates)
        const r = await commande(GESTE, { action: 'correctHistory', historyId: idGeste, updates })

        expect(await soldes(GESTE)).toEqual(await soldes(CHAINE))
        expect(sansVolatils(await ligne(GESTE, r.historyId))).toEqual(sansVolatils(await ligne(CHAINE, finChaine)))
        expect((await ligne(GESTE, r.historyId)).reopenedFromHistoryId).toBe(idGeste)
        expect(await ligne(GESTE, idGeste)).toBeUndefined()
        expect(await compter(GESTE, 'drafts')).toBe(0)
      })
    }
  }
})

describe('TC-358 — d’un seul geste, tout ou rien', () => {
  it('[COR-01] un montant que le stock ne couvre pas : refus, et la ligne reste telle quelle', async () => {
    const id = await SORTES['dépôt encaissé en Cash'](GESTE)
    const avantSoldes = await soldes(GESTE)
    const avantLigne = await ligne(GESTE, id)

    await expect(commande(GESTE, { action: 'correctHistory', historyId: id, updates: { montant: 900_000 } }))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_STORE_BALANCE' })

    expect(await soldes(GESTE)).toEqual(avantSoldes)
    expect(await ligne(GESTE, id)).toEqual(avantLigne)
    expect(await compter(GESTE, 'drafts')).toBe(0)
  })

  it('[COR-02] la ligne ne se bloque jamais dans les non terminées : un crédit corrigé d’un geste sans règlement est refusé en entier', async () => {
    await db.doc(`clients/${GESTE.store}/history/credit-sans-reglement`).set({
      ...transaction({ type: 'Crédit' }), statut: 'Validée', directValidation: true, storeId: GESTE.store,
    })
    const avantSoldes = await soldes(GESTE)
    await expect(commande(GESTE, { action: 'correctHistory', historyId: 'credit-sans-reglement', updates: { montant: 50_000 } })).rejects.toBeDefined()
    expect(await soldes(GESTE)).toEqual(avantSoldes)
    expect(await compter(GESTE, 'drafts')).toBe(0)
    expect((await ligne(GESTE, 'credit-sans-reglement')).montant).toBe(100_000)
  })

  it('[COR-03] une seule trace d’audit, qui dit d’où vient la ligne, et avant / après', async () => {
    const id = await SORTES['dépôt encaissé en Cash'](GESTE)
    const r = await commande(GESTE, { action: 'correctHistory', historyId: id, updates: { montant: 80_000 } })
    const audits = await db.collection(`clients/${GESTE.store}/auditLogs`).where('action', '==', 'correctHistory').get()
    expect(audits.size).toBe(1)
    expect(audits.docs[0].data()).toMatchObject({
      historyId: id,
      newHistoryId: r.historyId,
      uid: GESTE.uid,
      before: { montant: 100_000 },
      after: { montant: 80_000 },
    })
  })

  it('[COR-04] le journal retient le montant corrigé, une fois, et garde les corrections d’avant', async () => {
    const id = await SORTES['dépôt encaissé en Cash'](GESTE)
    const { historyId } = await commande(GESTE, { action: 'correctHistory', historyId: id, updates: { montant: 80_000 } })
    const { historyId: fin } = await commande(GESTE, { action: 'correctHistory', historyId, updates: { montant: 70_000 } })
    const { modifications } = await ligne(GESTE, fin)
    expect(modifications.map((m) => [m.avant, m.apres])).toEqual([[100_000, 80_000], [80_000, 70_000]])
  })

  it('[COR-05] un montant inchangé n’écrit rien au journal', async () => {
    const id = await SORTES['dépôt encaissé en Cash'](GESTE)
    const { historyId } = await commande(GESTE, { action: 'correctHistory', historyId: id, updates: { code: '000222' } })
    expect((await ligne(GESTE, historyId)).modifications).toBeUndefined()
  })
})

describe('TC-358 — renvoyée', () => {
  it('[COR-06] elle prend le commandeId pour ligne d’arrivée ; renvoyée, elle ne fait rien de plus', async () => {
    const id = await SORTES['dépôt encaissé en Cash'](GESTE)
    const geste = { action: 'correctHistory', historyId: id, updates: { montant: 80_000 }, commandeId: 'cmd-cor' }
    expect(await commande(GESTE, geste)).toMatchObject({ corrected: true, historyId: 'cmd-cor' })
    const apres = await soldes(GESTE)

    expect(await commande(GESTE, geste)).toEqual({ corrected: true, historyId: 'cmd-cor', idempotent: true })
    expect(await soldes(GESTE)).toEqual(apres)
    expect(await compter(GESTE, 'history')).toBe(1)
  })

  it('[COR-07] renvoyée quand le stock ne suffirait plus, elle répond quand même « déjà faite »', async () => {
    const id = await SORTES['dépôt encaissé en Cash'](GESTE)
    const geste = { action: 'correctHistory', historyId: id, updates: { montant: 80_000 }, commandeId: 'cmd-cor' }
    await commande(GESTE, geste)
    await commande(GESTE, { action: 'add', transaction: transaction({ montant: 420_000 }) })
    expect((await soldes(GESTE)).stock).toBe(0)
    expect(await commande(GESTE, geste)).toEqual({ corrected: true, historyId: 'cmd-cor', idempotent: true })
  })

  it('[COR-08] deux corrections de suite visent la ligne que la première a créée', async () => {
    const id = await SORTES['dépôt encaissé en Cash'](GESTE)
    await commande(GESTE, { action: 'correctHistory', historyId: id, updates: { montant: 80_000 }, commandeId: 'cmd-1' })
    await commande(GESTE, { action: 'correctHistory', historyId: 'cmd-1', updates: { montant: 70_000 }, commandeId: 'cmd-2' })
    expect((await ligne(GESTE, 'cmd-2')).montant).toBe(70_000)
    expect(await compter(GESTE, 'history')).toBe(1)
    expect(await soldes(GESTE)).toEqual({ stock: 430_000, liquidite: 370_000 })
  })
})

describe('TC-358 — ce qui ne se corrige pas', () => {
  it('[COR-09] un ravitaillement', async () => {
    const { id } = await commande(GESTE, { action: 'replenish', amount: 300, balanceType: 'stock', expediteur: 'Mme Sawadogo' })
    await expect(commande(GESTE, { action: 'correctHistory', historyId: id, updates: { montant: 200 } }))
      .rejects.toMatchObject({ code: 'STORE_TRANSACTION_INVALID' })
  })

  it('[COR-10] une ligne partiellement réglée, une ligne supprimée, une ligne inconnue', async () => {
    const id = await SORTES['dépôt encaissé en Cash'](GESTE)
    await db.doc(`clients/${GESTE.store}/history/${id}`).update({ remainingAmount: 40, settlementStatus: 'partial' })
    await expect(commande(GESTE, { action: 'correctHistory', historyId: id, updates: { montant: 200 } }))
      .rejects.toMatchObject({ code: 'SETTLED_DRAFT_IMMUTABLE' })

    const autre = await SORTES['dépôt validé d’un geste'](GESTE)
    await commande(GESTE, { action: 'trashHistory', historyId: autre })
    await expect(commande(GESTE, { action: 'correctHistory', historyId: autre, updates: { montant: 200 } }))
      .rejects.toMatchObject({ code: 'STORE_TRANSACTION_INVALID' })

    await expect(commande(GESTE, { action: 'correctHistory', historyId: 'inconnue', updates: { montant: 200 } }))
      .rejects.toMatchObject({ code: 'STORE_TRANSACTION_NOT_FOUND' })
  })

  it('[COR-11] la ligne d’une autre boutique est introuvable', async () => {
    const id = await SORTES['dépôt encaissé en Cash'](CHAINE)
    const avant = await soldes(CHAINE)
    await expect(commande(GESTE, { action: 'correctHistory', historyId: id, updates: { montant: 200 } }))
      .rejects.toMatchObject({ code: 'STORE_TRANSACTION_NOT_FOUND' })
    expect(await soldes(CHAINE)).toEqual(avant)
    expect((await ligne(CHAINE, id)).montant).toBe(100_000)
  })
})

describe('TC-358 — l’encaissement complet garde son numéro', () => {
  it('[NUM-01] la ligne d’historique prend l’identifiant de la non terminée : une annulation hors ligne peut la viser', async () => {
    const { id } = await commande(GESTE, { action: 'add', transaction: transaction(), commandeId: 'cmd-s' })
    const r = await payer(GESTE, { draftId: id, amount: 100_000, paymentMethod: 'Cash', idempotencyKey: 'tout' })
    expect(r.historyId).toBe('cmd-s')
    expect(await ligne(GESTE, 'cmd-s')).toMatchObject({ statut: 'Encaissé par Cash', remainingAmount: 0 })
    expect((await db.doc(`clients/${GESTE.store}/history/cmd-s/settlements/pmt_cmd-s_${GESTE.uid}_tout`).get()).exists).toBe(true)

    await commande(GESTE, { action: 'trashHistory', historyId: 'cmd-s', commandeId: 'cmd-a' })
    expect(await soldes(GESTE)).toEqual({ stock: 500_000, liquidite: 300_000 })
  })

  it('[NUM-02] une correction aussi, et le règlement renvoyé après elle ne recrée rien', async () => {
    await commande(GESTE, { action: 'add', transaction: transaction(), commandeId: 'cmd-s' })
    const reglement = { draftId: 'cmd-s', amount: 100_000, paymentMethod: 'Cash', idempotencyKey: 'tout' }
    await payer(GESTE, reglement)
    await commande(GESTE, { action: 'correctHistory', historyId: 'cmd-s', updates: { montant: 80_000 }, commandeId: 'cmd-c' })

    const rejeu = await payer(GESTE, reglement)
    expect(rejeu.idempotent).toBe(true)
    expect(await compter(GESTE, 'history')).toBe(1)
    expect(await soldes(GESTE)).toEqual({ stock: 420_000, liquidite: 380_000 })
  })
})
