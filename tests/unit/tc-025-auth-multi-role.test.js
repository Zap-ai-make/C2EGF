/**
 * TC-025 — Authentification multi-rôles V2
 *
 * Caractérise et verrouille le comportement attendu de resolveAuthenticatedProfile
 * et d'AuthContext pour les trois rôles V2 : store_admin, system_manager, dealer.
 *
 * Architecture des mocks :
 *   - onAuthStateChanged est mocké pour capturer ou déclencher le callback
 *   - getDoc est mocké pour simuler users/{uid} et stores/{storeId}
 *   - setDoc est mocké pour vérifier les écritures lastLogin
 *   - firestoreService.setActiveStore est mocké pour vérifier les appels de service
 */

// ---------------------------------------------------------------------------
// Mocks Firebase — doivent précéder tous les imports de modules applicatifs
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
  signOut: vi.fn(),
  onAuthStateChanged: vi.fn(),
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
  doc: vi.fn((_db, ...segments) => ({ _path: segments.join('/'), _isMockDoc: true })),
  getDoc: vi.fn(),
  setDoc: vi.fn(() => Promise.resolve()),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  writeBatch: vi.fn(() => ({
    set: vi.fn(),
    commit: vi.fn(() => Promise.resolve()),
  })),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
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
  firestoreService: {
    setActiveStore: vi.fn(),
  },
}))

vi.mock('../../src/utils/authHelpers', () => ({
  getAuthErrorMessage: vi.fn((code, msg) => msg || code || 'Erreur'),
}))

// ---------------------------------------------------------------------------
// Imports après les mocks
// ---------------------------------------------------------------------------

import React from 'react'
import { renderHook, act, waitFor } from '@testing-library/react'
import { onAuthStateChanged, signInWithEmailAndPassword } from 'firebase/auth'
import { getDoc, setDoc } from 'firebase/firestore'
import { firestoreService } from '../../src/services/firestore'
import { AuthProvider, useAuth, resolveAuthenticatedProfile } from '../../src/context/AuthContext'
import { AUTH_ROLES } from '../../src/constants/authMessages'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const wrapper = ({ children }) => React.createElement(AuthProvider, null, children)

const lastLoginCalls = () =>
  setDoc.mock.calls.filter((call) => call[1] != null && 'lastLogin' in call[1])

const storeDocCalls = () =>
  getDoc.mock.calls.filter((call) => call[0]?._path?.startsWith('stores/'))

/** Simule onAuthStateChanged déclenchant immédiatement avec null (non connecté) */
const mockNotAuthenticated = () => {
  onAuthStateChanged.mockImplementation((_auth, callback) => {
    callback(null)
    return vi.fn()
  })
}

/** Simule onAuthStateChanged déclenchant immédiatement avec un user */
const mockAuthenticated = (user) => {
  onAuthStateChanged.mockImplementation((_auth, callback) => {
    callback(user)
    return vi.fn()
  })
}

/** Profils de test */
const profiles = {
  storeAdmin: (overrides = {}) => ({
    active: true,
    role: AUTH_ROLES.STORE_ADMIN,
    storeId: 'store-abc',
    storeName: 'Boutique Alpha',
    name: 'Admin Alpha',
    email: 'admin@alpha.com',
    ...overrides,
  }),
  systemManager: (overrides = {}) => ({
    active: true,
    role: AUTH_ROLES.SYSTEM_MANAGER,
    name: 'Gérant Global',
    email: 'manager@akayis.com',
    ...overrides,
  }),
  dealer: (overrides = {}) => ({
    active: true,
    role: AUTH_ROLES.DEALER,
    name: 'Dealer Test',
    email: 'dealer@akayis.com',
    ...overrides,
  }),
}

const storeData = (overrides = {}) => ({
  name: 'Boutique Alpha',
  active: true,
  ...overrides,
})

/**
 * Configure getDoc pour retourner un profil utilisateur et éventuellement des données de boutique.
 */
