/**
 * TC-078 — Tests de caractérisation adminService.js (audit espaces dealer/gérant)
 *
 * Fige le comportement ACTUEL du service de lecture system_manager avant les
 * lots de centralisation. Style de mock identique à TC-030.
 *
 * ⚠ Lot 3 (shell patron) a supprimé huit écrans de supervision et, avec eux,
 *   les fonctions d'adminService.js qui n'avaient pas d'autre appelant :
 *   listAllStores (§ST), getAdminDashboardCounts/getUserCountsByRole (§CT),
 *   listAllDealerRequests (§DR), listDealerInventoryMovements (§IM),
 *   listConsolidatedHistory/listStoreHistory (§CH/§SH), getStoreNetworkBalances
 *   (§NB), getRequestsForReport (§RP). Leurs sections meurent avec elles.
 *   §GS testait aussi le comportement partagé de `mapErr` (unavailable /
 *   failed-precondition / erreur générique) à travers `listAllStores` — ce
 *   comportement est partagé par TOUTES les fonctions du service, donc il est
 *   conservé, rebranché sur `listAllClients` qui reste. `getStoreById` et
 *   `listAllNetworkBalances` n'avaient déjà aucun appelant avant ce lot : leur
 *   sort n'est pas celui de cette suppression, ils restent inchangés.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks hoistés
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  collection: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
  collectionGroup: vi.fn((_db, name) => ({ group: name })),
  doc: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
  query: vi.fn((...args) => ({ query: args })),
  where: vi.fn((f, op, v) => ({ where: { f, op, v } })),
  orderBy: vi.fn((f, dir) => ({ orderBy: { f, dir } })),
  limit: vi.fn(n => ({ limit: n })),
  startAfter: vi.fn(d => ({ startAfter: d })),
}))

vi.mock('firebase/firestore', () => ({
  collection: mocks.collection,
  collectionGroup: mocks.collectionGroup,
  doc: mocks.doc,
  getDoc: mocks.getDoc,
  getDocs: mocks.getDocs,
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
  normalizeDealerMovement,
  getStoreById,
  listAllClients,
  listAllNetworkBalances,
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
// §2 — getStoreById & mapErr (comportement partagé par tout le service)
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

  // GS-04/05/06 caractérisent `mapErr`, partagé par toutes les fonctions du
  // service — pas spécifique à une fonction en particulier. Rebranché sur
  // `listAllClients` depuis la suppression de `listAllStores` (lot 3).
  it('[GS-04] unavailable → "Service indisponible. Réessayez."', async () => {
    mocks.getDocs.mockRejectedValue(firestoreError('unavailable'))
    await expect(listAllClients()).rejects.toThrow('Service indisponible. Réessayez.')
  })

  it('[GS-05] failed-precondition → message dédié', async () => {
    mocks.getDocs.mockRejectedValue(firestoreError('failed-precondition'))
    await expect(listAllClients()).rejects.toThrow('Impossible de charger ces données pour le moment.')
  })

  it('[GS-06] erreur inconnue → message générique', async () => {
    mocks.getDocs.mockRejectedValue(firestoreError('internal'))
    await expect(listAllClients()).rejects.toThrow('Une erreur inattendue s\'est produite.')
  })
})

// ---------------------------------------------------------------------------
// §3 — listAllClients : pagination PAGE+1 et recherche client-side
// ---------------------------------------------------------------------------

describe('TC-078-CL — listAllClients', () => {
  it('[CL-01] PAGE+1 docs → hasMore=true et page tronquée à PAGE', async () => {
    const datas = Array.from({ length: PAGE + 1 }, (_, i) => ({ nom: `Client ${String(i).padStart(2, '0')}` }))
    mocks.getDocs.mockResolvedValue(makeQuerySnap(datas))

    const res = await listAllClients()
    expect(res.hasMore).toBe(true)
    expect(res.clients).toHaveLength(PAGE)
    expect(res.lastDoc).not.toBeNull()
    expect(mocks.limit).toHaveBeenCalledWith(PAGE + 1)
  })

  it('[CL-02] moins de PAGE docs → hasMore=false', async () => {
    mocks.getDocs.mockResolvedValue(makeQuerySnap([{ nom: 'A' }, { nom: 'B' }]))
    const res = await listAllClients()
    expect(res.hasMore).toBe(false)
    expect(res.clients).toHaveLength(2)
  })

  it('[CL-03] storeId filtre sans orderBy (pas d’index composite requis)', async () => {
    mocks.getDocs.mockResolvedValue(makeQuerySnap([]))
    await listAllClients({ storeId: 'store-a' })
    expect(mocks.where).toHaveBeenCalledWith('registeredStoreId', '==', 'store-a')
  })

  it('[CL-04] recherche filtre sur nom, prénom, numéro personnel, agent, boutique', async () => {
    mocks.getDocs.mockResolvedValue(makeQuerySnap([
      { nom: 'Kaboré', prenom: 'Awa' }, { nom: 'Sawadogo', prenom: 'Issa' },
    ]))
    const res = await listAllClients({ search: 'kabo' })
    expect(res.clients.map(c => c.nom)).toEqual(['Kaboré'])
  })
})

// ---------------------------------------------------------------------------
// §4 — Soldes réseau (comportement non critique, pas d'appelant mais déjà
// caractérisé avant ce lot — hors périmètre de la suppression)
// ---------------------------------------------------------------------------

describe('TC-078-NB — listAllNetworkBalances', () => {
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
})

// ---------------------------------------------------------------------------
// §5 — listStoreOptions : tri français
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
