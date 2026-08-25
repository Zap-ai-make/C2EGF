/**
 * TC-074 — Modale d'ajustement d'inventaire dealer (bandeau DealerInventoryBar).
 *
 * Caractérise le câblage du flux financier après la refonte UI (bouton unique
 * « Ajuster » + sélecteurs segmentés) : la bonne fonction service est appelée
 * selon la ressource et l'opération choisies.
 *   - Stock + Ajouter   → replenishDealerInventory({ resource:'stock', amount })
 *   - Liquidité + Retirer → decreaseDealerInventory({ resource:'liquidite', amount })
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  subscribeDealerBalance: vi.fn(() => vi.fn()),
  replenishDealerInventory: vi.fn(() => Promise.resolve({ success: true })),
  decreaseDealerInventory: vi.fn(() => Promise.resolve({ success: true })),
  showToast: vi.fn(),
  useAuth: vi.fn(),
}))

vi.mock('../../src/config/firebase', () => ({
  auth: {}, db: {}, functions: {},
  firebaseInfo: { projectId: 'test', isDev: true, useEmulators: false },
  default: {},
}))

vi.mock('../../src/services/storeTransferService', () => ({
  subscribeDealerBalance: mocks.subscribeDealerBalance,
  replenishDealerInventory: mocks.replenishDealerInventory,
  decreaseDealerInventory: mocks.decreaseDealerInventory,
}))

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => mocks.useAuth(),
}))

vi.mock('../../src/hooks/useToast', () => ({
  useToast: () => ({ toasts: [], showToast: mocks.showToast, removeToast: vi.fn() }),
}))

import DealerInventoryBar from '../../src/components/dealer/DealerInventoryBar'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.useAuth.mockReturnValue({
    currentUser: { uid: 'dealer-1' },
    userProfile: { role: 'dealer', name: 'Dealer Test' },
  })
})

function openModal() {
  fireEvent.click(screen.getByTestId('dealer-inventory-adjust'))
}
function typeAmount(v) {
  fireEvent.change(screen.getByLabelText('Montant'), { target: { value: v } })
}

describe('TC-074 — DealerInventoryBar : modale d\'ajustement', () => {
  it('affiche le bouton Ajuster (pas de mur de 4 boutons)', () => {
    render(<DealerInventoryBar />)
    expect(screen.getByTestId('dealer-inventory-adjust')).toBeTruthy()
    // Les anciens boutons +/- ne doivent plus exister
    expect(screen.queryByText('+ Stock')).toBeNull()
    expect(screen.queryByText('− Liquidité')).toBeNull()
  })

  it('Stock + Ajouter (défauts) → replenishDealerInventory', async () => {
    render(<DealerInventoryBar />)
    openModal()
    typeAmount('5000')
    fireEvent.click(screen.getByTestId('dealer-adjust-submit'))
    await waitFor(() => {
      expect(mocks.replenishDealerInventory).toHaveBeenCalledWith({ resource: 'stock', amount: '5000' })
    })
    expect(mocks.decreaseDealerInventory).not.toHaveBeenCalled()
  })

  it('Liquidité + Retirer → decreaseDealerInventory', async () => {
    render(<DealerInventoryBar />)
    openModal()
    fireEvent.click(screen.getByTestId('seg-resource-liquidite'))
    fireEvent.click(screen.getByTestId('seg-operation-decrease'))
    typeAmount('3000')
    fireEvent.click(screen.getByTestId('dealer-adjust-submit'))
    await waitFor(() => {
      expect(mocks.decreaseDealerInventory).toHaveBeenCalledWith({ resource: 'liquidite', amount: '3000' })
    })
    expect(mocks.replenishDealerInventory).not.toHaveBeenCalled()
  })

  it('bouton Valider désactivé tant que le montant est invalide', () => {
    render(<DealerInventoryBar />)
    openModal()
    expect(screen.getByTestId('dealer-adjust-submit').disabled).toBe(true)
    typeAmount('100')
    expect(screen.getByTestId('dealer-adjust-submit').disabled).toBe(false)
  })

  it('non-dealer → bandeau masqué', () => {
    mocks.useAuth.mockReturnValue({ currentUser: { uid: 'x' }, userProfile: { role: 'store_admin' } })
    const { container } = render(<DealerInventoryBar />)
    expect(container.querySelector('[data-testid="dealer-inventory-adjust"]')).toBeNull()
  })
})
