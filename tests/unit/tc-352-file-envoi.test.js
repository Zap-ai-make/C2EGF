import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  EN_ATTENTE, REESSAI_MS, REFUSEE, SIGNAL_APRES_MS,
  attenteASignaler, creerFileEnvoi, estRefusDefinitif,
} from '../../src/services/fileEnvoi.js'
import { stockageEnMemoire } from '../../src/services/stockageEnvois.js'

/**
 * TC-352 — la file d'envoi (lot G3b, docs/rester-dans-le-quota-gratuit.md §G3).
 *
 * Ce que ce fichier verrouille :
 * - une opération est écrite sur l'appareil AVANT d'être envoyée ;
 * - la caissière n'attend jamais le réseau, même présent (lot H) ;
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
// L'envoi part derrière `soumettre` : on attend la fin d'un essai avant d'en juger.
const essais = async (stockage, id) => (await stockage.lister()).find((op) => op.id === id)?.tentatives ?? 0
const essaye = (stockage, id, n = 1) => attendreQue(async () => (await essais(stockage, id)) >= n)

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

describe('TC-352 — d’abord sur l’appareil, la caissière n’attend jamais (lot H)', () => {
  it('[FE-01] l’opération est écrite sur l’appareil avant de partir', async () => {
    const ordre = []
    const stockage = stockageEnMemoire()
    const ajouter = stockage.ajouter
    stockage.ajouter = async (op) => { ordre.push('écrite'); return ajouter(op) }
    const { f } = file({ stockage, executer: vi.fn(async () => { ordre.push('envoyée') }) })

    await f.soumettre('saisie', { transaction: { montant: 100 } })
    await attendreQue(() => ordre.length === 2)
    expect(ordre).toEqual(['écrite', 'envoyée'])
  })

  it('[FE-02] envoyée : la file se vide, et la réponse du serveur va à qui écoute les envois', async () => {
    const { f, stockage, executer } = file({ executer: vi.fn(async () => ({ id: 'op-1' })) })
    const recus = []
    f.apresEnvoi((op, resultat) => recus.push([op.id, op.type, resultat]))
    const issue = await f.soumettre('saisie', { transaction: {} })

    expect(issue).toMatchObject({ statut: EN_ATTENTE, operation: { id: 'op-1', type: 'saisie' } })
    await attendreQue(async () => (await stockage.lister()).length === 0)
    expect(executer).toHaveBeenCalledWith(expect.objectContaining({ id: 'op-1', type: 'saisie', etat: EN_ATTENTE }))
    expect(recus).toEqual([['op-1', 'saisie', { id: 'op-1' }]])
  })

  it('[FE-03] refusée : la main est déjà rendue, le refus reste dans la file avec sa raison', async () => {
    const { f, stockage } = file({ executer: vi.fn(async () => { throw refus() }) })
    const recus = []
    f.apresEnvoi((op) => recus.push(op.id))
    expect(await f.soumettre('saisie', {})).toMatchObject({ statut: EN_ATTENTE })
    await attendreQue(async () => (await stockage.lister())[0]?.etat === REFUSEE)
    expect((await stockage.lister())[0].erreur).toEqual({ code: 'INSUFFICIENT_STORE_BALANCE', message: 'Stock Orange insuffisant.' })
    expect(recus).toEqual([])
  })

  it('[FE-05] un serveur muet ne retient pas la caissière : la main revient tout de suite, l’opération part quand il répond', async () => {
    let repondre
    const { f, stockage } = file({ executer: vi.fn(() => new Promise((r) => { repondre = r })) })
    expect(await f.soumettre('saisie', {})).toMatchObject({ statut: EN_ATTENTE })
    await attendreQue(() => typeof repondre === 'function')
    expect(await stockage.lister()).toHaveLength(1)

    repondre({ id: 'op-1' })
    await attendreQue(async () => (await stockage.lister()).length === 0)
  })

  it('[FE-18] un écouteur qui lève n’arrête pas l’envoi des suivantes, et se désabonne', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { f, stockage } = file()
    const recus = []
    f.apresEnvoi(() => { throw new Error('écran démonté') })
    const desabonner = f.apresEnvoi((op) => recus.push(op.id))
    await f.soumettre('saisie', {})
    await attendreQue(() => recus.length === 1)
    await f.soumettre('saisie', {})
    await attendreQue(async () => (await stockage.lister()).length === 0)
    expect(recus).toEqual(['op-1', 'op-2'])

    desabonner()
    await f.soumettre('saisie', {})
    await attendreQue(async () => (await stockage.lister()).length === 0)
    expect(recus).toEqual(['op-1', 'op-2'])
  })
})

describe('TC-352 — réseau absent : l’opération attend et repart seule', () => {
  it('[FE-04] une panne rend la main tout de suite, garde l’opération, et la renvoie 30 s plus tard', async () => {
    const executer = vi.fn().mockRejectedValueOnce(panne()).mockResolvedValueOnce({ id: 'op-1' })
    const { f, h, stockage } = file({ executer })

    expect(await f.soumettre('saisie', {})).toMatchObject({ statut: EN_ATTENTE })
    await essaye(stockage, 'op-1')
    expect(await stockage.lister()).toEqual([expect.objectContaining({ id: 'op-1', etat: EN_ATTENTE, tentatives: 1, erreur: { code: 'functions/internal', message: 'internal' } })])
    expect(h.planifies(REESSAI_MS)).toBe(1)

    h.declencher(REESSAI_MS)
    await attendreQue(async () => (await stockage.lister()).length === 0)
    expect(executer).toHaveBeenCalledTimes(2)
  })

  it('[FE-06] refusée plus tard, elle reste visible avec sa raison, et les suivantes partent quand même', async () => {
    const executer = vi.fn()
      .mockRejectedValueOnce(panne())
      .mockRejectedValueOnce(refus())
      .mockResolvedValueOnce({ ok: true })
    const { f, stockage } = file({ executer })
    await f.soumettre('saisie', { n: 1 })
    await essaye(stockage, 'op-1')
    // Une nouvelle opération relance l'envoi, dans l'ordre : la première d'abord.
    await f.soumettre('reglement', { n: 2 })
    await attendreQue(async () => (await stockage.lister()).every((op) => op.etat === REFUSEE))
    const reste = await stockage.lister()
    expect(reste).toEqual([expect.objectContaining({ id: 'op-1', etat: REFUSEE, erreur: { code: 'INSUFFICIENT_STORE_BALANCE', message: 'Stock Orange insuffisant.' } })])
    expect(executer.mock.calls.map(([op]) => op.id)).toEqual(['op-1', 'op-1', 'op-2'])
  })

  it('[FE-07] dans l’ordre de saisie, et une panne arrête l’envoi des suivantes', async () => {
    const executer = vi.fn(async () => { throw panne() })
    const { f, stockage } = file({ executer })
    await f.soumettre('client', { n: 1 })
    await essaye(stockage, 'op-1', 1)
    await f.soumettre('saisie', { n: 2 })
    await essaye(stockage, 'op-1', 2)
    await f.soumettre('reglement', { n: 3 })
    await essaye(stockage, 'op-1', 3)

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
    const { f, stockage } = file({ executer })
    await f.soumettre('saisie', {})
    await essaye(stockage, 'op-1')
    await f.soumettre('saisie', {})
    await attendreQue(async () => (await stockage.lister())[0]?.etat === REFUSEE)
    expect(await f.retirer('op-2')).toBe(false)
    expect(await f.retirer('op-1')).toBe(true)
    expect((await stockage.lister()).map((op) => op.id)).toEqual(['op-2'])
  })

  it('[FE-11] les abonnés reçoivent la liste à chaque changement', async () => {
    const executer = vi.fn().mockRejectedValueOnce(panne()).mockResolvedValue({})
    const { f, h, stockage } = file({ executer })
    const vues = []
    f.abonner((ops) => vues.push(ops.map((op) => `${op.id}:${op.tentatives}`)))
    await f.soumettre('saisie', {})
    await essaye(stockage, 'op-1')
    h.declencher(REESSAI_MS)
    await attendreQue(async () => vues.at(-1)?.length === 0)
    expect(vues).toContainEqual(['op-1:0'])
    expect(vues).toContainEqual(['op-1:1'])
  })

  it('[FE-12] arrêtée (déconnexion), elle ne relance plus rien', async () => {
    const { f, h, executer, stockage } = file({ executer: vi.fn(async () => { throw panne() }) })
    await f.soumettre('saisie', {})
    await essaye(stockage, 'op-1')
    expect(h.planifies(REESSAI_MS)).toBe(1)
    f.arreter()
    expect(h.planifies(REESSAI_MS)).toBe(0)
    await f.vider()
    expect(executer).toHaveBeenCalledTimes(1)
  })

  it('[FE-14] le même geste confirmé deux fois pendant qu’il attend n’entre qu’une fois', async () => {
    const { f, stockage } = file({ executer: vi.fn(async () => { throw panne() }) })
    await f.soumettre('reglement', { amount: 100 }, { id: 'reglement-cle' })
    await essaye(stockage, 'reglement-cle')
    await f.soumettre('saisie', { n: 2 }, { id: 'apres' })
    expect(await f.soumettre('reglement', { amount: 100 }, { id: 'reglement-cle' })).toMatchObject({ statut: EN_ATTENTE })
    // Elle garde sa place et ses essais : la remettre en file la ferait passer
    // derrière une saisie qui dépend peut-être d'elle.
    const operations = await stockage.lister()
    expect(operations.map((op) => op.id)).toEqual(['reglement-cle', 'apres'])
    expect(operations[0].tentatives).toBeGreaterThan(0)
  })

  it('[FE-15] une requête partie sans jeton n’est pas un refus : le jeton se rafraîchit au prochain essai', async () => {
    const sansJeton = Object.assign(new Error('Vous devez être connecté.'), { code: 'UNAUTHENTICATED' })
    const executer = vi.fn().mockRejectedValueOnce(sansJeton).mockResolvedValueOnce({ id: 'op-1' })
    const { f, h, stockage } = file({ executer })

    expect(await f.soumettre('saisie', {})).toMatchObject({ statut: EN_ATTENTE })
    await essaye(stockage, 'op-1')
    expect((await stockage.lister())[0].etat).toBe(EN_ATTENTE)

    h.declencher(REESSAI_MS)
    await attendreQue(async () => (await stockage.lister()).length === 0)
  })

  it('[FE-16] un serveur antérieur au lot G3a ne perd rien : l’opération attend son déploiement', async () => {
    const enRetard = Object.assign(new Error('Le payload contient des champs non autorisés. [400]'), { code: 'INVALID_REQUEST_ID' })
    const { f, stockage } = file({ executer: vi.fn(async () => { throw enRetard }) })

    expect(await f.soumettre('saisie', {})).toMatchObject({ statut: EN_ATTENTE })
    await essaye(stockage, 'op-1')
    expect((await stockage.lister())[0].etat).toBe(EN_ATTENTE)
    // Le même code pour une autre raison reste un refus.
    expect(estRefusDefinitif({ code: 'INVALID_REQUEST_ID', message: 'Format de données invalide.' })).toBe(true)
  })

  it('[FE-17] la raison gardée n’a pas le statut HTTP que le SDK ajoute au message', async () => {
    const executer = vi.fn().mockRejectedValueOnce(panne()).mockRejectedValueOnce(
      Object.assign(new Error('Stock insuffisant pour Orange. [400]'), { code: 'INSUFFICIENT_STORE_BALANCE' }),
    )
    const { f, h, stockage } = file({ executer })
    await f.soumettre('saisie', {})
    await essaye(stockage, 'op-1')
    h.declencher(REESSAI_MS)
    await attendreQue(async () => (await stockage.lister())[0]?.etat === REFUSEE)
    expect((await stockage.lister())[0].erreur.message).toBe('Stock insuffisant pour Orange.')
  })

  it('[FE-19] l’écran ne signale l’attente qu’hors ligne, après un échec, ou passé le délai', () => {
    const op = (over = {}) => ({ etat: EN_ATTENTE, creeLe: 10_000, tentatives: 0, ...over })
    const juste = 10_000 + SIGNAL_APRES_MS
    expect(attenteASignaler([], { enLigne: false, maintenant: juste })).toBe(false)
    expect(attenteASignaler([op()], { enLigne: true, maintenant: juste - 1 })).toBe(false)
    expect(attenteASignaler([op()], { enLigne: true, maintenant: juste })).toBe(true)
    expect(attenteASignaler([op()], { enLigne: false, maintenant: 10_000 })).toBe(true)
    expect(attenteASignaler([op({ tentatives: 1 })], { enLigne: true, maintenant: 10_000 })).toBe(true)
    // Une seule en retard suffit : la plus récente ne cache pas l'ancienne.
    expect(attenteASignaler([op({ creeLe: 0 }), op({ creeLe: juste })], { enLigne: true, maintenant: juste })).toBe(true)
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
