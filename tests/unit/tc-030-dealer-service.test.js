/**
 * TC-030 — Tests unitaires dealerService.js (contre-revue V2-5)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks hoistés
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  addDoc: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TS'),
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
  query: mocks.query,
  where: mocks.where,
  orderBy: mocks.orderBy,
  limit: mocks.limit,
  startAfter: mocks.startAfter,
  serverTimestamp: mocks.serverTimestamp,
}))

vi.mock('../../src/config/firebase', () => ({
  db: {},
  auth: {},
}))

// ---------------------------------------------------------------------------
// Imports après mocks
// ---------------------------------------------------------------------------

import {
  createDealerRequest,
  listActiveStores,
  getStoreBalances,
  listDealerRequests,
  parseDealerAmount,
} from '../../src/services/dealerService'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEALER_USER = { uid: 'dealer-uid-001' }
const DEALER_PROFILE = {
  role: 'dealer',
  active: true,
  email: 'dealer@test.com',
  name: 'Dealer Test',
}
const STORE_DATA = { name: 'Boutique Alpha', active: true }

function makeStoreSnap(exists = true, data = STORE_DATA) {
  return { exists: () => exists, data: () => data }
}

function makeDocSnap(exists = true, data = {}) {
  return { exists: () => exists, data: () => data }
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
  mocks.serverTimestamp.mockReturnValue('SERVER_TS')
})

// ---------------------------------------------------------------------------
// §0 — parseDealerAmount (strict)
// ---------------------------------------------------------------------------

describe('TC-030-PA — parseDealerAmount', () => {
  it('[PA-01] entier valide "50000" → 50000', () => {
    expect(parseDealerAmount('50000')).toBe(50000)
  })

  it('[PA-02] entier number 50000 → 50000', () => {
    expect(parseDealerAmount(50000)).toBe(50000)
  })

  it('[PA-03] "1 000" avec espace interne → null (rejeté)', () => {
    expect(parseDealerAmount('1 000')).toBeNull()
  })

  it('[PA-04] "1000.5" décimal → null', () => {
    expect(parseDealerAmount('1000.5')).toBeNull()
  })

  it('[PA-05] "1e3" notation scientifique → null', () => {
    expect(parseDealerAmount('1e3')).toBeNull()
  })

  it('[PA-06] "0" → null (pas strictement positif)', () => {
    expect(parseDealerAmount('0')).toBeNull()
  })

  it('[PA-07] "-1" → null', () => {
    expect(parseDealerAmount('-1')).toBeNull()
  })

  it('[PA-08] "" vide → null', () => {
    expect(parseDealerAmount('')).toBeNull()
  })

  it('[PA-09] Number.MAX_SAFE_INTEGER+1 → null (unsafe integer)', () => {
    expect(parseDealerAmount(Number.MAX_SAFE_INTEGER + 1)).toBeNull()
  })

  it('[PA-10] Number.MAX_SAFE_INTEGER → valide', () => {
    expect(parseDealerAmount(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER)
  })
})

// ---------------------------------------------------------------------------
// §1 — Validation contexte dealer
// ---------------------------------------------------------------------------

describe('TC-030-CTX — Validation contexte dealer', () => {
  it('[CTX-01] utilisateur null → erreur non connecté', async () => {
    await expect(
      createDealerRequest({ currentUser: null, userProfile: DEALER_PROFILE, targetStoreId: 'store-a', requestType: 'stock_add', amount: 1000 })
    ).rejects.toThrow('non connecté')
  })

  it('[CTX-02] uid vide → UID invalide', async () => {
    await expect(
      createDealerRequest({ currentUser: { uid: '' }, userProfile: DEALER_PROFILE, targetStoreId: 'store-a', requestType: 'stock_add', amount: 1000 })
    ).rejects.toThrow('UID utilisateur invalide')
  })

  it('[CTX-03] uid espaces blancs → UID invalide', async () => {
    await expect(
      createDealerRequest({ currentUser: { uid: '   ' }, userProfile: DEALER_PROFILE, targetStoreId: 'store-a', requestType: 'stock_add', amount: 1000 })
    ).rejects.toThrow('UID utilisateur invalide')
  })

  it('[CTX-04] profil null → erreur profil introuvable', async () => {
    await expect(
      createDealerRequest({ currentUser: DEALER_USER, userProfile: null, targetStoreId: 'store-a', requestType: 'stock_add', amount: 1000 })
    ).rejects.toThrow('Profil introuvable')
  })

  it('[CTX-05] rôle store_admin → accès réservé dealers', async () => {
    const p = { ...DEALER_PROFILE, role: 'store_admin' }
    await expect(
      createDealerRequest({ currentUser: DEALER_USER, userProfile: p, targetStoreId: 'store-a', requestType: 'stock_add', amount: 1000 })
    ).rejects.toThrow('réservé aux dealers')
  })

  it('[CTX-06] profil inactif → compte inactif', async () => {
    const p = { ...DEALER_PROFILE, active: false }
    await expect(
      createDealerRequest({ currentUser: DEALER_USER, userProfile: p, targetStoreId: 'store-a', requestType: 'stock_add', amount: 1000 })
    ).rejects.toThrow('inactif')
  })

  it('[CTX-07] email absent → email manquant', async () => {
    const p = { ...DEALER_PROFILE, email: undefined }
    await expect(
      createDealerRequest({ currentUser: DEALER_USER, userProfile: p, targetStoreId: 'store-a', requestType: 'stock_add', amount: 1000 })
    ).rejects.toThrow('Email dealer manquant')
  })

  it('[CTX-08] nom absent → nom manquant', async () => {
    const p = { ...DEALER_PROFILE, name: undefined }
    await expect(
      createDealerRequest({ currentUser: DEALER_USER, userProfile: p, targetStoreId: 'store-a', requestType: 'stock_add', amount: 1000 })
    ).rejects.toThrow('Nom dealer manquant')
  })
})

// ---------------------------------------------------------------------------
// §2 — Validation boutique
// ---------------------------------------------------------------------------

describe('TC-030-STR — Validation boutique cible', () => {
  it('[STR-01] targetStoreId vide → boutique manquante', async () => {
    await expect(
      createDealerRequest({ currentUser: DEALER_USER, userProfile: DEALER_PROFILE, targetStoreId: '', requestType: 'stock_add', amount: 1000 })
    ).rejects.toThrow('Boutique cible manquante')
  })

  it('[STR-02] boutique inexistante → erreur introuvable', async () => {
    mocks.getDoc.mockResolvedValue(makeStoreSnap(false))
    await expect(
      createDealerRequest({ currentUser: DEALER_USER, userProfile: DEALER_PROFILE, targetStoreId: 'store-missing', requestType: 'stock_add', amount: 1000 })
    ).rejects.toThrow('introuvable')
  })

  it('[STR-03] boutique inactive → erreur inactive', async () => {
    mocks.getDoc.mockResolvedValue(makeStoreSnap(true, { name: 'Store', active: false }))
    await expect(
      createDealerRequest({ currentUser: DEALER_USER, userProfile: DEALER_PROFILE, targetStoreId: 'store-inactive', requestType: 'stock_add', amount: 1000 })
    ).rejects.toThrow('inactive')
  })

  it('[STR-04] boutique sans name → erreur nom invalide', async () => {
    mocks.getDoc.mockResolvedValue(makeStoreSnap(true, { active: true }))
    await expect(
      createDealerRequest({ currentUser: DEALER_USER, userProfile: DEALER_PROFILE, targetStoreId: 'store-noname', requestType: 'stock_add', amount: 1000 })
    ).rejects.toThrow('nom valide')
  })
})

// ---------------------------------------------------------------------------
// §3 — Validation type
// ---------------------------------------------------------------------------

describe('TC-030-TYP — Validation type de demande', () => {
  it('[TYP-01] type invalide → erreur type invalide', async () => {
    await expect(
      createDealerRequest({ currentUser: DEALER_USER, userProfile: DEALER_PROFILE, targetStoreId: 'store-a', requestType: 'invalid_type', amount: 1000 })
    ).rejects.toThrow('Type de demande invalide')
  })
})

// ---------------------------------------------------------------------------
// §4 — Validation montant (via createDealerRequest, strict)
// ---------------------------------------------------------------------------

describe('TC-030-AMT — Validation montant (politique stricte)', () => {
  it('[AMT-01] montant 0 → invalide', async () => {
    await expect(
      createDealerRequest({ currentUser: DEALER_USER, userProfile: DEALER_PROFILE, targetStoreId: 'store-a', requestType: 'stock_add', amount: 0 })
    ).rejects.toThrow('Montant invalide')
  })

  it('[AMT-02] montant négatif → invalide', async () => {
    await expect(
      createDealerRequest({ currentUser: DEALER_USER, userProfile: DEALER_PROFILE, targetStoreId: 'store-a', requestType: 'stock_add', amount: -500 })
    ).rejects.toThrow('Montant invalide')
  })

  it('[AMT-03] montant décimal 1000.5 → invalide', async () => {
    await expect(
      createDealerRequest({ currentUser: DEALER_USER, userProfile: DEALER_PROFILE, targetStoreId: 'store-a', requestType: 'stock_add', amount: 1000.5 })
    ).rejects.toThrow('Montant invalide')
  })

  it('[AMT-04] string "1000.5" → invalide', async () => {
    await expect(
      createDealerRequest({ currentUser: DEALER_USER, userProfile: DEALER_PROFILE, targetStoreId: 'store-a', requestType: 'stock_add', amount: '1000.5' })
    ).rejects.toThrow('Montant invalide')
  })

  it('[AMT-05] string "1e3" → invalide', async () => {
    await expect(
      createDealerRequest({ currentUser: DEALER_USER, userProfile: DEALER_PROFILE, targetStoreId: 'store-a', requestType: 'stock_add', amount: '1e3' })
    ).rejects.toThrow('Montant invalide')
  })

  it('[AMT-06] string "abc" → invalide', async () => {
    await expect(
      createDealerRequest({ currentUser: DEALER_USER, userProfile: DEALER_PROFILE, targetStoreId: 'store-a', requestType: 'stock_add', amount: 'abc' })
    ).rejects.toThrow('Montant invalide')
  })

  it('[AMT-07] string vide → invalide', async () => {
    await expect(
      createDealerRequest({ currentUser: DEALER_USER, userProfile: DEALER_PROFILE, targetStoreId: 'store-a', requestType: 'stock_add', amount: '' })
    ).rejects.toThrow('Montant invalide')
  })

  it('[AMT-08] "1 000" avec espace interne → REJETÉ (politique stricte chiffres seulement)', async () => {
    await expect(
      createDealerRequest({ currentUser: DEALER_USER, userProfile: DEALER_PROFILE, targetStoreId: 'store-a', requestType: 'stock_add', amount: '1 000' })
    ).rejects.toThrow('Montant invalide')
  })

  it('[AMT-09] Number.MAX_SAFE_INTEGER + 1 → invalide (unsafe integer)', async () => {
    await expect(
      createDealerRequest({ currentUser: DEALER_USER, userProfile: DEALER_PROFILE, targetStoreId: 'store-a', requestType: 'stock_add', amount: Number.MAX_SAFE_INTEGER + 1 })
    ).rejects.toThrow('Montant invalide')
  })
})

// ---------------------------------------------------------------------------
// §5 — Création réussie
// ---------------------------------------------------------------------------

describe('TC-030-CREATE — Création réussie', () => {
  beforeEach(() => {
    mocks.getDoc.mockResolvedValue(makeStoreSnap(true, { name: 'Boutique Alpha', active: true }))
    mocks.addDoc.mockResolvedValue({ id: 'new-req-id' })
  })

  it('[CREATE-01] payload contient exactement les 18 champs attendus', async () => {
    const result = await createDealerRequest({
      currentUser: DEALER_USER,
      userProfile: DEALER_PROFILE,
      targetStoreId: 'store-alpha',
      requestType: 'stock_add',
      amount: 50000,
    })

    const payload = mocks.addDoc.mock.calls[0][1]

    expect(payload.dealerUid).toBe('dealer-uid-001')
    expect(payload.dealerEmail).toBe('dealer@test.com')
    expect(payload.dealerName).toBe('Dealer Test')
    expect(payload.targetStoreName).toBe('Boutique Alpha')
    expect(payload.network).toBe('Orange')
    expect(payload.status).toBe('pending')
    expect(payload.targetStoreId).toBe('store-alpha')
    expect(payload.requestType).toBe('stock_add')
    expect(payload.amount).toBe(50000)
    expect(payload.createdAt).toBe('SERVER_TS')
    expect(payload.updatedAt).toBe('SERVER_TS')
    expect(payload.confirmedBy).toBeNull()
    expect(payload.confirmedAt).toBeNull()
    expect(payload.rejectedBy).toBeNull()
    expect(payload.rejectedAt).toBeNull()
    expect(payload.rejectionReason).toBeNull()
    expect(payload.previousBalance).toBeNull()
    expect(payload.newBalance).toBeNull()
    expect(payload.liquidityAmount).toBeNull()
    expect(Object.keys(payload).length).toBe(19)
    expect(result.id).toBe('new-req-id')
  })

  it('[CREATE-08] réseau explicite ∈ profil → écrit tel quel dans le payload', async () => {
    await createDealerRequest({
      currentUser: DEALER_USER, userProfile: DEALER_PROFILE,
      targetStoreId: 'store-alpha', requestType: 'stock_add', amount: 5000,
      network: 'Orange', // ∈ DEALER_NETWORKS (profil mono TAOFIC)
    })
    expect(mocks.addDoc.mock.calls[0][1].network).toBe('Orange')
  })

  it('[CREATE-09] réseau hors profil → rejeté (Réseau invalide), aucune écriture', async () => {
    await expect(createDealerRequest({
      currentUser: DEALER_USER, userProfile: DEALER_PROFILE,
      targetStoreId: 'store-alpha', requestType: 'stock_add', amount: 5000,
      network: 'Moov', // ∉ DEALER_NETWORKS en mono
    })).rejects.toThrow('Réseau invalide')
    expect(mocks.addDoc).not.toHaveBeenCalled()
  })

  it('[CREATE-02] serverTimestamp appelé deux fois', async () => {
    await createDealerRequest({
      currentUser: DEALER_USER,
      userProfile: DEALER_PROFILE,
      targetStoreId: 'store-alpha',
      requestType: 'liquidity_add',
      amount: 100000,
    })
    expect(mocks.serverTimestamp).toHaveBeenCalledTimes(2)
  })

  it('[CREATE-03] dealerUid imposé depuis currentUser.uid', async () => {
    await createDealerRequest({
      currentUser: { uid: 'uid-from-context' },
      userProfile: DEALER_PROFILE,
      targetStoreId: 'store-alpha',
      requestType: 'stock_add',
      amount: 5000,
    })
    expect(mocks.addDoc.mock.calls[0][1].dealerUid).toBe('uid-from-context')
  })

  it('[CREATE-04] targetStoreName imposé depuis la boutique réelle', async () => {
    await createDealerRequest({
      currentUser: DEALER_USER,
      userProfile: DEALER_PROFILE,
      targetStoreId: 'store-alpha',
      requestType: 'stock_add',
      amount: 5000,
    })
    expect(mocks.addDoc.mock.calls[0][1].targetStoreName).toBe('Boutique Alpha')
  })
})

// ---------------------------------------------------------------------------
// §6 — Gestion erreurs Firestore
// ---------------------------------------------------------------------------

describe('TC-030-ERR — Gestion erreurs Firestore', () => {
  it('[ERR-01] permission-denied → message utilisateur lisible', async () => {
    const fsError = Object.assign(new Error('Firebase: permission denied'), { code: 'permission-denied' })
    mocks.getDoc.mockRejectedValue(fsError)
    await expect(
      createDealerRequest({ currentUser: DEALER_USER, userProfile: DEALER_PROFILE, targetStoreId: 'store-a', requestType: 'stock_add', amount: 5000 })
    ).rejects.toThrow('Accès refusé')
  })

  it('[ERR-02] unavailable → message utilisateur', async () => {
    const fsError = Object.assign(new Error('unavailable'), { code: 'unavailable' })
    mocks.getDoc.mockRejectedValue(fsError)
    await expect(
      createDealerRequest({ currentUser: DEALER_USER, userProfile: DEALER_PROFILE, targetStoreId: 'store-a', requestType: 'stock_add', amount: 5000 })
    ).rejects.toThrow('indisponible')
  })
})

// ---------------------------------------------------------------------------
// §7 — listActiveStores (paginée)
// ---------------------------------------------------------------------------

describe('TC-030-LST — listActiveStores (paginée, limit N+1)', () => {
  it('[LST-01] retourne { stores, lastDoc, hasMore } — format objet plat', async () => {
    mocks.getDocs.mockResolvedValue(makeQuerySnap([
      { name: 'Boutique A', active: true },
      { name: 'Boutique B', active: true },
    ]))
    const result = await listActiveStores()
    expect(result).toHaveProperty('stores')
    expect(result).toHaveProperty('lastDoc')
    expect(result).toHaveProperty('hasMore')
    expect(result.stores).toHaveLength(2)
    expect(result.stores[0].name).toBe('Boutique A')
    expect(result.stores[0].id).toBeDefined()
  })

  it('[LST-02] 19 docs → hasMore = false, 19 stores retournés', async () => {
    const docs = Array.from({ length: 19 }, (_, i) => ({ name: `Store ${i}`, active: true }))
    mocks.getDocs.mockResolvedValue(makeQuerySnap(docs))
    const result = await listActiveStores()
    expect(result.hasMore).toBe(false)
    expect(result.stores).toHaveLength(19)
  })

  it('[LST-03] 20 docs → hasMore = false, 20 stores retournés', async () => {
    const docs = Array.from({ length: 20 }, (_, i) => ({ name: `Store ${i}`, active: true }))
    mocks.getDocs.mockResolvedValue(makeQuerySnap(docs))
    const result = await listActiveStores()
    expect(result.hasMore).toBe(false)
    expect(result.stores).toHaveLength(20)
  })

  it('[LST-04] 21 docs → hasMore = true, seulement 20 stores retournés', async () => {
    const docs = Array.from({ length: 21 }, (_, i) => ({ name: `Store ${i}`, active: true }))
    mocks.getDocs.mockResolvedValue(makeQuerySnap(docs))
    const result = await listActiveStores()
    expect(result.hasMore).toBe(true)
    expect(result.stores).toHaveLength(20)
  })

  it('[LST-05] 0 docs → hasMore = false, stores vide, lastDoc null', async () => {
    mocks.getDocs.mockResolvedValue(makeQuerySnap([]))
    const result = await listActiveStores()
    expect(result.hasMore).toBe(false)
    expect(result.stores).toHaveLength(0)
    expect(result.lastDoc).toBeNull()
  })

  it('[LST-06] avec cursor lastDoc → startAfter appelé', async () => {
    const cursor = { id: 'last-store' }
    mocks.getDocs.mockResolvedValue(makeQuerySnap([{ name: 'Store Next', active: true }]))
    await listActiveStores({ lastDoc: cursor })
    expect(mocks.startAfter).toHaveBeenCalledWith(cursor)
  })

  it('[LST-07] permission-denied → message mappé', async () => {
    const fsError = Object.assign(new Error('permission denied'), { code: 'permission-denied' })
    mocks.getDocs.mockRejectedValue(fsError)
    await expect(listActiveStores()).rejects.toThrow('Accès refusé')
  })
})

// ---------------------------------------------------------------------------
// §8 — getStoreBalances
// ---------------------------------------------------------------------------

describe('TC-030-BAL — getStoreBalances', () => {
  it('[BAL-01] document existant → retourne data avec balances', async () => {
    mocks.getDoc.mockResolvedValue(makeDocSnap(true, {
      balances: { Orange: { stock: 5000, liquidite: 2000 } },
    }))
    const result = await getStoreBalances('store-a')
    expect(result.balances.Orange.stock).toBe(5000)
    expect(result.balances.Orange.liquidite).toBe(2000)
  })

  it('[BAL-02] document absent → { balances: {} }', async () => {
    mocks.getDoc.mockResolvedValue(makeDocSnap(false))
    const result = await getStoreBalances('store-a')
    expect(result).toEqual({ balances: {} })
  })
})

// ---------------------------------------------------------------------------
// §9 — listDealerRequests (contrat requests, limit N+1)
// ---------------------------------------------------------------------------

describe('TC-030-REQ — listDealerRequests', () => {
  it('[REQ-01] retourne { requests, lastDoc, hasMore } — objets plats', async () => {
    mocks.getDocs.mockResolvedValue(makeQuerySnap([
      { dealerUid: 'dealer-uid-001', status: 'pending', amount: 1000 },
    ]))
    const result = await listDealerRequests({
      currentUser: DEALER_USER,
      userProfile: DEALER_PROFILE,
      statusFilter: null,
    })
    expect(result).toHaveProperty('requests')
    expect(result).toHaveProperty('lastDoc')
    expect(result).toHaveProperty('hasMore')
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0].status).toBe('pending')
    expect(result.requests[0].id).toBeDefined()
  })

  it('[REQ-02] sans filtre statut → where dealerUid uniquement', async () => {
    mocks.getDocs.mockResolvedValue(makeQuerySnap([]))
    await listDealerRequests({ currentUser: DEALER_USER, userProfile: DEALER_PROFILE, statusFilter: null })
    const whereFieldArgs = mocks.where.mock.calls.map(c => c[0])
    expect(whereFieldArgs).not.toContain('status')
  })

  it('[REQ-03] avec filtre statut → where status inclus', async () => {
    mocks.getDocs.mockResolvedValue(makeQuerySnap([]))
    await listDealerRequests({ currentUser: DEALER_USER, userProfile: DEALER_PROFILE, statusFilter: 'pending' })
    const statusWhereCall = mocks.where.mock.calls.find(c => c[0] === 'status')
    expect(statusWhereCall).toBeDefined()
    expect(statusWhereCall[2]).toBe('pending')
  })

  it('[REQ-04] 20 docs retournés → hasMore = false (stratégie N+1)', async () => {
    const docs = Array.from({ length: 20 }, (_, i) => ({ dealerUid: 'uid', status: 'pending', i }))
    mocks.getDocs.mockResolvedValue(makeQuerySnap(docs))
    const result = await listDealerRequests({ currentUser: DEALER_USER, userProfile: DEALER_PROFILE })
    expect(result.hasMore).toBe(false)
    expect(result.requests).toHaveLength(20)
  })

  it('[REQ-05] 21 docs retournés → hasMore = true, seulement 20 requests', async () => {
    const docs = Array.from({ length: 21 }, (_, i) => ({ dealerUid: 'uid', status: 'pending', i }))
    mocks.getDocs.mockResolvedValue(makeQuerySnap(docs))
    const result = await listDealerRequests({ currentUser: DEALER_USER, userProfile: DEALER_PROFILE })
    expect(result.hasMore).toBe(true)
    expect(result.requests).toHaveLength(20)
  })

  it('[REQ-06] 19 docs → hasMore = false', async () => {
    const docs = Array.from({ length: 19 }, (_, i) => ({ dealerUid: 'uid', status: 'pending', i }))
    mocks.getDocs.mockResolvedValue(makeQuerySnap(docs))
    const result = await listDealerRequests({ currentUser: DEALER_USER, userProfile: DEALER_PROFILE })
    expect(result.hasMore).toBe(false)
    expect(result.requests).toHaveLength(19)
  })

  it('[REQ-07] contexte dealer invalide → erreur sans appel Firestore', async () => {
    await expect(
      listDealerRequests({ currentUser: null, userProfile: DEALER_PROFILE })
    ).rejects.toThrow('non connecté')
    expect(mocks.getDocs).not.toHaveBeenCalled()
  })

  it('[REQ-08] uid vide → UID invalide sans appel Firestore', async () => {
    await expect(
      listDealerRequests({ currentUser: { uid: '' }, userProfile: DEALER_PROFILE })
    ).rejects.toThrow('UID utilisateur invalide')
    expect(mocks.getDocs).not.toHaveBeenCalled()
  })
})
