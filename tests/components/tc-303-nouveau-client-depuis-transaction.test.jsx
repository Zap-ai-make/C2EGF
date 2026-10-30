import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

/**
 * TC-303 — Enregistrer un client sans quitter le formulaire de transaction.
 *
 * Demande du responsable (30 octobre 2026) : quand le code ou le numéro tapé
 * ne correspond à aucune fiche, un bouton « + » ouvre le formulaire client
 * AU-DESSUS de la transaction. Une fois la fiche créée, la transaction la
 * reprend telle quelle : rien n'est à retaper, et la fenêtre de saisie reste
 * ouverte avec ce qui y était déjà.
 */

let transactionsValue

vi.mock('../../src/hooks/useNetworkCards.js', () => ({
  useNetworkCards: () => ({
    cardsData: {},
    getStock: () => 500000,
    getLiquidite: () => 500000,
    getNetworkLiquidite: () => 500000,
    formatAmount: (n) => Number(n).toLocaleString('fr-FR'),
  }),
}))
vi.mock('../../src/context/transactions.jsx', () => ({
  useTransactions: () => transactionsValue,
}))

import TransactionForm from '../../src/components/transactions/TransactionForm.jsx'

const EXISTANT = { id: 'c-1', nom: 'BANABA', prenom: 'Guafarou', orange: '45441020' }

beforeEach(() => {
  transactionsValue = {
    addTransaction: vi.fn().mockResolvedValue(undefined),
    updateTransaction: vi.fn(),
    saveReopenedCorrection: vi.fn(),
    editingTransaction: null,
    clearEditTransaction: vi.fn(),
  }
})

const ouvrirNouveauClient = async (code) => {
  fireEvent.change(screen.getByPlaceholderText(/code agent/i), { target: { value: code } })
  fireEvent.click(await screen.findByRole('button', { name: /Enregistrer ce client/ }))
  return screen.getByRole('dialog', { name: 'Enregistrer un client' })
}

describe('TC-303 — le client inconnu s’enregistre depuis la transaction', () => {
  it('[NC-01] le numéro tapé ouvre la fiche à créer, déjà rempli', async () => {
    render(<TransactionForm clients={[EXISTANT]} onAddClient={vi.fn()} />)

    const fiche = await ouvrirNouveauClient('87654321')

    expect(within(fiche).getByLabelText(/Numéro agent/)).toHaveValue('87654321')
    expect(within(fiche).getByLabelText(/Code agent/)).toHaveValue('')
  })

  it('[NC-02] un code à sept chiffres va dans « Code agent »', async () => {
    render(<TransactionForm clients={[EXISTANT]} onAddClient={vi.fn()} />)

    const fiche = await ouvrirNouveauClient('7654321')

    expect(within(fiche).getByLabelText(/Code agent/)).toHaveValue('7654321')
  })

  it('[NC-03] la fiche créée devient le client de la transaction, qui part avec elle', async () => {
    // La fiche telle que la rend le vrai firestoreService.addClient : il pose
    // `orange` (codeAgent ou numeroAgent), le compte que lit la transaction.
    const onAddClient = vi.fn(async (donnees) => ({ id: 'c-neuf', ...donnees, orange: donnees.codeAgent || donnees.numeroAgent }))
    render(<TransactionForm clients={[EXISTANT]} onAddClient={onAddClient} />)

    const fiche = await ouvrirNouveauClient('87654321')
    fireEvent.change(within(fiche).getByRole('textbox', { name: 'Nom' }), { target: { value: 'OUEDRAOGO' } })
    fireEvent.change(within(fiche).getByRole('textbox', { name: 'Prénom' }), { target: { value: 'Salif' } })
    fireEvent.click(within(fiche).getByRole('button', { name: 'Enregistrer' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Enregistrer un client' })).not.toBeInTheDocument())
    expect(onAddClient).toHaveBeenCalledWith(expect.objectContaining({ nom: 'OUEDRAOGO', prenom: 'Salif', numeroAgent: '87654321' }))

    fireEvent.change(screen.getByPlaceholderText('Saisir le montant'), { target: { value: '5000' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Dépôt' }))
    fireEvent.click(screen.getByRole('button', { name: 'Non Terminées' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmer' }))

    await waitFor(() => expect(transactionsValue.addTransaction).toHaveBeenCalled())
    expect(transactionsValue.addTransaction.mock.calls[0][0]).toMatchObject({
      clientId: 'c-neuf',
      type: 'Dépôt',
      montant: 5000,
      statut: 'Non Terminées',
    })
  })

  it('[NC-04] un enregistrement refusé laisse la fiche ouverte et ne choisit personne', async () => {
    const onAddClient = vi.fn().mockRejectedValue(new Error('Ce code agent est déjà pris.'))
    render(<TransactionForm clients={[EXISTANT]} onAddClient={onAddClient} />)

    const fiche = await ouvrirNouveauClient('87654321')
    fireEvent.change(within(fiche).getByRole('textbox', { name: 'Nom' }), { target: { value: 'OUEDRAOGO' } })
    fireEvent.change(within(fiche).getByRole('textbox', { name: 'Prénom' }), { target: { value: 'Salif' } })
    fireEvent.click(within(fiche).getByRole('button', { name: 'Enregistrer' }))

    await waitFor(() => expect(onAddClient).toHaveBeenCalled())
    expect(await screen.findByText('Ce code agent est déjà pris.')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Enregistrer un client' })).toBeInTheDocument()
  })

  it('[NC-05] sans moyen d’enregistrer, pas de bouton « + »', async () => {
    render(<TransactionForm clients={[EXISTANT]} />)
    fireEvent.change(screen.getByPlaceholderText(/code agent/i), { target: { value: '87654321' } })

    await screen.findByRole('button', { name: /Utiliser ce code sans client enregistré/ })
    expect(screen.queryByRole('button', { name: /Enregistrer ce client/ })).not.toBeInTheDocument()
  })
})
