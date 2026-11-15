import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'

/**
 * TC-388 — la ligne « Remb. siège » en attente, et « Envoyer au siège »
 * (docs/superpowers/specs/2026-11-14-remboursement-siege-design.md, « La ligne
 * en attente »).
 *
 * Décidé par l'utilisateur : la ligne descend dans les non terminées avec les
 * boutons habituels ; son geste d'avancement envoie au siège, par tranches,
 * toujours depuis le stock. « Envoyer au siège » et non « Rembourser » : ce
 * mot existe déjà dans ce tableau et rend l'argent au client.
 */

let contextValue
let stockValue = 400000

vi.mock('../../src/context/ThemeContext.jsx', () => ({
  useTheme: () => ({
    themeClasses: { tableHeader: 'bg-gray-100 border-gray-300', tableBorder: 'border-gray-300', text: 'text-gray-900' },
  }),
}))
vi.mock('../../src/context/transactions.jsx', () => ({
  useTransactions: () => contextValue,
}))
vi.mock('../../src/hooks/useSimpleNetworkData', () => ({
  useSimpleNetworkData: () => ({ getStock: () => stockValue }),
}))

import TransactionTable from '../../src/components/transactions/TransactionTable.jsx'
import HistoriqueTable from '../../src/components/historique/HistoriqueTable.jsx'
import { getAvailableActions, getTransactionStyles } from '../../src/utils/helpers.js'

const A = {
  id: 'A', client: { nom: 'KABORE', prenom: 'Issa' }, type: 'Remb. siège', reseau: 'Orange', code: '1234567',
  montant: 200000, balanceType: 'liquidite', envoyeAuSiege: 50000, resteAuSiege: 150000, envoisSiege: [{ id: 'e0', montant: 50000 }],
  statut: 'Non Terminées', date: '14/11/2026 08:12',
}
const B = {
  id: 'B', client: { nom: 'SANOU', prenom: 'Ali' }, type: 'Remb. siège', reseau: 'Orange', code: '7654321',
  montant: 100000, balanceType: 'stock', envoyeAuSiege: 0, resteAuSiege: 100000, envoisSiege: [],
  statut: 'Non Terminées', date: '14/11/2026 09:40',
}

beforeEach(() => {
  stockValue = 400000
  contextValue = {
    pendingTransactions: [A, B],
    loading: false,
    // Les vraies règles de type ; le gel de « Modifier » après une tranche est
    // celui du contexte, vérifié dans tc-386-remb-siege-contexte (TC-388-2).
    getActionButtons: (t) => ({ ...getAvailableActions(t.type), ...(t.envoyeAuSiege > 0 ? { modifier: false } : {}) }),
    getTransactionStyles,
    addPaymentTranche: vi.fn(),
    addRefundTranche: vi.fn(),
    startEditTransaction: vi.fn(),
    trashTransaction: vi.fn().mockResolvedValue({ statut: 'en_attente' }),
    envoyerAuSiege: vi.fn().mockResolvedValue({ statut: 'en_attente' }),
  }
})

const rangee = (nom) => screen.getByText(nom).closest('tr')

describe('TC-388 — la ligne en attente', () => {
  it('[TC-388-1] la ligne dit la réserve, ce qui est parti et ce qui reste ; aucun geste de règlement client', () => {
    render(<TransactionTable />)
    const ligne = rangee('Issa KABORE')
    expect(ligne).toHaveTextContent('Remb. siège')
    expect(ligne).toHaveTextContent('Reçu en Espèce')
    expect(ligne.textContent).toMatch(/Envoyé : 50\s000 FCFA/)
    expect(ligne.textContent).toMatch(/Reste : 150\s000 FCFA/)
    for (const geste of ['Encaisser', 'Payer par', 'Rembourser']) {
      expect(within(ligne).queryByRole('button', { name: geste })).not.toBeInTheDocument()
    }
    expect(within(ligne).getByRole('button', { name: 'Envoyer au siège' })).toBeInTheDocument()
    expect(within(ligne).getByRole('button', { name: 'Annuler' })).toBeInTheDocument()
    expect(within(rangee('Ali SANOU')).getByRole('button', { name: 'Modifier' })).toBeInTheDocument()
  })
})

