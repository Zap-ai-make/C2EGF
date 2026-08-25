/**
 * TC-041 — Tests temps réel : badges pending, nettoyage listener, dédup pagination
 *
 * Couvre :
 *   Badges DealerLayout : 0/2/120 pending, aria-label, unsubscribe au démontage
 *   Badges NavBar        : 0/2/120 pending, aria-label, unsubscribe au démontage
 *   DealerRequests       : mise à jour temps réel, dédup pagination, unsubscribe
 *   StoreAdminDealerReqs : mise à jour temps réel, dédup pagination, unsubscribe
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ---------------------------------------------------------------------------
// Mocks hoistés
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  // dealerService
  subscribeDealerRequests: vi.fn(),
  subscribeDealerPendingCount: vi.fn(),
  listDealerRequests: vi.fn(),
  // storeAdminDealerService
  subscribeStoreAdminDealerRequests: vi.fn(),
  subscribeStorePendingCount: vi.fn(),
  listStoreAdminDealerRequests: vi.fn(),
  // auth
  useAuth: vi.fn(),
  logout: vi.fn(),
  // router
  navigate: vi.fn(),
  // theme
  themeClasses: { navbar: 'bg-blue-800' },
}))

vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})), setLogLevel: vi.fn() }))
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
  collection: vi.fn(), doc: vi.fn(), getDoc: vi.fn(), getDocs: vi.fn(),
  addDoc: vi.fn(), setDoc: vi.fn(() => Promise.resolve()), updateDoc: vi.fn(),
  deleteDoc: vi.fn(), writeBatch: vi.fn(() => ({ set: vi.fn(), commit: vi.fn(() => Promise.resolve()) })),
  serverTimestamp: vi.fn(() => 'SERVER_TS'),
  onSnapshot: vi.fn(() => vi.fn()),
  query: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), startAfter: vi.fn(),
  runTransaction: vi.fn(),
}))
vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  connectFunctionsEmulator: vi.fn(),
  httpsCallable: vi.fn(),
}))
vi.mock('../../src/config/firebase', () => ({
  auth: {}, db: {}, functions: {},
  firebaseInfo: { projectId: 'test', isDev: true, useEmulators: false },
  default: {},
}))

vi.mock('../../src/services/dealerService', () => ({
  subscribeDealerRequests: mocks.subscribeDealerRequests,
  subscribeDealerPendingCount: mocks.subscribeDealerPendingCount,
  listDealerRequests: mocks.listDealerRequests,
  listActiveStores: vi.fn(),
  getStoreBalances: vi.fn(),
  createDealerRequest: vi.fn(),
  parseDealerAmount: vi.fn(),
}))

vi.mock('../../src/services/storeAdminDealerService', () => ({
  subscribeStoreAdminDealerRequests: mocks.subscribeStoreAdminDealerRequests,
  subscribeStorePendingCount: mocks.subscribeStorePendingCount,
  listStoreAdminDealerRequests: mocks.listStoreAdminDealerRequests,
  getStoreAdminDealerRequestById: vi.fn(),
}))

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => mocks.useAuth(),
  AuthContext: React.createContext(null),
  resolveAuthenticatedProfile: vi.fn(),
  AuthProvider: ({ children }) => children,
}))

vi.mock('../../src/context/ThemeContext.jsx', () => ({
  useTheme: () => ({ themeClasses: mocks.themeClasses, backgroundImage: '' }),
  ThemeProvider: ({ children }) => children,
}))

// Composants qui ont des dépendances non nécessaires au test
vi.mock('../../src/components/PWAInstallButton', () => ({
  default: () => null,
}))
vi.mock('../../src/components/network/NetworkCardsDrawer', () => ({
  default: () => null,
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => mocks.navigate }
})

// ---------------------------------------------------------------------------
// Imports après mocks
// ---------------------------------------------------------------------------

import DealerLayout from '../../src/layouts/DealerLayout'
import NavBar from '../../src/components/NavBar'
import DealerRequests from '../../src/pages/dealer/DealerRequests'
import StoreAdminDealerRequests from '../../src/pages/store/StoreAdminDealerRequests'
import { mergeUniqueRequests } from '../../src/utils/mergeRequests'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEALER_AUTH = {
  currentUser: { uid: 'dealer-uid' },
  userProfile: { role: 'dealer', active: true, email: 'd@test.com', name: 'Dealer Test' },
  logout: mocks.logout,
}

const STORE_ADMIN_AUTH = {
  currentUser: { uid: 'admin-uid' },
  userProfile: { role: 'store_admin', active: true, storeId: 'store-a', email: 'a@test.com', name: 'Admin' },
  logout: mocks.logout,
}

const REQS_DEALER = [
  { id: 'req-1', targetStoreName: 'Boutique A', requestType: 'stock_add', amount: 5000, network: 'Orange', status: 'pending', createdAt: new Date('2024-01-01') },
  { id: 'req-2', targetStoreName: 'Boutique B', requestType: 'liquidity_add', amount: 3000, network: 'Orange', status: 'confirmed', createdAt: new Date('2024-01-02') },
]

const REQS_STORE = [
  { id: 'sr-1', dealerName: 'D1', dealerEmail: 'd1@t.com', targetStoreName: 'Boutique A', targetStoreId: 'store-a', requestType: 'stock_add', amount: 5000, network: 'Orange', status: 'pending', createdAt: new Date('2024-01-01'), updatedAt: new Date('2024-01-01'), confirmedBy: null, confirmedAt: null, rejectedBy: null, rejectedAt: null, rejectionReason: null, previousBalance: null, newBalance: null },
  { id: 'sr-2', dealerName: 'D2', dealerEmail: 'd2@t.com', targetStoreName: 'Boutique A', targetStoreId: 'store-a', requestType: 'liquidity_add', amount: 2000, network: 'Orange', status: 'confirmed', createdAt: new Date('2024-01-02'), updatedAt: new Date('2024-01-03'), confirmedBy: 'admin-uid', confirmedAt: new Date('2024-01-03'), rejectedBy: null, rejectedAt: null, rejectionReason: null, previousBalance: 1000, newBalance: 3000 },
]

function makeResult(requests, hasMore = false) {
  return { requests, lastDoc: hasMore ? { id: 'last' } : null, hasMore }
}

function renderWithRouter(Component, auth) {
  mocks.useAuth.mockReturnValue(auth)
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Component />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  // Défauts subscribe — ne font rien par défaut (tests configurent au besoin)
  mocks.subscribeDealerPendingCount.mockReturnValue(vi.fn())
  mocks.subscribeStorePendingCount.mockReturnValue(vi.fn())
  mocks.subscribeDealerRequests.mockImplementation(({ onUpdate }) => {
    onUpdate(makeResult([]))
    return vi.fn()
  })
  mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
    onUpdate(makeResult([]))
    return vi.fn()
  })
})

// ===========================================================================
// § DealerLayout — badge pending
// ===========================================================================

describe('TC-041-BADGE-D — DealerLayout badge dealer pending', () => {
  it('[BADGE-D-01] 0 pending → badge absent', async () => {
    mocks.subscribeDealerPendingCount.mockImplementation(({ onUpdate }) => {
      onUpdate(0)
      return vi.fn()
    })
    renderWithRouter(DealerLayout, DEALER_AUTH)
    await waitFor(() => screen.getByTestId('dealer-nav'))
    expect(screen.queryByTestId('dealer-pending-badge')).not.toBeInTheDocument()
  })

  it('[BADGE-D-02] 2 pending → badge "2" visible', async () => {
    mocks.subscribeDealerPendingCount.mockImplementation(({ onUpdate }) => {
      onUpdate(2)
      return vi.fn()
    })
    renderWithRouter(DealerLayout, DEALER_AUTH)
    await waitFor(() => {
      const badge = screen.getByTestId('dealer-pending-badge')
      expect(badge).toBeInTheDocument()
      expect(badge.textContent).toBe('2')
    })
  })

  it('[BADGE-D-03] 120 pending → badge "99+"', async () => {
    mocks.subscribeDealerPendingCount.mockImplementation(({ onUpdate }) => {
      onUpdate(120)
      return vi.fn()
    })
    renderWithRouter(DealerLayout, DEALER_AUTH)
    await waitFor(() => {
      const badge = screen.getByTestId('dealer-pending-badge')
      expect(badge.textContent).toBe('99+')
    })
  })

  it('[BADGE-D-04] aria-label présent avec décompte', async () => {
    mocks.subscribeDealerPendingCount.mockImplementation(({ onUpdate }) => {
      onUpdate(3)
      return vi.fn()
    })
    renderWithRouter(DealerLayout, DEALER_AUTH)
    await waitFor(() => {
      const badge = screen.getByTestId('dealer-pending-badge')
      expect(badge.getAttribute('aria-label')).toMatch(/3/)
    })
  })

  it('[BADGE-D-05] unsubscribe appelé au démontage du DealerLayout', () => {
    const unsub = vi.fn()
    mocks.subscribeDealerPendingCount.mockReturnValue(unsub)
    const { unmount } = renderWithRouter(DealerLayout, DEALER_AUTH)
    unmount()
    expect(unsub).toHaveBeenCalledTimes(1)
  })

  it('[BADGE-D-06] badge sur onglet "Demandes" uniquement', async () => {
    mocks.subscribeDealerPendingCount.mockImplementation(({ onUpdate }) => {
      onUpdate(5)
      return vi.fn()
    })
    renderWithRouter(DealerLayout, DEALER_AUTH)
    await waitFor(() => screen.getByTestId('dealer-pending-badge'))
    const nav = screen.getByTestId('dealer-nav')
    // Le badge est dans la nav
    expect(nav.contains(screen.getByTestId('dealer-pending-badge'))).toBe(true)
  })
})

// ===========================================================================
// § NavBar — badge store pending
// ===========================================================================

describe('TC-041-BADGE-S — NavBar badge store pending', () => {
  it('[BADGE-S-01] 0 pending → badge absent', async () => {
    mocks.subscribeStorePendingCount.mockImplementation(({ onUpdate }) => {
      onUpdate(0)
      return vi.fn()
    })
    renderWithRouter(NavBar, STORE_ADMIN_AUTH)
    // Le NavBar rend toujours
    expect(screen.queryByTestId('store-pending-badge')).not.toBeInTheDocument()
  })

  it('[BADGE-S-02] 2 pending → badge "2" visible', async () => {
    mocks.subscribeStorePendingCount.mockImplementation(({ onUpdate }) => {
      onUpdate(2)
      return vi.fn()
    })
    renderWithRouter(NavBar, STORE_ADMIN_AUTH)
    await waitFor(() => {
      const badge = screen.getByTestId('store-pending-badge')
      expect(badge).toBeInTheDocument()
      expect(badge.textContent).toBe('2')
    })
  })

  it('[BADGE-S-03] 120 pending → badge "99+"', async () => {
    mocks.subscribeStorePendingCount.mockImplementation(({ onUpdate }) => {
      onUpdate(120)
      return vi.fn()
    })
    renderWithRouter(NavBar, STORE_ADMIN_AUTH)
    await waitFor(() => {
      expect(screen.getByTestId('store-pending-badge').textContent).toBe('99+')
    })
  })

  it('[BADGE-S-04] aria-label présent', async () => {
    mocks.subscribeStorePendingCount.mockImplementation(({ onUpdate }) => {
      onUpdate(4)
      return vi.fn()
    })
    renderWithRouter(NavBar, STORE_ADMIN_AUTH)
    await waitFor(() => {
      expect(screen.getByTestId('store-pending-badge').getAttribute('aria-label')).toMatch(/4/)
    })
  })

  it('[BADGE-S-05] unsubscribe appelé au démontage du NavBar', () => {
    const unsub = vi.fn()
    mocks.subscribeStorePendingCount.mockReturnValue(unsub)
    const { unmount } = renderWithRouter(NavBar, STORE_ADMIN_AUTH)
    unmount()
    expect(unsub).toHaveBeenCalledTimes(1)
  })

  it('[BADGE-S-06] badge uniquement sur "Demandes Dealer" (pas sur les autres onglets)', async () => {
    mocks.subscribeStorePendingCount.mockImplementation(({ onUpdate }) => {
      onUpdate(7)
      return vi.fn()
    })
    renderWithRouter(NavBar, STORE_ADMIN_AUTH)
    await waitFor(() => screen.getByTestId('store-pending-badge'))
    // Un seul badge
    expect(screen.getAllByTestId('store-pending-badge')).toHaveLength(1)
  })
})

// ===========================================================================
// § DealerRequests — temps réel et dédup
// ===========================================================================

describe('TC-041-RT-D — DealerRequests temps réel', () => {
  beforeEach(() => {
    mocks.useAuth.mockReturnValue(DEALER_AUTH)
    mocks.subscribeDealerPendingCount.mockReturnValue(vi.fn())
  })

  it('[RT-D-01] mise à jour temps réel — snapshot refires met à jour la liste', async () => {
    let fireUpdate
    mocks.subscribeDealerRequests.mockImplementation(({ onUpdate }) => {
      fireUpdate = onUpdate
      onUpdate(makeResult([REQS_DEALER[0]]))
      return vi.fn()
    })
    render(
      <MemoryRouter><DealerRequests /></MemoryRouter>
    )
    await waitFor(() => screen.getByTestId('request-row-req-1'))

    // Snapshot se met à jour : req-1 confirmé + req-2 ajouté
    const updatedReqs = [
      { ...REQS_DEALER[0], status: 'confirmed' },
      REQS_DEALER[1],
    ]
    await act(async () => { fireUpdate(makeResult(updatedReqs)) })

    await waitFor(() => {
      expect(screen.getAllByTestId('status-badge-confirmed').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByTestId('request-row-req-2')).toBeInTheDocument()
    })
  })

  it('[RT-D-02] pas de doublons lors de pagination (dedup par id)', async () => {
    // Snapshot donne req-1
    mocks.subscribeDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeResult([REQS_DEALER[0]], true))
      return vi.fn()
    })
    // loadMore donne req-1 (doublon) + req-2
    mocks.listDealerRequests.mockResolvedValue(makeResult([REQS_DEALER[0], REQS_DEALER[1]]))

    render(<MemoryRouter><DealerRequests /></MemoryRouter>)
    await waitFor(() => screen.getByTestId('btn-load-more'))

    fireEvent.click(screen.getByTestId('btn-load-more'))

    await waitFor(() => screen.getByTestId('request-row-req-2'))

    // req-1 apparaît exactement une fois
    const rows = screen.getAllByTestId(/^request-row-req-1$/)
    expect(rows).toHaveLength(1)
    // req-2 aussi visible
    expect(screen.getByTestId('request-row-req-2')).toBeInTheDocument()
  })

  it('[RT-D-03] unsubscribe du listener principal appelé au démontage', () => {
    const unsub = vi.fn()
    mocks.subscribeDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeResult([]))
      return unsub
    })
    const { unmount } = render(<MemoryRouter><DealerRequests /></MemoryRouter>)
    unmount()
    expect(unsub).toHaveBeenCalledTimes(1)
  })

  it('[RT-D-04] changement de filtre → ancien listener fermé, nouveau ouvert', async () => {
    const unsub1 = vi.fn()
    const unsub2 = vi.fn()
    let callCount = 0
    mocks.subscribeDealerRequests.mockImplementation(({ onUpdate }) => {
      callCount++
      onUpdate(makeResult([]))
      return callCount === 1 ? unsub1 : unsub2
    })

    render(<MemoryRouter><DealerRequests /></MemoryRouter>)
    await waitFor(() => screen.getByTestId('filter-status'))

    fireEvent.change(screen.getByTestId('filter-status'), { target: { value: 'pending' } })

    await waitFor(() => {
      expect(unsub1).toHaveBeenCalledTimes(1)
      expect(mocks.subscribeDealerRequests.mock.calls.length).toBe(2)
    })
  })
})

// ===========================================================================
// § StoreAdminDealerRequests — temps réel et dédup
// ===========================================================================

describe('TC-041-RT-S — StoreAdminDealerRequests temps réel', () => {
  beforeEach(() => {
    mocks.useAuth.mockReturnValue(STORE_ADMIN_AUTH)
  })

  it('[RT-S-01] mise à jour temps réel — snapshot refires met à jour la liste', async () => {
    let fireUpdate
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      fireUpdate = onUpdate
      onUpdate(makeResult([REQS_STORE[0]]))
      return vi.fn()
    })
    render(<MemoryRouter><StoreAdminDealerRequests /></MemoryRouter>)
    await waitFor(() => screen.getByTestId('request-row-sr-1'))

    // Snapshot se met à jour : sr-1 confirmé + sr-2 ajouté
    const updated = [
      { ...REQS_STORE[0], status: 'confirmed' },
      REQS_STORE[1],
    ]
    await act(async () => { fireUpdate(makeResult(updated)) })

    await waitFor(() => {
      expect(screen.getByTestId('request-row-sr-2')).toBeInTheDocument()
    })
  })

  it('[RT-S-02] pas de doublons lors de pagination (dedup par id)', async () => {
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeResult([REQS_STORE[0]], true))
      return vi.fn()
    })
    // loadMore donne sr-1 (doublon) + sr-2
    mocks.listStoreAdminDealerRequests.mockResolvedValue(makeResult([REQS_STORE[0], REQS_STORE[1]]))

    render(<MemoryRouter><StoreAdminDealerRequests /></MemoryRouter>)
    await waitFor(() => screen.getByTestId('btn-load-more'))

    fireEvent.click(screen.getByTestId('btn-load-more'))

    await waitFor(() => screen.getByTestId('request-row-sr-2'))

    const rows = screen.getAllByTestId(/^request-row-sr-1$/)
    expect(rows).toHaveLength(1)
  })

  it('[RT-S-03] unsubscribe du listener principal appelé au démontage', () => {
    const unsub = vi.fn()
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeResult([]))
      return unsub
    })
    const { unmount } = render(<MemoryRouter><StoreAdminDealerRequests /></MemoryRouter>)
    unmount()
    expect(unsub).toHaveBeenCalledTimes(1)
  })

  it('[RT-S-04] changement de filtre → ancien listener fermé, nouveau ouvert', async () => {
    const unsub1 = vi.fn()
    let callCount = 0
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      callCount++
      onUpdate(makeResult([]))
      return callCount === 1 ? unsub1 : vi.fn()
    })

    render(<MemoryRouter><StoreAdminDealerRequests /></MemoryRouter>)
    await waitFor(() => screen.getByTestId('filter-status'))

    fireEvent.change(screen.getByTestId('filter-status'), { target: { value: 'pending' } })

    await waitFor(() => {
      expect(unsub1).toHaveBeenCalledTimes(1)
      expect(mocks.subscribeStoreAdminDealerRequests.mock.calls.length).toBe(2)
    })
  })
})

// ===========================================================================
// § mergeUniqueRequests — fonction pure (test unitaire direct)
// ===========================================================================

describe('TC-041-MERGE — mergeUniqueRequests (fonction pure)', () => {
  it('[MERGE-01] listes vides → tableau vide', () => {
    expect(mergeUniqueRequests([], [])).toEqual([])
  })

  it('[MERGE-02] extras vides → retourne uniquement realtime', () => {
    const rt = [{ id: 'a', status: 'pending' }]
    expect(mergeUniqueRequests(rt, [])).toEqual(rt)
  })

  it('[MERGE-03] sans doublon → concaténation complète', () => {
    const rt = [{ id: 'a' }]
    const extra = [{ id: 'b' }]
    const result = mergeUniqueRequests(rt, extra)
    expect(result.map(r => r.id)).toEqual(['a', 'b'])
  })

  it('[MERGE-04] doublon rt/extra → version realtime gagne', () => {
    const rt = [{ id: 'a', status: 'confirmed' }]
    const extra = [{ id: 'a', status: 'pending' }]
    const result = mergeUniqueRequests(rt, extra)
    expect(result).toHaveLength(1)
    expect(result[0].status).toBe('confirmed')
  })

  it('[MERGE-05] doublon interne aux extras → une seule occurrence (premier gagne)', () => {
    const rt = [{ id: 'x' }]
    const extra = [{ id: 'b', v: 1 }, { id: 'b', v: 2 }, { id: 'c' }]
    const result = mergeUniqueRequests(rt, extra)
    expect(result.map(r => r.id)).toEqual(['x', 'b', 'c'])
    expect(result.find(r => r.id === 'b').v).toBe(1)
  })

  it('[MERGE-06] ne mute pas les tableaux d\'entrée', () => {
    const rt = [{ id: 'a' }]
    const extra = [{ id: 'b' }]
    const lenRt = rt.length
    const lenExtra = extra.length
    mergeUniqueRequests(rt, extra)
    expect(rt).toHaveLength(lenRt)
    expect(extra).toHaveLength(lenExtra)
  })

  it('[MERGE-07] priorité snapshot — même id, statut mis à jour dans extras', () => {
    const rt = [{ id: 'req-1', status: 'confirmed' }]
    const extra = [{ id: 'req-1', status: 'pending' }, { id: 'req-2', status: 'pending' }]
    const result = mergeUniqueRequests(rt, extra)
    expect(result).toHaveLength(2)
    expect(result.find(r => r.id === 'req-1').status).toBe('confirmed')
  })
})

// ===========================================================================
// § Curseur pagination Dealer — régression Codex défaut 1
// ===========================================================================

describe('TC-041-CURSOR-D — Pagination curseur Dealer', () => {
  beforeEach(() => {
    mocks.useAuth.mockReturnValue(DEALER_AUTH)
    mocks.subscribeDealerPendingCount.mockReturnValue(vi.fn())
  })

  it('[CURSOR-D-01] second loadMore utilise le curseur de la page extra, pas du snapshot', async () => {
    const rtCursor = { id: 'rt-cursor' }
    const page2Cursor = { id: 'page2-cursor' }
    let fireSnapshot

    mocks.subscribeDealerRequests.mockImplementation(({ onUpdate }) => {
      fireSnapshot = onUpdate
      onUpdate({ requests: [REQS_DEALER[0]], lastDoc: rtCursor, hasMore: true })
      return vi.fn()
    })

    mocks.listDealerRequests
      .mockResolvedValueOnce({ requests: [REQS_DEALER[1]], lastDoc: page2Cursor, hasMore: true })
      .mockResolvedValueOnce({ requests: [], lastDoc: null, hasMore: false })

    render(<MemoryRouter><DealerRequests /></MemoryRouter>)
    await waitFor(() => screen.getByTestId('btn-load-more'))

    // Premier loadMore — doit utiliser rtCursor
    fireEvent.click(screen.getByTestId('btn-load-more'))
    await waitFor(() => screen.getByTestId('request-row-req-2'))

    // Snapshot re-fire avec rtCursor (ne doit pas écraser le curseur pagination)
    await act(async () => {
      fireSnapshot({ requests: [REQS_DEALER[0]], lastDoc: rtCursor, hasMore: true })
    })

    // Second loadMore — doit utiliser page2Cursor, pas rtCursor
    await waitFor(() => screen.getByTestId('btn-load-more'))
    fireEvent.click(screen.getByTestId('btn-load-more'))

    await waitFor(() => {
      expect(mocks.listDealerRequests.mock.calls.length).toBeGreaterThanOrEqual(2)
      const secondCall = mocks.listDealerRequests.mock.calls[1]
      expect(secondCall[0].lastDoc).toBe(page2Cursor)
      expect(secondCall[0].lastDoc).not.toBe(rtCursor)
    })
  })

  it('[CURSOR-D-02] ids uniques dans la liste finale après snapshot + loadMore', async () => {
    const rtCursor = { id: 'rt-cursor' }

    mocks.subscribeDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate({ requests: [REQS_DEALER[0]], lastDoc: rtCursor, hasMore: true })
      return vi.fn()
    })
    mocks.listDealerRequests.mockResolvedValueOnce({
      requests: [REQS_DEALER[1]],
      lastDoc: null,
      hasMore: false,
    })

    render(<MemoryRouter><DealerRequests /></MemoryRouter>)
    await waitFor(() => screen.getByTestId('btn-load-more'))
    fireEvent.click(screen.getByTestId('btn-load-more'))
    await waitFor(() => screen.getByTestId('request-row-req-2'))

    const rows = screen.getAllByTestId(/^request-row-/)
    const testids = rows.map(r => r.getAttribute('data-testid'))
    expect(new Set(testids).size).toBe(testids.length)
  })

  it('[CURSOR-D-03] doublon interne dans extras — getDocs renvoie deux fois le même id', async () => {
    const rtCursor = { id: 'rt-cursor' }

    mocks.subscribeDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate({ requests: [REQS_DEALER[0]], lastDoc: rtCursor, hasMore: true })
      return vi.fn()
    })
    // getDocs renvoie req-2 deux fois dans la même page
    mocks.listDealerRequests.mockResolvedValueOnce({
      requests: [REQS_DEALER[1], REQS_DEALER[1]],
      lastDoc: null,
      hasMore: false,
    })

    render(<MemoryRouter><DealerRequests /></MemoryRouter>)
    await waitFor(() => screen.getByTestId('btn-load-more'))
    fireEvent.click(screen.getByTestId('btn-load-more'))
    await waitFor(() => screen.getByTestId('request-row-req-2'))

    const req2Rows = screen.getAllByTestId(/^request-row-req-2$/)
    expect(req2Rows).toHaveLength(1)
  })

  it('[CURSOR-D-04] priorité snapshot — extra stale, snapshot met à jour le statut', async () => {
    const rtCursor = { id: 'rt-cursor' }
    let fireSnapshot

    mocks.subscribeDealerRequests.mockImplementation(({ onUpdate }) => {
      fireSnapshot = onUpdate
      onUpdate({ requests: [REQS_DEALER[0]], lastDoc: rtCursor, hasMore: true })
      return vi.fn()
    })
    // Extra contient req-1 avec statut stale
    mocks.listDealerRequests.mockResolvedValueOnce({
      requests: [{ ...REQS_DEALER[0], status: 'pending' }],
      lastDoc: null,
      hasMore: false,
    })

    render(<MemoryRouter><DealerRequests /></MemoryRouter>)
    await waitFor(() => screen.getByTestId('btn-load-more'))
    fireEvent.click(screen.getByTestId('btn-load-more'))

    // Snapshot confirme req-1
    await act(async () => {
      fireSnapshot({
        requests: [{ ...REQS_DEALER[0], status: 'confirmed' }],
        lastDoc: rtCursor,
        hasMore: false,
      })
    })

    await waitFor(() => {
      const req1Rows = screen.getAllByTestId(/^request-row-req-1$/)
      expect(req1Rows).toHaveLength(1)
      expect(screen.getByTestId('status-badge-confirmed')).toBeInTheDocument()
    })
  })
})

// ===========================================================================
// § Curseur pagination StoreAdmin — régression Codex défaut 1
// ===========================================================================

describe('TC-041-CURSOR-S — Pagination curseur StoreAdmin', () => {
  beforeEach(() => {
    mocks.useAuth.mockReturnValue(STORE_ADMIN_AUTH)
  })

  it('[CURSOR-S-01] second loadMore utilise le curseur de la page extra, pas du snapshot', async () => {
    const rtCursor = { id: 'rt-cursor' }
    const page2Cursor = { id: 'page2-cursor' }
    let fireSnapshot

    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      fireSnapshot = onUpdate
      onUpdate({ requests: [REQS_STORE[0]], lastDoc: rtCursor, hasMore: true })
      return vi.fn()
    })

    mocks.listStoreAdminDealerRequests
      .mockResolvedValueOnce({ requests: [REQS_STORE[1]], lastDoc: page2Cursor, hasMore: true })
      .mockResolvedValueOnce({ requests: [], lastDoc: null, hasMore: false })

    render(<MemoryRouter><StoreAdminDealerRequests /></MemoryRouter>)
    await waitFor(() => screen.getByTestId('btn-load-more'))
    fireEvent.click(screen.getByTestId('btn-load-more'))
    await waitFor(() => screen.getByTestId('request-row-sr-2'))

    await act(async () => {
      fireSnapshot({ requests: [REQS_STORE[0]], lastDoc: rtCursor, hasMore: true })
    })

    await waitFor(() => screen.getByTestId('btn-load-more'))
    fireEvent.click(screen.getByTestId('btn-load-more'))

    await waitFor(() => {
      expect(mocks.listStoreAdminDealerRequests.mock.calls.length).toBeGreaterThanOrEqual(2)
      const secondCall = mocks.listStoreAdminDealerRequests.mock.calls[1]
      expect(secondCall[0].lastDoc).toBe(page2Cursor)
      expect(secondCall[0].lastDoc).not.toBe(rtCursor)
    })
  })

  it('[CURSOR-S-02] doublon interne dans extras store — une seule occurrence', async () => {
    const rtCursor = { id: 'rt-cursor' }

    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate({ requests: [REQS_STORE[0]], lastDoc: rtCursor, hasMore: true })
      return vi.fn()
    })
    mocks.listStoreAdminDealerRequests.mockResolvedValueOnce({
      requests: [REQS_STORE[1], REQS_STORE[1]],
      lastDoc: null,
      hasMore: false,
    })

    render(<MemoryRouter><StoreAdminDealerRequests /></MemoryRouter>)
    await waitFor(() => screen.getByTestId('btn-load-more'))
    fireEvent.click(screen.getByTestId('btn-load-more'))
    await waitFor(() => screen.getByTestId('request-row-sr-2'))

    const sr2Rows = screen.getAllByTestId(/^request-row-sr-2$/)
    expect(sr2Rows).toHaveLength(1)
  })
})

// ===========================================================================
// § Badge stale et reset — régression Codex défaut 3
// ===========================================================================

describe('TC-041-BADGE-REGRESSION — Badge stale et reset profil', () => {
  it('[BADGE-E] dealer — profil devient inactif → badge disparaît', async () => {
    mocks.subscribeDealerPendingCount.mockImplementation(({ onUpdate }) => {
      onUpdate(5)
      return vi.fn()
    })
    mocks.useAuth.mockReturnValue(DEALER_AUTH)

    const { rerender } = render(<MemoryRouter><DealerLayout /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('dealer-pending-badge').textContent).toBe('5'))

    // Profil devient inactif → subscribeDealer appelé → onUpdate(0) par le service
    mocks.subscribeDealerPendingCount.mockImplementation(({ onUpdate }) => {
      onUpdate(0)
      return vi.fn()
    })
    mocks.useAuth.mockReturnValue({
      ...DEALER_AUTH,
      userProfile: { ...DEALER_AUTH.userProfile, active: false },
    })

    rerender(<MemoryRouter><DealerLayout /></MemoryRouter>)

    await waitFor(() => {
      expect(screen.queryByTestId('dealer-pending-badge')).not.toBeInTheDocument()
    })
  })

  it('[BADGE-F] boutique — storeId manquant → badge disparaît', async () => {
    mocks.subscribeStorePendingCount.mockImplementation(({ onUpdate }) => {
      onUpdate(3)
      return vi.fn()
    })
    mocks.useAuth.mockReturnValue(STORE_ADMIN_AUTH)

    const { rerender } = render(<MemoryRouter><NavBar /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('store-pending-badge').textContent).toBe('3'))

    // storeId manquant → subscribeStore appelé → onUpdate(0) par le service
    mocks.subscribeStorePendingCount.mockImplementation(({ onUpdate }) => {
      onUpdate(0)
      return vi.fn()
    })
    mocks.useAuth.mockReturnValue({
      ...STORE_ADMIN_AUTH,
      userProfile: { ...STORE_ADMIN_AUTH.userProfile, storeId: undefined },
    })

    rerender(<MemoryRouter><NavBar /></MemoryRouter>)

    await waitFor(() => {
      expect(screen.queryByTestId('store-pending-badge')).not.toBeInTheDocument()
    })
  })

  it('[BADGE-G-D] erreur listener dealer → onUpdate(0) → badge disparaît', async () => {
    let fireUpdate
    mocks.subscribeDealerPendingCount.mockImplementation(({ onUpdate }) => {
      fireUpdate = onUpdate
      onUpdate(5)
      return vi.fn()
    })
    renderWithRouter(DealerLayout, DEALER_AUTH)
    await waitFor(() => expect(screen.getByTestId('dealer-pending-badge').textContent).toBe('5'))

    // Le service appelle onUpdate(0) depuis le callback d'erreur Firestore
    await act(async () => { fireUpdate(0) })

    await waitFor(() => {
      expect(screen.queryByTestId('dealer-pending-badge')).not.toBeInTheDocument()
    })
  })

  it('[BADGE-G-S] erreur listener boutique → onUpdate(0) → badge disparaît', async () => {
    let fireUpdate
    mocks.subscribeStorePendingCount.mockImplementation(({ onUpdate }) => {
      fireUpdate = onUpdate
      onUpdate(7)
      return vi.fn()
    })
    renderWithRouter(NavBar, STORE_ADMIN_AUTH)
    await waitFor(() => expect(screen.getByTestId('store-pending-badge').textContent).toBe('7'))

    await act(async () => { fireUpdate(0) })

    await waitFor(() => {
      expect(screen.queryByTestId('store-pending-badge')).not.toBeInTheDocument()
    })
  })

  it('[BADGE-H-D] unsubscribe dealer au changement de currentUser', () => {
    const unsub = vi.fn()
    mocks.subscribeDealerPendingCount.mockReturnValue(unsub)
    mocks.useAuth.mockReturnValue(DEALER_AUTH)

    const { rerender } = render(<MemoryRouter><DealerLayout /></MemoryRouter>)

    mocks.useAuth.mockReturnValue({ ...DEALER_AUTH, currentUser: { uid: 'other-uid' } })
    rerender(<MemoryRouter><DealerLayout /></MemoryRouter>)

    expect(unsub).toHaveBeenCalledTimes(1)
  })

  it('[BADGE-H-S] unsubscribe store au démontage NavBar', () => {
    const unsub = vi.fn()
    mocks.subscribeStorePendingCount.mockReturnValue(unsub)
    const { unmount } = renderWithRouter(NavBar, STORE_ADMIN_AUTH)
    unmount()
    expect(unsub).toHaveBeenCalledTimes(1)
  })
})

// ===========================================================================
// § hasLoadedExtraPagesRef — régression "dernière page" Dealer
// ===========================================================================

describe('TC-041-LASTPAGE-D — Stabilité après dernière page Dealer', () => {
  beforeEach(() => {
    mocks.useAuth.mockReturnValue(DEALER_AUTH)
    mocks.subscribeDealerPendingCount.mockReturnValue(vi.fn())
  })

  it('[LASTPAGE-D-01] snapshot post-dernière-page ne réaffiche pas le bouton Charger plus', async () => {
    const rtCursor = { id: 'rt-cursor' }
    let fireSnapshot

    mocks.subscribeDealerRequests.mockImplementation(({ onUpdate }) => {
      fireSnapshot = onUpdate
      onUpdate({ requests: [REQS_DEALER[0]], lastDoc: rtCursor, hasMore: true })
      return vi.fn()
    })
    // loadMore final : lastDoc null, hasMore false
    mocks.listDealerRequests.mockResolvedValueOnce({
      requests: [REQS_DEALER[1]],
      lastDoc: null,
      hasMore: false,
    })

    render(<MemoryRouter><DealerRequests /></MemoryRouter>)
    await waitFor(() => screen.getByTestId('btn-load-more'))
    fireEvent.click(screen.getByTestId('btn-load-more'))

    // Bouton disparaît après la dernière page
    await waitFor(() => {
      expect(screen.queryByTestId('btn-load-more')).not.toBeInTheDocument()
    })

    // Nouveau snapshot de première page avec hasMore true
    await act(async () => {
      fireSnapshot({ requests: [REQS_DEALER[0]], lastDoc: rtCursor, hasMore: true })
    })

    // Le bouton ne doit pas réapparaître
    expect(screen.queryByTestId('btn-load-more')).not.toBeInTheDocument()
    // Un seul appel listDealerRequests (le loadMore initial)
    expect(mocks.listDealerRequests.mock.calls.length).toBe(1)
  })

  it('[LASTPAGE-D-02] loadMore supplémentaire ne repart pas depuis realtimeLastDocRef', async () => {
    const rtCursor = { id: 'rt-cursor' }
    let fireSnapshot

    mocks.subscribeDealerRequests.mockImplementation(({ onUpdate }) => {
      fireSnapshot = onUpdate
      onUpdate({ requests: [REQS_DEALER[0]], lastDoc: rtCursor, hasMore: true })
      return vi.fn()
    })
    mocks.listDealerRequests.mockResolvedValueOnce({
      requests: [REQS_DEALER[1]],
      lastDoc: null,
      hasMore: false,
    })

    render(<MemoryRouter><DealerRequests /></MemoryRouter>)
    await waitFor(() => screen.getByTestId('btn-load-more'))
    fireEvent.click(screen.getByTestId('btn-load-more'))
    await waitFor(() => expect(screen.queryByTestId('btn-load-more')).not.toBeInTheDocument())

    // Snapshot re-fire
    await act(async () => {
      fireSnapshot({ requests: [REQS_DEALER[0]], lastDoc: rtCursor, hasMore: true })
    })

    // Toujours exactement 1 appel (le loadMore initial) — le snapshot ne doit
    // pas déclencher un second appel depuis realtimeLastDocRef.
    expect(mocks.listDealerRequests.mock.calls.length).toBe(1)
  })
})

// ===========================================================================
// § hasLoadedExtraPagesRef — régression "dernière page" StoreAdmin
// ===========================================================================

describe('TC-041-LASTPAGE-S — Stabilité après dernière page StoreAdmin', () => {
  beforeEach(() => {
    mocks.useAuth.mockReturnValue(STORE_ADMIN_AUTH)
  })

  it('[LASTPAGE-S-01] snapshot post-dernière-page ne réaffiche pas le bouton Charger plus', async () => {
    const rtCursor = { id: 'rt-cursor' }
    let fireSnapshot

    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      fireSnapshot = onUpdate
      onUpdate({ requests: [REQS_STORE[0]], lastDoc: rtCursor, hasMore: true })
      return vi.fn()
    })
    mocks.listStoreAdminDealerRequests.mockResolvedValueOnce({
      requests: [REQS_STORE[1]],
      lastDoc: null,
      hasMore: false,
    })

    render(<MemoryRouter><StoreAdminDealerRequests /></MemoryRouter>)
    await waitFor(() => screen.getByTestId('btn-load-more'))
    fireEvent.click(screen.getByTestId('btn-load-more'))

    await waitFor(() => {
      expect(screen.queryByTestId('btn-load-more')).not.toBeInTheDocument()
    })

    await act(async () => {
      fireSnapshot({ requests: [REQS_STORE[0]], lastDoc: rtCursor, hasMore: true })
    })

    expect(screen.queryByTestId('btn-load-more')).not.toBeInTheDocument()
    expect(mocks.listStoreAdminDealerRequests.mock.calls.length).toBe(1)
  })

  it('[LASTPAGE-S-02] aucun appel listStoreAdminDealerRequests avec rtCursor après fin de pagination', async () => {
    const rtCursor = { id: 'rt-cursor' }
    let fireSnapshot

    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      fireSnapshot = onUpdate
      onUpdate({ requests: [REQS_STORE[0]], lastDoc: rtCursor, hasMore: true })
      return vi.fn()
    })
    mocks.listStoreAdminDealerRequests.mockResolvedValueOnce({
      requests: [REQS_STORE[1]],
      lastDoc: null,
      hasMore: false,
    })

    render(<MemoryRouter><StoreAdminDealerRequests /></MemoryRouter>)
    await waitFor(() => screen.getByTestId('btn-load-more'))
    fireEvent.click(screen.getByTestId('btn-load-more'))
    await waitFor(() => expect(screen.queryByTestId('btn-load-more')).not.toBeInTheDocument())

    await act(async () => {
      fireSnapshot({ requests: [REQS_STORE[0]], lastDoc: rtCursor, hasMore: true })
    })

    expect(mocks.listStoreAdminDealerRequests.mock.calls.length).toBe(1)
  })
})

// ===========================================================================
// § mergeUniqueRequests — éléments sans id (régression correction 2)
// ===========================================================================

describe('TC-041-MERGE-NOID — mergeUniqueRequests sans id valide', () => {
  it('[MERGE-08] deux extras sans id sont tous les deux conservés', () => {
    const result = mergeUniqueRequests([], [{}, {}])
    expect(result).toHaveLength(2)
  })

  it('[MERGE-09] un snapshot sans id et un extra sans id sont tous les deux conservés', () => {
    const result = mergeUniqueRequests([{}], [{}])
    expect(result).toHaveLength(2)
  })

  it('[MERGE-10] ids valides dédupliqués, éléments sans id tous conservés', () => {
    const result = mergeUniqueRequests(
      [{ id: 'a' }, {}],
      [{ id: 'a' }, {}, { id: 'b' }]
    )
    // 'a' n'apparaît qu'une fois (snapshot gagne)
    expect(result.filter(r => r.id === 'a')).toHaveLength(1)
    // 'b' est présent
    expect(result.find(r => r.id === 'b')).toBeDefined()
    // Les deux sans id sont conservés (un du snapshot, un de l'extra)
    expect(result.filter(r => !r.id)).toHaveLength(2)
    expect(result).toHaveLength(4)
  })

  it('[MERGE-11] id null traité comme absent — conservé sans déduplication', () => {
    const result = mergeUniqueRequests([{ id: null }], [{ id: null }])
    expect(result).toHaveLength(2)
  })

  it('[MERGE-12] id numérique traité comme absent — conservé sans déduplication', () => {
    const result = mergeUniqueRequests([], [{ id: 42 }, { id: 42 }])
    expect(result).toHaveLength(2)
  })
})

// ===========================================================================
// § Course asynchrone loadMore / changement de contexte — Dealer
// ===========================================================================

describe('TC-041-RACE-D — Course asynchrone loadMore/filtre Dealer', () => {
  beforeEach(() => {
    mocks.useAuth.mockReturnValue(DEALER_AUTH)
    mocks.subscribeDealerPendingCount.mockReturnValue(vi.fn())
  })

  it('[RACE-D-01] ancien loadMore résolu après changement de filtre — aucune donnée stale', async () => {
    const rtCursor = { id: 'rt-cursor' }
    const STALE = { id: 'stale-req', targetStoreName: 'STALE_STORE', requestType: 'stock_add', amount: 9999, network: 'Orange', status: 'pending', createdAt: new Date() }
    let subscribeCallCount = 0

    mocks.subscribeDealerRequests.mockImplementation(({ onUpdate }) => {
      subscribeCallCount++
      if (subscribeCallCount === 1) {
        // Contexte initial : req-1, hasMore
        onUpdate({ requests: [REQS_DEALER[0]], lastDoc: rtCursor, hasMore: true })
      } else {
        // Nouveau contexte (après changement de filtre) : liste vide, hasMore false
        onUpdate({ requests: [], lastDoc: null, hasMore: false })
      }
      return vi.fn()
    })

    let resolveLoadMore
    mocks.listDealerRequests.mockReturnValueOnce(
      new Promise(res => { resolveLoadMore = res })
    )

    render(<MemoryRouter><DealerRequests /></MemoryRouter>)
    await waitFor(() => screen.getByTestId('btn-load-more'))

    // Déclencher loadMore — promesse en suspens
    fireEvent.click(screen.getByTestId('btn-load-more'))

    // Changer le filtre avant résolution → génération incrémentée
    await waitFor(() => screen.getByTestId('filter-status'))
    fireEvent.change(screen.getByTestId('filter-status'), { target: { value: 'pending' } })

    // Résoudre l'ancienne promesse avec des données stale
    await act(async () => {
      resolveLoadMore({ requests: [STALE], lastDoc: { id: 'stale-cursor' }, hasMore: true })
    })

    // La donnée stale ne doit pas apparaître
    expect(screen.queryByTestId('request-row-stale-req')).not.toBeInTheDocument()
    // Le nouveau contexte n'a pas de données → aucune ligne
    expect(screen.queryByTestId('request-row-req-1')).not.toBeInTheDocument()
    // hasMore du nouveau contexte (false) → bouton Charger plus absent
    expect(screen.queryByTestId('btn-load-more')).not.toBeInTheDocument()
    // Un seul appel listDealerRequests (le loadMore obsolète), pas de second appel
    expect(mocks.listDealerRequests.mock.calls.length).toBe(1)
  })

  it('[RACE-D-02] ancien loadMore rejette après changement de filtre — erreur stale non affichée', async () => {
    const rtCursor = { id: 'rt-cursor' }
    let subscribeCallCount = 0

    mocks.subscribeDealerRequests.mockImplementation(({ onUpdate }) => {
      subscribeCallCount++
      onUpdate(subscribeCallCount === 1
        ? { requests: [REQS_DEALER[0]], lastDoc: rtCursor, hasMore: true }
        : { requests: [], lastDoc: null, hasMore: false }
      )
      return vi.fn()
    })

    let rejectLoadMore
    mocks.listDealerRequests.mockReturnValueOnce(
      new Promise((_, rej) => { rejectLoadMore = rej })
    )

    render(<MemoryRouter><DealerRequests /></MemoryRouter>)
    await waitFor(() => screen.getByTestId('btn-load-more'))
    fireEvent.click(screen.getByTestId('btn-load-more'))

    // Changer le filtre avant rejet
    await waitFor(() => screen.getByTestId('filter-status'))
    fireEvent.change(screen.getByTestId('filter-status'), { target: { value: 'pending' } })

    // Rejeter l'ancienne promesse
    await act(async () => {
      rejectLoadMore(new Error('Erreur stale'))
    })

    // L'erreur stale ne doit pas s'afficher dans le nouveau contexte
    await waitFor(() => {
      const text = document.body.textContent
      expect(text).not.toMatch(/erreur stale/i)
    })
    // loadingMore est false (reset par le useEffect)
    expect(screen.queryByTestId('btn-load-more')).not.toBeInTheDocument()
  })

  it('[RACE-D-03] loadingMore remis à false immédiatement lors du changement de contexte', async () => {
    const rtCursor = { id: 'rt-cursor' }
    let subscribeCallCount = 0

    mocks.subscribeDealerRequests.mockImplementation(({ onUpdate }) => {
      subscribeCallCount++
      onUpdate(subscribeCallCount === 1
        ? { requests: [REQS_DEALER[0]], lastDoc: rtCursor, hasMore: true }
        : { requests: [], lastDoc: null, hasMore: false }
      )
      return vi.fn()
    })

    // loadMore ne se résout jamais pendant ce test
    mocks.listDealerRequests.mockReturnValueOnce(new Promise(() => {}))

    render(<MemoryRouter><DealerRequests /></MemoryRouter>)
    await waitFor(() => screen.getByTestId('btn-load-more'))
    fireEvent.click(screen.getByTestId('btn-load-more'))

    // Changer le filtre → le useEffect remet loadingMore à false
    await waitFor(() => screen.getByTestId('filter-status'))
    fireEvent.change(screen.getByTestId('filter-status'), { target: { value: 'pending' } })

    // Après le changement de contexte, aucun spinner bloquant
    // (le composant ne doit pas rester figé en état loadingMore)
    await waitFor(() => {
      // Le nouveau contexte s'est chargé normalement
      expect(screen.queryByTestId('btn-load-more')).not.toBeInTheDocument()
      // Pas de spinner permanent (loadingMore=false dans le nouveau contexte)
      expect(document.querySelector('[data-testid="loading-more"]')).toBeNull()
    })
  })
})

// ===========================================================================
// § Course asynchrone loadMore / changement de contexte — StoreAdmin
// ===========================================================================

describe('TC-041-RACE-S — Course asynchrone loadMore/filtre StoreAdmin', () => {
  beforeEach(() => {
    mocks.useAuth.mockReturnValue(STORE_ADMIN_AUTH)
  })

  it('[RACE-S-01] ancien loadMore résolu après changement de typeFilter — aucune donnée stale', async () => {
    const rtCursor = { id: 'rt-cursor' }
    const STALE = { ...REQS_STORE[0], id: 'stale-sr', dealerName: 'STALE_DEALER' }
    let subscribeCallCount = 0

    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      subscribeCallCount++
      if (subscribeCallCount === 1) {
        onUpdate({ requests: [REQS_STORE[0]], lastDoc: rtCursor, hasMore: true })
      } else {
        onUpdate({ requests: [], lastDoc: null, hasMore: false })
      }
      return vi.fn()
    })

    let resolveLoadMore
    mocks.listStoreAdminDealerRequests.mockReturnValueOnce(
      new Promise(res => { resolveLoadMore = res })
    )

    render(<MemoryRouter><StoreAdminDealerRequests /></MemoryRouter>)
    await waitFor(() => screen.getByTestId('btn-load-more'))
    fireEvent.click(screen.getByTestId('btn-load-more'))

    // Changer typeFilter avant résolution
    await waitFor(() => screen.getByTestId('filter-type'))
    fireEvent.change(screen.getByTestId('filter-type'), { target: { value: 'stock_add' } })

    // Résoudre l'ancienne promesse avec données stale
    await act(async () => {
      resolveLoadMore({ requests: [STALE], lastDoc: { id: 'stale-cursor' }, hasMore: true })
    })

    // La donnée stale ne doit pas apparaître
    expect(screen.queryByTestId('request-row-stale-sr')).not.toBeInTheDocument()
    // Nouveau contexte vide → aucun bouton Charger plus
    expect(screen.queryByTestId('btn-load-more')).not.toBeInTheDocument()
    expect(mocks.listStoreAdminDealerRequests.mock.calls.length).toBe(1)
  })

  it('[RACE-S-02] ancien loadMore rejette après changement de statusFilter — erreur stale non affichée', async () => {
    const rtCursor = { id: 'rt-cursor' }
    let subscribeCallCount = 0

    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      subscribeCallCount++
      onUpdate(subscribeCallCount === 1
        ? { requests: [REQS_STORE[0]], lastDoc: rtCursor, hasMore: true }
        : { requests: [], lastDoc: null, hasMore: false }
      )
      return vi.fn()
    })

    let rejectLoadMore
    mocks.listStoreAdminDealerRequests.mockReturnValueOnce(
      new Promise((_, rej) => { rejectLoadMore = rej })
    )

    render(<MemoryRouter><StoreAdminDealerRequests /></MemoryRouter>)
    await waitFor(() => screen.getByTestId('btn-load-more'))
    fireEvent.click(screen.getByTestId('btn-load-more'))

    // Changer le statusFilter avant rejet
    await waitFor(() => screen.getByTestId('filter-status'))
    fireEvent.change(screen.getByTestId('filter-status'), { target: { value: 'confirmed' } })

    await act(async () => {
      rejectLoadMore(new Error('Erreur stale boutique'))
    })

    await waitFor(() => {
      const text = document.body.textContent
      expect(text).not.toMatch(/erreur stale boutique/i)
    })
    expect(screen.queryByTestId('btn-load-more')).not.toBeInTheDocument()
  })
})

// ===========================================================================
// § Protection démontage — loadMore en vol lors de l'unmount
// ===========================================================================

describe('TC-041-UNMOUNT-D — Démontage Dealer avec loadMore en vol', () => {
  beforeEach(() => {
    mocks.useAuth.mockReturnValue(DEALER_AUTH)
    mocks.subscribeDealerPendingCount.mockReturnValue(vi.fn())
  })

  it('[UNMOUNT-D-01] loadMore résolu après démontage — pas de crash', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const rtCursor = { id: 'rt-cursor' }

    mocks.subscribeDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate({ requests: [REQS_DEALER[0]], lastDoc: rtCursor, hasMore: true })
      return vi.fn()
    })

    let resolveLoadMore
    mocks.listDealerRequests.mockReturnValueOnce(
      new Promise(res => { resolveLoadMore = res })
    )

    const { unmount } = render(<MemoryRouter><DealerRequests /></MemoryRouter>)
    await waitFor(() => screen.getByTestId('btn-load-more'))
    fireEvent.click(screen.getByTestId('btn-load-more'))

    // Démonter avant que la promesse se résout
    unmount()

    // Résoudre la promesse après démontage — ne doit pas lever d'exception
    await expect(
      act(async () => {
        resolveLoadMore({ requests: [REQS_DEALER[1]], lastDoc: null, hasMore: false })
      })
    ).resolves.not.toThrow()

    // Aucun warning React sur mise à jour d'état après démontage
    const warnings = errSpy.mock.calls.map(c => String(c[0]))
    expect(warnings.some(w => /unmounted|Warning/i.test(w))).toBe(false)
    errSpy.mockRestore()
  })

  it('[UNMOUNT-D-02] loadMore rejette après démontage — pas de crash', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const rtCursor = { id: 'rt-cursor' }

    mocks.subscribeDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate({ requests: [REQS_DEALER[0]], lastDoc: rtCursor, hasMore: true })
      return vi.fn()
    })

    let rejectLoadMore
    mocks.listDealerRequests.mockReturnValueOnce(
      new Promise((_, rej) => { rejectLoadMore = rej })
    )

    const { unmount } = render(<MemoryRouter><DealerRequests /></MemoryRouter>)
    await waitFor(() => screen.getByTestId('btn-load-more'))
    fireEvent.click(screen.getByTestId('btn-load-more'))

    unmount()

    await expect(
      act(async () => {
        rejectLoadMore(new Error('réseau coupé'))
      })
    ).resolves.not.toThrow()

    const warnings = errSpy.mock.calls.map(c => String(c[0]))
    expect(warnings.some(w => /unmounted|Warning/i.test(w))).toBe(false)
    errSpy.mockRestore()
  })
})

describe('TC-041-UNMOUNT-S — Démontage StoreAdmin avec loadMore en vol', () => {
  beforeEach(() => {
    mocks.useAuth.mockReturnValue(STORE_ADMIN_AUTH)
  })

  it('[UNMOUNT-S-01] loadMore résolu après démontage — pas de crash', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const rtCursor = { id: 'rt-cursor' }

    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate({ requests: [REQS_STORE[0]], lastDoc: rtCursor, hasMore: true })
      return vi.fn()
    })

    let resolveLoadMore
    mocks.listStoreAdminDealerRequests.mockReturnValueOnce(
      new Promise(res => { resolveLoadMore = res })
    )

    const { unmount } = render(<MemoryRouter><StoreAdminDealerRequests /></MemoryRouter>)
    await waitFor(() => screen.getByTestId('btn-load-more'))
    fireEvent.click(screen.getByTestId('btn-load-more'))

    unmount()

    await expect(
      act(async () => {
        resolveLoadMore({ requests: [REQS_STORE[1]], lastDoc: null, hasMore: false })
      })
    ).resolves.not.toThrow()

    const warnings = errSpy.mock.calls.map(c => String(c[0]))
    expect(warnings.some(w => /unmounted|Warning/i.test(w))).toBe(false)
    errSpy.mockRestore()
  })

  it('[UNMOUNT-S-02] loadMore rejette après démontage — pas de crash', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const rtCursor = { id: 'rt-cursor' }

    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate({ requests: [REQS_STORE[0]], lastDoc: rtCursor, hasMore: true })
      return vi.fn()
    })

    let rejectLoadMore
    mocks.listStoreAdminDealerRequests.mockReturnValueOnce(
      new Promise((_, rej) => { rejectLoadMore = rej })
    )

    const { unmount } = render(<MemoryRouter><StoreAdminDealerRequests /></MemoryRouter>)
    await waitFor(() => screen.getByTestId('btn-load-more'))
    fireEvent.click(screen.getByTestId('btn-load-more'))

    unmount()

    await expect(
      act(async () => {
        rejectLoadMore(new Error('réseau coupé store'))
      })
    ).resolves.not.toThrow()

    const warnings = errSpy.mock.calls.map(c => String(c[0]))
    expect(warnings.some(w => /unmounted|Warning/i.test(w))).toBe(false)
    errSpy.mockRestore()
  })
})
