/**
 * TC-207 — Le vocabulaire : « ravitaillement » (spec S6).
 *
 * Un mot d'action garde le même nom d'un bout à l'autre du flux. Trois choses
 * se vérifient, et la deuxième est la seule qui puisse nuire :
 *
 *   §MOT — les libellés visibles de l'espace dealer disent « ravitaillement ».
 *   §CPT — un compteur dit CE QU'IL COMPTE. Le badge total additionne deux
 *          files de natures différentes ; le renommer avec le reste aurait
 *          fabriqué un mensonge que seul un lecteur d'écran entend, puisque le
 *          badge n'affiche qu'un chiffre.
 *   §ID  — aucun identifiant technique ne bouge. Un renommage de vocabulaire
 *          qui atteindrait `requestType` ou `stock_add` serait une migration
 *          de données déguisée en changement de libellé.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import {
  DEALER_REQUEST_TYPES,
  DEALER_REQUEST_STATUSES,
  DEALER_REQUEST_TYPE_LABELS,
  DEALER_REQUEST_STATUS_LABELS,
} from '../../src/constants/dealerConstants'

const mocks = vi.hoisted(() => ({
  listAllActiveStores: vi.fn(),
  createDealerRequest: vi.fn(),
  parseDealerAmount: vi.fn(),
  subscribeDealerRequests: vi.fn(),
  subscribeDealerPendingCount: vi.fn(),
  listDealerRequests: vi.fn(),
  subscribeDealerBalance: vi.fn(),
  subscribeIncomingTransfersCount: vi.fn(),
  createPartnerDeposit: vi.fn(),
  useAuth: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})), setLogLevel: vi.fn() }))
vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})), collection: vi.fn(), collectionGroup: vi.fn(),
  doc: vi.fn(), getDoc: vi.fn(), getDocs: vi.fn(), query: vi.fn(), where: vi.fn(),
  orderBy: vi.fn(), limit: vi.fn(), startAfter: vi.fn(), onSnapshot: vi.fn(() => vi.fn()),
  runTransaction: vi.fn(), serverTimestamp: vi.fn(() => 'SERVER_TS'),
}))
vi.mock('../../src/config/firebase', () => ({
  auth: {}, db: {}, functions: {},
  firebaseInfo: { projectId: 'test', isDev: true, useEmulators: false },
  default: {},
}))
vi.mock('../../src/services/dealerService', () => ({
  listAllActiveStores: mocks.listAllActiveStores,
  listActiveStores: vi.fn(),
  createDealerRequest: mocks.createDealerRequest,
  parseDealerAmount: mocks.parseDealerAmount,
  subscribeDealerRequests: mocks.subscribeDealerRequests,
  subscribeDealerPendingCount: mocks.subscribeDealerPendingCount,
  listDealerRequests: mocks.listDealerRequests,
}))
vi.mock('../../src/services/storeTransferService', () => ({
  createPartnerDeposit: mocks.createPartnerDeposit,
  subscribeDealerBalance: mocks.subscribeDealerBalance,
  subscribeIncomingTransfersCount: mocks.subscribeIncomingTransfersCount,
  replenishDealerInventory: vi.fn(),
  decreaseDealerInventory: vi.fn(),
}))
vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => mocks.useAuth(),
  AuthContext: React.createContext(null),
  AuthProvider: ({ children }) => children,
}))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => mocks.navigate }
})

import NewDealerRequest from '../../src/pages/dealer/NewDealerRequest'
import DealerRequests from '../../src/pages/dealer/DealerRequests'
import DealerLayout from '../../src/layouts/DealerLayout'

const AUTH = {
  currentUser: { uid: 'dealer-1' },
  userProfile: { role: 'dealer', active: true, email: 'd@t.test', name: 'D' },
  logout: vi.fn(),
}

const BOUTIQUES = [{ id: 'store-a', name: 'FADA', active: true }]

const abonnement = (valeur) => ({ onUpdate }) => { onUpdate?.(valeur); return vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.useAuth.mockReturnValue(AUTH)
  mocks.listAllActiveStores.mockResolvedValue({ stores: BOUTIQUES })
  mocks.createDealerRequest.mockResolvedValue({ id: 'r1' })
  mocks.parseDealerAmount.mockImplementation(v => {
    const s = String(v ?? '').trim()
    if (!/^[0-9]+$/.test(s)) return null
    const n = Number(s)
    return Number.isSafeInteger(n) && n > 0 ? n : null
  })
  mocks.subscribeDealerBalance.mockImplementation(abonnement({
    byNetwork: { Orange: { stock: 9_000_000, liquidite: 9_000_000 } },
    stock: 9_000_000, liquidite: 9_000_000, totalLiquidite: 9_000_000,
    flux: { envoyeCumul: 1, revenuCumul: 0, dehors: 1, amorce: true },
  }))
  mocks.subscribeDealerPendingCount.mockImplementation(abonnement(0))
  mocks.subscribeIncomingTransfersCount.mockImplementation(abonnement(0))
  mocks.subscribeDealerRequests.mockImplementation(({ onUpdate }) => {
    onUpdate({ requests: [], lastDoc: null, hasMore: false })
    return vi.fn()
  })
})

const ouvrirFormulaire = (url = '/dealer/requests/new') =>
  render(<MemoryRouter initialEntries={[url]}><NewDealerRequest /></MemoryRouter>)

// ===========================================================================
// §MOT — les libellés visibles
// ===========================================================================

describe('TC-207-MOT — l’espace dealer dit « ravitaillement »', () => {
  it('[MOT-01] le formulaire s’intitule « Nouveau ravitaillement »', async () => {
    ouvrirFormulaire()
    expect(await screen.findByRole('heading', { name: 'Nouveau ravitaillement' })).toBeInTheDocument()
  })

  it('[MOT-02] le champ de type s’intitule « Type de ravitaillement »', async () => {
    ouvrirFormulaire()
    await waitFor(() => screen.getByTestId('select-store'))
    expect(screen.getByText(/Type de ravitaillement/)).toBeInTheDocument()
  })

  it('[MOT-03] le bouton nomme ce qui va se passer, pas le geste abstrait', async () => {
    // « Vérifier » seul ne disait ni quoi ni pour qui : un lecteur d'écran qui
    // parcourt les boutons d'un formulaire n'entendait qu'un verbe sans objet.
    ouvrirFormulaire()
    await waitFor(() => screen.getByTestId('btn-review'))
    expect(screen.getByTestId('btn-review').textContent).toBe('Vérifier le ravitaillement')
  })

  it('[MOT-04] l’écran de confirmation dit « Confirmer le ravitaillement »', async () => {
    ouvrirFormulaire('/dealer/requests/new?storeId=store-a&type=stock_add')
    await waitFor(() => screen.getByTestId('select-store'))
    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '50000' } })
    fireEvent.click(screen.getByTestId('btn-review'))
    expect(await screen.findByRole('heading', { name: 'Confirmer le ravitaillement' })).toBeInTheDocument()
  })

  it('[MOT-05] le mot du message de retour est celui du bouton', async () => {
    ouvrirFormulaire('/dealer/requests/new?storeId=store-a&type=stock_add')
    await waitFor(() => screen.getByTestId('select-store'))
    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '50000' } })
    fireEvent.click(screen.getByTestId('btn-review'))
    await waitFor(() => screen.getByTestId('btn-submit-confirm'))
    fireEvent.click(screen.getByTestId('btn-submit-confirm'))
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled())
    expect(mocks.navigate.mock.calls.at(-1)[1].state.message).toMatch(/^Ravitaillement confirmé/)
  })

  it('[MOT-06] le vide filtré parle de ravitaillements, et nomme toujours le filtre', async () => {
    render(<MemoryRouter><DealerRequests /></MemoryRouter>)
    await waitFor(() => screen.getByTestId('empty-state'))
    fireEvent.change(screen.getByTestId('filter-status'), { target: { value: 'rejected' } })
    await waitFor(() => {
      const t = screen.getByTestId('empty-state').textContent
      expect(t).toMatch(/Aucun ravitaillement avec/)
      // La précision gagnée en S5 ne se perd pas au renommage.
      expect(t).toMatch(/Rejetée/)
    })
  })

  it('[MOT-07] l’onglet partenaire garde SON vocabulaire : ce n’est pas un ravitaillement', async () => {
    // Une opération partenaire n'envoie rien à une boutique : elle échange du
    // stock contre de la liquidité chez le dealer. L'appeler « ravitaillement »
    // aurait été le renommage appliqué sans le lire.
    ouvrirFormulaire()
    await waitFor(() => screen.getByTestId('target-partner'))
    fireEvent.click(screen.getByTestId('target-partner'))
    expect(screen.getByRole('heading', { name: 'Nouvelle opération partenaire' })).toBeInTheDocument()
    expect(screen.getByTestId('btn-review').textContent).toBe('Vérifier l’opération')
  })
})

// ===========================================================================
// §CPT — un compteur dit ce qu'il compte
// ===========================================================================

const monterPoste = () => render(<MemoryRouter initialEntries={['/dealer']}><DealerLayout /></MemoryRouter>)

describe('TC-207-CPT — les compteurs disent ce qu’ils comptent', () => {
  it('[CPT-01] le compteur de la file des ravitaillements les nomme', async () => {
    mocks.subscribeDealerPendingCount.mockImplementation(abonnement(3))
    monterPoste()
    await waitFor(() => screen.getByTestId('dealer-pending-badge'))
    expect(screen.getByTestId('dealer-pending-badge'))
      .toHaveAccessibleName('3 ravitaillements en attente')
  })

  it('[CPT-02] au singulier, le mot ne prend pas de « s »', async () => {
    mocks.subscribeDealerPendingCount.mockImplementation(abonnement(1))
    monterPoste()
    await waitFor(() => screen.getByTestId('dealer-pending-badge'))
    expect(screen.getByTestId('dealer-pending-badge'))
      .toHaveAccessibleName('1 ravitaillement en attente')
  })

  it('[CPT-03] le compteur des retours n’est PAS renommé : il ne compte pas ça', async () => {
    mocks.subscribeIncomingTransfersCount.mockImplementation(abonnement(2))
    monterPoste()
    await waitFor(() => screen.getByTestId('dealer-transfers-badge'))
    expect(screen.getByTestId('dealer-transfers-badge'))
      .toHaveAccessibleName('2 retours de boutiques en attente')
  })

  it('[CPT-04] ⚠ le compteur TOTAL additionne deux files : il dit « opérations »', async () => {
    // Le défaut que ce test empêche : `totalEnAttente` est la somme des
    // ravitaillements ET des retours. Lui donner le mot « ravitaillements »
    // avec le reste du renommage aurait annoncé 5 ravitaillements là où il y en
    // a 3 — un mensonge invisible à l'œil, puisque le badge n'affiche qu'un
    // chiffre, et audible du seul lecteur d'écran.
    mocks.subscribeDealerPendingCount.mockImplementation(abonnement(3))
    mocks.subscribeIncomingTransfersCount.mockImplementation(abonnement(2))
    monterPoste()
    await waitFor(() => screen.getByTestId('dealer-total-badge'))
    const badge = screen.getByTestId('dealer-total-badge')
    expect(badge).toHaveAccessibleName('5 opérations en attente')
    expect(badge.getAttribute('aria-label')).not.toMatch(/ravitaillement/)
  })
})

// ===========================================================================
// §ID — rien de technique ne bouge
// ===========================================================================

describe('TC-207-ID — les identifiants techniques sont intacts', () => {
  it('[ID-01] les valeurs de type et de statut sont inchangées', () => {
    expect(DEALER_REQUEST_TYPES).toEqual({ STOCK_ADD: 'stock_add', LIQUIDITY_ADD: 'liquidity_add' })
    expect(DEALER_REQUEST_STATUSES).toEqual({
      PENDING: 'pending', CONFIRMED: 'confirmed', REJECTED: 'rejected',
    })
  })

  it('[ID-02] les libellés de statut ne sont PAS touchés, et c’est délibéré', () => {
    // Ils sont partagés avec les espaces boutique et admin, que S6 met hors
    // périmètre. Un seul dictionnaire ne peut pas porter deux genres : les
    // scinder pour préserver l'accord dans un espace hors chantier aurait créé
    // exactement la duplication que S6 existe pour supprimer. Là où le mot et
    // le statut se croisent dans une même phrase — le vide filtré — le libellé
    // est CITÉ entre guillemets, ce qui l'isole de l'accord (cf. [MOT-06]).
    expect(DEALER_REQUEST_STATUS_LABELS).toEqual({
      pending: 'En attente', confirmed: 'Confirmée', rejected: 'Rejetée',
    })
  })

  it('[ID-03] les libellés de type restent ceux du dictionnaire', () => {
    expect(DEALER_REQUEST_TYPE_LABELS).toEqual({
      stock_add: 'Ajout de stock', liquidity_add: 'Ajout de liquidité',
    })
  })

  it('[ID-04] le payload envoyé au service ne connaît aucun mot nouveau', async () => {
    ouvrirFormulaire('/dealer/requests/new?storeId=store-a&type=liquidity_add')
    await waitFor(() => screen.getByTestId('select-store'))
    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '75000' } })
    fireEvent.click(screen.getByTestId('btn-review'))
    await waitFor(() => screen.getByTestId('btn-submit-confirm'))
    fireEvent.click(screen.getByTestId('btn-submit-confirm'))
    await waitFor(() => expect(mocks.createDealerRequest).toHaveBeenCalled())
    const payload = mocks.createDealerRequest.mock.calls.at(-1)[0]
    expect(payload.requestType).toBe('liquidity_add')
    expect(payload.targetStoreId).toBe('store-a')
    expect(JSON.stringify(Object.keys(payload))).not.toMatch(/ravitaillement/i)
  })
})
