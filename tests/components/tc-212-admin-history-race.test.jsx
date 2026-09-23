import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  listConsolidatedHistory: vi.fn(),
  listStoreHistory: vi.fn(),
  listStoreOptions: vi.fn(),
}))

vi.mock('../../src/services/adminService', () => mocks)

import AdminHistory from '../../src/pages/admin/AdminHistory.jsx'

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

const result = (id, type) => ({
  records: [{ id, type, montant: 1000, storeName: 'Boutique', createdAt: new Date() }],
  lastDoc: null,
  hasMore: false,
})

describe('TC-212 — concurrence AdminHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listStoreOptions.mockResolvedValue({ map: {}, options: [] })
  })

  it('ignore une ancienne réponse arrivée après le filtre courant', async () => {
    const ancienne = deferred()
    const courante = deferred()
    mocks.listConsolidatedHistory
      .mockReturnValueOnce(ancienne.promise)
      .mockReturnValueOnce(courante.promise)

    render(<AdminHistory />)
    await waitFor(() => expect(mocks.listConsolidatedHistory).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'courant' } })
    await waitFor(() => expect(mocks.listConsolidatedHistory).toHaveBeenCalledTimes(2))

    await act(async () => courante.resolve(result('new', 'Réponse courante')))
    expect(await screen.findByText('Réponse courante')).toBeInTheDocument()

    await act(async () => ancienne.resolve(result('old', 'Réponse obsolète')))
    expect(screen.queryByText('Réponse obsolète')).not.toBeInTheDocument()
    expect(screen.getByText('Réponse courante')).toBeInTheDocument()
  })
})
