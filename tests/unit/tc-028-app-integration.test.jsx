/**
 * TC-028 — Intégration réelle App.jsx : routage, états Auth et isolation providers
 *
 * Stratégie :
 *   - AppContent est importée depuis le vrai App.jsx (routes, guards, layouts inclus)
 *   - useAuth est mocké pour injecter un contexte contrôlé
 *   - Les pages lourdes et composants UI boutique sont mockés pour les performances
 *   - AdminLayout, DealerLayout, RoleGuard, RoleBasedRedirect : RÉELS
 *   - Section A : routing URL finale par rôle (15 scénarios)
 *   - Section B : états bloqués sur wildcard (7 scénarios)
 *   - Section C : isolation providers pour rôles globaux (3 scénarios)
 */

// ---------------------------------------------------------------------------
// Mocks — doivent précéder tous les imports applicatifs
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
  functions: {},
  firebaseInfo: { projectId: 'test', isDev: true, useEmulators: false },
  default: {},
}))

vi.mock('../../src/services/settlementService', () => ({
  addTransactionPayment: vi.fn(() => Promise.resolve({ success: true, fullySettled: false })),
  addTransactionRefund:  vi.fn(() => Promise.resolve({ success: true })),
}))

vi.mock('../../src/services/firestore', () => ({
  firestoreService: {
    setActiveStore: vi.fn(),
    // Méthodes subscription utilisées par les vrais providers (Section C)
    subscribeToClients: vi.fn(() => vi.fn()),
    subscribeToDrafts: vi.fn(() => vi.fn()),
    subscribeToTransactions: vi.fn(() => vi.fn()),
    ensureNetworkBalances: vi.fn(() => Promise.resolve()),
    subscribeToNetworkConfig: vi.fn(() => vi.fn()),
    subscribeToNetworkBalances: vi.fn(() => vi.fn()),
    getClients: vi.fn(() => Promise.resolve([])),
    getTransactions: vi.fn(() => Promise.resolve([])),
  },
}))

vi.mock('../../src/utils/authHelpers', () => ({
  getAuthErrorMessage: vi.fn((code, msg) => msg || code || 'Erreur'),
}))

// Pages Boutique — testids identiques aux vraies pages
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

// Pages Admin
vi.mock('../../src/pages/admin/AdminHome', () => ({
  default: () => <div data-testid="admin-home">AdminHome</div>,
}))
vi.mock('../../src/pages/admin/AdminStoresPlaceholder', () => ({
  default: () => <div data-testid="admin-stores">AdminStores</div>,
}))
vi.mock('../../src/pages/admin/AdminProfile', () => ({
  default: () => <div data-testid="admin-profile">AdminProfile</div>,
}))

// Pages Dealer
vi.mock('../../src/pages/dealer/DealerHome', () => ({
  default: () => <div data-testid="dealer-home">DealerHome</div>,
}))
vi.mock('../../src/pages/dealer/DealerStores', () => ({
  default: () => <div data-testid="dealer-stores">DealerStores</div>,
}))
vi.mock('../../src/pages/dealer/DealerRequests', () => ({
  default: () => <div data-testid="dealer-requests">DealerRequests</div>,
}))
vi.mock('../../src/pages/dealer/NewDealerRequest', () => ({
  default: () => <div data-testid="dealer-requests-new">NewDealerRequest</div>,
}))
vi.mock('../../src/pages/dealer/DealerProfile', () => ({
  default: () => <div data-testid="dealer-profile">DealerProfile</div>,
}))

// Pages Store Admin (V2-6)
vi.mock('../../src/pages/store/StoreAdminDealerRequests', () => ({
  default: () => <div data-testid="store-dealer-requests-page">StoreAdminDealerRequests</div>,
}))
vi.mock('../../src/pages/store/StoreAdminDealerRequestDetails', () => ({
  default: () => <div data-testid="store-dealer-request-details-page">StoreAdminDealerRequestDetails</div>,
}))

// AuthPage
vi.mock('../../src/components/auth/AuthPage', () => ({
  default: () => <div data-testid="auth-page">PAGE_AUTH</div>,
}))

// Composants Layout Boutique (lourds, non testés ici)
vi.mock('../../src/components/NavBar', () => ({
  default: () => <nav data-testid="store-navbar">NavBar</nav>,
}))
vi.mock('../../src/components/network/NetworkCardsDrawer', () => ({
  default: () => <div data-testid="network-drawer">Drawer</div>,
}))
vi.mock('../../src/components/PWAInstallButton', () => ({
  default: () => null,
}))
vi.mock('../../src/components/ui/ErrorBoundary', () => ({
  default: ({ children }) => children,
}))

