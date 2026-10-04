import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * TC-216 — Le geste de ravitaillement depuis l'écran Transactions.
 *
 * Deux exigences s'y rencontrent : l'onglet client ne porte plus l'encart qui
 * expliquait le signe des montants, et le gérant dispose d'un geste direct pour
 * enregistrer ce que la centrale vient de livrer.
 */

const runStoreTransactionCommand = vi.fn()
const showToast = vi.fn()

vi.mock('../../src/hooks/useClients', () => ({ useClients: () => ({ clients: [] }) }))
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { uid: 'u1' },
    userProfile: { role: 'store_admin', storeId: 'store-a' },
  }),
}))
vi.mock('../../src/context/transactions.jsx', () => ({
  useTransactions: () => ({
    pendingTransactions: [],
    editingTransaction: null,
    clearEditTransaction: vi.fn(),
  }),
}))
vi.mock('../../src/hooks/useIncomingCollaborationsCount', () => ({
  useIncomingCollaborationsCount: () => 0,
}))
vi.mock('../../src/hooks/useToast', () => ({ useToast: () => ({ showToast }) }))
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

const ouvrirModal = () => {
  fireEvent.click(screen.getByTestId('ouvrir-ravitaillement'))
  return screen.getByRole('dialog', { name: 'Ravitaillement' })
}

const saisirMontant = (valeur) =>
  fireEvent.change(screen.getByLabelText('Montant (FCFA)'), { target: { value: valeur } })

beforeEach(() => {
  runStoreTransactionCommand.mockReset().mockResolvedValue({ id: 'rav-1' })
  showToast.mockReset()
})

describe('TC-216 — ravitaillement depuis l’écran Transactions', () => {
  it('n’affiche plus l’encart qui expliquait le signe des montants', () => {
    afficher()
    expect(screen.queryByText(/le signe dit l'effet/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/stock électronique/i)).not.toBeInTheDocument()
  })

  it('ouvre le formulaire depuis la rangée d’onglets et le referme', () => {
    afficher()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    ouvrirModal()
    expect(screen.getByLabelText('Montant (FCFA)')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Réserve ravitaillée' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('refuse d’envoyer tant que le montant n’est pas un entier positif', () => {
    afficher()
    ouvrirModal()
    const valider = screen.getByTestId('valider-ravitaillement')
    expect(valider).toBeDisabled()

    saisirMontant('0')
    expect(valider).toBeDisabled()
    expect(screen.getByText('Montant invalide (entier supérieur à 0).')).toBeInTheDocument()

    saisirMontant('2500')
    expect(valider).toBeEnabled()
    expect(runStoreTransactionCommand).not.toHaveBeenCalled()
  })

  it('crédite le stock par défaut, avec la note quand elle est saisie', async () => {
    afficher()
    ouvrirModal()
    saisirMontant('2500')
    fireEvent.change(screen.getByLabelText(/^Note/), { target: { value: 'Bordereau 42' } })
    fireEvent.click(screen.getByTestId('valider-ravitaillement'))

    await waitFor(() => expect(runStoreTransactionCommand).toHaveBeenCalledWith({
      action: 'replenish',
      amount: 2500,
      balanceType: 'stock',
      note: 'Bordereau 42',
    }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Ravitaillement enregistré'), 'success')
  })

  it('crédite la liquidité quand elle est choisie, sans note', async () => {
    afficher()
    ouvrirModal()
    saisirMontant('900')
    fireEvent.click(screen.getByRole('radio', { name: /Espèce/ }))
    fireEvent.click(screen.getByTestId('valider-ravitaillement'))

    await waitFor(() => expect(runStoreTransactionCommand).toHaveBeenCalledWith({
      action: 'replenish',
      amount: 900,
      balanceType: 'liquidite',
      note: undefined,
    }))
  })

  it('garde le formulaire ouvert et signale l’échec si la commande rejette', async () => {
    runStoreTransactionCommand.mockRejectedValue(new Error('Solde introuvable.'))
    afficher()
    ouvrirModal()
    saisirMontant('100')
    fireEvent.click(screen.getByTestId('valider-ravitaillement'))

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Solde introuvable.', 'error'))
    expect(screen.getByRole('dialog', { name: 'Ravitaillement' })).toBeInTheDocument()
  })
})
