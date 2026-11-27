import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, renderHook, screen, act } from '@testing-library/react'

/**
 * TC-423 — Une demande d'agent qui arrive se signale (demandé par
 * l'utilisateur le 2026-11-27) : un petit son, et la ligne qui pulse.
 * Beaucoup de transactions, plusieurs demandes à la fois : la caissière doit
 * voir laquelle vient d'entrer, sans chercher.
 *
 * Ce qui attendait déjà quand l'écran s'ouvre ne sonne pas : c'est en tête,
 * en violet, et le son ne dirait rien de nouveau.
 */

let contextValue
let demandesMock = []
let arriveesMock = new Map()
let liaisonActive = true
let enLigne = true

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
  useDemandesAgent: () => ({ demandes: demandesMock, arrivees: arriveesMock }),
}))
vi.mock('../../src/services/demandesAgentService.js', () => ({
  accepterDemandeAgent: vi.fn(),
  accepterRemboursementAgent: vi.fn(),
  rejeterDemandeAgent: vi.fn(),
}))
const sonner = vi.fn()
vi.mock('../../src/utils/sonDemande.js', () => ({ sonnerDemande: (...a) => sonner(...a) }))
const abonner = vi.fn()
vi.mock('../../src/services/firestore.js', () => ({
  firestoreService: { subscribeToCollection: (...a) => abonner(...a) },
}))
vi.mock('../../src/services/liaisonOxygenService.js', () => ({
  get LIAISON_OXYGEN_ACTIVE() { return liaisonActive },
}))
vi.mock('../../src/hooks/useEnLigne.js', () => ({ useEnLigne: () => enLigne }))
vi.mock('../../src/context/AuthContext.jsx', async () => {
  const { createContext } = await import('react')
  return { AuthContext: createContext(null) }
})

import TransactionTable from '../../src/components/transactions/TransactionTable.jsx'
import { AuthContext } from '../../src/context/AuthContext.jsx'
import { ligneDeDemande, PULSATION_MS } from '../../src/utils/demandesAgent.js'
import { getAvailableActions, getTransactionStyles } from '../../src/utils/helpers.js'

const H = (heure, minute = 0) => new Date(2026, 10, 27, heure, minute)

beforeEach(() => {
  vi.useFakeTimers({ now: H(10, 30) })
  sonner.mockReset()
  abonner.mockReset().mockReturnValue(() => {})
  liaisonActive = true
  enLigne = true
})
afterEach(() => { vi.useRealTimers() })

describe('TC-423 — l’écoute repère ce qui arrive', () => {
  let useDemandesAgent
  beforeEach(async () => {
    ({ useDemandesAgent } = await vi.importActual('../../src/hooks/useDemandesAgent.js'))
  })
  const SERVEUR = { depuisServeur: true }
  const CACHE = { depuisServeur: false }
  const lue = (id, heure) => ({ id, clientId: `c-${id}`, agent: {}, sens: 'depot', montant: 1, creeLe: H(heure) })
  let auth
  const monter = () => {
    auth = { userProfile: { storeId: 's1' }, activeStore: { id: 's1' } }
    return renderHook(() => useDemandesAgent(), {
      wrapper: ({ children }) => <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>,
    })
  }
  const observateur = (n = 0) => abonner.mock.calls[n][1]
  const arrivees = (result) => [...result.current.arrivees.keys()]

  it('[TC-423-05] ce qui attend à l’ouverture ne sonne pas ; ce qui arrive ensuite sonne une fois, et se marque', () => {
    const { result } = monter()
    act(() => observateur()([lue('d1', 9)], [], SERVEUR))
    expect(sonner).not.toHaveBeenCalled()
    expect(arrivees(result)).toEqual([])

    act(() => observateur()([lue('d1', 9), lue('d2', 10)], [], SERVEUR))
    expect(sonner).toHaveBeenCalledTimes(1)
    expect(arrivees(result)).toEqual(['d2'])
    expect(result.current.arrivees.get('d2')).toBe(H(10, 30).getTime())
  })

  it('[TC-423-06] trois demandes dans la même réponse : un seul son, toutes trois marquées', () => {
    const { result } = monter()
    act(() => observateur()([], [], SERVEUR))
    act(() => observateur()([lue('d1', 10), lue('d2', 10), lue('d3', 10)], [], SERVEUR))
    expect(sonner).toHaveBeenCalledTimes(1)
    expect(arrivees(result).sort()).toEqual(['d1', 'd2', 'd3'])
  })

  it('[TC-423-07] le cache de l’appareil ne fait jamais sonner : seul le serveur dit qu’une demande est arrivée', () => {
    const { result } = monter()
    act(() => observateur()([lue('d1', 9)], [], SERVEUR))
    act(() => observateur()([lue('d1', 9), lue('d9', 10)], [], CACHE))
    expect(sonner).not.toHaveBeenCalled()
    act(() => observateur()([lue('d1', 9), lue('d9', 10)], [], SERVEUR))
    expect(sonner).toHaveBeenCalledTimes(1)
    expect(arrivees(result)).toEqual(['d9'])
  })

  it('[TC-423-08] une demande arrivée pendant une coupure sonne au retour du réseau', () => {
    const { result, rerender } = monter()
    act(() => observateur()([lue('d1', 9)], [], SERVEUR))
    enLigne = false
    rerender()
    enLigne = true
    rerender()
    expect(abonner).toHaveBeenCalledTimes(2)
    act(() => observateur(1)([lue('d1', 9), lue('d2', 10)], [], SERVEUR))
    expect(sonner).toHaveBeenCalledTimes(1)
    expect(arrivees(result)).toEqual(['d2'])
  })

  it('[TC-423-08b] une autre boutique : ce qui y attend déjà ne sonne pas', () => {
    const { rerender } = monter()
    act(() => observateur()([lue('d1', 9)], [], SERVEUR))
    auth = { userProfile: { storeId: 's2' }, activeStore: { id: 's2' } }
    rerender()
    act(() => observateur(1)([lue('d5', 9)], [], SERVEUR))
    expect(sonner).not.toHaveBeenCalled()
  })
})

