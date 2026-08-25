/**
 * TC-021 — AuthContext : suppression de l'écriture redondante de lastLogin dans signin()
 *
 * Comportement à protéger :
 *   Avant la modification, signin() appelait setDoc({ lastLogin }) après signInWithEmailAndPassword,
 *   puis onAuthStateChanged appelait à nouveau setDoc({ lastLogin }), produisant 2 écritures
 *   identiques lors d'une connexion interactive.
 *
 *   Après suppression des lignes 174-176 de AuthContext.jsx :
 *   - signin() ne doit plus écrire lastLogin
 *   - onAuthStateChanged écrit toujours lastLogin une seule fois (comportement conservé)
 *   - L'erreur de connexion ne déclenche aucune écriture lastLogin
 *   - La boutique inactive ne déclenche aucune écriture lastLogin
 *
 * Architecture des mocks :
 *   - onAuthStateChanged est mocké pour capturer le callback sans l'exécuter automatiquement
 *   - signInWithEmailAndPassword résout ou rejette selon le scénario
 *   - setDoc est mocké pour vérifier les appels
 *   - getDoc est mocké pour simuler fetchUserProfile et fetchStoreProfile
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
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
} from 'firebase/auth'
import { setDoc, getDoc } from 'firebase/firestore'
import { AuthProvider, useAuth } from '../../src/context/AuthContext'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Filtre les appels à setDoc dont le payload contient la clé lastLogin */
const lastLoginCalls = () =>
  setDoc.mock.calls.filter(
    (call) => call[1] != null && 'lastLogin' in call[1]
  )