// Contextes UI (ThemeContext utilisé par Layout)
vi.mock('../../src/context/ThemeContext', () => ({
  useTheme: vi.fn(() => ({
    themeClasses: { background: 'bg-gray-100', navbar: 'bg-blue-600' },
    backgroundImage: '',
  })),
  ThemeProvider: ({ children }) => children,
}))

// ---------------------------------------------------------------------------
// Imports après les mocks
// ---------------------------------------------------------------------------

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { useAuth, AuthContext } from '../../src/context/AuthContext'
import { firestoreService } from '../../src/services/firestore'
import { AUTH_ROLES } from '../../src/constants/authMessages'
import { AppContent } from '../../src/App'

// Providers réels pour les tests d'isolation (Section C)
import { ClientsProvider } from '../../src/context/ClientsContext'
import { TransactionsProvider } from '../../src/context/transactions'
import { NetworkConfigProvider } from '../../src/context/NetworkConfigContext'

vi.mock('../../src/context/AuthContext', () => ({
  useAuth: vi.fn(),
  // AuthContext conservé comme vrai contexte React pour que les vrais providers
  // (Section C) puissent recevoir la valeur via <AuthContext.Provider value={ctx}>
  AuthContext: React.createContext(null),
  resolveAuthenticatedProfile: vi.fn(),
  AuthProvider: ({ children }) => children,
}))

// ---------------------------------------------------------------------------
// LocationDisplay — affiche l'URL courante pour vérification
// ---------------------------------------------------------------------------

function LocationDisplay() {
  const { pathname } = useLocation()
  return <div data-testid="location">{pathname}</div>
}

// ---------------------------------------------------------------------------
// Contextes de test
// ---------------------------------------------------------------------------

const defaultCtx = () => ({
  currentUser: null,
  userProfile: null,
  activeStore: null,
  loading: false,
  authError: '',
  role: null,
  logout: vi.fn(),
})

const storeAdminCtx = () => ({
  ...defaultCtx(),
  currentUser: { uid: 'uid-sa' },
  userProfile: { role: AUTH_ROLES.STORE_ADMIN, storeId: 'store-1', name: 'Admin' },
  activeStore: { id: 'store-1', name: 'Boutique Alpha', active: true },
  role: AUTH_ROLES.STORE_ADMIN,
})

const systemManagerCtx = () => ({
  ...defaultCtx(),
  currentUser: { uid: 'uid-sm' },
  userProfile: { role: AUTH_ROLES.SYSTEM_MANAGER, name: 'Gérant Global' },
  role: AUTH_ROLES.SYSTEM_MANAGER,
})

const dealerCtx = () => ({
  ...defaultCtx(),
  currentUser: { uid: 'uid-dl' },
  userProfile: { role: AUTH_ROLES.DEALER, name: 'Dealer Test' },
  role: AUTH_ROLES.DEALER,
})

// ---------------------------------------------------------------------------
// Helper de rendu
// ---------------------------------------------------------------------------

const renderApp = (ctx, path = '/') => {
  useAuth.mockReturnValue(ctx)
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationDisplay />
      <AppContent />
    </MemoryRouter>
  )
}

// ---------------------------------------------------------------------------
// Section A — URL finale par rôle (15 scénarios)
// ---------------------------------------------------------------------------

