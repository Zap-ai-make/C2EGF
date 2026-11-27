import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, renderHook, screen, act, fireEvent } from '@testing-library/react'

/**
 * TC-423 — Une demande d'agent qui arrive se signale (demandé par
 * l'utilisateur le 2026-11-27) : un petit son, et la ligne qui pulse.
 * Beaucoup de transactions, plusieurs demandes à la fois : la caissière doit
 * voir laquelle vient d'entrer, sans chercher.
 *
 * Ce qui attendait déjà à l'ouverture de la session ne sonne pas : c'est en
 * tête, en violet, et le son ne dirait rien de nouveau.
 *
 * LES 20 S SE COMPTENT DEVANT LA CAISSIÈRE (correction de l'utilisateur, le
 * même jour) : un écran en veille qui clignote 20 s ne sert à rien. La ligne
 * pulse jusqu'à son premier geste sur l'écran, puis 20 s.
 */

let contextValue
let demandesMock = []
let arriveesMock = new Map()
let marquerVuesMock = vi.fn()
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
  useDemandesAgent: () => ({ demandes: demandesMock, arrivees: arriveesMock, marquerVues: marquerVuesMock }),
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
import { DemandesAgentProvider } from '../../src/context/DemandesAgentContext.jsx'
import { ligneDeDemande, PULSATION_MS } from '../../src/utils/demandesAgent.js'
import { getAvailableActions, getTransactionStyles } from '../../src/utils/helpers.js'

const H = (heure, minute = 0) => new Date(2026, 10, 27, heure, minute)
const SERVEUR = { depuisServeur: true }
const CACHE = { depuisServeur: false }
const lue = (id, heure) => ({ id, clientId: `c-${id}`, agent: {}, sens: 'depot', montant: 1, creeLe: H(heure) })
const observateur = (n = 0) => abonner.mock.calls[n][1]

beforeEach(() => {
  vi.useFakeTimers({ now: H(10, 30) })
  sonner.mockReset()
  abonner.mockReset().mockReturnValue(() => {})
  marquerVuesMock = vi.fn()
  liaisonActive = true
  enLigne = true
})
afterEach(() => { vi.useRealTimers() })

