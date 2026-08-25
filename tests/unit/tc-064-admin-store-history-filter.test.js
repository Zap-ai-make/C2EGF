/**
 * TC-064 — Historique gérant : filtre par boutique côté serveur.
 *
 * Bug corrigé : la recherche par nom de boutique de l'Historique consolidé
 * filtrait la PAGE COURANTE (25 lignes) côté client → seules les boutiques
 * présentes dans cette tranche apparaissaient.
 *
 * Comportement protégé :
 *   - listStoreHistory interroge directement `clients/{storeId}/history`
 *     (côté serveur) → renvoie TOUT l'historique de la boutique demandée,
 *     indépendamment de sa présence dans la page consolidée récente.
 *   - Les enregistrements sont triés par date décroissante.
 *   - listStoreOptions renvoie une liste de boutiques triée par nom + une map id→nom.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls = { collection: [] }

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, ...segments) => {
    calls.collection.push(segments)
    return { _segments: segments }
  }),
  collectionGroup: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn((ref, ...c) => ({ ref, c })),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn((n) => ({ _limit: n })),
  startAfter: vi.fn((d) => ({ _startAfter: d })),
  getCountFromServer: vi.fn(),
  Timestamp: { fromDate: vi.fn() },
}))

vi.mock('../../src/config/firebase', () => ({ db: {} }))

import { getDocs, startAfter } from 'firebase/firestore'
import { listStoreHistory, listStoreOptions } from '../../src/services/adminService.js'

const PAGE = 25

const snap = (id, data) => ({ id, data: () => data })
const ts = (ms) => ({ toMillis: () => ms })

beforeEach(() => {
  calls.collection = []
  vi.clearAllMocks()
})

describe('TC-064 — listStoreHistory (filtre boutique serveur)', () => {
  it('interroge la sous-collection clients/{storeId}/history', async () => {
    getDocs.mockResolvedValueOnce({ docs: [] })
    await listStoreHistory({ storeId: 'store-Z', storeName: 'Zoo' })
    expect(calls.collection).toContainEqual(['clients', 'store-Z', 'history'])
  })

  it('renvoie tout l’historique de la boutique, trié par date décroissante', async () => {
    getDocs.mockResolvedValueOnce({
      docs: [
        snap('a', { createdAt: ts(100), clientNom: 'Vieux' }),
        snap('b', { createdAt: ts(300), clientNom: 'Recent' }),
        snap('c', { createdAt: ts(200), clientNom: 'Milieu' }),
      ],
    })
    const { records } = await listStoreHistory({ storeId: 'store-Z', storeName: 'Zoo' })
    expect(records.map(r => r.id)).toEqual(['b', 'c', 'a'])
    // chaque enregistrement est rattaché à la boutique demandée
    expect(records.every(r => r.storeId === 'store-Z' && r.storeName === 'Zoo')).toBe(true)
  })

  it('exige un storeId', async () => {
    await expect(listStoreHistory({})).rejects.toThrow(/storeId/i)
  })

  it('pagine : PAGE+1 docs → hasMore=true, PAGE lignes, lastDoc = dernier conservé', async () => {
    // PAGE+1 docs, createdAt décroissant déjà (ms = 1000 - i) pour un ordre stable
    const docs = Array.from({ length: PAGE + 1 }, (_, i) =>
      snap(`d${i}`, { createdAt: ts(1000 - i) }),
    )
    getDocs.mockResolvedValueOnce({ docs })
    const { records, hasMore, lastDoc } = await listStoreHistory({ storeId: 'store-Z' })
    expect(hasMore).toBe(true)
    expect(records).toHaveLength(PAGE)
    // lastDoc doit être le PAGE-ième doc (index PAGE-1), pas le doc de dépassement
    expect(lastDoc).toBe(docs[PAGE - 1])
  })

  it('propage le curseur lastDoc via startAfter', async () => {
    const cursor = snap('cursor', {})
    getDocs.mockResolvedValueOnce({ docs: [] })
    await listStoreHistory({ storeId: 'store-Z', lastDoc: cursor })
    expect(startAfter).toHaveBeenCalledWith(cursor)
  })
})

describe('TC-064 — listStoreOptions', () => {
  it('renvoie une liste triée par nom + une map id→nom', async () => {
    getDocs.mockResolvedValueOnce({
      docs: [
        snap('s2', { name: 'Zoo' }),
        snap('s1', { name: 'Alpha' }),
      ],
    })
    const { map, options } = await listStoreOptions()
    expect(options.map(o => o.name)).toEqual(['Alpha', 'Zoo'])
    expect(map).toEqual({ s2: 'Zoo', s1: 'Alpha' })
  })
})