describe('TC-028-A — URL finale par rôle', () => {
  beforeEach(() => vi.clearAllMocks())

  it('A-1 : loading → spinner, aucun contenu privé', () => {
    renderApp({ ...defaultCtx(), loading: true }, '/')
    expect(screen.getByText(/chargement/i)).toBeInTheDocument()
    expect(screen.queryByTestId('page-dashboard')).not.toBeInTheDocument()
  })

  it('A-2 : non authentifié → AuthPage', () => {
    renderApp(defaultCtx(), '/')
    expect(screen.getByTestId('auth-page')).toBeInTheDocument()
  })

  it('A-3 : store_admin sur "/" → Dashboard rendu', () => {
    renderApp(storeAdminCtx(), '/')
    expect(screen.getByTestId('page-dashboard')).toBeInTheDocument()
    expect(screen.getByTestId('location').textContent).toBe('/')
  })

  it('A-4 : store_admin sur "/clients" → Clients rendu', () => {
    renderApp(storeAdminCtx(), '/clients')
    expect(screen.getByTestId('page-clients')).toBeInTheDocument()
    expect(screen.getByTestId('location').textContent).toBe('/clients')
  })

  it('A-5 : store_admin sur "/transactions" → Transactions rendu', () => {
    renderApp(storeAdminCtx(), '/transactions')
    expect(screen.getByTestId('page-transactions')).toBeInTheDocument()
  })

  it('A-6 : store_admin sur "/historique" → Historique rendu', () => {
    renderApp(storeAdminCtx(), '/historique')
    expect(screen.getByTestId('page-historique')).toBeInTheDocument()
  })

  it('A-7 : store_admin sur "/formulaire" → Formulaire rendu', () => {
    renderApp(storeAdminCtx(), '/formulaire')
    expect(screen.getByTestId('page-formulaire')).toBeInTheDocument()
  })

  it('A-8 : store_admin sur "/profil" → Profil rendu', () => {
    renderApp(storeAdminCtx(), '/profil')
    expect(screen.getByTestId('page-profil')).toBeInTheDocument()
  })

  it('A-9 : system_manager sur "/admin" → AdminHome rendu', () => {
    renderApp(systemManagerCtx(), '/admin')
    expect(screen.getByTestId('admin-home')).toBeInTheDocument()
    expect(screen.getByTestId('location').textContent).toBe('/admin')
  })

  it('A-10 : system_manager sur "/admin/stores" → AdminStores rendu', () => {
    renderApp(systemManagerCtx(), '/admin/stores')
    expect(screen.getByTestId('admin-stores')).toBeInTheDocument()
  })

  it('A-11 : system_manager sur "/admin/profile" → AdminProfile rendu', () => {
    renderApp(systemManagerCtx(), '/admin/profile')
    expect(screen.getByTestId('admin-profile')).toBeInTheDocument()
  })

  it('A-12 : dealer sur "/dealer" → DealerHome rendu', () => {
    renderApp(dealerCtx(), '/dealer')
    expect(screen.getByTestId('dealer-home')).toBeInTheDocument()
    expect(screen.getByTestId('location').textContent).toBe('/dealer')
  })

  it('A-13 : dealer sur "/dealer/stores" → DealerStores rendu', () => {
    renderApp(dealerCtx(), '/dealer/stores')
    expect(screen.getByTestId('dealer-stores')).toBeInTheDocument()
  })

  it('A-14 : dealer sur "/dealer/requests" → DealerRequests rendu', () => {
    renderApp(dealerCtx(), '/dealer/requests')
    expect(screen.getByTestId('dealer-requests')).toBeInTheDocument()
  })

  it('A-15 : dealer sur "/dealer/profile" → DealerProfile rendu', () => {
    renderApp(dealerCtx(), '/dealer/profile')
    expect(screen.getByTestId('dealer-profile')).toBeInTheDocument()
  })

  it('A-16 : dealer sur "/dealer/requests/new" → NewDealerRequest rendu', () => {
    renderApp(dealerCtx(), '/dealer/requests/new')
    expect(screen.getByTestId('dealer-requests-new')).toBeInTheDocument()
    expect(screen.getByTestId('location').textContent).toBe('/dealer/requests/new')
  })
})

// ---------------------------------------------------------------------------
// Section B — Wildcard et états bloqués (7 scénarios)
// ---------------------------------------------------------------------------

