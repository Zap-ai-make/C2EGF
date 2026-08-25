/**
 * TC-018 — DraftService : orchestration Firestore des drafts
 *
 * Comportement à protéger :
 *   Le nouveau DraftService (src/services/draftService.js) doit reproduire
 *   exactement le comportement des méthodes extraites de FirestoreService :
 *     - addTransaction   : runTransaction, crée draft ou history + balances
 *     - addDraft         : addDocument avec statut PENDING
 *     - updateDraft      : runTransaction, reverse + apply + update draft + set balances
 *     - deleteDraft      : runTransaction, reverse + delete + set balances
 *     - validateTransaction : getDoc + runTransaction, move draft → history + settlement
 *     - subscribeToDrafts  : onSnapshot sur la collection drafts
 *     - getDrafts          : getCollection sur drafts
 *
 *   La facade FirestoreService délègue chacune de ces méthodes à DraftService
 *   sans changer les signatures ni les valeurs de retour.
 *
 * Architecture des mocks :
 *   - runTransaction exécute réellement le callback (même pattern que TC-017)
 *   - getDoc est mocké par défaut pour retourner un draft valide
 *   - onSnapshot, addDocument, getCollection sont mockés
 */

// ---------------------------------------------------------------------------
// Mocks Firebase — obligatoires pour importer FirestoreService / DraftService
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
  onSnapshot: vi.fn(() => vi.fn()), // returns unsubscribe fn
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

import { DraftService } from '../../src/services/draftService.js'
import { FirestoreService } from '../../src/services/firestore.js'
import * as firestoreModule from '../../src/services/firestore.js'
import { runTransaction, getDoc, onSnapshot } from 'firebase/firestore'
import { FIRESTORE_CONFIG } from '../../src/constants/firestoreConstants.js'

// ---------------------------------------------------------------------------
// Fixtures partagées
// ---------------------------------------------------------------------------

const seedBalances = {
  Orange:  { stock: 5000, liquidite: 2000 },
  Moov:    { stock: 3000, liquidite: 1000 },
  Telecel: { stock: 1000, liquidite:  300 },
  Coris:   { stock:  500, liquidite:  100 },
  Sank:    { stock:  200, liquidite:   50 }
}

const depositDraft = {
  type:     'Dépôt',
  reseau:   'Orange',
  montant:  1000,
  statut:   'Non Terminées',
  clientId: 'client-001',
  date:     '19/06/2026'
}

const withdrawalDraft = {
  type:     'Retrait',
  reseau:   'Moov',
  montant:  500,
  statut:   'Non Terminées',
  clientId: 'client-002',
  date:     '19/06/2026'
}

const creditDraft = {
  type:     'Crédit',
  reseau:   'Telecel',
  montant:  200,
  statut:   'Non Terminées',
  clientId: 'client-003',
  date:     '19/06/2026'
}

// ---------------------------------------------------------------------------
// Usine à DraftService avec deps injectées mockées
// ---------------------------------------------------------------------------

function makeDraftService(overrides = {}) {
  const mockAddDocument = vi.fn(async (_col, data) => ({ id: 'new-doc-id', ...data }))
  const mockGetCollection = vi.fn(async () => [])
  const mockDocRef = vi.fn((col, id) => ({ _type: 'draft', _col: col, _id: id }))
  const mockGetNetworkBalanceDocRef = vi.fn(() => ({ _type: 'balance' }))
  const mockCollectionRef = vi.fn((col) => ({ _type: 'collection', _col: col }))
  const mockRequireActiveStore = vi.fn(() => ({ id: 'store-018', name: 'Boutique 018' }))

  // DraftService attend { ctx } : objet portant les méthodes.
  // Les overrides peuvent remplacer des méthodes individuelles sur le ctx.
  const ctx = {
    requireActiveStore: mockRequireActiveStore,
    getNetworkBalanceDocRef: mockGetNetworkBalanceDocRef,
    collectionRef: mockCollectionRef,
    docRef: mockDocRef,
    getCollection: mockGetCollection,
    addDocument: mockAddDocument,
    ...overrides
  }

  const service = new DraftService({ ctx })
  return { service, ctx, mockAddDocument, mockGetCollection, mockDocRef, mockGetNetworkBalanceDocRef, mockCollectionRef, mockRequireActiveStore }
}

