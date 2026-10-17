import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'

/**
 * TC-266 — le shell du patron : deux destinations, et les anciennes qui mènent
 * quelque part.
 *
 * ⚠ POURQUOI DES REDIRECTIONS PLUTÔT QUE DES 404. Un signet, un raccourci PWA
 *   ou un simple rechargement visent encore `/admin/reports`. La racine d'une
 *   application doit toujours mener quelque part — c'est le raisonnement déjà
 *   écrit dans App.jsx pour le tableau de bord boutique.
 */

vi.mock('../../src/context/AuthContext', () => ({
  AuthContext: { Provider: ({ children }) => children },
  // `vi.fn()` plutôt qu'une flèche nue : le bloc runtime plus bas en a besoin
  // pour substituer un contexte system_manager via `mockReturnValue`.
  useAuth: vi.fn(() => ({ logout: vi.fn(), userProfile: { name: 'Le Patron', role: 'system_manager' } })),
}))

const { default: AdminLayout } = await import('../../src/layouts/AdminLayout.jsx')
const { ADMIN_NAV_ITEMS } = await import('../../src/constants/navigation.js')

afterEach(cleanup)

const shell = () => render(<MemoryRouter initialEntries={['/admin']}><AdminLayout /></MemoryRouter>)

describe('TC-266 — deux destinations, pas neuf', () => {
  it('[TC-266-01] la navigation ne déclare que Clients et Boutiques', () => {
    expect(ADMIN_NAV_ITEMS.map(i => i.path)).toEqual(['/admin', '/admin/boutiques'])
  })

  it('[TC-266-02] aucune entrée ne pointe vers un écran supprimé', () => {
    const partis = ['/admin/stores', '/admin/users', '/admin/dealer',
                    '/admin/dealer-inventory', '/admin/clients',
                    '/admin/history', '/admin/reports', '/admin/profile']
    const chemins = ADMIN_NAV_ITEMS.map(i => i.path)
    for (const p of partis) expect(chemins).not.toContain(p)
  })

  /**
   * Le pouce atteint le bas de l'écran sans déplacer la main.
   * ⚠ Pas de `role="tablist"` (voir le commentaire d'AdminLayout.jsx) : ce
   *   sont des liens de routage, pas un panneau à onglets ARIA complet. Le
   *   repère reste vérifiable par son nom accessible.
   */
  it('[TC-266-03] la navigation est une barre nommée, pas une barre latérale', () => {
    shell()
    expect(screen.getByRole('navigation', { name: /navigation patron/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/barre latérale/i)).toBeNull()
  })

  it('[TC-266-04] aucun bouton hamburger', () => {
    shell()
    expect(screen.queryByLabelText(/ouvrir le menu/i)).toBeNull()
  })

  it('[TC-266-05] le nom et la déconnexion vivent dans le shell', () => {
    shell()
    expect(screen.getByText('Le Patron')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /déconnecter|quitter/i })).toBeInTheDocument()
  })

  /**
   * L'ARGUMENT CENTRAL DU LOT, ASSERTÉ. Rien n'empêcherait syntaxiquement de
   * remonter la nav au-dessus du contenu — ce test le ferait échouer : les
   * onglets vivent EN PIED, pas en tête, parce que c'est là qu'est le pouce.
   */
  it('[TC-266-08] la navigation vient après le contenu principal dans le DOM', () => {
    shell()
    const main = screen.getByRole('main')
    const nav = screen.getByRole('navigation', { name: /navigation patron/i })
    // bitmask Node.DOCUMENT_POSITION_FOLLOWING : main précède nav dans l'arbre.
    expect(main.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

/**
 * ⚠ CE QUI SUIT RESTITUE CE QUE TC-266-06 NE VÉRIFIAIT PAS. Une recherche de
 *   chaîne dans le source passerait même si les huit routes étaient déclarées
 *   HORS du RoleGuard (donc accessibles sans rôle), ou tomberait en échec sur
 *   une simple réécriture qui garde le comportement juste. Les tests
 *   ci-dessous montent la VRAIE App (RoleGuard réel, routes réelles) avec un
 *   contexte system_manager, et vérifient la redirection au runtime pour les
 *   huit adresses.
 */

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
vi.mock('../../src/services/firestore', () => ({
  firestoreService: {
    setActiveStore: vi.fn(),
    // `PatronClients` (tâche 4) monte vraiment sous `/admin` ici — la VRAIE
    // App, pas un stub — et appelle ce flux dès le premier rendu.
    subscribeToAllClients: vi.fn(() => vi.fn()),
    subscribeToClients: vi.fn(() => vi.fn()),
    subscribeToDrafts: vi.fn(() => vi.fn()),
    subscribeToHistory: vi.fn(() => vi.fn()),
    getHistoryPage: vi.fn(() => Promise.resolve({ transactions: [], lastDoc: null, hasMore: false })),
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
// ⚠ RONDE DE CORRECTION 1 (I-4) — SANS CE MOCK, LE VRAI HOOK APPELLERAIT
//   `listClientHistory` via `httpsCallable(functions, ...)` avec `functions`
//   réduit à `{}` (mock ci-dessus) : l'échec serait asynchrone, résolu APRÈS
//   que `render()` ait rendu la main — une mise à jour hors `act()`, la même
//   leçon que `tc-122-page-dettes-internes.test.jsx`. Un double stub, comme
//   `subscribeToAllClients` au-dessus, l'évite pour la même raison.
vi.mock('../../src/hooks/useHistoriqueClient.js', () => ({
  useHistoriqueClient: () => ({
    enCours: [], lignes: [], totaux: null, etat: 'pret', erreur: null,
    encore: false, chargerPlus: vi.fn(), reessayer: vi.fn(),
  }),
}))

const { useAuth: useAuthMock } = await import('../../src/context/AuthContext')
const { AppContent } = await import('../../src/App.jsx')
const { AUTH_ROLES } = await import('../../src/constants/authMessages')

function LocationDisplay() {
  const { pathname } = useLocation()
  return <div data-testid="location">{pathname}</div>
}

const systemManagerCtx = {
  currentUser: { uid: 'uid-sm' },
  userProfile: { role: AUTH_ROLES.SYSTEM_MANAGER, name: 'Gérant Global' },
  activeStore: null,
  loading: false,
  authError: '',
  role: AUTH_ROLES.SYSTEM_MANAGER,
  logout: vi.fn(),
}

const renderApp = (path) => {
  useAuthMock.mockReturnValue(systemManagerCtx)
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationDisplay />
      <AppContent />
    </MemoryRouter>
  )
}

describe('TC-266 — les huit adresses redirigent, au runtime', () => {
  it.each([
    'stores', 'users', 'dealer', 'dealer-inventory',
    'clients', 'history', 'reports', 'profile',
  ])('[TC-266-06] /admin/%s redirige vers /admin (system_manager)', async (parti) => {
    renderApp(`/admin/${parti}`)
    expect(await screen.findByTestId('patron-clients')).toBeInTheDocument()
    expect(screen.getByTestId('location').textContent).toBe('/admin')
  })
})

/**
 * ⚠ RONDE DE CORRECTION 1 (I-4) — LA COEXISTENCE DES DEUX ROUTES N'ÉTAIT PROUVÉE
 *   PAR RIEN. Le rapport de la tâche 5 affirmait l'avoir vérifié en lançant ce
 *   fichier et `tc-269` ensemble — mais `tc-269` déclare sa PROPRE table de
 *   routes dans un `MemoryRouter` isolé et ne charge jamais `src/App.jsx`. Seul
 *   un rendu de la VRAIE `AppContent` (RoleGuard réel, routes réelles — déjà le
 *   principe du bloc `TC-266-06` ci-dessus) peut verrouiller que
 *   `/admin/clients/:clientId/historique` n'est pas absorbée par la
 *   redirection `/admin/clients` déclarée juste après elle dans `App.jsx`.
 */
describe('TC-266 — la route historique coexiste avec la redirection /admin/clients', () => {
  it('[TC-266-09] /admin/clients/c1/historique rend la page historique, sans rediriger vers /admin', async () => {
    renderApp('/admin/clients/c1/historique')
    expect(await screen.findByTestId('patron-historique-client')).toBeInTheDocument()
    expect(screen.getByTestId('location').textContent).toBe('/admin/clients/c1/historique')
  })
})

describe('TC-266 — les anciennes adresses mènent quelque part', () => {
  it('[TC-266-07] aucune page admin supprimée n’est encore importée', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync('src/App.jsx', 'utf8')
    // Chemin d'import entier, pas le seul nom : une chaîne nue comme
    // « AdminDealer » est aussi une sous-chaîne de « StoreAdminDealerRequests »,
    // un écran boutique sans rapport qui reste importé plus haut dans ce fichier.
    for (const nom of ['pages/admin/AdminDashboard', 'pages/admin/AdminStores', 'pages/admin/AdminUsers',
                       'pages/admin/AdminDealer', 'pages/admin/AdminHistory', 'pages/admin/AdminReports',
                       'pages/admin/AdminProfile',
                       // Supprimé en tâche 4 (dernier appelant de listAllClients/
                       // listStoreOptions, lui-même code mort depuis ce lot) : ce
                       // verrou manquait, et rien n'aurait signalé sa réimportation.
                       'pages/admin/AdminClients']) {
      expect(source).not.toContain(nom)
    }
  })
})
