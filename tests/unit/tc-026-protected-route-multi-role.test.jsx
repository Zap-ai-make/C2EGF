/**
 * TC-026 — ProtectedRoute : comportement par rôle et par état Auth
 *
 * ProtectedRoute est un alias de RoleGuard restreint à store_admin.
 * Les rôles non autorisés (system_manager, dealer) sont désormais REDIRIGÉS
 * vers leur espace propre, et non plus affichés sur une page d'attente.
 *
 * Tous les rendus utilisent MemoryRouter car RoleGuard peut émettre <Navigate>.
 */

// ---------------------------------------------------------------------------
// Mocks — doivent précéder tous les imports applicatifs
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({})),
  setLogLevel: vi.fn(),
  getApp: vi.fn(() => ({})),
}))

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  connectAuthEmulator: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(() => Promise.resolve()),
  onAuthStateChanged: vi.fn(() => vi.fn()),
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
  setDoc: vi.fn(() => Promise.resolve()),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  writeBatch: vi.fn(() => ({ set: vi.fn(), commit: vi.fn(() => Promise.resolve()) })),
  serverTimestamp: vi.fn(() => 'SERVER_TS'),
  onSnapshot: vi.fn(() => vi.fn()),
  query: vi.fn(),
  orderBy: vi.fn(),
  where: vi.fn(),
  getDocs: vi.fn(),
  runTransaction: vi.fn(),
}))

vi.mock('../../src/config/firebase', () => ({
  auth: {},
  db: {},
  firebaseInfo: { projectId: 'test', isDev: true, useEmulators: false },
  default: {},
}))

vi.mock('../../src/services/firestore', () => ({
  firestoreService: { setActiveStore: vi.fn() },
}))

vi.mock('../../src/utils/authHelpers', () => ({
  getAuthErrorMessage: vi.fn((code, msg) => msg || code || 'Erreur'),
}))

vi.mock('../../src/components/auth/AuthPage', () => ({
  default: () => <div data-testid="auth-page">PAGE_AUTH</div>,
}))

// ---------------------------------------------------------------------------
// Imports après les mocks
// ---------------------------------------------------------------------------

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { useAuth } from '../../src/context/AuthContext'
import ProtectedRoute from '../../src/components/auth/ProtectedRoute'
import { AUTH_ROLES } from '../../src/constants/authMessages'

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: vi.fn(),
  AuthContext: React.createContext(null),
  resolveAuthenticatedProfile: vi.fn(),
  AuthProvider: ({ children }) => children,
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CHILDREN_TESTID = 'store-private-content'
const Children = () => <div data-testid={CHILDREN_TESTID}>CONTENU BOUTIQUE</div>

const defaultCtx = () => ({
  currentUser: null,
  userProfile: null,
  activeStore: null,
  loading: false,
  error: '',
  authError: '',
  role: null,
  isStoreAdmin: false,
  isSystemManager: false,
  isDealer: false,
  hasStoreContext: false,
  logout: vi.fn(),
})

const storeAdminCtx = (storeOverride = {}) => ({
  ...defaultCtx(),
  currentUser: { uid: 'uid-sa' },
  userProfile: { role: AUTH_ROLES.STORE_ADMIN, storeId: 'store-abc', name: 'Admin' },
  activeStore: { id: 'store-abc', name: 'Boutique Alpha', active: true, ...storeOverride },
  role: AUTH_ROLES.STORE_ADMIN,
  isStoreAdmin: true,
  hasStoreContext: true,
})

const systemManagerCtx = () => ({
  ...defaultCtx(),
  currentUser: { uid: 'uid-sm' },
  userProfile: { role: AUTH_ROLES.SYSTEM_MANAGER, name: 'Gérant' },
  activeStore: null,
  role: AUTH_ROLES.SYSTEM_MANAGER,
  isSystemManager: true,
})

const dealerCtx = () => ({
  ...defaultCtx(),
  currentUser: { uid: 'uid-dl' },
  userProfile: { role: AUTH_ROLES.DEALER, name: 'Dealer' },
  activeStore: null,
  role: AUTH_ROLES.DEALER,
  isDealer: true,
})

