/**
 * TC-020 — BalanceService : orchestration Firestore des soldes réseau
 *
 * Comportement à protéger :
 *   BalanceService (src/services/balanceService.js) encapsule toute la logique
 *   Firestore spécifique aux soldes réseau, extraite de FirestoreService :
 *     - getNetworkBalanceDocRef : chemin exact, activeStore lu à l'appel
 *     - ensureNetworkBalances   : read-then-create atomique via runTransaction
 *     - setNetworkBalance       : write atomique d'un champ via runTransaction
 *     - subscribeToNetworkBalances : onSnapshot avec unsubscribe, snapshot absent
 *     - setNetworkBalances      : setDoc merge avec updatedAt
 *
 *   La façade FirestoreService délègue chacune de ces méthodes à BalanceService
 *   sans changer les signatures, les valeurs de retour, les erreurs, ni le comportement
 *   async (toujours des Promises).
 *
 *   DraftService et HistoryService continuent d'utiliser getNetworkBalanceDocRef
 *   via ctx et accèdent au même document clients/{storeId}/networkBalances/current.
 *
 * Architecture des mocks :
 *   - runTransaction exécute réellement le callback (même pattern que TC-018/TC-019)
 *   - onSnapshot est mocké
 *   - setDoc est mocké
 *   - Les chemins Firestore sont vérifiés avec des valeurs concrètes
 *   - Pas de valeurs encodées artificiellement dans les mocks pour les paths
 *
 * Cas couverts (20 minimum) :
 *   TC-020-01  Chemin exact clients/{activeStore.id}/networkBalances/current
 *   TC-020-02  Deux boutiques produisent des chemins distincts
 *   TC-020-03  activeStore lu à l'appel, pas à la construction
 *   TC-020-04  ensureNetworkBalances — document existant
 *   TC-020-05  ensureNetworkBalances — document absent (création)
 *   TC-020-06  ensureNetworkBalances — document partiel
 *   TC-020-07  setNetworkBalance — nominal (un champ)
 *   TC-020-08  setNetworkBalance — réseau inconnu (créé avec défauts)
 *   TC-020-09  setNetworkBalance — montant négatif (ramené à 0)
 *   TC-020-10  setNetworkBalances — normalisation + merge
 *   TC-020-11  setNetworkBalances — updatedAt présent
 *   TC-020-12  subscribeToNetworkBalances — retourne une fonction unsubscribe
 *   TC-020-13  subscribeToNetworkBalances — snapshot existant transmis au callback
 *   TC-020-14  subscribeToNetworkBalances — snapshot absent transmis comme balances vides
 *   TC-020-15  subscribeToNetworkBalances — erreur loggée sans propagation
 *   TC-020-16  Façade FirestoreService propage les retours, erreurs et unsubscribe
 *   TC-020-17  Deux instances BalanceService restent isolées
 *   TC-020-18  Le seed de balances n'est pas muté
 *   TC-020-19  DraftService utilise toujours la référence de soldes correcte
 *   TC-020-20  HistoryService utilise toujours la référence de soldes correcte
 *   TC-020-21  getNetworkBalanceDocRef sans boutique active lève une erreur
 *   TC-020-22  setNetworkBalance utilise merge:true
 *   TC-020-23  ensureNetworkBalances : document existant → aucune écriture
 *   TC-020-24  setNetworkBalances : normalise les valeurs négatives à zéro
 */

// ---------------------------------------------------------------------------
// Mocks Firebase — obligatoires avant tout import
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn((_db, ...segments) => ({ _path: segments.join('/'), _isMockDoc: true })),
  getDoc: vi.fn(),
  addDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  onSnapshot: vi.fn(() => vi.fn()),
  query: vi.fn(),
  orderBy: vi.fn(),
  where: vi.fn(),
  getDocs: vi.fn(),
  limit: vi.fn(),
  startAfter: vi.fn(),
  writeBatch: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(() => 'mock-server-timestamp'),
}))

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(),
  connectAuthEmulator: vi.fn(),
}))

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({})),
  setLogLevel: vi.fn(),
  getApp: vi.fn(),
}))

vi.mock('../../src/config/firebase', () => ({
  db: {},
  auth: {},
  firebaseInfo: {},
  default: {},
}))

