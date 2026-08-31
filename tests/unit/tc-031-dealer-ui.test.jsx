/**
 * TC-031 — Tests composants UI Dealer (contre-revue V2-5)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ---------------------------------------------------------------------------
// Mocks hoistés
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  listActiveStores: vi.fn(),
  // Ajouté en S5 : `NewDealerRequest` est passé de la fonction PAGINÉE à celle
  // qui rend tout le réseau (défaut figé par tc-205 — 20 boutiques sur 84).
  // Seul le CÂBLAGE du mock change ici ; aucune assertion n'est touchée.
  listAllActiveStores: vi.fn(),
  getStoreBalances: vi.fn(),
  listDealerRequests: vi.fn(),
  subscribeDealerRequests: vi.fn(),
  createDealerRequest: vi.fn(),
  parseDealerAmount: vi.fn(v => {
    const s = String(v ?? '').trim()
    if (!/^[0-9]+$/.test(s)) return null
    const n = Number(s)
    return Number.isSafeInteger(n) && n > 0 ? n : null
  }),
  useAuth: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({})),
  setLogLevel: vi.fn(),
}))
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  connectAuthEmulator: vi.fn(),
  onAuthStateChanged: vi.fn(() => vi.fn()),
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(() => Promise.resolve()),
  sendPasswordResetEmail: vi.fn(),
  updatePassword: vi.fn(),
  deleteUser: vi.fn(),
  reauthenticateWithCredential: vi.fn(),
  EmailAuthProvider: { credential: vi.fn() },
  setPersistence: vi.fn(() => Promise.resolve()),
  browserLocalPersistence: 'LOCAL',
}))
vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  connectFirestoreEmulator: vi.fn(),
  enableMultiTabIndexedDbPersistence: vi.fn(() => Promise.resolve()),
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  addDoc: vi.fn(),
  setDoc: vi.fn(() => Promise.resolve()),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  writeBatch: vi.fn(() => ({ set: vi.fn(), commit: vi.fn(() => Promise.resolve()) })),
  serverTimestamp: vi.fn(() => 'SERVER_TS'),
  onSnapshot: vi.fn(() => vi.fn()),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  startAfter: vi.fn(),
  runTransaction: vi.fn(),
}))
vi.mock('../../src/config/firebase', () => ({
  auth: {},
  db: {},
  firebaseInfo: { projectId: 'test', isDev: true, useEmulators: false },
  default: {},
}))

vi.mock('../../src/services/dealerService', () => ({
  listActiveStores: mocks.listActiveStores,
  listAllActiveStores: mocks.listAllActiveStores,
  getStoreBalances: mocks.getStoreBalances,
  listDealerRequests: mocks.listDealerRequests,
  subscribeDealerRequests: mocks.subscribeDealerRequests,
  createDealerRequest: mocks.createDealerRequest,
  parseDealerAmount: mocks.parseDealerAmount,
}))

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => mocks.useAuth(),
  AuthContext: React.createContext(null),
  resolveAuthenticatedProfile: vi.fn(),
  AuthProvider: ({ children }) => children,
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  }
})

// ---------------------------------------------------------------------------
// Imports après mocks
// ---------------------------------------------------------------------------

import DealerStoreCard from '../../src/components/dealer/DealerStoreCard'
import DealerStores from '../../src/pages/dealer/DealerStores'
import NewDealerRequest from '../../src/pages/dealer/NewDealerRequest'
import DealerRequests from '../../src/pages/dealer/DealerRequests'
import { formatCurrency } from '../../src/utils/formatCurrency'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEALER_AUTH = {
  currentUser: { uid: 'dealer-uid' },
  userProfile: { role: 'dealer', active: true, email: 'd@test.com', name: 'Dealer' },
  isDealer: true,
}

const STORES = [
  { id: 'store-a', name: 'Boutique Alpha', active: true },
  { id: 'store-b', name: 'Boutique Beta', active: true },
]

// Résultat paginé pour listActiveStores — objets plats, format { stores, lastDoc, hasMore }
function makeStoresResult(stores = STORES, hasMore = false) {
  return { stores, lastDoc: hasMore ? { id: 'last' } : null, hasMore }
}

// Soldes : structure retournée par getStoreBalances
const BALANCES_A = { balances: { Orange: { stock: 10000, liquidite: 5000 } } }
const BALANCES_B = { balances: { Orange: { stock: 0, liquidite: 3000 } } }

// Résultat paginé pour listDealerRequests — objets plats, format { requests, lastDoc, hasMore }
const REQS = [
  { id: 'req-1', targetStoreName: 'Boutique Alpha', requestType: 'stock_add', amount: 5000, network: 'Orange', status: 'pending', createdAt: new Date('2024-01-01') },
  { id: 'req-2', targetStoreName: 'Boutique Beta', requestType: 'liquidity_add', amount: 10000, network: 'Orange', status: 'confirmed', createdAt: new Date('2024-01-02') },
  { id: 'req-3', targetStoreName: 'Boutique Alpha', requestType: 'stock_add', amount: 3000, network: 'Orange', status: 'rejected', createdAt: new Date('2024-01-03') },
]

function makeReqResult(requests = REQS, hasMore = false) {
  return { requests, hasMore, lastDoc: hasMore ? { id: 'last' } : null }
}

function renderWithRouter(Component, props = {}, initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Component {...props} />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.useAuth.mockReturnValue(DEALER_AUTH)
  // Réinitialise parseDealerAmount à l'implémentation stricte
  mocks.parseDealerAmount.mockImplementation(v => {
    const s = String(v ?? '').trim()
    if (!/^[0-9]+$/.test(s)) return null
    const n = Number(s)
    return Number.isSafeInteger(n) && n > 0 ? n : null
  })
  // Défaut subscribe : liste vide, résolu immédiatement
  mocks.subscribeDealerRequests.mockImplementation(({ onUpdate }) => {
    onUpdate({ requests: [], lastDoc: null, hasMore: false })
    return vi.fn()
  })
})

// ===========================================================================
// § formatCurrency
// ===========================================================================

describe('TC-031-FMT — formatCurrency', () => {
  it('[FMT-01] 0 → "0 FCFA"', () => {
    expect(formatCurrency(0)).toBe('0 FCFA')
  })
  it('[FMT-02] 1 → "1 FCFA"', () => {
    expect(formatCurrency(1)).toBe('1 FCFA')
  })
  it('[FMT-03] 1000 → contient séparateur de milliers + FCFA', () => {
    expect(formatCurrency(1000)).toMatch(/1.000 FCFA/)
  })
  it('[FMT-04] 1000000 → contient 1 000 000 FCFA', () => {
    expect(formatCurrency(1_000_000)).toMatch(/1.000.000 FCFA/)
  })
  it('[FMT-05] null → "—"', () => {
    expect(formatCurrency(null)).toBe('—')
  })
  it('[FMT-06] undefined → "—"', () => {
    expect(formatCurrency(undefined)).toBe('—')
  })
  it('[FMT-07] NaN → "—"', () => {
    expect(formatCurrency(NaN)).toBe('—')
  })
})

// ===========================================================================
// § DealerStoreCard
// ===========================================================================

describe('TC-031-CARD — DealerStoreCard', () => {
  const store = STORES[0]

  it('[CARD-01] affiche le nom de la boutique', () => {
    renderWithRouter(DealerStoreCard, { store, balances: BALANCES_A.balances, isLoading: false })
    expect(screen.getByText('Boutique Alpha')).toBeInTheDocument()
  })

  it('[CARD-02] affiche le stock Orange formaté', () => {
    renderWithRouter(DealerStoreCard, { store, balances: BALANCES_A.balances, isLoading: false })
    expect(screen.getByTestId('stock-store-a').textContent).toMatch(/10.000 FCFA/)
  })

  it('[CARD-03] affiche la liquidité Orange formatée', () => {
    renderWithRouter(DealerStoreCard, { store, balances: BALANCES_A.balances, isLoading: false })
    expect(screen.getByTestId('liquidite-store-a').textContent).toMatch(/5.000 FCFA/)
  })

  it('[CARD-04] bouton stock navigue vers /dealer/requests/new?storeId=...&type=stock_add', () => {
    renderWithRouter(DealerStoreCard, { store, balances: {}, isLoading: false })
    fireEvent.click(screen.getByTestId('btn-stock-store-a'))
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.stringContaining('/dealer/requests/new')
    )
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.stringContaining('type=stock_add')
    )
  })

  it('[CARD-05] bouton liquidité navigue vers type=liquidity_add', () => {
    renderWithRouter(DealerStoreCard, { store, balances: {}, isLoading: false })
    fireEvent.click(screen.getByTestId('btn-liquidite-store-a'))
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.stringContaining('type=liquidity_add')
    )
  })

  it('[CARD-06] isLoading=true → skeleton visible, montants absents', () => {
    renderWithRouter(DealerStoreCard, { store, balances: {}, isLoading: true })
    expect(screen.queryByTestId('stock-store-a')).not.toBeInTheDocument()
  })

  it('[CARD-07] balances Orange absent → affiche "—" (pas "0 FCFA")', () => {
    renderWithRouter(DealerStoreCard, { store, balances: {}, isLoading: false })
    expect(screen.getByTestId('stock-store-a').textContent).toBe('—')
    expect(screen.getByTestId('liquidite-store-a').textContent).toBe('—')
  })

  it('[CARD-08] balanceError → "Solde indisponible" sur stock et liquidité', () => {
    renderWithRouter(DealerStoreCard, {
      store,
      balances: null,
      balanceError: 'permission-denied',
      isLoading: false,
    })
    const stockEl = screen.getByTestId('stock-store-a')
    const liquiditeEl = screen.getByTestId('liquidite-store-a')
    expect(stockEl.textContent).toBe('Solde indisponible')
    expect(liquiditeEl.textContent).toBe('Solde indisponible')
  })

  it('[CARD-09] objets plats sans méthode data() rendus sans erreur', () => {
    const flatStore = { id: 'store-flat', name: 'Flat Store', active: true }
    expect(() =>
      renderWithRouter(DealerStoreCard, { store: flatStore, balances: {}, isLoading: false })
    ).not.toThrow()
    expect(screen.getByText('Flat Store')).toBeInTheDocument()
  })
})

// ===========================================================================
// § DealerStores
// ===========================================================================

describe('TC-031-STORES — DealerStores', () => {
  it('[STORES-01] état initial → rendu du composant', async () => {
    mocks.listActiveStores.mockResolvedValue(makeStoresResult([]))
    mocks.getStoreBalances.mockResolvedValue({ balances: {} })
    renderWithRouter(DealerStores)
    expect(screen.getByTestId('dealer-stores')).toBeInTheDocument()
  })

  it('[STORES-02] chargement réussi → affiche les boutiques', async () => {
    mocks.listActiveStores.mockResolvedValue(makeStoresResult(STORES))
    mocks.getStoreBalances
      .mockResolvedValueOnce(BALANCES_A)
      .mockResolvedValueOnce(BALANCES_B)

    renderWithRouter(DealerStores)
    await waitFor(() => {
      expect(screen.getByTestId('store-card-store-a')).toBeInTheDocument()
      expect(screen.getByTestId('store-card-store-b')).toBeInTheDocument()
    })
  })

  it('[STORES-03] erreur réseau → message d\'erreur', async () => {
    mocks.listActiveStores.mockRejectedValue(new Error('Réseau indisponible'))
    renderWithRouter(DealerStores)
    await waitFor(() => {
      expect(screen.getByTestId('dealer-stores').textContent).toMatch(/erreur|indisponible|impossible/i)
    })
  })

  it('[STORES-04] liste vide → message aucune boutique', async () => {
    mocks.listActiveStores.mockResolvedValue(makeStoresResult([]))
    renderWithRouter(DealerStores)
    await waitFor(() => {
      expect(screen.getByTestId('dealer-stores').textContent).toMatch(/aucune|vide/i)
    })
  })

  it('[STORES-05] recherche filtre les boutiques par nom (label "Rechercher sur cette page")', async () => {
    mocks.listActiveStores.mockResolvedValue(makeStoresResult(STORES))
    mocks.getStoreBalances.mockResolvedValue({ balances: {} })

    renderWithRouter(DealerStores)
    await waitFor(() => screen.getByTestId('store-card-store-a'))

    const searchInput = screen.getByPlaceholderText(/boutique/i)
    fireEvent.change(searchInput, { target: { value: 'Alpha' } })

    await waitFor(() => {
      expect(screen.getByTestId('store-card-store-a')).toBeInTheDocument()
      expect(screen.queryByTestId('store-card-store-b')).not.toBeInTheDocument()
    })
  })

  it('[STORES-06] label recherche est "Rechercher sur cette page"', async () => {
    mocks.listActiveStores.mockResolvedValue(makeStoresResult(STORES))
    mocks.getStoreBalances.mockResolvedValue({ balances: {} })
    renderWithRouter(DealerStores)
    await waitFor(() => screen.getByTestId('store-card-store-a'))
    expect(screen.getByText(/rechercher sur cette page/i)).toBeInTheDocument()
  })

  it('[STORES-07] chargement → aria-busy=true visible', async () => {
    let resolve
    mocks.listActiveStores.mockReturnValue(new Promise(r => { resolve = r }))
    renderWithRouter(DealerStores)
    await waitFor(() => {
      const container = screen.getByTestId('dealer-stores')
      // Le repli par classe CSS est retiré : il ne pouvait plus matcher depuis
      // que les animations passent sous `motion-safe:`, et surtout Tailwind
      // BALAIE LES TESTS — nommer l'utilitaire de rotation, fût-ce dans une
      // chaîne d'assertion, suffisait à en faire naître la règle
      // inconditionnelle dans le CSS livré. Voir tc-094.
      expect(!!container.querySelector('[aria-busy="true"]')).toBe(true)
    })
    await act(async () => { resolve(makeStoresResult([])) })
  })

  it('[STORES-08] getStoreBalances rejetée → "Solde indisponible" affiché', async () => {
    mocks.listActiveStores.mockResolvedValue(makeStoresResult([STORES[0]]))
    mocks.getStoreBalances.mockRejectedValue(new Error('permission-denied'))

    renderWithRouter(DealerStores)
    await waitFor(() => {
      expect(screen.getByTestId('dealer-stores').textContent).toMatch(/solde indisponible/i)
    })
  })

  it('[STORES-09] hasMore=true → bouton "Charger plus" visible', async () => {
    mocks.listActiveStores.mockResolvedValue(makeStoresResult(STORES, true))
    mocks.getStoreBalances.mockResolvedValue({ balances: {} })
    renderWithRouter(DealerStores)
    await waitFor(() => {
      expect(screen.getByTestId('btn-load-more-stores')).toBeInTheDocument()
    })
  })

  it('[STORES-10] double-clic "Charger plus" ne déclenche qu\'un seul appel supplémentaire', async () => {
    mocks.listActiveStores
      .mockResolvedValueOnce(makeStoresResult(STORES, true))
      .mockResolvedValue(makeStoresResult([], false))
    mocks.getStoreBalances.mockResolvedValue({ balances: {} })

    renderWithRouter(DealerStores)
    await waitFor(() => screen.getByTestId('btn-load-more-stores'))

    const btn = screen.getByTestId('btn-load-more-stores')
    fireEvent.click(btn)
    fireEvent.click(btn)

    await waitFor(() => {
      // initial + at most 1 extra (not 2)
      expect(mocks.listActiveStores.mock.calls.length).toBeLessThanOrEqual(2)
    })
  })
})

// ===========================================================================
// § NewDealerRequest
// ===========================================================================

describe('TC-031-NEW — NewDealerRequest', () => {
  const STORE_LIST = [{ id: 'store-a', name: 'Boutique Alpha', active: true }]

  beforeEach(() => {
    // Cet écran lit `listAllActiveStores` depuis S5 ; l'autre reste câblé pour
    // les écrans paginés couverts plus haut dans ce fichier.
    mocks.listAllActiveStores.mockResolvedValue({ stores: STORE_LIST })
    mocks.listActiveStores.mockResolvedValue(makeStoresResult(STORE_LIST))
  })

  it('[NEW-01] formulaire visible après chargement des boutiques', async () => {
    renderWithRouter(NewDealerRequest, {}, '/dealer/requests/new')
    await waitFor(() => {
      expect(screen.getByTestId('new-dealer-request')).toBeInTheDocument()
    })
  })

  it('[NEW-02] champ réseau non modifiable (readonly)', async () => {
    renderWithRouter(NewDealerRequest, {}, '/dealer/requests/new')
    await waitFor(() => screen.getByTestId('network-display'))
    const el = screen.getByTestId('network-display')
    const isReadonly = el.getAttribute('readonly') !== null || el.getAttribute('disabled') !== null
    expect(isReadonly).toBe(true)
  })

  it('[NEW-03] erreur chargement boutiques → message d\'erreur', async () => {
    mocks.listAllActiveStores.mockRejectedValue(new Error('unavailable'))
    renderWithRouter(NewDealerRequest, {}, '/dealer/requests/new')
    await waitFor(() => {
      expect(screen.getByTestId('new-dealer-request').textContent).toMatch(/erreur|indisponible|impossible/i)
    })
  })

  it('[NEW-04] montant décimal → validation échoue, confirmation absente', async () => {
    renderWithRouter(NewDealerRequest, {}, '/dealer/requests/new')
    await waitFor(() => screen.getByTestId('new-dealer-request'))

    fireEvent.change(screen.getByTestId('select-store'), { target: { value: 'store-a' } })
    fireEvent.click(screen.getByTestId('radio-type-stock_add'))
    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '1000.5' } })
    fireEvent.click(screen.getByTestId('btn-review'))

    expect(screen.queryByTestId('btn-submit-confirm')).not.toBeInTheDocument()
  })

  it('[NEW-05] montant zéro → validation échoue', async () => {
    renderWithRouter(NewDealerRequest, {}, '/dealer/requests/new')
    await waitFor(() => screen.getByTestId('new-dealer-request'))

    fireEvent.change(screen.getByTestId('select-store'), { target: { value: 'store-a' } })
    fireEvent.click(screen.getByTestId('radio-type-stock_add'))
    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '0' } })
    fireEvent.click(screen.getByTestId('btn-review'))

    expect(screen.queryByTestId('btn-submit-confirm')).not.toBeInTheDocument()
  })

  it('[NEW-06] "1 000" avec espace interne → REJETÉ (politique stricte)', async () => {
    renderWithRouter(NewDealerRequest, {}, '/dealer/requests/new')
    await waitFor(() => screen.getByTestId('new-dealer-request'))

    fireEvent.change(screen.getByTestId('select-store'), { target: { value: 'store-a' } })
    fireEvent.click(screen.getByTestId('radio-type-stock_add'))
    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '1 000' } })
    fireEvent.click(screen.getByTestId('btn-review'))

    expect(screen.queryByTestId('btn-submit-confirm')).not.toBeInTheDocument()
  })

  it('[NEW-07] Number.MAX_SAFE_INTEGER + 1 en string → REJETÉ (unsafe integer)', async () => {
    renderWithRouter(NewDealerRequest, {}, '/dealer/requests/new')
    await waitFor(() => screen.getByTestId('new-dealer-request'))

    const unsafeStr = String(Number.MAX_SAFE_INTEGER + 1)
    fireEvent.change(screen.getByTestId('select-store'), { target: { value: 'store-a' } })
    fireEvent.click(screen.getByTestId('radio-type-stock_add'))
    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: unsafeStr } })
    fireEvent.click(screen.getByTestId('btn-review'))

    expect(screen.queryByTestId('btn-submit-confirm')).not.toBeInTheDocument()
  })

  it('[NEW-08] données valides → affiche écran confirmation', async () => {
    renderWithRouter(NewDealerRequest, {}, '/dealer/requests/new')
    await waitFor(() => screen.getByTestId('new-dealer-request'))

    fireEvent.change(screen.getByTestId('select-store'), { target: { value: 'store-a' } })
    fireEvent.click(screen.getByTestId('radio-type-stock_add'))
    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '5000' } })
    fireEvent.click(screen.getByTestId('btn-review'))

    await waitFor(() => {
      expect(screen.getByTestId('btn-submit-confirm')).toBeInTheDocument()
    })
  })

  it('[NEW-09] écran confirmation affiche boutique et montant', async () => {
    renderWithRouter(NewDealerRequest, {}, '/dealer/requests/new')
    await waitFor(() => screen.getByTestId('new-dealer-request'))

    fireEvent.change(screen.getByTestId('select-store'), { target: { value: 'store-a' } })
    fireEvent.click(screen.getByTestId('radio-type-stock_add'))
    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '5000' } })
    fireEvent.click(screen.getByTestId('btn-review'))

    await waitFor(() => screen.getByTestId('confirm-store'))
    expect(screen.getByTestId('confirm-store').textContent).toContain('Boutique Alpha')
    expect(screen.getByTestId('confirm-amount').textContent).toContain('5')
  })

  it('[NEW-10] bouton annuler (confirmation) → retour formulaire', async () => {
    renderWithRouter(NewDealerRequest, {}, '/dealer/requests/new')
    await waitFor(() => screen.getByTestId('new-dealer-request'))

    fireEvent.change(screen.getByTestId('select-store'), { target: { value: 'store-a' } })
    fireEvent.click(screen.getByTestId('radio-type-stock_add'))
    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '5000' } })
    fireEvent.click(screen.getByTestId('btn-review'))

    await waitFor(() => screen.getByTestId('btn-cancel-confirm'))
    fireEvent.click(screen.getByTestId('btn-cancel-confirm'))

    await waitFor(() => {
      expect(screen.getByTestId('btn-review')).toBeInTheDocument()
    })
  })

  it('[NEW-11] soumission réussie → navigate vers /dealer/requests', async () => {
    mocks.createDealerRequest.mockResolvedValue({ id: 'new-req-id' })

    renderWithRouter(NewDealerRequest, {}, '/dealer/requests/new')
    await waitFor(() => screen.getByTestId('new-dealer-request'))

    fireEvent.change(screen.getByTestId('select-store'), { target: { value: 'store-a' } })
    fireEvent.click(screen.getByTestId('radio-type-stock_add'))
    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '5000' } })
    fireEvent.click(screen.getByTestId('btn-review'))

    await waitFor(() => screen.getByTestId('btn-submit-confirm'))
    fireEvent.click(screen.getByTestId('btn-submit-confirm'))

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith('/dealer/requests', { replace: true })
    })
  })

  it('[NEW-12] erreur service → message d\'erreur, retour formulaire', async () => {
    mocks.createDealerRequest.mockRejectedValue(new Error('Accès refusé'))

    renderWithRouter(NewDealerRequest, {}, '/dealer/requests/new')
    await waitFor(() => screen.getByTestId('new-dealer-request'))

    fireEvent.change(screen.getByTestId('select-store'), { target: { value: 'store-a' } })
    fireEvent.click(screen.getByTestId('radio-type-stock_add'))
    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '5000' } })
    fireEvent.click(screen.getByTestId('btn-review'))

    await waitFor(() => screen.getByTestId('btn-submit-confirm'))
    fireEvent.click(screen.getByTestId('btn-submit-confirm'))

    await waitFor(() => {
      expect(screen.getByTestId('new-dealer-request').textContent).toMatch(/accès refusé|erreur/i)
    })
  })

  it('[NEW-13] bouton confirmer désactivé pendant soumission (anti-double-clic)', async () => {
    let resolve
    mocks.createDealerRequest.mockReturnValue(new Promise(r => { resolve = r }))

    renderWithRouter(NewDealerRequest, {}, '/dealer/requests/new')
    // Attendre le formulaire chargé (select-store), pas seulement le conteneur
    await waitFor(() => screen.getByTestId('select-store'))

    fireEvent.change(screen.getByTestId('select-store'), { target: { value: 'store-a' } })
    fireEvent.click(screen.getByTestId('radio-type-stock_add'))
    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '5000' } })
    fireEvent.click(screen.getByTestId('btn-review'))

    await waitFor(() => screen.getByTestId('btn-submit-confirm'))
    const btn = screen.getByTestId('btn-submit-confirm')
    fireEvent.click(btn)

    await waitFor(() => {
      expect(screen.getByTestId('btn-submit-confirm')).toBeDisabled()
    })
    await act(async () => { resolve({ id: 'x' }) })
  })

  it('[NEW-14] double-clic confirmer → createDealerRequest appelé une seule fois', async () => {
    // Cause du flaky (deux racines) :
    // 1. waitFor('new-dealer-request') résolvait avant que les boutiques soient chargées
    //    → select-store introuvable. Fix : attendre select-store lui-même.
    // 2. fireEvent.click ne garantissait pas que React avait flushé disabled=true
    //    avant le second clic. Fix : waitFor(btn.disabled) entre les deux clics.
    let resolve
    mocks.createDealerRequest.mockReturnValue(new Promise(r => { resolve = r }))

    renderWithRouter(NewDealerRequest, {}, '/dealer/requests/new')
    // Attendre le formulaire chargé (select-store), pas seulement le conteneur
    await waitFor(() => screen.getByTestId('select-store'))

    fireEvent.change(screen.getByTestId('select-store'), { target: { value: 'store-a' } })
    fireEvent.click(screen.getByTestId('radio-type-stock_add'))
    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '5000' } })
    fireEvent.click(screen.getByTestId('btn-review'))

    await waitFor(() => screen.getByTestId('btn-submit-confirm'))
    const btn = screen.getByTestId('btn-submit-confirm')
    fireEvent.click(btn)
    // Attendre que React désactive le bouton (anti-double-clic) avant le second clic
    await waitFor(() => expect(btn).toBeDisabled())
    fireEvent.click(btn)

    await act(async () => { resolve({ id: 'x' }) })
    expect(mocks.createDealerRequest).toHaveBeenCalledTimes(1)
  })

  it('[NEW-15] bouton annuler formulaire → navigate vers /dealer/requests', async () => {
    renderWithRouter(NewDealerRequest, {}, '/dealer/requests/new')
    // btn-cancel-form n'existe qu'après le chargement des boutiques
    await waitFor(() => screen.getByTestId('btn-cancel-form'))

    fireEvent.click(screen.getByTestId('btn-cancel-form'))
    expect(mocks.navigate).toHaveBeenCalledWith('/dealer/requests')
  })
})

// ===========================================================================
// § DealerRequests
// ===========================================================================

describe('TC-031-REQS — DealerRequests', () => {
  it('[REQS-01] état initial → affiche le composant', async () => {
    renderWithRouter(DealerRequests, {}, '/dealer/requests')
    expect(screen.getByTestId('dealer-requests')).toBeInTheDocument()
  })

  it('[REQS-02] bouton nouvelle demande → navigate vers /dealer/requests/new', async () => {
    renderWithRouter(DealerRequests, {}, '/dealer/requests')
    await waitFor(() => screen.getByTestId('btn-new-request'))
    fireEvent.click(screen.getByTestId('btn-new-request'))
    expect(mocks.navigate).toHaveBeenCalledWith('/dealer/requests/new')
  })

  it('[REQS-03] chargement → état de chargement visible (subscribe en attente)', async () => {
    // Subscribe qui ne rappelle jamais onUpdate → loading reste true
    mocks.subscribeDealerRequests.mockImplementation(() => vi.fn())
    renderWithRouter(DealerRequests, {}, '/dealer/requests')
    await waitFor(() => {
      const container = screen.getByTestId('dealer-requests')
      // Le repli par classe CSS est retiré : il ne pouvait plus matcher depuis
      // que les animations passent sous `motion-safe:`, et surtout Tailwind
      // BALAIE LES TESTS — nommer l'utilitaire de rotation, fût-ce dans une
      // chaîne d'assertion, suffisait à en faire naître la règle
      // inconditionnelle dans le CSS livré. Voir tc-094.
      expect(!!container.querySelector('[aria-busy="true"]')).toBe(true)
    })
  })

  it('[REQS-04] chargement réussi — objets plats (pas de data()) → tableau affiché', async () => {
    mocks.subscribeDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeReqResult(REQS))
      return vi.fn()
    })
    renderWithRouter(DealerRequests, {}, '/dealer/requests')
    await waitFor(() => {
      expect(screen.getByTestId('requests-table')).toBeInTheDocument()
      expect(screen.getByTestId('request-row-req-1')).toBeInTheDocument()
    })
  })

  it('[REQS-05] statut pending → badge "En attente"', async () => {
    mocks.subscribeDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeReqResult(REQS))
      return vi.fn()
    })
    renderWithRouter(DealerRequests, {}, '/dealer/requests')
    await waitFor(() => screen.getByTestId('request-row-req-1'))
    expect(screen.getByTestId('status-badge-pending')).toBeInTheDocument()
  })

  it('[REQS-06] statut confirmed → badge "Confirmée"', async () => {
    mocks.subscribeDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeReqResult(REQS))
      return vi.fn()
    })
    renderWithRouter(DealerRequests, {}, '/dealer/requests')
    await waitFor(() => screen.getByTestId('request-row-req-2'))
    expect(screen.getByTestId('status-badge-confirmed')).toBeInTheDocument()
  })

  it('[REQS-07] statut rejected → badge "Rejetée"', async () => {
    mocks.subscribeDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeReqResult(REQS))
      return vi.fn()
    })
    renderWithRouter(DealerRequests, {}, '/dealer/requests')
    await waitFor(() => screen.getByTestId('request-row-req-3'))
    expect(screen.getByTestId('status-badge-rejected')).toBeInTheDocument()
  })

  it('[REQS-08] liste vide → empty state visible', async () => {
    renderWithRouter(DealerRequests, {}, '/dealer/requests')
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    })
  })

  it('[REQS-09] erreur service → message d\'erreur', async () => {
    mocks.subscribeDealerRequests.mockImplementation(({ onError }) => {
      onError(new Error('Accès refusé'))
      return vi.fn()
    })
    renderWithRouter(DealerRequests, {}, '/dealer/requests')
    await waitFor(() => {
      expect(screen.getByTestId('dealer-requests').textContent).toMatch(/erreur|accès refusé|impossible/i)
    })
  })

  it('[REQS-10] hasMore=true → bouton "Voir plus" visible', async () => {
    mocks.subscribeDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeReqResult(REQS, true))
      return vi.fn()
    })
    renderWithRouter(DealerRequests, {}, '/dealer/requests')
    await waitFor(() => {
      expect(screen.getByTestId('btn-load-more')).toBeInTheDocument()
    })
  })

  it('[REQS-11] filtre statut "pending" → subscribeDealerRequests appelé avec statusFilter=pending', async () => {
    renderWithRouter(DealerRequests, {}, '/dealer/requests')
    await waitFor(() => screen.getByTestId('filter-status'))

    fireEvent.change(screen.getByTestId('filter-status'), { target: { value: 'pending' } })

    await waitFor(() => {
      const calls = mocks.subscribeDealerRequests.mock.calls
      expect(calls.some(c => c[0]?.statusFilter === 'pending')).toBe(true)
    })
  })

  it('[REQS-12] aucun bouton modifier ou supprimer', async () => {
    mocks.subscribeDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeReqResult(REQS))
      return vi.fn()
    })
    renderWithRouter(DealerRequests, {}, '/dealer/requests')
    await waitFor(() => screen.getByTestId('requests-table'))

    const allButtons = screen.queryAllByRole('button')
    const forbidden = allButtons.filter(b =>
      /modifier|supprimer|éditer|annuler la demande|delete|edit/i.test(b.textContent)
    )
    expect(forbidden).toHaveLength(0)
  })

  it('[REQS-13] filtre store affiche uniquement la boutique recherchée', async () => {
    mocks.subscribeDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeReqResult(REQS))
      return vi.fn()
    })
    renderWithRouter(DealerRequests, {}, '/dealer/requests')
    await waitFor(() => screen.getByTestId('requests-table'))

    fireEvent.change(screen.getByTestId('filter-store'), { target: { value: 'Beta' } })

    await waitFor(() => {
      expect(screen.getByTestId('request-row-req-2')).toBeInTheDocument()
      expect(screen.queryByTestId('request-row-req-1')).not.toBeInTheDocument()
    })
  })
})
