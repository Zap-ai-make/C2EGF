/**
 * TC-346 — L'application démarre sans internet (lot G0).
 *
 * CE QUI BLOQUAIT
 * ───────────────
 * Au démarrage, `AuthContext` lit le profil et la boutique, puis ATTENDAIT
 * l'écriture de `lastLogin` avant de baisser `loading`. Une écriture Firestore
 * ne se termine qu'à l'accusé du serveur : hors ligne, jamais. Le profil
 * venait du cache en 5 ms, et l'application restait pourtant sur son écran de
 * chargement. Vérifié sur l'émulateur avec le vrai SDK
 * (docs/rester-dans-le-quota-gratuit.md §G).
 *
 * Ce fichier fixe aussi les deux autres pièces du lot : la demande de stockage
 * persistant, et l'avertissement avant une déconnexion.
 */

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
  doc: vi.fn((_db, ...segments) => ({ _path: segments.join('/') })),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  writeBatch: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
}))

vi.mock('../../src/config/firebase', () => ({ auth: {}, db: {}, default: {} }))
vi.mock('../../src/services/firestore', () => ({ firestoreService: { setActiveStore: vi.fn() } }))
vi.mock('../../src/utils/authHelpers', async (importOriginal) => ({
  ...(await importOriginal()),
  getAuthErrorMessage: vi.fn((code, msg) => msg || code || 'Erreur'),
}))
vi.mock('../../src/context/ThemeContext', () => ({ useTheme: () => ({ themeClasses: {} }) }))
vi.mock('../../src/hooks/useUserActivity', () => ({ useUserActivity: () => ({}) }))

import React from 'react'
import { renderHook, waitFor, render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { onAuthStateChanged } from 'firebase/auth'
import { getDoc, setDoc } from 'firebase/firestore'
import { AuthProvider, useAuth } from '../../src/context/AuthContext'
import { demanderStockagePersistant } from '../../src/config/stockagePersistant.js'
import Profil from '../../src/pages/Profil.jsx'

const wrapper = ({ children }) => React.createElement(AuthProvider, null, children)

const UTILISATEUR = { uid: 'uid-1', email: 'boutique1@c2egf.test' }
const PROFIL = { active: true, role: 'store_admin', storeId: 'boutique-1', storeName: 'Boutique 1' }

/** Une session gardée sur la machine, et un profil que le cache sait lire. */
function sessionEnregistree() {
  getDoc.mockImplementation((ref) => Promise.resolve(
    ref._path.startsWith('users/')
      ? { exists: () => true, data: () => PROFIL }
      : { exists: () => true, data: () => ({ name: 'Boutique 1', active: true }) },
  ))
  onAuthStateChanged.mockImplementation((_auth, callback) => {
    callback(UTILISATEUR)
    return vi.fn()
  })
}

function demarrerAvecSession() {
  sessionEnregistree()
  return renderHook(() => useAuth(), { wrapper })
}

describe('TC-346 — démarrer sans internet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[HL-01] l\'écriture de lastLogin ne se termine jamais : l\'application s\'ouvre quand même', async () => {
    // Hors ligne, la promesse d'une écriture reste en attente jusqu'au retour du réseau.
    setDoc.mockImplementation(() => new Promise(() => {}))

    const { result } = demarrerAvecSession()

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.userProfile).toEqual(PROFIL)
    expect(result.current.activeStore).toMatchObject({ id: 'boutique-1', name: 'Boutique 1' })
    expect(result.current.error).toBe('')
    // L'écriture est bien demandée : elle partira au retour du réseau.
    expect(setDoc).toHaveBeenCalledWith({ _path: 'users/uid-1' }, { lastLogin: 'SERVER_TIMESTAMP' }, { merge: true })
  })

  it('[HL-02] l\'écriture de lastLogin échoue : l\'accès reste ouvert, l\'échec est signalé', async () => {
    const avertir = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setDoc.mockRejectedValue(Object.assign(new Error('refusé'), { code: 'permission-denied' }))

    const { result } = demarrerAvecSession()

    await waitFor(() => expect(avertir).toHaveBeenCalledWith('lastLogin non enregistré :', 'permission-denied'))
    expect(result.current.loading).toBe(false)
    expect(result.current.userProfile).toEqual(PROFIL)
    expect(result.current.error).toBe('')
  })
})

describe('TC-346 — demander le stockage persistant', () => {
  it('[HL-03] sans API, rien à demander', async () => {
    expect(await demanderStockagePersistant(undefined)).toBe('indisponible')
    expect(await demanderStockagePersistant({})).toBe('indisponible')
  })

  it('[HL-04] déjà accordé : on ne redemande pas', async () => {
    const storage = { persisted: vi.fn(async () => true), persist: vi.fn() }
    expect(await demanderStockagePersistant(storage)).toBe('deja-accorde')
    expect(storage.persist).not.toHaveBeenCalled()
  })

  it('[HL-05] la réponse du navigateur est rendue telle quelle', async () => {
    expect(await demanderStockagePersistant({ persisted: async () => false, persist: async () => true })).toBe('accorde')
    expect(await demanderStockagePersistant({ persisted: async () => false, persist: async () => false })).toBe('refuse')
  })

  it('[HL-06] une API qui lève ne casse pas le démarrage', async () => {
    const storage = { persisted: async () => { throw new Error('SecurityError') }, persist: async () => true }
    expect(await demanderStockagePersistant(storage)).toBe('indisponible')
  })
})

describe('TC-346 — avertir avant de se déconnecter', () => {
  it('[HL-07] la confirmation dit qu\'une reconnexion exige internet', async () => {
    setDoc.mockResolvedValue()
    sessionEnregistree()
    render(<AuthProvider><MemoryRouter><Profil /></MemoryRouter></AuthProvider>)

    fireEvent.click(await screen.findByRole('button', { name: 'Se déconnecter' }))

    expect(screen.getByRole('note')).toHaveTextContent('Sans connexion internet, vous ne pourrez pas vous reconnecter.')
  })
})
