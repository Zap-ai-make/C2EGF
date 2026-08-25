/**
 * TC-088 — storeTransferService : réseau optionnel & DEPLOY-SAFE dans les payloads callable.
 *
 * Chantier dealer multi-réseaux (front). Invariant CRITIQUE de déploiement : en
 * l'absence de `network` (mono-réseau), AUCUNE clé `network` ne doit être transmise
 * au callable — sinon les Cloud Functions non encore mises à jour (allow-list sans
 * `network`) rejetteraient le payload. Quand `network` est fourni (multi), il est inclus.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  callable: vi.fn(() => Promise.resolve({ data: { success: true } })),
  httpsCallable: vi.fn(() => mocks.callable),
}))

vi.mock('firebase/functions', () => ({ httpsCallable: mocks.httpsCallable }))
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), doc: vi.fn(), onSnapshot: vi.fn(),
  query: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(),
}))
vi.mock('../../src/config/firebase', () => ({ functions: {}, db: {} }))

import {
  createStoreDealerTransfer,
  createPartnerDeposit,
  replenishDealerInventory,
  decreaseDealerInventory,
} from '../../src/services/storeTransferService'

beforeEach(() => vi.clearAllMocks())

const PARTNER = { id: 'p1', nom: 'KABORE' }
const lastPayload = () => mocks.callable.mock.calls[0][0]

describe('TC-088 — payloads réseau deploy-safe (callables inventaire/transfert)', () => {
  // ── createStoreDealerTransfer ──────────────────────────────────────────────
  it('createStoreDealerTransfer SANS network → payload { transferType, amount } (aucune clé network)', async () => {
    await createStoreDealerTransfer({ transferType: 'return_stock', amount: '5000' })
    expect(mocks.callable).toHaveBeenCalledWith({ transferType: 'return_stock', amount: 5000 })
    expect('network' in lastPayload()).toBe(false)
  })
  it('createStoreDealerTransfer AVEC network → payload inclut network', async () => {
    await createStoreDealerTransfer({ transferType: 'return_stock', amount: '5000', network: 'Moov' })
    expect(mocks.callable).toHaveBeenCalledWith({ transferType: 'return_stock', amount: 5000, network: 'Moov' })
  })

  // ── replenishDealerInventory ───────────────────────────────────────────────
  it('replenishDealerInventory SANS network → aucune clé network', async () => {
    await replenishDealerInventory({ resource: 'stock', amount: '1000' })
    expect(mocks.callable).toHaveBeenCalledWith({ resource: 'stock', amount: 1000 })
    expect('network' in lastPayload()).toBe(false)
  })
  it('replenishDealerInventory AVEC network → inclut network', async () => {
    await replenishDealerInventory({ resource: 'stock', amount: '1000', network: 'Moov' })
    expect(mocks.callable).toHaveBeenCalledWith({ resource: 'stock', amount: 1000, network: 'Moov' })
  })

  // ── decreaseDealerInventory ────────────────────────────────────────────────
  it('decreaseDealerInventory SANS network → aucune clé network', async () => {
    await decreaseDealerInventory({ resource: 'liquidite', amount: '500' })
    expect(mocks.callable).toHaveBeenCalledWith({ resource: 'liquidite', amount: 500 })
    expect('network' in lastPayload()).toBe(false)
  })
  it('decreaseDealerInventory AVEC network → inclut network', async () => {
    await decreaseDealerInventory({ resource: 'liquidite', amount: '500', network: 'Moov' })
    expect(mocks.callable).toHaveBeenCalledWith({ resource: 'liquidite', amount: 500, network: 'Moov' })
  })

  // ── createPartnerDeposit ───────────────────────────────────────────────────
  it('createPartnerDeposit SANS network → aucune clé network', async () => {
    await createPartnerDeposit({ partner: PARTNER, amount: '2000', operation: 'deposit' })
    const arg = lastPayload()
    expect('network' in arg).toBe(false)
    expect(arg).toMatchObject({ partnerId: 'p1', amount: 2000, operation: 'deposit' })
  })
  it('createPartnerDeposit AVEC network → inclut network', async () => {
    await createPartnerDeposit({ partner: PARTNER, amount: '2000', operation: 'deposit', network: 'Moov' })
    expect(lastPayload().network).toBe('Moov')
  })
})
