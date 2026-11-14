import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

/**
 * TC-387 — « Remb. siège », troisième nature du formulaire de transaction
 * (docs/superpowers/specs/2026-11-14-remboursement-siege-design.md, « Ce que la
 * caissière voit »).
 *
 * Décidé par l'utilisateur : la nature s'ajoute à Dépôt et Retrait ; la
 * choisir fait apparaître « Stock » / « Espèce » (où l'agent a mis l'argent) ;
 * les deux boutons restent « Non Terminées » et « Valider ». Aucune réserve
 * n'est cochée d'office : un défaut silencieux serait une erreur de réserve
 * que personne ne verrait.
 */

let stockValue = 500000
let transactionsValue
let rembSiegeActif = true

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
vi.mock('../../src/utils/rembSiege.js', async (original) => {
  const module = await original()
  return {
    ...module,
    get REMB_SIEGE_ACTIF() { return rembSiegeActif },
  }
})

import TransactionForm from '../../src/components/transactions/TransactionForm.jsx'

const CLIENTS = [
  { id: 'c-1', nom: 'BANABA', prenom: 'Guafarou', orange: '45441020', numeroPersonnel: '76965827' },
]

const renderForm = () => render(<TransactionForm clients={CLIENTS} />)
const radio = (nom) => screen.getByRole('radio', { name: nom })

const saisirRembSiege = ({ montant = '100000', reserve } = {}) => {
  fireEvent.change(screen.getByPlaceholderText(/code agent/i), { target: { value: '45441020' } })
  fireEvent.change(screen.getByPlaceholderText('Saisir le montant'), { target: { value: montant } })
  fireEvent.click(radio('Remb. siège'))
  if (reserve) fireEvent.click(radio(reserve))
}

const soumettreEtConfirmer = async (bouton) => {
  fireEvent.click(screen.getByRole('button', { name: bouton }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmer' })).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }))
}

beforeEach(() => {
  stockValue = 500000
  rembSiegeActif = true
  transactionsValue = {
    addTransaction: vi.fn().mockResolvedValue(undefined),
    updateTransaction: vi.fn().mockResolvedValue(undefined),
    saveReopenedCorrection: vi.fn().mockResolvedValue(undefined),
    ajouterRembSiege: vi.fn().mockResolvedValue({ statut: 'en_attente' }),
    modifierRembSiege: vi.fn().mockResolvedValue({ statut: 'en_attente' }),
    editingTransaction: null,
    clearEditTransaction: vi.fn(),
  }
})

describe('TC-387 — la nature et la réserve', () => {
  it('[TC-387-1] trois natures, dans l’ordre ; deux quand le profil l’éteint', () => {
    const { unmount } = renderForm()
    const natures = screen.getAllByRole('radio').map((r) => r.getAttribute('value'))
    expect(natures).toEqual(['Dépôt', 'Retrait', 'Remb. siège'])
    unmount()

    rembSiegeActif = false
    renderForm()
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('value'))).toEqual(['Dépôt', 'Retrait'])
  })

  it('[TC-387-2] « Reçu en » n’apparaît qu’avec « Remb. siège », sans choix coché', () => {
    renderForm()
    expect(screen.queryByRole('radio', { name: 'Stock' })).not.toBeInTheDocument()
    fireEvent.click(radio('Remb. siège'))
    expect(radio('Stock')).not.toBeChecked()
    expect(radio('Espèce')).not.toBeChecked()
  })
})

