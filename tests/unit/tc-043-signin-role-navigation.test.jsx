/**
 * TC-043 — SignInForm : navigation role-aware après connexion
 *
 * Couvre :
 *   - Après login réussi, l'utilisateur est redirigé vers son espace propre
 *   - system_manager → /admin (pas de flash /profil)
 *   - store_admin → /
 *   - dealer → /dealer
 *   - Si signin échoue, pas de navigation
 *   - Aucun flash "Accès bloqué" pendant le chargement
 *   - Cloisonnement : dealer et store_admin bloqués sur routes admin
 *   - store_admin et dealer bloqués sur routes croisées
 */

// ---------------------------------------------------------------------------
// Mocks
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

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { useAuth } from '../../src/context/AuthContext'
import { AUTH_ROLES } from '../../src/constants/authMessages'
import RoleGuard from '../../src/components/auth/RoleGuard'
import SignInForm from '../../src/components/auth/SignInForm'

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: vi.fn(),
  AuthContext: React.createContext(null),
  resolveAuthenticatedProfile: vi.fn(),
  AuthProvider: ({ children }) => children,
}))

// Mock ForgotPasswordModal pour isoler SignInForm
vi.mock('../../src/components/auth/ForgotPasswordModal', () => ({
  default: () => null,
}))

// Mock useFormValidation pour contrôler la soumission du formulaire
vi.mock('../../src/hooks/useFormValidation', () => ({
  useFormValidation: vi.fn(),
}))

import { useFormValidation } from '../../src/hooks/useFormValidation'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function LocationDisplay() {
  const { pathname } = useLocation()
  return <div data-testid="location">{pathname}</div>
}

const defaultCtx = (overrides = {}) => ({
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
  signin: vi.fn(),
  ...overrides,
})

const storeAdminCtx = () => defaultCtx({
  currentUser: { uid: 'uid-sa' },
  userProfile: { role: AUTH_ROLES.STORE_ADMIN, storeId: 'store-abc', name: 'Admin' },
  activeStore: { id: 'store-abc', name: 'Boutique Alpha', active: true },
  role: AUTH_ROLES.STORE_ADMIN,
  isStoreAdmin: true,
  hasStoreContext: true,
})

const systemManagerCtx = () => defaultCtx({
  currentUser: { uid: 'uid-sm' },
  userProfile: { role: AUTH_ROLES.SYSTEM_MANAGER, name: 'Gérant Global' },
  role: AUTH_ROLES.SYSTEM_MANAGER,
  isSystemManager: true,
})

const dealerCtx = () => defaultCtx({
  currentUser: { uid: 'uid-dl' },
  userProfile: { role: AUTH_ROLES.DEALER, name: 'Dealer Test' },
  role: AUTH_ROLES.DEALER,
  isDealer: true,
})

/**
 * handleSubmit reçoit un callback (formValues => Promise) et doit :
 *   - appeler ce callback avec les valeurs du formulaire
 *   - retourner { success: true } si succès, { success: false, error } si échec
 *
 * Pattern correct : async (callback) => { ... return { success } }
 * Pattern INCORRECT : (callback) => async (e) => { ... }  ← ne retourne pas une promesse
 */
function makeHandleSubmit({ formValues = { email: 'user@test.com', password: 'password123' }, failWith = null } = {}) {
  return async (callback) => {
    try {
      await callback(formValues)
      return { success: true }
    } catch (err) {
      return { success: false, error: failWith ?? err }
    }
  }
}

function setupFormMock(signInMock, { failWith = null } = {}) {
  useFormValidation.mockReturnValue({
    errors: {},
    isSubmitting: false,
    getFieldProps: (name) => ({
      name,
      value: name === 'email' ? 'user@test.com' : 'password123',
      onChange: vi.fn(),
      onBlur: vi.fn(),
    }),
    getFieldError: vi.fn(() => null),
    hasFieldError: vi.fn(() => false),
    shouldShowErrors: false,
    handleSubmit: makeHandleSubmit({ failWith }),
  })
  useAuth.mockReturnValue(defaultCtx({ signin: signInMock }))
}

function renderSignInWithRoutes(initialPath = '/auth') {
  const { container, ...rest } = render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LocationDisplay />
      <Routes>
        <Route path="/auth" element={<SignInForm onToggle={vi.fn()} />} />
        <Route path="/" element={<div data-testid="store-home">Boutique</div>} />
        <Route path="/admin" element={<div data-testid="admin-home">Admin</div>} />
        <Route path="/dealer" element={<div data-testid="dealer-home">Dealer</div>} />
      </Routes>
    </MemoryRouter>
  )
  return { container, ...rest }
}

