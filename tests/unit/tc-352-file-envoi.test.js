import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  ATTENTE_FORMULAIRE_MS, EN_ATTENTE, ENVOYEE, REESSAI_MS, REFUSEE,
  creerFileEnvoi, estRefusDefinitif,
} from '../../src/services/fileEnvoi.js'
import { stockageEnMemoire } from '../../src/services/stockageEnvois.js'

/**
 * TC-352 — la file d'envoi (lot G3b, docs/rester-dans-le-quota-gratuit.md §G3).
 *
 * Ce que ce fichier verrouille :
 * - une opération est écrite sur l'appareil AVANT d'être envoyée ;
 * - réseau présent, la caissière voit la réponse du serveur comme avant ;
 * - réseau absent, l'opération attend et repart seule, dans l'ordre ;
 * - un refus du serveur est définitif, une panne se retente ;
 * - jamais deux envois simultanés de la même opération depuis un onglet.
 */

/** Des minuteurs à la main : chaque `planifier` est gardé, et se déclenche sur demande. */
function horloge() {
  const h = { minuteurs: new Map(), suivant: 0 }
  h.planifier = (fn, ms) => { h.suivant += 1; h.minuteurs.set(h.suivant, { fn, ms }); return h.suivant }
  h.annulerPlan = (id) => h.minuteurs.delete(id)
  h.declencher = (ms) => {
    for (const [id, m] of [...h.minuteurs]) {
      if (m.ms === ms) { h.minuteurs.delete(id); m.fn() }
    }
  }
  h.planifies = (ms) => [...h.minuteurs.values()].filter((m) => m.ms === ms).length
  return h
}

const panne = () => Object.assign(new Error('internal'), { code: 'functions/internal' })
const refus = () => Object.assign(new Error('Stock Orange insuffisant.'), { code: 'INSUFFICIENT_STORE_BALANCE' })
const attendreQue = (condition) => vi.waitFor(async () => expect(await condition()).toBe(true))

function file({ executer = vi.fn(async () => ({ ok: true })), stockage = stockageEnMemoire() } = {}) {
  const h = horloge()
  let n = 0
  const f = creerFileEnvoi({
    stockage, executer, nouvelId: () => `op-${(n += 1)}`,
    planifier: h.planifier, annulerPlan: h.annulerPlan, maintenant: () => 1000 + n,
  })
  return { f, h, stockage, executer }
}

afterEach(() => vi.restoreAllMocks())

describe('TC-352 — réseau présent : rien ne change pour la caissière', () => {
  it('[FE-01] l’opération est écrite sur l’appareil avant de partir', async () => {
    const ordre = []
    const stockage = stockageEnMemoire()
    const ajouter = stockage.ajouter
    stockage.ajouter = async (op) => { ordre.push('écrite'); return ajouter(op) }
    const { f } = file({ stockage, executer: vi.fn(async () => { ordre.push('envoyée') }) })

    await f.soumettre('saisie', { transaction: { montant: 100 } })
    expect(ordre).toEqual(['écrite', 'envoyée'])
  })

  it('[FE-02] envoyée : la réponse du serveur revient au formulaire, et la file se vide', async () => {
    const { f, stockage, executer } = file({ executer: vi.fn(async () => ({ id: 'op-1' })) })
    const issue = await f.soumettre('saisie', { transaction: {} })

    expect(issue).toMatchObject({ statut: ENVOYEE, resultat: { id: 'op-1' } })
    expect(executer).toHaveBeenCalledWith(expect.objectContaining({ id: 'op-1', type: 'saisie', etat: EN_ATTENTE }))
    expect(await stockage.lister()).toEqual([])
  })

  it('[FE-03] refusée pendant l’attente : le formulaire reçoit le refus, et rien ne reste dans la file', async () => {
    const { f, stockage } = file({ executer: vi.fn(async () => { throw refus() }) })
    await expect(f.soumettre('saisie', {})).rejects.toMatchObject({ code: 'INSUFFICIENT_STORE_BALANCE' })
    expect(await stockage.lister()).toEqual([])
  })
})

