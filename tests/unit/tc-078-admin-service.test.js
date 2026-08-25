/**
 * TC-078 — Tests de caractérisation adminService.js (audit espaces dealer/gérant)
 *
 * Fige le comportement ACTUEL du service de lecture system_manager avant les
 * lots de centralisation. Style de mock identique à TC-030.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks hoistés
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  getCountFromServer: vi.fn(),
  collection: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
  collectionGroup: vi.fn((_db, name) => ({ group: name })),
  doc: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
  query: vi.fn((...args) => ({ query: args })),
  where: vi.fn((f, op, v) => ({ where: { f, op, v } })),
  orderBy: vi.fn((f, dir) => ({ orderBy: { f, dir } })),
  limit: vi.fn(n => ({ limit: n })),
  startAfter: vi.fn(d => ({ startAfter: d })),
  Timestamp: { fromDate: vi.fn(d => ({ __ts: d.getTime() })) },
}))

vi.mock('firebase/firestore', () => ({
  collection: mocks.collection,
  collectionGroup: mocks.collectionGroup,
  doc: mocks.doc,
  getDoc: mocks.getDoc,
  getDocs: mocks.getDocs,
  getCountFromServer: mocks.getCountFromServer,
  query: mocks.query,
  where: mocks.where,
  orderBy: mocks.orderBy,
  limit: mocks.limit,
  startAfter: mocks.startAfter,
  Timestamp: mocks.Timestamp,
}))

vi.mock('../../src/config/firebase', () => ({
  db: {},
  auth: {},
}))

// ---------------------------------------------------------------------------
// Imports après mocks
// ---------------------------------------------------------------------------

import {
  normalizeDealerMovement,
  listAllStores,
  getStoreById,
  getAdminDashboardCounts,
  getUserCountsByRole,
  listAllDealerRequests,
  listDealerInventoryMovements,
  listConsolidatedHistory,
  listStoreHistory,
  listAllNetworkBalances,
  getStoreNetworkBalances,
  getRequestsForReport,
  listStoreOptions,
} from '../../src/services/adminService'

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

// PAGE = 25 dans adminService : caractérisé ici, ne pas changer sans mettre à jour le service.
const PAGE = 25

function makeQuerySnap(datas = [], { withRefPrefix = null } = {}) {
  return {
    empty: datas.length === 0,
    size: datas.length,
    docs: datas.map((d, i) => ({
      id: d.__id ?? `doc-${i}`,
      data: () => {
        const { __id, __path, ...rest } = d
        return rest
      },
      ref: { path: d.__path ?? (withRefPrefix ? `${withRefPrefix}/doc-${i}` : `x/doc-${i}`) },
    })),
  }
}

function makeDocSnap(exists = true, data = {}) {
  return { exists: () => exists, data: () => data }
}

function makeCountSnap(count) {
  return { data: () => ({ count }) }
}

function ts(millis) {
  return { toMillis: () => millis }
}

function firestoreError(code) {
  const e = new Error(`firestore/${code}`)
  e.code = code
  return e
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// §1 — normalizeDealerMovement (fonction pure)
// ---------------------------------------------------------------------------

describe('TC-078-NM — normalizeDealerMovement', () => {
  it('[NM-01] DEALER_INVENTORY_REPLENISHED → Approvisionnement, sens +, source Dealer', () => {
    const row = normalizeDealerMovement({
      action: 'DEALER_INVENTORY_REPLENISHED', resource: 'stock', amount: 5000, newBalance: 15000, createdAt: 'T',
    })
    expect(row).toEqual({
      action: 'DEALER_INVENTORY_REPLENISHED', createdAt: 'T', type: 'Approvisionnement',
      resourceLabel: 'Stock', sens: '+', amount: 5000, soldeApres: 15000, source: 'Dealer',
    })
  })

  it('[NM-02] DEALER_INVENTORY_DECREASED → Diminution, sens −', () => {
    const row = normalizeDealerMovement({
      action: 'DEALER_INVENTORY_DECREASED', resource: 'liquidite', amount: 2000, newBalance: 1000,
    })
    expect(row.type).toBe('Diminution')
    expect(row.sens).toBe('−')
    expect(row.resourceLabel).toBe('Liquidité')
    expect(row.soldeApres).toBe(1000)
  })

  it('[NM-03] STORE_DEALER_TRANSFER_CONFIRMED return_stock avec newBalance → sens +, source = storeName', () => {
    const row = normalizeDealerMovement({
      action: 'STORE_DEALER_TRANSFER_CONFIRMED', transferType: 'return_stock',
      amount: 3000, newBalance: 9000, storeName: 'Boutique Alpha',
    })
    expect(row.type).toBe('Retour boutique')
    expect(row.resourceLabel).toBe('Stock')
    expect(row.sens).toBe('+')
    expect(row.soldeApres).toBe(9000)
    expect(row.source).toBe('Boutique Alpha')
  })

  it('[NM-04] STORE_DEALER_TRANSFER_CONFIRMED return_liquidity SANS newBalance → neutre (sans impact solde)', () => {
    const row = normalizeDealerMovement({
      action: 'STORE_DEALER_TRANSFER_CONFIRMED', transferType: 'return_liquidity', amount: 4000,
    })
    expect(row.resourceLabel).toBe('Liquidité (sans impact solde)')
    expect(row.sens).toBe('·')
    expect(row.soldeApres).toBeNull()
    expect(row.source).toBe('Boutique')
  })

  it('[NM-05] PARTNER_DEPOSIT withdrawal → Retrait partenaire, Stock + / Liquidité −', () => {
    const row = normalizeDealerMovement({
      action: 'PARTNER_DEPOSIT', operation: 'withdrawal', amount: 7000,
      newStock: 20000, newLiquidite: 3000, partnerNom: 'Partenaire X',
    })
    expect(row.type).toBe('Retrait partenaire')
    expect(row.resourceLabel).toBe('Stock + / Liquidité −')
    expect(row.sens).toBe('±')
    expect(row.newStock).toBe(20000)
    expect(row.newLiquidite).toBe(3000)
    expect(row.source).toBe('Partenaire X')
  })

  it('[NM-06] PARTNER_DEPOSIT (dépôt) → Dépôt partenaire, Stock − / Liquidité +', () => {
    const row = normalizeDealerMovement({ action: 'PARTNER_DEPOSIT', operation: 'deposit', amount: 1000 })
    expect(row.type).toBe('Dépôt partenaire')
    expect(row.resourceLabel).toBe('Stock − / Liquidité +')
    expect(row.source).toBe('Partenaire')
  })

  it('[NM-07] action inconnue → fallback avec type = action et source —', () => {
    const row = normalizeDealerMovement({ action: 'MYSTERY', amount: 1 })
    expect(row.type).toBe('MYSTERY')
    expect(row.sens).toBe('')
    expect(row.source).toBe('—')
  })

  it('[NM-08] log vide → valeurs par défaut sans crash', () => {
    const row = normalizeDealerMovement()
    expect(row.action).toBeNull()
    expect(row.amount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// §2 — listAllStores : pagination PAGE+1 et recherche client-side
// ---------------------------------------------------------------------------

describe('TC-078-ST — listAllStores', () => {
  it('[ST-01] PAGE+1 docs → hasMore=true et page tronquée à PAGE', async () => {
    const datas = Array.from({ length: PAGE + 1 }, (_, i) => ({ name: `Store ${String(i).padStart(2, '0')}` }))
    mocks.getDocs.mockResolvedValue(makeQuerySnap(datas))

    const res = await listAllStores()
    expect(res.hasMore).toBe(true)
    expect(res.stores).toHaveLength(PAGE)
    expect(res.lastDoc).not.toBeNull()
    // limit demandé = PAGE + 1
    expect(mocks.limit).toHaveBeenCalledWith(PAGE + 1)
  })

  it('[ST-02] moins de PAGE docs → hasMore=false', async () => {
    mocks.getDocs.mockResolvedValue(makeQuerySnap([{ name: 'A' }, { name: 'B' }]))
    const res = await listAllStores()
    expect(res.hasMore).toBe(false)
    expect(res.stores).toHaveLength(2)
  })

  it('[ST-03] la recherche filtre APRÈS pagination (comportement actuel : page potentiellement incomplète)', async () => {
    mocks.getDocs.mockResolvedValue(makeQuerySnap([{ name: 'Alpha' }, { name: 'Beta' }, { name: 'Alphonse' }]))
    const res = await listAllStores({ search: 'alp' })
    expect(res.stores.map(s => s.name)).toEqual(['Alpha', 'Alphonse'])
  })

  it('[ST-04] activeFilter=true ajoute where active==true', async () => {
    mocks.getDocs.mockResolvedValue(makeQuerySnap([]))
    await listAllStores({ activeFilter: true })
    expect(mocks.where).toHaveBeenCalledWith('active', '==', true)
  })
})

// ---------------------------------------------------------------------------
// §3 — getStoreById et mapping d'erreurs (mapErr, non exporté — caractérisé ici)
// ---------------------------------------------------------------------------

describe('TC-078-GS — getStoreById & mapErr', () => {
  it('[GS-01] boutique existante → id + données', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true, id: 's1', data: () => ({ name: 'Alpha' }) })
    const res = await getStoreById('s1')
    expect(res).toEqual({ id: 's1', name: 'Alpha' })
  })

  it('[GS-02] boutique absente → "Boutique introuvable."', async () => {
    mocks.getDoc.mockResolvedValue(makeDocSnap(false))
    await expect(getStoreById('sX')).rejects.toThrow('Boutique introuvable.')
  })

  it('[GS-03] permission-denied → message "Accès refusé..."', async () => {
    mocks.getDoc.mockRejectedValue(firestoreError('permission-denied'))
    await expect(getStoreById('s1')).rejects.toThrow('Accès refusé. Vérifiez vos permissions.')
  })

  it('[GS-04] unavailable → "Service indisponible. Réessayez."', async () => {
    mocks.getDocs.mockRejectedValue(firestoreError('unavailable'))
    await expect(listAllStores()).rejects.toThrow('Service indisponible. Réessayez.')
  })

  it('[GS-05] failed-precondition → message dédié', async () => {
    mocks.getDocs.mockRejectedValue(firestoreError('failed-precondition'))
    await expect(listAllStores()).rejects.toThrow('Impossible de charger ces données pour le moment.')
  })

  it('[GS-06] erreur inconnue → message générique', async () => {
    mocks.getDocs.mockRejectedValue(firestoreError('internal'))
    await expect(listAllStores()).rejects.toThrow('Une erreur inattendue s\'est produite.')
  })
})

// ---------------------------------------------------------------------------
// §4 — Compteurs dashboard
// ---------------------------------------------------------------------------

describe('TC-078-CT — getAdminDashboardCounts / getUserCountsByRole', () => {
  it('[CT-01] inactiveStores = total − actives', async () => {
    mocks.getCountFromServer
      .mockResolvedValueOnce(makeCountSnap(10)) // allStores
      .mockResolvedValueOnce(makeCountSnap(7))  // activeStores
      .mockResolvedValueOnce(makeCountSnap(4))  // allUsers
      .mockResolvedValueOnce(makeCountSnap(120)) // allClients
      .mockResolvedValueOnce(makeCountSnap(2))  // pendingRequests

    const res = await getAdminDashboardCounts()
    expect(res).toEqual({
      totalStores: 10, activeStores: 7, inactiveStores: 3,
      totalUsers: 4, totalClients: 120, pendingRequests: 2,
    })
  })

  it('[CT-02] getUserCountsByRole ventile les rôles, inconnus dans other', async () => {
    mocks.getDocs.mockResolvedValue(makeQuerySnap([
      { role: 'store_admin' }, { role: 'store_admin' },
      { role: 'dealer' }, { role: 'system_manager' },
      { role: 'member' }, { role: 'alien' }, {},
    ]))
    const res = await getUserCountsByRole()
    expect(res).toEqual({ store_admin: 2, dealer: 1, system_manager: 1, member: 1, other: 2 })
  })
})

// ---------------------------------------------------------------------------
// §5 — listAllDealerRequests : filtres client-side
// ---------------------------------------------------------------------------

describe('TC-078-DR — listAllDealerRequests', () => {
  it('[DR-01] dealerSearch filtre sur nom OU email', async () => {
    mocks.getDocs.mockResolvedValue(makeQuerySnap([
      { dealerName: 'Moussa', dealerEmail: 'm@x.com', targetStoreName: 'Alpha' },
      { dealerName: 'Awa', dealerEmail: 'awa@x.com', targetStoreName: 'Beta' },
      { dealerName: 'Zed', dealerEmail: 'moussa2@x.com', targetStoreName: 'Alpha' },
    ]))
    const res = await listAllDealerRequests({ dealerSearch: 'moussa' })
    expect(res.requests).toHaveLength(2)
  })

  it('[DR-02] storeSearch filtre sur targetStoreName', async () => {
    mocks.getDocs.mockResolvedValue(makeQuerySnap([
      { targetStoreName: 'Alpha' }, { targetStoreName: 'Beta' },
    ]))
    const res = await listAllDealerRequests({ storeSearch: 'bet' })
    expect(res.requests).toHaveLength(1)
    expect(res.requests[0].targetStoreName).toBe('Beta')
  })

  it('[DR-03] statusFilter ajoute where status==', async () => {
    mocks.getDocs.mockResolvedValue(makeQuerySnap([]))
    await listAllDealerRequests({ statusFilter: 'pending' })
    expect(mocks.where).toHaveBeenCalledWith('status', '==', 'pending')
  })
})

// ---------------------------------------------------------------------------
// §6 — listDealerInventoryMovements
// ---------------------------------------------------------------------------

describe('TC-078-IM — listDealerInventoryMovements', () => {
  it('[IM-01] aucun dealer actif → résultat vide structuré', async () => {
    mocks.getDocs.mockResolvedValue(makeQuerySnap([]))
    const res = await listDealerInventoryMovements()
    expect(res).toEqual({
      dealerUid: null, dealerName: null, balance: { stock: 0, liquidite: 0 },
      byNetwork: { Orange: { stock: 0, liquidite: 0 } }, totalLiquidite: 0,
      movements: [], lastDoc: null, hasMore: false, multipleActiveDealers: false,
    })
  })

  it('[IM-02] deux dealers actifs → multipleActiveDealers=true (anomalie signalée)', async () => {
    mocks.getDocs
      .mockResolvedValueOnce(makeQuerySnap([
        { __id: 'd1', name: 'Dealer 1' }, { __id: 'd2', name: 'Dealer 2' },
      ]))
      .mockResolvedValueOnce(makeQuerySnap([])) // auditLogs
    mocks.getDoc.mockResolvedValue(makeDocSnap(true, { balances: { Orange: { stock: 100, liquidite: 50 } } }))

    const res = await listDealerInventoryMovements()
    expect(res.multipleActiveDealers).toBe(true)
    expect(res.dealerUid).toBe('d1')
    expect(res.balance).toEqual({ stock: 100, liquidite: 50 })
    // Inventaire par réseau (profil mono → Orange) + liquidité globale.
    expect(res.byNetwork).toEqual({ Orange: { stock: 100, liquidite: 50 } })
    expect(res.totalLiquidite).toBe(50)
  })

  it('[IM-03] solde absent → { stock: 0, liquidite: 0 }', async () => {
    mocks.getDocs
      .mockResolvedValueOnce(makeQuerySnap([{ __id: 'd1', name: 'Dealer 1' }]))
      .mockResolvedValueOnce(makeQuerySnap([]))
    mocks.getDoc.mockResolvedValue(makeDocSnap(false))

    const res = await listDealerInventoryMovements()
    expect(res.balance).toEqual({ stock: 0, liquidite: 0 })
    expect(res.multipleActiveDealers).toBe(false)
  })

  it('[IM-04] mouvements normalisés via normalizeDealerMovement', async () => {
    mocks.getDocs
      .mockResolvedValueOnce(makeQuerySnap([{ __id: 'd1', name: 'Dealer 1' }]))
      .mockResolvedValueOnce(makeQuerySnap([
        { action: 'DEALER_INVENTORY_REPLENISHED', resource: 'stock', amount: 500, newBalance: 500 },
      ]))
    mocks.getDoc.mockResolvedValue(makeDocSnap(true, { balances: { Orange: { stock: 500, liquidite: 0 } } }))

    const res = await listDealerInventoryMovements()
    expect(res.movements).toHaveLength(1)
    expect(res.movements[0].type).toBe('Approvisionnement')
  })
})

// ---------------------------------------------------------------------------
// §7 — listConsolidatedHistory : résolution storeName, tri, recherche
// ---------------------------------------------------------------------------

describe('TC-078-CH — listConsolidatedHistory', () => {
  it('[CH-01] extrait storeId du path, résout le nom, trie par createdAt décroissant', async () => {
    mocks.getDocs
      .mockResolvedValueOnce(makeQuerySnap([
        { __id: 'h1', __path: 'clients/store-a/history/h1', createdAt: ts(100), nom: 'Old' },
        { __id: 'h2', __path: 'clients/store-b/history/h2', createdAt: ts(300), nom: 'New' },
        { __id: 'h3', __path: 'clients/store-a/history/h3', createdAt: ts(200), nom: 'Mid' },
      ]))
      .mockResolvedValueOnce(makeQuerySnap([
        { __id: 'store-a', name: 'Boutique A' },
        { __id: 'store-b', name: 'Boutique B' },
      ]))

    const res = await listConsolidatedHistory()
    expect(res.records.map(r => r.nom)).toEqual(['New', 'Mid', 'Old'])
    expect(res.records[0].storeName).toBe('Boutique B')
    expect(res.records[1].storeId).toBe('store-a')
    expect(res.storeNameMap).toEqual({ 'store-a': 'Boutique A', 'store-b': 'Boutique B' })
  })

  it('[CH-02] storeNameMap fourni → pas de second fetch stores', async () => {
    mocks.getDocs.mockResolvedValueOnce(makeQuerySnap([
      { __id: 'h1', __path: 'clients/store-a/history/h1', createdAt: ts(1) },
    ]))
    const res = await listConsolidatedHistory({ storeNameMap: { 'store-a': 'Cache A' } })
    expect(mocks.getDocs).toHaveBeenCalledTimes(1)
    expect(res.records[0].storeName).toBe('Cache A')
  })

  it('[CH-03] recherche filtre sur client, code, boutique', async () => {
    mocks.getDocs.mockResolvedValueOnce(makeQuerySnap([
      { __id: 'h1', __path: 'clients/s/history/h1', createdAt: ts(2), client: { prenom: 'Ali', nom: 'Traoré' } },
      { __id: 'h2', __path: 'clients/s/history/h2', createdAt: ts(1), code: '000123' },
    ]))
    const res = await listConsolidatedHistory({ storeNameMap: {} })
    expect(res.records).toHaveLength(2)

    mocks.getDocs.mockResolvedValueOnce(makeQuerySnap([
      { __id: 'h1', __path: 'clients/s/history/h1', createdAt: ts(2), client: { prenom: 'Ali', nom: 'Traoré' } },
      { __id: 'h2', __path: 'clients/s/history/h2', createdAt: ts(1), code: '000123' },
    ]))
    const filtered = await listConsolidatedHistory({ search: 'ali', storeNameMap: {} })
    expect(filtered.records).toHaveLength(1)
    expect(filtered.records[0].id).toBe('h1')
  })
})

// ---------------------------------------------------------------------------
// §8 — listStoreHistory
// ---------------------------------------------------------------------------

describe('TC-078-SH — listStoreHistory', () => {
  it('[SH-01] storeId requis → rejet explicite', async () => {
    await expect(listStoreHistory({})).rejects.toThrow('storeId requis pour listStoreHistory.')
  })

  it('[SH-02] tri client-side décroissant + storeName par défaut = storeId', async () => {
    mocks.getDocs.mockResolvedValue(makeQuerySnap([
      { __id: 'h1', createdAt: ts(100) },
      { __id: 'h2', createdAt: ts(200) },
    ]))
    const res = await listStoreHistory({ storeId: 'store-a' })
    expect(res.records.map(r => r.id)).toEqual(['h2', 'h1'])
    expect(res.records[0].storeName).toBe('store-a')
  })
})

// ---------------------------------------------------------------------------
// §9 — Soldes réseau (comportements non critiques)
// ---------------------------------------------------------------------------

describe('TC-078-NB — listAllNetworkBalances / getStoreNetworkBalances', () => {
  it('[NB-01] échec de la requête → tableau vide (non critique, pas de throw)', async () => {
    mocks.getDocs.mockRejectedValue(firestoreError('permission-denied'))
    const res = await listAllNetworkBalances()
    expect(res).toEqual([])
  })

  it('[NB-02] extrait storeId du path pour chaque doc', async () => {
    mocks.getDocs.mockResolvedValue(makeQuerySnap([
      { __path: 'clients/store-a/networkBalances/current', balances: { Orange: { stock: 1 } } },
    ]))
    const res = await listAllNetworkBalances()
    expect(res[0].storeId).toBe('store-a')
  })

  it('[NB-03] getStoreNetworkBalances : doc absent → null, erreur → null', async () => {
    mocks.getDoc.mockResolvedValue(makeDocSnap(false))
    expect(await getStoreNetworkBalances('s1')).toBeNull()

    mocks.getDoc.mockRejectedValue(firestoreError('unavailable'))
    expect(await getStoreNetworkBalances('s1')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// §10 — getRequestsForReport : bornes de dates
// ---------------------------------------------------------------------------

describe('TC-078-RP — getRequestsForReport', () => {
  it('[RP-01] dateTo étendue à 23:59:59.999 (fin de journée incluse)', async () => {
    mocks.getDocs.mockResolvedValue(makeQuerySnap([]))
    await getRequestsForReport({ dateFrom: '2026-01-01', dateTo: '2026-01-31' })

    const calls = mocks.Timestamp.fromDate.mock.calls
    expect(calls).toHaveLength(2)
    const end = calls[1][0]
    expect(end.getHours()).toBe(23)
    expect(end.getMinutes()).toBe(59)
    expect(end.getSeconds()).toBe(59)
    // Limite de rapport actuelle : 500 documents.
    expect(mocks.limit).toHaveBeenCalledWith(500)
  })
})

// ---------------------------------------------------------------------------
// §11 — listStoreOptions : tri français
// ---------------------------------------------------------------------------

describe('TC-078-SO — listStoreOptions', () => {
  it('[SO-01] retourne map id→nom et options triées par nom (fr)', async () => {
    mocks.getDocs.mockResolvedValue(makeQuerySnap([
      { __id: 's2', name: 'Zébra' },
      { __id: 's1', name: 'Étoile' },
      { __id: 's3' }, // sans nom → id
    ]))
    const res = await listStoreOptions()
    expect(res.map).toEqual({ s2: 'Zébra', s1: 'Étoile', s3: 's3' })
    expect(res.options.map(o => o.name)).toEqual(['Étoile', 's3', 'Zébra'])
  })
})
