import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * TC-412 — l'onglet « Western Union · Ria · MoneyGram » de la fenêtre
 * « Enregistrer une transaction » (docs/superpowers/specs/2026-11-23-transferts-argent-design.md,
 * « La fenêtre »). Choisi par l'utilisateur (approche B) : deux mini-onglets,
 * un formulaire propre au client ordinaire, un seul bouton « Non Terminées ».
 */

let boutique
vi.mock('../../src/hooks/useClients', () => ({ useClients: () => ({ clients: [], addClient: vi.fn() }) }))
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'u1' }, userProfile: { role: 'store_admin', storeId: 'store-a' }, activeStore: boutique }),
}))
let transactions
vi.mock('../../src/context/transactions.jsx', () => ({ useTransactions: () => transactions }))
let stock = 300_000
let liquidite = 200_000
vi.mock('../../src/hooks/useSimpleNetworkData', () => ({
  useSimpleNetworkData: () => ({ getStock: () => stock, getNetworkLiquidite: () => liquidite }),
}))
let actifProfil = true
vi.mock('../../src/utils/transfertArgent.js', async (original) => ({
  ...(await original()),
  get TRANSFERT_ARGENT_ACTIF() { return actifProfil },
}))
vi.mock('../../src/hooks/useIncomingCollaborationsCount', () => ({ useIncomingCollaborationsCount: () => 0 }))
vi.mock('../../src/components/transactions/TransactionTable', () => ({ default: () => null }))
vi.mock('../../src/components/transactions/DealerTransferForm', () => ({ default: () => null }))
vi.mock('../../src/components/transactions/CollaborationsPanel', () => ({ default: () => null }))
vi.mock('../../src/components/transactions/RavitaillementPanel', () => ({ default: () => null }))
vi.mock('../../src/components/transactions/TransactionForm', () => ({ default: () => <div data-testid="formulaire-agent" /> }))

import Transactions from '../../src/pages/Transactions.jsx'
import TransfertArgentForm from '../../src/components/transactions/TransfertArgentForm.jsx'

const ONGLET_TRANSFERT = 'Western Union · Ria · MoneyGram'
const radio = (nom) => screen.getByRole('radio', { name: nom })
const champ = (nom) => screen.getByLabelText(nom)
const bouton = () => screen.getByRole('button', { name: 'Non Terminées' })
const LIGNE = {
  id: 'ta1', type: 'Transfert argent', service: 'Ria', operation: 'retrait', nomClient: 'OUEDRAOGO Paul', telephone: '70123456',
  balanceType: 'stock', montant: 75_000, montantTraite: 0, resteATraiter: 75_000, statut: 'Non Terminées',
}

const ouvrirPage = () => {
  render(<MemoryRouter initialEntries={['/transactions']}><Transactions /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: /Enregistrer une transaction/ }))
}

const remplir = ({ service = 'Western Union', operation = 'Transfert', nom = 'DIALLO Awa', montant = '50000', reserve = 'Espèce' } = {}) => {
  fireEvent.click(radio(service))
  fireEvent.click(radio(operation))
  fireEvent.change(champ('Nom du client'), { target: { value: nom } })
  fireEvent.change(champ('Montant (FCFA)'), { target: { value: montant } })
  fireEvent.click(radio(reserve))
}

beforeEach(() => {
  boutique = { id: 'store-a', name: 'Boutique A', transfertsArgent: true }
  actifProfil = true
  stock = 300_000
  liquidite = 200_000
  transactions = {
    pendingTransactions: [],
    completedTransactions: [],
    editingTransaction: null,
    clearEditTransaction: vi.fn(),
    ajouterTransfertArgent: vi.fn(async () => ({ statut: 'envoyee' })),
    modifierTransfertArgent: vi.fn(async () => ({ statut: 'envoyee' })),
  }
})

