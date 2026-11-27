import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, renderHook, screen, fireEvent, within, act, waitFor } from '@testing-library/react'

/**
 * TC-397 — Les demandes d'agent dans le tableau des non terminées (maquette B,
 * choisie le 2026-11-17), et l'écoute qui les amène
 * (docs/superpowers/specs/2026-11-17-demandes-agent-design.md §5.5).
 *
 * Décidé par l'utilisateur : les demandes arrivent DANS le tableau, en tête,
 * en violet, avec trois gestes — Non terminée, Valider, Rejeter. Elles ne
 * comptent ni dans les cases, ni dans les lignes cachées par un filtre.
 */

let contextValue
let demandesMock = []
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
  useDemandesAgent: () => ({ demandes: demandesMock }),
}))
const accepter = vi.fn()
const rejeter = vi.fn()
vi.mock('../../src/services/demandesAgentService.js', () => ({
  accepterDemandeAgent: (...a) => accepter(...a),
  accepterRemboursementAgent: vi.fn(),
  rejeterDemandeAgent: (...a) => rejeter(...a),
}))
// Pour l'écoute elle-même (TC-397-08 à 10).
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
import { ligneDeDemande } from '../../src/utils/demandesAgent.js'
import { getAvailableActions, getTransactionStyles } from '../../src/utils/helpers.js'

const H = (heure, minute = 0) => new Date(2026, 10, 17, heure, minute)

const ligne = (id, nom, type, extra = {}) => ({
  id, client: { nom, prenom: 'Awa' }, clientId: `c-${nom}`, type, reseau: 'Orange', code: '1234567',
  montant: 100000, statut: 'Non Terminées', date: '17/11/2026 08:00', ...extra,
})
const D1 = ligne('D1', 'OUEDRAOGO', 'Dépôt')
const R1 = ligne('R1', 'SANOU', 'Retrait')

const demande = (id, nom, sens, extra = {}) => ligneDeDemande(id, {
  clientId: `c-${nom}`, agent: { nom, prenom: 'Issa', code: '7654321' },
  sens, reseau: 'Orange', montant: 50000, etat: 'en_attente', creeLe: H(10, 34), ...extra,
})

