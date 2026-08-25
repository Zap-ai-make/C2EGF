/**
 * TC-027 — Routage, RoleGuard et layouts par rôle
 *
 * Couvre :
 * - getDefaultRouteForRole (helper roleRouting.js)
 * - RoleGuard (comportement par combinaison état/rôle)
 * - AdminLayout / DealerLayout (contenu isolé)
 * - Routes réelles avec MemoryRouter (redirections croisées, fallback)
 * - Régression V1 Boutique (six routes inchangées)
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

// Mocks composants Boutique (évite d'importer Firestore depuis les pages)
vi.mock('../../src/pages/Dashboard', () => ({
  default: () => <div data-testid="page-dashboard">Dashboard</div>,
}))
vi.mock('../../src/pages/Clients', () => ({
  default: () => <div data-testid="page-clients">Clients</div>,
}))
vi.mock('../../src/pages/Transactions', () => ({
  default: () => <div data-testid="page-transactions">Transactions</div>,
}))
vi.mock('../../src/pages/Historique', () => ({
  default: () => <div data-testid="page-historique">Historique</div>,
}))
vi.mock('../../src/pages/Formulaire', () => ({
  default: () => <div data-testid="page-formulaire">Formulaire</div>,
}))
vi.mock('../../src/pages/Profil', () => ({
  default: () => <div data-testid="page-profil">Profil</div>,
}))

// Mocks composants Layout Boutique (NetworkCardsDrawer)
vi.mock('../../src/components/network/NetworkCardsDrawer', () => ({
  default: () => <div data-testid="network-drawer">NetworkDrawer</div>,
}))
vi.mock('../../src/components/NavBar', () => ({
  default: () => <nav data-testid="store-navbar">NavBar</nav>,
}))
vi.mock('../../src/components/PWAInstallButton', () => ({
  default: () => null,
}))

// Mocks contexts (ThemeContext, etc.)
vi.mock('../../src/context/ThemeContext', () => ({
  useTheme: vi.fn(() => ({
    themeClasses: { background: 'bg-gray-100', navbar: 'bg-blue-600' },
    backgroundImage: '',
  })),
  ThemeProvider: ({ children }) => children,
}))
vi.mock('../../src/context/ClientsContext', () => ({
  ClientsProvider: ({ children }) => children,
}))
vi.mock('../../src/context/transactions', () => ({
  TransactionsProvider: ({ children }) => children,
}))
vi.mock('../../src/context/NetworkConfigContext', () => ({
  NetworkConfigProvider: ({ children }) => children,
}))

// ---------------------------------------------------------------------------
// Imports après les mocks
// ---------------------------------------------------------------------------

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { useAuth } from '../../src/context/AuthContext'
import { AUTH_ROLES } from '../../src/constants/authMessages'
import { getDefaultRouteForRole } from '../../src/utils/roleRouting'
import RoleGuard from '../../src/components/auth/RoleGuard'
import AdminLayout from '../../src/layouts/AdminLayout'
import DealerLayout from '../../src/layouts/DealerLayout'
import Layout from '../../src/components/Layout'

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: vi.fn(),
  AuthContext: React.createContext(null),
  resolveAuthenticatedProfile: vi.fn(),
  AuthProvider: ({ children }) => children,
}))

// ---------------------------------------------------------------------------
// Helpers de contexte
// ---------------------------------------------------------------------------

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

const storeAdminCtx = () => ({
  ...defaultCtx(),
  currentUser: { uid: 'uid-sa' },
  userProfile: { role: AUTH_ROLES.STORE_ADMIN, storeId: 'store-abc', name: 'Admin' },
  activeStore: { id: 'store-abc', name: 'Boutique Alpha', active: true },
  role: AUTH_ROLES.STORE_ADMIN,
  isStoreAdmin: true,
  hasStoreContext: true,
})

const systemManagerCtx = () => ({
  ...defaultCtx(),
  currentUser: { uid: 'uid-sm' },
  userProfile: { role: AUTH_ROLES.SYSTEM_MANAGER, name: 'Gérant Global' },
  role: AUTH_ROLES.SYSTEM_MANAGER,
  isSystemManager: true,
})

const dealerCtx = () => ({
  ...defaultCtx(),
  currentUser: { uid: 'uid-dl' },
  userProfile: { role: AUTH_ROLES.DEALER, name: 'Dealer Test' },
  role: AUTH_ROLES.DEALER,
  isDealer: true,
})

// ============================================================================
// SECTION R — getDefaultRouteForRole
// ============================================================================

describe('TC-027-R — getDefaultRouteForRole', () => {
  it('R-1 : store_admin → "/"', () => {
    expect(getDefaultRouteForRole(AUTH_ROLES.STORE_ADMIN)).toBe('/')
  })

  it('R-2 : system_manager → "/admin"', () => {
    expect(getDefaultRouteForRole(AUTH_ROLES.SYSTEM_MANAGER)).toBe('/admin')
  })

  it('R-3 : dealer → "/dealer"', () => {
    expect(getDefaultRouteForRole(AUTH_ROLES.DEALER)).toBe('/dealer')
  })

  it('R-4 : rôle inconnu → null', () => {
    expect(getDefaultRouteForRole('ghost_admin')).toBeNull()
  })

  it('R-5 : null → null', () => {
    expect(getDefaultRouteForRole(null)).toBeNull()
  })

  it('R-6 : undefined → null', () => {
    expect(getDefaultRouteForRole(undefined)).toBeNull()
  })
})

// ============================================================================
// SECTION G — RoleGuard : comportement direct
// ============================================================================

describe('TC-027-G — RoleGuard', () => {
  const PrivateContent = () => <div data-testid="private">CONTENU PRIVÉ</div>

  const renderGuard = (allowedRoles, ctx, initialPath = '/') => {
    useAuth.mockReturnValue(ctx)
    return render(
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/*"
            element={
              <RoleGuard allowedRoles={allowedRoles}>
                <PrivateContent />
              </RoleGuard>
            }
          />
          <Route path="/admin" element={<div data-testid="admin-dest">ADMIN</div>} />
          <Route path="/admin/stores" element={<div data-testid="admin-stores-dest">ADMIN STORES</div>} />
          <Route path="/dealer" element={<div data-testid="dealer-dest">DEALER</div>} />
        </Routes>
      </MemoryRouter>
    )
  }

  beforeEach(() => vi.clearAllMocks())

  it('G-1 : loading → spinner, pas de contenu privé', () => {
    renderGuard([AUTH_ROLES.STORE_ADMIN], { ...defaultCtx(), loading: true })
    expect(screen.getByText(/chargement/i)).toBeInTheDocument()
    expect(screen.queryByTestId('private')).not.toBeInTheDocument()
  })

  it('G-2 : non authentifié → AuthPage, pas de contenu privé', () => {
    renderGuard([AUTH_ROLES.STORE_ADMIN], defaultCtx())
    expect(screen.getByTestId('auth-page')).toBeInTheDocument()
    expect(screen.queryByTestId('private')).not.toBeInTheDocument()
  })

  it('G-3 : profil absent → accès bloqué', () => {
    renderGuard([AUTH_ROLES.STORE_ADMIN], {
      ...defaultCtx(),
      currentUser: { uid: 'x' },
    })
    expect(screen.getByText(/accès bloqué/i)).toBeInTheDocument()
  })

  it('G-4 : rôle inconnu → accès bloqué', () => {
    renderGuard([AUTH_ROLES.STORE_ADMIN], {
      ...defaultCtx(),
      currentUser: { uid: 'x' },
      userProfile: { role: 'hacker' },
      role: 'hacker',
    })
    expect(screen.getByText(/accès bloqué/i)).toBeInTheDocument()
    expect(screen.queryByTestId('private')).not.toBeInTheDocument()
  })

  it('G-5 : store_admin autorisé dans espace Boutique → contenu rendu', () => {
    renderGuard([AUTH_ROLES.STORE_ADMIN], storeAdminCtx())
    expect(screen.getByTestId('private')).toBeInTheDocument()
  })

  it('G-6 : store_admin refusé sur /admin → redirigé vers "/"', () => {
    // Route guard placée directement sur /admin pour éviter le conflit de priorité /*
    useAuth.mockReturnValue(storeAdminCtx())
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin" element={<RoleGuard allowedRoles={[AUTH_ROLES.SYSTEM_MANAGER]}><PrivateContent /></RoleGuard>} />
          <Route path="/" element={<div data-testid="store-root">BOUTIQUE</div>} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByTestId('store-root')).toBeInTheDocument()
    expect(screen.queryByTestId('private')).not.toBeInTheDocument()
  })

  it('G-7 : store_admin refusé sur /dealer → redirigé vers "/"', () => {
    useAuth.mockReturnValue(storeAdminCtx())
    render(
      <MemoryRouter initialEntries={['/dealer']}>
        <Routes>
          <Route path="/dealer" element={<RoleGuard allowedRoles={[AUTH_ROLES.DEALER]}><PrivateContent /></RoleGuard>} />
          <Route path="/" element={<div data-testid="store-root">BOUTIQUE</div>} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByTestId('store-root')).toBeInTheDocument()
    expect(screen.queryByTestId('private')).not.toBeInTheDocument()
  })

  it('G-8 : system_manager autorisé sur /admin → contenu rendu', () => {
    useAuth.mockReturnValue(systemManagerCtx())
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin" element={<RoleGuard allowedRoles={[AUTH_ROLES.SYSTEM_MANAGER]}><PrivateContent /></RoleGuard>} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByTestId('private')).toBeInTheDocument()
  })

  it('G-9 : system_manager refusé sur espace Boutique → redirigé vers /admin', () => {
    renderGuard([AUTH_ROLES.STORE_ADMIN], systemManagerCtx())
    expect(screen.getByTestId('admin-dest')).toBeInTheDocument()
    expect(screen.queryByTestId('private')).not.toBeInTheDocument()
  })

  it('G-10 : system_manager refusé sur /dealer → redirigé vers /admin', () => {
    useAuth.mockReturnValue(systemManagerCtx())
    render(
      <MemoryRouter initialEntries={['/dealer']}>
        <Routes>
          <Route path="/dealer" element={<RoleGuard allowedRoles={[AUTH_ROLES.DEALER]}><PrivateContent /></RoleGuard>} />
          <Route path="/admin" element={<div data-testid="admin-dest">ADMIN</div>} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByTestId('admin-dest')).toBeInTheDocument()
    expect(screen.queryByTestId('private')).not.toBeInTheDocument()
  })

  it('G-11 : dealer autorisé sur /dealer → contenu rendu', () => {
    useAuth.mockReturnValue(dealerCtx())
    render(
      <MemoryRouter initialEntries={['/dealer']}>
        <Routes>
          <Route path="/dealer" element={<RoleGuard allowedRoles={[AUTH_ROLES.DEALER]}><PrivateContent /></RoleGuard>} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByTestId('private')).toBeInTheDocument()
  })

  it('G-12 : dealer refusé sur espace Boutique → redirigé vers /dealer', () => {
    renderGuard([AUTH_ROLES.STORE_ADMIN], dealerCtx())
    expect(screen.getByTestId('dealer-dest')).toBeInTheDocument()
    expect(screen.queryByTestId('private')).not.toBeInTheDocument()
  })

  it('G-13 : dealer refusé sur /admin → redirigé vers /dealer', () => {
    useAuth.mockReturnValue(dealerCtx())
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin" element={<RoleGuard allowedRoles={[AUTH_ROLES.SYSTEM_MANAGER]}><PrivateContent /></RoleGuard>} />
          <Route path="/dealer" element={<div data-testid="dealer-dest">DEALER</div>} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByTestId('dealer-dest')).toBeInTheDocument()
    expect(screen.queryByTestId('private')).not.toBeInTheDocument()
  })

  it('G-14 : rôle inconnu → bloqué, pas de contenu privé ni redirection', () => {
    renderGuard([AUTH_ROLES.STORE_ADMIN], {
      ...defaultCtx(),
      currentUser: { uid: 'x' },
      userProfile: { role: 'unknown' },
      role: 'unknown',
    })
    expect(screen.getByText(/accès bloqué/i)).toBeInTheDocument()
    expect(screen.queryByTestId('private')).not.toBeInTheDocument()
    expect(screen.queryByTestId('admin-dest')).not.toBeInTheDocument()
    expect(screen.queryByTestId('dealer-dest')).not.toBeInTheDocument()
  })
})

// ============================================================================
// SECTION L — Layouts : isolation des composants
// ============================================================================

describe('TC-027-L — Layouts', () => {
  beforeEach(() => vi.clearAllMocks())

  // AdminLayout
  it('L-1 : AdminLayout contient la navigation admin', () => {
    useAuth.mockReturnValue(systemManagerCtx())
    render(
      <MemoryRouter>
        <AdminLayout />
      </MemoryRouter>
    )
    expect(screen.getByTestId('admin-layout')).toBeInTheDocument()
    expect(screen.getByTestId('admin-nav')).toBeInTheDocument()
    expect(screen.getByText('Vue générale')).toBeInTheDocument()
    expect(screen.getByText('Boutiques')).toBeInTheDocument()
    expect(screen.getByText('Profil')).toBeInTheDocument()
  })

  it('L-2 : AdminLayout contient bouton déconnexion', () => {
    useAuth.mockReturnValue(systemManagerCtx())
    render(<MemoryRouter><AdminLayout /></MemoryRouter>)
    expect(screen.getByRole('button', { name: /se déconnecter/i })).toBeInTheDocument()
  })

  it('L-3 : AdminLayout bouton déconnexion appelle logout', () => {
    const logout = vi.fn()
    useAuth.mockReturnValue({ ...systemManagerCtx(), logout })
    render(<MemoryRouter><AdminLayout /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /se déconnecter/i }))
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('L-4 : AdminLayout n\'a pas NetworkCardsDrawer', () => {
    useAuth.mockReturnValue(systemManagerCtx())
    render(<MemoryRouter><AdminLayout /></MemoryRouter>)
    expect(screen.queryByTestId('network-drawer')).not.toBeInTheDocument()
  })

  it('L-6 : AdminLayout n\'a pas la NavBar Boutique', () => {
    useAuth.mockReturnValue(systemManagerCtx())
    render(<MemoryRouter><AdminLayout /></MemoryRouter>)
    expect(screen.queryByTestId('store-navbar')).not.toBeInTheDocument()
  })

  // DealerLayout
  it('L-7 : DealerLayout contient la navigation dealer', () => {
    useAuth.mockReturnValue(dealerCtx())
    render(<MemoryRouter><DealerLayout /></MemoryRouter>)
    expect(screen.getByTestId('dealer-layout')).toBeInTheDocument()
    expect(screen.getByTestId('dealer-nav')).toBeInTheDocument()
    expect(screen.getByText('Ravitaillements')).toBeInTheDocument()
  })

  it('L-8 : DealerLayout contient bouton déconnexion', () => {
    useAuth.mockReturnValue(dealerCtx())
    render(<MemoryRouter><DealerLayout /></MemoryRouter>)
    expect(screen.getByRole('button', { name: /se déconnecter/i })).toBeInTheDocument()
  })

  it('L-9 : DealerLayout bouton déconnexion appelle logout', () => {
    const logout = vi.fn()
    useAuth.mockReturnValue({ ...dealerCtx(), logout })
    render(<MemoryRouter><DealerLayout /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /se déconnecter/i }))
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('L-10 : DealerLayout n\'a pas NetworkCardsDrawer', () => {
    useAuth.mockReturnValue(dealerCtx())
    render(<MemoryRouter><DealerLayout /></MemoryRouter>)
    expect(screen.queryByTestId('network-drawer')).not.toBeInTheDocument()
  })

  it('L-12 : DealerLayout n\'a pas la NavBar Boutique', () => {
    useAuth.mockReturnValue(dealerCtx())
    render(<MemoryRouter><DealerLayout /></MemoryRouter>)
    expect(screen.queryByTestId('store-navbar')).not.toBeInTheDocument()
  })

  // Layout Boutique pour rôles globaux
  it('L-13 : Layout Boutique n\'est pas rendu pour system_manager (redirigé)', () => {
    useAuth.mockReturnValue(systemManagerCtx())
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            element={
              <RoleGuard allowedRoles={[AUTH_ROLES.STORE_ADMIN]}>
                <Layout />
              </RoleGuard>
            }
          >
            <Route path="/" element={<div data-testid="store-page">Boutique</div>} />
          </Route>
          <Route path="/admin" element={<div data-testid="admin-dest">ADMIN</div>} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.queryByTestId('store-navbar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('network-drawer')).not.toBeInTheDocument()
    expect(screen.queryByTestId('store-page')).not.toBeInTheDocument()
  })

  it('L-14 : Layout Boutique n\'est pas rendu pour dealer (redirigé)', () => {
    useAuth.mockReturnValue(dealerCtx())
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            element={
              <RoleGuard allowedRoles={[AUTH_ROLES.STORE_ADMIN]}>
                <Layout />
              </RoleGuard>
            }
          >
            <Route path="/" element={<div data-testid="store-page">Boutique</div>} />
          </Route>
          <Route path="/dealer" element={<div data-testid="dealer-dest">DEALER</div>} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.queryByTestId('store-navbar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('store-page')).not.toBeInTheDocument()
  })
})

// ============================================================================
// SECTION V — Régression V1 Boutique
// ============================================================================

describe('TC-027-V — Régression Boutique (store_admin)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuth.mockReturnValue(storeAdminCtx())
  })

  const renderBoutiqueRoutes = (path) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            element={
              <RoleGuard allowedRoles={[AUTH_ROLES.STORE_ADMIN]}>
                <Layout />
              </RoleGuard>
            }
          >
            <Route path="/" element={<div data-testid="page-dashboard">Dashboard</div>} />
            <Route path="/clients" element={<div data-testid="page-clients">Clients</div>} />
            <Route path="/transactions" element={<div data-testid="page-transactions">Transactions</div>} />
            <Route path="/historique" element={<div data-testid="page-historique">Historique</div>} />
            <Route path="/formulaire" element={<div data-testid="page-formulaire">Formulaire</div>} />
            <Route path="/profil" element={<div data-testid="page-profil">Profil</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )

  it('V-1 : "/" → Dashboard accessible', () => {
    renderBoutiqueRoutes('/')
    expect(screen.getByTestId('page-dashboard')).toBeInTheDocument()
  })

  it('V-2 : "/clients" → Clients accessible', () => {
    renderBoutiqueRoutes('/clients')
    expect(screen.getByTestId('page-clients')).toBeInTheDocument()
  })

  it('V-3 : "/transactions" → Transactions accessible', () => {
    renderBoutiqueRoutes('/transactions')
    expect(screen.getByTestId('page-transactions')).toBeInTheDocument()
  })

  it('V-4 : "/historique" → Historique accessible', () => {
    renderBoutiqueRoutes('/historique')
    expect(screen.getByTestId('page-historique')).toBeInTheDocument()
  })

  it('V-5 : "/formulaire" → Formulaire accessible', () => {
    renderBoutiqueRoutes('/formulaire')
    expect(screen.getByTestId('page-formulaire')).toBeInTheDocument()
  })

  it('V-6 : "/profil" → Profil accessible', () => {
    renderBoutiqueRoutes('/profil')
    expect(screen.getByTestId('page-profil')).toBeInTheDocument()
  })

  it('V-7 : Layout Boutique inclut NavBar pour store_admin', () => {
    renderBoutiqueRoutes('/')
    expect(screen.getByTestId('store-navbar')).toBeInTheDocument()
  })

  it('V-8 : Layout Boutique inclut NetworkCardsDrawer pour store_admin', () => {
    renderBoutiqueRoutes('/')
    expect(screen.getByTestId('network-drawer')).toBeInTheDocument()
  })

})

// ============================================================================
// SECTION X — Croisements inter-espaces (redirections cross-role)
// ============================================================================

describe('TC-027-X — Redirections croisées', () => {
  beforeEach(() => vi.clearAllMocks())

  const renderCrossRoutes = (ctx, initialPath) => {
    useAuth.mockReturnValue(ctx)
    return render(
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            element={
              <RoleGuard allowedRoles={[AUTH_ROLES.STORE_ADMIN]}>
                <div data-testid="boutique-space">BOUTIQUE</div>
              </RoleGuard>
            }
          >
            <Route path="/" element={null} />
            <Route path="/clients" element={null} />
          </Route>
          <Route
            element={
              <RoleGuard allowedRoles={[AUTH_ROLES.SYSTEM_MANAGER]}>
                <div data-testid="admin-space">ADMIN</div>
              </RoleGuard>
            }
          >
            <Route path="/admin" element={null} />
            <Route path="/admin/stores" element={null} />
          </Route>
          <Route
            element={
              <RoleGuard allowedRoles={[AUTH_ROLES.DEALER]}>
                <div data-testid="dealer-space">DEALER</div>
              </RoleGuard>
            }
          >
            <Route path="/dealer" element={null} />
            <Route path="/dealer/requests" element={null} />
          </Route>
          <Route path="*" element={<div data-testid="wildcard">404</div>} />
        </Routes>
      </MemoryRouter>
    )
  }

  it('X-1 : dealer sur /admin → redirigé vers /dealer', () => {
    renderCrossRoutes(dealerCtx(), '/admin')
    expect(screen.getByTestId('dealer-space')).toBeInTheDocument()
    expect(screen.queryByTestId('admin-space')).not.toBeInTheDocument()
  })

  it('X-2 : system_manager sur /dealer → redirigé vers /admin', () => {
    renderCrossRoutes(systemManagerCtx(), '/dealer')
    expect(screen.getByTestId('admin-space')).toBeInTheDocument()
    expect(screen.queryByTestId('dealer-space')).not.toBeInTheDocument()
  })

  it('X-3 : store_admin sur /admin → redirigé vers "/"', () => {
    renderCrossRoutes(storeAdminCtx(), '/admin')
    expect(screen.getByTestId('boutique-space')).toBeInTheDocument()
    expect(screen.queryByTestId('admin-space')).not.toBeInTheDocument()
  })

  it('X-4 : store_admin sur /dealer → redirigé vers "/"', () => {
    renderCrossRoutes(storeAdminCtx(), '/dealer')
    expect(screen.getByTestId('boutique-space')).toBeInTheDocument()
    expect(screen.queryByTestId('dealer-space')).not.toBeInTheDocument()
  })

  it('X-5 : dealer sur /clients → redirigé vers /dealer', () => {
    renderCrossRoutes(dealerCtx(), '/clients')
    expect(screen.getByTestId('dealer-space')).toBeInTheDocument()
    expect(screen.queryByTestId('boutique-space')).not.toBeInTheDocument()
  })

  it('X-6 : system_manager sur /clients → redirigé vers /admin', () => {
    renderCrossRoutes(systemManagerCtx(), '/clients')
    expect(screen.getByTestId('admin-space')).toBeInTheDocument()
    expect(screen.queryByTestId('boutique-space')).not.toBeInTheDocument()
  })

  it('X-7 : pas de boucle de redirection (store_admin sur /)', () => {
    // Teste que le render se termine sans boucle infinie
    renderCrossRoutes(storeAdminCtx(), '/')
    expect(screen.getByTestId('boutique-space')).toBeInTheDocument()
  })

  it('X-8 : pas de boucle de redirection (system_manager sur /admin)', () => {
    renderCrossRoutes(systemManagerCtx(), '/admin')
    expect(screen.getByTestId('admin-space')).toBeInTheDocument()
  })

  it('X-9 : pas de boucle de redirection (dealer sur /dealer)', () => {
    renderCrossRoutes(dealerCtx(), '/dealer')
    expect(screen.getByTestId('dealer-space')).toBeInTheDocument()
  })
})