describe('TC-387 — les deux voies', () => {
  it('[TC-387-3] reçu en Stock, stock à zéro : « Valider » passe, la confirmation dit la réserve', async () => {
    stockValue = 0
    renderForm()
    saisirRembSiege({ reserve: 'Stock' })
    expect(screen.getByRole('button', { name: 'Valider' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Valider' }))
    await waitFor(() => expect(screen.getByText('Reçu en:')).toBeInTheDocument())
    expect(screen.getByText('Reçu en:').parentElement).toHaveTextContent('Reçu en: Stock')
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }))

    await waitFor(() => expect(transactionsValue.ajouterRembSiege).toHaveBeenCalledTimes(1))
    expect(transactionsValue.ajouterRembSiege.mock.calls[0][0]).toMatchObject({
      clientId: 'c-1', montant: 100000, balanceType: 'stock', statut: 'Validée',
    })
    expect(transactionsValue.addTransaction).not.toHaveBeenCalled()
  })

  it('[TC-387-4] reçu en Espèce, stock trop bas : « Valider » grisé avec sa raison, « Non Terminées » permis', () => {
    stockValue = 50000
    renderForm()
    saisirRembSiege({ reserve: 'Espèce' })
    expect(screen.getByRole('button', { name: 'Valider' })).toBeDisabled()
    expect(screen.getByText('Stock insuffisant : utilisez Non Terminées.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Non Terminées' })).toBeEnabled()
  })

  it('[TC-387-5] « Non Terminées » reçu en Espèce', async () => {
    renderForm()
    saisirRembSiege({ reserve: 'Espèce' })
    await soumettreEtConfirmer('Non Terminées')
    await waitFor(() => expect(transactionsValue.ajouterRembSiege).toHaveBeenCalledTimes(1))
    expect(transactionsValue.ajouterRembSiege.mock.calls[0][0]).toMatchObject({ balanceType: 'liquidite', statut: 'Non Terminées' })
  })

  it('[TC-387-6] après l’enregistrement, la nature et la réserve sont vidées', async () => {
    renderForm()
    saisirRembSiege({ reserve: 'Espèce' })
    await soumettreEtConfirmer('Non Terminées')
    await waitFor(() => expect(transactionsValue.ajouterRembSiege).toHaveBeenCalled())
    await waitFor(() => expect(radio('Remb. siège')).not.toBeChecked())
    expect(screen.queryByRole('radio', { name: 'Espèce' })).not.toBeInTheDocument()
  })
})

describe('TC-387 — la modification', () => {
  it('[TC-387-7] une ligne « Remb. siège » garde sa nature, et part par sa propre commande', async () => {
    transactionsValue.editingTransaction = {
      id: 'rs-1', client: CLIENTS[0], montant: 100000, type: 'Remb. siège', reseau: 'Orange', balanceType: 'liquidite', envoyeAuSiege: 0,
    }
    renderForm()
    expect(radio('Dépôt')).toBeDisabled()
    expect(radio('Retrait')).toBeDisabled()
    expect(radio('Espèce')).toBeChecked()

    fireEvent.change(screen.getByPlaceholderText('Saisir le montant'), { target: { value: '80000' } })
    await soumettreEtConfirmer('Sauvegarder')
    await waitFor(() => expect(transactionsValue.modifierRembSiege).toHaveBeenCalledTimes(1))
    expect(transactionsValue.modifierRembSiege).toHaveBeenCalledWith('rs-1', expect.objectContaining({ montant: 80000, balanceType: 'liquidite' }))
    expect(transactionsValue.updateTransaction).not.toHaveBeenCalled()
  })

  it('[TC-387-7b] un dépôt en modification ne peut pas devenir un remboursement au siège', () => {
    transactionsValue.editingTransaction = { id: 'tx-1', client: CLIENTS[0], montant: 5000, type: 'Dépôt', reseau: 'Orange' }
    renderForm()
    expect(radio('Remb. siège')).toBeDisabled()
  })
})

describe('TC-387 — le double clic', () => {
  it('[TC-387-8] deux clics sur « Confirmer » dans le même instant : un seul remboursement', async () => {
    renderForm()
    saisirRembSiege({ reserve: 'Stock' })
    fireEvent.click(screen.getByRole('button', { name: 'Valider' }))
    const confirmer = await screen.findByRole('button', { name: 'Confirmer' })
    await act(async () => {
      fireEvent.click(confirmer)
      fireEvent.click(confirmer)
    })
    await waitFor(() => expect(transactionsValue.ajouterRembSiege).toHaveBeenCalled())
    expect(transactionsValue.ajouterRembSiege).toHaveBeenCalledTimes(1)
  })
})
