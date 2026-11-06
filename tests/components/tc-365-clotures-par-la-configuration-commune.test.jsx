/**
 * TC-365 — les clôtures appellent les functions par la configuration commune
 * (lot C1, docs/rester-dans-le-quota-gratuit.md §C1).
 *
 * L'écran des clôtures créait sa propre instance, `getFunctions(undefined,
 * 'europe-west1')`. Deux défauts :
 * - le changement de région de `src/config/firebase.js` ne l'atteignait pas : une
 *   fois europe-west1 retirée, confirmer ou rejeter une clôture aurait échoué ;
 * - sur les émulateurs, cette instance n'était pas branchée sur l'émulateur.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { COMMUNE, appel, httpsCallable, getFunctions } = vi.hoisted(() => {
  const appel = vi.fn(async () => ({ data: {} }))
  return {
    COMMUNE: { nom: 'instance commune de src/config/firebase.js' },
    appel,
    httpsCallable: vi.fn(() => appel),
    getFunctions: vi.fn(() => ({ nom: 'instance à part' })),
  }
})

vi.mock('firebase/functions', () => ({ httpsCallable, getFunctions }))
vi.mock('../../src/config/firebase', () => ({ functions: COMMUNE }))
vi.mock('../../src/context/AuthContext.jsx', () => ({ useAuth: () => ({ userProfile: { storeId: 'store-a' } }) }))
vi.mock('../../src/services/closureService', () => ({
  listStoreClosures: vi.fn(async () => ({
    closures: [{ id: 'cl-1', status: 'pending', dealerName: 'Dealer', businessDate: '2026-11-06', createdAt: new Date() }],
    hasMore: false,
    lastDoc: null,
  })),
}))

import StoreAdminClosures from '../../src/pages/store/StoreAdminClosures.jsx'

beforeEach(() => {
  appel.mockClear()
  httpsCallable.mockClear()
  getFunctions.mockClear()
})

describe('TC-365 — les clôtures', () => {
  it('[CL-01] confirmer passe par l’instance commune', async () => {
    render(<StoreAdminClosures />)
    fireEvent.click(await screen.findByTestId('confirm-closure-cl-1'))
    await waitFor(() => expect(appel).toHaveBeenCalledWith({ closureId: 'cl-1' }))
    expect(httpsCallable).toHaveBeenCalledWith(COMMUNE, 'confirmDealerClosure')
    expect(getFunctions).not.toHaveBeenCalled()
  })

  it('[CL-02] rejeter aussi', async () => {
    render(<StoreAdminClosures />)
    fireEvent.click(await screen.findByTestId('reject-closure-cl-1'))
    fireEvent.change(screen.getByTestId('reject-reason-input'), { target: { value: 'Écart de stock' } })
    fireEvent.click(screen.getByTestId('reject-confirm-btn'))
    await waitFor(() => expect(appel).toHaveBeenCalledWith({ closureId: 'cl-1', rejectionReason: 'Écart de stock' }))
    expect(httpsCallable).toHaveBeenCalledWith(COMMUNE, 'rejectDealerClosure')
    expect(getFunctions).not.toHaveBeenCalled()
  })
})