vi.mock('../../src/config/clientIsolation', () => ({
  CLIENT_ID: 'test-client',
  getStorageKey: vi.fn((key) => `test-client_${key}`),
  getFirestoreCollectionPath: vi.fn((name) => name),
}))

vi.mock('../../src/utils/cacheManager', () => ({
  default: {
    setFetchFunction: vi.fn(),
    get: vi.fn(() => null),
    set: vi.fn(),
    invalidate: vi.fn(),
    generateKey: vi.fn(() => 'mock-key'),
    clear: vi.fn(),
    invalidateCollection: vi.fn(),
  },
  cacheUtils: {
    invalidatePattern: vi.fn(),
    invalidateRelated: vi.fn(),
  },
}))

// ---------------------------------------------------------------------------
// Imports après mocks
// ---------------------------------------------------------------------------

import { BalanceService } from '../../src/services/balanceService.js'
import { FirestoreService } from '../../src/services/firestore.js'
import { DraftService } from '../../src/services/draftService.js'
import { HistoryService } from '../../src/services/historyService.js'
import { runTransaction, setDoc, onSnapshot } from 'firebase/firestore'

// ---------------------------------------------------------------------------
// Fixtures partagées (immutables)
// ---------------------------------------------------------------------------

const SEED_BALANCES = Object.freeze({
  Orange:  Object.freeze({ stock: 5000, liquidite: 2000 }),
  Moov:    Object.freeze({ stock: 3000, liquidite: 1000 }),
  Telecel: Object.freeze({ stock: 1000, liquidite:  300 }),
  Coris:   Object.freeze({ stock:  500, liquidite:  100 }),
  Sank:    Object.freeze({ stock:  200, liquidite:   50 }),
})

// ---------------------------------------------------------------------------
// Usine à BalanceService avec ctx mocké
// ---------------------------------------------------------------------------

function makeBalanceService(overrides = {}) {
  let _activeStoreId = 'store-020'

  const mockRequireActiveStore = vi.fn(() => {
    if (!_activeStoreId) throw new Error('Boutique active introuvable. Veuillez vous reconnecter.')
    return { id: _activeStoreId, name: 'Boutique 020' }
  })

  // docRef simulé : retourne un objet avec le chemin Firestore reconstruit
  const mockDocRef = vi.fn((col, id) => ({
    _type: 'doc',
    _col: col,
    _id: id,
    _store: _activeStoreId,
    _path: `clients/${_activeStoreId}/${col}/${id}`,
  }))

  // normalizeNetworkBalances : délègue à une implémentation minimale fidèle
  const mockNormalizeNetworkBalances = vi.fn((data) => {
    const source = data?.balances || data || {}
    const defaults = {
      Orange:  { stock: 0, liquidite: 0 },
      Moov:    { stock: 0, liquidite: 0 },
      Telecel: { stock: 0, liquidite: 0 },
      Coris:   { stock: 0, liquidite: 0 },
      Sank:    { stock: 0, liquidite: 0 },
    }
    const result = { ...defaults }
    Object.entries(source).forEach(([network, value]) => {
      if (!value || typeof value !== 'object') return
      result[network] = {
        stock:     Math.max(0, Number(value.stock)     || 0),
        liquidite: Math.max(0, Number(value.liquidite) || 0),
      }
    })
    return result
  })

  const ctx = {
    requireActiveStore: mockRequireActiveStore,
    docRef: mockDocRef,
    normalizeNetworkBalances: mockNormalizeNetworkBalances,
    ...overrides,
  }

  const service = new BalanceService({ ctx })

  return {
    service,
    ctx,
    mockRequireActiveStore,
    mockDocRef,
    mockNormalizeNetworkBalances,
    setActiveStoreId: (id) => { _activeStoreId = id },
  }
}