const contexte = (pendingTransactions, completedTransactions = []) => ({
  pendingTransactions,
  completedTransactions,
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
const geste = (id, nom) => within(rangee(id)).getByRole('button', { name: nom })

beforeEach(() => {
  contextValue = contexte([R1])
  demandesMock = [demande('d1', 'KABORE', 'depot')]
  accepter.mockReset().mockResolvedValue({ accepted: true })
  rejeter.mockReset().mockResolvedValue({ rejected: true })
  abonner.mockReset().mockReturnValue(() => {})
  liaisonActive = true
  enLigne = true
})

describe('TC-397 — les demandes dans le tableau', () => {
  it('[TC-397-01] la demande vient en tête, dit qu’elle vient de l’agent, et la case Tout ne la compte pas', () => {
    render(<TransactionTable />)
    const ligneDemande = rangee('d1')
    expect(ligneDemande).toHaveTextContent('Demande de l’agent')
    expect(ligneDemande).toHaveTextContent('Issa KABORE')
    expect(ligneDemande).toHaveTextContent('7654321')
    expect(ligneDemande).toHaveTextContent(/50\s000 FCFA/)
    expect(ligneDemande).toHaveTextContent('Dépôt')
    expect(screen.getByTestId('nombre-tout-non-terminees')).toHaveTextContent('1')
    const rangees = screen.getAllByRole('row')
    const sanou = rangees.findIndex((r) => r.textContent.includes('SANOU'))
    expect(rangees.indexOf(ligneDemande)).toBeLessThan(sanou)
  })

  it('[TC-397-02] sous un filtre, la demande reste visible et ne compte pas parmi les lignes cachées', () => {
    contextValue = contexte([D1, R1])
    render(<TransactionTable />)
    fireEvent.click(screen.getByTestId('case-retraits-non-terminees'))
    expect(rangee('d1')).toBeInTheDocument()
    expect(screen.getByText(/1 autre opération cachée/)).toBeInTheDocument()
  })

  it('[TC-397-03] Valider, Non terminée et Rejeter envoient chacun leur geste', async () => {
    demandesMock = [demande('d1', 'KABORE', 'depot'), demande('d2', 'ZONGO', 'retrait'), demande('d3', 'TRAORE', 'depot')]
    render(<TransactionTable />)
    fireEvent.click(geste('d1', 'Valider'))
    await waitFor(() => expect(accepter).toHaveBeenCalledWith('d1', 'Validée'))
    fireEvent.click(geste('d2', 'Non terminée'))
    await waitFor(() => expect(accepter).toHaveBeenLastCalledWith('d2', 'Non Terminées'))
    fireEvent.click(geste('d3', 'Rejeter'))
    await waitFor(() => expect(rejeter).toHaveBeenCalledWith('d3'))
  })

  it('[TC-397-04] pendant l’appel, les trois gestes de la ligne se grisent ; la réponse reçue, la ligne part sans attendre l’écoute', async () => {
    let finir
    accepter.mockReturnValue(new Promise((resolve) => { finir = resolve }))
    render(<TransactionTable />)
    fireEvent.click(geste('d1', 'Valider'))
    const boutons = within(rangee('d1')).getAllByRole('button')
    expect(boutons).toHaveLength(3)
    for (const bouton of boutons) expect(bouton).toBeDisabled()
    expect(boutons.map((b) => b.textContent)).toContain('…')
    await act(async () => { finir({ accepted: true }) })
    // L'écoute (demandesMock) la liste encore : la caissière ne doit pas
    // pouvoir répondre une deuxième fois dans l'intervalle.
    expect(screen.queryByTestId('demande-agent-d1')).toBeNull()
    expect(accepter).toHaveBeenCalledTimes(1)
  })

  it('[TC-397-12] une réponse qui part ne bloque pas les autres demandes', async () => {
    accepter.mockReturnValue(new Promise(() => {}))
    demandesMock = [demande('d1', 'KABORE', 'depot'), demande('d2', 'ZONGO', 'retrait')]
    render(<TransactionTable />)
    fireEvent.click(geste('d1', 'Valider'))
    expect(geste('d2', 'Rejeter')).not.toBeDisabled()
    fireEvent.click(geste('d2', 'Rejeter'))
    await waitFor(() => expect(rejeter).toHaveBeenCalledWith('d2'))
    // Un deuxième clic sur la ligne qui attend sa réponse ne repart pas.
    fireEvent.click(within(rangee('d1')).getAllByRole('button')[1])
    expect(accepter).toHaveBeenCalledTimes(1)
  })

  it('[TC-397-05] seulement des demandes : pas d’état vide', () => {
    contextValue = contexte([])
    render(<TransactionTable />)
    expect(rangee('d1')).toBeInTheDocument()
    expect(screen.queryByText('Aucune transaction en attente')).toBeNull()
  })

  it('[TC-397-06] une opération identique saisie depuis la demande la signale', () => {
    contextValue = contexte([ligne('R2', 'KABORE', 'Retrait', { montant: 50000, createdAt: H(10, 51) })])
    demandesMock = [demande('d1', 'KABORE', 'retrait')]
    render(<TransactionTable />)
    expect(rangee('d1')).toHaveTextContent(/Déjà saisi à 10:51 \?/)
  })

  it('[TC-397-07] un refus du serveur s’affiche, et la demande reste', async () => {
    accepter.mockRejectedValue(new Error('Solde insuffisant. Disponible : 40 000 FCFA'))
    render(<TransactionTable />)
    fireEvent.click(geste('d1', 'Valider'))
    expect(await screen.findByText(/Solde insuffisant\. Disponible : 40 000 FCFA/)).toBeInTheDocument()
    expect(rangee('d1')).toBeInTheDocument()
  })
})

describe('TC-397 — l’écoute des demandes', () => {
  let useDemandesAgent
  beforeEach(async () => {
    ({ useEcouteDemandesAgent: useDemandesAgent } = await vi.importActual('../../src/hooks/useEcouteDemandesAgent.js'))
  })
  const auth = { userProfile: { storeId: 's1' }, activeStore: { id: 's1' } }
  const SERVEUR = { depuisServeur: true }
  const monter = (valeur = auth) => renderHook(() => useDemandesAgent(), {
    wrapper: ({ children }) => <AuthContext.Provider value={valeur}>{children}</AuthContext.Provider>,
  })

  it('[TC-397-08] une seule écoute, sur les demandes en attente de la boutique, et seulement si le profil l’ouvre', () => {
    liaisonActive = false
    monter()
    expect(abonner).not.toHaveBeenCalled()

    liaisonActive = true
    const { result } = monter()
    expect(abonner).toHaveBeenCalledTimes(1)
    const [collection, observer, options] = abonner.mock.calls[0]
    expect(collection).toBe('demandesAgent')
    expect(options).toEqual({ where: [{ field: 'etat', operator: '==', value: 'en_attente' }], limitCount: 200, includeMetadataChanges: true })
    act(() => observer([
      { id: 'd2', clientId: 'c2', agent: { nom: 'B' }, sens: 'retrait', montant: 1, creeLe: H(11) },
      { id: 'd1', clientId: 'c1', agent: { nom: 'A' }, sens: 'depot', montant: 1, creeLe: H(10) },
    ], [], SERVEUR))
    expect(result.current.demandes.map((d) => d.id)).toEqual(['d1', 'd2'])
  })

  it('[TC-397-09] hors ligne : aucune demande, aucune écoute', () => {
    enLigne = false
    const { result } = monter()
    expect(abonner).not.toHaveBeenCalled()
    expect(result.current.demandes).toEqual([])
  })

  it('[TC-397-10] une écoute refusée (règle pas encore déployée) se tait : aucune demande', () => {
    const { result } = monter()
    const observer = abonner.mock.calls[0][1]
    act(() => observer([{ id: 'd1', clientId: 'c1', agent: {}, sens: 'depot', montant: 1, creeLe: H(10) }], [], SERVEUR))
    expect(result.current.demandes).toHaveLength(1)
    act(() => observer.onError(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })))
    expect(result.current.demandes).toEqual([])
  })

  describe('le cache de l’appareil', () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })
    const CACHE = { depuisServeur: false }
    const lue = (id, heure) => ({ id, clientId: `c-${id}`, agent: {}, sens: 'depot', montant: 1, creeLe: H(heure) })
    const ids = (result) => result.current.demandes.map((d) => d.id)

    it('[TC-397-11] ce que l’appareil a gardé ne s’affiche pas : seul le serveur dit qu’une demande attend encore', () => {
      // navigator.onLine ment sur un Wi-Fi sans internet : le cache montrerait
      // des demandes que l'agent a peut-être annulées depuis.
      const { result } = monter()
      const observer = abonner.mock.calls[0][1]
      act(() => observer([lue('d1', 10)], [], CACHE))
      expect(ids(result)).toEqual([])
      act(() => { vi.advanceTimersByTime(60_000) })
      expect(ids(result)).toEqual([])
      act(() => observer([lue('d1', 10)], [], SERVEUR))
      expect(ids(result)).toEqual(['d1'])
    })

    it('[TC-397-13] quand une autre demande se ferme, le cache répond un instant : les autres restent, sans clignoter', () => {
      // Vu à l'essai réel du 17 novembre : ~300 ms de réponse du cache à chaque
      // fermeture, et le tableau entier se vidait sous le doigt de la caissière.
      const { result } = monter()
      const observer = abonner.mock.calls[0][1]
      act(() => observer([lue('d1', 10), lue('d2', 11)], [], SERVEUR))
      act(() => observer([lue('d2', 11), lue('d9', 9)], [], CACHE))
      // Le cache retire d1 (fermée), n'ajoute pas d9 (jamais confirmée).
      expect(ids(result)).toEqual(['d2'])
      act(() => { vi.advanceTimersByTime(300) })
      act(() => observer([lue('d2', 11)], [], SERVEUR))
      act(() => { vi.advanceTimersByTime(60_000) })
      expect(ids(result)).toEqual(['d2'])
    })

    it('[TC-397-14] la connexion tombe sans que le poste le sache : passé 10 s sans le serveur, les lignes partent', () => {
      const { result } = monter()
      const observer = abonner.mock.calls[0][1]
      act(() => observer([lue('d1', 10)], [], SERVEUR))
      act(() => observer([lue('d1', 10)], [], CACHE))
      act(() => { vi.advanceTimersByTime(9_999) })
      expect(ids(result)).toEqual(['d1'])
      // Une deuxième réponse du cache ne relance pas l'attente.
      act(() => observer([lue('d1', 10)], [], CACHE))
      act(() => { vi.advanceTimersByTime(1) })
      expect(ids(result)).toEqual([])
      // Le serveur revient : la demande aussi.
      act(() => observer([lue('d1', 10)], [], SERVEUR))
      expect(ids(result)).toEqual(['d1'])
    })
  })
})
