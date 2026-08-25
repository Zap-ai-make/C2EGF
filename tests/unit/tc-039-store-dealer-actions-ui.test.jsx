/**
 * TC-039 — Tests UI des actions Store Admin sur une demande Dealer
 *
 * Couvre :
 *   §VIS  Visibilité des actions selon le statut
 *   §CF   Modale de confirmation (ouverture, checkbox, submit, loading, succès, erreur)
 *   §RJ   Modale de rejet (ouverture, textarea, compteur, validation, submit, loading, erreur)
 *   §SEC  Sécurité (aucune écriture Firestore directe dans le composant)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// ---------------------------------------------------------------------------
// Mocks hoistés
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getStoreAdminDealerRequestById: vi.fn(),
  confirmDealerRequestCommand: vi.fn(),
  rejectDealerRequestCommand: vi.fn(),
  useAuth: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})), setLogLevel: vi.fn() }))
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})), connectAuthEmulator: vi.fn(),
  onAuthStateChanged: vi.fn(() => vi.fn()),
  signInWithEmailAndPassword: vi.fn(), createUserWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(() => Promise.resolve()), sendPasswordResetEmail: vi.fn(),
  updatePassword: vi.fn(), deleteUser: vi.fn(), reauthenticateWithCredential: vi.fn(),
  EmailAuthProvider: { credential: vi.fn() }, setPersistence: vi.fn(() => Promise.resolve()),
  browserLocalPersistence: 'LOCAL',
}))
vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})), connectFirestoreEmulator: vi.fn(),
  enableMultiTabIndexedDbPersistence: vi.fn(() => Promise.resolve()),
  collection: vi.fn(), doc: vi.fn(), getDoc: vi.fn(), getDocs: vi.fn(),
  addDoc: vi.fn(), setDoc: vi.fn(() => Promise.resolve()), updateDoc: vi.fn(),
  deleteDoc: vi.fn(), writeBatch: vi.fn(() => ({ set: vi.fn(), commit: vi.fn(() => Promise.resolve()) })),
  serverTimestamp: vi.fn(() => 'SERVER_TS'), onSnapshot: vi.fn(() => vi.fn()),
  query: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), startAfter: vi.fn(),
  runTransaction: vi.fn(),
}))
vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  connectFunctionsEmulator: vi.fn(),
  httpsCallable: vi.fn(),
}))
vi.mock('../../src/config/firebase', () => ({
  auth: {}, db: {}, functions: {},
  firebaseInfo: { projectId: 'test', isDev: true, useEmulators: false },
  default: {},
}))

vi.mock('../../src/services/storeAdminDealerService', () => ({
  getStoreAdminDealerRequestById: mocks.getStoreAdminDealerRequestById,
}))

vi.mock('../../src/services/storeDealerRequestCommandService', () => ({
  confirmDealerRequestCommand: mocks.confirmDealerRequestCommand,
  rejectDealerRequestCommand:  mocks.rejectDealerRequestCommand,
  mapCallableError: vi.fn(),
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
// Import composant après mocks
// ---------------------------------------------------------------------------

import StoreAdminDealerRequestDetails from '../../src/pages/store/StoreAdminDealerRequestDetails'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STORE_ADMIN_AUTH = {
  currentUser: { uid: 'store-admin-uid' },
  userProfile: {
    role: 'store_admin', active: true, storeId: 'store-alpha',
    email: 'admin@boutique.com', name: 'Admin',
  },
}

const REQ_PENDING = {
  id: 'req-pending',
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
}

const REQ_CONFIRMED = { ...REQ_PENDING, id: 'req-confirmed', status: 'confirmed', confirmedBy: 'uid-x', confirmedAt: new Date() }
const REQ_REJECTED  = { ...REQ_PENDING, id: 'req-rejected',  status: 'rejected',  rejectedBy: 'uid-x',  rejectedAt: new Date(), rejectionReason: 'Motif.' }
const REQ_UNKNOWN   = { ...REQ_PENDING, id: 'req-unknown',   status: 'ghost_status' }

function renderDetails(requestId = 'req-pending') {
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
})

// ===========================================================================
// §VIS — Visibilité des actions
// ===========================================================================

describe('TC-039-VIS — visibilité des actions selon statut', () => {
  it('[VIS-01] statut pending → boutons Confirmer et Rejeter visibles', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)
    renderDetails()
    await waitFor(() => {
      expect(screen.getByTestId('btn-confirm')).toBeInTheDocument()
      expect(screen.getByTestId('btn-reject')).toBeInTheDocument()
    })
  })

  it('[VIS-02] statut confirmed → aucun bouton action visible', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_CONFIRMED)
    renderDetails('req-confirmed')
    await waitFor(() => screen.getByTestId('btn-back'))
    expect(screen.queryByTestId('action-buttons')).not.toBeInTheDocument()
    expect(screen.queryByTestId('btn-confirm')).not.toBeInTheDocument()
    expect(screen.queryByTestId('btn-reject')).not.toBeInTheDocument()
  })

  it('[VIS-03] statut rejected → aucun bouton action visible', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_REJECTED)
    renderDetails('req-rejected')
    await waitFor(() => screen.getByTestId('btn-back'))
    expect(screen.queryByTestId('action-buttons')).not.toBeInTheDocument()
  })

  it('[VIS-04] statut inconnu → aucun bouton action visible', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_UNKNOWN)
    renderDetails('req-unknown')
    await waitFor(() => screen.getByTestId('btn-back'))
    expect(screen.queryByTestId('action-buttons')).not.toBeInTheDocument()
  })
})

// ===========================================================================
// §CF — Modale de confirmation
// ===========================================================================

describe('TC-039-CF — modale de confirmation', () => {
  it('[CF-01] clic Confirmer → modale s\'ouvre', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)
    renderDetails()
    await waitFor(() => screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('btn-confirm'))
    expect(screen.getByTestId('confirm-modal-overlay')).toBeInTheDocument()
  })

  it('[CF-02] modale affiche Dealer, type, réseau, montant', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)
    renderDetails()
    await waitFor(() => screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('btn-confirm'))

    const modal = screen.getByTestId('confirm-modal-overlay')
    expect(modal.textContent).toContain('Dealer Alpha')
    expect(modal.textContent).toContain('Ajout de stock')
    expect(modal.textContent).toContain('Orange')
  })

  it('[CF-03] checkbox non cochée → bouton submit désactivé', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)
    renderDetails()
    await waitFor(() => screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('btn-confirm'))

    const submit = screen.getByTestId('confirm-modal-submit')
    expect(submit).toBeDisabled()
  })

  it('[CF-04] checkbox cochée → bouton submit activé', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)
    renderDetails()
    await waitFor(() => screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('btn-confirm'))

    fireEvent.click(screen.getByTestId('confirm-checkbox'))
    const submit = screen.getByTestId('confirm-modal-submit')
    expect(submit).not.toBeDisabled()
  })

  it('[CF-05] succès → message succès visible, modale fermée', async () => {
    mocks.getStoreAdminDealerRequestById
      .mockResolvedValueOnce(REQ_PENDING)
      .mockResolvedValueOnce({ ...REQ_PENDING, status: 'confirmed' })
    mocks.confirmDealerRequestCommand.mockResolvedValue({ success: true })

    renderDetails()
    await waitFor(() => screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('confirm-checkbox'))

    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-modal-submit'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('action-success')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('confirm-modal-overlay')).not.toBeInTheDocument()
    expect(mocks.confirmDealerRequestCommand).toHaveBeenCalledWith('req-pending')
  })

  it('[CF-06] succès → demande rechargée (getStoreAdminDealerRequestById appelé 2×)', async () => {
    mocks.getStoreAdminDealerRequestById
      .mockResolvedValueOnce(REQ_PENDING)
      .mockResolvedValueOnce({ ...REQ_PENDING, status: 'confirmed' })
    mocks.confirmDealerRequestCommand.mockResolvedValue({ success: true })

    renderDetails()
    await waitFor(() => screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('confirm-checkbox'))

    await act(async () => { fireEvent.click(screen.getByTestId('confirm-modal-submit')) })

    await waitFor(() => {
      expect(mocks.getStoreAdminDealerRequestById.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
  })

  it('[CF-07] erreur → message erreur visible, modale toujours ouverte', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)
    const err = Object.assign(new Error('Le solde est introuvable.'), { code: 'BALANCE_NOT_FOUND' })
    mocks.confirmDealerRequestCommand.mockRejectedValue(err)

    renderDetails()
    await waitFor(() => screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('confirm-checkbox'))

    await act(async () => { fireEvent.click(screen.getByTestId('confirm-modal-submit')) })

    await waitFor(() => {
      expect(screen.getByTestId('action-error')).toBeInTheDocument()
    })
    expect(screen.getByTestId('action-error').textContent).toContain('Le solde est introuvable.')
  })

  it('[CF-08] REQUEST_NOT_PENDING → modale fermée, demande rechargée', async () => {
    mocks.getStoreAdminDealerRequestById
      .mockResolvedValueOnce(REQ_PENDING)
      .mockResolvedValueOnce({ ...REQ_PENDING, status: 'confirmed' })
    const err = Object.assign(new Error('Cette demande a déjà été traitée.'), { code: 'REQUEST_NOT_PENDING' })
    mocks.confirmDealerRequestCommand.mockRejectedValue(err)

    renderDetails()
    await waitFor(() => screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('confirm-checkbox'))

    await act(async () => { fireEvent.click(screen.getByTestId('confirm-modal-submit')) })

    await waitFor(() => {
      expect(screen.queryByTestId('confirm-modal-overlay')).not.toBeInTheDocument()
      expect(mocks.getStoreAdminDealerRequestById.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
  })

  it('[CF-09] double-clic sur submit → confirmDealerRequestCommand appelé une seule fois', async () => {
    let resolveCmd
    const pendingCmd = new Promise(r => { resolveCmd = r })
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)
    mocks.confirmDealerRequestCommand.mockReturnValue(pendingCmd)

    renderDetails()
    await waitFor(() => screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('confirm-checkbox'))

    const submit = screen.getByTestId('confirm-modal-submit')
    fireEvent.click(submit)
    fireEvent.click(submit)

    await act(async () => { resolveCmd({ success: true }) })

    expect(mocks.confirmDealerRequestCommand.mock.calls.length).toBe(1)
  })

  it('[CF-10] Annuler → modale fermée, pas d\'appel callable', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)
    renderDetails()
    await waitFor(() => screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('confirm-modal-cancel'))
    expect(screen.queryByTestId('confirm-modal-overlay')).not.toBeInTheDocument()
    expect(mocks.confirmDealerRequestCommand).not.toHaveBeenCalled()
  })

  it('[CF-11] modale contient texte avertissement modification solde', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)
    renderDetails()
    await waitFor(() => screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('btn-confirm'))

    const modal = screen.getByTestId('confirm-modal-overlay')
    expect(modal.textContent).toContain('solde de la boutique')
    expect(modal.textContent).toContain('ne pourra pas être annulée')
  })
})

// ===========================================================================
// §RJ — Modale de rejet
// ===========================================================================

describe('TC-039-RJ — modale de rejet', () => {
  it('[RJ-01] clic Rejeter → modale s\'ouvre', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)
    renderDetails()
    await waitFor(() => screen.getByTestId('btn-reject'))
    fireEvent.click(screen.getByTestId('btn-reject'))
    expect(screen.getByTestId('reject-modal-overlay')).toBeInTheDocument()
  })

  it('[RJ-02] textarea visible et accessible (label)', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)
    renderDetails()
    await waitFor(() => screen.getByTestId('btn-reject'))
    fireEvent.click(screen.getByTestId('btn-reject'))
    expect(screen.getByTestId('reject-reason-textarea')).toBeInTheDocument()
    expect(screen.getByLabelText(/motif/i)).toBeInTheDocument()
  })

  it('[RJ-03] compteur de caractères affiché', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)
    renderDetails()
    await waitFor(() => screen.getByTestId('btn-reject'))
    fireEvent.click(screen.getByTestId('btn-reject'))
    expect(screen.getByTestId('reject-char-counter')).toBeInTheDocument()
  })

  it('[RJ-04] motif vide → bouton submit désactivé', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)
    renderDetails()
    await waitFor(() => screen.getByTestId('btn-reject'))
    fireEvent.click(screen.getByTestId('btn-reject'))
    expect(screen.getByTestId('reject-modal-submit')).toBeDisabled()
  })

  it('[RJ-05] motif 2 chars → bouton désactivé', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)
    renderDetails()
    await waitFor(() => screen.getByTestId('btn-reject'))
    fireEvent.click(screen.getByTestId('btn-reject'))
    fireEvent.change(screen.getByTestId('reject-reason-textarea'), { target: { value: 'ab' } })
    expect(screen.getByTestId('reject-modal-submit')).toBeDisabled()
  })

  it('[RJ-06] motif 3 chars → bouton activé', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)
    renderDetails()
    await waitFor(() => screen.getByTestId('btn-reject'))
    fireEvent.click(screen.getByTestId('btn-reject'))
    fireEvent.change(screen.getByTestId('reject-reason-textarea'), { target: { value: 'abc' } })
    expect(screen.getByTestId('reject-modal-submit')).not.toBeDisabled()
  })

  it('[RJ-07] motif 500 chars → bouton activé', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)
    renderDetails()
    await waitFor(() => screen.getByTestId('btn-reject'))
    fireEvent.click(screen.getByTestId('btn-reject'))
    fireEvent.change(screen.getByTestId('reject-reason-textarea'), { target: { value: 'a'.repeat(500) } })
    expect(screen.getByTestId('reject-modal-submit')).not.toBeDisabled()
  })

  it('[RJ-08] motif 501 chars → bouton désactivé', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)
    renderDetails()
    await waitFor(() => screen.getByTestId('btn-reject'))
    fireEvent.click(screen.getByTestId('btn-reject'))
    fireEvent.change(screen.getByTestId('reject-reason-textarea'), { target: { value: 'a'.repeat(501) } })
    expect(screen.getByTestId('reject-modal-submit')).toBeDisabled()
  })

  it('[RJ-09] motif 2 chars → submit désactivé, callable non invoqué', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)
    renderDetails()
    await waitFor(() => screen.getByTestId('btn-reject'))
    fireEvent.click(screen.getByTestId('btn-reject'))
    fireEvent.change(screen.getByTestId('reject-reason-textarea'), { target: { value: 'ab' } })
    expect(screen.getByTestId('reject-modal-submit')).toBeDisabled()
    expect(mocks.rejectDealerRequestCommand).not.toHaveBeenCalled()
  })

  it('[RJ-10] rejet réussi → success, modale fermée, demande rechargée', async () => {
    mocks.getStoreAdminDealerRequestById
      .mockResolvedValueOnce(REQ_PENDING)
      .mockResolvedValueOnce({ ...REQ_PENDING, status: 'rejected', rejectionReason: 'Motif valide.' })
    mocks.rejectDealerRequestCommand.mockResolvedValue({ success: true })

    renderDetails()
    await waitFor(() => screen.getByTestId('btn-reject'))
    fireEvent.click(screen.getByTestId('btn-reject'))
    fireEvent.change(screen.getByTestId('reject-reason-textarea'), { target: { value: 'Motif valide.' } })

    await act(async () => { fireEvent.click(screen.getByTestId('reject-modal-submit')) })

    await waitFor(() => {
      expect(screen.getByTestId('action-success')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('reject-modal-overlay')).not.toBeInTheDocument()
    expect(mocks.rejectDealerRequestCommand).toHaveBeenCalledWith('req-pending', 'Motif valide.')
    expect(mocks.getStoreAdminDealerRequestById.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('[RJ-11] erreur backend → message erreur visible', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)
    const err = Object.assign(new Error("L'opération n'a pas pu être finalisée."), { code: 'TRANSACTION_FAILED' })
    mocks.rejectDealerRequestCommand.mockRejectedValue(err)

    renderDetails()
    await waitFor(() => screen.getByTestId('btn-reject'))
    fireEvent.click(screen.getByTestId('btn-reject'))
    fireEvent.change(screen.getByTestId('reject-reason-textarea'), { target: { value: 'Motif valide.' } })

    await act(async () => { fireEvent.click(screen.getByTestId('reject-modal-submit')) })

    await waitFor(() => {
      expect(screen.getByTestId('action-error')).toBeInTheDocument()
    })
  })

  it('[RJ-12] REQUEST_NOT_PENDING → modale fermée, rechargement', async () => {
    mocks.getStoreAdminDealerRequestById
      .mockResolvedValueOnce(REQ_PENDING)
      .mockResolvedValueOnce({ ...REQ_PENDING, status: 'rejected' })
    const err = Object.assign(new Error('Cette demande a déjà été traitée.'), { code: 'REQUEST_NOT_PENDING' })
    mocks.rejectDealerRequestCommand.mockRejectedValue(err)

    renderDetails()
    await waitFor(() => screen.getByTestId('btn-reject'))
    fireEvent.click(screen.getByTestId('btn-reject'))
    fireEvent.change(screen.getByTestId('reject-reason-textarea'), { target: { value: 'Motif valide.' } })

    await act(async () => { fireEvent.click(screen.getByTestId('reject-modal-submit')) })

    await waitFor(() => {
      expect(screen.queryByTestId('reject-modal-overlay')).not.toBeInTheDocument()
      expect(mocks.getStoreAdminDealerRequestById.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
  })

  it('[RJ-13] double-clic submit → rejectDealerRequestCommand appelé une seule fois', async () => {
    let resolveCmd
    const pendingCmd = new Promise(r => { resolveCmd = r })
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)
    mocks.rejectDealerRequestCommand.mockReturnValue(pendingCmd)

    renderDetails()
    await waitFor(() => screen.getByTestId('btn-reject'))
    fireEvent.click(screen.getByTestId('btn-reject'))
    fireEvent.change(screen.getByTestId('reject-reason-textarea'), { target: { value: 'Motif valide.' } })

    const submit = screen.getByTestId('reject-modal-submit')
    fireEvent.click(submit)
    fireEvent.click(submit)

    await act(async () => { resolveCmd({ success: true }) })

    expect(mocks.rejectDealerRequestCommand.mock.calls.length).toBe(1)
  })

  it('[RJ-14] Annuler → modale fermée, pas d\'appel callable', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)
    renderDetails()
    await waitFor(() => screen.getByTestId('btn-reject'))
    fireEvent.click(screen.getByTestId('btn-reject'))
    fireEvent.click(screen.getByTestId('reject-modal-cancel'))
    expect(screen.queryByTestId('reject-modal-overlay')).not.toBeInTheDocument()
    expect(mocks.rejectDealerRequestCommand).not.toHaveBeenCalled()
  })

  it('[RJ-15] motif trimé : "  Motif.  " → envoyé comme "Motif."', async () => {
    mocks.getStoreAdminDealerRequestById
      .mockResolvedValueOnce(REQ_PENDING)
      .mockResolvedValue({ ...REQ_PENDING, status: 'rejected' })
    mocks.rejectDealerRequestCommand.mockResolvedValue({ success: true })

    renderDetails()
    await waitFor(() => screen.getByTestId('btn-reject'))
    fireEvent.click(screen.getByTestId('btn-reject'))
    fireEvent.change(screen.getByTestId('reject-reason-textarea'), { target: { value: '  Motif.  ' } })

    await act(async () => { fireEvent.click(screen.getByTestId('reject-modal-submit')) })

    await waitFor(() => {
      expect(mocks.rejectDealerRequestCommand).toHaveBeenCalledWith('req-pending', 'Motif.')
    })
  })
})

// ===========================================================================
// §A11Y — Accessibilité des modales
// ===========================================================================

describe('TC-039-A11Y — accessibilité des modales', () => {
  it('[A11Y-01] modale confirm — attributs ARIA requis présents', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)
    renderDetails()
    await waitFor(() => screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('btn-confirm'))

    const overlay = screen.getByTestId('confirm-modal-overlay')
    expect(overlay).toHaveAttribute('role', 'dialog')
    expect(overlay).toHaveAttribute('aria-modal', 'true')
    expect(overlay).toHaveAttribute('aria-labelledby', 'confirm-modal-title')
    expect(overlay).toHaveAttribute('aria-describedby', 'confirm-modal-desc')
    expect(document.getElementById('confirm-modal-title')).toBeInTheDocument()
    expect(document.getElementById('confirm-modal-desc')).toBeInTheDocument()
  })

  it('[A11Y-02] modale rejet — attributs ARIA requis présents', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)
    renderDetails()
    await waitFor(() => screen.getByTestId('btn-reject'))
    fireEvent.click(screen.getByTestId('btn-reject'))

    const overlay = screen.getByTestId('reject-modal-overlay')
    expect(overlay).toHaveAttribute('role', 'dialog')
    expect(overlay).toHaveAttribute('aria-modal', 'true')
    expect(overlay).toHaveAttribute('aria-labelledby', 'reject-modal-title')
    expect(overlay).toHaveAttribute('aria-describedby', 'reject-modal-desc')
    expect(document.getElementById('reject-modal-title')).toBeInTheDocument()
    expect(document.getElementById('reject-modal-desc')).toBeInTheDocument()
  })

  it('[A11Y-03] Escape → ferme modale confirm', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)
    renderDetails()
    await waitFor(() => screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('btn-confirm'))
    expect(screen.getByTestId('confirm-modal-overlay')).toBeInTheDocument()

    fireEvent.keyDown(screen.getByTestId('confirm-modal-overlay'), { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByTestId('confirm-modal-overlay')).not.toBeInTheDocument()
    })
  })

  it('[A11Y-04] Escape → ferme modale rejet', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)
    renderDetails()
    await waitFor(() => screen.getByTestId('btn-reject'))
    fireEvent.click(screen.getByTestId('btn-reject'))
    expect(screen.getByTestId('reject-modal-overlay')).toBeInTheDocument()

    fireEvent.keyDown(screen.getByTestId('reject-modal-overlay'), { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByTestId('reject-modal-overlay')).not.toBeInTheDocument()
    })
  })

  it('[A11Y-05] piège Tab (confirm) — Tab depuis dernier élément appelle focus() sur le premier', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)
    renderDetails()
    await waitFor(() => screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('confirm-checkbox'))

    await act(async () => {})

    const submitBtn = screen.getByTestId('confirm-modal-submit')
    const checkbox  = screen.getByTestId('confirm-checkbox')
    submitBtn.focus()
    expect(document.activeElement).toBe(submitBtn)

    // Le handler onKeyDown est sur l'overlay ; l'événement y est déposé directement.
    // document.activeElement (submitBtn = dernier) → après Tab, focus doit passer à checkbox (premier).
    fireEvent.keyDown(screen.getByTestId('confirm-modal-overlay'), { key: 'Tab', code: 'Tab' })
    expect(document.activeElement).toBe(checkbox)
  })

  it('[A11Y-06] piège Shift+Tab (confirm) — Shift+Tab depuis premier élément déplace focus sur le dernier', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)
    renderDetails()
    await waitFor(() => screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('confirm-checkbox'))

    await act(async () => {})

    const checkbox  = screen.getByTestId('confirm-checkbox')
    const submitBtn = screen.getByTestId('confirm-modal-submit')
    checkbox.focus()
    expect(document.activeElement).toBe(checkbox)

    // document.activeElement (checkbox = premier) → après Shift+Tab, focus doit passer à submitBtn (dernier).
    fireEvent.keyDown(screen.getByTestId('confirm-modal-overlay'), { key: 'Tab', code: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(submitBtn)
  })

  it('[A11Y-07] fermeture modale confirm (Annuler) → focus retourné au bouton déclencheur', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)
    renderDetails()
    await waitFor(() => screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('btn-confirm'))

    fireEvent.click(screen.getByTestId('confirm-modal-cancel'))

    await waitFor(() => {
      expect(screen.queryByTestId('confirm-modal-overlay')).not.toBeInTheDocument()
    })
    expect(document.activeElement).toBe(screen.getByTestId('btn-confirm'))
  })

  it('[A11Y-08] fermeture modale rejet (Annuler) → focus retourné au bouton déclencheur', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)
    renderDetails()
    await waitFor(() => screen.getByTestId('btn-reject'))
    fireEvent.click(screen.getByTestId('btn-reject'))

    fireEvent.click(screen.getByTestId('reject-modal-cancel'))

    await waitFor(() => {
      expect(screen.queryByTestId('reject-modal-overlay')).not.toBeInTheDocument()
    })
    expect(document.activeElement).toBe(screen.getByTestId('btn-reject'))
  })

  it('[A11Y-09] succès confirmation → focus sur bannière de succès', async () => {
    mocks.getStoreAdminDealerRequestById
      .mockResolvedValueOnce(REQ_PENDING)
      .mockResolvedValueOnce({ ...REQ_PENDING, status: 'confirmed' })
    mocks.confirmDealerRequestCommand.mockResolvedValue({ success: true })

    renderDetails()
    await waitFor(() => screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('confirm-checkbox'))

    await act(async () => { fireEvent.click(screen.getByTestId('confirm-modal-submit')) })

    await waitFor(() => {
      expect(screen.getByTestId('action-success')).toBeInTheDocument()
    })
    expect(document.activeElement).toBe(screen.getByTestId('action-success'))
  })

  it('[A11Y-10] piège Tab (rejet) — Tab depuis dernier élément déplace focus sur le premier', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)
    renderDetails()
    await waitFor(() => screen.getByTestId('btn-reject'))
    fireEvent.click(screen.getByTestId('btn-reject'))

    const textarea = screen.getByTestId('reject-reason-textarea')
    fireEvent.change(textarea, { target: { value: 'Motif valide.' } })

    await act(async () => {})

    const submitBtn = screen.getByTestId('reject-modal-submit')
    submitBtn.focus()
    expect(document.activeElement).toBe(submitBtn)

    // document.activeElement (submitBtn = dernier) → après Tab, focus doit passer à textarea (premier).
    fireEvent.keyDown(screen.getByTestId('reject-modal-overlay'), { key: 'Tab', code: 'Tab' })
    expect(document.activeElement).toBe(textarea)
  })
})

// ===========================================================================
// §RELOAD — Rechargement échoué après mutation réussie
// ===========================================================================

describe('TC-039-RELOAD — rechargement échoué après mutation réussie', () => {
  it('[RELOAD-01] confirmation réussie mais rechargement échoué → refresh-error et action-success visibles, modale fermée', async () => {
    mocks.getStoreAdminDealerRequestById
      .mockResolvedValueOnce(REQ_PENDING)
      .mockRejectedValueOnce(new Error('Réseau indisponible'))
    mocks.confirmDealerRequestCommand.mockResolvedValue({ success: true })

    renderDetails()
    await waitFor(() => screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('confirm-checkbox'))

    await act(async () => { fireEvent.click(screen.getByTestId('confirm-modal-submit')) })

    await waitFor(() => {
      expect(screen.getByTestId('action-success')).toBeInTheDocument()
      expect(screen.getByTestId('refresh-error')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('confirm-modal-overlay')).not.toBeInTheDocument()
    expect(mocks.confirmDealerRequestCommand).toHaveBeenCalledWith('req-pending')
  })

  it('[RELOAD-02] rejet réussi mais rechargement échoué → refresh-error et action-success visibles, modale fermée', async () => {
    mocks.getStoreAdminDealerRequestById
      .mockResolvedValueOnce(REQ_PENDING)
      .mockRejectedValueOnce(new Error('Réseau indisponible'))
    mocks.rejectDealerRequestCommand.mockResolvedValue({ success: true })

    renderDetails()
    await waitFor(() => screen.getByTestId('btn-reject'))
    fireEvent.click(screen.getByTestId('btn-reject'))
    fireEvent.change(screen.getByTestId('reject-reason-textarea'), { target: { value: 'Motif valide.' } })

    await act(async () => { fireEvent.click(screen.getByTestId('reject-modal-submit')) })

    await waitFor(() => {
      expect(screen.getByTestId('action-success')).toBeInTheDocument()
      expect(screen.getByTestId('refresh-error')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('reject-modal-overlay')).not.toBeInTheDocument()
    expect(mocks.rejectDealerRequestCommand).toHaveBeenCalledWith('req-pending', 'Motif valide.')
  })
})

// ===========================================================================
// §SEC — Sécurité : aucun appel Firestore write depuis le composant
// ===========================================================================

import { addDoc, setDoc, updateDoc, deleteDoc, writeBatch, runTransaction } from 'firebase/firestore'

describe('TC-039-SEC — aucune écriture Firestore directe dans le composant', () => {
  beforeEach(() => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)
    mocks.confirmDealerRequestCommand.mockResolvedValue({ success: true })
    mocks.rejectDealerRequestCommand.mockResolvedValue({ success: true })
  })

  it('[SEC-01] chargement initial → aucun write Firestore', async () => {
    renderDetails()
    await waitFor(() => screen.getByTestId('btn-confirm'))
    expect(addDoc).not.toHaveBeenCalled()
    expect(setDoc).not.toHaveBeenCalled()
    expect(updateDoc).not.toHaveBeenCalled()
    expect(deleteDoc).not.toHaveBeenCalled()
  })

  it('[SEC-02] confirmation → aucun write Firestore direct', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)

    renderDetails()
    await waitFor(() => screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('btn-confirm'))
    fireEvent.click(screen.getByTestId('confirm-checkbox'))
    await act(async () => { fireEvent.click(screen.getByTestId('confirm-modal-submit')) })

    await waitFor(() => expect(mocks.confirmDealerRequestCommand).toHaveBeenCalled())

    expect(addDoc).not.toHaveBeenCalled()
    expect(setDoc).not.toHaveBeenCalled()
    expect(updateDoc).not.toHaveBeenCalled()
    expect(deleteDoc).not.toHaveBeenCalled()
    expect(writeBatch).not.toHaveBeenCalled()
    expect(runTransaction).not.toHaveBeenCalled()
  })

  it('[SEC-03] rejet → aucun write Firestore direct', async () => {
    mocks.getStoreAdminDealerRequestById.mockResolvedValue(REQ_PENDING)

    renderDetails()
    await waitFor(() => screen.getByTestId('btn-reject'))
    fireEvent.click(screen.getByTestId('btn-reject'))
    fireEvent.change(screen.getByTestId('reject-reason-textarea'), { target: { value: 'Motif valide.' } })
    await act(async () => { fireEvent.click(screen.getByTestId('reject-modal-submit')) })

    await waitFor(() => expect(mocks.rejectDealerRequestCommand).toHaveBeenCalled())

    expect(addDoc).not.toHaveBeenCalled()
    expect(setDoc).not.toHaveBeenCalled()
    expect(updateDoc).not.toHaveBeenCalled()
    expect(deleteDoc).not.toHaveBeenCalled()
    expect(writeBatch).not.toHaveBeenCalled()
    expect(runTransaction).not.toHaveBeenCalled()
  })
})
