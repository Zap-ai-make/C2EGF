/**
 * TC-062 — addClient : anti-doublon sur le numéro/code agent (champ `orange`)
 *
 * Règle métier protégée :
 *   Un même numéro/code agent (`orange`) ne peut être enregistré qu'une seule
 *   fois PAR BOUTIQUE. La collection `clients` étant globale et isolée par le
 *   champ `registeredStoreId`, le contrôle doit filtrer sur les DEUX champs.
 *
 *   - `orange` vide/absent  → aucun contrôle, insertion autorisée.
 *   - `orange` inédit dans la boutique → insertion autorisée.
 *   - `orange` déjà présent dans la boutique → rejet (aucune écriture).
 *
 * Ces tests figent le comportement AVANT/APRÈS l'ajout du garde-fou (Lot A2).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mocks Firebase (obligatoires pour importer FirestoreService) -------------

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

import { FirestoreService } from '../../src/services/firestore.js'
import { FIRESTORE_CONFIG } from '../../src/constants/firestoreConstants.js'

const STORE = { id: 'store-A', name: 'Boutique A' }

function makeService() {
  const service = new FirestoreService()
  service.setActiveStore(STORE)
  // On isole addClient de Firestore : getCollection (lecture anti-doublon) et
  // addDocument (écriture) sont stubés au niveau instance.
  service.addDocument = vi.fn(async (_col, data) => ({ id: 'new-id', ...data }))
  service.getCollection = vi.fn(async () => [])
  return service
}

describe('TC-062 — addClient anti-doublon (numéro/code agent)', () => {
  let service
  beforeEach(() => {
    service = makeService()
  })

  it('insère quand orange est absent (pas de contrôle de doublon)', async () => {
    await service.addClient({ nom: 'Doe', prenom: 'Jane' })
    expect(service.getCollection).not.toHaveBeenCalled()
    expect(service.addDocument).toHaveBeenCalledTimes(1)
    expect(service.addDocument).toHaveBeenCalledWith(
      FIRESTORE_CONFIG.COLLECTIONS.CLIENTS,
      expect.objectContaining({ registeredStoreId: 'store-A' }),
    )
  })

  it('insère quand orange est inédit dans la boutique', async () => {
    service.getCollection.mockResolvedValueOnce([]) // aucun doublon
    await service.addClient({ nom: 'Doe', prenom: 'John', orange: 'AG-123' })
    expect(service.addDocument).toHaveBeenCalledTimes(1)
  })

  it('filtre le contrôle sur orange ET registeredStoreId (isolation boutique)', async () => {
    await service.addClient({ nom: 'Doe', prenom: 'John', orange: 'AG-123' })
    expect(service.getCollection).toHaveBeenCalledTimes(1)
    const [collectionName, options] = service.getCollection.mock.calls[0]
    expect(collectionName).toBe(FIRESTORE_CONFIG.COLLECTIONS.CLIENTS)
    expect(options.where).toEqual(
      expect.arrayContaining([
        { field: 'orange', operator: '==', value: 'AG-123' },
        { field: 'registeredStoreId', operator: '==', value: 'store-A' },
      ]),
    )
  })

  it('rejette et n’écrit pas quand orange existe déjà dans la boutique', async () => {
    service.getCollection.mockResolvedValueOnce([{ id: 'existing', orange: 'AG-123' }])
    await expect(
      service.addClient({ nom: 'Doe', prenom: 'John', orange: 'AG-123' }),
    ).rejects.toThrow(/existe déjà/i)
    expect(service.addDocument).not.toHaveBeenCalled()
  })

  it('ignore les espaces autour du code agent (trim) avant contrôle', async () => {
    await service.addClient({ nom: 'Doe', prenom: 'John', orange: '  AG-123  ' })
    const [, options] = service.getCollection.mock.calls[0]
    expect(options.where).toEqual(
      expect.arrayContaining([{ field: 'orange', operator: '==', value: 'AG-123' }]),
    )
  })
})