describe('TC-423 — la ligne qui vient d’arriver pulse', () => {
  const CREDIT = {
    id: 'op-1', client: { nom: 'KABORE', prenom: 'Awa' }, clientId: 'c1', type: 'Dépôt', reseau: 'Orange', code: '70123456',
    montant: 100_000, paidAmount: 40_000, remainingAmount: 60_000, settlementStatus: 'partial',
    statut: 'Non Terminées', date: '27/11/2026 08:00',
  }
  const demande = (id, extra = {}) => ligneDeDemande(id, {
    clientId: `c-${id}`, agent: { nom: 'SANOU', prenom: 'Issa', code: '7654321' },
    sens: 'depot', reseau: 'Orange', montant: 50000, etat: 'en_attente', creeLe: H(10), ...extra,
  })
  // Avec son préfixe, jamais nu : Tailwind lit aussi les tests (TC-094).
  const PULSE = 'motion-safe:animate-arrivee-demande'

  beforeEach(() => {
    contextValue = {
      pendingTransactions: [CREDIT],
      completedTransactions: [],
      loading: false,
      getActionButtons: (t) => getAvailableActions(t.type),
      getTransactionStyles,
      addPaymentTranche: vi.fn(),
      addRefundTranche: vi.fn(),
      startEditTransaction: vi.fn(),
      trashTransaction: vi.fn(),
      envoyerAuSiege: vi.fn(),
    }
  })

  it('[TC-423-09] la demande qui vient d’arriver pulse, celle qui attendait non ; au bout de 20 s, plus rien ne pulse', () => {
    demandesMock = [demande('d1'), demande('d2')]
    arriveesMock = new Map([['d2', Date.now()]])
    render(<TransactionTable />)
    expect(screen.getByTestId('demande-agent-d2').className).toContain(PULSE)
    expect(screen.getByTestId('demande-agent-d1').className).not.toContain(PULSE)

    act(() => { vi.advanceTimersByTime(PULSATION_MS - 1000) })
    expect(screen.getByTestId('demande-agent-d2').className).toContain(PULSE)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.getByTestId('demande-agent-d2').className).not.toContain(PULSE)
  })

  it('[TC-423-10] un remboursement qui arrive pulse sous la ligne qu’il règle, la ligne elle-même non', () => {
    demandesMock = [demande('r1', { nature: 'remboursement', cibleId: 'op-1', mode: 'Cash', clientId: 'c1' })]
    arriveesMock = new Map([['r1', Date.now()]])
    render(<TransactionTable />)
    expect(screen.getByTestId('remboursement-agent-r1').className).toContain(PULSE)
    const ligneVisee = document.querySelector('tbody tr')
    expect(ligneVisee.className).not.toContain(PULSE)
  })
})
