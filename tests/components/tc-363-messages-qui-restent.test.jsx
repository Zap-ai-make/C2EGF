/**
 * TC-363 — les messages qui survivent au formulaire qui les a émis (lot G4b,
 * docs/rester-dans-le-quota-gratuit.md §G4).
 *
 * Le hook `useToast` garde ses messages dans le composant qui l'appelle. Le
 * formulaire de ravitaillement et celui du retour ne les affichaient pas, et celui
 * de transaction disparaît juste après une modification. Résultat : ni « gardé sur
 * cet appareil », ni aucun refus du serveur à l'écran. L'essai dans le navigateur
 * l'a montré ; les tests précédents, qui simulaient `useToast`, ne pouvaient pas le voir.
 *
 * Ici, le VRAI `useToast` et le vrai composant `Toast`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { runStoreTransactionCommand } = vi.hoisted(() => ({ runStoreTransactionCommand: vi.fn() }))
vi.mock('../../src/services/storeTransactionCommandService.js', () => ({ runStoreTransactionCommand }))

const LIVRAISON = { id: 'r1', type: 'Ravitaillement', montant: 300, remainingAmount: 300, balanceType: 'stock', expediteur: 'Mme Sawadogo', date: '06/11/2026' }
vi.mock('../../src/context/transactions.jsx', () => ({ useTransactions: () => ({ completedTransactions: [LIVRAISON] }) }))
vi.mock('../../src/hooks/useSimpleNetworkData', () => ({
  useSimpleNetworkData: () => ({ getStock: () => 1000, getNetworkLiquidite: () => 1000 }),
}))

import RavitaillementPanel from '../../src/components/transactions/RavitaillementPanel.jsx'
import { EnvoisContext } from '../../src/context/envoisContexte.js'
import { EN_ATTENTE } from '../../src/services/fileEnvoi.js'

const fileAvec = (soumettre) => ({ disponible: true, soumettre, retirer: vi.fn(), operations: [], enAttente: [], refusees: [] })
const monter = (envois) => render(
  <EnvoisContext.Provider value={envois}><RavitaillementPanel open onClose={() => {}} /></EnvoisContext.Provider>,
)
const nouveauRavitaillement = () => {
  fireEvent.click(screen.getByTestId('nouveau-ravitaillement'))
  fireEvent.change(screen.getByLabelText('Montant (FCFA)'), { target: { value: '500' } })
  fireEvent.click(screen.getByTestId('valider-ravitaillement'))
}

beforeEach(() => { runStoreTransactionCommand.mockReset() })

describe('TC-363 — le panneau de ravitaillement', () => {
  it('[TO-01] par la file, le message court reste à l’écran une fois revenu à la liste', async () => {
    monter(fileAvec(vi.fn(async () => ({ statut: EN_ATTENTE }))))
    nouveauRavitaillement()
    await screen.findByText(/^Ravitaillement enregistré/)
    expect(screen.getByTestId('nouveau-ravitaillement')).toBeInTheDocument()
  })

  it('[TO-02] un refus du serveur s’affiche, avec sa raison, et le formulaire reste', async () => {
    monter(fileAvec(vi.fn(async () => { throw new Error('Nom d’expéditeur trop long.') })))
    nouveauRavitaillement()
    await screen.findByText('Nom d’expéditeur trop long.')
    expect(screen.getByTestId('valider-ravitaillement')).toBeInTheDocument()
  })

  it('[TO-03] le retour aussi', async () => {
    monter(fileAvec(vi.fn(async () => ({ statut: EN_ATTENTE }))))
    fireEvent.click(screen.getByTestId('retour-r1'))
    fireEvent.change(screen.getByTestId('retour-montant'), { target: { value: '100' } })
    fireEvent.click(screen.getByTestId('confirmer-retour'))
    await screen.findByText(/^Retour enregistré/)
    await waitFor(() => expect(screen.getByTestId('nouveau-ravitaillement')).toBeInTheDocument())
  })

  it('[TO-04] sans file, le refus de l’appel direct s’affiche pareil', async () => {
    runStoreTransactionCommand.mockRejectedValue(new Error('Boutique désactivée.'))
    render(<RavitaillementPanel open onClose={() => {}} />)
    nouveauRavitaillement()
    await screen.findByText('Boutique désactivée.')
  })
})