describe('TC-412 — les onglets', () => {
  it('[TC-412-01] sans l’option, ou drapeau éteint : pas d’onglets, le formulaire d’agent', () => {
    boutique = { ...boutique, transfertsArgent: false }
    ouvrirPage()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByTestId('formulaire-agent')).toBeInTheDocument()
  })

  it('[TC-412-01b] drapeau de profil éteint : pas d’onglets même avec l’option', () => {
    actifProfil = false
    ouvrirPage()
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('[TC-412-02] avec l’option : « Agent » d’abord, puis le formulaire du transfert, sans recherche d’agent', () => {
    ouvrirPage()
    const onglets = screen.getByRole('tablist')
    expect(within(onglets).getByRole('tab', { name: 'Agent' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('formulaire-agent')).toBeInTheDocument()
    fireEvent.click(within(onglets).getByRole('tab', { name: ONGLET_TRANSFERT }))
    expect(within(onglets).getByRole('tab', { name: ONGLET_TRANSFERT })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByTestId('formulaire-agent')).toBeNull()
    expect(champ('Nom du client')).toBeInTheDocument()
  })

  it('[TC-412-08] modification d’une ligne de transfert : son onglet imposé, l’autre inactif', async () => {
    transactions.editingTransaction = LIGNE
    render(<MemoryRouter initialEntries={['/transactions']}><Transactions /></MemoryRouter>)
    const onglets = await screen.findByRole('tablist')
    expect(within(onglets).getByRole('tab', { name: ONGLET_TRANSFERT })).toHaveAttribute('aria-selected', 'true')
    expect(within(onglets).getByRole('tab', { name: 'Agent' })).toBeDisabled()
    expect(champ('Nom du client')).toHaveValue('OUEDRAOGO Paul')
    expect(radio('Transfert')).toBeDisabled()
    expect(radio('Retrait')).toBeChecked()
  })
})

describe('TC-412 — le formulaire', () => {
  it('[TC-412-03] « Précisez » seulement avec Autres ; « Payé en » pour un retrait', () => {
    render(<TransfertArgentForm />)
    expect(screen.queryByLabelText('Précisez (facultatif)')).toBeNull()
    fireEvent.click(radio('Autres'))
    expect(champ('Précisez (facultatif)')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Reçu en :' })).toBeInTheDocument()
    fireEvent.click(radio('Retrait'))
    expect(screen.getByRole('group', { name: 'Payé en :' })).toBeInTheDocument()
  })

  it('[TC-412-04] rien n’est coché d’office ; bouton grisé avec la raison ; pas de « Valider »', () => {
    render(<TransfertArgentForm />)
    for (const nom of ['Western Union', 'Ria', 'MoneyGram', 'Autres', 'Transfert', 'Retrait', 'Stock', 'Espèce']) expect(radio(nom)).not.toBeChecked()
    expect(bouton()).toBeDisabled()
    expect(screen.getByText('Choisissez le service.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Valider' })).toBeNull()
  })

  it('[TC-412-05] saisie complète, confirmée : la charge exacte part, les champs se vident', async () => {
    render(<TransfertArgentForm />)
    remplir()
    fireEvent.change(champ('Téléphone (facultatif)'), { target: { value: '70 12 34 56' } })
    expect(bouton()).toBeEnabled()
    fireEvent.click(bouton())
    const confirmation = screen.getByRole('dialog', { name: 'Confirmer la transaction' })
    expect(within(confirmation).getByText('DIALLO Awa')).toBeInTheDocument()
    expect(within(confirmation).getByText('Western Union')).toBeInTheDocument()
    await act(async () => { fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirmer' })) })
    expect(transactions.ajouterTransfertArgent).toHaveBeenCalledWith({
      service: 'Western Union', operation: 'transfert', nomClient: 'DIALLO Awa', telephone: '70123456', montant: 50_000, balanceType: 'liquidite',
    })
    expect(champ('Nom du client')).toHaveValue('')
    expect(radio('Western Union')).not.toBeChecked()
  })

  it('[TC-412-06] retrait au-delà de l’espèce : « Espèce insuffisante. », bouton grisé', () => {
    render(<TransfertArgentForm />)
    remplir({ operation: 'Retrait', montant: '250000' })
    expect(screen.getByText('Espèce insuffisante.')).toBeInTheDocument()
    expect(bouton()).toBeDisabled()
  })

  it('[TC-412-07] deux clics sur « Confirmer » dans le même instant : un seul envoi', async () => {
    let finir
    transactions.ajouterTransfertArgent = vi.fn(() => new Promise((resolve) => { finir = resolve }))
    render(<TransfertArgentForm />)
    remplir()
    fireEvent.click(bouton())
    const confirmer = within(screen.getByRole('dialog', { name: 'Confirmer la transaction' })).getByRole('button', { name: 'Confirmer' })
    fireEvent.click(confirmer)
    fireEvent.click(confirmer)
    await act(async () => { finir({ statut: 'envoyee' }) })
    expect(transactions.ajouterTransfertArgent).toHaveBeenCalledTimes(1)
  })

  it('[TC-412-08b] modification : « Sauvegarder » envoie les champs (facultatifs vidés compris), puis ferme', async () => {
    transactions.editingTransaction = LIGNE
    const onComplete = vi.fn()
    render(<TransfertArgentForm onComplete={onComplete} />)
    fireEvent.change(champ('Montant (FCFA)'), { target: { value: '60000' } })
    fireEvent.change(champ('Téléphone (facultatif)'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sauvegarder' }))
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog', { name: 'Confirmer la transaction' })).getByRole('button', { name: 'Confirmer' }))
    })
    expect(transactions.modifierTransfertArgent).toHaveBeenCalledWith('ta1', {
      service: 'Ria', servicePrecise: '', nomClient: 'OUEDRAOGO Paul', telephone: '', codeTransfert: '', montant: 60_000, balanceType: 'stock',
    })
    expect(transactions.clearEditTransaction).toHaveBeenCalled()
    expect(onComplete).toHaveBeenCalled()
  })

  it('[TC-412-08c] modification d’un retrait : le montant déjà payé compte dans la réserve', () => {
    transactions.editingTransaction = LIGNE
    stock = 10_000
    render(<TransfertArgentForm />)
    fireEvent.change(champ('Montant (FCFA)'), { target: { value: '80000' } })
    expect(screen.getByRole('button', { name: 'Sauvegarder' })).toBeEnabled()
    fireEvent.change(champ('Montant (FCFA)'), { target: { value: '90000' } })
    expect(screen.getByRole('button', { name: 'Sauvegarder' })).toBeDisabled()
  })
})
