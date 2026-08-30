/**
 * TC-204 — `subscribeRetoursEnAttente` : le montant en transit (spec S4)
 *
 * Ce montant est un TERME DE RAPPROCHEMENT, pas un affichage : il ferme
 * l'identité « caisses + transit = fonds d'ouverture + envoyé − revenu ». Un
 * franc qui s'y perd fabrique un écart sans cause visible, sur l'écran même qui
 * sert à repérer les écarts. D'où des tests sur la somme, sur la requête, et
 * sur les documents que la somme doit REFUSER de prendre.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  onSnapshot: vi.fn(),
  where: vi.fn((champ, op, valeur) => ({ champ, op, valeur })),
  desabonner: vi.fn(),
}))

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => vi.fn()) }))
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => 'storeDealerTransfers'),
  doc: vi.fn(),
  onSnapshot: mocks.onSnapshot,
  query: vi.fn((...args) => args),
  where: mocks.where,
  orderBy: vi.fn(),
  limit: vi.fn(),
}))
vi.mock('../../src/config/firebase', () => ({ functions: {}, db: {} }))

import { subscribeRetoursEnAttente } from '../../src/services/storeTransferService'

/** Un instantané Firestore réduit à ce que la fonction en lit. */
const snapshot = (montants) => ({
  size: montants.length,
  docs: montants.map(amount => ({ data: () => ({ amount }) })),
})

/** Branche l'abonnement et rend la dernière valeur poussée. */
function ecouter({ dealerUid = 'dealer-1' } = {}) {
  let dernier = null
  mocks.onSnapshot.mockImplementation(() => mocks.desabonner)
  const desabonner = subscribeRetoursEnAttente({ dealerUid, onUpdate: (v) => { dernier = v } })
  const pousser = (snap) => mocks.onSnapshot.mock.calls.at(-1)[1](snap)
  const echouer = (err) => mocks.onSnapshot.mock.calls.at(-1)[2](err)
  return { lire: () => dernier, pousser, echouer, desabonner }
}

beforeEach(() => vi.clearAllMocks())

describe('TC-204 — les retours en attente, en nombre et en montant', () => {

  it('[TA-01] somme les montants des retours en attente', () => {
    const { lire, pousser } = ecouter()
    pousser(snapshot([640000, 1200000, 310000]))

    expect(lire()).toEqual({ nombre: 3, montant: 2150000, illisibles: 0 })
  })

  it('[TA-02] rend zéro, et non « — », quand aucun retour n’attend', () => {
    // Zéro est ici un montant JUSTE : aucun retour n'est en transit. C'est le
    // seul endroit de cet écran où zéro ne masque rien.
    const { lire, pousser } = ecouter()
    pousser(snapshot([]))

    expect(lire()).toEqual({ nombre: 0, montant: 0, illisibles: 0 })
  })

  it('[TA-03] RÈGLE — un montant illisible ne rentre pas en silence dans la somme', () => {
    const { lire, pousser } = ecouter()
    pousser({
      size: 4,
      docs: [
        { data: () => ({ amount: 500000 }) },
        { data: () => ({ amount: '300000' }) },   // chaîne : refusée
        { data: () => ({ amount: NaN }) },        // NaN : refusé
        { data: () => ({}) },                     // absent : refusé
      ],
    })

    // Le nombre reste 4 — ces retours existent —, mais la somme n'en compte
    // qu'un, et `illisibles` dit combien manquent. C'est ce compteur qui fera
    // suspendre le rapprochement au lieu d'afficher un écart sans cause.
    expect(lire()).toEqual({ nombre: 4, montant: 500000, illisibles: 3 })
  })

  it('[TA-04] n’écoute que les transferts EN ATTENTE qui ciblent ce dealer', () => {
    ecouter({ dealerUid: 'dealer-42' })

    expect(mocks.where).toHaveBeenCalledWith('dealerUid', '==', 'dealer-42')
    expect(mocks.where).toHaveBeenCalledWith('status', '==', 'pending')
    // Aucun `orderBy` ni `limit` : on somme la file entière, pas une page.
    expect(mocks.onSnapshot).toHaveBeenCalledTimes(1)
  })

  it('[TA-05] n’ouvre aucune écoute sans dealer, et rend un transit vide', () => {
    let recu = null
    const desabonner = subscribeRetoursEnAttente({ dealerUid: null, onUpdate: (v) => { recu = v } })

    expect(mocks.onSnapshot).not.toHaveBeenCalled()
    expect(recu).toEqual({ nombre: 0, montant: 0, illisibles: 0 })
    expect(() => desabonner()).not.toThrow()
  })

  it('[TA-06] remet le transit à vide si l’écoute échoue, et signale l’erreur', () => {
    const onError = vi.fn()
    mocks.onSnapshot.mockImplementation(() => mocks.desabonner)
    let recu = null
    subscribeRetoursEnAttente({ dealerUid: 'd', onUpdate: (v) => { recu = v }, onError })

    mocks.onSnapshot.mock.calls.at(-1)[1](snapshot([900000]))
    expect(recu.montant).toBe(900000)

    // ⚠ Sur erreur, on RETOMBE à zéro plutôt que de garder la dernière valeur :
    //   un transit périmé resterait dans le rapprochement sans que rien ne le
    //   dise, et l'écart afficherait un montant qui n'existe plus.
    mocks.onSnapshot.mock.calls.at(-1)[2]({ code: 'permission-denied' })
    expect(recu).toEqual({ nombre: 0, montant: 0, illisibles: 0 })
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('[TA-07] rend la fonction de désabonnement de Firestore', () => {
    const { desabonner } = ecouter()
    expect(desabonner).toBe(mocks.desabonner)
  })
})