// Usine à mock de runTransaction — exécute réellement le callback
function makeTxMock({
  balanceData   = SEED_BALANCES,
  balanceExists = true,
} = {}) {
  const capturedWrites = []

  const mockTx = {
    get: vi.fn(async (ref) => {
      if (ref._type === 'doc') {
        return {
          exists: () => balanceExists,
          data:   () => (balanceExists ? { balances: { ...balanceData } } : null),
        }
      }
      return { exists: () => false, data: () => null }
    }),
    set: vi.fn((ref, data, options) => { capturedWrites.push({ op: 'set', ref, data, options }) }),
    update: vi.fn((ref, patch) => { capturedWrites.push({ op: 'update', ref, patch }) }),
    delete: vi.fn((ref) => { capturedWrites.push({ op: 'delete', ref }) }),
  }

  vi.mocked(runTransaction).mockImplementation(async (_db, callback) => callback(mockTx))

  return { capturedWrites, mockTx }
}

// ---------------------------------------------------------------------------
// TC-020-01 — Chemin exact clients/{activeStore.id}/networkBalances/current
// ---------------------------------------------------------------------------

describe('TC-020-01 — chemin exact du document de soldes', () => {
  beforeEach(() => { vi.mocked(runTransaction).mockClear() })

  it('getNetworkBalanceDocRef construit le chemin clients/store-020/networkBalances/current', () => {
    const { service, mockDocRef } = makeBalanceService()

    const ref = service.getNetworkBalanceDocRef()

    expect(mockDocRef).toHaveBeenCalledWith('networkBalances', 'current')
    expect(ref._path).toBe('clients/store-020/networkBalances/current')
  })
})

// ---------------------------------------------------------------------------
// TC-020-02 — Deux boutiques produisent des chemins distincts
// ---------------------------------------------------------------------------

describe('TC-020-02 — deux boutiques produisent des chemins distincts', () => {
  it('storeA et storeB ont des _path différents', () => {
    const serviceA = makeBalanceService()
    serviceA.setActiveStoreId('storeA')

    const serviceB = makeBalanceService()
    serviceB.setActiveStoreId('storeB')

    const refA = serviceA.service.getNetworkBalanceDocRef()
    const refB = serviceB.service.getNetworkBalanceDocRef()

    expect(refA._path).toBe('clients/storeA/networkBalances/current')
    expect(refB._path).toBe('clients/storeB/networkBalances/current')
    expect(refA._path).not.toBe(refB._path)
  })
})

// ---------------------------------------------------------------------------
// TC-020-03 — activeStore lu à l'appel, pas à la construction
// ---------------------------------------------------------------------------

describe('TC-020-03 — activeStore lu à l\'appel (pas à la construction)', () => {
  it('le chemin reflète le storeId au moment de l\'appel', () => {
    const { service, setActiveStoreId, mockDocRef } = makeBalanceService()

    // Changer le storeId après construction
    setActiveStoreId('store-late')
    service.getNetworkBalanceDocRef()

    const [, id] = mockDocRef.mock.calls[0]
    expect(id).toBe('current')
    // _store dans le résultat reflète le storeId au moment de l'appel
    const ref = service.getNetworkBalanceDocRef()
    expect(ref._store).toBe('store-late')
  })
})

// ---------------------------------------------------------------------------
// TC-020-04 — ensureNetworkBalances : document existant → retourne les balances existantes
// ---------------------------------------------------------------------------

describe('TC-020-04 — ensureNetworkBalances document existant', () => {
  beforeEach(() => { vi.mocked(runTransaction).mockClear() })

  it('retourne les balances normalisées existantes sans écriture', async () => {
    const { service, mockNormalizeNetworkBalances } = makeBalanceService()
    const { capturedWrites } = makeTxMock({ balanceExists: true, balanceData: SEED_BALANCES })

    const result = await service.ensureNetworkBalances({})

    expect(runTransaction).toHaveBeenCalledOnce()
    // Document existait → pas de tx.set
    expect(capturedWrites).toHaveLength(0)
    // normalizeNetworkBalances appelé avec les données du snapshot
    expect(mockNormalizeNetworkBalances).toHaveBeenCalled()
    // Le résultat contient les clés Orange, Moov, etc.
    expect(result).toHaveProperty('Orange')
    expect(result.Orange.stock).toBe(5000)
  })
})

// ---------------------------------------------------------------------------
// TC-020-05 — ensureNetworkBalances : document absent → création
// ---------------------------------------------------------------------------