describe('TC-388 — envoyer au siège', () => {
  const ouvrir = (nom) => fireEvent.click(within(rangee(nom)).getByRole('button', { name: 'Envoyer au siège' }))
  const montant = () => within(screen.getByTestId('menu-reglement')).getByLabelText('Montant (FCFA)')

  it('[TC-388-3] le menu s’ouvre sans choix de méthode, montant pré-rempli', () => {
    render(<TransactionTable />)
    ouvrir('Issa KABORE')
    expect(screen.queryByText('Sélectionner méthode')).not.toBeInTheDocument()
    expect(montant()).toHaveValue(150000)
  })

  it('[TC-388-3b] stock plus bas que le reste : pré-rempli avec le stock', () => {
    stockValue = 90000
    render(<TransactionTable />)
    ouvrir('Issa KABORE')
    expect(montant()).toHaveValue(90000)
  })

  it('[TC-388-4] au-delà du reste : refusé avec sa raison ; sinon la tranche part', async () => {
    render(<TransactionTable />)
    ouvrir('Issa KABORE')
    fireEvent.change(montant(), { target: { value: '200000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer l’envoi' }))
    expect(screen.getByText(/Supérieur au reste à envoyer/)).toBeInTheDocument()
    expect(contextValue.envoyerAuSiege).not.toHaveBeenCalled()

    fireEvent.change(montant(), { target: { value: '60000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer l’envoi' }))
    await waitFor(() => expect(contextValue.envoyerAuSiege).toHaveBeenCalledWith('A', 60000))
  })

  it('[TC-388-5] deux clics dans le même instant : une seule tranche', async () => {
    render(<TransactionTable />)
    ouvrir('Issa KABORE')
    const confirmer = screen.getByRole('button', { name: 'Confirmer l’envoi' })
    await act(async () => {
      fireEvent.click(confirmer)
      fireEvent.click(confirmer)
    })
    await waitFor(() => expect(contextValue.envoyerAuSiege).toHaveBeenCalled())
    expect(contextValue.envoyerAuSiege).toHaveBeenCalledTimes(1)
  })
})

describe('TC-388 — annuler', () => {
  it('[TC-388-6] « Annuler » puis confirmation part par trashTransaction', async () => {
    render(<TransactionTable />)
    fireEvent.click(within(rangee('Issa KABORE')).getByRole('button', { name: 'Annuler' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Annuler la transaction' }))
    await waitFor(() => expect(contextValue.trashTransaction).toHaveBeenCalledWith('A'))
  })
})

describe('TC-388 — la ligne validée dans l’historique', () => {
  const V = {
    id: 'V', clientId: 'agent-1', client: { nom: 'KABORE', prenom: 'Issa' }, type: 'Remb. siège', code: '1234567',
    montant: 100000, balanceType: 'liquidite', envoyeAuSiege: 100000, resteAuSiege: 0, envoisSiege: [],
    statut: 'Validée', directValidation: true, date: '14/11/2026 10:05',
  }

  it('[TC-388-7] elle dit sa réserve, et ne se modifie pas : on l’annule puis on la ressaisit', () => {
    render(<HistoriqueTable transactions={[V]} />)
    const ligne = rangee('Issa KABORE')
    expect(ligne).toHaveTextContent('Remb. siège')
    expect(ligne).toHaveTextContent('· espèce')
    const modifier = within(ligne).getByTestId('modifier-historique')
    expect(modifier).toBeDisabled()
    expect(modifier).toHaveAttribute('title', 'Un remboursement au siège ne se modifie pas : annulez-le puis ressaisissez-le.')
    expect(within(ligne).getByTestId('supprimer-historique')).toBeEnabled()
  })

  it('[TC-388-8] « Annuler » puis confirmation part par trashTransaction', async () => {
    render(<HistoriqueTable transactions={[V]} />)
    fireEvent.click(within(rangee('Issa KABORE')).getByTestId('supprimer-historique'))
    fireEvent.click(await screen.findByRole('button', { name: 'Annuler la transaction' }))
    await waitFor(() => expect(contextValue.trashTransaction).toHaveBeenCalledWith('V'))
  })
})

/**
 * Ce que dit la fenêtre « Annuler » d'un remboursement au siège. La phrase
 * générique (« Le stock engagé sera rendu ») dirait l'inverse : l'argent reçu
 * de l'agent RESSORT de la caisse, et seules les tranches déjà parties au siège
 * reviennent au stock. La caissière doit le lire avant de confirmer.
 */
describe('TC-388 — la conséquence d’une annulation, dite avant de confirmer', () => {
  it('[TC-388-10] la ligne en attente : l’espèce reçue ressort, les envois reviennent au stock', async () => {
    render(<TransactionTable />)
    fireEvent.click(within(rangee('Issa KABORE')).getByRole('button', { name: 'Annuler' }))
    await screen.findByRole('button', { name: 'Annuler la transaction' })
    expect(document.body.textContent).toMatch(/Les 200\s000 FCFA reçus sortiront de l’espèce ; les 50\s000 FCFA déjà envoyés au siège reviendront au stock\./)
    expect(document.body.textContent).not.toMatch(/Le stock engagé sera rendu/)
  })

  it('[TC-388-11] la ligne validée dans l’historique : même conséquence, sans la phrase générique', async () => {
    const V = {
      id: 'V', clientId: 'agent-1', client: { nom: 'KABORE', prenom: 'Issa' }, type: 'Remb. siège', code: '1234567',
      montant: 100000, balanceType: 'stock', envoyeAuSiege: 100000, resteAuSiege: 0, envoisSiege: [],
      statut: 'Validée', directValidation: true, date: '14/11/2026 10:05',
    }
    render(<HistoriqueTable transactions={[V]} />)
    fireEvent.click(within(rangee('Issa KABORE')).getByTestId('supprimer-historique'))
    await screen.findByRole('button', { name: 'Annuler la transaction' })
    expect(document.body.textContent).toMatch(/Les 100\s000 FCFA reçus sortiront du stock ; les 100\s000 FCFA déjà envoyés au siège reviendront au stock\./)
    expect(document.body.textContent).not.toMatch(/Le montant sera rendu aux soldes/)
  })
})
