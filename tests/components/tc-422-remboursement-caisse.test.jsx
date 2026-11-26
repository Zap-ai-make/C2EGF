import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'

/**
 * TC-422 — La caissière voit le remboursement que l'agent a lancé depuis
 * l'app, et y répond (contrat demande-operation v10 §11.3).
 *
 * Un remboursement remonte en tête avec la marque « Remboursement demandé par
 * l’agent », le montant, le mode, et le reste de la ligne visée ; deux gestes,
 * Accepter et Rejeter. La ligne visée reste à sa place, avec les siens.
 */

let contextValue
let demandesMock = []

vi.mock('../../src/context/ThemeContext.jsx', () => ({
  useTheme: () => ({
    themeClasses: { tableHeader: 'bg-gray-100 border-gray-300', tableBorder: 'border-gray-300', text: 'text-gray-900' },
  }),
}))
vi.mock('../../src/context/transactions.jsx', () => ({ useTransactions: () => contextValue }))
vi.mock('../../src/hooks/useSimpleNetworkData', () => ({
  useSimpleNetworkData: () => ({ getStock: () => 400000 }),
}))
vi.mock('../../src/hooks/useDemandesAgent.js', () => ({
  useDemandesAgent: () => ({ demandes: demandesMock }),
}))
const accepter = vi.fn()
const accepterRemboursement = vi.fn()
const rejeter = vi.fn()
vi.mock('../../src/services/demandesAgentService.js', () => ({
  accepterDemandeAgent: (...a) => accepter(...a),
  accepterRemboursementAgent: (...a) => accepterRemboursement(...a),
  rejeterDemandeAgent: (...a) => rejeter(...a),
}))

import TransactionTable from '../../src/components/transactions/TransactionTable.jsx'
import { ligneDeDemande } from '../../src/utils/demandesAgent.js'
import { getAvailableActions, getTransactionStyles } from '../../src/utils/helpers.js'

// La page sépare les milliers par une espace fine insécable ; Testing Library
// la ramène à une espace simple avant de comparer, pas la chaîne attendue.
const fcfa = (n) => n.toLocaleString('fr-FR').replace(/\s/g, ' ')

const CREDIT = {
  id: 'op-1', client: { nom: 'KABORE', prenom: 'Awa' }, clientId: 'c1', type: 'Dépôt', reseau: 'Orange', code: '70123456',
  montant: 100_000, paidAmount: 40_000, remainingAmount: 60_000, settlementStatus: 'partial',
  statut: 'Non Terminées', date: '26/11/2026 08:00',
}

const demande = (id, extra = {}) => ligneDeDemande(id, {
  clientId: 'c1', agent: { nom: 'KABORE', prenom: 'Awa', code: '70123456' },
  sens: 'depot', reseau: 'Orange', montant: 5000, etat: 'en_attente', creeLe: new Date(2026, 10, 26, 10, 0),
  nature: 'remboursement', cibleId: 'op-1', mode: 'Cash', ...extra,
})

const contexte = (pendingTransactions) => ({
  pendingTransactions,
  completedTransactions: [],
  loading: false,
  getActionButtons: (t) => getAvailableActions(t.type),
  getTransactionStyles,
  addPaymentTranche: vi.fn(),
  addRefundTranche: vi.fn(),
  startEditTransaction: vi.fn(),
  trashTransaction: vi.fn(),
  envoyerAuSiege: vi.fn(),
})

const rangee = (id) => screen.getByTestId(`demande-agent-${id}`)
const boutons = (id) => within(rangee(id)).getAllByRole('button').map((b) => b.textContent)

beforeEach(() => {
  contextValue = contexte([CREDIT])
  demandesMock = [demande('d1')]
  accepter.mockReset().mockResolvedValue({ accepted: true })
  accepterRemboursement.mockReset().mockResolvedValue({ accepted: true })
  rejeter.mockReset().mockResolvedValue({ rejected: true })
})

describe('TC-422 — le remboursement demandé par l’agent', () => {
  it('[TC-422-01] en tête : la marque, le montant, le mode et le reste de la ligne visée ; Accepter et Rejeter seulement', () => {
    render(<TransactionTable />)
    const r = rangee('d1')
    expect(within(r).getByText('Remboursement demandé par l’agent')).toBeInTheDocument()
    expect(within(r).getByText(`${fcfa(5000)} FCFA`)).toBeInTheDocument()
    expect(within(r).getByText('en Cash')).toBeInTheDocument()
    expect(within(r).getByText(`Reste : ${fcfa(60_000)} sur ${fcfa(100_000)} FCFA`)).toBeInTheDocument()
    expect(boutons('d1')).toEqual(['Accepter', 'Rejeter'])
    // La ligne visée reste à sa place, avec ses gestes.
    expect(screen.getAllByRole('button', { name: 'Encaisser' })).toHaveLength(1)
  })

  it('[TC-422-02] « Accepter » règle par le serveur ; « Rejeter » rejette', async () => {
    render(<TransactionTable />)
    fireEvent.click(within(rangee('d1')).getByRole('button', { name: 'Accepter' }))
    await waitFor(() => expect(accepterRemboursement).toHaveBeenCalledWith('d1'))
    expect(accepter).not.toHaveBeenCalled()

    demandesMock = [demande('d2')]
    render(<TransactionTable />)
    fireEvent.click(within(rangee('d2')).getByRole('button', { name: 'Rejeter' }))
    await waitFor(() => expect(rejeter).toHaveBeenCalledWith('d2'))
  })

  it('[TC-422-03] la ligne visée n’est plus là : la demande le dit, les deux gestes restent', () => {
    contextValue = contexte([])
    render(<TransactionTable />)
    expect(within(rangee('d1')).getByText('Cette ligne n’est plus en attente.')).toBeInTheDocument()
    expect(boutons('d1')).toEqual(['Accepter', 'Rejeter'])
  })

  it('[TC-422-04] un remboursement siège se lit « Remb. siège », demande de l’agent, avec son mode', () => {
    demandesMock = [demande('s1', { nature: 'remb_siege', cibleId: undefined, mode: 'Orange Money', montant: 3000 })]
    render(<TransactionTable />)
    const r = rangee('s1')
    expect(within(r).getByText('Remb. siège')).toBeInTheDocument()
    expect(within(r).getByText('Demande de l’agent')).toBeInTheDocument()
    expect(within(r).getByText('en Orange Money')).toBeInTheDocument()
    expect(boutons('s1')).toEqual(['Accepter', 'Rejeter'])
  })

  it('[TC-422-05] une demande d’opération garde ses trois gestes', () => {
    demandesMock = [demande('o1', { nature: undefined, cibleId: undefined, mode: undefined })]
    render(<TransactionTable />)
    expect(boutons('o1')).toEqual(['Non terminée', 'Valider', 'Rejeter'])
    expect(within(rangee('o1')).queryByText(/^en /)).toBeNull()
  })

  it('[TC-422-06] une demande d’avant ce champ est une opération', () => {
    expect(demande('o2', { nature: undefined }).nature).toBe('operation')
    expect(demande('r9')).toMatchObject({ nature: 'remboursement', cibleId: 'op-1', mode: 'Cash', type: 'Dépôt' })
    expect(demande('s9', { nature: 'remb_siege' }).type).toBe('Remb. siège')
  })
})