function submitForm(container) {
  const form = container.querySelector('form')
  fireEvent.submit(form)
}

// ---------------------------------------------------------------------------
// Section N — Navigation post-login
// ---------------------------------------------------------------------------

describe('TC-043-N — Navigation post-login (SignInForm)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('N-1 : system_manager connecté → navigue vers /admin', async () => {
    const signin = vi.fn().mockResolvedValue({ role: AUTH_ROLES.SYSTEM_MANAGER })
    setupFormMock(signin)

    const { container } = renderSignInWithRoutes()
    submitForm(container)

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('/admin')
    })
    expect(screen.getByTestId('admin-home')).toBeInTheDocument()
  })

  it('N-2 : store_admin connecté → navigue vers /', async () => {
    const signin = vi.fn().mockResolvedValue({ role: AUTH_ROLES.STORE_ADMIN })
    setupFormMock(signin)

    const { container } = renderSignInWithRoutes()
    submitForm(container)

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('/')
    })
    expect(screen.getByTestId('store-home')).toBeInTheDocument()
  })

  it('N-3 : dealer connecté → navigue vers /dealer', async () => {
    const signin = vi.fn().mockResolvedValue({ role: AUTH_ROLES.DEALER })
    setupFormMock(signin)

    const { container } = renderSignInWithRoutes()
    submitForm(container)

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('/dealer')
    })
    expect(screen.getByTestId('dealer-home')).toBeInTheDocument()
  })

  it('N-4 : si signin échoue → pas de navigation, reste sur /auth', async () => {
    const signin = vi.fn().mockRejectedValue(new Error('Rôle non autorisé'))
    setupFormMock(signin)

    const { container } = renderSignInWithRoutes()
    submitForm(container)

    await waitFor(() => {
      expect(signin).toHaveBeenCalled()
    })

    expect(screen.getByTestId('location').textContent).toBe('/auth')
  })
})

// ---------------------------------------------------------------------------
// Section G — Guards par rôle sur routes admin (intégration RoleGuard)
// ---------------------------------------------------------------------------