describe('TC-028-B — Wildcard et états bloqués', () => {
  beforeEach(() => vi.clearAllMocks())

  it('B-1 : store_admin sur URL inconnue → redirigé vers "/"', () => {
    renderApp(storeAdminCtx(), '/page-inconnue')
    expect(screen.getByTestId('location').textContent).toBe('/')
    expect(screen.getByTestId('page-dashboard')).toBeInTheDocument()
  })

  it('B-2 : system_manager sur URL inconnue → redirigé vers "/admin"', () => {
    renderApp(systemManagerCtx(), '/page-inconnue')
    expect(screen.getByTestId('location').textContent).toBe('/admin')
    expect(screen.getByTestId('admin-home')).toBeInTheDocument()
  })

  it('B-3 : dealer sur URL inconnue → redirigé vers "/dealer"', () => {
    renderApp(dealerCtx(), '/page-inconnue')
    expect(screen.getByTestId('location').textContent).toBe('/dealer')
    expect(screen.getByTestId('dealer-home')).toBeInTheDocument()
  })

  it('B-4 : profil absent sur wildcard → Accès bloqué avec bouton déconnexion', () => {
    renderApp({
      ...defaultCtx(),
      currentUser: { uid: 'uid-x' },
      userProfile: null,
    }, '/inconnue')
    expect(screen.getByText(/accès bloqué/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /se déconnecter/i })).toBeInTheDocument()
  })

  it('B-5 : rôle inconnu sur wildcard → Accès bloqué, bouton logout fonctionnel', () => {
    const logout = vi.fn()
    renderApp({
      ...defaultCtx(),
      currentUser: { uid: 'uid-x' },
      userProfile: { role: 'ghost_admin' },
      role: 'ghost_admin',
      logout,
    }, '/inconnue')
    expect(screen.getByText(/accès bloqué/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /se déconnecter/i }))
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('B-6 : store_admin → AdminLayout absent (isolation espaces)', () => {
    renderApp(storeAdminCtx(), '/')
    expect(screen.queryByTestId('admin-layout')).not.toBeInTheDocument()
    expect(screen.queryByTestId('dealer-layout')).not.toBeInTheDocument()
  })

  it('B-7 : system_manager → Layout Boutique absent', () => {
    renderApp(systemManagerCtx(), '/admin')
    expect(screen.queryByTestId('store-navbar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('network-drawer')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Section C — Isolation providers pour rôles globaux
// Utilise les vrais ClientsProvider, TransactionsProvider, NetworkConfigProvider
// pour vérifier que les abonnements Firestore (via firestoreService) ne sont
// pas initiés pour les rôles sans boutique active.
// ---------------------------------------------------------------------------

describe('TC-028-C — Isolation Firestore providers', () => {
  afterEach(() => vi.clearAllMocks())

  const renderWithProviders = (ctx, path) => {
    useAuth.mockReturnValue(ctx)
    return render(
      <MemoryRouter initialEntries={[path]}>
        {/*
         * AuthContext.Provider fournit la valeur aux vrais providers qui appellent
         * useContext(AuthContext) directement (pas useAuth()).
         * useAuth() reste mocké pour RoleGuard / RoleBasedRedirect.
         */}
        <AuthContext.Provider value={ctx}>
          <ClientsProvider>
            <TransactionsProvider>
              <NetworkConfigProvider>
                <AppContent />
              </NetworkConfigProvider>
            </TransactionsProvider>
          </ClientsProvider>
        </AuthContext.Provider>
      </MemoryRouter>
    )
  }

  it('C-1 : system_manager → subscribeToClients jamais appelé (pas de boutique)', () => {
    renderWithProviders(systemManagerCtx(), '/admin')
    expect(firestoreService.subscribeToClients).not.toHaveBeenCalled()
  })

  it('C-2 : dealer → subscribeToClients jamais appelé (pas de boutique)', () => {
    renderWithProviders(dealerCtx(), '/dealer')
    expect(firestoreService.subscribeToClients).not.toHaveBeenCalled()
  })

  it('C-3 : store_admin avec boutique active → subscribeToClients appelé (providers actifs)', () => {
    renderWithProviders(storeAdminCtx(), '/')
    expect(firestoreService.subscribeToClients).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Section D — Isolation routes Dealer
// Vérifie que chaque route /dealer/* est accessible uniquement au rôle dealer
// et redirige les autres rôles vers leur espace respectif.
// ---------------------------------------------------------------------------

describe('TC-028-D — Isolation routes Dealer', () => {
  beforeEach(() => vi.clearAllMocks())

  it('D-1 : dealer sur /dealer/stores → dealer-stores rendu', () => {
    renderApp(dealerCtx(), '/dealer/stores')
    expect(screen.getByTestId('dealer-stores')).toBeInTheDocument()
  })

  it('D-2 : dealer sur /dealer/requests → dealer-requests rendu', () => {
    renderApp(dealerCtx(), '/dealer/requests')
    expect(screen.getByTestId('dealer-requests')).toBeInTheDocument()
  })

  it('D-3 : dealer sur /dealer/requests/new → dealer-requests-new rendu', () => {
    renderApp(dealerCtx(), '/dealer/requests/new')
    expect(screen.getByTestId('dealer-requests-new')).toBeInTheDocument()
  })

  it('D-4 : store_admin sur /dealer/stores → redirigé vers / (Dashboard)', () => {
    renderApp(storeAdminCtx(), '/dealer/stores')
    expect(screen.queryByTestId('dealer-stores')).not.toBeInTheDocument()
    expect(screen.getByTestId('page-dashboard')).toBeInTheDocument()
  })

  it('D-5 : system_manager sur /dealer/stores → redirigé vers /admin', () => {
    renderApp(systemManagerCtx(), '/dealer/stores')
    expect(screen.queryByTestId('dealer-stores')).not.toBeInTheDocument()
    expect(screen.getByTestId('admin-home')).toBeInTheDocument()
  })

  it('D-6 : non authentifié sur /dealer/stores → AuthPage', () => {
    renderApp(defaultCtx(), '/dealer/stores')
    expect(screen.queryByTestId('dealer-stores')).not.toBeInTheDocument()
    expect(screen.getByTestId('auth-page')).toBeInTheDocument()
  })

  it('D-7 : store_admin sur /dealer/requests → redirigé vers /', () => {
    renderApp(storeAdminCtx(), '/dealer/requests')
    expect(screen.queryByTestId('dealer-requests')).not.toBeInTheDocument()
    expect(screen.getByTestId('page-dashboard')).toBeInTheDocument()
  })

  it('D-8 : store_admin sur /dealer/requests/new → redirigé vers /', () => {
    renderApp(storeAdminCtx(), '/dealer/requests/new')
    expect(screen.queryByTestId('dealer-requests-new')).not.toBeInTheDocument()
    expect(screen.getByTestId('page-dashboard')).toBeInTheDocument()
  })

  it('D-9 : system_manager sur /dealer/requests → redirigé vers /admin', () => {
    renderApp(systemManagerCtx(), '/dealer/requests')
    expect(screen.queryByTestId('dealer-requests')).not.toBeInTheDocument()
    expect(screen.getByTestId('admin-home')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Section E — Isolation routes Store Admin Dealer (V2-6)
// Vérifie que /dealer-requests et /dealer-requests/:id sont accessibles
// uniquement au rôle store_admin et redirigent les autres.
// ---------------------------------------------------------------------------

describe('TC-028-E — Isolation routes Store Admin Dealer (V2-6)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('E-1 : store_admin sur /dealer-requests → StoreAdminDealerRequests rendu', () => {
    renderApp(storeAdminCtx(), '/dealer-requests')
    expect(screen.getByTestId('store-dealer-requests-page')).toBeInTheDocument()
  })

  it('E-2 : store_admin sur /dealer-requests/req-123 → StoreAdminDealerRequestDetails rendu', () => {
    renderApp(storeAdminCtx(), '/dealer-requests/req-123')
    expect(screen.getByTestId('store-dealer-request-details-page')).toBeInTheDocument()
  })

  it('E-3 : dealer sur /dealer-requests → redirigé vers /dealer (page non visible)', () => {
    renderApp(dealerCtx(), '/dealer-requests')
    expect(screen.queryByTestId('store-dealer-requests-page')).not.toBeInTheDocument()
    expect(screen.getByTestId('dealer-home')).toBeInTheDocument()
  })

  it('E-4 : system_manager sur /dealer-requests → redirigé vers /admin', () => {
    renderApp(systemManagerCtx(), '/dealer-requests')
    expect(screen.queryByTestId('store-dealer-requests-page')).not.toBeInTheDocument()
    expect(screen.getByTestId('admin-home')).toBeInTheDocument()
  })

  it('E-5 : non authentifié sur /dealer-requests → AuthPage', () => {
    renderApp(defaultCtx(), '/dealer-requests')
    expect(screen.queryByTestId('store-dealer-requests-page')).not.toBeInTheDocument()
    expect(screen.getByTestId('auth-page')).toBeInTheDocument()
  })

  it('E-6 : dealer sur /dealer-requests/req-abc → redirigé vers /dealer', () => {
    renderApp(dealerCtx(), '/dealer-requests/req-abc')
    expect(screen.queryByTestId('store-dealer-request-details-page')).not.toBeInTheDocument()
    expect(screen.getByTestId('dealer-home')).toBeInTheDocument()
  })

  it('E-7 : non authentifié sur /dealer-requests/req-abc → AuthPage', () => {
    renderApp(defaultCtx(), '/dealer-requests/req-abc')
    expect(screen.queryByTestId('store-dealer-request-details-page')).not.toBeInTheDocument()
    expect(screen.getByTestId('auth-page')).toBeInTheDocument()
  })
})