describe('TC-352 — réseau absent : l’opération attend et repart seule', () => {
  it('[FE-04] une panne rend la main tout de suite, garde l’opération, et la renvoie 30 s plus tard', async () => {
    const executer = vi.fn().mockRejectedValueOnce(panne()).mockResolvedValueOnce({ id: 'op-1' })
    const { f, h, stockage } = file({ executer })

    expect(await f.soumettre('saisie', {})).toMatchObject({ statut: EN_ATTENTE })
    expect(await stockage.lister()).toEqual([expect.objectContaining({ id: 'op-1', etat: EN_ATTENTE, tentatives: 1, erreur: { code: 'functions/internal', message: 'internal' } })])
    expect(h.planifies(REESSAI_MS)).toBe(1)

    h.declencher(REESSAI_MS)
    await attendreQue(async () => (await stockage.lister()).length === 0)
    expect(executer).toHaveBeenCalledTimes(2)
  })

  it(`[FE-05] un serveur muet : la main revient au bout de ${ATTENTE_FORMULAIRE_MS / 1000} s, et l’opération part quand il répond`, async () => {
    let repondre
    const { f, h, stockage } = file({ executer: vi.fn(() => new Promise((r) => { repondre = r })) })
    const issue = f.soumettre('saisie', {})
    await attendreQue(async () => typeof repondre === 'function')

    h.declencher(ATTENTE_FORMULAIRE_MS)
    expect(await issue).toMatchObject({ statut: EN_ATTENTE })
    expect(await stockage.lister()).toHaveLength(1)

    repondre({ id: 'op-1' })
    await attendreQue(async () => (await stockage.lister()).length === 0)
  })

  it('[FE-06] refusée plus tard, elle reste visible avec sa raison, et les suivantes partent quand même', async () => {
    const executer = vi.fn()
      .mockRejectedValueOnce(panne())
      .mockRejectedValueOnce(refus())
      .mockResolvedValueOnce({ ok: true })
    const { f, h, stockage } = file({ executer })
    await f.soumettre('saisie', { n: 1 })
    await f.soumettre('reglement', { n: 2 }, { attente: 0 })

    h.declencher(REESSAI_MS)
    await attendreQue(async () => (await stockage.lister()).every((op) => op.etat === REFUSEE))
    const reste = await stockage.lister()
    expect(reste).toEqual([expect.objectContaining({ id: 'op-1', etat: REFUSEE, erreur: { code: 'INSUFFICIENT_STORE_BALANCE', message: 'Stock Orange insuffisant.' } })])
    expect(executer.mock.calls.map(([op]) => op.id)).toEqual(['op-1', 'op-1', 'op-2'])
  })

  it('[FE-07] dans l’ordre de saisie, et une panne arrête l’envoi des suivantes', async () => {
    const executer = vi.fn(async () => { throw panne() })
    const { f, stockage } = file({ executer })
    await f.soumettre('client', { n: 1 })
    await f.soumettre('saisie', { n: 2 })
    await f.soumettre('reglement', { n: 3 })

    expect(executer.mock.calls.map(([op]) => op.id)).toEqual(['op-1', 'op-1', 'op-1'])
    expect((await stockage.lister()).map((op) => op.id)).toEqual(['op-1', 'op-2', 'op-3'])
  })

  it('[FE-08] laissées par la session d’hier, elles partent au premier envoi', async () => {
    const stockage = stockageEnMemoire()
    await stockage.ajouter({ id: 'hier-1', type: 'saisie', charge: {}, etat: EN_ATTENTE, creeLe: 1, tentatives: 3, erreur: null })
    await stockage.ajouter({ id: 'hier-2', type: 'reglement', charge: {}, etat: EN_ATTENTE, creeLe: 2, tentatives: 3, erreur: null })
    const { f, executer } = file({ stockage })

    await f.vider()
    expect(executer.mock.calls.map(([op]) => op.id)).toEqual(['hier-1', 'hier-2'])
    expect(await stockage.lister()).toEqual([])
  })
})