describe('TC-423 — l’écoute repère ce qui arrive', () => {
  let useEcouteDemandesAgent
  beforeEach(async () => {
    ({ useEcouteDemandesAgent } = await vi.importActual('../../src/hooks/useEcouteDemandesAgent.js'))
  })
  let auth
  const monter = () => {
    auth = { userProfile: { storeId: 's1' }, activeStore: { id: 's1' } }
    return renderHook(() => useEcouteDemandesAgent(), {
      wrapper: ({ children }) => <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>,
    })
  }
  const arrivees = (result) => [...result.current.arrivees.keys()]

  it('[TC-423-05] ce qui attend à l’ouverture ne sonne pas ; ce qui arrive ensuite sonne une fois, et se marque', () => {
    const { result } = monter()
    act(() => observateur()([lue('d1', 9)], [], SERVEUR))
    expect(sonner).not.toHaveBeenCalled()
    expect(arrivees(result)).toEqual([])

    act(() => observateur()([lue('d1', 9), lue('d2', 10)], [], SERVEUR))
    expect(sonner).toHaveBeenCalledTimes(1)
    expect(arrivees(result)).toEqual(['d2'])
    // Arrivée, pas encore vue : le décompte n'a pas commencé.
    expect(result.current.arrivees.get('d2')).toEqual({ le: H(10, 30).getTime(), vueLe: null })
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

  it('[TC-423-08c] une autre caissière se connecte sur la même boutique : ce qui attendait ne sonne pas, ne pulse pas', () => {
    const { result, rerender } = monter()
    act(() => observateur()([lue('d1', 9)], [], SERVEUR))
    act(() => observateur()([lue('d1', 9), lue('d2', 10)], [], SERVEUR))
    expect(sonner).toHaveBeenCalledTimes(1)
    auth = null
    rerender()
    auth = { userProfile: { storeId: 's1' }, activeStore: { id: 's1' } }
    rerender()
    act(() => observateur(1)([lue('d1', 9), lue('d2', 10), lue('d3', 10)], [], SERVEUR))
    expect(sonner).toHaveBeenCalledTimes(1)
    expect(result.current.arrivees.size).toBe(0)
  })

  it('[TC-423-12] vue par la caissière : le décompte part pour ce qui attendait son regard, pas pour ce qui arrive après', () => {
    const { result } = monter()
    act(() => observateur()([], [], SERVEUR))
    act(() => observateur()([lue('d2', 10)], [], SERVEUR))
    act(() => { vi.advanceTimersByTime(60_000) })
    act(() => result.current.marquerVues())
    const vueLe = H(10, 31).getTime()
    expect(result.current.arrivees.get('d2').vueLe).toBe(vueLe)

    act(() => { vi.advanceTimersByTime(5_000) })
    act(() => observateur()([lue('d2', 10), lue('d3', 10)], [], SERVEUR))
    expect(result.current.arrivees.get('d3').vueLe).toBeNull()
    act(() => { vi.advanceTimersByTime(5_000) })
    act(() => result.current.marquerVues())
    expect(result.current.arrivees.get('d2').vueLe).toBe(vueLe)
    expect(result.current.arrivees.get('d3').vueLe).toBe(vueLe + 10_000)
  })

  it('[TC-423-13] une seule écoute pour toute la session, partagée par la barre et le tableau', async () => {
    const { useDemandesAgent: lire } = await vi.importActual('../../src/hooks/useDemandesAgent.js')
    const Compte = ({ testId }) => <span data-testid={testId}>{lire().demandes.length}</span>
    auth = { userProfile: { storeId: 's1' }, activeStore: { id: 's1' } }
    render(
      <AuthContext.Provider value={auth}>
        <DemandesAgentProvider>
          <Compte testId="barre" />
          <Compte testId="tableau" />
        </DemandesAgentProvider>
      </AuthContext.Provider>,
    )
    expect(abonner).toHaveBeenCalledTimes(1)
    act(() => observateur()([lue('d1', 9), lue('d2', 10)], [], SERVEUR))
    expect(screen.getByTestId('barre')).toHaveTextContent('2')
    expect(screen.getByTestId('tableau')).toHaveTextContent('2')
  })

  it('[TC-423-13b] hors du fournisseur : aucune demande, et rien ne casse', async () => {
    const { useDemandesAgent: lire } = await vi.importActual('../../src/hooks/useDemandesAgent.js')
    const { result } = renderHook(() => lire())
    expect(result.current.demandes).toEqual([])
    expect(result.current.arrivees.size).toBe(0)
    expect(() => result.current.marquerVues()).not.toThrow()
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
  const pulse = (testId) => screen.getByTestId(testId).className.includes(PULSE)

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
    demandesMock = [demande('d1'), demande('d2')]
  })
  afterEach(() => {
    Reflect.deleteProperty(document, 'visibilityState')
  })

  it('[TC-423-09] tant que la caissière n’a pas touché l’écran, la demande arrivée pulse — une heure après encore ; celle qui attendait, non', () => {
    arriveesMock = new Map([['d2', { le: Date.now(), vueLe: null }]])
    render(<TransactionTable />)
    expect(pulse('demande-agent-d2')).toBe(true)
    expect(pulse('demande-agent-d1')).toBe(false)
    act(() => { vi.advanceTimersByTime(60 * 60_000) })
    expect(pulse('demande-agent-d2')).toBe(true)
  })

  it('[TC-423-09b] vue par la caissière : encore 20 s, puis plus rien', () => {
    arriveesMock = new Map([['d2', { le: Date.now() - 600_000, vueLe: Date.now() }]])
    render(<TransactionTable />)
    act(() => { vi.advanceTimersByTime(PULSATION_MS - 1000) })
    expect(pulse('demande-agent-d2')).toBe(true)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(pulse('demande-agent-d2')).toBe(false)
  })

  it('[TC-423-10] un remboursement qui arrive pulse sous la ligne qu’il règle, la ligne elle-même non', () => {
    demandesMock = [demande('r1', { nature: 'remboursement', cibleId: 'op-1', mode: 'Cash', clientId: 'c1' })]
    arriveesMock = new Map([['r1', { le: Date.now(), vueLe: null }]])
    render(<TransactionTable />)
    expect(pulse('remboursement-agent-r1')).toBe(true)
    expect(document.querySelector('tbody tr').className).not.toContain(PULSE)
  })

  it('[TC-423-11] le premier geste de la caissière sur l’écran lance le décompte', () => {
    arriveesMock = new Map([['d2', { le: Date.now(), vueLe: null }]])
    render(<TransactionTable />)
    expect(marquerVuesMock).not.toHaveBeenCalled()
    fireEvent.pointerMove(window)
    expect(marquerVuesMock).toHaveBeenCalledTimes(1)
  })

  it('[TC-423-11b] l’écran caché (veille, autre fenêtre) : une touche ne compte pas', () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    arriveesMock = new Map([['d2', { le: Date.now(), vueLe: null }]])
    render(<TransactionTable />)
    fireEvent.keyDown(window, { key: 'a' })
    expect(marquerVuesMock).not.toHaveBeenCalled()
  })

  it('[TC-423-11c] rien qui attende son regard : ses gestes ne déclenchent rien', () => {
    arriveesMock = new Map([['d2', { le: Date.now(), vueLe: Date.now() }]])
    render(<TransactionTable />)
    fireEvent.pointerDown(window)
    expect(marquerVuesMock).not.toHaveBeenCalled()
  })
})
