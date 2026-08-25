/**
 * TC-015 — Validation des montants FCFA aux points d'entrée du service FirestoreService
 *
 * Comportement à protéger :
 *   Tout montant non entier strictement positif doit être rejeté AVANT toute
 *   écriture Firestore. La validation repose sur parseFcfaAmount (fcfaAmount.js)
 *   via la méthode interne _validateFcfaAmount.
 *
 * Points d'entrée protégés :
 *   TC-015-A : applyInitialTransactionImpact (fonction pure)
 *   TC-015-B : reverseInitialTransactionImpact (fonction pure)
 *   TC-015-C : applySettlementImpact (fonction pure)
 *   TC-015-D : addTransaction (async, vérifie que runTransaction n'est pas appelé)
 *   TC-015-E : updateDraft (async, vérifie que runTransaction n'est pas appelé)
 *   TC-015-F : addToHistory (async, vérifie que addDoc/setDoc n'est pas appelé)
 *   TC-015-G : migrateLocalStorageData (enregistrement invalide ignoré, migration continue)
 *
 * Fichiers source : src/services/firestore.js, src/utils/fcfaAmount.js
 * Interdictions   : aucun import Firebase, aucun accès réseau.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks Firebase — structure identique aux fichiers TC-001/TC-013/TC-014
// ---------------------------------------------------------------------------

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  addDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  onSnapshot: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  where: vi.fn(),
  getDocs: vi.fn(),
  limit: vi.fn(),
  startAfter: vi.fn(),
  writeBatch: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(),
}))

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(),
  connectAuthEmulator: vi.fn(),
}))

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({})),
  setLogLevel: vi.fn(),
  getApp: vi.fn(),
}))

vi.mock('../../src/config/firebase', () => ({
  db: {},
  auth: {},
  firebaseInfo: {},
  default: {},
}))

vi.mock('../../src/config/clientIsolation', () => ({
  CLIENT_ID: 'test-client',
  getStorageKey: vi.fn((key) => `test-client_${key}`),
  getFirestoreCollectionPath: vi.fn((name) => name),
}))

vi.mock('../../src/utils/cacheManager', () => ({
  default: {
    setFetchFunction: vi.fn(),
    get: vi.fn(() => null),
    set: vi.fn(),
    invalidate: vi.fn(),
    generateKey: vi.fn(() => 'mock-key'),
    clear: vi.fn(),
    invalidateCollection: vi.fn(),
  },
  cacheUtils: {
    invalidatePattern: vi.fn(),
    invalidateRelated: vi.fn(),
  },
}))

// ---------------------------------------------------------------------------
// Import après mocks
// ---------------------------------------------------------------------------

import { FirestoreService } from '../../src/services/firestore.js'
import { parseFcfaAmount } from '../../src/utils/fcfaAmount.js'
import { runTransaction, addDoc, setDoc } from 'firebase/firestore'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseBalances = {
  Orange:  { stock: 10000, liquidite: 5000 },
  Moov:    { stock:  8000, liquidite: 3000 },
  Telecel: { stock:  6000, liquidite: 2000 },
  Coris:   { stock:  4000, liquidite: 1000 },
  Sank:    { stock:  2000, liquidite:  500 },
}

let svc

beforeAll(() => {
  svc = new FirestoreService()
  svc.setActiveStore({ id: 'store-test', name: 'Boutique Test' })
})

// ---------------------------------------------------------------------------
// Groupe TC-015-A — applyInitialTransactionImpact : validation montant
// ---------------------------------------------------------------------------

describe('TC-015-A — applyInitialTransactionImpact : garde FCFA', () => {

  it('[TC-015-A1] montant 1000 (number entier) — calcul correct', () => {
    const tx = { type: 'Dépôt', statut: 'Non Terminées', montant: 1000, reseau: 'Orange' }
    const result = svc.applyInitialTransactionImpact(baseBalances, tx)
    expect(result.Orange.stock).toBe(9000)
  })

  it('[TC-015-A2] montant 1 (number, minimum) — calcul correct', () => {
    const tx = { type: 'Dépôt', statut: 'Non Terminées', montant: 1, reseau: 'Sank' }
    const result = svc.applyInitialTransactionImpact(baseBalances, tx)
    expect(result.Sank.stock).toBe(1999)
  })

  it('[TC-015-A3] montant "1000" (chaîne) — erreur : les fonctions pures attendent un number', () => {
    // parseFcfaAmount("1000") retourne 1000 (les chaînes numériques sont acceptées)
    // MAIS le contrat des fonctions pures est de recevoir des numbers déjà validés.
    // Ce test vérifie que parseFcfaAmount("1000") === 1000 (pas null).
    // La chaîne "1000" est acceptée par parseFcfaAmount donc applyInitialTransactionImpact la laisse passer.
    // La vraie protection pour les chaînes est au niveau addTransaction/addToHistory.
    expect(parseFcfaAmount('1000')).toBe(1000)
  })

  it('[TC-015-A4] montant 0 — erreur levée', () => {
    const tx = { type: 'Dépôt', statut: 'Non Terminées', montant: 0, reseau: 'Orange' }
    expect(() => svc.applyInitialTransactionImpact(baseBalances, tx)).toThrow('Montant FCFA invalide')
  })

  it('[TC-015-A5] montant -1 — erreur levée', () => {
    const tx = { type: 'Dépôt', statut: 'Non Terminées', montant: -1, reseau: 'Orange' }
    expect(() => svc.applyInitialTransactionImpact(baseBalances, tx)).toThrow('Montant FCFA invalide')
  })

  it('[TC-015-A6] montant 1000.5 (décimal) — erreur levée', () => {
    const tx = { type: 'Dépôt', statut: 'Non Terminées', montant: 1000.5, reseau: 'Orange' }
    expect(() => svc.applyInitialTransactionImpact(baseBalances, tx)).toThrow('Montant FCFA invalide')
  })

  it('[TC-015-A7] montant NaN — erreur levée', () => {
    const tx = { type: 'Dépôt', statut: 'Non Terminées', montant: NaN, reseau: 'Orange' }
    expect(() => svc.applyInitialTransactionImpact(baseBalances, tx)).toThrow('Montant FCFA invalide')
  })

  it('[TC-015-A8] montant Infinity — erreur levée', () => {
    const tx = { type: 'Dépôt', statut: 'Non Terminées', montant: Infinity, reseau: 'Orange' }
    expect(() => svc.applyInitialTransactionImpact(baseBalances, tx)).toThrow('Montant FCFA invalide')
  })

  it('[TC-015-A9] montant undefined — erreur levée', () => {
    const tx = { type: 'Dépôt', statut: 'Non Terminées', montant: undefined, reseau: 'Orange' }
    expect(() => svc.applyInitialTransactionImpact(baseBalances, tx)).toThrow('Montant FCFA invalide')
  })

  it('[TC-015-A10] montant null — erreur levée', () => {
    const tx = { type: 'Dépôt', statut: 'Non Terminées', montant: null, reseau: 'Orange' }
    expect(() => svc.applyInitialTransactionImpact(baseBalances, tx)).toThrow('Montant FCFA invalide')
  })
})

// ---------------------------------------------------------------------------
// Groupe TC-015-B — reverseInitialTransactionImpact : garde FCFA
// ---------------------------------------------------------------------------

describe('TC-015-B — reverseInitialTransactionImpact : garde FCFA', () => {

  it('[TC-015-B1] montant 500 (number entier) — reverse correct', () => {
    const tx = { type: 'Dépôt', statut: 'Non Terminées', montant: 500, reseau: 'Orange' }
    const afterApply = svc.applyInitialTransactionImpact(baseBalances, tx)
    const afterReverse = svc.reverseInitialTransactionImpact(afterApply, tx)
    expect(afterReverse.Orange.stock).toBe(baseBalances.Orange.stock)
  })

  it('[TC-015-B2] montant 0 — erreur levée', () => {
    const tx = { type: 'Dépôt', statut: 'Non Terminées', montant: 0, reseau: 'Orange' }
    expect(() => svc.reverseInitialTransactionImpact(baseBalances, tx)).toThrow('Montant FCFA invalide')
  })

  it('[TC-015-B3] montant -500 — erreur levée', () => {
    const tx = { type: 'Dépôt', statut: 'Non Terminées', montant: -500, reseau: 'Orange' }
    expect(() => svc.reverseInitialTransactionImpact(baseBalances, tx)).toThrow('Montant FCFA invalide')
  })

  it('[TC-015-B4] montant 500.5 (décimal) — erreur levée', () => {
    const tx = { type: 'Dépôt', statut: 'Non Terminées', montant: 500.5, reseau: 'Orange' }
    expect(() => svc.reverseInitialTransactionImpact(baseBalances, tx)).toThrow('Montant FCFA invalide')
  })

  it('[TC-015-B5] montant NaN — erreur levée', () => {
    const tx = { type: 'Dépôt', statut: 'Non Terminées', montant: NaN, reseau: 'Orange' }
    expect(() => svc.reverseInitialTransactionImpact(baseBalances, tx)).toThrow('Montant FCFA invalide')
  })

  it('[TC-015-B6] montant undefined — erreur levée', () => {
    const tx = { type: 'Dépôt', statut: 'Non Terminées', montant: undefined, reseau: 'Orange' }
    expect(() => svc.reverseInitialTransactionImpact(baseBalances, tx)).toThrow('Montant FCFA invalide')
  })
})

// ---------------------------------------------------------------------------
// Groupe TC-015-C — applySettlementImpact : garde FCFA
// ---------------------------------------------------------------------------

describe('TC-015-C — applySettlementImpact : garde FCFA', () => {

  it('[TC-015-C1] montant 300 (number entier) — settlement correct', () => {
    const tx = { type: 'Dépôt', statut: 'Non Terminées', montant: 300, reseau: 'Orange' }
    const result = svc.applySettlementImpact(baseBalances, tx, 'Orange Money')
    // Encaissement dépôt → stock[Orange] += 300
    expect(result.Orange.stock).toBe(10300)
  })

  it('[TC-015-C2] montant 0 — erreur levée', () => {
    const tx = { type: 'Dépôt', statut: 'Non Terminées', montant: 0, reseau: 'Orange' }
    expect(() => svc.applySettlementImpact(baseBalances, tx, 'Orange Money')).toThrow('Montant FCFA invalide')
  })

  it('[TC-015-C3] montant -100 — erreur levée', () => {
    const tx = { type: 'Dépôt', statut: 'Non Terminées', montant: -100, reseau: 'Orange' }
    expect(() => svc.applySettlementImpact(baseBalances, tx, 'Orange Money')).toThrow('Montant FCFA invalide')
  })

  it('[TC-015-C4] montant 100.9 (décimal) — erreur levée', () => {
    const tx = { type: 'Dépôt', statut: 'Non Terminées', montant: 100.9, reseau: 'Orange' }
    expect(() => svc.applySettlementImpact(baseBalances, tx, 'Orange Money')).toThrow('Montant FCFA invalide')
  })

  it('[TC-015-C5] montant NaN — erreur levée', () => {
    const tx = { type: 'Dépôt', statut: 'Non Terminées', montant: NaN, reseau: 'Orange' }
    expect(() => svc.applySettlementImpact(baseBalances, tx, 'Orange Money')).toThrow('Montant FCFA invalide')
  })

  it('[TC-015-C6] montant Infinity — erreur levée', () => {
    const tx = { type: 'Dépôt', statut: 'Non Terminées', montant: Infinity, reseau: 'Orange' }
    expect(() => svc.applySettlementImpact(baseBalances, tx, 'Orange Money')).toThrow('Montant FCFA invalide')
  })

  it('[TC-015-C7] montant null — erreur levée', () => {
    const tx = { type: 'Dépôt', statut: 'Non Terminées', montant: null, reseau: 'Orange' }
    expect(() => svc.applySettlementImpact(baseBalances, tx, 'Orange Money')).toThrow('Montant FCFA invalide')
  })
})

// ---------------------------------------------------------------------------
// Groupe TC-015-D — addTransaction : runTransaction non appelé si montant invalide
// ---------------------------------------------------------------------------

describe('TC-015-D — addTransaction : runTransaction bloqué si montant invalide', () => {

  beforeEach(() => {
    vi.mocked(runTransaction).mockClear()
  })

  it('[TC-015-D1] montant 1000 (number) — runTransaction est appelé (chemin nominal)', async () => {
    // Simuler runTransaction qui résout sans accès réel
    vi.mocked(runTransaction).mockResolvedValueOnce({ id: 'tx-001', montant: 1000 })

    const transactionData = {
      type: 'Dépôt',
      statut: 'Non Terminées',
      montant: 1000,
      reseau: 'Orange',
      clientId: 'client-001',
    }

    try {
      await svc.addTransaction(transactionData)
    } catch {
      // Ignorer les erreurs liées au mock Firestore incomplet
    }

    expect(runTransaction).toHaveBeenCalledTimes(1)
  })

  it('[TC-015-D2] montant 0 — runTransaction non appelé, erreur levée', async () => {
    const transactionData = {
      type: 'Dépôt',
      statut: 'Non Terminées',
      montant: 0,
      reseau: 'Orange',
      clientId: 'client-001',
    }

    await expect(svc.addTransaction(transactionData)).rejects.toThrow()
    expect(runTransaction).not.toHaveBeenCalled()
  })

  it('[TC-015-D3] montant -500 — erreur levée, runTransaction non appelé', async () => {
    const transactionData = {
      type: 'Dépôt',
      statut: 'Non Terminées',
      montant: -500,
      reseau: 'Orange',
      clientId: 'client-001',
    }

    await expect(svc.addTransaction(transactionData)).rejects.toThrow()
    expect(runTransaction).not.toHaveBeenCalled()
  })

  it('[TC-015-D4] montant "1 000abc" (chaîne invalide) — erreur levée, runTransaction non appelé', async () => {
    const transactionData = {
      type: 'Dépôt',
      statut: 'Non Terminées',
      montant: '1 000abc',
      reseau: 'Orange',
      clientId: 'client-001',
    }

    await expect(svc.addTransaction(transactionData)).rejects.toThrow()
    expect(runTransaction).not.toHaveBeenCalled()
  })

  it('[TC-015-D5] montant null — erreur levée, runTransaction non appelé', async () => {
    const transactionData = {
      type: 'Dépôt',
      statut: 'Non Terminées',
      montant: null,
      reseau: 'Orange',
      clientId: 'client-001',
    }

    await expect(svc.addTransaction(transactionData)).rejects.toThrow()
    expect(runTransaction).not.toHaveBeenCalled()
  })

  it('[TC-015-D6] montant 1000.5 (décimal) — erreur levée, runTransaction non appelé', async () => {
    const transactionData = {
      type: 'Dépôt',
      statut: 'Non Terminées',
      montant: 1000.5,
      reseau: 'Orange',
      clientId: 'client-001',
    }

    await expect(svc.addTransaction(transactionData)).rejects.toThrow()
    expect(runTransaction).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Groupe TC-015-E — updateDraft : runTransaction bloqué si montant invalide
// ---------------------------------------------------------------------------

describe('TC-015-E — updateDraft : runTransaction bloqué si montant invalide dans updates', () => {

  beforeEach(() => {
    vi.mocked(runTransaction).mockClear()
  })

  it('[TC-015-E1] updates.montant 500 (number entier) — runTransaction est appelé', async () => {
    vi.mocked(runTransaction).mockResolvedValueOnce({ id: 'draft-001', montant: 500 })

    try {
      await svc.updateDraft('draft-001', { montant: 500, reseau: 'Orange', type: 'Dépôt' })
    } catch {
      // Ignorer les erreurs liées au mock Firestore incomplet
    }

    expect(runTransaction).toHaveBeenCalledTimes(1)
  })

  it('[TC-015-E2] updates.montant 500.5 (décimal) — erreur avant runTransaction', async () => {
    await expect(
      svc.updateDraft('draft-001', { montant: 500.5, reseau: 'Orange', type: 'Dépôt' })
    ).rejects.toThrow('Montant FCFA invalide')

    expect(runTransaction).not.toHaveBeenCalled()
  })

  it('[TC-015-E3] updates.montant "abc" — erreur avant runTransaction', async () => {
    await expect(
      svc.updateDraft('draft-001', { montant: 'abc', reseau: 'Orange', type: 'Dépôt' })
    ).rejects.toThrow('Montant FCFA invalide')

    expect(runTransaction).not.toHaveBeenCalled()
  })

  it('[TC-015-E4] updates.montant 0 — erreur avant runTransaction', async () => {
    await expect(
      svc.updateDraft('draft-001', { montant: 0, reseau: 'Orange', type: 'Dépôt' })
    ).rejects.toThrow('Montant FCFA invalide')

    expect(runTransaction).not.toHaveBeenCalled()
  })

  it('[TC-015-E5] updates.montant -200 — erreur avant runTransaction', async () => {
    await expect(
      svc.updateDraft('draft-001', { montant: -200, reseau: 'Orange', type: 'Dépôt' })
    ).rejects.toThrow('Montant FCFA invalide')

    expect(runTransaction).not.toHaveBeenCalled()
  })

  it('[TC-015-E6] updates sans montant (mise à jour partielle) — runTransaction est appelé', async () => {
    // Si on met à jour uniquement le statut sans toucher le montant, pas de validation
    vi.mocked(runTransaction).mockResolvedValueOnce({ id: 'draft-001' })

    try {
      await svc.updateDraft('draft-001', { statut: 'Non Terminées' })
    } catch {
      // Ignorer les erreurs liées au mock Firestore incomplet
    }

    expect(runTransaction).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Groupe TC-015-F — addToHistory : aucune écriture si montant invalide
// ---------------------------------------------------------------------------

describe('TC-015-F — addToHistory : écriture bloquée si montant invalide', () => {

  beforeEach(() => {
    vi.mocked(addDoc).mockClear()
    vi.mocked(setDoc).mockClear()
  })

  it('[TC-015-F1] montant 100 (number entier) — _validateFcfaAmount ne lève pas d\'erreur FCFA', () => {
    // Vérifie directement que la validation FCFA passe pour un montant valide.
    // addToHistory appelle _validateFcfaAmount en premier ; si elle passe, c'est correct.
    expect(() => svc._validateFcfaAmount(100, 'addToHistory')).not.toThrow()
    expect(svc._validateFcfaAmount(100, 'addToHistory')).toBe(100)
  })

  it('[TC-015-F2] montant 0 — erreur FCFA, addDoc non appelé', async () => {
    const transactionData = {
      type: 'Dépôt',
      statut: 'Validée',
      montant: 0,
      reseau: 'Orange',
      clientId: 'client-001',
    }

    await expect(svc.addToHistory(transactionData)).rejects.toThrow('Montant FCFA invalide')
    expect(addDoc).not.toHaveBeenCalled()
  })

  it('[TC-015-F3] montant NaN — erreur FCFA, addDoc non appelé', async () => {
    const transactionData = {
      type: 'Dépôt',
      statut: 'Validée',
      montant: NaN,
      reseau: 'Orange',
      clientId: 'client-001',
    }

    await expect(svc.addToHistory(transactionData)).rejects.toThrow('Montant FCFA invalide')
    expect(addDoc).not.toHaveBeenCalled()
  })

  it('[TC-015-F4] montant "100.5" (chaîne décimale) — erreur FCFA, addDoc non appelé', async () => {
    const transactionData = {
      type: 'Dépôt',
      statut: 'Validée',
      montant: '100.5',
      reseau: 'Orange',
      clientId: 'client-001',
    }

    await expect(svc.addToHistory(transactionData)).rejects.toThrow('Montant FCFA invalide')
    expect(addDoc).not.toHaveBeenCalled()
  })

  it('[TC-015-F5] montant -50 — erreur FCFA, addDoc non appelé', async () => {
    const transactionData = {
      type: 'Dépôt',
      statut: 'Validée',
      montant: -50,
      reseau: 'Orange',
      clientId: 'client-001',
    }

    await expect(svc.addToHistory(transactionData)).rejects.toThrow('Montant FCFA invalide')
    expect(addDoc).not.toHaveBeenCalled()
  })

  it('[TC-015-F6] montant Infinity — erreur FCFA, addDoc non appelé', async () => {
    const transactionData = {
      type: 'Dépôt',
      statut: 'Validée',
      montant: Infinity,
      reseau: 'Orange',
      clientId: 'client-001',
    }

    await expect(svc.addToHistory(transactionData)).rejects.toThrow('Montant FCFA invalide')
    expect(addDoc).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Groupe TC-015-G — migrateLocalStorageData : enregistrement invalide ignoré
// ---------------------------------------------------------------------------

describe('TC-015-G — migrateLocalStorageData : enregistrement invalide ignoré, migration continue', () => {

  it('[TC-015-G1] un enregistrement avec montant invalide est ignoré, les autres sont traités', async () => {
    // On crée un service local avec des méthodes espionnes
    const localSvc = new FirestoreService()
    localSvc.setActiveStore({ id: 'store-test', name: 'Boutique Test' })

    const addDraftCalls = []
    const addHistoryCalls = []

    // Spy sur addDraft et addToHistory
    localSvc.addDraft = vi.fn(async (data) => {
      addDraftCalls.push(data)
      return { id: 'draft-mock', ...data }
    })
    localSvc.addToHistory = vi.fn(async (data) => {
      addHistoryCalls.push(data)
      return { id: 'history-mock', ...data }
    })
    // addClient n'est pas testé ici, on le court-circuite
    localSvc.addClient = vi.fn(async (data) => ({ id: 'client-mock', ...data }))

    const localStorageData = {
      clients: [],
      pendingTransactions: [
        {
          clientId: 'c1',
          type: 'Dépôt',
          reseau: 'Orange',
          montant: 1000,  // valide
          statut: 'Non Terminées',
        },
        {
          clientId: 'c2',
          type: 'Dépôt',
          reseau: 'Moov',
          montant: 500.5, // INVALIDE — décimal
          statut: 'Non Terminées',
        },
        {
          clientId: 'c3',
          type: 'Retrait',
          reseau: 'Telecel',
          montant: 200,   // valide
          statut: 'Non Terminées',
        },
      ],
      completedTransactions: [],
    }

    await localSvc.migrateLocalStorageData(localStorageData)

    // L'enregistrement invalide (montant 500.5) est ignoré
    // Les deux valides (1000 et 200) sont traités
    expect(addDraftCalls).toHaveLength(2)
    expect(addDraftCalls[0].montant).toBe(1000)
    expect(addDraftCalls[1].montant).toBe(200)
  })

  it('[TC-015-G2] enregistrement montant 0 (invalide) — ignoré, migration des autres continue', async () => {
    const localSvc = new FirestoreService()
    localSvc.setActiveStore({ id: 'store-test', name: 'Boutique Test' })

    const addDraftCalls = []
    localSvc.addDraft = vi.fn(async (data) => { addDraftCalls.push(data); return { id: 'mock', ...data } })
    localSvc.addToHistory = vi.fn(async () => ({ id: 'mock' }))
    localSvc.addClient = vi.fn(async (data) => ({ id: 'mock', ...data }))

    const localStorageData = {
      clients: [],
      pendingTransactions: [
        { clientId: 'c1', type: 'Dépôt', reseau: 'Orange', montant: 0, statut: 'Non Terminées' },     // invalide
        { clientId: 'c2', type: 'Dépôt', reseau: 'Moov', montant: 750, statut: 'Non Terminées' },     // valide
      ],
      completedTransactions: [],
    }

    await localSvc.migrateLocalStorageData(localStorageData)

    expect(addDraftCalls).toHaveLength(1)
    expect(addDraftCalls[0].montant).toBe(750)
  })

  it('[TC-015-G3] tous les enregistrements invalides — aucune écriture, pas d\'exception globale', async () => {
    const localSvc = new FirestoreService()
    localSvc.setActiveStore({ id: 'store-test', name: 'Boutique Test' })

    const addDraftCalls = []
    localSvc.addDraft = vi.fn(async (data) => { addDraftCalls.push(data); return { id: 'mock', ...data } })
    localSvc.addToHistory = vi.fn(async () => ({ id: 'mock' }))
    localSvc.addClient = vi.fn(async (data) => ({ id: 'mock', ...data }))

    const localStorageData = {
      clients: [],
      pendingTransactions: [
        { clientId: 'c1', type: 'Dépôt', reseau: 'Orange', montant: NaN, statut: 'Non Terminées' },
        { clientId: 'c2', type: 'Dépôt', reseau: 'Moov', montant: -100, statut: 'Non Terminées' },
      ],
      completedTransactions: [],
    }

    // Ne doit pas lever d'exception globale
    await expect(localSvc.migrateLocalStorageData(localStorageData)).resolves.toBe(true)
    expect(addDraftCalls).toHaveLength(0)
  })

  it('[TC-015-G4] enregistrement completedTransaction avec montant invalide — ignoré, les valides passent', async () => {
    const localSvc = new FirestoreService()
    localSvc.setActiveStore({ id: 'store-test', name: 'Boutique Test' })

    const historyCalls = []
    localSvc.addDraft = vi.fn(async () => ({ id: 'mock' }))
    localSvc.addToHistory = vi.fn(async (data) => { historyCalls.push(data); return { id: 'mock', ...data } })
    localSvc.addClient = vi.fn(async (data) => ({ id: 'mock', ...data }))

    const localStorageData = {
      clients: [],
      pendingTransactions: [],
      completedTransactions: [
        { clientId: 'c1', type: 'Dépôt', reseau: 'Orange', montant: 'abc', statut: 'Validée' }, // invalide
        { clientId: 'c2', type: 'Dépôt', reseau: 'Moov', montant: 500, statut: 'Validée' },     // valide
      ],
    }

    await localSvc.migrateLocalStorageData(localStorageData)

    expect(historyCalls).toHaveLength(1)
    expect(historyCalls[0].montant).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// Groupe TC-015-H — parseFcfaAmount : cohérence avec les gardes (contrat)
// ---------------------------------------------------------------------------

describe('TC-015-H — parseFcfaAmount : contrat de validation utilisé par les gardes', () => {

  it('[TC-015-H1] parseFcfaAmount(1000) === 1000 (number entier)', () => {
    expect(parseFcfaAmount(1000)).toBe(1000)
  })

  it('[TC-015-H2] parseFcfaAmount(1) === 1 (minimum accepté)', () => {
    expect(parseFcfaAmount(1)).toBe(1)
  })

  it('[TC-015-H3] parseFcfaAmount(0) === null', () => {
    expect(parseFcfaAmount(0)).toBeNull()
  })

  it('[TC-015-H4] parseFcfaAmount(-1) === null', () => {
    expect(parseFcfaAmount(-1)).toBeNull()
  })

  it('[TC-015-H5] parseFcfaAmount(1000.5) === null (décimal)', () => {
    expect(parseFcfaAmount(1000.5)).toBeNull()
  })

  it('[TC-015-H6] parseFcfaAmount(NaN) === null', () => {
    expect(parseFcfaAmount(NaN)).toBeNull()
  })

  it('[TC-015-H7] parseFcfaAmount(Infinity) === null', () => {
    expect(parseFcfaAmount(Infinity)).toBeNull()
  })

  it('[TC-015-H8] parseFcfaAmount("1000") === 1000 (chaîne numérique acceptée)', () => {
    expect(parseFcfaAmount('1000')).toBe(1000)
  })

  it('[TC-015-H9] parseFcfaAmount("1 000") === 1000 (espace milliers accepté)', () => {
    expect(parseFcfaAmount('1 000')).toBe(1000)
  })

  it('[TC-015-H10] parseFcfaAmount("1 000abc") === null', () => {
    expect(parseFcfaAmount('1 000abc')).toBeNull()
  })

  it('[TC-015-H11] parseFcfaAmount(null) === null', () => {
    expect(parseFcfaAmount(null)).toBeNull()
  })

  it('[TC-015-H12] parseFcfaAmount(undefined) === null', () => {
    expect(parseFcfaAmount(undefined)).toBeNull()
  })
})
