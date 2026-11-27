import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'

/**
 * TC-422 — La caissière voit le remboursement que l'agent a lancé depuis
 * l'app, et y répond (contrat demande-operation v10 §11.3).
 *
 * LA LIGNE VISÉE REMONTE ELLE-MÊME, une seule fois, avec ses gestes (§11.3 :
 * « Encaisser » et « Modifier » restent possibles) ; juste sous elle, chaque
 * remboursement demandé : la marque, le montant, le mode, Accepter et Rejeter.
 * Pas de doublon de la ligne (demandé par l'utilisateur le 2026-11-27).
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
import { encaisseApres, ligneDeDemande } from '../../src/utils/demandesAgent.js'
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
const sousLigne = (id) => screen.getByTestId(`remboursement-agent-${id}`)
const gestesSousLigne = (id) => within(sousLigne(id)).getAllByRole('button').map((b) => b.textContent)
const rangeesDuCorps = () => [...document.querySelectorAll('tbody tr')]

beforeEach(() => {
  contextValue = contexte([CREDIT])
  demandesMock = [demande('d1')]
  accepter.mockReset().mockResolvedValue({ accepted: true })
  accepterRemboursement.mockReset().mockResolvedValue({ accepted: true })
  rejeter.mockReset().mockResolvedValue({ rejected: true })
})

describe('TC-422 — le remboursement demandé par l’agent', () => {
  it('[TC-422-01] la ligne visée remonte en tête, une seule fois, et la demande se lit juste dessous', () => {
    contextValue = contexte([{ ...CREDIT, id: 'autre', clientId: 'c9', client: { nom: 'SANOU', prenom: 'Issa' } }, CREDIT])
    render(<TransactionTable />)
    const [premiere, seconde] = rangeesDuCorps()
    expect(within(premiere).getByText(/KABORE/)).toBeInTheDocument()
    expect(within(premiere).getByText(`Reste : ${fcfa(60_000)} FCFA`)).toBeInTheDocument()
    expect(seconde).toBe(sousLigne('d1'))

    const sous = sousLigne('d1')
    expect(within(sous).getByText('Remboursement demandé par l’agent')).toBeInTheDocument()
    expect(within(sous).getByText(`${fcfa(5000)} FCFA`)).toBeInTheDocument()
    expect(within(sous).getByText('en Cash')).toBeInTheDocument()
    expect(gestesSousLigne('d1')).toEqual(['Accepter', 'Rejeter'])

    // Aucun doublon : la ligne n'apparaît qu'une fois, avec ses gestes à elle.
    expect(screen.getAllByText(/KABORE/)).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Encaisser' })).toHaveLength(2)
    expect(screen.queryByTestId('demande-agent-d1')).toBeNull()
  })

  it('[TC-422-01b] deux remboursements sur la même ligne : la ligne une fois, une demande sous elle par mode', () => {
    demandesMock = [demande('d1'), demande('d2', { mode: 'Orange Money', montant: 7000 })]
    render(<TransactionTable />)
    expect(screen.getAllByText(/KABORE/)).toHaveLength(1)
    expect(within(sousLigne('d1')).getByText('en Cash')).toBeInTheDocument()
    expect(within(sousLigne('d2')).getByText('en Orange Money')).toBeInTheDocument()
  })

  it('[TC-422-01c] sous un filtre, la ligne visée reste en tête, et n’est pas comptée parmi les cachées', () => {
    contextValue = contexte([CREDIT, { ...CREDIT, id: 'r-1', type: 'Retrait', clientId: 'c9', client: { nom: 'SANOU', prenom: 'Issa' }, paidAmount: undefined, remainingAmount: undefined, settlementStatus: undefined }])
    render(<TransactionTable />)
    fireEvent.click(screen.getByTestId('case-retraits-non-terminees'))
    expect(screen.getByText(/KABORE/)).toBeInTheDocument()
    expect(sousLigne('d1')).toBeInTheDocument()
    expect(screen.queryByTestId('lignes-cachees')).toBeNull()
  })

  it('[TC-422-02] « Accepter » règle par le serveur ; « Rejeter » rejette', async () => {
    demandesMock = [demande('d1'), demande('d2', { mode: 'Orange Money' })]
    render(<TransactionTable />)
    fireEvent.click(within(sousLigne('d1')).getByRole('button', { name: 'Accepter' }))
    await waitFor(() => expect(accepterRemboursement).toHaveBeenCalledWith('d1'))
    expect(accepter).not.toHaveBeenCalled()
    fireEvent.click(within(sousLigne('d2')).getByRole('button', { name: 'Rejeter' }))
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

  it('[TC-422-07] la ligne a reçu une tranche après la demande : « Encaissé à … ? », un signal, pas un blocage', () => {
    const tranche = (heure, minute) => ({ montant: 5000, mode: 'Cash', le: new Date(2026, 10, 26, heure, minute) })
    contextValue = contexte([{ ...CREDIT, reglements: [tranche(9, 0), tranche(10, 20)] }])
    render(<TransactionTable />)
    expect(within(sousLigne('d1')).getByText('Encaissé à 10:20 ?')).toBeInTheDocument()
    expect(gestesSousLigne('d1')).toEqual(['Accepter', 'Rejeter'])
  })

  it('[TC-422-08] encaisseApres : la première tranche venue après la demande, sinon rien', () => {
    const d = demande('d1')
    const le = (heure) => new Date(2026, 10, 26, heure, 0)
    expect(encaisseApres(d, { reglements: [{ le: le(9) }] })).toBeNull()
    expect(encaisseApres(d, { reglements: [{ le: le(9) }, { le: le(11) }, { le: le(12) }] })).toBe(le(11).getTime())
    expect(encaisseApres(d, { reglements: [{ le: { toMillis: () => le(11).getTime() } }] })).toBe(le(11).getTime())
    expect(encaisseApres(d, {})).toBeNull()
    expect(encaisseApres(d, null)).toBeNull()
  })

  it('[TC-422-08b] la tranche d’une demande sœur acceptée n’est pas un encaissement au comptoir', () => {
    // Une demande par mode : Orange Money acceptée à 11 h, la demande Cash
    // attend encore dessous. Elle ne doit pas dire « Encaissé à 11:00 ? ».
    const d = demande('d1')
    const le = (heure) => new Date(2026, 10, 26, heure, 0)
    expect(encaisseApres(d, { reglements: [{ le: le(11), demandeId: 'r-om' }] })).toBeNull()
    expect(encaisseApres(d, { reglements: [{ le: le(11), demandeId: 'r-om' }, { le: le(12) }] })).toBe(le(12).getTime())
  })

  it('[TC-422-09] la plus ancienne demande d’abord, qu’elle ait sa ligne ou non', () => {
    const OP2 = { ...CREDIT, id: 'op-2', clientId: 'c2', client: { nom: 'SANOU', prenom: 'Issa' } }
    contextValue = contexte([CREDIT, OP2])
    const a = (heure) => ({ creeLe: new Date(2026, 10, 26, heure, 0) })
    demandesMock = [
      demande('rA', { cibleId: 'op-1', ...a(10) }),
      demande('rB', { cibleId: 'op-2', clientId: 'c2', ...a(9) }),
      demande('dC', { nature: 'operation', cibleId: undefined, mode: undefined, clientId: 'c3', ...a(11) }),
    ]
    render(<TransactionTable />)
    const ordre = rangeesDuCorps().slice(0, 5).map((r) => r.dataset.testid ?? r.textContent.match(/KABORE|SANOU/)?.[0])
    expect(ordre).toEqual(['SANOU', 'remboursement-agent-rB', 'KABORE', 'remboursement-agent-rA', 'demande-agent-dC'])
  })

  it('[TC-422-06] une demande d’avant ce champ est une opération', () => {
    expect(demande('o2', { nature: undefined }).nature).toBe('operation')
    expect(demande('r9')).toMatchObject({ nature: 'remboursement', cibleId: 'op-1', mode: 'Cash', type: 'Dépôt' })
    expect(demande('s9', { nature: 'remb_siege' }).type).toBe('Remb. siège')
  })
})
