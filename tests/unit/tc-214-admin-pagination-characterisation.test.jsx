import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listAllClients: vi.fn(),
  listStoreOptions: vi.fn(),
}))

vi.mock('../../src/services/adminService', () => mocks)

// AdminDealer, AdminStores et AdminUsers ont disparu avec le shell à neuf
// écrans (lot 3) ; leurs cas de pagination meurent avec eux. AdminClients.jsx
// n'est pas dans la liste de suppression du lot 3 (la racine /admin est reprise
// par PatronClients, coquille remplie en tâche 4) : le fichier existe encore,
// pas encore routé, et son banc de caractérisation de pagination reste valide.
import AdminClients from '../../src/pages/admin/AdminClients'

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
