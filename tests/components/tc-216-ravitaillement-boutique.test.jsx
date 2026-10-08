import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * TC-216 — Le geste de ravitaillement depuis l'écran Transactions.
 *
 * Deux exigences s'y rencontrent : l'onglet client ne porte plus l'encart qui
 * expliquait le signe des montants, et le gérant dispose d'un geste direct pour
 * enregistrer ce que le dealer vient de livrer.
 *
 * ⚠ LE BOUTON N'OUVRE PLUS LE FORMULAIRE, ET C'EST VOULU (S8).
 *   Il ouvre désormais la LISTE de ce qu'il reste à rendre ; la saisie vit
 *   derrière « Nouveau ravitaillement ». La raison tient en une phrase : la
 *   boutique pouvait déclarer ce qu'elle recevait, jamais ce qu'elle rendait,
 *   et elle ouvre cet écran dix fois pour rendre contre une fois pour déclarer.
 *   Les assertions de ce fichier portent toujours sur le FORMULAIRE : seul le
 *   chemin pour y arriver a gagné un clic. La liste elle-même est figée par
 *   TC-229.
 */

const runStoreTransactionCommand = vi.fn()
const showToast = vi.fn()
// Mutable : le badge se mesure en faisant varier l'historique chargé.
let historique = []

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
    completedTransactions: historique,
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

// Le panneau s'ouvre sur la liste ; la saisie est derrière un bouton.
const ouvrirModal = () => {
  fireEvent.click(screen.getByTestId('ouvrir-ravitaillement'))
  fireEvent.click(screen.getByTestId('nouveau-ravitaillement'))
  return screen.getByRole('dialog', { name: 'Nouveau ravitaillement' })
}

const saisirMontant = (valeur) =>
  fireEvent.change(screen.getByLabelText('Montant (FCFA)'), { target: { value: valeur } })

beforeEach(() => {
  runStoreTransactionCommand.mockReset().mockResolvedValue({ id: 'rav-1' })
  showToast.mockReset()
  historique = []
})

const ravEnCours = (id, over = {}) => ({
  id,
  type: 'Ravitaillement',
  expediteur: 'Patron',
  montant: 100_000,
  returnedAmount: 0,
  remainingAmount: 100_000,
  balanceType: 'stock',
  createdAt: new Date('2026-10-08T08:00:00Z'),
  ...over,
})

/**
 * LE BADGE DIT « TU DOIS ENCORE QUELQUE CHOSE À QUELQU'UN ».
 *
 * `constants/navigation.js` pose la règle du dépôt : un compteur veut dire
 * qu'une réponse est attendue de vous. Celui-ci tient parce qu'il REDESCEND :
 * il n'y a pas de commission entre franchises de la même entreprise, donc le
 * reste dû d'une livraison atteint zéro exactement. Un compteur qui ne
 * redescend jamais finit par n'être plus lu — et il occupe la place d'un
 * signal utile.
 */
describe('TC-216 — le badge des livraisons à rendre', () => {
  it('compte les livraisons encore dues', () => {
    historique = [ravEnCours('a'), ravEnCours('b')]
    afficher()
    expect(screen.getByTestId('badge-ravitaillement')).toHaveTextContent('2')
  })

  it('disparaît quand il n’y a plus rien à rendre', () => {
    historique = [ravEnCours('a', { remainingAmount: 0 })]
    afficher()
    expect(screen.queryByTestId('badge-ravitaillement')).not.toBeInTheDocument()
  })

  it('ignore les livraisons d’avant le suivi', () => {
    // Elles n'ont pas de reste dû, et il est inconnaissable : les compter
    // afficherait une dette que personne ne peut chiffrer.
    const ancienne = ravEnCours('vieille')
    delete ancienne.remainingAmount
    historique = [ancienne]
    afficher()
    expect(screen.queryByTestId('badge-ravitaillement')).not.toBeInTheDocument()
  })
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
    // L'expéditeur est demandé : sans lui la livraison serait une dette envers
    // personne, et n'entrerait dans aucun total du soir.
    expect(screen.getByTestId('ravitaillement-expediteur')).toBeInTheDocument()

    // « Annuler » ramène à la LISTE, il ne ferme pas : on vient souvent saisir
    // une livraison juste avant d'en rendre une autre.
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(screen.getByTestId('nouveau-ravitaillement')).toBeInTheDocument()
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
      expediteur: 'Patron',
      note: 'Bordereau 42',
    }))
    // La saisie réussie ramène à la liste, qui vient de gagner une ligne à rendre.
    await waitFor(() => expect(screen.getByTestId('nouveau-ravitaillement')).toBeInTheDocument())
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
      expediteur: 'Patron',
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
    expect(screen.getByRole('dialog', { name: 'Nouveau ravitaillement' })).toBeInTheDocument()
  })
})
