/**
 * TC-064 — Historique gérant : filtre par boutique côté serveur.
 *
 * ⚠ Lot 3 (shell patron) a supprimé AdminHistory.jsx, seul appelant de
 *   `listStoreHistory` — la fonction est retirée d'adminService.js avec lui,
 *   et sa section de caractérisation ci-dessous meurt avec elle (voir le
 *   rapport de tâche 3). `listStoreOptions` reste : `AdminClients.jsx`
 *   (hors périmètre de suppression de ce lot) l'appelle encore.
 *
 * Comportement protégé :
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
}))

vi.mock('../../src/config/firebase', () => ({ db: {} }))

import { getDocs } from 'firebase/firestore'
import { listStoreOptions } from '../../src/services/adminService.js'

const snap = (id, data) => ({ id, data: () => data })

beforeEach(() => {
  calls.collection = []
  vi.clearAllMocks()
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
