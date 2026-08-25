/**
 * TC-032 — Tests unitaires storeAdminDealerService.js
 *
 * Couvre :
 *   - Validation contexte Store Admin
 *   - Validation filtres (statut inconnu, type inconnu)
 *   - listStoreAdminDealerRequests : sans filtre, filtre statut, filtre type, statut+type
 *   - Pagination N+1 : 19, 20, 21 docs
 *   - Curseur startAfter
 *   - Contrat de retour { requests, lastDoc, hasMore }
 *   - getStoreAdminDealerRequestById : succès, boutique incorrecte, introuvable
 *   - Gestion erreurs Firestore
 *   - Preuve lecture seule (addDoc/updateDoc/deleteDoc/setDoc jamais appelés)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks hoistés
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  setDoc: vi.fn(),
  collection: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
  doc: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
  query: vi.fn((...args) => ({ query: args })),
  where: vi.fn((f, op, v) => ({ where: { f, op, v } })),
  orderBy: vi.fn((f, dir) => ({ orderBy: { f, dir } })),
  limit: vi.fn(n => ({ limit: n })),
  startAfter: vi.fn(d => ({ startAfter: d })),
}))

vi.mock('firebase/firestore', () => ({
  collection: mocks.collection,
  doc: mocks.doc,
  getDoc: mocks.getDoc,
  getDocs: mocks.getDocs,
  addDoc: mocks.addDoc,
  updateDoc: mocks.updateDoc,
  deleteDoc: mocks.deleteDoc,
  setDoc: mocks.setDoc,
  query: mocks.query,
  where: mocks.where,
  orderBy: mocks.orderBy,
  limit: mocks.limit,
  startAfter: mocks.startAfter,
}))

vi.mock('../../src/config/firebase', () => ({
  db: {},
  auth: {},
}))

// ---------------------------------------------------------------------------
// Imports après mocks
// ---------------------------------------------------------------------------

import {
  listStoreAdminDealerRequests,
  getStoreAdminDealerRequestById,
} from '../../src/services/storeAdminDealerService'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STORE_ADMIN_USER = { uid: 'store-admin-uid-001' }
const STORE_ADMIN_PROFILE = {
  role: 'store_admin',
  active: true,
  email: 'admin@boutique.com',
  name: 'Admin Boutique',
  storeId: 'store-alpha',
}

const REQUEST_DATA = {
  dealerUid: 'dealer-uid',
  dealerEmail: 'dealer@test.com',
  dealerName: 'Dealer Test',
  targetStoreId: 'store-alpha',
  targetStoreName: 'Boutique Alpha',
  requestType: 'stock_add',
  network: 'Orange',
  amount: 50000,
  status: 'pending',
  createdAt: null,
  updatedAt: null,
  confirmedBy: null,
  confirmedAt: null,
  rejectedBy: null,
  rejectedAt: null,
  rejectionReason: null,
  previousBalance: null,
  newBalance: null,
}

function makeDocSnap(exists = true, data = REQUEST_DATA) {
  return { exists: () => exists, data: () => data, id: 'req-001' }
}

function makeQuerySnap(docs = []) {
  return {
    docs: docs.map((d, i) => ({
      id: `doc-${i}`,
      data: () => d,
      ...d,
    })),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// §1 — Validation contexte Store Admin
// ---------------------------------------------------------------------------

describe('TC-032-CTX — Validation contexte Store Admin', () => {
  it('[CTX-01] utilisateur null → non connecté', async () => {
    await expect(
      listStoreAdminDealerRequests({ currentUser: null, userProfile: STORE_ADMIN_PROFILE })
    ).rejects.toThrow('non connecté')
  })

  it('[CTX-02] uid vide → UID invalide', async () => {
    await expect(
      listStoreAdminDealerRequests({ currentUser: { uid: '' }, userProfile: STORE_ADMIN_PROFILE })
    ).rejects.toThrow('UID utilisateur invalide')
  })

  it('[CTX-03] uid espace blanc → UID invalide', async () => {
    await expect(
      listStoreAdminDealerRequests({ currentUser: { uid: '   ' }, userProfile: STORE_ADMIN_PROFILE })
    ).rejects.toThrow('UID utilisateur invalide')
  })

  it('[CTX-04] profil null → profil introuvable', async () => {
    await expect(
      listStoreAdminDealerRequests({ currentUser: STORE_ADMIN_USER, userProfile: null })
    ).rejects.toThrow('Profil introuvable')
  })

  it('[CTX-05] profil inactif → compte inactif', async () => {
    const p = { ...STORE_ADMIN_PROFILE, active: false }
    await expect(
      listStoreAdminDealerRequests({ currentUser: STORE_ADMIN_USER, userProfile: p })
    ).rejects.toThrow('inactif')
  })

  it('[CTX-06] rôle dealer → réservé administrateurs boutique', async () => {
    const p = { ...STORE_ADMIN_PROFILE, role: 'dealer' }
    await expect(
      listStoreAdminDealerRequests({ currentUser: STORE_ADMIN_USER, userProfile: p })
    ).rejects.toThrow('administrateurs de boutique')
  })

  it('[CTX-07] rôle system_manager → réservé administrateurs boutique', async () => {
    const p = { ...STORE_ADMIN_PROFILE, role: 'system_manager' }
    await expect(
      listStoreAdminDealerRequests({ currentUser: STORE_ADMIN_USER, userProfile: p })
    ).rejects.toThrow('administrateurs de boutique')
  })

  it('[CTX-08] rôle inconnu → réservé administrateurs boutique', async () => {
    const p = { ...STORE_ADMIN_PROFILE, role: 'unknown_role' }
    await expect(
      listStoreAdminDealerRequests({ currentUser: STORE_ADMIN_USER, userProfile: p })
    ).rejects.toThrow('administrateurs de boutique')
  })

  it('[CTX-09] storeId absent (undefined) → identifiant boutique manquant', async () => {
    const p = { ...STORE_ADMIN_PROFILE, storeId: undefined }
    await expect(
      listStoreAdminDealerRequests({ currentUser: STORE_ADMIN_USER, userProfile: p })
    ).rejects.toThrow('Identifiant de boutique manquant')
  })

  it('[CTX-10] storeId vide → identifiant boutique manquant', async () => {
    const p = { ...STORE_ADMIN_PROFILE, storeId: '   ' }
    await expect(
      listStoreAdminDealerRequests({ currentUser: STORE_ADMIN_USER, userProfile: p })
    ).rejects.toThrow('Identifiant de boutique manquant')
  })

  it('[CTX-11] contexte invalide → Firestore jamais appelé', async () => {
    await expect(
      listStoreAdminDealerRequests({ currentUser: null, userProfile: STORE_ADMIN_PROFILE })
    ).rejects.toThrow()
    expect(mocks.getDocs).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// §2 — Validation filtres
// ---------------------------------------------------------------------------

describe('TC-032-FLT — Validation filtres', () => {
  it('[FLT-01] statusFilter inconnu → erreur statut inconnu', async () => {
    await expect(
      listStoreAdminDealerRequests({
        currentUser: STORE_ADMIN_USER,
        userProfile: STORE_ADMIN_PROFILE,
        statusFilter: 'invalid_status',
      })
    ).rejects.toThrow('Statut inconnu')
  })

  it('[FLT-02] typeFilter inconnu → erreur type inconnu', async () => {
    await expect(
      listStoreAdminDealerRequests({
        currentUser: STORE_ADMIN_USER,
        userProfile: STORE_ADMIN_PROFILE,
        typeFilter: 'invalid_type',
      })
    ).rejects.toThrow('Type de demande inconnu')
  })

  it('[FLT-03] filtres inconnus → Firestore jamais appelé', async () => {
    await expect(
      listStoreAdminDealerRequests({
        currentUser: STORE_ADMIN_USER,
        userProfile: STORE_ADMIN_PROFILE,
        statusFilter: 'invalid',
      })
    ).rejects.toThrow()
    expect(mocks.getDocs).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// §3 — listStoreAdminDealerRequests — requêtes et contrat retour
// ---------------------------------------------------------------------------

describe('TC-032-LIST — listStoreAdminDealerRequests', () => {
  it('[LIST-01] sans filtre → where targetStoreId uniquement, pas de where status/requestType', async () => {
    mocks.getDocs.mockResolvedValue(makeQuerySnap([REQUEST_DATA]))
    await listStoreAdminDealerRequests({
      currentUser: STORE_ADMIN_USER,
      userProfile: STORE_ADMIN_PROFILE,
    })
    const whereFields = mocks.where.mock.calls.map(c => c[0])
    expect(whereFields).toContain('targetStoreId')
    expect(whereFields).not.toContain('status')
    expect(whereFields).not.toContain('requestType')
  })

  it('[LIST-02] avec statusFilter → where status inclus', async () => {
    mocks.getDocs.mockResolvedValue(makeQuerySnap([]))
    await listStoreAdminDealerRequests({
      currentUser: STORE_ADMIN_USER,
      userProfile: STORE_ADMIN_PROFILE,
      statusFilter: 'pending',
    })
    const statusCall = mocks.where.mock.calls.find(c => c[0] === 'status')
    expect(statusCall).toBeDefined()
    expect(statusCall[2]).toBe('pending')
  })

  it('[LIST-03] avec typeFilter → where requestType inclus', async () => {
    mocks.getDocs.mockResolvedValue(makeQuerySnap([]))
    await listStoreAdminDealerRequests({
      currentUser: STORE_ADMIN_USER,
      userProfile: STORE_ADMIN_PROFILE,
      typeFilter: 'stock_add',
    })
    const typeCall = mocks.where.mock.calls.find(c => c[0] === 'requestType')
    expect(typeCall).toBeDefined()
    expect(typeCall[2]).toBe('stock_add')
  })

  it('[LIST-04] statusFilter + typeFilter → deux where supplémentaires', async () => {
    mocks.getDocs.mockResolvedValue(makeQuerySnap([]))
    await listStoreAdminDealerRequests({
      currentUser: STORE_ADMIN_USER,
      userProfile: STORE_ADMIN_PROFILE,
      statusFilter: 'confirmed',
      typeFilter: 'liquidity_add',
    })
    const whereFields = mocks.where.mock.calls.map(c => c[0])
    expect(whereFields).toContain('status')
    expect(whereFields).toContain('requestType')
  })

  it('[LIST-05] targetStoreId pris du profil — pas de la requête', async () => {
    mocks.getDocs.mockResolvedValue(makeQuerySnap([]))
    await listStoreAdminDealerRequests({
      currentUser: STORE_ADMIN_USER,
      userProfile: STORE_ADMIN_PROFILE,
    })
    const storeCall = mocks.where.mock.calls.find(c => c[0] === 'targetStoreId')
    expect(storeCall).toBeDefined()
    expect(storeCall[2]).toBe('store-alpha')
  })

  it('[LIST-06] retourne { requests, lastDoc, hasMore }', async () => {
    mocks.getDocs.mockResolvedValue(makeQuerySnap([REQUEST_DATA]))
    const result = await listStoreAdminDealerRequests({
      currentUser: STORE_ADMIN_USER,
      userProfile: STORE_ADMIN_PROFILE,
    })
    expect(result).toHaveProperty('requests')
    expect(result).toHaveProperty('lastDoc')
    expect(result).toHaveProperty('hasMore')
    expect(result.requests[0].dealerName).toBe('Dealer Test')
    expect(result.requests[0].id).toBeDefined()
  })

  it('[LIST-07] 19 docs → hasMore = false, 19 requests retournés', async () => {
    const docs = Array.from({ length: 19 }, (_, i) => ({ ...REQUEST_DATA, i }))
    mocks.getDocs.mockResolvedValue(makeQuerySnap(docs))
    const result = await listStoreAdminDealerRequests({
      currentUser: STORE_ADMIN_USER,
      userProfile: STORE_ADMIN_PROFILE,
    })
    expect(result.hasMore).toBe(false)
    expect(result.requests).toHaveLength(19)
  })

  it('[LIST-08] 20 docs → hasMore = false', async () => {
    const docs = Array.from({ length: 20 }, (_, i) => ({ ...REQUEST_DATA, i }))
    mocks.getDocs.mockResolvedValue(makeQuerySnap(docs))
    const result = await listStoreAdminDealerRequests({
      currentUser: STORE_ADMIN_USER,
      userProfile: STORE_ADMIN_PROFILE,
    })
    expect(result.hasMore).toBe(false)
    expect(result.requests).toHaveLength(20)
  })

  it('[LIST-09] 21 docs → hasMore = true, seulement 20 requests retournés', async () => {
    const docs = Array.from({ length: 21 }, (_, i) => ({ ...REQUEST_DATA, i }))
    mocks.getDocs.mockResolvedValue(makeQuerySnap(docs))
    const result = await listStoreAdminDealerRequests({
      currentUser: STORE_ADMIN_USER,
      userProfile: STORE_ADMIN_PROFILE,
    })
    expect(result.hasMore).toBe(true)
    expect(result.requests).toHaveLength(20)
  })

  it('[LIST-10] 0 docs → hasMore = false, lastDoc null', async () => {
    mocks.getDocs.mockResolvedValue(makeQuerySnap([]))
    const result = await listStoreAdminDealerRequests({
      currentUser: STORE_ADMIN_USER,
      userProfile: STORE_ADMIN_PROFILE,
    })
    expect(result.hasMore).toBe(false)
    expect(result.requests).toHaveLength(0)
    expect(result.lastDoc).toBeNull()
  })

  it('[LIST-11] avec curseur lastDoc → startAfter appelé', async () => {
    const cursor = { id: 'last-req' }
    mocks.getDocs.mockResolvedValue(makeQuerySnap([]))
    await listStoreAdminDealerRequests({
      currentUser: STORE_ADMIN_USER,
      userProfile: STORE_ADMIN_PROFILE,
      lastDoc: cursor,
    })
    expect(mocks.startAfter).toHaveBeenCalledWith(cursor)
  })

  it('[LIST-12] objets retournés sont plats (pas de méthode data())', async () => {
    mocks.getDocs.mockResolvedValue(makeQuerySnap([REQUEST_DATA]))
    const result = await listStoreAdminDealerRequests({
      currentUser: STORE_ADMIN_USER,
      userProfile: STORE_ADMIN_PROFILE,
    })
    const req = result.requests[0]
    expect(typeof req.data).not.toBe('function')
    expect(req.dealerName).toBe('Dealer Test')
    expect(req.id).toBeDefined()
  })

  it('[LIST-13] permission-denied → message lisible', async () => {
    const err = Object.assign(new Error('permission denied'), { code: 'permission-denied' })
    mocks.getDocs.mockRejectedValue(err)
    await expect(
      listStoreAdminDealerRequests({ currentUser: STORE_ADMIN_USER, userProfile: STORE_ADMIN_PROFILE })
    ).rejects.toThrow('autorisation')
  })

  it('[LIST-14] failed-precondition → message index requis', async () => {
    const err = Object.assign(new Error('index required'), { code: 'failed-precondition' })
    mocks.getDocs.mockRejectedValue(err)
    await expect(
      listStoreAdminDealerRequests({ currentUser: STORE_ADMIN_USER, userProfile: STORE_ADMIN_PROFILE })
    ).rejects.toThrow('index Firestore')
  })
})

// ---------------------------------------------------------------------------
// §4 — getStoreAdminDealerRequestById
// ---------------------------------------------------------------------------

describe('TC-032-GET — getStoreAdminDealerRequestById', () => {
  it('[GET-01] demande ciblant la boutique → succès, objet plat retourné', async () => {
    mocks.getDoc.mockResolvedValue(makeDocSnap(true, { ...REQUEST_DATA, targetStoreId: 'store-alpha' }))
    const result = await getStoreAdminDealerRequestById({
      currentUser: STORE_ADMIN_USER,
      userProfile: STORE_ADMIN_PROFILE,
      requestId: 'req-001',
    })
    expect(result.id).toBeDefined()
    expect(result.dealerName).toBe('Dealer Test')
    expect(typeof result.data).not.toBe('function')
  })

  it('[GET-02] demande ciblant une autre boutique → erreur service (pas la boutique)', async () => {
    mocks.getDoc.mockResolvedValue(makeDocSnap(true, { ...REQUEST_DATA, targetStoreId: 'store-other' }))
    await expect(
      getStoreAdminDealerRequestById({
        currentUser: STORE_ADMIN_USER,
        userProfile: STORE_ADMIN_PROFILE,
        requestId: 'req-other',
      })
    ).rejects.toThrow('ne concerne pas votre boutique')
  })

  it('[GET-03] document inexistant → introuvable', async () => {
    mocks.getDoc.mockResolvedValue(makeDocSnap(false))
    await expect(
      getStoreAdminDealerRequestById({
        currentUser: STORE_ADMIN_USER,
        userProfile: STORE_ADMIN_PROFILE,
        requestId: 'req-missing',
      })
    ).rejects.toThrow('introuvable')
  })

  it('[GET-04] requestId vide → identifiant manquant', async () => {
    await expect(
      getStoreAdminDealerRequestById({
        currentUser: STORE_ADMIN_USER,
        userProfile: STORE_ADMIN_PROFILE,
        requestId: '',
      })
    ).rejects.toThrow('Identifiant de demande manquant')
    expect(mocks.getDoc).not.toHaveBeenCalled()
  })

  it('[GET-05] permission-denied → message lisible', async () => {
    const err = Object.assign(new Error('permission denied'), { code: 'permission-denied' })
    mocks.getDoc.mockRejectedValue(err)
    await expect(
      getStoreAdminDealerRequestById({
        currentUser: STORE_ADMIN_USER,
        userProfile: STORE_ADMIN_PROFILE,
        requestId: 'req-001',
      })
    ).rejects.toThrow('autorisation')
  })

  it('[GET-06] contexte invalide → Firestore jamais appelé', async () => {
    await expect(
      getStoreAdminDealerRequestById({
        currentUser: null,
        userProfile: STORE_ADMIN_PROFILE,
        requestId: 'req-001',
      })
    ).rejects.toThrow()
    expect(mocks.getDoc).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// §5 — Preuve lecture seule
// ---------------------------------------------------------------------------

describe('TC-032-RO — Preuve lecture seule (aucune écriture)', () => {
  it('[RO-01] listStoreAdminDealerRequests n\'appelle jamais addDoc, updateDoc, deleteDoc, setDoc', async () => {
    mocks.getDocs.mockResolvedValue(makeQuerySnap([]))
    await listStoreAdminDealerRequests({
      currentUser: STORE_ADMIN_USER,
      userProfile: STORE_ADMIN_PROFILE,
    })
    expect(mocks.addDoc).not.toHaveBeenCalled()
    expect(mocks.updateDoc).not.toHaveBeenCalled()
    expect(mocks.deleteDoc).not.toHaveBeenCalled()
    expect(mocks.setDoc).not.toHaveBeenCalled()
  })

  it('[RO-02] getStoreAdminDealerRequestById n\'appelle jamais addDoc, updateDoc, deleteDoc, setDoc', async () => {
    mocks.getDoc.mockResolvedValue(makeDocSnap(true, { ...REQUEST_DATA, targetStoreId: 'store-alpha' }))
    await getStoreAdminDealerRequestById({
      currentUser: STORE_ADMIN_USER,
      userProfile: STORE_ADMIN_PROFILE,
      requestId: 'req-001',
    })
    expect(mocks.addDoc).not.toHaveBeenCalled()
    expect(mocks.updateDoc).not.toHaveBeenCalled()
    expect(mocks.deleteDoc).not.toHaveBeenCalled()
    expect(mocks.setDoc).not.toHaveBeenCalled()
  })

  it('[RO-03] même en cas d\'erreur, aucune écriture', async () => {
    const err = Object.assign(new Error('permission denied'), { code: 'permission-denied' })
    mocks.getDocs.mockRejectedValue(err)
    await expect(
      listStoreAdminDealerRequests({ currentUser: STORE_ADMIN_USER, userProfile: STORE_ADMIN_PROFILE })
    ).rejects.toThrow()
    expect(mocks.addDoc).not.toHaveBeenCalled()
    expect(mocks.updateDoc).not.toHaveBeenCalled()
    expect(mocks.deleteDoc).not.toHaveBeenCalled()
    expect(mocks.setDoc).not.toHaveBeenCalled()
  })
})
