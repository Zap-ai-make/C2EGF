import { describe, it, expect, vi, afterEach } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import {
  SEUIL_REOUVERTURE, ecouterAnnuaireGarde, ecouterAvecRepli, plusRecent,
} from '../../src/services/annuaireClients.js'
import { depuisStockage, ouvrirCopieAnnuaire, versStockage } from '../../src/services/copieAnnuaire.js'

/**
 * TC-350 — l'annuaire gardé sur l'appareil, relu par différence (lot G2,
 * docs/rester-dans-le-quota-gratuit.md §G2).
 *
 * Ce que ce fichier verrouille :
 * - avec une copie, la liste s'affiche sans attendre le réseau, et seules les
 *   tranches modifiées depuis la copie sont demandées ;
 * - seule une réponse du serveur devient la copie ou la fait avancer ;
 * - aucune modification n'est perdue : une tranche plus récente remplace
 *   toujours la connue, une plus ancienne jamais ;
 * - une copie absente, illisible ou impossible à enregistrer ramène au
 *   chargement complet, jamais à une liste vide.
 */

const ts = (seconds, nanoseconds = 0) => ({ seconds, nanoseconds })
const docTranche = (id, majLe, entrees) => ({ id, data: () => ({ majLe, entrees }) })
const ETAT = { id: '_etat', data: () => ({ complet: true, tranches: 64, fiches: 3 }) }
const serveur = (docs) => ({ depuisServeur: true, docs })
const cache = (docs) => ({ depuisServeur: false, docs })

/** Les deux écoutes simulées : chaque ouverture est gardée, avec sa fermeture. */
function sources(copie = null) {
  const s = { copie, tout: [], depuis: [] }
  s.ecouterTout = (cb) => {
    const e = { cb, ferme: false }
    s.tout.push(e)
    return () => { e.ferme = true }
  }
  s.ecouterDepuis = (depuis, cb) => {
    const e = { cb, depuis, ferme: false }
    s.depuis.push(e)
    return () => { e.ferme = true }
  }
  s.ouvertes = () => [...s.tout, ...s.depuis].filter((e) => !e.ferme)
  return s
}

/** Une copie en mémoire, au contrat de `ouvrirCopieAnnuaire`. */
function copieMemoire(tranches = null) {
  return {
    lire: vi.fn(async () => (tranches ? { tranches } : null)),
    enregistrer: vi.fn(async () => {}),
  }
}

const observateur = () => {
  const o = { recus: [], onError: vi.fn() }
  o.onNext = (valeur) => o.recus.push(valeur)
  o.derniers = () => o.recus.at(-1)?.clients.map((c) => c.id)
  return o
}

const COPIE = [
  { id: 't00', majLe: ts(100), entrees: { c1: { nom: 'OUEDRAOGO' } } },
  { id: 't01', majLe: ts(200, 500), entrees: { c2: { nom: 'KABORE' }, c3: { nom: 'SAWADOGO' } } },
]

afterEach(() => vi.restoreAllMocks())

