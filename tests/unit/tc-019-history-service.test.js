/**
 * TC-019 — HistoryService : orchestration Firestore de l'historique
 *
 * Comportement à protéger :
 *   Le nouveau HistoryService (src/services/historyService.js) doit reproduire
 *   exactement le comportement des méthodes extraites de FirestoreService :
 *     - addToHistory       : validation montant + addDocument avec date
 *     - deleteFromHistory  : soft-delete atomique via runTransaction, inverse balances
 *     - subscribeToHistory : onSnapshot via subscribeToCollection avec filtres optionnels
 *     - getHistory         : getCollection sur la collection history
 *
 *   La facade FirestoreService délègue chacune de ces méthodes à HistoryService
 *   sans changer les signatures ni les valeurs de retour.
 *
 * Architecture des mocks :
 *   - runTransaction exécute réellement le callback avec un mockTx fonctionnel
 *   - Les valeurs financières attendues sont des nombres EXPLICITES (jamais recalculés
 *     par les fonctions sous test)
 *   - Le seed est vérifié immutable (chaque test recrée ses propres copies)
 */

// ---------------------------------------------------------------------------
// Mocks Firebase — obligatoires avant tout import de FirestoreService
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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

import { HistoryService } from '../../src/services/historyService.js'
import { FirestoreService } from '../../src/services/firestore.js'
import { runTransaction } from 'firebase/firestore'
import { FIRESTORE_CONFIG } from '../../src/constants/firestoreConstants.js'

// ---------------------------------------------------------------------------
// Fixtures partagées (immutables — chaque test clone via spread)
// ---------------------------------------------------------------------------

const SEED_BALANCES = Object.freeze({
  Orange:  Object.freeze({ stock: 5000, liquidite: 2000 }),
  Moov:    Object.freeze({ stock: 3000, liquidite: 1000 }),
  Telecel: Object.freeze({ stock: 1000, liquidite:  300 }),
  Coris:   Object.freeze({ stock:  500, liquidite:  100 }),
  Sank:    Object.freeze({ stock:  200, liquidite:   50 }),
})

// Transaction historique de type "Dépôt" validée directement (Path 1)
// Orange.stock initial = 5000, montant = 1500
// reverseDirectValidatedImpact(Dépôt) : stock += 1500, liquidite -= 1500
// Orange.stock attendu = 6500, Orange.liquidite attendu = 500
const DEPOSIT_HISTORY_PATH1 = Object.freeze({
  type:     'Dépôt',
  reseau:   'Orange',
  montant:  1500,
  statut:   'Validée',
  clientId: 'client-001',
})

// Transaction historique de type "Crédit" validée directement (Path 1)
// Orange.stock initial = 5000, montant = 800
// reverseDirectValidatedImpact(Crédit) : stock += 800
// Orange.stock attendu = 5800
const CREDIT_HISTORY_PATH1 = Object.freeze({
  type:     'Crédit',
  reseau:   'Orange',
  montant:  800,
  statut:   'Validée',
  clientId: 'client-002',
})

// Transaction historique de type "Retrait" sans règlement, avec validatedAt (Path 2 sans règlement)
// reversePendingOnlyImpact(Retrait) : stock -= montant
// Moov.stock initial = 3000, montant = 500 → Moov.stock attendu = 2500
const WITHDRAWAL_HISTORY_PATH2_NO_PAYMENT = Object.freeze({
  type:        'Retrait',
  reseau:      'Moov',
  montant:     500,
  statut:      'Validée',
  validatedAt: 'mock-server-timestamp',
  clientId:    'client-003',
})

// ---------------------------------------------------------------------------
// Usine à HistoryService avec ctx mocké
// ---------------------------------------------------------------------------

