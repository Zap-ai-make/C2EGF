import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'

/**
 * TC-413 — les lignes de transfert d'argent dans les non terminées et
 * l'historique (docs/superpowers/specs/2026-11-23-transferts-argent-design.md,
 * « La ligne en attente »).
 *
 * Décidé par l'utilisateur : un transfert se ferme par « Envoyer au siège »,
 * un retrait par « Encaisser », toujours en stock. Le nom vient de la saisie,
 * le type interne n'est jamais affiché.
 */

let contextValue
let stockValue = 400000

vi.mock('../../src/context/ThemeContext.jsx', () => ({
  useTheme: () => ({
    themeClasses: { tableHeader: 'bg-gray-100 border-gray-300', tableBorder: 'border-gray-300', text: 'text-gray-900' },
  }),
}))
vi.mock('../../src/context/transactions.jsx', () => ({ useTransactions: () => contextValue }))
vi.mock('../../src/hooks/useSimpleNetworkData', () => ({ useSimpleNetworkData: () => ({ getStock: () => stockValue }) }))

import TransactionTable from '../../src/components/transactions/TransactionTable.jsx'
import HistoriqueTable from '../../src/components/historique/HistoriqueTable.jsx'
import { getAvailableActions, getTransactionStyles } from '../../src/utils/helpers.js'

const T = {
  id: 'T', type: 'Transfert argent', service: 'Western Union', operation: 'transfert', nomClient: 'DIALLO Awa', codeTransfert: 'MTCN-77',
  reseau: 'Orange', montant: 50000, balanceType: 'liquidite', montantTraite: 20000, resteATraiter: 30000, tranches: [{ id: 't0', montant: 20000 }],
  statut: 'Non Terminées', date: '23/11/2026 08:12',
}
const R = {
  id: 'R', type: 'Transfert argent', service: 'Autres', servicePrecise: 'Wari', operation: 'retrait', nomClient: 'OUEDRAOGO Paul',
  reseau: 'Orange', montant: 75000, balanceType: 'stock', montantTraite: 0, resteATraiter: 75000, tranches: [],
  statut: 'Non Terminées', date: '23/11/2026 09:40',
}

beforeEach(() => {
  stockValue = 400000
  contextValue = {
    pendingTransactions: [T, R],
    loading: false,
    getActionButtons: (t) => ({ ...getAvailableActions(t.type), ...(t.montantTraite > 0 ? { modifier: false } : {}) }),
    getTransactionStyles,
    addPaymentTranche: vi.fn(),
    addRefundTranche: vi.fn(),
    startEditTransaction: vi.fn(),
    trashTransaction: vi.fn().mockResolvedValue({ statut: 'en_attente' }),
    envoyerAuSiege: vi.fn(),
    traiterTransfertArgent: vi.fn().mockResolvedValue({ statut: 'en_attente' }),
  }
})

const rangee = (nom) => screen.getByText(nom).closest('tr')
const montant = () => within(screen.getByTestId('menu-reglement')).getByLabelText('Montant (FCFA)')

describe('TC-413 — la ligne en attente', () => {
  it('[TC-413-01] nom, libellé, réserve, code ; le geste qui suit l’opération, aucun geste d’agent', () => {
    render(<TransactionTable />)
    const transfert = rangee('DIALLO Awa')
    expect(transfert).toHaveTextContent('Western Union · Transfert')
    expect(transfert).toHaveTextContent('Reçu en Espèce')
    expect(transfert).toHaveTextContent('MTCN-77')
    expect(transfert).not.toHaveTextContent('Transfert argent')
    expect(within(transfert).getByRole('button', { name: 'Envoyer au siège' })).toBeInTheDocument()
    const retrait = rangee('OUEDRAOGO Paul')
    expect(retrait).toHaveTextContent('Wari · Retrait')
    expect(retrait).toHaveTextContent('Payé en Stock')
    expect(within(retrait).getByRole('button', { name: 'Encaisser' })).toBeInTheDocument()
    for (const ligne of [transfert, retrait]) {
      for (const geste of ['Payer par', 'Rembourser']) expect(within(ligne).queryByRole('button', { name: geste })).toBeNull()
    }
    expect(within(transfert).queryByRole('button', { name: 'Encaisser' })).toBeNull()
  })

  it('[TC-413-04] après une tranche : « Envoyé » et « Reste », plus de « Modifier »', () => {
    render(<TransactionTable />)
    const transfert = rangee('DIALLO Awa')
    expect(transfert.textContent).toMatch(/Envoyé : 20\s000 FCFA/)
    expect(transfert.textContent).toMatch(/Reste : 30\s000 FCFA/)
    expect(within(transfert).queryByRole('button', { name: 'Modifier' })).toBeNull()
    expect(within(rangee('OUEDRAOGO Paul')).getByRole('button', { name: 'Modifier' })).toBeInTheDocument()
  })
})

