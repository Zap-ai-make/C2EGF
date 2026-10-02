import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * TC-219 — Le formulaire de transaction travaille comme une caisse.
 *
 * Deux changements de comportement, pas d'habillage :
 *
 *   1. Le réseau n'est plus choisi à la main. C2EGF n'en opère qu'un ; le
 *      demander à chaque saisie était un clic pour rien, et un clic de travers
 *      possible. Il est résolu depuis le profil et continue d'être envoyé.
 *   2. La modale ne se referme plus après une transaction enregistrée. Le
 *      gérant enchaîne les clients ; rouvrir la fenêtre entre chacun coûtait un
 *      geste par passage. En MODIFICATION, elle se ferme toujours : il n'y a
 *      pas de client suivant à enchaîner.
 */

let stockValue = 500000
let transactionsValue

vi.mock('../../src/context/transactions.jsx', () => ({
  useTransactions: () => transactionsValue,
}))
vi.mock('../../src/hooks/useSimpleNetworkData.js', () => ({
  useSimpleNetworkData: () => ({
    validateAmount: () => ({ isValid: true, message: '' }),
    getStock: () => stockValue,
    getLiquidite: () => 341515014,
    getFormattedStock: () => stockValue.toLocaleString('fr-FR'),
  }),
}))

import TransactionForm from '../../src/components/transactions/TransactionForm.jsx'

const CLIENTS = [
  { id: 'c-1', nom: 'BANABA', prenom: 'Guafarou', orange: '45441020', numeroPersonnel: '76965827' },
]

const onComplete = vi.fn()

const renderForm = (props = {}) =>
  render(<TransactionForm clients={CLIENTS} onComplete={onComplete} {...props} />)

const saisirTransaction = () => {
  fireEvent.change(screen.getByPlaceholderText(/Rechercher un client/i), { target: { value: '45441020' } })
  fireEvent.change(screen.getByPlaceholderText('Saisir le montant'), { target: { value: '5000' } })
  fireEvent.click(screen.getByRole('radio', { name: 'Dépôt' }))
}

const validerEtConfirmer = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Valider' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmer' })).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }))
}

beforeEach(() => {
  stockValue = 500000
  onComplete.mockReset()
  transactionsValue = {
    addTransaction: vi.fn().mockResolvedValue(undefined),
    updateTransaction: vi.fn().mockResolvedValue(undefined),
    editingTransaction: null,
    clearEditTransaction: vi.fn(),
  }
})

describe('TC-219 — le réseau quitte la saisie', () => {
  it('n’affiche plus de sélecteur de réseau', () => {
    renderForm()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByText('Réseau :')).not.toBeInTheDocument()
  })

  it('envoie quand même le réseau du profil avec la transaction', async () => {
    renderForm()
    saisirTransaction()
    await validerEtConfirmer()

    await waitFor(() => expect(transactionsValue.addTransaction).toHaveBeenCalled())
    expect(transactionsValue.addTransaction.mock.calls[0][0]).toMatchObject({ reseau: 'Orange' })
  })
})

describe('TC-219 — la modale reste ouverte entre deux clients', () => {
  it('ne referme pas après une transaction enregistrée, et vide les champs', async () => {
    renderForm()
    saisirTransaction()
    await validerEtConfirmer()

    await waitFor(() => expect(transactionsValue.addTransaction).toHaveBeenCalled())
    expect(onComplete).not.toHaveBeenCalled()

    await waitFor(() => expect(screen.getByPlaceholderText('Saisir le montant')).toHaveValue(null))
    expect(screen.getByRole('radio', { name: 'Dépôt' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'Retrait' })).not.toBeChecked()
  })

  it('se referme en revanche après une MODIFICATION enregistrée', async () => {
    transactionsValue.editingTransaction = {
      id: 'tx-1',
      clientId: 'c-1',
      type: 'Dépôt',
      reseau: 'Orange',
      montant: 5000,
      statut: 'Non Terminées',
    }
    renderForm()
    saisirTransaction()

    fireEvent.click(screen.getByRole('button', { name: 'Sauvegarder' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmer' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }))

    await waitFor(() => expect(transactionsValue.updateTransaction).toHaveBeenCalled())
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
  })
})