describe('TC-350 — sans copie : le chargement complet devient la copie', () => {
  it('[AG-01] la première réponse du serveur s’affiche, s’enregistre entière, puis seuls les changements sont écoutés', () => {
    const s = sources()
    const o = observateur()
    ecouterAnnuaireGarde(s, o)

    expect(s.tout).toHaveLength(1)
    s.tout[0].cb(serveur([ETAT, docTranche('t00', ts(100), { c1: { nom: 'OUEDRAOGO' } }), docTranche('t01', ts(300, 7), { c2: {} })]))

    expect(o.recus).toEqual([{ complet: true, clients: [{ id: 'c1', nom: 'OUEDRAOGO' }, { id: 'c2' }] }])
    expect(s.tout[0].ferme).toBe(true)
    expect(s.depuis).toHaveLength(1)
    expect(s.depuis[0].depuis).toEqual(ts(300, 7))
  })

  it('[AG-01b] la copie enregistrée est complète et porte chaque tranche avec son majLe', async () => {
    const copie = copieMemoire()
    const s = sources(copie)
    ecouterAnnuaireGarde(s, observateur())
    await vi.waitFor(() => expect(s.tout).toHaveLength(1))

    s.tout[0].cb(serveur([ETAT, docTranche('t00', ts(100), { c1: { nom: 'A' } })]))

    expect(copie.enregistrer).toHaveBeenCalledTimes(1)
    expect(copie.enregistrer).toHaveBeenCalledWith(
      [{ id: 't00', majLe: ts(100), entrees: { c1: { nom: 'A' } } }],
      { complete: true },
    )
  })

  it('[AG-02] hors ligne : le cache de Firestore s’affiche s’il est complet, sans devenir la copie ni ouvrir le repli', async () => {
    const copie = copieMemoire()
    const s = sources(copie)
    const o = observateur()
    ecouterAnnuaireGarde(s, o)
    await vi.waitFor(() => expect(s.tout).toHaveLength(1))

    s.tout[0].cb(cache([]))
    expect(o.recus).toEqual([])

    s.tout[0].cb(cache([ETAT, docTranche('t00', ts(100), { c1: {} })]))
    expect(o.recus).toEqual([{ complet: true, clients: [{ id: 'c1' }] }])
    expect(copie.enregistrer).not.toHaveBeenCalled()
    expect(s.tout[0].ferme).toBe(false)
    expect(s.depuis).toHaveLength(0)
  })

  it('[AG-03] incomplet selon le serveur : le repli est demandé, et l’écoute attend que l’annuaire soit rempli', () => {
    const s = sources()
    const o = observateur()
    ecouterAnnuaireGarde(s, o)

    s.tout[0].cb(serveur([docTranche('t00', ts(100), { c1: {} })]))
    expect(o.recus).toEqual([{ complet: false, clients: [] }])
    expect(s.tout[0].ferme).toBe(false)

    s.tout[0].cb(serveur([ETAT, docTranche('t00', ts(150), { c1: {} })]))
    expect(o.recus.at(-1).complet).toBe(true)
    expect(s.depuis[0].depuis).toEqual(ts(150))
  })
})