describe('TC-413 — les tranches', () => {
  it('[TC-413-02] « Envoyer au siège » : pré-rempli au stock, refus au-delà, puis la tranche part', async () => {
    stockValue = 25000
    render(<TransactionTable />)
    fireEvent.click(within(rangee('DIALLO Awa')).getByRole('button', { name: 'Envoyer au siège' }))
    expect(screen.queryByText('Sélectionner méthode')).toBeNull()
    expect(montant()).toHaveValue(25000)
    fireEvent.change(montant(), { target: { value: '30000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer l’envoi' }))
    expect(screen.getByText(/Stock insuffisant/)).toBeInTheDocument()
    expect(contextValue.traiterTransfertArgent).not.toHaveBeenCalled()
    fireEvent.change(montant(), { target: { value: '20000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer l’envoi' }))
    await waitFor(() => expect(contextValue.traiterTransfertArgent).toHaveBeenCalledWith('T', 20000))
    expect(contextValue.envoyerAuSiege).not.toHaveBeenCalled()
  })

  it('[TC-413-03] « Encaisser » : pré-rempli au reste, sans plafond de stock', async () => {
    stockValue = 0
    render(<TransactionTable />)
    fireEvent.click(within(rangee('OUEDRAOGO Paul')).getByRole('button', { name: 'Encaisser' }))
    expect(montant()).toHaveValue(75000)
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer l’encaissement' }))
    await waitFor(() => expect(contextValue.traiterTransfertArgent).toHaveBeenCalledWith('R', 75000))
  })

  it('[TC-413-05] deux clics dans le même instant : une seule tranche', async () => {
    render(<TransactionTable />)
    fireEvent.click(within(rangee('OUEDRAOGO Paul')).getByRole('button', { name: 'Encaisser' }))
    const confirmer = screen.getByRole('button', { name: 'Confirmer l’encaissement' })
    await act(async () => {
      fireEvent.click(confirmer)
      fireEvent.click(confirmer)
    })
    await waitFor(() => expect(contextValue.traiterTransfertArgent).toHaveBeenCalled())
    expect(contextValue.traiterTransfertArgent).toHaveBeenCalledTimes(1)
  })
})

describe('TC-413 — annuler', () => {
  it('[TC-413-07] la fenêtre dit ce qui revient et ce qui sort, puis part par trashTransaction', async () => {
    render(<TransactionTable />)
    fireEvent.click(within(rangee('DIALLO Awa')).getByRole('button', { name: 'Annuler' }))
    await screen.findByRole('button', { name: 'Annuler la transaction' })
    expect(document.body.textContent).toMatch(/Les 50\s000 FCFA reçus sortiront de l’espèce ; les 20\s000 FCFA déjà envoyés au siège reviendront au stock\./)
    expect(document.body.textContent).not.toMatch(/Le stock engagé sera rendu/)
    fireEvent.click(screen.getByRole('button', { name: 'Annuler la transaction' }))
    await waitFor(() => expect(contextValue.trashTransaction).toHaveBeenCalledWith('T'))
  })
})

describe('TC-413 — l’historique', () => {
  const V = { ...R, id: 'V', montantTraite: 75000, resteATraiter: 0, tranches: [{ id: 't', montant: 75000 }], statut: 'Validée', date: '23/11/2026 10:05' }

  it('[TC-413-08] libellé, nom et réserve ; ne se modifie pas, s’annule', async () => {
    render(<HistoriqueTable transactions={[V]} />)
    const ligne = rangee('OUEDRAOGO Paul')
    expect(ligne).toHaveTextContent('Wari · Retrait')
    expect(ligne).toHaveTextContent('· stock')
    const modifier = within(ligne).getByTestId('modifier-historique')
    expect(modifier).toBeDisabled()
    expect(modifier).toHaveAttribute('title', 'Un transfert d’argent ne se modifie pas : annulez-le puis ressaisissez-le.')
    fireEvent.click(within(ligne).getByTestId('supprimer-historique'))
    await screen.findByRole('button', { name: 'Annuler la transaction' })
    expect(document.body.textContent).toMatch(/Les 75\s000 FCFA payés reviendront au stock ; les 75\s000 FCFA déjà encaissés sortiront du stock\./)
    fireEvent.click(screen.getByRole('button', { name: 'Annuler la transaction' }))
    await waitFor(() => expect(contextValue.trashTransaction).toHaveBeenCalledWith('V'))
  })

  it('[TC-413-09] la teinte des transferts', () => {
    expect(getTransactionStyles('Transfert argent').textColor).toBe('text-transfert')
  })
})
