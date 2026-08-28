/**
 * TC-033 — Tests UI StoreAdminDealerRequests + StoreAdminDealerRequestDetails
 *
 * Couvre :
 *   Liste : loading, empty, erreur, demandes rendues, montant/date/statut/type formatés,
 *           données incomplètes, filtres, Charger plus, anti-double-clic, actualiser, lien détail.
 *   Détail : loading, not found, erreur, demande complète, champs null, motif rejet, retour liste.
 *   Accessibilité : labels filtres, aria-label sur boutons, absence de boutons d'action.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// ---------------------------------------------------------------------------
// Mocks hoistés
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  listStoreAdminDealerRequests: vi.fn(),
  subscribeStoreAdminDealerRequests: vi.fn(),
  getStoreAdminDealerRequestById: vi.fn(),
  useAuth: vi.fn(),
  navigate: vi.fn(),
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
  serverTimestamp: vi.fn(() => 'SERVER_TS'), onSnapshot: vi.fn(() => vi.fn()),
  query: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), startAfter: vi.fn(),
  runTransaction: vi.fn(),
}))
vi.mock('../../src/config/firebase', () => ({
  auth: {}, db: {}, functions: {},
  firebaseInfo: { projectId: 'test', isDev: true, useEmulators: false },
  default: {},
}))

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  connectFunctionsEmulator: vi.fn(),
  httpsCallable: vi.fn(),
}))

vi.mock('../../src/services/storeDealerRequestCommandService', () => ({
  confirmDealerRequestCommand: vi.fn(),
  rejectDealerRequestCommand: vi.fn(),
  mapCallableError: vi.fn(err => new Error(err?.message ?? 'Erreur')),
}))

vi.mock('../../src/services/storeAdminDealerService', () => ({
  listStoreAdminDealerRequests: mocks.listStoreAdminDealerRequests,
  subscribeStoreAdminDealerRequests: mocks.subscribeStoreAdminDealerRequests,
  getStoreAdminDealerRequestById: mocks.getStoreAdminDealerRequestById,
}))

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: () => mocks.useAuth(),
  AuthContext: React.createContext(null),
  resolveAuthenticatedProfile: vi.fn(),
  AuthProvider: ({ children }) => children,
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => mocks.navigate }
})

// ---------------------------------------------------------------------------
// Imports après mocks
// ---------------------------------------------------------------------------

import StoreAdminDealerRequests from '../../src/pages/store/StoreAdminDealerRequests'
import StoreAdminDealerRequestDetails from '../../src/pages/store/StoreAdminDealerRequestDetails'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STORE_ADMIN_AUTH = {
  currentUser: { uid: 'store-admin-uid' },
  userProfile: {
    role: 'store_admin',
    active: true,
    email: 'admin@boutique.com',
    name: 'Admin',
    storeId: 'store-alpha',
  },
}

const REQS = [
  {
    id: 'req-1',
    dealerName: 'Dealer Alpha',
    dealerEmail: 'dalpha@test.com',
    targetStoreName: 'Boutique Alpha',
    targetStoreId: 'store-alpha',
    requestType: 'stock_add',
    amount: 50000,
    network: 'Orange',
    status: 'pending',
    createdAt: new Date('2024-06-01'),
    updatedAt: new Date('2024-06-01'),
    confirmedBy: null, confirmedAt: null,
    rejectedBy: null, rejectedAt: null,
    rejectionReason: null,
    previousBalance: null, newBalance: null,
  },
  {
    id: 'req-2',
    dealerName: 'Dealer Beta',
    dealerEmail: 'dbeta@test.com',
    targetStoreName: 'Boutique Alpha',
    targetStoreId: 'store-alpha',
    requestType: 'liquidity_add',
    amount: 20000,
    network: 'Orange',
    status: 'confirmed',
    createdAt: new Date('2024-06-02'),
    updatedAt: new Date('2024-06-03'),
    confirmedBy: 'manager-uid', confirmedAt: new Date('2024-06-03'),
    rejectedBy: null, rejectedAt: null,
    rejectionReason: null,
    previousBalance: 10000, newBalance: 30000,
  },
  {
    id: 'req-3',
    dealerName: 'Dealer Gamma',
    dealerEmail: 'dgamma@test.com',
    targetStoreName: 'Boutique Alpha',
    targetStoreId: 'store-alpha',
    requestType: 'stock_add',
    amount: 5000,
    network: 'Orange',
    status: 'rejected',
    createdAt: new Date('2024-06-04'),
    updatedAt: new Date('2024-06-04'),
    confirmedBy: null, confirmedAt: null,
    rejectedBy: 'manager-uid', rejectedAt: new Date('2024-06-04'),
    rejectionReason: 'Solde insuffisant',
    previousBalance: null, newBalance: null,
  },
]

function makeListResult(requests = REQS, hasMore = false) {
  return { requests, hasMore, lastDoc: hasMore ? { id: 'last' } : null }
}

function renderList(initialPath = '/dealer-requests') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <StoreAdminDealerRequests />
    </MemoryRouter>
  )
}

function renderDetails(requestId = 'req-1') {
  return render(
    <MemoryRouter initialEntries={[`/dealer-requests/${requestId}`]}>
      <Routes>
        <Route path="/dealer-requests/:requestId" element={<StoreAdminDealerRequestDetails />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.useAuth.mockReturnValue(STORE_ADMIN_AUTH)
  // Défaut subscribe : liste vide, résolu immédiatement
  mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
    onUpdate({ requests: [], lastDoc: null, hasMore: false })
    return vi.fn()
  })
})

// ===========================================================================
// § StoreAdminDealerRequests — Liste
// ===========================================================================

describe('TC-033-LIST — StoreAdminDealerRequests (liste)', () => {
  it('[LIST-01] état initial → composant rendu', async () => {
    renderList()
    expect(screen.getByTestId('store-dealer-requests')).toBeInTheDocument()
  })

  it('[LIST-02] chargement → aria-busy visible (subscribe en attente)', async () => {
    // Subscribe qui ne rappelle jamais onUpdate → loading reste true
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(() => vi.fn())
    renderList()
    await waitFor(() => {
      const c = screen.getByTestId('store-dealer-requests')
      // Le test s'appelle « aria-busy visible » : le repli par classe CSS
      // contredisait son propre intitulé. Il partait de toute façon — Tailwind
      // balaie les tests, et cette chaîne générait une règle d'animation
      // inconditionnelle dans le CSS livré.
      expect(!!c.querySelector('[aria-busy="true"]')).toBe(true)
    })
  })

  it('[LIST-03] liste vide → empty state visible', async () => {
    renderList()
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument())
  })

  it('[LIST-04] erreur service → message d\'erreur', async () => {
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onError }) => {
      onError(new Error('Accès refusé'))
      return vi.fn()
    })
    renderList()
    await waitFor(() => {
      expect(screen.getByTestId('store-dealer-requests').textContent).toMatch(/erreur|accès|impossible/i)
    })
  })

  it('[LIST-05] demandes rendues — tableau présent avec lignes', async () => {
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeListResult(REQS))
      return vi.fn()
    })
    renderList()
    await waitFor(() => {
      expect(screen.getByTestId('requests-table')).toBeInTheDocument()
      expect(screen.getByTestId('request-row-req-1')).toBeInTheDocument()
      expect(screen.getByTestId('request-row-req-2')).toBeInTheDocument()
    })
  })

  it('[LIST-06] objets plats (pas de data()) rendu sans erreur', async () => {
    const flatReqs = [{ ...REQS[0] }]
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeListResult(flatReqs))
      return vi.fn()
    })
    renderList()
    await waitFor(() => expect(screen.getByTestId('request-row-req-1')).toBeInTheDocument())
  })

  it('[LIST-07] montant formaté en FCFA', async () => {
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeListResult([REQS[0]]))
      return vi.fn()
    })
    renderList()
    await waitFor(() => screen.getByTestId('requests-table'))
    expect(screen.getByTestId('store-dealer-requests').textContent).toMatch(/50.000 FCFA|50 000 FCFA/)
  })

  it('[LIST-08] statut pending → badge "En attente"', async () => {
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeListResult([REQS[0]]))
      return vi.fn()
    })
    renderList()
    await waitFor(() => screen.getByTestId('status-badge-pending'))
    expect(screen.getByTestId('status-badge-pending').textContent).toBe('En attente')
  })

  it('[LIST-09] statut confirmed → badge "Confirmée"', async () => {
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeListResult([REQS[1]]))
      return vi.fn()
    })
    renderList()
    await waitFor(() => screen.getByTestId('status-badge-confirmed'))
    expect(screen.getByTestId('status-badge-confirmed').textContent).toBe('Confirmée')
  })

  it('[LIST-10] statut rejected → badge "Rejetée"', async () => {
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeListResult([REQS[2]]))
      return vi.fn()
    })
    renderList()
    await waitFor(() => screen.getByTestId('status-badge-rejected'))
    expect(screen.getByTestId('status-badge-rejected').textContent).toBe('Rejetée')
  })

  it('[LIST-11] type stock_add → "Ajout de stock"', async () => {
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeListResult([REQS[0]]))
      return vi.fn()
    })
    renderList()
    await waitFor(() => screen.getByTestId('requests-table'))
    expect(screen.getByTestId('store-dealer-requests').textContent).toContain('Ajout de stock')
  })

  it('[LIST-12] type liquidity_add → "Ajout de liquidité"', async () => {
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeListResult([REQS[1]]))
      return vi.fn()
    })
    renderList()
    await waitFor(() => screen.getByTestId('requests-table'))
    expect(screen.getByTestId('store-dealer-requests').textContent).toContain('Ajout de liquidité')
  })

  it('[LIST-13] statut inconnu → "Statut inconnu" affiché', async () => {
    const req = { ...REQS[0], id: 'req-unknown', status: 'ghost_status' }
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeListResult([req]))
      return vi.fn()
    })
    renderList()
    await waitFor(() => screen.getByTestId('requests-table'))
    expect(screen.getByTestId('store-dealer-requests').textContent).toContain('Statut inconnu')
  })

  it('[LIST-14] données incomplètes — dealerName absent → "Dealer inconnu"', async () => {
    const req = { ...REQS[0], id: 'req-no-name', dealerName: undefined }
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeListResult([req]))
      return vi.fn()
    })
    renderList()
    await waitFor(() => screen.getByTestId('requests-table'))
    expect(screen.getByTestId('store-dealer-requests').textContent).toContain('Dealer inconnu')
  })

  it('[LIST-15] montant null → "Montant indisponible" (pas "0 FCFA")', async () => {
    const req = { ...REQS[0], id: 'req-no-amount', amount: null }
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeListResult([req]))
      return vi.fn()
    })
    renderList()
    await waitFor(() => screen.getByTestId('requests-table'))
    const text = screen.getByTestId('store-dealer-requests').textContent
    expect(text).toContain('Montant indisponible')
    expect(text).not.toContain('0 FCFA')
  })

  it('[LIST-16] filtre statut → subscribeStoreAdminDealerRequests appelé avec statusFilter=pending', async () => {
    renderList()
    await waitFor(() => screen.getByTestId('filter-status'))

    fireEvent.change(screen.getByTestId('filter-status'), { target: { value: 'pending' } })

    await waitFor(() => {
      expect(mocks.subscribeStoreAdminDealerRequests.mock.calls.some(c => c[0]?.statusFilter === 'pending')).toBe(true)
    })
  })

  it('[LIST-17] filtre type → subscribeStoreAdminDealerRequests appelé avec typeFilter=stock_add', async () => {
    renderList()
    await waitFor(() => screen.getByTestId('filter-type'))

    fireEvent.change(screen.getByTestId('filter-type'), { target: { value: 'stock_add' } })

    await waitFor(() => {
      expect(mocks.subscribeStoreAdminDealerRequests.mock.calls.some(c => c[0]?.typeFilter === 'stock_add')).toBe(true)
    })
  })

  it('[LIST-18] changement de filtre → subscribe rappelé (re-souscription)', async () => {
    renderList()
    await waitFor(() => screen.getByTestId('filter-status'))

    const callsBefore = mocks.subscribeStoreAdminDealerRequests.mock.calls.length
    fireEvent.change(screen.getByTestId('filter-status'), { target: { value: 'pending' } })

    await waitFor(() => {
      expect(mocks.subscribeStoreAdminDealerRequests.mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })

  it('[LIST-19] hasMore=true → bouton "Charger plus" visible', async () => {
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeListResult(REQS, true))
      return vi.fn()
    })
    renderList()
    await waitFor(() => expect(screen.getByTestId('btn-load-more')).toBeInTheDocument())
  })

  it('[LIST-20] double-clic "Charger plus" → appel unique supplémentaire (anti-double-clic)', async () => {
    let resolveLoadMore
    const pendingLoadMore = new Promise(r => { resolveLoadMore = r })

    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeListResult(REQS, true))
      return vi.fn()
    })
    mocks.listStoreAdminDealerRequests
      .mockReturnValueOnce(pendingLoadMore)
      .mockResolvedValue(makeListResult([], false))

    renderList()
    await waitFor(() => screen.getByTestId('btn-load-more'))

    fireEvent.click(screen.getByTestId('btn-load-more'))

    const btn = screen.getByTestId('btn-load-more')
    fireEvent.click(btn)

    await act(async () => { resolveLoadMore(makeListResult([], false)) })

    // listStoreAdminDealerRequests (loadMore) appelé au plus 1 fois
    expect(mocks.listStoreAdminDealerRequests.mock.calls.length).toBeLessThanOrEqual(1)
  })

  it('[LIST-21] bouton actualiser → re-souscription déclenchée', async () => {
    renderList()
    await waitFor(() => screen.getByTestId('btn-refresh'))

    const callsBefore = mocks.subscribeStoreAdminDealerRequests.mock.calls.length
    fireEvent.click(screen.getByTestId('btn-refresh'))

    await waitFor(() => {
      expect(mocks.subscribeStoreAdminDealerRequests.mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })

  it('[LIST-22] bouton "Voir le détail" → navigate vers /dealer-requests/:id', async () => {
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeListResult([REQS[0]]))
      return vi.fn()
    })
    renderList()
    await waitFor(() => screen.getByTestId('btn-detail-req-1'))
    fireEvent.click(screen.getByTestId('btn-detail-req-1'))
    expect(mocks.navigate).toHaveBeenCalledWith('/dealer-requests/req-1')
  })

  it('[LIST-23] aucun bouton Confirmer, Rejeter, Modifier, Supprimer', async () => {
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeListResult(REQS))
      return vi.fn()
    })
    renderList()
    await waitFor(() => screen.getByTestId('requests-table'))

    const buttons = screen.queryAllByRole('button')
    const forbidden = buttons.filter(b =>
      /confirmer|rejeter|modifier|supprimer|valider|annuler la demande/i.test(b.textContent)
    )
    expect(forbidden).toHaveLength(0)
  })

  it('[LIST-24] label filtre statut accessible', async () => {
    renderList()
    await waitFor(() => screen.getByTestId('filter-status'))
    expect(screen.getByLabelText(/statut/i)).toBeInTheDocument()
  })

  it('[LIST-25] label filtre type accessible', async () => {
    renderList()
    await waitFor(() => screen.getByTestId('filter-type'))
    expect(screen.getByLabelText(/type/i)).toBeInTheDocument()
  })
})

// ===========================================================================
// § StoreAdminDealerRequestDetails — Détail
// ===========================================================================

describe('TC-033-DETAIL — StoreAdminDealerRequestDetails', () => {
  it('[DET-01] chargement → skeleton visible', async () => {
    let resolve
    mocks.getStoreAdminDealerRequestById.mockReturnValue(new Promise(r => { resolve = r }))
    renderDetails('req-1')
    const container = screen.getByTestId('store-dealer-request-details')
    // L'attente s'assère sur ce que l'utilisateur PERÇOIT — une région annoncée
    // occupée —, pas sur la classe qui la fait clignoter. C'est la règle du
    // Lot 0 : jamais d'assertion par classe CSS. Elle avait échappé ici, et
    // c'est le passage de l'animation sous `motion-safe:` qui l'a révélé.
    expect(!!container.querySelector('[aria-busy="true"]')).toBe(true)
    await act(async () => { resolve(REQS[0]) })
  })

  it('[DET-02] demande introuvable → erreur affichée', async () => {
    mocks.getStoreAdminDealerRequestById.mockRejectedValue(new Error('Cette demande est introuvable.'))
    renderDetails('req-missing')
    await waitFor(() => {
      expect(screen.getByTestId('store-dealer-request-details').textContent).toMatch(/introuvable|erreur/i)
    })
  })

  it('[DET-03] erreur permission → message d\'erreur', async () => {
    mocks.getStoreAdminDealerRequestById.mockRejectedValue(new Error('Accès refusé'))
    renderDetails('req-1')
    await waitFor(() => {
      expect(screen.getByTestId('store-dealer-request-details').textContent).toMatch(/erreur|accès/i)
    })
  })

  it('[DET-04] demande complète → tous les champs affichés', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue({ ...REQS[1], id: 'req-2' })
    renderDetails('req-2')
    await waitFor(() => {
      const text = screen.getByTestId('store-dealer-request-details').textContent
      expect(text).toContain('Dealer Beta')
      expect(text).toContain('dbeta@test.com')
      expect(text).toContain('Boutique Alpha')
      expect(text).toContain('Ajout de liquidité')
    })
  })

  it('[DET-05] demande pending → badge "En attente" visible', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue({ ...REQS[0], id: 'req-1' })
    renderDetails('req-1')
    await waitFor(() => {
      expect(screen.getByTestId('store-dealer-request-details').textContent).toContain('En attente')
    })
  })

  it('[DET-06] demande confirmed → badge "Confirmée" et confirmé par visible', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue({ ...REQS[1], id: 'req-2' })
    renderDetails('req-2')
    await waitFor(() => {
      const text = screen.getByTestId('store-dealer-request-details').textContent
      expect(text).toContain('Confirmée')
      expect(text).toContain('manager-uid')
    })
  })

  it('[DET-07] demande rejected → motif du rejet affiché', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue({ ...REQS[2], id: 'req-3' })
    renderDetails('req-3')
    await waitFor(() => {
      const text = screen.getByTestId('store-dealer-request-details').textContent
      expect(text).toContain('Rejetée')
      expect(text).toContain('Solde insuffisant')
    })
  })

  it('[DET-08] champs null → "—" affiché (pas undefined ou vide)', async () => {
    const req = {
      ...REQS[0], id: 'req-null',
      confirmedBy: null, confirmedAt: null,
      rejectedBy: null, rejectedAt: null,
      rejectionReason: null,
      previousBalance: null, newBalance: null,
    }
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(req)
    renderDetails('req-null')
    await waitFor(() => {
      const text = screen.getByTestId('store-dealer-request-details').textContent
      expect(text).toContain('—')
    })
  })

  it('[DET-09] demande confirmed → aucun bouton Confirmer/Rejeter/Modifier', async () => {
    // Les actions sont masquées pour les demandes déjà traitées (confirmed, rejected).
    // TC-039 couvre la visibilité pour le statut pending.
    mocks.getStoreAdminDealerRequestById.mockResolvedValue({ ...REQS[1], id: 'req-2' })
    renderDetails('req-2')
    await waitFor(() => screen.getByTestId('btn-back'))

    expect(screen.queryByTestId('action-buttons')).not.toBeInTheDocument()
    const buttons = screen.queryAllByRole('button')
    const forbidden = buttons.filter(b =>
      /confirmer la demande|rejeter la demande|modifier|supprimer/i.test(b.textContent)
    )
    expect(forbidden).toHaveLength(0)
  })

  it('[DET-10] bouton retour → navigate vers /dealer-requests', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue({ ...REQS[0], id: 'req-1' })
    renderDetails('req-1')
    await waitFor(() => screen.getByTestId('btn-back'))
    fireEvent.click(screen.getByTestId('btn-back'))
    expect(mocks.navigate).toHaveBeenCalledWith('/dealer-requests')
  })

  it('[DET-11] bouton retour en cas d\'erreur → navigate vers /dealer-requests', async () => {
    mocks.getStoreAdminDealerRequestById.mockRejectedValue(new Error('introuvable'))
    renderDetails('req-missing')
    await waitFor(() => screen.getByTestId('btn-back-error'))
    fireEvent.click(screen.getByTestId('btn-back-error'))
    expect(mocks.navigate).toHaveBeenCalledWith('/dealer-requests')
  })

  it('[DET-12] dealerEmail absent → "Email indisponible"', async () => {
    const req = { ...REQS[0], id: 'req-noemail', dealerEmail: undefined }
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(req)
    renderDetails('req-noemail')
    await waitFor(() => {
      expect(screen.getByTestId('store-dealer-request-details').textContent).toContain('Email indisponible')
    })
  })
})

// ===========================================================================
// § Robustesse affichage montant (isValidStoredAmount / formatStoredAmount)
// ===========================================================================

describe('TC-033-AMT — Robustesse affichage montant (liste + détail)', () => {
  // Valeurs valides
  it('[AMT-01] amount=0 → "0 FCFA" (liste)', async () => {
    const req = { ...REQS[0], id: 'req-amt0', amount: 0 }
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeListResult([req]))
      return vi.fn()
    })
    renderList()
    await waitFor(() => screen.getByTestId('requests-table'))
    expect(screen.getByTestId('store-dealer-requests').textContent).toContain('0 FCFA')
  })

  it('[AMT-02] amount=1000 → formaté en FCFA (liste)', async () => {
    const req = { ...REQS[0], id: 'req-amt1000', amount: 1000 }
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeListResult([req]))
      return vi.fn()
    })
    renderList()
    await waitFor(() => screen.getByTestId('requests-table'))
    // fr-FR utilise un espace insecable comme separateur de milliers
    expect(screen.getByTestId('store-dealer-requests').textContent).toMatch(/1\s*000 FCFA/)
  })

  // Valeurs invalides — liste
  it('[AMT-03] amount="" → "Montant indisponible" (liste)', async () => {
    const req = { ...REQS[0], id: 'req-str', amount: '' }
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeListResult([req]))
      return vi.fn()
    })
    renderList()
    await waitFor(() => screen.getByTestId('requests-table'))
    expect(screen.getByTestId('store-dealer-requests').textContent).toContain('Montant indisponible')
  })

  it('[AMT-04] amount="   " → "Montant indisponible" (liste)', async () => {
    const req = { ...REQS[0], id: 'req-spaces', amount: '   ' }
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeListResult([req]))
      return vi.fn()
    })
    renderList()
    await waitFor(() => screen.getByTestId('requests-table'))
    expect(screen.getByTestId('store-dealer-requests').textContent).toContain('Montant indisponible')
  })

  it('[AMT-05] amount="1000" (string) → "Montant indisponible" (liste)', async () => {
    const req = { ...REQS[0], id: 'req-strnum', amount: '1000' }
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeListResult([req]))
      return vi.fn()
    })
    renderList()
    await waitFor(() => screen.getByTestId('requests-table'))
    expect(screen.getByTestId('store-dealer-requests').textContent).toContain('Montant indisponible')
  })

  it('[AMT-06] amount=false → "Montant indisponible" (liste)', async () => {
    const req = { ...REQS[0], id: 'req-bool', amount: false }
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeListResult([req]))
      return vi.fn()
    })
    renderList()
    await waitFor(() => screen.getByTestId('requests-table'))
    expect(screen.getByTestId('store-dealer-requests').textContent).toContain('Montant indisponible')
  })

  it('[AMT-07] amount=null → "Montant indisponible" (liste)', async () => {
    const req = { ...REQS[0], id: 'req-null2', amount: null }
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeListResult([req]))
      return vi.fn()
    })
    renderList()
    await waitFor(() => screen.getByTestId('requests-table'))
    expect(screen.getByTestId('store-dealer-requests').textContent).toContain('Montant indisponible')
  })

  it('[AMT-08] amount=undefined → "Montant indisponible" (liste)', async () => {
    const req = { ...REQS[0], id: 'req-undef', amount: undefined }
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeListResult([req]))
      return vi.fn()
    })
    renderList()
    await waitFor(() => screen.getByTestId('requests-table'))
    expect(screen.getByTestId('store-dealer-requests').textContent).toContain('Montant indisponible')
  })

  it('[AMT-09] amount=NaN → "Montant indisponible" (liste)', async () => {
    const req = { ...REQS[0], id: 'req-nan', amount: NaN }
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeListResult([req]))
      return vi.fn()
    })
    renderList()
    await waitFor(() => screen.getByTestId('requests-table'))
    expect(screen.getByTestId('store-dealer-requests').textContent).toContain('Montant indisponible')
  })

  it('[AMT-10] amount=Infinity → "Montant indisponible" (liste)', async () => {
    const req = { ...REQS[0], id: 'req-inf', amount: Infinity }
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeListResult([req]))
      return vi.fn()
    })
    renderList()
    await waitFor(() => screen.getByTestId('requests-table'))
    expect(screen.getByTestId('store-dealer-requests').textContent).toContain('Montant indisponible')
  })

  it('[AMT-11] amount=-1 → "Montant indisponible" (liste)', async () => {
    const req = { ...REQS[0], id: 'req-neg', amount: -1 }
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeListResult([req]))
      return vi.fn()
    })
    renderList()
    await waitFor(() => screen.getByTestId('requests-table'))
    expect(screen.getByTestId('store-dealer-requests').textContent).toContain('Montant indisponible')
  })

  it('[AMT-12] amount=1.5 → "Montant indisponible" (liste)', async () => {
    const req = { ...REQS[0], id: 'req-dec', amount: 1.5 }
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeListResult([req]))
      return vi.fn()
    })
    renderList()
    await waitFor(() => screen.getByTestId('requests-table'))
    expect(screen.getByTestId('store-dealer-requests').textContent).toContain('Montant indisponible')
  })

  it('[AMT-13] amount={} → "Montant indisponible" (liste)', async () => {
    const req = { ...REQS[0], id: 'req-obj', amount: {} }
    mocks.subscribeStoreAdminDealerRequests.mockImplementation(({ onUpdate }) => {
      onUpdate(makeListResult([req]))
      return vi.fn()
    })
    renderList()
    await waitFor(() => screen.getByTestId('requests-table'))
    expect(screen.getByTestId('store-dealer-requests').textContent).toContain('Montant indisponible')
  })

  // Valeurs invalides — page détail
  it('[AMT-14] amount="" dans détail → "Montant indisponible"', async () => {
    const req = { ...REQS[0], id: 'req-det-str', amount: '' }
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(req)
    renderDetails('req-det-str')
    await waitFor(() => {
      expect(screen.getByTestId('store-dealer-request-details').textContent).toContain('Montant indisponible')
    })
  })

  it('[AMT-15] amount=null dans détail → "Montant indisponible"', async () => {
    const req = { ...REQS[0], id: 'req-det-null', amount: null }
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(req)
    renderDetails('req-det-null')
    await waitFor(() => {
      expect(screen.getByTestId('store-dealer-request-details').textContent).toContain('Montant indisponible')
    })
  })

  it('[AMT-16] amount=0 dans détail → "0 FCFA" (valide)', async () => {
    const req = { ...REQS[0], id: 'req-det-zero', amount: 0 }
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(req)
    renderDetails('req-det-zero')
    await waitFor(() => {
      expect(screen.getByTestId('store-dealer-request-details').textContent).toContain('0 FCFA')
    })
  })
})