describe('TC-350 — avec copie : 1 lecture si rien n’a changé', () => {
  it('[AG-04] la liste s’affiche avant toute réponse du réseau, et seule l’écoute des changements s’ouvre', async () => {
    const s = sources(copieMemoire(COPIE))
    const o = observateur()
    ecouterAnnuaireGarde(s, o)
    await vi.waitFor(() => expect(o.recus).toHaveLength(1))

    expect(o.recus[0]).toEqual({
      complet: true,
      clients: [{ id: 'c1', nom: 'OUEDRAOGO' }, { id: 'c2', nom: 'KABORE' }, { id: 'c3', nom: 'SAWADOGO' }],
    })
    expect(s.tout).toHaveLength(0)
    expect(s.depuis).toHaveLength(1)
    expect(s.depuis[0].depuis).toEqual(ts(200, 500))
  })

  it('[AG-05] une tranche modifiée remplace celle-là seule, s’enregistre seule, et la liste suit', async () => {
    const copie = copieMemoire(COPIE)
    const s = sources(copie)
    const o = observateur()
    ecouterAnnuaireGarde(s, o)
    await vi.waitFor(() => expect(s.depuis).toHaveLength(1))

    s.depuis[0].cb(serveur([docTranche('t00', ts(400), { c1: { nom: 'OUEDRAOGO Awa' }, c9: { nom: 'NOUVELLE' } })]))

    expect(copie.enregistrer).toHaveBeenCalledWith([{ id: 't00', majLe: ts(400), entrees: { c1: { nom: 'OUEDRAOGO Awa' }, c9: { nom: 'NOUVELLE' } } }], undefined)
    expect(o.recus.at(-1).clients).toEqual([
      { id: 'c1', nom: 'OUEDRAOGO Awa' }, { id: 'c9', nom: 'NOUVELLE' },
      { id: 'c2', nom: 'KABORE' }, { id: 'c3', nom: 'SAWADOGO' },
    ])
  })

  it('[AG-06] une fiche supprimée disparaît avec la réécriture de sa tranche', async () => {
    const s = sources(copieMemoire(COPIE))
    const o = observateur()
    ecouterAnnuaireGarde(s, o)
    await vi.waitFor(() => expect(s.depuis).toHaveLength(1))

    s.depuis[0].cb(serveur([docTranche('t01', ts(500), { c2: { nom: 'KABORE' } })]))
    expect(o.derniers()).toEqual(['c1', 'c2'])
  })

  it('[AG-07] une tranche déjà connue, ou plus ancienne, ne s’enregistre ni ne se réaffiche', async () => {
    const copie = copieMemoire(COPIE)
    const s = sources(copie)
    const o = observateur()
    ecouterAnnuaireGarde(s, o)
    await vi.waitFor(() => expect(s.depuis).toHaveLength(1))

    s.depuis[0].cb(serveur([docTranche('t01', ts(200, 500), { c2: {} }), docTranche('t00', ts(99), { perdu: {} })]))
    expect(copie.enregistrer).not.toHaveBeenCalled()
    expect(o.recus).toHaveLength(1)
  })

  it('[AG-08] une réponse du cache n’avance pas la copie', async () => {
    const copie = copieMemoire(COPIE)
    const s = sources(copie)
    const o = observateur()
    ecouterAnnuaireGarde(s, o)
    await vi.waitFor(() => expect(s.depuis).toHaveLength(1))

    s.depuis[0].cb(cache([docTranche('t00', ts(900), { c1: { nom: 'CACHE' } })]))
    expect(copie.enregistrer).not.toHaveBeenCalled()
    expect(o.recus).toHaveLength(1)
  })

  it(`[AG-09] au-delà de ${SEUIL_REOUVERTURE} tranches, l’écoute se rouvre depuis la plus récente ; en deçà, non`, async () => {
    const s = sources(copieMemoire(COPIE))
    ecouterAnnuaireGarde(s, observateur())
    await vi.waitFor(() => expect(s.depuis).toHaveLength(1))

    const lot = (n, base) => Array.from({ length: n }, (_, i) => docTranche(`t${10 + i}`, ts(base + i), {}))
    s.depuis[0].cb(serveur(lot(SEUIL_REOUVERTURE, 1000)))
    expect(s.depuis).toHaveLength(1)

    s.depuis[0].cb(serveur(lot(SEUIL_REOUVERTURE + 1, 2000)))
    expect(s.depuis[0].ferme).toBe(true)
    expect(s.depuis).toHaveLength(2)
    expect(s.depuis[1].depuis).toEqual(ts(2000 + SEUIL_REOUVERTURE))
  })

  it('[AG-10] le plus récent compare aussi les nanosecondes, et part de zéro sans majLe', () => {
    expect(plusRecent([{ majLe: ts(5, 10) }, { majLe: ts(5, 9) }, { majLe: null }])).toEqual(ts(5, 10))
    expect(plusRecent([{ majLe: null }])).toEqual(ts(0))
  })
})