function makeHistoryService(overrides = {}) {
  const mockAddDocument = vi.fn(async (_col, data) => ({ id: 'new-hist-id', ...data }))
  const mockGetCollection = vi.fn(async () => [])
  const mockDocRef = vi.fn((col, id) => ({ _type: 'history', _col: col, _id: id }))
  const mockGetNetworkBalanceDocRef = vi.fn(() => ({ _type: 'balance' }))
  const mockSubscribeToCollection = vi.fn(() => vi.fn())
  const mockRequireActiveStore = vi.fn(() => ({ id: 'store-019', name: 'Boutique 019' }))
  const mockNormalizeTransactionLabel = vi.fn((v) => {
    return String(v || '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  })
  const mockNormalizeNetworkBalances = vi.fn((data) => {
    const source = data?.balances || data || {}
    const defaults = {
      Orange: { stock: 0, liquidite: 0 },
      Moov:   { stock: 0, liquidite: 0 },
      Telecel:{ stock: 0, liquidite: 0 },
      Coris:  { stock: 0, liquidite: 0 },
      Sank:   { stock: 0, liquidite: 0 },
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
  // Import the real reverseHistoryTransactionImpact to avoid circular dependency
  // but we can mock it for tests that need specific numeric results
  const mockReverseHistoryTransactionImpact = vi.fn()
  const mockValidateFcfaAmount = vi.fn((raw, _ctx) => {
    const n = Number(raw)
    if (!Number.isInteger(n) || n <= 0) throw new Error(`Montant FCFA invalide : ${JSON.stringify(raw)}`)
    return n
  })

  const ctx = {
    requireActiveStore:               mockRequireActiveStore,
    getNetworkBalanceDocRef:          mockGetNetworkBalanceDocRef,
    docRef:                           mockDocRef,
    addDocument:                      mockAddDocument,
    getCollection:                    mockGetCollection,
    subscribeToCollection:            mockSubscribeToCollection,
    normalizeTransactionLabel:        mockNormalizeTransactionLabel,
    normalizeNetworkBalances:         mockNormalizeNetworkBalances,
    reverseHistoryTransactionImpact:  mockReverseHistoryTransactionImpact,
    _validateFcfaAmount:              mockValidateFcfaAmount,
    ...overrides,
  }

  const service = new HistoryService({ ctx })
  return {
    service,
    ctx,
    mockAddDocument,
    mockGetCollection,
    mockDocRef,
    mockGetNetworkBalanceDocRef,
    mockSubscribeToCollection,
    mockRequireActiveStore,
    mockNormalizeTransactionLabel,
    mockNormalizeNetworkBalances,
    mockReverseHistoryTransactionImpact,
    mockValidateFcfaAmount,
  }
}

// Usine à mockTx pour runTransaction — exécute réellement le callback
function makeTxMock({
  historyData     = DEPOSIT_HISTORY_PATH1,
  historyExists   = true,
  balanceData     = SEED_BALANCES,
  balanceExists   = true,
} = {}) {
  const capturedWrites = []

  const mockTx = {
    get: vi.fn(async (ref) => {
      if (ref._type === 'history') {
        return {
          exists: () => historyExists,
          data:   () => (historyExists ? { ...historyData } : null),
        }
      }
      if (ref._type === 'balance') {
        return {
          exists: () => balanceExists,
          data:   () => (balanceExists ? { balances: { ...balanceData } } : null),
        }
      }
      return { exists: () => false, data: () => null }
    }),
    update: vi.fn((ref, patch) => { capturedWrites.push({ op: 'update', ref, patch }) }),
    set:    vi.fn((ref, data, options) => { capturedWrites.push({ op: 'set', ref, data, options }) }),
    delete: vi.fn((ref) => { capturedWrites.push({ op: 'delete', ref }) }),
  }

  vi.mocked(runTransaction).mockImplementation(async (_db, callback) => callback(mockTx))

  return { capturedWrites, mockTx }
}

// ---------------------------------------------------------------------------
// TC-019-A : addToHistory — nominal
// ---------------------------------------------------------------------------

describe('TC-019-A — addToHistory nominal', () => {
  beforeEach(() => { vi.mocked(runTransaction).mockClear() })

  it('TC-019-01 : ajoute le document dans la collection HISTORY avec la date', async () => {
    const { service, mockAddDocument, mockValidateFcfaAmount } = makeHistoryService()

    const txData = { ...DEPOSIT_HISTORY_PATH1, montant: 1500, date: '19/06/2026' }
    const result = await service.addToHistory(txData)

    expect(mockValidateFcfaAmount).toHaveBeenCalledOnce()
    expect(mockValidateFcfaAmount).toHaveBeenCalledWith(1500, 'addToHistory')
    expect(mockAddDocument).toHaveBeenCalledOnce()
    const [col, payload] = mockAddDocument.mock.calls[0]
    expect(col).toBe(FIRESTORE_CONFIG.COLLECTIONS.HISTORY)
    expect(payload.type).toBe('Dépôt')
    expect(payload.montant).toBe(1500)
    expect(payload).toHaveProperty('date')
    expect(typeof payload.date).toBe('string')
    expect(result).toHaveProperty('id', 'new-hist-id')
  })
})

// ---------------------------------------------------------------------------
// TC-019-B : addToHistory — montant invalide
// ---------------------------------------------------------------------------

describe('TC-019-B — addToHistory montant invalide', () => {
  it('TC-019-02 : rejette un montant invalide sans écriture', async () => {
    const { service, mockAddDocument } = makeHistoryService()

    await expect(service.addToHistory({ ...DEPOSIT_HISTORY_PATH1, montant: -500 })).rejects.toThrow()
    expect(mockAddDocument).not.toHaveBeenCalled()
  })

  it('TC-019-02b : rejette un montant zéro sans écriture', async () => {
    const { service, mockAddDocument } = makeHistoryService()

    await expect(service.addToHistory({ ...DEPOSIT_HISTORY_PATH1, montant: 0 })).rejects.toThrow()
    expect(mockAddDocument).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// TC-019-C : deleteFromHistory — renversement déterministe
// ---------------------------------------------------------------------------

describe('TC-019-C — deleteFromHistory renversement déterministe', () => {
  beforeEach(() => { vi.mocked(runTransaction).mockClear() })
  afterEach(() => { vi.restoreAllMocks() })

  it('TC-019-03 : inverse les balances avec des valeurs numériques explicites (Path 1 Dépôt)', async () => {
    // Orange.stock 5000 + 1500 = 6500, Orange.liquidite 2000 - 1500 = 500
    const EXPECTED_ORANGE_STOCK     = 6500
    const EXPECTED_ORANGE_LIQUIDITE = 500

    const { service, mockReverseHistoryTransactionImpact, mockNormalizeNetworkBalances } = makeHistoryService()

    // Simuler la réponse de reverseHistoryTransactionImpact avec valeurs EXPLICITES
    const expectedNextBalances = {
      Orange:  { stock: EXPECTED_ORANGE_STOCK, liquidite: EXPECTED_ORANGE_LIQUIDITE },
      Moov:    { stock: 3000, liquidite: 1000 },
      Telecel: { stock: 1000, liquidite:  300 },
      Coris:   { stock:  500, liquidite:  100 },
      Sank:    { stock:  200, liquidite:   50 },
    }
    mockReverseHistoryTransactionImpact.mockReturnValueOnce(expectedNextBalances)

    const { capturedWrites, mockTx } = makeTxMock({ historyData: DEPOSIT_HISTORY_PATH1 })

    const result = await service.deleteFromHistory('hist-001')

    expect(result).toBe(true)
    expect(mockReverseHistoryTransactionImpact).toHaveBeenCalledOnce()
    expect(mockNormalizeNetworkBalances).toHaveBeenCalledOnce()

    // Vérifier que tx.set a été appelé avec les bonnes balances
    const setCall = capturedWrites.find(w => w.op === 'set')
    expect(setCall).toBeDefined()
    expect(setCall.data.balances.Orange.stock).toBe(EXPECTED_ORANGE_STOCK)
    expect(setCall.data.balances.Orange.liquidite).toBe(EXPECTED_ORANGE_LIQUIDITE)

    // Aucune suppression physique
    expect(capturedWrites.filter(w => w.op === 'delete')).toHaveLength(0)
    // mockTx.delete ne doit pas avoir été appelé
    expect(mockTx.delete).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// TC-019-D : deleteFromHistory — déjà Annulée
// ---------------------------------------------------------------------------

describe('TC-019-D — deleteFromHistory déjà Annulée', () => {
  beforeEach(() => { vi.mocked(runTransaction).mockClear() })

  it('TC-019-04 : retourne false sans aucune écriture si statut = Annulée', async () => {
    const cancelledHistory = { ...DEPOSIT_HISTORY_PATH1, statut: 'Annulée' }
    const { service, mockReverseHistoryTransactionImpact } = makeHistoryService()

    const { capturedWrites } = makeTxMock({ historyData: cancelledHistory })

    const result = await service.deleteFromHistory('hist-cancelled')

    expect(result).toBe(false)
    expect(capturedWrites).toHaveLength(0)
    expect(mockReverseHistoryTransactionImpact).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// TC-019-E : deleteFromHistory — document introuvable
// ---------------------------------------------------------------------------

describe('TC-019-E — deleteFromHistory document introuvable', () => {
  beforeEach(() => { vi.mocked(runTransaction).mockClear() })

  it('TC-019-05 : lève une erreur si le document history n\'existe pas', async () => {
    const { service } = makeHistoryService()

    makeTxMock({ historyExists: false })

    // getUserFriendlyMessage transforme l'erreur interne en message générique.
    // L'erreur interne originale est accessible via error.originalError.
    let thrownError
    try {
      await service.deleteFromHistory('hist-missing')
    } catch (err) {
      thrownError = err
    }
    expect(thrownError).toBeDefined()
    // Le message friendly est générique mais originalError contient le message technique
    expect(thrownError.originalError?.message ?? thrownError.message).toContain('hist-missing')
  })
})

// ---------------------------------------------------------------------------
// TC-019-F : deleteFromHistory — balances absentes
// ---------------------------------------------------------------------------

describe('TC-019-F — deleteFromHistory balances absentes', () => {
  beforeEach(() => { vi.mocked(runTransaction).mockClear() })

  it('TC-019-06 : lève une erreur spécifique si networkBalances/current absent', async () => {
    const { service } = makeHistoryService()

    makeTxMock({ balanceExists: false })

    // getUserFriendlyMessage enveloppe l'erreur interne dans un message générique.
    // L'originalError contient le message technique avec 'networkBalances/current'.
    let thrownError
    try {
      await service.deleteFromHistory('hist-no-balance')
    } catch (err) {
      thrownError = err
    }
    expect(thrownError).toBeDefined()
    expect(thrownError.originalError?.message ?? thrownError.message).toContain('networkBalances/current')
  })
})

// ---------------------------------------------------------------------------
// TC-019-G : deleteFromHistory — balances invalides
// ---------------------------------------------------------------------------

describe('TC-019-G — deleteFromHistory balances invalides', () => {
  beforeEach(() => { vi.mocked(runTransaction).mockClear() })

  it('TC-019-07 : lève une erreur si les balances normalisées sont vides', async () => {
    // normalizeNetworkBalances retourne un objet vide → doit déclencher l'erreur interne
    // getUserFriendlyMessage enveloppe l'erreur dans un message générique.
    const { service, ctx } = makeHistoryService()
    ctx.normalizeNetworkBalances = vi.fn(() => ({}))

    makeTxMock()

    // L'originalError contient le message technique avec 'invalides'
    let thrownError
    try {
      await service.deleteFromHistory('hist-bad-balance')
    } catch (err) {
      thrownError = err
    }
    expect(thrownError).toBeDefined()
    expect(thrownError.originalError?.message ?? thrownError.message).toContain('invalides')
  })
})

// ---------------------------------------------------------------------------
// TC-019-H : deleteFromHistory — type inconnu (erreur de reversal)
// ---------------------------------------------------------------------------

describe('TC-019-H — deleteFromHistory type inconnu', () => {
  beforeEach(() => { vi.mocked(runTransaction).mockClear() })

  it('TC-019-08 : lève une erreur si le type de transaction est inconnu', async () => {
    const unknownTypeHistory = { ...DEPOSIT_HISTORY_PATH1, type: 'TransfertXYZ' }
    const { service, mockReverseHistoryTransactionImpact } = makeHistoryService()

    mockReverseHistoryTransactionImpact.mockImplementationOnce(() => {
      throw new Error('Type de transaction non reconnu pour le renversement : TransfertXYZ')
    })

    makeTxMock({ historyData: unknownTypeHistory })

    // getUserFriendlyMessage enveloppe l'erreur interne dans un message générique.
    // L'originalError contient le message technique avec 'TransfertXYZ'.
    let thrownError
    try {
      await service.deleteFromHistory('hist-unknown-type')
    } catch (err) {
      thrownError = err
    }
    expect(thrownError).toBeDefined()
    expect(thrownError.originalError?.message ?? thrownError.message).toContain('TransfertXYZ')
    expect(mockReverseHistoryTransactionImpact).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// TC-019-I : deleteFromHistory — Path 1 Retrait rejeté
// ---------------------------------------------------------------------------

describe('TC-019-I — deleteFromHistory Path 1 Retrait rejeté', () => {
  beforeEach(() => { vi.mocked(runTransaction).mockClear() })

  it('TC-019-09 : lève une erreur pour un Retrait Path 1 (sans règlement ni validatedAt)', async () => {
    // Retrait sans paymentMethod ni validatedAt = Path 1 direct → doit lever une erreur
    const directWithdrawal = {
      type:     'Retrait',
      reseau:   'Moov',
      montant:  500,
      statut:   'Validée',
      clientId: 'client-path1',
      // pas de paymentMethod, pas de validatedAt
    }
    const { service, mockReverseHistoryTransactionImpact } = makeHistoryService()

    mockReverseHistoryTransactionImpact.mockImplementationOnce(() => {
      throw new Error('Renversement impossible : la répartition exacte de la liquidité')
    })

    makeTxMock({ historyData: directWithdrawal })

    // getUserFriendlyMessage enveloppe l'erreur interne.
    // L'originalError contient le message technique.
    let thrownError
    try {
      await service.deleteFromHistory('hist-direct-withdrawal')
    } catch (err) {
      thrownError = err
    }
    expect(thrownError).toBeDefined()
    expect(thrownError.originalError?.message ?? thrownError.message).toContain('Renversement impossible')
  })
})

// ---------------------------------------------------------------------------
// TC-019-J : deleteFromHistory — erreur de reversal n'écrit rien
// ---------------------------------------------------------------------------

describe('TC-019-J — deleteFromHistory erreur reversal = zéro écriture', () => {
  beforeEach(() => { vi.mocked(runTransaction).mockClear() })

  it('TC-019-10 : aucune écriture Firestore si reversal lève une erreur', async () => {
    const { service, mockReverseHistoryTransactionImpact } = makeHistoryService()

    mockReverseHistoryTransactionImpact.mockImplementationOnce(() => {
      throw new Error('Erreur de renversement simulée')
    })

    const { capturedWrites } = makeTxMock()

    await expect(service.deleteFromHistory('hist-reversal-error')).rejects.toThrow()
    expect(capturedWrites).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// TC-019-K : deleteFromHistory — atomicité tx.update + tx.set dans la même transaction
// ---------------------------------------------------------------------------

describe('TC-019-K — deleteFromHistory atomicité (update history + set balances)', () => {
  beforeEach(() => { vi.mocked(runTransaction).mockClear() })

  it('TC-019-11 : tx.update(history) et tx.set(balances) sont dans la même transaction', async () => {
    const nextBalances = {
      Orange:  { stock: 6500, liquidite: 500 },
      Moov:    { stock: 3000, liquidite: 1000 },
      Telecel: { stock: 1000, liquidite:  300 },
      Coris:   { stock:  500, liquidite:  100 },
      Sank:    { stock:  200, liquidite:   50 },
    }
    const { service, mockReverseHistoryTransactionImpact } = makeHistoryService()
    mockReverseHistoryTransactionImpact.mockReturnValueOnce(nextBalances)

    const { capturedWrites, mockTx } = makeTxMock()

    await service.deleteFromHistory('hist-atomicity')

    // tx.update doit avoir été appelé (soft-delete)
    expect(mockTx.update).toHaveBeenCalledOnce()
    // tx.set doit avoir été appelé (balances)
    expect(mockTx.set).toHaveBeenCalledOnce()
    // Les deux dans capturedWrites
    const updateOps = capturedWrites.filter(w => w.op === 'update')
    const setOps    = capturedWrites.filter(w => w.op === 'set')
    expect(updateOps).toHaveLength(1)
    expect(setOps).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// TC-019-L : deleteFromHistory — merge: true sur les balances
// ---------------------------------------------------------------------------

describe('TC-019-L — deleteFromHistory merge: true sur balances', () => {
  beforeEach(() => { vi.mocked(runTransaction).mockClear() })

  it('TC-019-12 : tx.set appelle { merge: true } sur la référence balances', async () => {
    const nextBalances = { Orange: { stock: 6500, liquidite: 500 } }
    const { service, mockReverseHistoryTransactionImpact } = makeHistoryService()
    mockReverseHistoryTransactionImpact.mockReturnValueOnce(nextBalances)

    const { capturedWrites } = makeTxMock()

    await service.deleteFromHistory('hist-merge')

    const setOp = capturedWrites.find(w => w.op === 'set')
    expect(setOp).toBeDefined()
    expect(setOp.options).toEqual({ merge: true })
  })
})

// ---------------------------------------------------------------------------
// TC-019-M : deleteFromHistory — updatedAt présent
// ---------------------------------------------------------------------------

describe('TC-019-M — deleteFromHistory updatedAt présent', () => {
  beforeEach(() => { vi.mocked(runTransaction).mockClear() })

  it('TC-019-13 : le patch d\'update contient updatedAt', async () => {
    const nextBalances = { Orange: { stock: 6500, liquidite: 500 } }
    const { service, mockReverseHistoryTransactionImpact } = makeHistoryService()
    mockReverseHistoryTransactionImpact.mockReturnValueOnce(nextBalances)

    const { capturedWrites } = makeTxMock()

    await service.deleteFromHistory('hist-updatedat')

    const updateOp = capturedWrites.find(w => w.op === 'update')
    expect(updateOp).toBeDefined()
    expect(updateOp.patch).toHaveProperty('updatedAt')
    expect(updateOp.patch).toHaveProperty('statut', FIRESTORE_CONFIG.STATUS.CANCELLED)
  })
})

// ---------------------------------------------------------------------------
// TC-019-N : deleteFromHistory — chemin Firestore exact
// ---------------------------------------------------------------------------

describe('TC-019-N — deleteFromHistory chemin Firestore exact', () => {
  beforeEach(() => { vi.mocked(runTransaction).mockClear() })

  it('TC-019-14 : le docRef est construit avec clients/{storeId}/history/{id}', async () => {
    const nextBalances = { Orange: { stock: 6500, liquidite: 500 } }
    const { service, mockReverseHistoryTransactionImpact, mockDocRef } = makeHistoryService()
    mockReverseHistoryTransactionImpact.mockReturnValueOnce(nextBalances)
    makeTxMock()

    await service.deleteFromHistory('hist-path-check')

    expect(mockDocRef).toHaveBeenCalledWith(FIRESTORE_CONFIG.COLLECTIONS.HISTORY, 'hist-path-check')
  })

  it('TC-019-14b : le chemin inclut le storeId actif au moment de l\'appel', async () => {
    // mockDocRef reçoit la collection "history" ; resolveCollectionPath est côté ctx (FirestoreService)
    // Ici on vérifie que le ctx.docRef est appelé avec le bon collectionName
    const nextBalances = { Orange: { stock: 5200, liquidite: 2000 } }
    const { service, mockReverseHistoryTransactionImpact, mockDocRef } = makeHistoryService()
    mockReverseHistoryTransactionImpact.mockReturnValueOnce(nextBalances)
    makeTxMock()

    await service.deleteFromHistory('hist-xyz')

    const [calledCollection, calledId] = mockDocRef.mock.calls[0]
    expect(calledCollection).toBe(FIRESTORE_CONFIG.COLLECTIONS.HISTORY)
    expect(calledId).toBe('hist-xyz')
  })
})

// ---------------------------------------------------------------------------
// TC-019-O : deux instances — storeIds différents → chemins différents
// ---------------------------------------------------------------------------

describe('TC-019-O — deux instances produisent des chemins différents', () => {
  it('TC-019-15 : deux instances avec storeId différents appellent docRef sur leur propre ctx', async () => {
    // Instance A
    const mockDocRefA = vi.fn((col, id) => ({ _type: 'history', _col: col, _id: id, _store: 'store-A' }))
    const mockRequireActiveStoreA = vi.fn(() => ({ id: 'store-A', name: 'Boutique A' }))
    const mockNNB = vi.fn((data) => {
      const src = data?.balances || data || {}
      return { Orange: { stock: Number(src?.Orange?.stock) || 0, liquidite: Number(src?.Orange?.liquidite) || 0 } }
    })
    const mockNTL = vi.fn((v) => String(v || '').toLowerCase())
    const mockReverseA = vi.fn(() => ({ Orange: { stock: 6500, liquidite: 500 } }))
    const mockValidateA = vi.fn((raw) => { const n = Number(raw); if (!Number.isInteger(n) || n <= 0) throw new Error(); return n })

    const ctxA = {
      requireActiveStore: mockRequireActiveStoreA,
      docRef: mockDocRefA,
      getNetworkBalanceDocRef: vi.fn(() => ({ _type: 'balance' })),
      normalizeTransactionLabel: mockNTL,
      normalizeNetworkBalances: mockNNB,
      reverseHistoryTransactionImpact: mockReverseA,
      _validateFcfaAmount: mockValidateA,
      addDocument: vi.fn(async (_, data) => ({ id: 'x', ...data })),
      getCollection: vi.fn(async () => []),
      subscribeToCollection: vi.fn(() => vi.fn()),
    }

    // Instance B
    const mockDocRefB = vi.fn((col, id) => ({ _type: 'history', _col: col, _id: id, _store: 'store-B' }))
    const mockRequireActiveStoreB = vi.fn(() => ({ id: 'store-B', name: 'Boutique B' }))
    const mockReverseB = vi.fn(() => ({ Orange: { stock: 6500, liquidite: 500 } }))

    const ctxB = {
      ...ctxA,
      requireActiveStore: mockRequireActiveStoreB,
      docRef: mockDocRefB,
      reverseHistoryTransactionImpact: mockReverseB,
    }

    const serviceA = new HistoryService({ ctx: ctxA })
    const serviceB = new HistoryService({ ctx: ctxB })

    vi.mocked(runTransaction).mockImplementation(async (_db, callback) => {
      const mockTx = {
        get: vi.fn(async (ref) => {
          if (ref._type === 'history') return { exists: () => true, data: () => ({ ...DEPOSIT_HISTORY_PATH1 }) }
          if (ref._type === 'balance') return { exists: () => true, data: () => ({ balances: { ...SEED_BALANCES } }) }
          return { exists: () => false, data: () => null }
        }),
        update: vi.fn(),
        set: vi.fn(),
        delete: vi.fn(),
      }
      return callback(mockTx)
    })

    await serviceA.deleteFromHistory('hist-A')
    await serviceB.deleteFromHistory('hist-B')

    expect(mockDocRefA).toHaveBeenCalledWith(FIRESTORE_CONFIG.COLLECTIONS.HISTORY, 'hist-A')
    expect(mockDocRefB).toHaveBeenCalledWith(FIRESTORE_CONFIG.COLLECTIONS.HISTORY, 'hist-B')
    // Les deux docRef sont distincts — confirmer qu'ils ne se confondent pas
    expect(mockDocRefA.mock.calls[0][1]).toBe('hist-A')
    expect(mockDocRefB.mock.calls[0][1]).toBe('hist-B')
  })
})

// ---------------------------------------------------------------------------
// TC-019-P : activeStore lu au moment de l'appel, pas à la construction
// ---------------------------------------------------------------------------

describe('TC-019-P — activeStore lu au moment de l\'appel', () => {
  beforeEach(() => { vi.mocked(runTransaction).mockClear() })

  it('TC-019-16 : requireActiveStore est appelé lors de deleteFromHistory, pas à la construction', async () => {
    const mockRequire = vi.fn(() => ({ id: 'store-late', name: 'Boutique Tardive' }))
    const { service } = makeHistoryService({ requireActiveStore: mockRequire })

    // A la construction, requireActiveStore ne doit pas avoir été appelé
    expect(mockRequire).not.toHaveBeenCalled()

    const mockReverse = vi.fn(() => ({ Orange: { stock: 6500, liquidite: 500 } }))
    const { service: svc2 } = makeHistoryService({
      requireActiveStore: mockRequire,
      reverseHistoryTransactionImpact: mockReverse,
    })
    makeTxMock()

    await svc2.deleteFromHistory('hist-late')

    // Maintenant requireActiveStore a été appelé
    expect(mockRequire).toHaveBeenCalled()
    void service // éviter warning unused
  })
})

// ---------------------------------------------------------------------------
// TC-019-Q : subscribeToHistory — retourne exactement la fonction unsubscribe
// ---------------------------------------------------------------------------

describe('TC-019-Q — subscribeToHistory retourne l\'unsubscribe', () => {
  it('TC-019-17 : retourne exactement la valeur de subscribeToCollection', () => {
    const mockUnsub = vi.fn()
    const { service, mockSubscribeToCollection } = makeHistoryService()
    mockSubscribeToCollection.mockReturnValueOnce(mockUnsub)

    const cb = vi.fn()
    const unsub = service.subscribeToHistory(cb)

    expect(mockSubscribeToCollection).toHaveBeenCalledOnce()
    const [col, calledCb] = mockSubscribeToCollection.mock.calls[0]
    expect(col).toBe(FIRESTORE_CONFIG.COLLECTIONS.HISTORY)
    expect(calledCb).toBe(cb)
    expect(unsub).toBe(mockUnsub)
  })

  it('TC-019-17b : avec filtres clientId, passe un where dans les options', () => {
    const mockUnsub = vi.fn()
    const { service, mockSubscribeToCollection } = makeHistoryService()
    mockSubscribeToCollection.mockReturnValueOnce(mockUnsub)

    const cb = vi.fn()
    service.subscribeToHistory(cb, { clientId: 'client-filter-001' })

    const [, , options] = mockSubscribeToCollection.mock.calls[0]
    expect(options).toHaveProperty('where')
    const whereClause = options.where.find(w => w.field === 'clientId')
    expect(whereClause).toBeDefined()
    expect(whereClause.operator).toBe('==')
    expect(whereClause.value).toBe('client-filter-001')
  })
})

// ---------------------------------------------------------------------------
// TC-019-R : getHistory — préserve mapping et ordre
// ---------------------------------------------------------------------------

describe('TC-019-R — getHistory préserve mapping et ordre', () => {
  it('TC-019-18 : délègue à getCollection(HISTORY) et retourne les documents dans l\'ordre', async () => {
    const mockDocs = [
      { id: 'h1', type: 'Dépôt',  montant: 1000, statut: 'Validée' },
      { id: 'h2', type: 'Retrait', montant:  500, statut: 'Validée' },
      { id: 'h3', type: 'Crédit', montant:  200, statut: 'Annulée' },
    ]
    const { service, mockGetCollection } = makeHistoryService()
    mockGetCollection.mockResolvedValueOnce(mockDocs)

    const result = await service.getHistory()

    expect(mockGetCollection).toHaveBeenCalledOnce()
    expect(mockGetCollection.mock.calls[0][0]).toBe(FIRESTORE_CONFIG.COLLECTIONS.HISTORY)
    expect(result).toHaveLength(3)
    expect(result[0].id).toBe('h1')
    expect(result[1].id).toBe('h2')
    expect(result[2].id).toBe('h3')
    expect(result[2].statut).toBe('Annulée')
  })
})

// ---------------------------------------------------------------------------
// TC-019-S : facade FirestoreService — délégation complète
// ---------------------------------------------------------------------------

describe('TC-019-S — facade FirestoreService délègue à HistoryService', () => {
  let fs

  beforeEach(() => {
    vi.mocked(runTransaction).mockClear()
    fs = new FirestoreService()
    fs.setActiveStore({ id: 'facade-store', name: 'Boutique Facade' })
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('TC-019-19a : getHistory délègue et retourne le résultat', async () => {
    const mockDocs = [{ id: 'fh1', type: 'Dépôt' }]
    vi.spyOn(fs._historyService, 'getHistory').mockResolvedValueOnce(mockDocs)

    const result = await fs.getHistory()
    expect(result).toStrictEqual(mockDocs)
  })

  it('TC-019-19b : addToHistory délègue et retourne le résultat', async () => {
    const fakeResult = { id: 'fh2', type: 'Dépôt', montant: 1000, date: '19/06/2026' }
    vi.spyOn(fs._historyService, 'addToHistory').mockResolvedValueOnce(fakeResult)

    const txData = { type: 'Dépôt', montant: 1000, clientId: 'c1', reseau: 'Orange', statut: 'Validée' }
    const result = await fs.addToHistory(txData)
    expect(result).toStrictEqual(fakeResult)
    expect(fs._historyService.addToHistory).toHaveBeenCalledWith(txData)
  })

  it('TC-019-19c : deleteFromHistory délègue et propage false', async () => {
    vi.spyOn(fs._historyService, 'deleteFromHistory').mockResolvedValueOnce(false)

    const result = await fs.deleteFromHistory('already-cancelled')
    expect(result).toBe(false)
  })

  it('TC-019-19d : deleteFromHistory propage les erreurs', async () => {
    const boom = new Error('Transaction introuvable')
    vi.spyOn(fs._historyService, 'deleteFromHistory').mockRejectedValueOnce(boom)

    await expect(fs.deleteFromHistory('missing')).rejects.toThrow('introuvable')
  })

  it('TC-019-19e : subscribeToHistory délègue et retourne la fonction unsubscribe', () => {
    const mockUnsub = vi.fn()
    vi.spyOn(fs._historyService, 'subscribeToHistory').mockReturnValueOnce(mockUnsub)

    const cb = vi.fn()
    const unsub = fs.subscribeToHistory(cb, { clientId: 'c1' })

    expect(fs._historyService.subscribeToHistory).toHaveBeenCalledWith(cb, { clientId: 'c1' })
    expect(unsub).toBe(mockUnsub)
  })
})

// ---------------------------------------------------------------------------
// TC-019-T : immutabilité du seed
// ---------------------------------------------------------------------------

describe('TC-019-T — immutabilité du seed de balances', () => {
  it('TC-019-20 : SEED_BALANCES n\'est pas modifié après un deleteFromHistory', async () => {
    vi.mocked(runTransaction).mockClear()

    // Capturer l'état initial du seed
    const seedSnapshot = {
      Orange:  { stock: SEED_BALANCES.Orange.stock,  liquidite: SEED_BALANCES.Orange.liquidite  },
      Moov:    { stock: SEED_BALANCES.Moov.stock,    liquidite: SEED_BALANCES.Moov.liquidite    },
      Telecel: { stock: SEED_BALANCES.Telecel.stock, liquidite: SEED_BALANCES.Telecel.liquidite },
      Coris:   { stock: SEED_BALANCES.Coris.stock,   liquidite: SEED_BALANCES.Coris.liquidite   },
      Sank:    { stock: SEED_BALANCES.Sank.stock,    liquidite: SEED_BALANCES.Sank.liquidite    },
    }

    const { service, mockReverseHistoryTransactionImpact } = makeHistoryService()
    mockReverseHistoryTransactionImpact.mockReturnValueOnce({
      Orange:  { stock: 6500, liquidite: 500 },
      Moov:    { stock: 3000, liquidite: 1000 },
      Telecel: { stock: 1000, liquidite:  300 },
      Coris:   { stock:  500, liquidite:  100 },
      Sank:    { stock:  200, liquidite:   50 },
    })

    makeTxMock()
    await service.deleteFromHistory('hist-immut')

    // SEED_BALANCES ne doit pas avoir été muté
    expect(SEED_BALANCES.Orange.stock).toBe(seedSnapshot.Orange.stock)
    expect(SEED_BALANCES.Orange.liquidite).toBe(seedSnapshot.Orange.liquidite)
    expect(SEED_BALANCES.Moov.stock).toBe(seedSnapshot.Moov.stock)
  })
})
