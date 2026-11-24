import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TC-411-05 — l'option de la boutique arrive avec la fiche lue à la connexion :
 * aucune lecture de plus (spec 2026-11-23, « L'option de la boutique »).
 */

const fiches = {}
vi.mock('../../src/config/firebase', () => ({ auth: {}, db: {} }))
vi.mock('../../src/services/firestore', () => ({ firestoreService: { setActiveStore: vi.fn() } }))
vi.mock('firebase/firestore', () => ({
  doc: (_db, ...segments) => segments.join('/'),
  getDoc: async (chemin) => ({ exists: () => chemin in fiches, data: () => fiches[chemin] }),
  setDoc: vi.fn(),
  serverTimestamp: vi.fn(),
  writeBatch: vi.fn(),
}))

const { resolveAuthenticatedProfile } = await import('../../src/context/AuthContext.jsx')

beforeEach(() => {
  for (const cle of Object.keys(fiches)) delete fiches[cle]
  fiches['users/u1'] = { role: 'store_admin', active: true, storeId: 'store-a', storeName: 'A' }
})

describe('TC-411 — l’option arrive avec la fiche', () => {
  it('[TC-411-05] true quand la fiche le porte, false sinon', async () => {
    fiches['stores/store-a'] = { name: 'Boutique A', active: true, transfertsArgent: true }
    expect((await resolveAuthenticatedProfile('u1')).store).toEqual({ id: 'store-a', name: 'Boutique A', active: true, transfertsArgent: true })
    fiches['stores/store-a'] = { name: 'Boutique A', active: true }
    expect((await resolveAuthenticatedProfile('u1')).store.transfertsArgent).toBe(false)
    fiches['stores/store-a'] = { name: 'Boutique A', active: true, transfertsArgent: 'oui' }
    expect((await resolveAuthenticatedProfile('u1')).store.transfertsArgent).toBe(false)
  })
})