describe('TC-350 — aucune panne de la copie n’atteint l’écran', () => {
  it('[AG-11] une copie illisible ramène au chargement complet', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const copie = { lire: vi.fn(async () => { throw new Error('QuotaExceededError') }), enregistrer: vi.fn(async () => {}) }
    const s = sources(copie)
    ecouterAnnuaireGarde(s, observateur())
    await vi.waitFor(() => expect(s.tout).toHaveLength(1))
  })

  it('[AG-12] un enregistrement raté ne change rien à la liste affichée', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const copie = { lire: vi.fn(async () => null), enregistrer: vi.fn(async () => { throw new Error('plein') }) }
    const s = sources(copie)
    const o = observateur()
    ecouterAnnuaireGarde(s, o)
    await vi.waitFor(() => expect(s.tout).toHaveLength(1))

    s.tout[0].cb(serveur([ETAT, docTranche('t00', ts(1), { c1: {} })]))
    expect(o.derniers()).toEqual(['c1'])
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled())
    expect(o.onError).not.toHaveBeenCalled()
  })

  it('[AG-13] une erreur d’écoute va à onError', () => {
    const s = sources()
    const o = observateur()
    ecouterAnnuaireGarde(s, o)
    s.tout[0].cb.onError(Object.assign(new Error('refusé'), { code: 'permission-denied' }))
    expect(o.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'permission-denied' }))
  })

  it('[AG-14] arrêté avant la lecture de la copie, rien ne s’ouvre ; arrêté ensuite, l’écoute se ferme et plus rien n’arrive', async () => {
    let rendre
    const lente = { lire: vi.fn(() => new Promise((r) => { rendre = r })), enregistrer: vi.fn(async () => {}) }
    const s1 = sources(lente)
    ecouterAnnuaireGarde(s1, observateur())()
    rendre({ tranches: COPIE })
    await Promise.resolve()
    expect(s1.ouvertes()).toHaveLength(0)

    const s2 = sources()
    const o = observateur()
    const arreter = ecouterAnnuaireGarde(s2, o)
    const cb = s2.tout[0].cb
    arreter()
    expect(s2.ouvertes()).toHaveLength(0)
    cb(serveur([ETAT, docTranche('t00', ts(1), { c1: {} })]))
    cb.onError(new Error('trop tard'))
    expect(o.recus).toEqual([])
    expect(o.onError).not.toHaveBeenCalled()
  })

  it('[AG-15] branché dans ecouterAvecRepli : avec une copie, globalClients n’est jamais écouté ; une erreur l’ouvre', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const s = sources(copieMemoire(COPIE))
    const repli = vi.fn(() => () => {})
    const o = observateur()
    ecouterAvecRepli({ // Comme `firestore.js`, qui passe le callback par normalizeSubscriptionObserver.
      ecouterAnnuaire: (cb) => ecouterAnnuaireGarde(s, { onNext: cb, onError: cb.onError }), ecouterRepli: repli }, {
      onNext: (clients) => o.recus.push({ clients }),
      onError: o.onError,
    })
    await vi.waitFor(() => expect(o.recus).toHaveLength(1))
    expect(o.recus[0].clients).toHaveLength(3)
    expect(repli).not.toHaveBeenCalled()

    s.depuis[0].cb.onError(Object.assign(new Error('refusé'), { code: 'permission-denied' }))
    expect(repli).toHaveBeenCalledTimes(1)
    expect(o.onError).not.toHaveBeenCalled()
  })
})

describe('TC-350 — la copie sur le disque rend les fiches telles que Firestore les donne', () => {
  const entrees = {
    c1: { nom: 'OUEDRAOGO', codeAgent: '', numeroAgent: '', createdAt: new Timestamp(1_762_000_000, 123_000_000), dateAjout: '06/11/2026' },
  }

  it('[CA-01] après le clonage d’IndexedDB, createdAt redevient un Timestamp, et les clés vides restent', () => {
    const relue = depuisStockage(structuredClone(versStockage({ id: 't00', majLe: new Timestamp(9, 8), entrees })), Timestamp)

    expect(relue.majLe).toEqual({ seconds: 9, nanoseconds: 8 })
    expect(relue.entrees.c1.createdAt).toBeInstanceOf(Timestamp)
    expect(relue.entrees.c1.createdAt.toMillis()).toBe(entrees.c1.createdAt.toMillis())
    expect(relue.entrees.c1).toHaveProperty('codeAgent', '')
    expect(relue.entrees.c1).toHaveProperty('numeroAgent', '')
    expect(relue.entrees.c1.dateAjout).toBe('06/11/2026')
  })

  it('[CA-02] sans IndexedDB, la lecture échoue — donc chargement complet, par AG-11', async () => {
    const copie = ouvrirCopieAnnuaire({ projet: 'demo-test', Timestamp, indexedDB: null })
    await expect(copie.lire()).rejects.toThrow(/IndexedDB indisponible/)
    await expect(copie.enregistrer([])).rejects.toThrow(/IndexedDB indisponible/)
  })
})
