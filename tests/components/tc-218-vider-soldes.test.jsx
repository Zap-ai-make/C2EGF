import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * TC-218 — « Vider les soldes » n'existe plus.
 *
 * Le geste remettait toute la caisse à zéro d'un clic. Retiré le 31 octobre
 * 2026 à la demande du responsable, avec toute sa logique : le formulaire,
 * l'annulation d'une clôture, et les deux commandes serveur (`closeDay`,
 * `cancelClosure` — TC-318). Les clôtures déjà faites restent lisibles dans
 * l'historique, sans action (TC-245).
 *
 * Ce fichier figeait le geste ; il fige désormais son absence.
 */

vi.mock('../../src/hooks/useClients', () => ({ useClients: () => ({ clients: [] }) }))
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'u1' }, userProfile: { role: 'store_admin', storeId: 'store-a' } }),
}))
vi.mock('../../src/context/transactions.jsx', () => ({
  useTransactions: () => ({ pendingTransactions: [], editingTransaction: null, clearEditTransaction: vi.fn() }),
}))
vi.mock('../../src/hooks/useIncomingCollaborationsCount', () => ({ useIncomingCollaborationsCount: () => 0 }))
vi.mock('../../src/components/transactions/TransactionTable', () => ({ default: () => null }))
vi.mock('../../src/components/transactions/DealerTransferForm', () => ({ default: () => null }))
vi.mock('../../src/components/transactions/CollaborationsPanel', () => ({ default: () => null }))
vi.mock('../../src/components/transactions/TransactionForm', () => ({ default: () => null }))
vi.mock('../../src/components/transactions/RavitaillementPanel', () => ({ default: () => null }))

import Transactions from '../../src/pages/Transactions.jsx'

describe('TC-218 — « Vider les soldes » est retiré', () => {
  it('l’écran Transactions n’offre plus de bouton pour vider la caisse', () => {
    render(
      <MemoryRouter initialEntries={['/transactions']}>
        <Transactions />
      </MemoryRouter>,
    )

    // Les gestes qui restent sont là…
    expect(screen.getByTestId('ouvrir-ravitaillement')).toBeInTheDocument()
    // …celui-ci, non.
    expect(screen.queryByTestId('ouvrir-vider-soldes')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /vider les soldes/i })).not.toBeInTheDocument()
  })
})
