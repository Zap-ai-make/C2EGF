import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listAllClients: vi.fn(),
  listStoreOptions: vi.fn(),
  listAllDealerRequests: vi.fn(),
  listAllStores: vi.fn(),
  getStoreNetworkBalances: vi.fn(),
  listAllUsers: vi.fn(),
}))

vi.mock('../../src/services/adminService', () => mocks)

import AdminClients from '../../src/pages/admin/AdminClients'
import AdminDealer from '../../src/pages/admin/AdminDealer'
import AdminStores from '../../src/pages/admin/AdminStores'
import AdminUsers from '../../src/pages/admin/AdminUsers'

const CURSOR = { id: 'page-1' }

const CASES = [
  {
    name: 'agents',
    Component: AdminClients,
    service: mocks.listAllClients,
    key: 'clients',
    first: { id: 'client-1', nom: 'Kaboré', prenom: 'Awa' },
    second: { id: 'client-2', nom: 'Sawadogo', prenom: 'Issa' },
    secondLabel: 'Sawadogo',
  },
  {
    name: 'demandes dealer',
    Component: AdminDealer,
    service: mocks.listAllDealerRequests,
    key: 'requests',
    first: {
      id: 'request-1', targetStoreName: 'Boutique A', dealerName: 'Dealer A',
      requestType: 'stock_add', amount: 1000, status: 'pending', createdAt: null,
    },
    second: {
      id: 'request-2', targetStoreName: 'Boutique B', dealerName: 'Dealer B',
      requestType: 'liquidity_add', amount: 2000, status: 'confirmed', createdAt: null,
    },
    secondLabel: 'Boutique B',
  },
  {
    name: 'boutiques',
    Component: AdminStores,
    service: mocks.listAllStores,
    key: 'stores',
    first: { id: 'store-1', name: 'Boutique A', email: 'a@c2egf.bf', active: true },
    second: { id: 'store-2', name: 'Boutique B', email: 'b@c2egf.bf', active: true },
    secondLabel: 'Boutique B',
  },
  {
    name: 'utilisateurs',
    Component: AdminUsers,
    service: mocks.listAllUsers,
    key: 'users',
    first: { id: 'user-1', name: 'Utilisateur A', role: 'member', active: true },
    second: { id: 'user-2', name: 'Utilisateur B', role: 'dealer', active: true },
    secondLabel: 'Utilisateur B',
  },
]

describe.each(CASES)('pagination administrateur — $name', ({ Component, service, key, first, second, secondLabel }) => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listStoreOptions.mockResolvedValue({ options: [] })
  })

  it('charge la page suivante avec le curseur, signale l’attente et ajoute les résultats', async () => {
    let resolveNextPage
    const nextPage = new Promise(resolve => { resolveNextPage = resolve })
    service
      .mockResolvedValueOnce({ [key]: [first], lastDoc: CURSOR, hasMore: true })
      .mockReturnValueOnce(nextPage)

    render(<Component />)

    const loadMore = await screen.findByRole('button', { name: 'Charger plus' })
    fireEvent.click(loadMore)

    await waitFor(() => expect(service).toHaveBeenCalledTimes(2))
    expect(service.mock.calls[1][0].lastDoc).toBe(CURSOR)
    expect(screen.getByRole('button', { name: 'Chargement…' })).toBeDisabled()

    await act(async () => {
      resolveNextPage({ [key]: [second], lastDoc: null, hasMore: false })
      await nextPage
    })

    expect(await screen.findByText(secondLabel)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Charger plus' })).toBeNull()
  })
})
