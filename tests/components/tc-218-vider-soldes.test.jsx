import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * TC-218 — Vider les soldes depuis l'écran Transactions.
 *
 * Le geste efface la position de fonds de roulement : la confirmation doit
 * montrer ce qu'elle solde, et rien ne doit partir avant elle.
 */

const runStoreTransactionCommand = vi.fn()
const showToast = vi.fn()
let soldes = { Orange: { stock: 600_066, liquidite: 401_934 } }

vi.mock('../../src/hooks/useClients', () => ({ useClients: () => ({ clients: [] }) }))
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'u1' }, userProfile: { role: 'store_admin', storeId: 'store-a' } }),
}))
vi.mock('../../src/context/transactions.jsx', () => ({
  useTransactions: () => ({ pendingTransactions: [], editingTransaction: null, clearEditTransaction: vi.fn() }),
}))
vi.mock('../../src/hooks/useIncomingCollaborationsCount', () => ({ useIncomingCollaborationsCount: () => 0 }))
vi.mock('../../src/hooks/useToast', () => ({ useToast: () => ({ showToast }) }))
vi.mock('../../src/hooks/useSimpleNetworkData', () => ({
  useSimpleNetworkData: () => ({ networkData: soldes }),
}))
vi.mock('../../src/services/storeTransactionCommandService', () => ({
  runStoreTransactionCommand: (...args) => runStoreTransactionCommand(...args),
}))
vi.mock('../../src/components/transactions/TransactionTable', () => ({ default: () => null }))
vi.mock('../../src/components/transactions/DealerTransferForm', () => ({ default: () => null }))
vi.mock('../../src/components/transactions/CollaborationsPanel', () => ({ default: () => null }))
vi.mock('../../src/components/transactions/TransactionForm', () => ({ default: () => null }))

import Transactions from '../../src/pages/Transactions.jsx'

const afficher = () =>
  render(
    <MemoryRouter initialEntries={['/transactions']}>
      <Transactions />
    </MemoryRouter>,
  )

beforeEach(() => {
  soldes = { Orange: { stock: 600_066, liquidite: 401_934 } }
  runStoreTransactionCommand.mockReset().mockResolvedValue({ id: 'clo-1' })
  showToast.mockReset()
})

describe('TC-218 — vider les soldes', () => {
  it('n’envoie rien tant que la confirmation n’est pas validée', () => {
    afficher()
    fireEvent.click(screen.getByTestId('ouvrir-vider-soldes'))

    expect(screen.getByRole('dialog', { name: 'Vider les soldes' })).toBeInTheDocument()
    expect(runStoreTransactionCommand).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(runStoreTransactionCommand).not.toHaveBeenCalled()
  })

  it('montre les montants sur le point d’être soldés, et leur total', () => {
    afficher()
    fireEvent.click(screen.getByTestId('ouvrir-vider-soldes'))

    const tableau = within(screen.getByTestId('soldes-a-vider'))
    expect(tableau.getByText('Orange · stock')).toBeInTheDocument()
    expect(tableau.getByText('Liquidité · espèces')).toBeInTheDocument()
    expect(screen.getByTestId('total-a-vider')).toHaveTextContent('1 002 000')
  })

  it('vide les soldes à la confirmation et referme', async () => {
    afficher()
    fireEvent.click(screen.getByTestId('ouvrir-vider-soldes'))
    fireEvent.click(screen.getByTestId('confirmer-vider-soldes'))

    await waitFor(() => expect(runStoreTransactionCommand).toHaveBeenCalledWith({ action: 'closeDay' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Soldes vidés'), 'success')
  })

  it('refuse le geste quand tout est déjà à zéro', () => {
    soldes = { Orange: { stock: 0, liquidite: 0 } }
    afficher()
    fireEvent.click(screen.getByTestId('ouvrir-vider-soldes'))

    expect(screen.getByTestId('confirmer-vider-soldes')).toBeDisabled()
    expect(screen.getByText(/déjà à zéro/i)).toBeInTheDocument()
  })

  it('garde la fenêtre ouverte et signale l’échec si la commande rejette', async () => {
    runStoreTransactionCommand.mockRejectedValue(new Error('Les soldes sont déjà à zéro.'))
    afficher()
    fireEvent.click(screen.getByTestId('ouvrir-vider-soldes'))
    fireEvent.click(screen.getByTestId('confirmer-vider-soldes'))

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Les soldes sont déjà à zéro.', 'error'))
    expect(screen.getByRole('dialog', { name: 'Vider les soldes' })).toBeInTheDocument()
  })
})
