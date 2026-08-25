/**
 * TC-038 — Tests unitaires storeDealerRequestCommandService
 *
 * Couvre :
 *   §SVC-CF  confirmDealerRequestCommand (validation, callable, payload, erreurs)
 *   §SVC-RJ  rejectDealerRequestCommand  (validation, callable, payload, erreurs)
 *   §SVC-SEC sécurité (aucune écriture Firestore directe, région europe-west1)
 *   §SVC-MAP mapCallableError (toutes les branches de mapping)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks hoistés
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  httpsCallable: vi.fn(),
  connectFunctionsEmulator: vi.fn(),
  getFunctions: vi.fn(() => ({})),
}))

vi.mock('firebase/functions', () => ({
  httpsCallable: mocks.httpsCallable,
  connectFunctionsEmulator: mocks.connectFunctionsEmulator,
  getFunctions: mocks.getFunctions,
}))

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({})),
  setLogLevel: vi.fn(),
}))

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
  addDoc: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(),
  writeBatch: vi.fn(), runTransaction: vi.fn(), increment: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TS'),
  query: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), startAfter: vi.fn(),
  onSnapshot: vi.fn(() => vi.fn()),
}))

vi.mock('../../src/config/firebase', () => ({
  auth: {}, db: {}, functions: {},
  firebaseInfo: { projectId: 'test', isDev: false, useEmulators: false },
  default: {},
}))

// ---------------------------------------------------------------------------
// Import après mocks
// ---------------------------------------------------------------------------

import {
  confirmDealerRequestCommand,
  rejectDealerRequestCommand,
  mapCallableError,
} from '../../src/services/storeDealerRequestCommandService'

import { addDoc, setDoc, updateDoc, deleteDoc, writeBatch, runTransaction } from 'firebase/firestore'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFirebaseError(funcCode, detailCode) {
  const err   = new Error('Firebase callable error')
  err.code    = funcCode
  err.details = detailCode ? { code: detailCode } : undefined
  return err
}

beforeEach(() => {
  vi.resetAllMocks()
})

// ===========================================================================
// §SVC-CF — confirmDealerRequestCommand
// ===========================================================================

describe('TC-038-CF — confirmDealerRequestCommand', () => {
  it('[SVC-CF-01] requestId valide → appelle httpsCallable et retourne data', async () => {
    const innerMock = vi.fn().mockResolvedValue({ data: { success: true, requestId: 'req-1' } })
    mocks.httpsCallable.mockReturnValue(innerMock)

    const result = await confirmDealerRequestCommand('req-1')

    expect(mocks.httpsCallable).toHaveBeenCalledWith({}, 'confirmDealerRequest')
    expect(innerMock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ success: true, requestId: 'req-1' })
  })

  it('[SVC-CF-02] payload envoyé est exactement { requestId }', async () => {
    const innerMock = vi.fn().mockResolvedValue({ data: { success: true } })
    mocks.httpsCallable.mockReturnValue(innerMock)

    await confirmDealerRequestCommand('req-abc')

    const sentPayload = innerMock.mock.calls[0][0]
    expect(sentPayload).toEqual({ requestId: 'req-abc' })
    expect(Object.keys(sentPayload)).toHaveLength(1)
  })

  it('[SVC-CF-03] requestId null → erreur locale (pas d\'appel callable)', async () => {
    const innerMock = vi.fn()
    mocks.httpsCallable.mockReturnValue(innerMock)

    await expect(confirmDealerRequestCommand(null)).rejects.toThrow()
    expect(innerMock).not.toHaveBeenCalled()
  })

  it('[SVC-CF-04] requestId vide → erreur locale', async () => {
    const innerMock = vi.fn()
    mocks.httpsCallable.mockReturnValue(innerMock)
    await expect(confirmDealerRequestCommand('')).rejects.toThrow()
    expect(innerMock).not.toHaveBeenCalled()
  })

  it('[SVC-CF-05] requestId espaces → erreur locale', async () => {
    const innerMock = vi.fn()
    mocks.httpsCallable.mockReturnValue(innerMock)
    await expect(confirmDealerRequestCommand('   ')).rejects.toThrow()
    expect(innerMock).not.toHaveBeenCalled()
  })

  it('[SVC-CF-06] requestId nombre → erreur locale', async () => {
    const innerMock = vi.fn()
    mocks.httpsCallable.mockReturnValue(innerMock)
    await expect(confirmDealerRequestCommand(42)).rejects.toThrow()
    expect(innerMock).not.toHaveBeenCalled()
  })

  it('[SVC-CF-07] callable nommé "confirmDealerRequest"', async () => {
    const innerMock = vi.fn().mockResolvedValue({ data: {} })
    mocks.httpsCallable.mockReturnValue(innerMock)
    await confirmDealerRequestCommand('req-1')
    expect(mocks.httpsCallable.mock.calls[0][1]).toBe('confirmDealerRequest')
  })

  it('[SVC-CF-08] erreur UNAUTHENTICATED → message session expirée, code préservé', async () => {
    const innerMock = vi.fn().mockRejectedValue(
      makeFirebaseError('functions/unauthenticated', 'UNAUTHENTICATED')
    )
    mocks.httpsCallable.mockReturnValue(innerMock)

    const err = await confirmDealerRequestCommand('req-1').catch(e => e)
    expect(err.message).toContain('session a expiré')
    expect(err.code).toBe('UNAUTHENTICATED')
  })

  it('[SVC-CF-09] erreur REQUEST_NOT_PENDING → code REQUEST_NOT_PENDING préservé dans err.code', async () => {
    const innerMock = vi.fn().mockRejectedValue(
      makeFirebaseError('functions/failed-precondition', 'REQUEST_NOT_PENDING')
    )
    mocks.httpsCallable.mockReturnValue(innerMock)

    const err = await confirmDealerRequestCommand('req-1').catch(e => e)
    expect(err.message).toContain('déjà été traitée')
    expect(err.code).toBe('REQUEST_NOT_PENDING')
  })

  it('[SVC-CF-10] erreur inconnue → message générique', async () => {
    const innerMock = vi.fn().mockRejectedValue(new Error('réseau indisponible'))
    mocks.httpsCallable.mockReturnValue(innerMock)

    const err = await confirmDealerRequestCommand('req-1').catch(e => e)
    expect(err.message).toContain('inattendue')
  })

  it('[SVC-CF-11] requestId trimé avant envoi', async () => {
    const innerMock = vi.fn().mockResolvedValue({ data: { success: true } })
    mocks.httpsCallable.mockReturnValue(innerMock)

    await confirmDealerRequestCommand('  req-trimmed  ')

    const sentPayload = innerMock.mock.calls[0][0]
    expect(sentPayload.requestId).toBe('req-trimmed')
  })
})

// ===========================================================================
// §SVC-RJ — rejectDealerRequestCommand
// ===========================================================================

describe('TC-038-RJ — rejectDealerRequestCommand', () => {
  it('[SVC-RJ-01] requestId + motif valides → appelle callable', async () => {
    const innerMock = vi.fn().mockResolvedValue({ data: { success: true } })
    mocks.httpsCallable.mockReturnValue(innerMock)

    await rejectDealerRequestCommand('req-1', 'Motif valide.')

    expect(mocks.httpsCallable).toHaveBeenCalledWith({}, 'rejectDealerRequest')
    expect(innerMock).toHaveBeenCalledTimes(1)
  })

  it('[SVC-RJ-02] payload exact { requestId, rejectionReason }', async () => {
    const innerMock = vi.fn().mockResolvedValue({ data: { success: true } })
    mocks.httpsCallable.mockReturnValue(innerMock)

    await rejectDealerRequestCommand('req-1', 'Motif valide.')

    const sent = innerMock.mock.calls[0][0]
    expect(sent).toEqual({ requestId: 'req-1', rejectionReason: 'Motif valide.' })
    expect(Object.keys(sent)).toHaveLength(2)
  })

  it('[SVC-RJ-03] motif vide → erreur locale', async () => {
    const innerMock = vi.fn()
    mocks.httpsCallable.mockReturnValue(innerMock)
    await expect(rejectDealerRequestCommand('req-1', '')).rejects.toThrow()
    expect(innerMock).not.toHaveBeenCalled()
  })

  it('[SVC-RJ-04] motif espaces → erreur locale', async () => {
    const innerMock = vi.fn()
    mocks.httpsCallable.mockReturnValue(innerMock)
    await expect(rejectDealerRequestCommand('req-1', '   ')).rejects.toThrow()
    expect(innerMock).not.toHaveBeenCalled()
  })

  it('[SVC-RJ-05] motif 2 chars → erreur locale (< 3)', async () => {
    const innerMock = vi.fn()
    mocks.httpsCallable.mockReturnValue(innerMock)
    await expect(rejectDealerRequestCommand('req-1', 'ab')).rejects.toThrow(/3/)
    expect(innerMock).not.toHaveBeenCalled()
  })

  it('[SVC-RJ-06] motif exactement 500 chars → OK', async () => {
    const innerMock = vi.fn().mockResolvedValue({ data: { success: true } })
    mocks.httpsCallable.mockReturnValue(innerMock)
    await expect(rejectDealerRequestCommand('req-1', 'a'.repeat(500))).resolves.toBeDefined()
    expect(innerMock).toHaveBeenCalledTimes(1)
  })

  it('[SVC-RJ-07] motif 501 chars → erreur locale', async () => {
    const innerMock = vi.fn()
    mocks.httpsCallable.mockReturnValue(innerMock)
    await expect(rejectDealerRequestCommand('req-1', 'a'.repeat(501))).rejects.toThrow(/500/)
    expect(innerMock).not.toHaveBeenCalled()
  })

  it('[SVC-RJ-08] motif trimé avant envoi', async () => {
    const innerMock = vi.fn().mockResolvedValue({ data: { success: true } })
    mocks.httpsCallable.mockReturnValue(innerMock)

    await rejectDealerRequestCommand('req-1', '  Motif espaces.  ')

    const sent = innerMock.mock.calls[0][0]
    expect(sent.rejectionReason).toBe('Motif espaces.')
  })

  it('[SVC-RJ-09] erreur BALANCE_OVERFLOW → message solde dépasse limite', async () => {
    const innerMock = vi.fn().mockRejectedValue(
      makeFirebaseError('functions/failed-precondition', 'BALANCE_OVERFLOW')
    )
    mocks.httpsCallable.mockReturnValue(innerMock)

    const err = await rejectDealerRequestCommand('req-1', 'Motif.').catch(e => e)
    expect(err.message).toContain('limite')
    expect(err.code).toBe('BALANCE_OVERFLOW')
  })

  it('[SVC-RJ-10] erreur ROLE_FORBIDDEN → message autorisation', async () => {
    const innerMock = vi.fn().mockRejectedValue(
      makeFirebaseError('functions/permission-denied', 'ROLE_FORBIDDEN')
    )
    mocks.httpsCallable.mockReturnValue(innerMock)

    const err = await rejectDealerRequestCommand('req-1', 'Motif.').catch(e => e)
    expect(err.message).toContain('autorisation')
    expect(err.code).toBe('ROLE_FORBIDDEN')
  })

  it('[SVC-RJ-11] motif null → erreur locale', async () => {
    const innerMock = vi.fn()
    mocks.httpsCallable.mockReturnValue(innerMock)
    await expect(rejectDealerRequestCommand('req-1', null)).rejects.toThrow()
    expect(innerMock).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// §SVC-MAP — mapCallableError
// ===========================================================================

describe('TC-038-MAP — mapCallableError', () => {
  it('[MAP-01] code métier UNAUTHENTICATED dans details.code → message session', () => {
    const err = makeFirebaseError('functions/unauthenticated', 'UNAUTHENTICATED')
    const mapped = mapCallableError(err)
    expect(mapped.message).toContain('session a expiré')
    expect(mapped.code).toBe('UNAUTHENTICATED')
  })

  it('[MAP-02] code métier REQUEST_NOT_PENDING → message déjà traitée', () => {
    const err = makeFirebaseError('functions/failed-precondition', 'REQUEST_NOT_PENDING')
    const mapped = mapCallableError(err)
    expect(mapped.message).toContain('déjà été traitée')
    expect(mapped.code).toBe('REQUEST_NOT_PENDING')
  })

  it('[MAP-03] code métier BALANCE_NOT_FOUND → message solde introuvable', () => {
    const err = makeFirebaseError('functions/failed-precondition', 'BALANCE_NOT_FOUND')
    const mapped = mapCallableError(err)
    expect(mapped.message).toContain('solde')
    expect(mapped.code).toBe('BALANCE_NOT_FOUND')
  })

  it('[MAP-04] code métier TRANSACTION_FAILED → message opération finalisée', () => {
    const err = makeFirebaseError('functions/internal', 'TRANSACTION_FAILED')
    const mapped = mapCallableError(err)
    expect(mapped.message).toContain('finalisée')
    expect(mapped.code).toBe('TRANSACTION_FAILED')
  })

  it('[MAP-05] pas de details, functions/unauthenticated → fallback UNAUTHENTICATED', () => {
    const err = makeFirebaseError('functions/unauthenticated', null)
    const mapped = mapCallableError(err)
    expect(mapped.message).toContain('session a expiré')
  })

  it('[MAP-06] erreur inconnue → message générique', () => {
    const mapped = mapCallableError(new Error('réseau'))
    expect(mapped.message).toContain('inattendue')
  })

  it('[MAP-07] erreur null → message générique (pas de crash)', () => {
    expect(() => mapCallableError(null)).not.toThrow()
  })
})

// ===========================================================================
// §SVC-SEC — Sécurité : aucun import Firestore write utilisé
// ===========================================================================

describe('TC-038-SEC — aucune écriture Firestore directe', () => {
  beforeEach(() => {
    const innerMock = vi.fn().mockResolvedValue({ data: { success: true } })
    mocks.httpsCallable.mockReturnValue(innerMock)
  })

  it('[SEC-01] confirmDealerRequestCommand → addDoc jamais appelé', async () => {
    await confirmDealerRequestCommand('req-1')
    expect(addDoc).not.toHaveBeenCalled()
  })

  it('[SEC-02] confirmDealerRequestCommand → setDoc jamais appelé', async () => {
    await confirmDealerRequestCommand('req-1')
    expect(setDoc).not.toHaveBeenCalled()
  })

  it('[SEC-03] confirmDealerRequestCommand → updateDoc jamais appelé', async () => {
    await confirmDealerRequestCommand('req-1')
    expect(updateDoc).not.toHaveBeenCalled()
  })

  it('[SEC-04] confirmDealerRequestCommand → deleteDoc jamais appelé', async () => {
    await confirmDealerRequestCommand('req-1')
    expect(deleteDoc).not.toHaveBeenCalled()
  })

  it('[SEC-05] confirmDealerRequestCommand → writeBatch jamais appelé', async () => {
    await confirmDealerRequestCommand('req-1')
    expect(writeBatch).not.toHaveBeenCalled()
  })

  it('[SEC-06] confirmDealerRequestCommand → runTransaction jamais appelé', async () => {
    await confirmDealerRequestCommand('req-1')
    expect(runTransaction).not.toHaveBeenCalled()
  })

  it('[SEC-07] rejectDealerRequestCommand → aucune écriture directe', async () => {
    await rejectDealerRequestCommand('req-1', 'Motif valide.')
    expect(addDoc).not.toHaveBeenCalled()
    expect(setDoc).not.toHaveBeenCalled()
    expect(updateDoc).not.toHaveBeenCalled()
    expect(deleteDoc).not.toHaveBeenCalled()
    expect(writeBatch).not.toHaveBeenCalled()
    expect(runTransaction).not.toHaveBeenCalled()
  })
})
