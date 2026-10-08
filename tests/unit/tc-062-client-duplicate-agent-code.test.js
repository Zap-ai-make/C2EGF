/**
 * TC-062 — addClient : anti-doublon sur le code agent et le numéro agent
 *
 * Règle métier protégée :
 *   Un même code agent ou numéro agent ne peut être enregistré qu'une seule
 *   fois PAR BOUTIQUE. La collection `clients` étant globale et isolée par le
 *   champ `registeredStoreId`, le contrôle doit filtrer sur les DEUX champs.
 *
 *   - valeur vide/absente  → aucun contrôle, insertion autorisée.
 *   - valeur inédite dans la boutique → insertion autorisée.
 *   - valeur déjà présente dans la boutique → rejet (aucune écriture).
 *
 * ⚠ TROIS CHAMPS SONT INTERROGÉS DEPUIS LA SÉPARATION (TC-233), et le
 *   troisième est l'ANCIEN. Les fiches d'avant vivent toutes dans `orange` :
 *   ne chercher que dans `codeAgent` et `numeroAgent` laisserait réenregistrer
 *   un agent que la boutique connaît depuis des mois, et lui donnerait deux
 *   fiches pour la même personne.
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

  it('cherche la valeur dans les trois champs, toujours avec registeredStoreId', async () => {
    await service.addClient({ nom: 'Doe', prenom: 'John', codeAgent: 'AG-123' })

    const champsInterroges = service.getCollection.mock.calls.map(
      ([, options]) => options.where.find((w) => w.field !== 'registeredStoreId'),
    )
    expect(champsInterroges).toEqual([
      { field: 'codeAgent', operator: '==', value: 'AG-123' },
      { field: 'numeroAgent', operator: '==', value: 'AG-123' },
      { field: 'orange', operator: '==', value: 'AG-123' },
    ])

    for (const [collectionName, options] of service.getCollection.mock.calls) {
      expect(collectionName).toBe(FIRESTORE_CONFIG.COLLECTIONS.CLIENTS)
      expect(options.where).toContainEqual(
        { field: 'registeredStoreId', operator: '==', value: 'store-A' },
      )
    }
  })

  /**
   * Le cas qui justifie le troisième champ : la fiche existante n'a jamais été
   * rouverte depuis la séparation, son code vit encore dans `orange`.
   */
  it('rejette un code déjà enregistré sous l’ancien champ', async () => {
    service.getCollection
      .mockResolvedValueOnce([])                                 // codeAgent
      .mockResolvedValueOnce([])                                 // numeroAgent
      .mockResolvedValueOnce([{ id: 'ancien', orange: 'AG-123' }]) // orange

    await expect(
      service.addClient({ nom: 'Doe', prenom: 'John', codeAgent: 'AG-123' }),
    ).rejects.toThrow(/existe déjà/i)
    expect(service.addDocument).not.toHaveBeenCalled()
  })

  it('contrôle le numéro agent comme le code agent', async () => {
    await service.addClient({ nom: 'Doe', prenom: 'John', numeroAgent: '70112233' })

    const valeurs = service.getCollection.mock.calls.map(
      ([, options]) => options.where.find((w) => w.field !== 'registeredStoreId').value,
    )
    expect(new Set(valeurs)).toEqual(new Set(['70112233']))
  })

  it('rejette et n’écrit pas quand orange existe déjà dans la boutique', async () => {
    service.getCollection.mockResolvedValueOnce([{ id: 'existing', orange: 'AG-123' }])
    await expect(
      service.addClient({ nom: 'Doe', prenom: 'John', orange: 'AG-123' }),
    ).rejects.toThrow(/existe déjà/i)
    expect(service.addDocument).not.toHaveBeenCalled()
  })

  it('ignore les espaces autour du code agent (trim) avant contrôle', async () => {
    await service.addClient({ nom: 'Doe', prenom: 'John', codeAgent: '  AG-123  ' })
    const [, options] = service.getCollection.mock.calls[0]
    expect(options.where).toEqual(
      expect.arrayContaining([{ field: 'codeAgent', operator: '==', value: 'AG-123' }]),
    )
  })
})
