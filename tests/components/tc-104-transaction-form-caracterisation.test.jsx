/**
 * TC-104 — TransactionForm : caractérisation avant refonte.
 *
 * L'écran de saisie d'argent : 633 lignes, le plus gros composant du dépôt, et celui
 * dont une régression coûterait le plus cher. Il n'avait aucun test de rendu.
 *
 * Ce qu'on fige : les intitulés de champs, les options réellement offertes par le
 * profil C2EGF (un seul réseau, pas de Crédit), les deux voies de soumission, l'état
 * désactivé tant que le formulaire est incomplet, les paliers d'alerte de stock, et
 * la confirmation avant écriture.
 *
 * Ce qu'on ne fige pas : la moindre classe CSS. Les paliers de stock sont assertés
 * par leur TEXTE (« Stock épuisé », « Stock très faible », « Stock faible »), jamais
 * par leur couleur — c'est justement le défaut que la refonte doit corriger, ces
 * trois états n'étant aujourd'hui distingués que par une pastille colorée.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

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
import { NETWORK_OPTIONS, TRANSACTION_TYPES } from '../../src/utils/constants.js'

const CLIENTS = [
  { id: 'c-1', nom: 'BANABA', prenom: 'Guafarou', orange: '45441020', numeroPersonnel: '76965827' },
]

const renderForm = () => render(<TransactionForm clients={CLIENTS} />)

const chooseNature = (label) =>
  fireEvent.click(screen.getByRole('radio', { name: label }))

beforeEach(() => {
  stockValue = 500000
  transactionsValue = {
    addTransaction: vi.fn().mockResolvedValue(undefined),
    updateTransaction: vi.fn().mockResolvedValue(undefined),
    editingTransaction: null,
    clearEditTransaction: vi.fn(),
  }
})

describe('TC-104 — champs du formulaire', () => {
  it('propose la recherche d’un compte par nom ou par code agent', () => {
    renderForm()
    expect(
      screen.getByPlaceholderText('Rechercher un client ou saisir le numéro/code agent...'),
    ).toBeInTheDocument()
  })

  it('expose les trois champs de saisie attendus', () => {
    renderForm()
    expect(screen.getByText('Montant (FCFA) :')).toBeInTheDocument()
    expect(screen.getByText('Réseau :')).toBeInTheDocument()
    expect(screen.getByText('Nature :')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Saisir le montant')).toBeInTheDocument()
  })
})

describe('TC-104 — les options viennent du profil client', () => {
  it('un seul réseau proposé : Orange', () => {
    renderForm()
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveTextContent('Orange')
    expect(NETWORK_OPTIONS).toEqual(['Orange'])
  })

  it('deux natures d’opération : Dépôt et Retrait — pas de Crédit', () => {
    renderForm()
    expect(screen.getByRole('radio', { name: 'Dépôt' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Retrait' })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Crédit' })).not.toBeInTheDocument()
    expect(TRANSACTION_TYPES.map((t) => t.value)).toEqual(['Dépôt', 'Retrait'])
  })
})

describe('TC-104 — les deux voies de soumission', () => {
  it('offre « Non Terminées » et « Valider »', () => {
    renderForm()
    expect(screen.getByRole('button', { name: 'Non Terminées' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Valider' })).toBeInTheDocument()
  })

  it('formulaire vide → les deux soumissions sont désactivées', () => {
    renderForm()
    expect(screen.getByRole('button', { name: 'Non Terminées' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Valider' })).toBeDisabled()
  })

  it('en édition → « Sauvegarder » et « Annuler » remplacent les deux voies', () => {
    transactionsValue.editingTransaction = {
      id: 'tx-1', client: CLIENTS[0], montant: 5000, type: 'Dépôt', reseau: 'Orange',
    }
    renderForm()
    expect(screen.getByRole('button', { name: 'Sauvegarder' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Valider' })).not.toBeInTheDocument()
  })
})

describe('TC-104 — paliers d’alerte de stock', () => {
  it('un dépôt affiche le stock disponible du réseau', () => {
    renderForm()
    chooseNature('Dépôt')
    expect(screen.getByText(/Stock disponible pour Orange/)).toBeInTheDocument()
  })

  it('un retrait n’affiche pas l’indicateur de stock', () => {
    renderForm()
    chooseNature('Retrait')
    expect(screen.queryByText(/Stock disponible pour Orange/)).not.toBeInTheDocument()
  })

  it('stock à zéro → « Stock épuisé »', () => {
    stockValue = 0
    renderForm()
    chooseNature('Dépôt')
    expect(screen.getByText('Stock épuisé')).toBeInTheDocument()
  })

  it('stock sous 10 000 → « Stock très faible »', () => {
    stockValue = 9999
    renderForm()
    chooseNature('Dépôt')
    expect(screen.getByText('Stock très faible')).toBeInTheDocument()
  })

  it('stock sous 25 000 → « Stock faible »', () => {
    stockValue = 24999
    renderForm()
    chooseNature('Dépôt')
    expect(screen.getByText('Stock faible')).toBeInTheDocument()
  })

  it('stock confortable → aucune alerte', () => {
    stockValue = 500000
    renderForm()
    chooseNature('Dépôt')
    expect(screen.queryByText(/Stock épuisé|Stock très faible|Stock faible/)).not.toBeInTheDocument()
  })
})
