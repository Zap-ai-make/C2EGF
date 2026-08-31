/**
 * TC-089 — Branches MULTI-RÉSEAUX des formulaires dealer (NewDealerRequest, DealerTransferForm).
 *
 * `IS_DEALER_MULTI_NETWORK` est figé à l'import depuis le profil ; sous TAOFIC (mono)
 * seules les branches `false` sont exercées (cf. tc-030/tc-031). Ici on FORCE le mode
 * multi via un mock de dealerConstants et on vérifie que le réseau sélectionné est bien
 * propagé au service (createDealerRequest / createStoreDealerTransfer). La non-régression
 * mono reste couverte par tc-030 (payload 19 clés, network=Orange) et tc-031 (readonly).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({
  listActiveStores: vi.fn(),
  // Depuis S5, `NewDealerRequest` lit tout le réseau et non une page de 20.
  listAllActiveStores: vi.fn(),
  createDealerRequest: vi.fn(),
  parseDealerAmount: vi.fn(v => {
    const s = String(v ?? '').trim()
    if (!/^[0-9]+$/.test(s)) return null
    const n = Number(s)
    return Number.isSafeInteger(n) && n > 0 ? n : null
  }),
  createPartnerDeposit: vi.fn(() => Promise.resolve({ success: true })),
  createStoreDealerTransfer: vi.fn(() => Promise.resolve({ success: true })),
  subscribeStoreTransfers: vi.fn(() => vi.fn()),
  useAuth: vi.fn(),
  useSimpleNetworkData: vi.fn(),
  navigate: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('../../src/config/firebase', () => ({
  auth: {}, db: {}, functions: {},
  firebaseInfo: { projectId: 'test', isDev: true, useEmulators: false },
  default: {},
}))

// Force le mode dealer MULTI-réseaux (Orange + Moov).
vi.mock('../../src/constants/dealerConstants', () => ({
  DEALER_NETWORK: 'Orange',
  DEALER_NETWORKS: ['Orange', 'Moov'],
  IS_DEALER_MULTI_NETWORK: true,
  DEALER_REQUEST_TYPES: { STOCK_ADD: 'stock_add', LIQUIDITY_ADD: 'liquidity_add' },
  DEALER_REQUEST_TYPE_LABELS: { stock_add: 'Ajout de stock', liquidity_add: 'Ajout de liquidité' },
  DEALER_REQUEST_STATUS_LABELS: { pending: 'En attente', confirmed: 'Confirmée', rejected: 'Rejetée' },
  STORE_TRANSFER_TYPES: { RETURN_STOCK: 'return_stock', RETURN_LIQUIDITY: 'return_liquidity' },
  STORE_TRANSFER_TYPE_LABELS: { return_stock: 'Retour de stock', return_liquidity: 'Envoi de liquidité' },
  STORE_TRANSFERS_PAGE_SIZE: 20,
}))

vi.mock('../../src/services/dealerService', () => ({
  listActiveStores: mocks.listActiveStores,
  listAllActiveStores: mocks.listAllActiveStores,
  createDealerRequest: mocks.createDealerRequest,
  parseDealerAmount: mocks.parseDealerAmount,
}))
vi.mock('../../src/services/storeTransferService', () => ({
  createPartnerDeposit: mocks.createPartnerDeposit,
  createStoreDealerTransfer: mocks.createStoreDealerTransfer,
  subscribeStoreTransfers: mocks.subscribeStoreTransfers,
}))
vi.mock('../../src/context/AuthContext', () => ({ useAuth: () => mocks.useAuth() }))
vi.mock('../../src/hooks/useToast', () => ({
  useToast: () => ({ toasts: [], showToast: mocks.showToast, removeToast: vi.fn() }),
}))
vi.mock('../../src/hooks/useSimpleNetworkData', () => ({
  useSimpleNetworkData: () => mocks.useSimpleNetworkData(),
}))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => mocks.navigate }
})

import NewDealerRequest from '../../src/pages/dealer/NewDealerRequest'
import DealerTransferForm from '../../src/components/transactions/DealerTransferForm'

const renderIn = (ui) => render(<MemoryRouter initialEntries={['/dealer/requests/new']}>{ui}</MemoryRouter>)

beforeEach(() => vi.clearAllMocks())

// ── NewDealerRequest ─────────────────────────────────────────────────────────
describe('TC-089-NEW — NewDealerRequest multi-réseaux', () => {
  beforeEach(() => {
    mocks.useAuth.mockReturnValue({ currentUser: { uid: 'dealer-1' }, userProfile: { role: 'dealer', email: 'd@t.test', name: 'D' } })
    mocks.listAllActiveStores.mockResolvedValue({ stores: [{ id: 'store-a', name: 'Boutique Alpha', active: true }] })
    mocks.listActiveStores.mockResolvedValue({ stores: [{ id: 'store-a', name: 'Boutique Alpha', active: true }], lastDoc: null, hasMore: false })
    mocks.createDealerRequest.mockResolvedValue({ id: 'req-x' })
  })

  it('affiche un <select> de réseau (le champ readonly mono est absent)', async () => {
    renderIn(<NewDealerRequest />)
    await waitFor(() => screen.getByTestId('new-dealer-request'))
    expect(screen.getByTestId('select-network')).toBeTruthy()
    expect(screen.queryByTestId('network-display')).toBeNull() // testid de l'input mono
  })

  it('réseau Moov sélectionné → confirmation + createDealerRequest reçoit network:Moov', async () => {
    renderIn(<NewDealerRequest />)
    await waitFor(() => screen.getByTestId('new-dealer-request'))

    fireEvent.change(screen.getByTestId('select-store'), { target: { value: 'store-a' } })
    fireEvent.click(screen.getByTestId('radio-type-stock_add'))
    fireEvent.change(screen.getByTestId('select-network'), { target: { value: 'Moov' } })
    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '5000' } })
    fireEvent.click(screen.getByTestId('btn-review'))

    await waitFor(() => screen.getByTestId('confirm-network'))
    expect(screen.getByTestId('confirm-network').textContent).toBe('Moov')

    fireEvent.click(screen.getByTestId('btn-submit-confirm'))
    await waitFor(() => {
      expect(mocks.createDealerRequest).toHaveBeenCalledWith(
        expect.objectContaining({ network: 'Moov', targetStoreId: 'store-a', requestType: 'stock_add' }),
      )
    })
  })
})

// ── DealerTransferForm ───────────────────────────────────────────────────────
describe('TC-089-XFER — DealerTransferForm multi-réseaux', () => {
  beforeEach(() => {
    mocks.useAuth.mockReturnValue({ userProfile: { storeId: 'store-a', role: 'store_admin' } })
    mocks.useSimpleNetworkData.mockReturnValue({
      networkData: { Orange: { stock: 50000, liquidite: 30000 }, Moov: { stock: 8000, liquidite: 2000 } },
    })
    mocks.createStoreDealerTransfer.mockResolvedValue({ success: true })
  })

  it('affiche un sélecteur de réseau', () => {
    renderIn(<DealerTransferForm />)
    expect(screen.getByTestId('transfer-select-network')).toBeTruthy()
  })

  it('réseau Moov + envoi → createStoreDealerTransfer reçoit network:Moov', async () => {
    renderIn(<DealerTransferForm />)
    fireEvent.change(screen.getByTestId('transfer-select-network'), { target: { value: 'Moov' } })
    fireEvent.change(screen.getByPlaceholderText('Saisir le montant'), { target: { value: '4000' } })
    fireEvent.click(screen.getByText('Envoyer au dealer'))

    await waitFor(() => screen.getByText("Confirmer l'envoi au dealer"))
    fireEvent.click(screen.getByText('Confirmer'))

    await waitFor(() => {
      expect(mocks.createStoreDealerTransfer).toHaveBeenCalledWith(
        expect.objectContaining({ transferType: 'return_stock', amount: 4000, network: 'Moov' }),
      )
    })
  })
})