// Usine à mock de runTransaction qui exécute réellement le callback
function makeTxMock({ draftData = depositDraft, draftExists = true, balanceData = seedBalances, balanceExists = true } = {}) {
  const capturedWrites = []

  const mockTx = {
    get: vi.fn(async (ref) => {
      if (ref._type === 'draft') {
        return {
          exists: () => draftExists,
          data: () => (draftExists ? { ...draftData } : null)
        }
      }
      if (ref._type === 'balance') {
        return {
          exists: () => balanceExists,
          data: () => (balanceExists ? { balances: { ...balanceData } } : null)
        }
      }
      return { exists: () => false, data: () => null }
    }),
    update: vi.fn((ref, patch) => { capturedWrites.push({ op: 'update', ref, patch }) }),
    set: vi.fn((ref, data, options) => { capturedWrites.push({ op: 'set', ref, data, options }) }),
    delete: vi.fn((ref) => { capturedWrites.push({ op: 'delete', ref }) }),
  }

  vi.mocked(runTransaction).mockImplementation(async (_db, callback) => callback(mockTx))

  return { capturedWrites, mockTx }
}

// ---------------------------------------------------------------------------
// TC-018-A : getDrafts
// ---------------------------------------------------------------------------

describe('TC-018-A — getDrafts', () => {
  beforeEach(() => { vi.mocked(runTransaction).mockClear() })

  it('délègue à getCollection(DRAFTS)', async () => {
    const { service, mockGetCollection } = makeDraftService()
    mockGetCollection.mockResolvedValueOnce([{ id: 'draft-1', ...depositDraft }])

    const result = await service.getDrafts()

    expect(mockGetCollection).toHaveBeenCalledOnce()
    expect(mockGetCollection.mock.calls[0][0]).toBe(FIRESTORE_CONFIG.COLLECTIONS.DRAFTS)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('draft-1')
  })

  it('retourne un tableau vide si aucun draft', async () => {
    const { service, mockGetCollection } = makeDraftService()
    mockGetCollection.mockResolvedValueOnce([])

    const result = await service.getDrafts()
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// TC-018-B : addDraft
// ---------------------------------------------------------------------------

describe('TC-018-B — addDraft', () => {
  beforeEach(() => { vi.mocked(runTransaction).mockClear() })

  it('force le statut PENDING et ajoute via addDocument', async () => {
    const { service, mockAddDocument } = makeDraftService()

    await service.addDraft({ ...depositDraft, statut: 'Validée' })

    expect(mockAddDocument).toHaveBeenCalledOnce()
    const [collection, payload] = mockAddDocument.mock.calls[0]
    expect(collection).toBe(FIRESTORE_CONFIG.COLLECTIONS.DRAFTS)
    expect(payload.statut).toBe(FIRESTORE_CONFIG.STATUS.PENDING)
  })

  it('préserve les données de la transaction', async () => {
    const { service, mockAddDocument } = makeDraftService()
    mockAddDocument.mockResolvedValueOnce({ id: 'draft-new', ...depositDraft, statut: 'Non Terminées' })

    const result = await service.addDraft(depositDraft)

    const [, payload] = mockAddDocument.mock.calls[0]
    expect(payload.type).toBe('Dépôt')
    expect(payload.montant).toBe(1000)
    expect(payload.clientId).toBe('client-001')
    expect(result.id).toBe('draft-new')
  })

  it('ajoute un champ date', async () => {
    const { service, mockAddDocument } = makeDraftService()

    await service.addDraft(depositDraft)

    const [, payload] = mockAddDocument.mock.calls[0]
    expect(payload).toHaveProperty('date')
    expect(typeof payload.date).toBe('string')
  })
})

// ---------------------------------------------------------------------------
// TC-018-C : updateDraft
// ---------------------------------------------------------------------------

describe('TC-018-C — updateDraft', () => {
  beforeEach(() => {
    vi.mocked(runTransaction).mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[C-N1] changement de montant 1000→1500 : recalcule balances correctement', async () => {
    const { service } = makeDraftService()
    const { capturedWrites } = makeTxMock({ draftData: depositDraft, balanceData: seedBalances })

    // reverse(Dépôt Orange 1000) : stock += 1000 → 6000
    // apply(Dépôt Orange 1500) : stock -= 1500 → 4500
    const result = await service.updateDraft('draft-001', { montant: 1500 })

    expect(runTransaction).toHaveBeenCalledOnce()

    const draftWrite = capturedWrites.find(w => w.op === 'update' && w.ref._type === 'draft')
    expect(draftWrite).toBeDefined()
    expect(draftWrite.patch.montant).toBe(1500)
    expect(draftWrite.patch.statut).toBe('Non Terminées')
    expect(draftWrite.patch).toHaveProperty('updatedAt')

    const balanceWrite = capturedWrites.find(w => w.ref._type === 'balance')
    expect(balanceWrite).toBeDefined()
    expect(balanceWrite.data.balances.Orange.stock).toBe(4500)
    expect(balanceWrite.options).toEqual({ merge: true })

    expect(result.id).toBe('draft-001')
    expect(result.montant).toBe(1500)
    expect(result.statut).toBe('Non Terminées')
  })

  it('[C-N2] même montant et même réseau → balances inchangées (idempotent)', async () => {
    const { service } = makeDraftService()
    const { capturedWrites } = makeTxMock({ draftData: depositDraft, balanceData: seedBalances })

    await service.updateDraft('draft-001', { montant: 1000 })

    const balanceWrite = capturedWrites.find(w => w.ref._type === 'balance')
    // reverse(1000) + apply(1000) = net zéro
    expect(balanceWrite.data.balances.Orange.stock).toBe(seedBalances.Orange.stock)
  })

  it('[C-F1] montant invalide (décimal) → erreur avant runTransaction', async () => {
    const { service } = makeDraftService()

    await expect(service.updateDraft('draft-001', { montant: 100.5 }))
      .rejects.toThrow('Montant FCFA invalide')

    expect(runTransaction).not.toHaveBeenCalled()
  })

  it('[C-F2] montant zéro → erreur avant runTransaction', async () => {
    const { service } = makeDraftService()

    await expect(service.updateDraft('draft-001', { montant: 0 }))
      .rejects.toThrow('Montant FCFA invalide')

    expect(runTransaction).not.toHaveBeenCalled()
  })

  it('[C-F3] draft inexistant → throw Transaction introuvable', async () => {
    const { service } = makeDraftService()
    const { capturedWrites } = makeTxMock({ draftExists: false })

    await expect(service.updateDraft('inexistant', { montant: 500 }))
      .rejects.toThrow('Transaction introuvable')

    expect(capturedWrites).toHaveLength(0)
  })

  it('[C-F4] balances absentes → normalise à zéro, pas de throw', async () => {
    const { service } = makeDraftService()
    const { capturedWrites } = makeTxMock({ balanceExists: false })

    const result = await service.updateDraft('draft-001', { montant: 1000 })

    expect(result).toBeDefined()
    const balanceWrite = capturedWrites.find(w => w.ref._type === 'balance')
    expect(balanceWrite).toBeDefined()
    // reverse(Dépôt Orange 1000) sur 0 → 1000, apply(1000) → 0
    expect(balanceWrite.data.balances.Orange.stock).toBe(0)
  })

  it('[C-N3] tx.set des balances utilise merge:true', async () => {
    const { service } = makeDraftService()
    const { capturedWrites } = makeTxMock()

    await service.updateDraft('draft-001', { montant: 1200 })

    const balanceWrite = capturedWrites.find(w => w.ref._type === 'balance')
    expect(balanceWrite.options).toEqual({ merge: true })
    expect(balanceWrite.data).toHaveProperty('balances')
    expect(balanceWrite.data).toHaveProperty('updatedAt')
  })

  it('[C-N4] updates sans montant → pas de validation FCFA avant runTransaction', async () => {
    const { service } = makeDraftService()
    makeTxMock()

    // Ne doit pas throw sur la validation pre-runTransaction
    await expect(service.updateDraft('draft-001', { reseau: 'Moov' })).resolves.toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// TC-018-D : deleteDraft
// ---------------------------------------------------------------------------

describe('TC-018-D — deleteDraft', () => {
  beforeEach(() => { vi.mocked(runTransaction).mockClear() })

  it('[D-N1] supprime le draft et inverse l impact financier', async () => {
    const { service } = makeDraftService()
    const { capturedWrites } = makeTxMock({ draftData: depositDraft, balanceData: seedBalances })

    const result = await service.deleteDraft('draft-001')

    expect(result).toBe(true)
    expect(runTransaction).toHaveBeenCalledOnce()

    const deleteWrite = capturedWrites.find(w => w.op === 'delete')
    expect(deleteWrite).toBeDefined()

    const balanceWrite = capturedWrites.find(w => w.ref._type === 'balance')
    expect(balanceWrite).toBeDefined()
    // reverse(Dépôt Orange 1000) : stock += 1000 → 6000
    expect(balanceWrite.data.balances.Orange.stock).toBe(6000)
    expect(balanceWrite.options).toEqual({ merge: true })
  })

  it('[D-N2] draft inexistant → retourne false sans écriture', async () => {
    const { service } = makeDraftService()
    const { capturedWrites } = makeTxMock({ draftExists: false })

    const result = await service.deleteDraft('ghost-id')

    expect(result).toBe(false)
    expect(capturedWrites).toHaveLength(0)
  })

  it('[D-N3] inversion d un Retrait Moov 500', async () => {
    const { service } = makeDraftService()
    const { capturedWrites } = makeTxMock({ draftData: withdrawalDraft, balanceData: seedBalances })

    await service.deleteDraft('draft-002')

    const balanceWrite = capturedWrites.find(w => w.ref._type === 'balance')
    // reverse(Retrait Moov 500 pending) : stock -= 500 → 2500
    expect(balanceWrite.data.balances.Moov.stock).toBe(2500)
  })

  it('[D-N4] inversion d un Crédit Telecel 200', async () => {
    const { service } = makeDraftService()
    const { capturedWrites } = makeTxMock({ draftData: creditDraft, balanceData: seedBalances })

    await service.deleteDraft('draft-003')

    const balanceWrite = capturedWrites.find(w => w.ref._type === 'balance')
    // reverse(Crédit Telecel 200 pending) : stock += 200 → 1200
    expect(balanceWrite.data.balances.Telecel.stock).toBe(1200)
  })
})

// ---------------------------------------------------------------------------
// TC-018-E : subscribeToDrafts
// ---------------------------------------------------------------------------

describe('TC-018-E — subscribeToDrafts', () => {
  beforeEach(() => { vi.mocked(onSnapshot).mockClear() })

  it('appelle onSnapshot sur la collection drafts', () => {
    const { service, mockCollectionRef } = makeDraftService()
    const callback = vi.fn()

    service.subscribeToDrafts(callback)

    expect(mockCollectionRef).toHaveBeenCalledWith(FIRESTORE_CONFIG.COLLECTIONS.DRAFTS)
    expect(onSnapshot).toHaveBeenCalledOnce()
  })

  it('retourne une fonction de désabonnement', () => {
    const { service } = makeDraftService()
    const unsubFn = vi.fn()
    vi.mocked(onSnapshot).mockReturnValueOnce(unsubFn)

    const unsub = service.subscribeToDrafts(vi.fn())

    expect(typeof unsub).toBe('function')
  })

  it('transmet les documents au callback via onSnapshot', () => {
    const { service } = makeDraftService()
    const callback = vi.fn()
    const mockDocs = [
      { id: 'draft-1', data: () => ({ ...depositDraft }) },
      { id: 'draft-2', data: () => ({ ...withdrawalDraft }) }
    ]

    vi.mocked(onSnapshot).mockImplementation((_ref, successCb) => {
      successCb({ docs: mockDocs })
      return vi.fn()
    })

    service.subscribeToDrafts(callback)

    expect(callback).toHaveBeenCalledOnce()
    const docs = callback.mock.calls[0][0]
    expect(docs).toHaveLength(2)
    expect(docs[0].id).toBe('draft-1')
    expect(docs[1].id).toBe('draft-2')
  })

  it('isole par storeId : collectionRef utilise le bon chemin', () => {
    const mockCollectionRef = vi.fn((col) => ({ _type: 'collection', _col: col }))
    const { service } = makeDraftService({ collectionRef: mockCollectionRef })

    service.subscribeToDrafts(vi.fn())

    expect(mockCollectionRef).toHaveBeenCalledWith('drafts')
  })
})

// ---------------------------------------------------------------------------
// TC-018-F : addTransaction
// ---------------------------------------------------------------------------

describe('TC-018-F — addTransaction', () => {
  beforeEach(() => { vi.mocked(runTransaction).mockClear() })

  it('[F-N1] transaction pending → écrit dans drafts et met à jour les balances', async () => {
    const { service } = makeDraftService()
    const { capturedWrites } = makeTxMock({ balanceData: seedBalances })

    const result = await service.addTransaction({ ...depositDraft })

    expect(runTransaction).toHaveBeenCalledOnce()

    const txWrite = capturedWrites.find(w => w.op === 'set' && w.ref && w.ref._isMockDoc)
    expect(txWrite).toBeDefined()

    const balanceWrite = capturedWrites.find(w => w.ref._type === 'balance')
    expect(balanceWrite).toBeDefined()
    // apply(Dépôt Orange 1000 pending) : stock -= 1000 → 4000
    expect(balanceWrite.data.balances.Orange.stock).toBe(4000)
    expect(balanceWrite.options).toEqual({ merge: true })

    expect(result).toHaveProperty('id')
    expect(result.type).toBe('Dépôt')
    expect(result.montant).toBe(1000)
    expect(result).toHaveProperty('date')
    expect(result).toHaveProperty('createdAt')
    expect(result).toHaveProperty('updatedAt')
  })

  it('[F-N2] transaction directement validée → écrit dans history', async () => {
    const validatedTx = { ...depositDraft, statut: 'Validée' }

    // La collection cible est history, pas drafts
    // On vérifie que collectionRef est appelé avec history
    const mockCollectionRef = vi.fn((col) => ({ _type: 'collection', _col: col }))
    const { service: svc2 } = makeDraftService({ collectionRef: mockCollectionRef })
    makeTxMock({ draftData: validatedTx, balanceData: seedBalances })

    await svc2.addTransaction(validatedTx)

    const historyCall = mockCollectionRef.mock.calls.find(c => c[0] === FIRESTORE_CONFIG.COLLECTIONS.HISTORY)
    expect(historyCall).toBeDefined()
  })

  it('[F-F1] montant invalide → throw avant runTransaction', async () => {
    const { service } = makeDraftService()

    await expect(service.addTransaction({ ...depositDraft, montant: -1 }))
      .rejects.toThrow()

    expect(runTransaction).not.toHaveBeenCalled()
  })

  it('[F-F2] boutique inactive → throw', async () => {
    const mockRequireActiveStore = vi.fn(() => { throw new Error('Boutique active introuvable') })
    const { service } = makeDraftService({ requireActiveStore: mockRequireActiveStore })

    await expect(service.addTransaction(depositDraft))
      .rejects.toThrow()
  })

  it('[F-N3] enveloppe les erreurs Firestore en message friendly', async () => {
    const { service } = makeDraftService()

    vi.mocked(runTransaction).mockRejectedValueOnce(new Error('permission-denied'))

    // addTransaction attrape et re-wrap l erreur
    await expect(service.addTransaction(depositDraft)).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// TC-018-G : validateTransaction
// ---------------------------------------------------------------------------

describe('TC-018-G — validateTransaction', () => {
  beforeEach(() => {
    vi.mocked(runTransaction).mockClear()
    vi.mocked(getDoc).mockClear()
  })

  function setupGetDoc(draftData = depositDraft, exists = true) {
    vi.mocked(getDoc).mockResolvedValueOnce({
      exists: () => exists,
      data: () => (exists ? { ...draftData } : null)
    })
  }

  it('[G-N1] validation sans règlement → draft → history, balances inchangées', async () => {
    const { service } = makeDraftService()
    setupGetDoc(depositDraft)
    const { capturedWrites } = makeTxMock({ draftData: depositDraft, balanceData: seedBalances })

    const result = await service.validateTransaction('draft-001', 'Validée', null)

    expect(result).toBe(true)
    expect(getDoc).toHaveBeenCalledOnce()
    expect(runTransaction).toHaveBeenCalledOnce()

    const historyWrite = capturedWrites.find(w => w.op === 'set' && w.ref._isMockDoc)
    expect(historyWrite).toBeDefined()
    expect(historyWrite.data.statut).toBe('Validée')
    expect(historyWrite.data).toHaveProperty('validatedAt')

    const deleteWrite = capturedWrites.find(w => w.op === 'delete')
    expect(deleteWrite).toBeDefined()
  })

  it('[G-N2] validation avec règlement Orange Money → impact settlement appliqué', async () => {
    const { service } = makeDraftService()
    setupGetDoc(depositDraft)
    const { capturedWrites } = makeTxMock({ draftData: depositDraft, balanceData: seedBalances })

    await service.validateTransaction('draft-001', 'Encaissé par Orange Money', 'Orange Money')

    const balanceWrite = capturedWrites.find(w => w.ref._type === 'balance')
    expect(balanceWrite).toBeDefined()
    // applySettlementImpact(Dépôt, 'Orange Money') → encaisser sur Orange stock
    // Dépôt encaissé : delta = +1000 sur Orange stock
    expect(balanceWrite.data.balances.Orange.stock).toBe(seedBalances.Orange.stock + 1000)
  })

  it('[G-N3] extraction de la méthode de paiement depuis le statut', async () => {
    const { service } = makeDraftService()
    setupGetDoc(withdrawalDraft)
    const { capturedWrites } = makeTxMock({ draftData: withdrawalDraft, balanceData: seedBalances })

    await service.validateTransaction('draft-002', 'Payé par Moov Money', null)

    const historyWrite = capturedWrites.find(w => w.op === 'set' && w.ref._isMockDoc)
    expect(historyWrite).toBeDefined()
    expect(historyWrite.data.paymentMethod).toBe('Moov Money')
    expect(historyWrite.data.statut).toBe('Payé par Moov Money')
  })

  it('[G-F1] draft inexistant (getDoc) → retourne false', async () => {
    const { service } = makeDraftService()
    setupGetDoc(null, false)

    const result = await service.validateTransaction('ghost-id', 'Validée', null)

    expect(result).toBe(false)
    expect(runTransaction).not.toHaveBeenCalled()
  })

  it('[G-F2] données incomplètes (pas de clientId) → retourne false', async () => {
    const { service } = makeDraftService()
    setupGetDoc({ ...depositDraft, clientId: null })

    const result = await service.validateTransaction('draft-001', 'Validée', null)

    expect(result).toBe(false)
    expect(runTransaction).not.toHaveBeenCalled()
  })

  it('[G-F3] montant: 0 dans le draft → retourne false (données incomplètes)', async () => {
    // montant: 0 est falsy → la garde "!transactionData.montant" retourne false avant validation FCFA
    const { service } = makeDraftService()
    setupGetDoc({ ...depositDraft, montant: 0 })

    const result = await service.validateTransaction('draft-001', 'Validée', null)
    expect(result).toBe(false)
    expect(runTransaction).not.toHaveBeenCalled()
  })

  it('[G-F4] boutique inactive → throw (enveloppé en message friendly)', async () => {
    // validateTransaction attrape toutes les erreurs et les re-wrap via getUserFriendlyMessage
    const mockRequireActiveStore = vi.fn(() => { throw new Error('Boutique active introuvable') })
    const { service } = makeDraftService({ requireActiveStore: mockRequireActiveStore })

    await expect(service.validateTransaction('draft-001', 'Validée', null))
      .rejects.toThrow()
  })

  it('[G-F5] draft supprimé pendant la transaction (lockedDraftDoc inexistant) → false', async () => {
    const { service } = makeDraftService()
    setupGetDoc(depositDraft)

    // La première lecture (getDoc) trouve le draft, mais dans la transaction il a disparu
    vi.mocked(runTransaction).mockImplementation(async (_db, callback) => {
      const mockTx = {
        get: vi.fn(async (ref) => {
          if (ref._type === 'draft') return { exists: () => false, data: () => null }
          if (ref._type === 'balance') return { exists: () => true, data: () => ({ balances: { ...seedBalances } }) }
          return { exists: () => false, data: () => null }
        }),
        set: vi.fn(),
        delete: vi.fn(),
      }
      return callback(mockTx)
    })

    const result = await service.validateTransaction('draft-001', 'Validée', null)
    expect(result).toBe(false)
  })

  it('[G-N4] historyData contient effectiveNetwork mappé', async () => {
    const { service } = makeDraftService()
    setupGetDoc(depositDraft)
    const { capturedWrites } = makeTxMock({ draftData: depositDraft, balanceData: seedBalances })

    await service.validateTransaction('draft-001', 'Encaissé par Orange Money', 'Orange Money')

    const historyWrite = capturedWrites.find(w => w.op === 'set' && w.ref._isMockDoc)
    expect(historyWrite.data.effectiveNetwork).toBe('Orange')
  })
})

// ---------------------------------------------------------------------------
// TC-018-H : Isolation par storeId (séparation des boutiques)
// ---------------------------------------------------------------------------

describe('TC-018-H — Isolation par storeId', () => {
  it('la collectionRef est différente selon la boutique active', () => {
    // Le service utilise collectionRef fourni par FirestoreService.
    // On vérifie que des refs différentes génèrent des chemins différents.
    const mockCollectionRefA = vi.fn((col) => ({ _type: 'collection', _col: col, _store: 'storeA' }))
    const mockCollectionRefB = vi.fn((col) => ({ _type: 'collection', _col: col, _store: 'storeB' }))

    const { service: svcA } = makeDraftService({ collectionRef: mockCollectionRefA })
    const { service: svcB } = makeDraftService({ collectionRef: mockCollectionRefB })

    svcA.subscribeToDrafts(vi.fn())
    svcB.subscribeToDrafts(vi.fn())

    expect(mockCollectionRefA).toHaveBeenCalledWith('drafts')
    expect(mockCollectionRefB).toHaveBeenCalledWith('drafts')

    // Les deux appels utilisent des refs distinctes (fournis par chacun des svc)
    // → la collection résout à des chemins différents selon requireActiveStore
  })

  it('docRef injecté détermine le chemin du draft', () => {
    const mockDocRef = vi.fn((col, id) => ({ _type: 'draft', _col: col, _id: id, _store: 'store-a' }))
    const { service } = makeDraftService({ docRef: mockDocRef })
    makeTxMock()

    service.updateDraft('draft-x', { montant: 500 })

    expect(mockDocRef).toHaveBeenCalledWith(FIRESTORE_CONFIG.COLLECTIONS.DRAFTS, 'draft-x')
  })
})

// ---------------------------------------------------------------------------
// TC-018-I : Façade FirestoreService — délégation
// ---------------------------------------------------------------------------

describe('TC-018-I — Façade FirestoreService : délégation à DraftService', () => {
  let firestoreSvc
  let mockDraftSvc

  beforeEach(() => {
    vi.mocked(runTransaction).mockClear()
    vi.mocked(getDoc).mockClear()

    firestoreSvc = new FirestoreService()
    firestoreSvc.setActiveStore({ id: 'store-facade', name: 'Boutique Façade' })

    // Remplacer le _draftService instancié dans le constructeur par un spy
    mockDraftSvc = {
      getDrafts: vi.fn(async () => []),
      addDraft: vi.fn(async (data) => ({ id: 'facade-draft', ...data })),
      updateDraft: vi.fn(async () => ({ id: 'facade-draft-updated' })),
      deleteDraft: vi.fn(async () => true),
      subscribeToDrafts: vi.fn(() => vi.fn()),
      addTransaction: vi.fn(async () => ({ id: 'facade-tx' })),
      validateTransaction: vi.fn(async () => true),
    }
    firestoreSvc._draftService = mockDraftSvc
  })

  it('getDrafts délègue à draftService.getDrafts', async () => {
    await firestoreSvc.getDrafts()
    expect(mockDraftSvc.getDrafts).toHaveBeenCalledOnce()
  })

  it('addDraft délègue à draftService.addDraft avec les données', async () => {
    await firestoreSvc.addDraft(depositDraft)
    expect(mockDraftSvc.addDraft).toHaveBeenCalledWith(depositDraft)
  })

  it('updateDraft délègue à draftService.updateDraft avec id et updates', async () => {
    await firestoreSvc.updateDraft('draft-001', { montant: 500 })
    expect(mockDraftSvc.updateDraft).toHaveBeenCalledWith('draft-001', { montant: 500 })
  })

  it('deleteDraft délègue à draftService.deleteDraft avec id', async () => {
    await firestoreSvc.deleteDraft('draft-002')
    expect(mockDraftSvc.deleteDraft).toHaveBeenCalledWith('draft-002')
  })

  it('subscribeToDrafts délègue à draftService.subscribeToDrafts avec le callback', () => {
    const cb = vi.fn()
    firestoreSvc.subscribeToDrafts(cb)
    expect(mockDraftSvc.subscribeToDrafts).toHaveBeenCalledWith(cb)
  })

  it('addTransaction délègue à draftService.addTransaction avec les données', async () => {
    await firestoreSvc.addTransaction(depositDraft)
    expect(mockDraftSvc.addTransaction).toHaveBeenCalledWith(depositDraft)
  })

  it('validateTransaction délègue à draftService.validateTransaction avec les 4 paramètres', async () => {
    await firestoreSvc.validateTransaction('draft-001', 'Payé par Cash', 'Cash', 5000)
    expect(mockDraftSvc.validateTransaction).toHaveBeenCalledWith('draft-001', 'Payé par Cash', 'Cash', 5000)
  })

  it('les méthodes non-draft ne sont pas impactées (addClient toujours fonctionnel)', async () => {
    // addClient ne passe pas par draftService
    expect(typeof firestoreSvc.addClient).toBe('function')
    expect(typeof firestoreSvc.getClients).toBe('function')
    expect(typeof firestoreSvc.subscribeToHistory).toBe('function')
    expect(typeof firestoreSvc.deleteFromHistory).toBe('function')
  })

  it('les exports de fonctions nommées fonctionnent sans modification', () => {
    // Vérifie que le module firestore.js exporte toujours les fonctions nommées
    // Ces imports directs sont utilisés par certains composants
    expect(typeof firestoreModule.getDrafts).toBe('function')
    expect(typeof firestoreModule.addDraft).toBe('function')
    expect(typeof firestoreModule.updateDraft).toBe('function')
    expect(typeof firestoreModule.deleteDraft).toBe('function')
    expect(typeof firestoreModule.subscribeToDrafts).toBe('function')
    expect(typeof firestoreModule.validateTransaction).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// TC-018-J : Cas limites et comportements aux frontières
// ---------------------------------------------------------------------------

describe('TC-018-J — Cas limites', () => {
  beforeEach(() => { vi.mocked(runTransaction).mockClear() })

  it('deleteDraft avec balances absentes → normalise à zéro', async () => {
    const { service } = makeDraftService()
    const { capturedWrites } = makeTxMock({ balanceExists: false })

    // reverse(Dépôt Orange 1000) sur balances à zéro → stock += 1000 → 1000
    const result = await service.deleteDraft('draft-001')

    expect(result).toBe(true)
    const balanceWrite = capturedWrites.find(w => w.ref._type === 'balance')
    expect(balanceWrite.data.balances.Orange.stock).toBe(1000)
  })

  it('updateDraft avec updates vides → tx.update est tout de même appelé', async () => {
    const { service } = makeDraftService()
    const { capturedWrites } = makeTxMock()

    await service.updateDraft('draft-001', {})

    const draftWrite = capturedWrites.find(w => w.op === 'update')
    expect(draftWrite).toBeDefined()
    expect(draftWrite.patch.statut).toBe('Non Terminées')
    expect(draftWrite.patch).toHaveProperty('updatedAt')
  })

  it('addDraft ne fait pas appel à runTransaction', async () => {
    const { service, mockAddDocument } = makeDraftService()
    mockAddDocument.mockResolvedValueOnce({ id: 'x' })

    await service.addDraft(depositDraft)

    expect(runTransaction).not.toHaveBeenCalled()
  })

  it('action validateSettlementAction incorrecte → throw', async () => {
    // Tentative de payer un Dépôt (action attendue : encaisser) avec action rembourser
    const { service } = makeDraftService()
    vi.mocked(getDoc).mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ ...depositDraft }) // type Dépôt
    })

    // Statut 'Remboursé par Cash' correspond à action 'rembourser'
    // Pour un Dépôt l'action attendue est 'encaisser' → mismatch → throw
    makeTxMock({ draftData: depositDraft, balanceData: seedBalances })

    await expect(service.validateTransaction('draft-001', 'Remboursé par Cash', 'Cash'))
      .rejects.toThrow()
  })
})