/**
 * Rend ProtectedRoute dans un MemoryRouter avec des routes destination visibles.
 * Les destinations /admin et /dealer permettent de vérifier que les redirections
 * aboutissent sur le bon espace.
 */
const renderRoute = (initialPath = '/') =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <Children />
            </ProtectedRoute>
          }
        />
        <Route path="/admin" element={<div data-testid="admin-space">ESPACE ADMIN</div>} />
        <Route path="/dealer" element={<div data-testid="dealer-space">ESPACE DEALER</div>} />
      </Routes>
    </MemoryRouter>
  )

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TC-026 — ProtectedRoute : comportement par rôle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // =========================================================================
  // 1. Loading
  // =========================================================================

  it('1. loading → spinner visible, children absents', () => {
    useAuth.mockReturnValue({ ...defaultCtx(), loading: true })
    renderRoute()

    expect(screen.getByText(/chargement/i)).toBeInTheDocument()
    expect(screen.queryByTestId(CHILDREN_TESTID)).not.toBeInTheDocument()
  })

  // =========================================================================
  // 2. Non authentifié
  // =========================================================================

  it('2. non authentifié → AuthPage visible, children absents', () => {
    useAuth.mockReturnValue(defaultCtx())
    renderRoute()

    expect(screen.getByTestId('auth-page')).toBeInTheDocument()
    expect(screen.queryByTestId(CHILDREN_TESTID)).not.toBeInTheDocument()
  })

  // =========================================================================
  // 3. Profil absent (currentUser présent mais userProfile null)
  // =========================================================================

  it('3. profil absent → accès bloqué, children absents', () => {
    useAuth.mockReturnValue({
      ...defaultCtx(),
      currentUser: { uid: 'uid-x' },
      userProfile: null,
      role: null,
    })
    renderRoute()

    expect(screen.getByText(/accès bloqué/i)).toBeInTheDocument()
    expect(screen.queryByTestId(CHILDREN_TESTID)).not.toBeInTheDocument()
  })

  // =========================================================================
  // 4. Rôle inconnu
  // =========================================================================

  it('4. rôle inconnu → accès bloqué, children absents', () => {
    useAuth.mockReturnValue({
      ...defaultCtx(),
      currentUser: { uid: 'uid-bad' },
      userProfile: { role: 'ghost_admin', name: 'Ghost' },
      role: 'ghost_admin',
    })
    renderRoute()

    expect(screen.getByText(/accès bloqué/i)).toBeInTheDocument()
    expect(screen.queryByTestId(CHILDREN_TESTID)).not.toBeInTheDocument()
  })

  // =========================================================================
  // 5. store_admin sans activeStore
  // =========================================================================

  it('5. store_admin sans activeStore → accès bloqué, children absents', () => {
    useAuth.mockReturnValue({
      ...storeAdminCtx(),
      activeStore: null,
      hasStoreContext: false,
    })
    renderRoute()

    expect(screen.getByText(/accès bloqué/i)).toBeInTheDocument()
    expect(screen.queryByTestId(CHILDREN_TESTID)).not.toBeInTheDocument()
  })

  // =========================================================================
  // 6. store_admin avec boutique active → children rendus
  // =========================================================================

  it('6. store_admin avec boutique active → children rendus', () => {
    useAuth.mockReturnValue(storeAdminCtx())
    renderRoute()

    expect(screen.getByTestId(CHILDREN_TESTID)).toBeInTheDocument()
    expect(screen.getByText('CONTENU BOUTIQUE')).toBeInTheDocument()
  })

  // =========================================================================
  // 7. system_manager → redirigé vers /admin (plus de page d'attente)
  // =========================================================================

  it('7. system_manager sur route boutique → redirigé vers /admin', () => {
    useAuth.mockReturnValue(systemManagerCtx())
    renderRoute()

    expect(screen.getByTestId('admin-space')).toBeInTheDocument()
    expect(screen.queryByTestId(CHILDREN_TESTID)).not.toBeInTheDocument()
  })

  // =========================================================================
  // 8. dealer → redirigé vers /dealer (plus de page d'attente)
  // =========================================================================

  it('8. dealer sur route boutique → redirigé vers /dealer', () => {
    useAuth.mockReturnValue(dealerCtx())
    renderRoute()

    expect(screen.getByTestId('dealer-space')).toBeInTheDocument()
    expect(screen.queryByTestId(CHILDREN_TESTID)).not.toBeInTheDocument()
  })

  // =========================================================================
  // 9. Bouton déconnexion sur accès bloqué (profil absent)
  // =========================================================================

  it('9. profil absent → bouton déconnexion présent', () => {
    useAuth.mockReturnValue({
      ...defaultCtx(),
      currentUser: { uid: 'uid-x' },
      userProfile: null,
    })
    renderRoute()

    expect(screen.getByRole('button', { name: /se déconnecter/i })).toBeInTheDocument()
  })

  // =========================================================================
  // 10. Clic déconnexion appelle logout (accès bloqué)
  // =========================================================================

  it('10. profil absent : clic déconnexion appelle logout', () => {
    const logout = vi.fn()
    useAuth.mockReturnValue({
      ...defaultCtx(),
      currentUser: { uid: 'uid-x' },
      userProfile: null,
      logout,
    })
    renderRoute()

    fireEvent.click(screen.getByRole('button', { name: /se déconnecter/i }))

    expect(logout).toHaveBeenCalledTimes(1)
  })

  // =========================================================================
  // 11. Aucune donnée boutique visible pour les rôles globaux (redirigés)
  // =========================================================================

  it('11. system_manager → aucun contenu boutique dans le DOM', () => {
    useAuth.mockReturnValue(systemManagerCtx())
    renderRoute()

    expect(screen.queryByTestId(CHILDREN_TESTID)).not.toBeInTheDocument()
    expect(screen.queryByText('CONTENU BOUTIQUE')).not.toBeInTheDocument()
  })

  it('11b. dealer → aucun contenu boutique dans le DOM', () => {
    useAuth.mockReturnValue(dealerCtx())
    renderRoute()

    expect(screen.queryByTestId(CHILDREN_TESTID)).not.toBeInTheDocument()
    expect(screen.queryByText('CONTENU BOUTIQUE')).not.toBeInTheDocument()
  })

  // =========================================================================
  // 12. Changement store_admin → dealer retire immédiatement les children
  // =========================================================================

  it('12. store_admin → dealer : children retirés, redirection /dealer', () => {
    useAuth.mockReturnValue(storeAdminCtx())
    const { rerender } = renderRoute()

    expect(screen.getByTestId(CHILDREN_TESTID)).toBeInTheDocument()

    useAuth.mockReturnValue(dealerCtx())
    rerender(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <Children />
              </ProtectedRoute>
            }
          />
          <Route path="/admin" element={<div data-testid="admin-space">ESPACE ADMIN</div>} />
          <Route path="/dealer" element={<div data-testid="dealer-space">ESPACE DEALER</div>} />
        </Routes>
      </MemoryRouter>
    )

    expect(screen.queryByTestId(CHILDREN_TESTID)).not.toBeInTheDocument()
    expect(screen.getByTestId('dealer-space')).toBeInTheDocument()
  })

  // =========================================================================
  // Cas supplémentaires
  // =========================================================================

  it('A. erreur affichée dans accès bloqué si authError présent', () => {
    useAuth.mockReturnValue({
      ...defaultCtx(),
      currentUser: { uid: 'uid-err' },
      userProfile: null,
      authError: 'Boutique inactive',
    })
    renderRoute()

    expect(screen.getByText('Boutique inactive')).toBeInTheDocument()
  })

  it('B. store_admin avec boutique inactive → accès bloqué (activeStore null)', () => {
    useAuth.mockReturnValue({
      ...storeAdminCtx(),
      activeStore: null,
      hasStoreContext: false,
      authError: 'Boutique inactive',
    })
    renderRoute()

    expect(screen.getByText(/accès bloqué/i)).toBeInTheDocument()
    expect(screen.queryByTestId(CHILDREN_TESTID)).not.toBeInTheDocument()
  })
})