describe('TC-043-G — Cloisonnement routes admin', () => {
  beforeEach(() => vi.clearAllMocks())

  const renderAdminRoute = (ctx) => {
    useAuth.mockReturnValue(ctx)
    return render(
      <MemoryRouter initialEntries={['/admin']}>
        <LocationDisplay />
        <Routes>
          <Route
            path="/admin"
            element={
              <RoleGuard allowedRoles={[AUTH_ROLES.SYSTEM_MANAGER]}>
                <div data-testid="admin-content">Espace gérant</div>
              </RoleGuard>
            }
          />
          <Route path="/" element={<div data-testid="store-root">Boutique</div>} />
          <Route path="/dealer" element={<div data-testid="dealer-root">Dealer</div>} />
        </Routes>
      </MemoryRouter>
    )
  }

  it('G-1 : system_manager actif → accède à /admin', () => {
    renderAdminRoute(systemManagerCtx())
    expect(screen.getByTestId('admin-content')).toBeInTheDocument()
    expect(screen.queryByText(/accès bloqué/i)).not.toBeInTheDocument()
  })

  it('G-2 : dealer → bloqué sur /admin, redirigé vers /dealer', () => {
    renderAdminRoute(dealerCtx())
    expect(screen.queryByTestId('admin-content')).not.toBeInTheDocument()
    expect(screen.getByTestId('dealer-root')).toBeInTheDocument()
  })

  it('G-3 : store_admin → bloqué sur /admin, redirigé vers /', () => {
    renderAdminRoute(storeAdminCtx())
    expect(screen.queryByTestId('admin-content')).not.toBeInTheDocument()
    expect(screen.getByTestId('store-root')).toBeInTheDocument()
  })

  it('G-4 : profil inactif (userProfile null, authError) → accès bloqué sur /admin', () => {
    useAuth.mockReturnValue({
      ...defaultCtx(),
      currentUser: { uid: 'uid-x' },
      authError: 'Compte inactif',
    })
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route
            path="/admin"
            element={
              <RoleGuard allowedRoles={[AUTH_ROLES.SYSTEM_MANAGER]}>
                <div data-testid="admin-content">Admin</div>
              </RoleGuard>
            }
          />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByText(/accès bloqué/i)).toBeInTheDocument()
    expect(screen.getByText('Compte inactif')).toBeInTheDocument()
    expect(screen.queryByTestId('admin-content')).not.toBeInTheDocument()
  })

  it('G-5 : profil absent (userProfile null, pas authError) → accès bloqué sur /admin', () => {
    useAuth.mockReturnValue({
      ...defaultCtx(),
      currentUser: { uid: 'uid-x' },
    })
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route
            path="/admin"
            element={
              <RoleGuard allowedRoles={[AUTH_ROLES.SYSTEM_MANAGER]}>
                <div data-testid="admin-content">Admin</div>
              </RoleGuard>
            }
          />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByText(/accès bloqué/i)).toBeInTheDocument()
    expect(screen.queryByTestId('admin-content')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Section L — État de chargement : pas de flash "Accès bloqué"
// ---------------------------------------------------------------------------

describe('TC-043-L — Pas de flash "Accès bloqué" pendant le chargement', () => {
  beforeEach(() => vi.clearAllMocks())

  it('L-1 : loading=true → spinner affiché, pas de "Accès bloqué"', () => {
    useAuth.mockReturnValue({ ...defaultCtx(), loading: true, currentUser: { uid: 'uid-sm' } })
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route
            path="/admin"
            element={
              <RoleGuard allowedRoles={[AUTH_ROLES.SYSTEM_MANAGER]}>
                <div data-testid="admin-content">Admin</div>
              </RoleGuard>
            }
          />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByText(/chargement/i)).toBeInTheDocument()
    expect(screen.queryByText(/accès bloqué/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('admin-content')).not.toBeInTheDocument()
  })

  it('L-2 : loading=true → spinner affiché même si currentUser absent', () => {
    useAuth.mockReturnValue({ ...defaultCtx(), loading: true })
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route
            path="/admin"
            element={
              <RoleGuard allowedRoles={[AUTH_ROLES.SYSTEM_MANAGER]}>
                <div data-testid="admin-content">Admin</div>
              </RoleGuard>
            }
          />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByText(/chargement/i)).toBeInTheDocument()
    expect(screen.queryByText(/accès bloqué/i)).not.toBeInTheDocument()
  })

  it('L-3 : après chargement, system_manager voit son espace admin', () => {
    useAuth.mockReturnValue(systemManagerCtx())
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route
            path="/admin"
            element={
              <RoleGuard allowedRoles={[AUTH_ROLES.SYSTEM_MANAGER]}>
                <div data-testid="admin-content">Espace gérant</div>
              </RoleGuard>
            }
          />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByTestId('admin-content')).toBeInTheDocument()
    expect(screen.queryByText(/chargement/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/accès bloqué/i)).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Section R — Routes admin complètes (AdminHome, AdminStores, AdminProfile)
// ---------------------------------------------------------------------------

describe('TC-043-R — Routes admin accessibles par system_manager', () => {
  beforeEach(() => vi.clearAllMocks())

  it('R-1 : system_manager accède à /admin', () => {
    useAuth.mockReturnValue(systemManagerCtx())
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route
            path="/admin"
            element={
              <RoleGuard allowedRoles={[AUTH_ROLES.SYSTEM_MANAGER]}>
                <div data-testid="admin-home">AdminHome</div>
              </RoleGuard>
            }
          />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByTestId('admin-home')).toBeInTheDocument()
  })

  it('R-2 : system_manager accède à /admin/stores', () => {
    useAuth.mockReturnValue(systemManagerCtx())
    render(
      <MemoryRouter initialEntries={['/admin/stores']}>
        <Routes>
          <Route
            path="/admin/stores"
            element={
              <RoleGuard allowedRoles={[AUTH_ROLES.SYSTEM_MANAGER]}>
                <div data-testid="admin-stores">AdminStores</div>
              </RoleGuard>
            }
          />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByTestId('admin-stores')).toBeInTheDocument()
  })

  it('R-3 : system_manager accède à /admin/profile', () => {
    useAuth.mockReturnValue(systemManagerCtx())
    render(
      <MemoryRouter initialEntries={['/admin/profile']}>
        <Routes>
          <Route
            path="/admin/profile"
            element={
              <RoleGuard allowedRoles={[AUTH_ROLES.SYSTEM_MANAGER]}>
                <div data-testid="admin-profile">AdminProfile</div>
              </RoleGuard>
            }
          />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByTestId('admin-profile')).toBeInTheDocument()
  })
})