/** Wrapper React pour renderHook */
const wrapper = ({ children }) => React.createElement(AuthProvider, null, children)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TC-021 — AuthContext : suppression de l\'écriture redondante de lastLogin dans signin()', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Mock par défaut : onAuthStateChanged appelle immédiatement avec null (non authentifié)
    onAuthStateChanged.mockImplementation((_auth, callback) => {
      callback(null)
      return vi.fn() // unsubscribe
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Test 1 — signin() ne doit plus écrire lastLogin
  // -------------------------------------------------------------------------
  it('Test 1 — signin() : setDoc avec lastLogin absent après suppression', async () => {
    // Données utilisateur valide
    const mockUser = { uid: 'uid123', email: 'test@example.com' }
    const mockProfile = {
      active: true,
      storeId: 'store-abc',
      storeName: 'Boutique Test',
      role: 'store_admin',
    }
    const mockStoreData = { name: 'Boutique Test', active: true }

    // signInWithEmailAndPassword résout avec le user
    signInWithEmailAndPassword.mockResolvedValue({ user: mockUser })

    // getDoc : premier appel = profil utilisateur, second appel = boutique
    getDoc.mockImplementation((docRef) => {
      if (docRef._path && docRef._path.startsWith('users/')) {
        return Promise.resolve({
          exists: () => true,
          data: () => mockProfile,
        })
      }
      if (docRef._path && docRef._path.startsWith('stores/')) {
        return Promise.resolve({
          exists: () => true,
          data: () => mockStoreData,
        })
      }
      return Promise.resolve({ exists: () => false, data: () => null })
    })

    const { result } = renderHook(() => useAuth(), { wrapper })

    // Attendre que le chargement initial se termine (onAuthStateChanged avec null)
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Réinitialiser les mocks après le chargement initial
    vi.clearAllMocks()
    onAuthStateChanged.mockImplementation((_auth, _callback) => vi.fn())

    // Appeler signin()
    await act(async () => {
      await result.current.signin('test@example.com', 'password123')
    })

    // Vérification principale : setDoc avec lastLogin ne doit PAS avoir été appelé depuis signin()
    const callsWithLastLogin = lastLoginCalls()
    expect(callsWithLastLogin).toHaveLength(0)
  })

  // -------------------------------------------------------------------------
  // Test 2 — onAuthStateChanged écrit lastLogin exactement une fois
  // -------------------------------------------------------------------------
  it('Test 2 — onAuthStateChanged : setDoc avec lastLogin appelé une fois pour boutique active', async () => {
    const mockUser = { uid: 'uid123', email: 'test@example.com' }
    const mockProfile = {
      active: true,
      storeId: 'store-abc',
      storeName: 'Boutique Test',
      role: 'store_admin',
    }
    const mockStoreData = { name: 'Boutique Test', active: true }

    // getDoc mocké pour retourner données valides
    getDoc.mockImplementation((docRef) => {
      if (docRef._path && docRef._path.startsWith('users/')) {
        return Promise.resolve({
          exists: () => true,
          data: () => mockProfile,
        })
      }
      if (docRef._path && docRef._path.startsWith('stores/')) {
        return Promise.resolve({
          exists: () => true,
          data: () => mockStoreData,
        })
      }
      return Promise.resolve({ exists: () => false, data: () => null })
    })

    // onAuthStateChanged déclenche immédiatement avec un utilisateur authentifié
    onAuthStateChanged.mockImplementation((_auth, callback) => {
      callback(mockUser)
      return vi.fn()
    })

    const { result } = renderHook(() => useAuth(), { wrapper })

    // Attendre la fin du chargement après traitement de l'utilisateur
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Vérification : setDoc avec lastLogin appelé exactement une fois
    const callsWithLastLogin = lastLoginCalls()
    expect(callsWithLastLogin).toHaveLength(1)

    // Vérifier le chemin : users/uid123
    const docArg = callsWithLastLogin[0][0]
    expect(docArg._path).toBe('users/uid123')

    // Vérifier le payload : contient lastLogin
    const payload = callsWithLastLogin[0][1]
    expect(payload).toHaveProperty('lastLogin')

    // Vérifier merge: true
    const options = callsWithLastLogin[0][2]
    expect(options).toEqual({ merge: true })
  })

  // -------------------------------------------------------------------------
  // Test 3 — Boutique inactive : pas d'écriture lastLogin
  // -------------------------------------------------------------------------
  it('Test 3 — boutique inactive : setDoc avec lastLogin absent', async () => {
    const mockUser = { uid: 'uid456', email: 'test2@example.com' }
    const mockProfile = {
      active: true,
      storeId: 'store-inactive',
      storeName: 'Boutique Inactive',
      role: 'store_admin',
    }
    // La boutique est inactive
    const mockStoreData = { name: 'Boutique Inactive', active: false }

    getDoc.mockImplementation((docRef) => {
      if (docRef._path && docRef._path.startsWith('users/')) {
        return Promise.resolve({
          exists: () => true,
          data: () => mockProfile,
        })
      }
      if (docRef._path && docRef._path.startsWith('stores/')) {
        return Promise.resolve({
          exists: () => true,
          data: () => mockStoreData,
        })
      }
      return Promise.resolve({ exists: () => false, data: () => null })
    })

    // onAuthStateChanged avec boutique inactive — fetchStoreProfile lève une erreur
    // car storeData.active === false => store.active === false => throw new Error('Boutique inactive')
    onAuthStateChanged.mockImplementation((_auth, callback) => {
      callback(mockUser)
      return vi.fn()
    })

    const { result } = renderHook(() => useAuth(), { wrapper })

    // Attendre la fin du chargement
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Vérification : aucune écriture lastLogin car boutique inactive
    const callsWithLastLogin = lastLoginCalls()
    expect(callsWithLastLogin).toHaveLength(0)
  })

  // -------------------------------------------------------------------------
  // Test 4 — Échec de connexion : pas d'écriture lastLogin
  // -------------------------------------------------------------------------
  it('Test 4 — échec de connexion : setDoc avec lastLogin absent sur erreur Auth', async () => {
    // signInWithEmailAndPassword rejette avec une erreur Firebase
    const authError = new Error('Mot de passe incorrect')
    authError.code = 'auth/wrong-password'
    signInWithEmailAndPassword.mockRejectedValue(authError)

    const { result } = renderHook(() => useAuth(), { wrapper })

    // Attendre la fin du chargement initial
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Réinitialiser les mocks après le chargement initial
    vi.clearAllMocks()
    onAuthStateChanged.mockImplementation((_auth, _callback) => vi.fn())

    // signin() doit lever une erreur
    await act(async () => {
      await expect(
        result.current.signin('test@example.com', 'bad-password')
      ).rejects.toThrow()
    })

    // Vérification : aucune écriture lastLogin
    const callsWithLastLogin = lastLoginCalls()
    expect(callsWithLastLogin).toHaveLength(0)
  })
})
