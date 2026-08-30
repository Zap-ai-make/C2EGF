/**
 * TC-087 — DealerInventoryBar en mode multi-réseaux (dealer multi-SIM).
 *
 * Force un profil dealer multi-réseaux (mock de dealerConstants) et vérifie :
 *   • une carte Stock par réseau + une carte Liquidité (globale) sont rendues ;
 *   • la modale d'ajustement affiche un sélecteur de réseau ;
 *   • l'ajustement envoie le réseau sélectionné (payload { resource, amount, network }).
 * Le comportement mono-réseau (payload sans network) reste couvert par TC-074.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
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

// Force un dealer multi-réseaux (Orange + Moov), indépendamment du profil actif.
// `estSousSeuil` et `DEALER_SEUIL_BAS` sont arrivés avec la spec S2 : le rail
// signale une cuve basse. Le mock doit les fournir, sinon le composant appelle
// `undefined`. Seuil volontairement haut ici pour que les cuves de ce test
// restent au-dessus et que le rendu testé ne porte pas d'alerte parasite.
vi.mock('../../src/constants/dealerConstants', () => ({
  DEALER_NETWORKS: ['Orange', 'Moov'],
  IS_DEALER_MULTI_NETWORK: true,
  DEALER_SEUIL_BAS: 0,
  estSousSeuil: () => false,
}))

vi.mock('../../src/services/storeTransferService', () => ({
  subscribeDealerBalance: mocks.subscribeDealerBalance,
  replenishDealerInventory: mocks.replenishDealerInventory,
  decreaseDealerInventory: mocks.decreaseDealerInventory,
}))

vi.mock('../../src/context/AuthContext', () => ({ useAuth: () => mocks.useAuth() }))
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

describe('TC-087 — DealerInventoryBar multi-réseaux', () => {
  it('rend une carte Stock par réseau + une carte Liquidité globale', () => {
    render(<DealerInventoryBar />)
    expect(screen.getByText('Orange')).toBeTruthy()
    expect(screen.getByText('Moov')).toBeTruthy()
    expect(screen.getByText('Liquidité')).toBeTruthy()
  })

  it('la modale d\'ajustement affiche un sélecteur de réseau', () => {
    render(<DealerInventoryBar />)
    fireEvent.click(screen.getByTestId('dealer-inventory-adjust'))
    expect(screen.getByTestId('seg-network-Orange')).toBeTruthy()
    expect(screen.getByTestId('seg-network-Moov')).toBeTruthy()
  })

  it('l\'ajustement envoie le réseau sélectionné (Moov) dans le payload', async () => {
    render(<DealerInventoryBar />)
    fireEvent.click(screen.getByTestId('dealer-inventory-adjust'))
    fireEvent.click(screen.getByTestId('seg-network-Moov'))
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '4000' } })
    fireEvent.click(screen.getByTestId('dealer-adjust-submit'))
    await waitFor(() => {
      expect(mocks.replenishDealerInventory).toHaveBeenCalledWith({ resource: 'stock', amount: '4000', network: 'Moov' })
    })
    expect(mocks.decreaseDealerInventory).not.toHaveBeenCalled()
  })
})