const mockGetDoc = ({ userProfile, storeExists = true, storeActive = true }) => {
  getDoc.mockImplementation((docRef) => {
    if (docRef._path?.startsWith('users/')) {
      if (!userProfile) return Promise.resolve({ exists: () => false, data: () => null })
      return Promise.resolve({ exists: () => true, data: () => userProfile })
    }
    if (docRef._path?.startsWith('stores/')) {
      if (!storeExists) return Promise.resolve({ exists: () => false, data: () => null })
      return Promise.resolve({ exists: () => true, data: () => storeData({ active: storeActive }) })
    }
    return Promise.resolve({ exists: () => false, data: () => null })
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TC-025 — Authentification multi-rôles V2', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNotAuthenticated()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // =========================================================================
  // SECTION A — store_admin (comportement actuel verrouillé)
  // =========================================================================

  describe('A — store_admin (comportement actuel verrouillé)', () => {
    it('A-1 : profil actif, storeId valide, boutique active → session autorisée', async () => {
      const user = { uid: 'uid-sa-1' }
      mockGetDoc({ userProfile: profiles.storeAdmin() })
      mockAuthenticated(user)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.userProfile).not.toBeNull()
      expect(result.current.userProfile.role).toBe(AUTH_ROLES.STORE_ADMIN)
      expect(result.current.activeStore).not.toBeNull()
      expect(result.current.activeStore.id).toBe('store-abc')
      expect(result.current.isStoreAdmin).toBe(true)
      expect(result.current.hasStoreContext).toBe(true)
    })

    it('A-2 : storeId absent → session refusée, userProfile null', async () => {
      const user = { uid: 'uid-sa-2' }
      mockGetDoc({ userProfile: profiles.storeAdmin({ storeId: undefined }) })
      mockAuthenticated(user)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.userProfile).toBeNull()
      expect(result.current.activeStore).toBeNull()
    })

    it('A-3 : boutique inexistante → session refusée, userProfile null', async () => {
      const user = { uid: 'uid-sa-3' }
      mockGetDoc({ userProfile: profiles.storeAdmin(), storeExists: false })
      mockAuthenticated(user)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.userProfile).toBeNull()
      expect(result.current.activeStore).toBeNull()
    })

    it('A-4 : boutique inactive → session refusée, userProfile null', async () => {
      const user = { uid: 'uid-sa-4' }
      mockGetDoc({ userProfile: profiles.storeAdmin(), storeActive: false })
      mockAuthenticated(user)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.userProfile).toBeNull()
      expect(result.current.activeStore).toBeNull()
    })

    it('A-5 : profil inactif → session refusée', async () => {
      const user = { uid: 'uid-sa-5' }
      mockGetDoc({ userProfile: profiles.storeAdmin({ active: false }) })
      mockAuthenticated(user)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.userProfile).toBeNull()
      expect(result.current.activeStore).toBeNull()
    })

    it('A-6 : activeStore contient id, name, active conformes', async () => {
      const user = { uid: 'uid-sa-6' }
      mockGetDoc({ userProfile: profiles.storeAdmin() })
      mockAuthenticated(user)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.activeStore).toMatchObject({
        id: 'store-abc',
        name: 'Boutique Alpha',
        active: true,
      })
    })

    it('A-7 : lastLogin écrit une seule fois pour boutique active', async () => {
      const user = { uid: 'uid-sa-7' }
      mockGetDoc({ userProfile: profiles.storeAdmin() })
      mockAuthenticated(user)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      const calls = lastLoginCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0][0]._path).toBe('users/uid-sa-7')
      expect(calls[0][2]).toEqual({ merge: true })
    })
  })

  // =========================================================================
  // SECTION B — system_manager
  // =========================================================================

  describe('B — system_manager', () => {
    it('B-1 : profil actif sans storeId → session autorisée', async () => {
      const user = { uid: 'uid-sm-1' }
      mockGetDoc({ userProfile: profiles.systemManager() })
      mockAuthenticated(user)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.userProfile).not.toBeNull()
      expect(result.current.userProfile.role).toBe(AUTH_ROLES.SYSTEM_MANAGER)
      expect(result.current.isSystemManager).toBe(true)
    })

    it('B-2 : aucune lecture de stores/{storeId} pour system_manager', async () => {
      const user = { uid: 'uid-sm-2' }
      mockGetDoc({ userProfile: profiles.systemManager() })
      mockAuthenticated(user)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(storeDocCalls()).toHaveLength(0)
    })

    it('B-3 : activeStore doit être null pour system_manager', async () => {
      const user = { uid: 'uid-sm-3' }
      mockGetDoc({ userProfile: profiles.systemManager() })
      mockAuthenticated(user)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.activeStore).toBeNull()
    })

    it('B-4 : hasStoreContext est false pour system_manager', async () => {
      const user = { uid: 'uid-sm-4' }
      mockGetDoc({ userProfile: profiles.systemManager() })
      mockAuthenticated(user)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.hasStoreContext).toBe(false)
    })

    it('B-5 : profil inactif → session refusée', async () => {
      const user = { uid: 'uid-sm-5' }
      mockGetDoc({ userProfile: profiles.systemManager({ active: false }) })
      mockAuthenticated(user)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.userProfile).toBeNull()
    })

    it('B-6 : lastLogin écrit une fois même sans boutique (system_manager)', async () => {
      const user = { uid: 'uid-sm-6' }
      mockGetDoc({ userProfile: profiles.systemManager() })
      mockAuthenticated(user)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      const calls = lastLoginCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0][0]._path).toBe('users/uid-sm-6')
    })

    it('B-7 : firestoreService.setActiveStore(null) pour system_manager', async () => {
      const user = { uid: 'uid-sm-7' }
      mockGetDoc({ userProfile: profiles.systemManager() })
      mockAuthenticated(user)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(firestoreService.setActiveStore).toHaveBeenCalledWith(null)
    })
  })

  // =========================================================================
  // SECTION C — dealer
  // =========================================================================

  describe('C — dealer', () => {
    it('C-1 : profil actif sans storeId → session autorisée', async () => {
      const user = { uid: 'uid-dl-1' }
      mockGetDoc({ userProfile: profiles.dealer() })
      mockAuthenticated(user)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.userProfile).not.toBeNull()
      expect(result.current.userProfile.role).toBe(AUTH_ROLES.DEALER)
      expect(result.current.isDealer).toBe(true)
    })

    it('C-2 : aucune lecture de stores/{storeId} pour dealer', async () => {
      const user = { uid: 'uid-dl-2' }
      mockGetDoc({ userProfile: profiles.dealer() })
      mockAuthenticated(user)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(storeDocCalls()).toHaveLength(0)
    })

    it('C-3 : activeStore doit être null pour dealer', async () => {
      const user = { uid: 'uid-dl-3' }
      mockGetDoc({ userProfile: profiles.dealer() })
      mockAuthenticated(user)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.activeStore).toBeNull()
    })

    it('C-4 : hasStoreContext est false pour dealer', async () => {
      const user = { uid: 'uid-dl-4' }
      mockGetDoc({ userProfile: profiles.dealer() })
      mockAuthenticated(user)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.hasStoreContext).toBe(false)
    })

    it('C-5 : profil inactif → session refusée', async () => {
      const user = { uid: 'uid-dl-5' }
      mockGetDoc({ userProfile: profiles.dealer({ active: false }) })
      mockAuthenticated(user)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.userProfile).toBeNull()
    })

    it('C-6 : lastLogin écrit une fois même sans boutique (dealer)', async () => {
      const user = { uid: 'uid-dl-6' }
      mockGetDoc({ userProfile: profiles.dealer() })
      mockAuthenticated(user)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      const calls = lastLoginCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0][0]._path).toBe('users/uid-dl-6')
    })

    it('C-7 : isStoreAdmin et isSystemManager sont false pour dealer', async () => {
      const user = { uid: 'uid-dl-7' }
      mockGetDoc({ userProfile: profiles.dealer() })
      mockAuthenticated(user)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.isStoreAdmin).toBe(false)
      expect(result.current.isSystemManager).toBe(false)
    })
  })

  // =========================================================================
  // SECTION D — rôle inconnu → refus
  // =========================================================================

  describe('D — rôle inconnu', () => {
    it('D-1 : profil avec rôle inconnu → session refusée', async () => {
      const user = { uid: 'uid-uk-1' }
      mockGetDoc({
        userProfile: {
          active: true,
          role: 'super_admin_unknown',
          name: 'Inconnu',
          email: 'unknown@test.com',
        },
      })
      mockAuthenticated(user)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.userProfile).toBeNull()
      expect(result.current.activeStore).toBeNull()
    })

    it('D-2 : rôle inconnu → aucun lastLogin écrit', async () => {
      const user = { uid: 'uid-uk-2' }
      mockGetDoc({
        userProfile: { active: true, role: 'hacker', name: 'H', email: 'h@t.com' },
      })
      mockAuthenticated(user)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(lastLoginCalls()).toHaveLength(0)
    })

    it('D-3 : profil introuvable → session refusée', async () => {
      const user = { uid: 'uid-nf-1' }
      mockGetDoc({ userProfile: null })
      mockAuthenticated(user)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.userProfile).toBeNull()
      expect(result.current.activeStore).toBeNull()
    })
  })

  // =========================================================================
  // SECTION E — resolveAuthenticatedProfile (fonction directe)
  // =========================================================================

  describe('E — resolveAuthenticatedProfile (fonction exportée)', () => {
    it('E-1 : store_admin valide → retourne { profile, store }', async () => {
      mockGetDoc({ userProfile: profiles.storeAdmin() })

      const result = await resolveAuthenticatedProfile('uid-e1')

      expect(result.profile.role).toBe(AUTH_ROLES.STORE_ADMIN)
      expect(result.store).not.toBeNull()
      expect(result.store.id).toBe('store-abc')
      expect(result.store.active).toBe(true)
    })

    it('E-2 : system_manager → retourne { profile, store: null }', async () => {
      mockGetDoc({ userProfile: profiles.systemManager() })

      const result = await resolveAuthenticatedProfile('uid-e2')

      expect(result.profile.role).toBe(AUTH_ROLES.SYSTEM_MANAGER)
      expect(result.store).toBeNull()
    })

    it('E-3 : dealer → retourne { profile, store: null }', async () => {
      mockGetDoc({ userProfile: profiles.dealer() })

      const result = await resolveAuthenticatedProfile('uid-e3')

      expect(result.profile.role).toBe(AUTH_ROLES.DEALER)
      expect(result.store).toBeNull()
    })

    it('E-4 : profil inactif → lance une erreur', async () => {
      mockGetDoc({ userProfile: profiles.storeAdmin({ active: false }) })

      await expect(resolveAuthenticatedProfile('uid-e4')).rejects.toThrow('Compte inactif')
    })

    it('E-5 : rôle inconnu → lance une erreur', async () => {
      mockGetDoc({ userProfile: { active: true, role: 'ghost', name: 'G', email: 'g@g.com' } })

      await expect(resolveAuthenticatedProfile('uid-e5')).rejects.toThrow('Rôle non autorisé')
    })

    it('E-6 : store_admin sans storeId → lance une erreur', async () => {
      mockGetDoc({ userProfile: profiles.storeAdmin({ storeId: undefined }) })

      await expect(resolveAuthenticatedProfile('uid-e6')).rejects.toThrow(
        'Compte non rattaché à une boutique active'
      )
    })

    it('E-7 : boutique introuvable → lance une erreur', async () => {
      mockGetDoc({ userProfile: profiles.storeAdmin(), storeExists: false })

      await expect(resolveAuthenticatedProfile('uid-e7')).rejects.toThrow('Boutique introuvable')
    })

    it('E-8 : boutique inactive → lance une erreur', async () => {
      mockGetDoc({ userProfile: profiles.storeAdmin(), storeActive: false })

      await expect(resolveAuthenticatedProfile('uid-e8')).rejects.toThrow('Boutique inactive')
    })

    it('E-9 : system_manager → ne lit jamais stores/', async () => {
      mockGetDoc({ userProfile: profiles.systemManager() })

      await resolveAuthenticatedProfile('uid-e9')

      expect(storeDocCalls()).toHaveLength(0)
    })

    it('E-10 : dealer → ne lit jamais stores/', async () => {
      mockGetDoc({ userProfile: profiles.dealer() })

      await resolveAuthenticatedProfile('uid-e10')

      expect(storeDocCalls()).toHaveLength(0)
    })
  })

  // =========================================================================
  // SECTION F — Régression
  // =========================================================================

  describe('F — Régression', () => {
    it('F-1 : signin utilise resolveAuthenticatedProfile (appel getDoc users/ et stores/)', async () => {
      mockNotAuthenticated()
      const user = { uid: 'uid-f1' }
      signInWithEmailAndPassword.mockResolvedValue({ user })
      mockGetDoc({ userProfile: profiles.storeAdmin() })

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      vi.clearAllMocks()
      // onAuthStateChanged ne déclenche rien pendant signin dans ce test
      onAuthStateChanged.mockImplementation(() => vi.fn())
      mockGetDoc({ userProfile: profiles.storeAdmin() })

      await act(async () => {
        await result.current.signin('admin@alpha.com', 'password')
      })

      // getDoc doit avoir été appelé pour users/ et stores/
      const userCalls = getDoc.mock.calls.filter((c) => c[0]?._path?.startsWith('users/'))
      const storeCalls = getDoc.mock.calls.filter((c) => c[0]?._path?.startsWith('stores/'))
      expect(userCalls.length).toBeGreaterThan(0)
      expect(storeCalls.length).toBeGreaterThan(0)
    })

    it('F-2 : signin system_manager → ne lit pas stores/', async () => {
      mockNotAuthenticated()
      const user = { uid: 'uid-f2' }
      signInWithEmailAndPassword.mockResolvedValue({ user })
      mockGetDoc({ userProfile: profiles.systemManager() })

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      vi.clearAllMocks()
      onAuthStateChanged.mockImplementation(() => vi.fn())
      mockGetDoc({ userProfile: profiles.systemManager() })

      await act(async () => {
        await result.current.signin('manager@akayis.com', 'password')
      })

      expect(storeDocCalls()).toHaveLength(0)
    })

    it('F-3 : signin ne doit pas écrire lastLogin', async () => {
      mockNotAuthenticated()
      const user = { uid: 'uid-f3' }
      signInWithEmailAndPassword.mockResolvedValue({ user })
      mockGetDoc({ userProfile: profiles.storeAdmin() })

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      vi.clearAllMocks()
      onAuthStateChanged.mockImplementation(() => vi.fn())
      mockGetDoc({ userProfile: profiles.storeAdmin() })

      await act(async () => {
        await result.current.signin('admin@alpha.com', 'password')
      })

      // lastLogin n'est jamais écrit par signin(), uniquement par onAuthStateChanged
      expect(lastLoginCalls()).toHaveLength(0)
    })

    it('F-4 : logout vide userProfile et activeStore', async () => {
      const user = { uid: 'uid-f4' }
      mockGetDoc({ userProfile: profiles.storeAdmin() })
      mockAuthenticated(user)
      const { signOut } = await import('firebase/auth')
      if (signOut.mockResolvedValue) signOut.mockResolvedValue()
      else vi.mocked(signOut).mockResolvedValue()

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.userProfile).not.toBeNull()

      await act(async () => {
        await result.current.logout()
      })

      expect(result.current.userProfile).toBeNull()
      expect(result.current.activeStore).toBeNull()
    })

    it('F-5 : erreur Auth ne laisse pas un état incohérent', async () => {
      mockNotAuthenticated()
      const authError = new Error('auth/wrong-password')
      authError.code = 'auth/wrong-password'
      signInWithEmailAndPassword.mockRejectedValue(authError)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      vi.clearAllMocks()
      onAuthStateChanged.mockImplementation(() => vi.fn())

      await act(async () => {
        await expect(result.current.signin('bad@test.com', 'wrong')).rejects.toThrow()
      })

      // userProfile et activeStore restent null après une erreur de connexion
      expect(result.current.userProfile).toBeNull()
      expect(result.current.activeStore).toBeNull()
    })

    it('F-6 : helpers dérivés cohérents — un seul rôle true à la fois (store_admin)', async () => {
      const user = { uid: 'uid-f6' }
      mockGetDoc({ userProfile: profiles.storeAdmin() })
      mockAuthenticated(user)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.isStoreAdmin).toBe(true)
      expect(result.current.isSystemManager).toBe(false)
      expect(result.current.isDealer).toBe(false)
    })

    it('F-7 : helpers dérivés cohérents — un seul rôle true à la fois (system_manager)', async () => {
      const user = { uid: 'uid-f7' }
      mockGetDoc({ userProfile: profiles.systemManager() })
      mockAuthenticated(user)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.isStoreAdmin).toBe(false)
      expect(result.current.isSystemManager).toBe(true)
      expect(result.current.isDealer).toBe(false)
    })

    it('F-8 : helpers dérivés cohérents — un seul rôle true à la fois (dealer)', async () => {
      const user = { uid: 'uid-f8' }
      mockGetDoc({ userProfile: profiles.dealer() })
      mockAuthenticated(user)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.isStoreAdmin).toBe(false)
      expect(result.current.isSystemManager).toBe(false)
      expect(result.current.isDealer).toBe(true)
    })

    it('F-9 : aucune double écriture lastLogin lors d\'onAuthStateChanged (store_admin)', async () => {
      const user = { uid: 'uid-f9' }
      mockGetDoc({ userProfile: profiles.storeAdmin() })
      mockAuthenticated(user)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      // Un seul onAuthStateChanged déclenché → un seul lastLogin
      expect(lastLoginCalls()).toHaveLength(1)
    })

    it('F-10 : role expose la valeur brute du profil', async () => {
      const user = { uid: 'uid-f10' }
      mockGetDoc({ userProfile: profiles.systemManager() })
      mockAuthenticated(user)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.role).toBe(AUTH_ROLES.SYSTEM_MANAGER)
    })
  })

  // =========================================================================
  // SECTION G — Course asynchrone (invalidation des résolutions obsolètes)
  // =========================================================================

  describe('G — Course asynchrone', () => {
    /**
     * Stratégie :
     *   - onAuthStateChanged est mocké pour capturer le callback manuellement
     *   - getDoc est mocké différemment selon l'uid pour contrôler la vitesse de résolution
     *   - Le premier callback déclenche une résolution bloquante
     *   - Le second callback déclenche une résolution rapide
     *   - La résolution lente se termine en dernier → doit être ignorée (resolutionId obsolète)
     */

    it('G-1 : store_admin lent → dealer rapide : état final = dealer', async () => {
      let authCallback = null
      onAuthStateChanged.mockImplementation((_auth, cb) => {
        // Déclenche immédiatement avec null pour initialiser le hook
        cb(null)
        authCallback = cb
        return vi.fn()
      })

      const userAdmin = { uid: 'uid-g1-admin' }
      const userDealer = { uid: 'uid-g1-dealer' }

      // La résolution admin sera retardée manuellement
      let resolveAdminGetDoc
      const adminGetDocPromise = new Promise((res) => { resolveAdminGetDoc = res })

      getDoc.mockImplementation((docRef) => {
        if (docRef._path === `users/${userAdmin.uid}`) return adminGetDocPromise
        if (docRef._path === `users/${userDealer.uid}`) {
          return Promise.resolve({ exists: () => true, data: () => profiles.dealer() })
        }
        // stores/ pour admin si jamais resolveAuthenticatedProfile y arrive
        if (docRef._path?.startsWith('stores/')) {
          return Promise.resolve({ exists: () => true, data: () => storeData() })
        }
        return Promise.resolve({ exists: () => false, data: () => null })
      })

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      // Événement 1 : admin (résolution lente, bloquée)
      act(() => { authCallback(userAdmin) })

      // Événement 2 : dealer (résolution immédiate, invalide l'admin)
      act(() => { authCallback(userDealer) })

      // Attendre que dealer termine sa résolution
      await waitFor(() => expect(result.current.loading).toBe(false))
      await waitFor(() => expect(result.current.isDealer).toBe(true))

      // Libérer la résolution admin (trop tard — resolutionId obsolète)
      act(() => {
        resolveAdminGetDoc({ exists: () => true, data: () => profiles.storeAdmin() })
      })

      // Laisser la microtask queue se vider
      await waitFor(() => expect(result.current.loading).toBe(false))

      // État final : dealer gagne, aucun vestige admin
      expect(result.current.userProfile?.role).toBe(AUTH_ROLES.DEALER)
      expect(result.current.activeStore).toBeNull()
      expect(result.current.isDealer).toBe(true)
      expect(result.current.isStoreAdmin).toBe(false)
    })

    it('G-2 : dealer lent → store_admin rapide : état final = store_admin', async () => {
      let authCallback = null
      onAuthStateChanged.mockImplementation((_auth, cb) => {
        cb(null)
        authCallback = cb
        return vi.fn()
      })

      const userDealer = { uid: 'uid-g2-dealer' }
      const userAdmin = { uid: 'uid-g2-admin' }

      let resolveDealerGetDoc
      const dealerGetDocPromise = new Promise((res) => { resolveDealerGetDoc = res })

      getDoc.mockImplementation((docRef) => {
        if (docRef._path === `users/${userDealer.uid}`) return dealerGetDocPromise
        if (docRef._path === `users/${userAdmin.uid}`) {
          return Promise.resolve({ exists: () => true, data: () => profiles.storeAdmin() })
        }
        if (docRef._path?.startsWith('stores/')) {
          return Promise.resolve({ exists: () => true, data: () => storeData() })
        }
        return Promise.resolve({ exists: () => false, data: () => null })
      })

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      // Événement 1 : dealer (résolution lente)
      act(() => { authCallback(userDealer) })

      // Événement 2 : admin (résolution immédiate, invalide dealer)
      act(() => { authCallback(userAdmin) })

      // Attendre que admin termine
      await waitFor(() => expect(result.current.loading).toBe(false))
      await waitFor(() => expect(result.current.isStoreAdmin).toBe(true))

      // Libérer dealer (trop tard)
      act(() => {
        resolveDealerGetDoc({ exists: () => true, data: () => profiles.dealer() })
      })

      await waitFor(() => expect(result.current.loading).toBe(false))

      // État final : admin gagne, activeStore présent, aucun vestige dealer
      expect(result.current.userProfile?.role).toBe(AUTH_ROLES.STORE_ADMIN)
      expect(result.current.activeStore).not.toBeNull()
      expect(result.current.isStoreAdmin).toBe(true)
      expect(result.current.isDealer).toBe(false)
    })

    it('G-3 : logout pendant résolution → état final entièrement déconnecté', async () => {
      let authCallback = null
      onAuthStateChanged.mockImplementation((_auth, cb) => {
        cb(null)
        authCallback = cb
        return vi.fn()
      })

      const { signOut } = await import('firebase/auth')
      vi.mocked(signOut).mockResolvedValue(undefined)

      const userAdmin = { uid: 'uid-g3-admin' }

      let resolveAdminGetDoc
      const adminGetDocPromise = new Promise((res) => { resolveAdminGetDoc = res })

      getDoc.mockImplementation((docRef) => {
        if (docRef._path === `users/${userAdmin.uid}`) return adminGetDocPromise
        return Promise.resolve({ exists: () => false, data: () => null })
      })

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      // Démarrer la résolution admin (bloquée)
      act(() => { authCallback(userAdmin) })

      // Logout → déclenche onAuthStateChanged(null)
      act(() => { authCallback(null) })

      await waitFor(() => expect(result.current.loading).toBe(false))

      // Libérer admin (trop tard, déconnexion a incrémenté le resolutionId)
      act(() => {
        resolveAdminGetDoc({ exists: () => true, data: () => profiles.storeAdmin() })
      })

      await waitFor(() => expect(result.current.loading).toBe(false))

      // État final : complètement déconnecté
      expect(result.current.currentUser).toBeNull()
      expect(result.current.userProfile).toBeNull()
      expect(result.current.activeStore).toBeNull()
    })

    it('G-4 : lastLogin écrit uniquement pour la résolution gagnante', async () => {
      let authCallback = null
      onAuthStateChanged.mockImplementation((_auth, cb) => {
        cb(null)
        authCallback = cb
        return vi.fn()
      })

      const userAdmin = { uid: 'uid-g4-admin' }
      const userDealer = { uid: 'uid-g4-dealer' }

      let resolveAdminGetDoc
      const adminGetDocPromise = new Promise((res) => { resolveAdminGetDoc = res })

      getDoc.mockImplementation((docRef) => {
        if (docRef._path === `users/${userAdmin.uid}`) return adminGetDocPromise
        if (docRef._path === `users/${userDealer.uid}`) {
          return Promise.resolve({ exists: () => true, data: () => profiles.dealer() })
        }
        return Promise.resolve({ exists: () => false, data: () => null })
      })

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      vi.clearAllMocks()
      getDoc.mockImplementation((docRef) => {
        if (docRef._path === `users/${userAdmin.uid}`) return adminGetDocPromise
        if (docRef._path === `users/${userDealer.uid}`) {
          return Promise.resolve({ exists: () => true, data: () => profiles.dealer() })
        }
        return Promise.resolve({ exists: () => false, data: () => null })
      })

      // Admin lent puis dealer rapide
      act(() => { authCallback(userAdmin) })
      act(() => { authCallback(userDealer) })

      await waitFor(() => expect(result.current.isDealer).toBe(true))

      // Libérer admin (obsolète)
      act(() => {
        resolveAdminGetDoc({ exists: () => true, data: () => profiles.storeAdmin() })
      })
      await waitFor(() => expect(result.current.loading).toBe(false))

      // Seul dealer a écrit lastLogin
      const loginCalls = lastLoginCalls()
      expect(loginCalls).toHaveLength(1)
      expect(loginCalls[0][0]._path).toBe(`users/${userDealer.uid}`)
    })

    it('G-5 : unmount pendant résolution → aucun setState tardif', async () => {
      let authCallback = null
      onAuthStateChanged.mockImplementation((_auth, cb) => {
        cb(null)
        authCallback = cb
        return vi.fn()
      })

      let resolveGetDoc
      const pendingGetDoc = new Promise((res) => { resolveGetDoc = res })

      getDoc.mockImplementation((docRef) => {
        if (docRef._path?.startsWith('users/')) return pendingGetDoc
        return Promise.resolve({ exists: () => false, data: () => null })
      })

      const { result, unmount } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      // Démarrer une résolution bloquante
      act(() => { authCallback({ uid: 'uid-g5-unmount' }) })

      // Démonter pendant la résolution (met resolutionId à MAX_SAFE_INTEGER)
      unmount()

      // Résoudre après démontage (doit être silencieux, pas de setState)
      act(() => {
        resolveGetDoc({ exists: () => true, data: () => profiles.storeAdmin() })
      })

      // Attendre pour laisser la promesse se propager
      await new Promise((res) => setTimeout(res, 20))

      // Si aucune exception n'est levée, le test passe
    })
  })

  // =========================================================================
  // SECTION H — error / authError
  // =========================================================================

  describe('H — error / authError', () => {
    it('H-1 : erreur précédente puis résolution réussie → error et authError vides', async () => {
      let authCallback = null
      // Premier événement déclenché automatiquement avec utilisateur invalide
      const userBad = { uid: 'uid-h1-bad' }
      onAuthStateChanged.mockImplementation((_auth, cb) => {
        authCallback = cb
        // Déclencher immédiatement avec l'utilisateur mauvais (boutique inexistante)
        cb(userBad)
        return vi.fn()
      })

      getDoc.mockImplementation((docRef) => {
        if (docRef._path?.startsWith('users/')) {
          return Promise.resolve({ exists: () => true, data: () => profiles.storeAdmin() })
        }
        // store inexistant → Boutique introuvable
        return Promise.resolve({ exists: () => false, data: () => null })
      })

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      // Vérifier qu'une erreur a bien été générée
      expect(result.current.error).toBeTruthy()

      // Deuxième événement : utilisateur valide (system_manager)
      const userGood = { uid: 'uid-h1-good' }
      getDoc.mockImplementation((docRef) => {
        if (docRef._path === `users/${userGood.uid}`) {
          return Promise.resolve({ exists: () => true, data: () => profiles.systemManager() })
        }
        return Promise.resolve({ exists: () => false, data: () => null })
      })

      act(() => { authCallback(userGood) })
      await waitFor(() => expect(result.current.loading).toBe(false))
      await waitFor(() => expect(result.current.isSystemManager).toBe(true))

      expect(result.current.error).toBe('')
      expect(result.current.authError).toBe('')
    })

    it('H-2 : résolution échouée → error et authError exposent la même valeur', async () => {
      const user = { uid: 'uid-h2' }
      mockGetDoc({ userProfile: profiles.storeAdmin({ active: false }) })
      mockAuthenticated(user)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.error).toBeTruthy()
      expect(result.current.authError).toBe(result.current.error)
    })

    it('H-3 : authError est un alias exact de error', async () => {
      const user = { uid: 'uid-h3' }
      mockGetDoc({ userProfile: profiles.dealer() })
      mockAuthenticated(user)

      const { result } = renderHook(() => useAuth(), { wrapper })
      await waitFor(() => expect(result.current.loading).toBe(false))

      // Après succès, les deux valent ''
      expect(result.current.authError).toBe(result.current.error)

      // Vérifier aussi après erreur
      const userBad = { uid: 'uid-h3-bad' }
      mockGetDoc({ userProfile: profiles.storeAdmin({ active: false }) })

      let authCallback2
      onAuthStateChanged.mockImplementation((_a, cb) => { authCallback2 = cb; return vi.fn() })
      const wrapper2 = ({ children }) => React.createElement(AuthProvider, null, children)
      const { result: result2 } = renderHook(() => useAuth(), { wrapper: wrapper2 })

      act(() => { authCallback2(userBad) })
      await waitFor(() => expect(result2.current.loading).toBe(false))

      expect(result2.current.authError).toBe(result2.current.error)
    })

    it('H-4 : logout efface l\'erreur active si le précédent événement avait échoué', async () => {
      // Simuler une résolution échouée
      const { signOut } = await import('firebase/auth')
      vi.mocked(signOut).mockResolvedValue(undefined)

      let authCallback = null
      onAuthStateChanged.mockImplementation((_auth, cb) => {
        authCallback = cb
        return vi.fn()
      })

      const userBad = { uid: 'uid-h4-bad' }
      getDoc.mockImplementation((docRef) => {
        if (docRef._path?.startsWith('users/')) {
          return Promise.resolve({ exists: () => true, data: () => profiles.storeAdmin() })
        }
        return Promise.resolve({ exists: () => false, data: () => null })
      })

      const { result } = renderHook(() => useAuth(), { wrapper })

      act(() => { authCallback(userBad) })
      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.error).toBeTruthy()

      // Logout → onAuthStateChanged(null) → setError('') synchrone
      act(() => { authCallback(null) })
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.error).toBe('')
      expect(result.current.userProfile).toBeNull()
      expect(result.current.activeStore).toBeNull()
    })
  })
})