describe('TC-020-05 — ensureNetworkBalances document absent', () => {
  beforeEach(() => { vi.mocked(runTransaction).mockClear() })

  it('crée le document avec les balances initiales normalisées', async () => {
    const { service } = makeBalanceService()
    const { capturedWrites } = makeTxMock({ balanceExists: false })

    const initialBalances = { Orange: { stock: 1000, liquidite: 500 } }
    await service.ensureNetworkBalances(initialBalances)

    expect(capturedWrites).toHaveLength(1)
    expect(capturedWrites[0].op).toBe('set')
    expect(capturedWrites[0].data).toHaveProperty('balances')
    expect(capturedWrites[0].data).toHaveProperty('updatedAt', 'mock-server-timestamp')
    // Les balances normalisées incluent les défauts pour les réseaux absents
    expect(capturedWrites[0].data.balances).toHaveProperty('Orange')
    expect(capturedWrites[0].data.balances).toHaveProperty('Moov')
  })
})

// ---------------------------------------------------------------------------
// TC-020-06 — ensureNetworkBalances : document partiel
// ---------------------------------------------------------------------------

describe('TC-020-06 — ensureNetworkBalances document partiel', () => {
  beforeEach(() => { vi.mocked(runTransaction).mockClear() })

  it('normalise un document partiel (réseau manquant → zéro)', async () => {
    const { service } = makeBalanceService()
    // Document existant mais partiel (seulement Orange)
    const partialData = { Orange: { stock: 2000, liquidite: 1000 } }
    const { capturedWrites } = makeTxMock({ balanceExists: true, balanceData: partialData })

    const result = await service.ensureNetworkBalances({})

    // Pas d'écriture (document existe)
    expect(capturedWrites).toHaveLength(0)
    // Résultat normalisé : Moov, Telecel, etc. à zéro
    expect(result.Orange.stock).toBe(2000)
    expect(result.Moov.stock).toBe(0)
    expect(result.Telecel.stock).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// TC-020-07 — setNetworkBalance : nominal
// ---------------------------------------------------------------------------

describe('TC-020-07 — setNetworkBalance nominal', () => {
  beforeEach(() => { vi.mocked(runTransaction).mockClear() })

  it('met à jour stock Orange à 7500 via runTransaction', async () => {
    const { service } = makeBalanceService()
    const { capturedWrites } = makeTxMock({ balanceData: SEED_BALANCES })

    const result = await service.setNetworkBalance('Orange', 'stock', 7500)

    expect(runTransaction).toHaveBeenCalledOnce()
    expect(capturedWrites).toHaveLength(1)
    expect(capturedWrites[0].op).toBe('set')
    expect(capturedWrites[0].data.balances.Orange.stock).toBe(7500)
    // Les autres réseaux restent inchangés
    expect(capturedWrites[0].data.balances.Moov.stock).toBe(3000)
    expect(result.Orange.stock).toBe(7500)
  })
})

// ---------------------------------------------------------------------------
// TC-020-08 — setNetworkBalance : réseau inconnu → créé avec défauts
// ---------------------------------------------------------------------------

describe('TC-020-08 — setNetworkBalance réseau inconnu', () => {
  beforeEach(() => { vi.mocked(runTransaction).mockClear() })

  it('crée une entrée pour un réseau inconnu avec stock=0 liquidite=0 par défaut', async () => {
    const { service } = makeBalanceService()
    const { capturedWrites } = makeTxMock({ balanceData: SEED_BALANCES })

    await service.setNetworkBalance('NouveauReseau', 'stock', 1000)

    const balancesWritten = capturedWrites[0].data.balances
    expect(balancesWritten.NouveauReseau).toBeDefined()
    expect(balancesWritten.NouveauReseau.stock).toBe(1000)
    expect(balancesWritten.NouveauReseau.liquidite).toBe(0) // défaut
  })
})

// ---------------------------------------------------------------------------
// TC-020-09 — setNetworkBalance : montant négatif → ramené à 0
// ---------------------------------------------------------------------------

describe('TC-020-09 — setNetworkBalance montant négatif ramené à 0', () => {
  beforeEach(() => { vi.mocked(runTransaction).mockClear() })

  it('Math.max(0, -500) = 0 → stocké comme 0', async () => {
    const { service } = makeBalanceService()
    const { capturedWrites } = makeTxMock({ balanceData: SEED_BALANCES })

    const result = await service.setNetworkBalance('Orange', 'stock', -500)

    expect(capturedWrites[0].data.balances.Orange.stock).toBe(0)
    expect(result.Orange.stock).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// TC-020-10 — setNetworkBalances : normalisation + merge
// ---------------------------------------------------------------------------

describe('TC-020-10 — setNetworkBalances normalisation et merge', () => {
  beforeEach(() => { vi.mocked(setDoc).mockClear() })

  it('appelle setDoc avec { merge: true } et les balances normalisées', async () => {
    vi.mocked(setDoc).mockResolvedValueOnce(undefined)
    const { service } = makeBalanceService()

    const balances = { Orange: { stock: 3000, liquidite: 1500 } }
    await service.setNetworkBalances(balances)

    expect(setDoc).toHaveBeenCalledOnce()
    const [, payload, options] = vi.mocked(setDoc).mock.calls[0]
    expect(options).toEqual({ merge: true })
    expect(payload.balances).toHaveProperty('Orange')
    expect(payload.balances.Orange.stock).toBe(3000)
    // normalisation : Moov absent → défaut à 0
    expect(payload.balances.Moov.stock).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// TC-020-11 — setNetworkBalances : updatedAt présent
// ---------------------------------------------------------------------------

describe('TC-020-11 — setNetworkBalances updatedAt présent', () => {
  beforeEach(() => { vi.mocked(setDoc).mockClear() })

  it('le payload contient updatedAt avec serverTimestamp', async () => {
    vi.mocked(setDoc).mockResolvedValueOnce(undefined)
    const { service } = makeBalanceService()

    await service.setNetworkBalances({ Orange: { stock: 100, liquidite: 50 } })

    const [, payload] = vi.mocked(setDoc).mock.calls[0]
    expect(payload).toHaveProperty('updatedAt', 'mock-server-timestamp')
  })
})

// ---------------------------------------------------------------------------
// TC-020-12 — subscribeToNetworkBalances : retourne une fonction unsubscribe
// ---------------------------------------------------------------------------

describe('TC-020-12 — subscribeToNetworkBalances retourne une fonction unsubscribe', () => {
  beforeEach(() => { vi.mocked(onSnapshot).mockClear() })

  it('retourne exactement la valeur retournée par onSnapshot', () => {
    const mockUnsubFn = vi.fn()
    vi.mocked(onSnapshot).mockReturnValueOnce(mockUnsubFn)
    const { service } = makeBalanceService()

    const unsub = service.subscribeToNetworkBalances(vi.fn())

    expect(typeof unsub).toBe('function')
    expect(unsub).toBe(mockUnsubFn)
  })
})

// ---------------------------------------------------------------------------
// TC-020-13 — subscribeToNetworkBalances : snapshot existant transmis au callback
// ---------------------------------------------------------------------------

describe('TC-020-13 — subscribeToNetworkBalances snapshot existant', () => {
  beforeEach(() => { vi.mocked(onSnapshot).mockClear() })

  it('callback reçoit les balances normalisées depuis le snapshot existant', () => {
    const callback = vi.fn()
    const { service } = makeBalanceService()

    vi.mocked(onSnapshot).mockImplementation((_ref, successCb) => {
      successCb({
        exists: () => true,
        data:   () => ({ balances: { ...SEED_BALANCES } }),
      })
      return vi.fn()
    })

    service.subscribeToNetworkBalances(callback)

    expect(callback).toHaveBeenCalledOnce()
    const calledWith = callback.mock.calls[0][0]
    expect(calledWith.Orange.stock).toBe(5000)
    expect(calledWith.Moov.stock).toBe(3000)
  })
})

// ---------------------------------------------------------------------------
// TC-020-14 — subscribeToNetworkBalances : snapshot absent → balances vides normalisées
// ---------------------------------------------------------------------------

describe('TC-020-14 — subscribeToNetworkBalances snapshot absent', () => {
  beforeEach(() => { vi.mocked(onSnapshot).mockClear() })

  it('callback reçoit des balances vides normalisées si le document est absent', () => {
    const callback = vi.fn()
    const { service } = makeBalanceService()

    vi.mocked(onSnapshot).mockImplementation((_ref, successCb) => {
      successCb({ exists: () => false, data: () => null })
      return vi.fn()
    })

    service.subscribeToNetworkBalances(callback)

    expect(callback).toHaveBeenCalledOnce()
    const calledWith = callback.mock.calls[0][0]
    // normalizeNetworkBalances({}) → défauts à 0 pour tous les réseaux
    expect(calledWith.Orange.stock).toBe(0)
    expect(calledWith.Moov.stock).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// TC-020-15 — subscribeToNetworkBalances : erreur loggée sans propagation
// ---------------------------------------------------------------------------

describe('TC-020-15 — subscribeToNetworkBalances erreur loggée sans propagation', () => {
  beforeEach(() => { vi.mocked(onSnapshot).mockClear() })

  it('l\'erreur de snapshot est loggée dans console.error sans lancer d\'exception', () => {
    const { service } = makeBalanceService()
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.mocked(onSnapshot).mockImplementation((_ref, _successCb, errorCb) => {
      errorCb(new Error('permission-denied'))
      return vi.fn()
    })

    // Ne doit pas lancer d'exception
    expect(() => service.subscribeToNetworkBalances(vi.fn())).not.toThrow()
    expect(consoleErrorSpy).toHaveBeenCalledOnce()
    expect(consoleErrorSpy.mock.calls[0][0]).toMatch(/Network balances subscription error/)

    consoleErrorSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// TC-020-16 — Façade FirestoreService : délégation complète
// ---------------------------------------------------------------------------

describe('TC-020-16 — Façade FirestoreService délègue à BalanceService', () => {
  let fs

  beforeEach(() => {
    vi.mocked(runTransaction).mockClear()
    vi.mocked(setDoc).mockClear()
    vi.mocked(onSnapshot).mockClear()
    fs = new FirestoreService()
    fs.setActiveStore({ id: 'facade-store-020', name: 'Boutique Façade' })
  })

  it('[16a] getNetworkBalanceDocRef délègue à _balanceService', () => {
    const spy = vi.spyOn(fs._balanceService, 'getNetworkBalanceDocRef')
    fs.getNetworkBalanceDocRef()
    expect(spy).toHaveBeenCalledOnce()
  })

  it('[16b] ensureNetworkBalances délègue et propage la Promise', async () => {
    const fakeResult = { Orange: { stock: 1000, liquidite: 0 } }
    vi.spyOn(fs._balanceService, 'ensureNetworkBalances').mockResolvedValueOnce(fakeResult)

    const result = await fs.ensureNetworkBalances({})
    expect(result).toStrictEqual(fakeResult)
    expect(fs._balanceService.ensureNetworkBalances).toHaveBeenCalledOnce()
  })

  it('[16c] setNetworkBalance délègue et propage la Promise', async () => {
    const fakeResult = { Orange: { stock: 2000, liquidite: 500 } }
    vi.spyOn(fs._balanceService, 'setNetworkBalance').mockResolvedValueOnce(fakeResult)

    const result = await fs.setNetworkBalance('Orange', 'stock', 2000)
    expect(result).toStrictEqual(fakeResult)
    expect(fs._balanceService.setNetworkBalance).toHaveBeenCalledWith('Orange', 'stock', 2000)
  })

  it('[16d] subscribeToNetworkBalances délègue et retourne l\'unsubscribe', () => {
    const mockUnsub = vi.fn()
    vi.spyOn(fs._balanceService, 'subscribeToNetworkBalances').mockReturnValueOnce(mockUnsub)

    const cb = vi.fn()
    const unsub = fs.subscribeToNetworkBalances(cb)

    expect(fs._balanceService.subscribeToNetworkBalances).toHaveBeenCalledWith(cb)
    expect(unsub).toBe(mockUnsub)
  })

  it('[16e] setNetworkBalances délègue et propage la Promise', async () => {
    const fakeResult = { Orange: { stock: 500, liquidite: 0 } }
    vi.spyOn(fs._balanceService, 'setNetworkBalances').mockResolvedValueOnce(fakeResult)

    const result = await fs.setNetworkBalances({ Orange: { stock: 500, liquidite: 0 } })
    expect(result).toStrictEqual(fakeResult)
  })

  it('[16f] erreur de balanceService propagée par la façade', async () => {
    const boom = new Error('permission-denied')
    vi.spyOn(fs._balanceService, 'setNetworkBalance').mockRejectedValueOnce(boom)

    await expect(fs.setNetworkBalance('Orange', 'stock', 100)).rejects.toThrow('permission-denied')
  })
})

// ---------------------------------------------------------------------------
// TC-020-17 — Deux instances BalanceService restent isolées
// ---------------------------------------------------------------------------

describe('TC-020-17 — deux instances BalanceService isolées', () => {
  beforeEach(() => { vi.mocked(runTransaction).mockClear() })

  it('chaque instance opère sur son propre ctx sans interférence', async () => {
    const svcA = makeBalanceService()
    svcA.setActiveStoreId('store-A')

    const svcB = makeBalanceService()
    svcB.setActiveStoreId('store-B')

    const refA = svcA.service.getNetworkBalanceDocRef()
    const refB = svcB.service.getNetworkBalanceDocRef()

    expect(refA._store).toBe('store-A')
    expect(refB._store).toBe('store-B')
    expect(refA._path).not.toBe(refB._path)
  })
})

// ---------------------------------------------------------------------------
// TC-020-18 — Immutabilité du seed
// ---------------------------------------------------------------------------

describe('TC-020-18 — le seed SEED_BALANCES n\'est pas muté', () => {
  beforeEach(() => { vi.mocked(runTransaction).mockClear() })

  it('après setNetworkBalance, SEED_BALANCES est inchangé', async () => {
    const seedSnapshot = {
      Orange:  { stock: SEED_BALANCES.Orange.stock,  liquidite: SEED_BALANCES.Orange.liquidite  },
      Moov:    { stock: SEED_BALANCES.Moov.stock,    liquidite: SEED_BALANCES.Moov.liquidite    },
    }

    const { service } = makeBalanceService()
    makeTxMock({ balanceData: SEED_BALANCES })

    await service.setNetworkBalance('Orange', 'stock', 9999)

    expect(SEED_BALANCES.Orange.stock).toBe(seedSnapshot.Orange.stock)
    expect(SEED_BALANCES.Moov.stock).toBe(seedSnapshot.Moov.stock)
  })
})

// ---------------------------------------------------------------------------
// TC-020-19 — DraftService utilise toujours la référence de soldes correcte
// ---------------------------------------------------------------------------

describe('TC-020-19 — DraftService accède au document networkBalances via ctx', () => {
  beforeEach(() => { vi.mocked(runTransaction).mockClear() })

  it('_getNetworkBalanceDocRef sur DraftService passe par le ctx injecté', () => {
    const mockGetNetworkBalanceDocRef = vi.fn(() => ({ _type: 'balance', _path: 'clients/draft-store/networkBalances/current' }))

    const ctx = {
      requireActiveStore: vi.fn(() => ({ id: 'draft-store', name: 'Boutique Draft' })),
      getNetworkBalanceDocRef: mockGetNetworkBalanceDocRef,
      collectionRef: vi.fn((col) => ({ _type: 'collection', _col: col })),
      docRef: vi.fn((col, id) => ({ _type: 'draft', _col: col, _id: id })),
      getCollection: vi.fn(async () => []),
      addDocument: vi.fn(async (_, data) => ({ id: 'new', ...data })),
    }

    const draftService = new DraftService({ ctx })
    const ref = draftService._getNetworkBalanceDocRef()

    expect(mockGetNetworkBalanceDocRef).toHaveBeenCalledOnce()
    expect(ref._path).toBe('clients/draft-store/networkBalances/current')
  })
})

// ---------------------------------------------------------------------------
// TC-020-20 — HistoryService utilise toujours la référence de soldes correcte
// ---------------------------------------------------------------------------

describe('TC-020-20 — HistoryService accède au document networkBalances via ctx', () => {
  it('_getNetworkBalanceDocRef sur HistoryService passe par le ctx injecté', () => {
    const mockGetNetworkBalanceDocRef = vi.fn(() => ({
      _type: 'balance',
      _path: 'clients/history-store/networkBalances/current'
    }))

    const ctx = {
      requireActiveStore: vi.fn(() => ({ id: 'history-store', name: 'Boutique History' })),
      getNetworkBalanceDocRef: mockGetNetworkBalanceDocRef,
      docRef: vi.fn((col, id) => ({ _type: 'history', _col: col, _id: id })),
      addDocument: vi.fn(async (_, data) => ({ id: 'new', ...data })),
      getCollection: vi.fn(async () => []),
      subscribeToCollection: vi.fn(() => vi.fn()),
      normalizeTransactionLabel: vi.fn((v) => String(v || '').toLowerCase()),
      normalizeNetworkBalances: vi.fn((data) => data?.balances || data || {}),
      reverseHistoryTransactionImpact: vi.fn(() => ({})),
      _validateFcfaAmount: vi.fn((raw) => { const n = Number(raw); if (n <= 0) throw new Error(); return n }),
    }

    const historyService = new HistoryService({ ctx })
    const ref = historyService._getNetworkBalanceDocRef()

    expect(mockGetNetworkBalanceDocRef).toHaveBeenCalledOnce()
    expect(ref._path).toBe('clients/history-store/networkBalances/current')
  })
})

// ---------------------------------------------------------------------------
// TC-020-21 — getNetworkBalanceDocRef sans boutique active lève une erreur
// ---------------------------------------------------------------------------

describe('TC-020-21 — getNetworkBalanceDocRef sans boutique active', () => {
  it('lève une erreur si requireActiveStore échoue', () => {
    const { service } = makeBalanceService({
      requireActiveStore: vi.fn(() => { throw new Error('Boutique active introuvable. Veuillez vous reconnecter.') }),
    })

    expect(() => service.getNetworkBalanceDocRef()).toThrow('Boutique active introuvable')
  })
})

// ---------------------------------------------------------------------------
// TC-020-22 — setNetworkBalance utilise merge:true
// ---------------------------------------------------------------------------

describe('TC-020-22 — setNetworkBalance utilise { merge: true }', () => {
  beforeEach(() => { vi.mocked(runTransaction).mockClear() })

  it('tx.set est appelé avec { merge: true }', async () => {
    const { service } = makeBalanceService()
    const { capturedWrites } = makeTxMock({ balanceData: SEED_BALANCES })

    await service.setNetworkBalance('Moov', 'liquidite', 800)

    const setOp = capturedWrites.find(w => w.op === 'set')
    expect(setOp).toBeDefined()
    expect(setOp.options).toEqual({ merge: true })
  })
})

// ---------------------------------------------------------------------------
// TC-020-23 — ensureNetworkBalances : document existant → aucune écriture
// ---------------------------------------------------------------------------

describe('TC-020-23 — ensureNetworkBalances : aucune écriture si document existe', () => {
  beforeEach(() => { vi.mocked(runTransaction).mockClear() })

  it('tx.set n\'est pas appelé quand le document existe', async () => {
    const { service } = makeBalanceService()
    const { capturedWrites, mockTx } = makeTxMock({ balanceExists: true })

    await service.ensureNetworkBalances({ Orange: { stock: 9999 } })

    expect(capturedWrites).toHaveLength(0)
    expect(mockTx.set).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// TC-020-24 — setNetworkBalances : normalise les valeurs négatives à zéro
// ---------------------------------------------------------------------------

describe('TC-020-24 — setNetworkBalances normalise les valeurs négatives', () => {
  beforeEach(() => { vi.mocked(setDoc).mockClear() })

  it('une valeur stock négative est ramenée à 0 par normalizeNetworkBalances', async () => {
    vi.mocked(setDoc).mockResolvedValueOnce(undefined)
    const { service } = makeBalanceService()

    // La normalisation dans mockNormalizeNetworkBalances utilise Math.max(0, ...)
    await service.setNetworkBalances({ Orange: { stock: -500, liquidite: 200 } })

    const [, payload] = vi.mocked(setDoc).mock.calls[0]
    // normalizeNetworkBalances ramène -500 à 0
    expect(payload.balances.Orange.stock).toBe(0)
    expect(payload.balances.Orange.liquidite).toBe(200)
  })
})