describe('TC-352 — garde-fous', () => {
  it('[FE-09] deux envois demandés en même temps n’envoient chaque opération qu’une fois', async () => {
    const stockage = stockageEnMemoire()
    await stockage.ajouter({ id: 'a', type: 'saisie', charge: {}, etat: EN_ATTENTE, creeLe: 1, tentatives: 0, erreur: null })
    const { f, executer } = file({ stockage })

    await Promise.all([f.vider(), f.vider(), f.vider()])
    await attendreQue(async () => (await stockage.lister()).length === 0)
    expect(executer).toHaveBeenCalledTimes(1)
  })

  it('[FE-10] seule une opération refusée se retire ; une en attente, jamais', async () => {
    const executer = vi.fn().mockRejectedValueOnce(panne()).mockRejectedValueOnce(refus()).mockRejectedValue(panne())
    const { f, h, stockage } = file({ executer })
    await f.soumettre('saisie', {})
    await f.soumettre('saisie', {}, { attente: 0 })

    h.declencher(REESSAI_MS)
    await attendreQue(async () => (await stockage.lister())[0]?.etat === REFUSEE)
    expect(await f.retirer('op-2')).toBe(false)
    expect(await f.retirer('op-1')).toBe(true)
    expect((await stockage.lister()).map((op) => op.id)).toEqual(['op-2'])
  })

  it('[FE-11] les abonnés reçoivent la liste à chaque changement', async () => {
    const executer = vi.fn().mockRejectedValueOnce(panne()).mockResolvedValue({})
    const { f, h } = file({ executer })
    const vues = []
    f.abonner((ops) => vues.push(ops.map((op) => `${op.id}:${op.tentatives}`)))
    await f.soumettre('saisie', {})
    h.declencher(REESSAI_MS)
    await attendreQue(async () => vues.at(-1)?.length === 0)
    expect(vues).toContainEqual(['op-1:0'])
    expect(vues).toContainEqual(['op-1:1'])
  })

  it('[FE-12] arrêtée (déconnexion), elle ne relance plus rien', async () => {
    const { f, h, executer } = file({ executer: vi.fn(async () => { throw panne() }) })
    await f.soumettre('saisie', {})
    f.arreter()
    expect(h.planifies(REESSAI_MS)).toBe(0)
    await f.vider()
    expect(executer).toHaveBeenCalledTimes(1)
  })

  it('[FE-14] le même geste confirmé deux fois pendant qu’il attend n’entre qu’une fois', async () => {
    const { f, stockage } = file({ executer: vi.fn(async () => { throw panne() }) })
    await f.soumettre('reglement', { amount: 100 }, { id: 'reglement-cle' })
    expect(await f.soumettre('reglement', { amount: 100 }, { id: 'reglement-cle' })).toMatchObject({ statut: EN_ATTENTE })
    expect((await stockage.lister()).map((op) => op.id)).toEqual(['reglement-cle'])
  })

  it('[FE-13] ce qui est un refus, et ce qui se retente', () => {
    for (const code of ['INSUFFICIENT_STORE_BALANCE', 'SETTLEMENT_DRAFT_NOT_FOUND', 'CLIENT_DOUBLON', 'permission-denied', 'already-exists']) {
      expect(estRefusDefinitif({ code }), code).toBe(true)
    }
    for (const code of ['functions/internal', 'functions/unavailable', 'functions/deadline-exceeded', 'unavailable', '', undefined]) {
      expect(estRefusDefinitif({ code }), String(code)).toBe(false)
    }
    expect(estRefusDefinitif(new TypeError('Failed to fetch'))).toBe(false)
    // Le service de règlement laisse le code métier dans `details`.
    expect(estRefusDefinitif({ code: 'functions/failed-precondition', details: { code: 'SETTLEMENT_DRAFT_NOT_FOUND' } })).toBe(true)
  })
})
