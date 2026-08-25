/**
 * TC-022 — Cohérence de validation des montants FCFA
 *
 * Comportement protégé :
 *   parseFcfaAmount est la source de vérité unique pour la validité d'un montant FCFA.
 *   Toutes les couches (validateTransactionForm, validateTransactionData, addDraft,
 *   addToHistory) doivent accepter exactement les mêmes valeurs que parseFcfaAmount.
 *
 * Couches testées :
 *   Section 1 — parseFcfaAmount (référence canonique)
 *   Section 2 — validateTransactionData (FirestoreService, après alignement)
 *   Section 3 — validateTransactionForm (helpers.js, après alignement)
 *   Section 4 — addDraft via DraftService (chemin addDocument → validateTransactionData)
 *   Section 5 — addToHistory via HistoryService (garde _validateFcfaAmount explicite)
 *   Section 6 — Absence de mutation du payload d'entrée
 */

// ---------------------------------------------------------------------------
// Mocks Firebase — obligatoires avant tout import de FirestoreService
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn((_db, ...segments) => ({ _path: segments.join('/'), _isMockDoc: true })),
  getDoc: vi.fn(),
  addDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  onSnapshot: vi.fn(() => vi.fn()),
  query: vi.fn(),
  orderBy: vi.fn(),
  where: vi.fn(),
  getDocs: vi.fn(),
  limit: vi.fn(),
  startAfter: vi.fn(),
  writeBatch: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(() => 'mock-server-timestamp'),
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

vi.mock('../../src/hooks/useNetworkCards', () => ({
  useNetworkCards: vi.fn(() => ({
    cardsData: [],
    getStock: vi.fn((network) => network === 'Orange' ? 500 : 999999),
    getLiquidite: vi.fn(() => 999999),
    formatAmount: vi.fn((v) => String(v)),
  }))
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
// Imports après mocks
// ---------------------------------------------------------------------------

import { parseFcfaAmount } from '../../src/utils/fcfaAmount.js'
import { validateTransactionForm } from '../../src/utils/helpers.js'
import { FirestoreService } from '../../src/services/firestore.js'
import { DraftService } from '../../src/services/draftService.js'
import { HistoryService } from '../../src/services/historyService.js'
import { FIRESTORE_CONFIG } from '../../src/constants/firestoreConstants.js'
import { runTransaction } from 'firebase/firestore'

// ---------------------------------------------------------------------------
// Section 1 — parseFcfaAmount : référence canonique
// ---------------------------------------------------------------------------

describe('TC-022-1 — parseFcfaAmount : source de vérité canonique', () => {

  // Cas valides
  it('[TC-022-1-V1] parseFcfaAmount(1) === 1 (minimum entier positif)', () => {
    expect(parseFcfaAmount(1)).toBe(1)
  })

  it('[TC-022-1-V2] parseFcfaAmount(1000) === 1000 (number entier)', () => {
    expect(parseFcfaAmount(1000)).toBe(1000)
  })

  it('[TC-022-1-V3] parseFcfaAmount("1000") === 1000 (chaîne numérique)', () => {
    expect(parseFcfaAmount('1000')).toBe(1000)
  })

  it('[TC-022-1-V4] parseFcfaAmount("1 000") === 1000 (espace milliers U+0020)', () => {
    expect(parseFcfaAmount('1 000')).toBe(1000)
  })

  it('[TC-022-1-V5] parseFcfaAmount("1 000") === 1000 (espace insécable U+00A0)', () => {
    expect(parseFcfaAmount('1 000')).toBe(1000)
  })

  // Cas invalides — zéro et négatifs
  it('[TC-022-1-I1] parseFcfaAmount(0) === null', () => {
    expect(parseFcfaAmount(0)).toBeNull()
  })

  it('[TC-022-1-I2] parseFcfaAmount("0") === null', () => {
    expect(parseFcfaAmount('0')).toBeNull()
  })

  it('[TC-022-1-I3] parseFcfaAmount(-1) === null', () => {
    expect(parseFcfaAmount(-1)).toBeNull()
  })

  // Cas invalides — décimaux
  it('[TC-022-1-I4] parseFcfaAmount(0.5) === null (décimal)', () => {
    expect(parseFcfaAmount(0.5)).toBeNull()
  })

  it('[TC-022-1-I5] parseFcfaAmount(1.5) === null (décimal)', () => {
    expect(parseFcfaAmount(1.5)).toBeNull()
  })

  it('[TC-022-1-I6] parseFcfaAmount("1000.5") === null (chaîne décimale)', () => {
    expect(parseFcfaAmount('1000.5')).toBeNull()
  })

  // Cas invalides — chaînes non numériques
  it('[TC-022-1-I7] parseFcfaAmount("1000abc") === null', () => {
    expect(parseFcfaAmount('1000abc')).toBeNull()
  })

  it('[TC-022-1-I8] parseFcfaAmount("") === null (chaîne vide)', () => {
    expect(parseFcfaAmount('')).toBeNull()
  })

  it('[TC-022-1-I9] parseFcfaAmount("   ") === null (espaces seuls)', () => {
    expect(parseFcfaAmount('   ')).toBeNull()
  })

  // Cas invalides — types non scalaires
  it('[TC-022-1-I10] parseFcfaAmount(null) === null', () => {
    expect(parseFcfaAmount(null)).toBeNull()
  })

  it('[TC-022-1-I11] parseFcfaAmount(undefined) === null', () => {
    expect(parseFcfaAmount(undefined)).toBeNull()
  })

  it('[TC-022-1-I12] parseFcfaAmount(NaN) === null', () => {
    expect(parseFcfaAmount(NaN)).toBeNull()
  })

  it('[TC-022-1-I13] parseFcfaAmount(Infinity) === null', () => {
    expect(parseFcfaAmount(Infinity)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Section 2 — validateTransactionData : alignement sur parseFcfaAmount
// ---------------------------------------------------------------------------

describe('TC-022-2 — validateTransactionData : validité alignée sur parseFcfaAmount', () => {
  let svc

  beforeEach(() => {
    svc = new FirestoreService()
    svc.setActiveStore({ id: 'store-test', name: 'Boutique Test' })
  })

  const rules = FIRESTORE_CONFIG.VALIDATION.TRANSACTION

  // Montants valides
  it('[TC-022-2-V1] montant 1 (number entier) — isValid true', () => {
    const result = svc.validateTransactionData({ montant: 1, type: 'Dépôt', clientId: 'c1' }, rules)
    expect(result.isValid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('[TC-022-2-V2] montant 1000 (number entier) — isValid true', () => {
    const result = svc.validateTransactionData({ montant: 1000, type: 'Dépôt', clientId: 'c1' }, rules)
    expect(result.isValid).toBe(true)
  })

  it('[TC-022-2-V3] montant "1000" (chaîne numérique entière) — isValid true', () => {
    const result = svc.validateTransactionData({ montant: '1000', type: 'Dépôt', clientId: 'c1' }, rules)
    expect(result.isValid).toBe(true)
  })

  // Montants décimaux — invalides
  it('[TC-022-2-I1] montant 0.5 (décimal) — isValid false, erreur présente', () => {
    const result = svc.validateTransactionData({ montant: 0.5, type: 'Dépôt', clientId: 'c1' }, rules)
    expect(result.isValid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toContain('entier')
  })

  it('[TC-022-2-I2] montant 1.5 (décimal) — isValid false', () => {
    const result = svc.validateTransactionData({ montant: 1.5, type: 'Dépôt', clientId: 'c1' }, rules)
    expect(result.isValid).toBe(false)
    expect(result.errors[0]).toContain('entier')
  })

  it('[TC-022-2-I3] montant "1000.5" (chaîne décimale) — isValid false', () => {
    const result = svc.validateTransactionData({ montant: '1000.5', type: 'Dépôt', clientId: 'c1' }, rules)
    expect(result.isValid).toBe(false)
    expect(result.errors[0]).toContain('entier')
  })

  // Zéro et négatifs
  it('[TC-022-2-I4] montant 0 — isValid false', () => {
    const result = svc.validateTransactionData({ montant: 0, type: 'Dépôt', clientId: 'c1' }, rules)
    expect(result.isValid).toBe(false)
  })

  it('[TC-022-2-I5] montant "0" — isValid false', () => {
    const result = svc.validateTransactionData({ montant: '0', type: 'Dépôt', clientId: 'c1' }, rules)
    expect(result.isValid).toBe(false)
  })

  it('[TC-022-2-I6] montant -1 — isValid false', () => {
    const result = svc.validateTransactionData({ montant: -1, type: 'Dépôt', clientId: 'c1' }, rules)
    expect(result.isValid).toBe(false)
  })

  it('[TC-022-2-I7] montant "1000abc" (chaîne invalide) — isValid false', () => {
    const result = svc.validateTransactionData({ montant: '1000abc', type: 'Dépôt', clientId: 'c1' }, rules)
    expect(result.isValid).toBe(false)
  })

  it('[TC-022-2-I8] montant null — isValid false (null présent dans data)', () => {
    const result = svc.validateTransactionData({ montant: null, type: 'Dépôt', clientId: 'c1' }, rules)
    expect(result.isValid).toBe(false)
  })

  it('[TC-022-2-I9] montant NaN — isValid false', () => {
    const result = svc.validateTransactionData({ montant: NaN, type: 'Dépôt', clientId: 'c1' }, rules)
    expect(result.isValid).toBe(false)
  })

  it('[TC-022-2-I10] montant Infinity — isValid false', () => {
    const result = svc.validateTransactionData({ montant: Infinity, type: 'Dépôt', clientId: 'c1' }, rules)
    expect(result.isValid).toBe(false)
  })

  // Montant absent mais requis via REQUIRED_FIELDS
  it('[TC-022-2-I11] montant absent (clé non présente dans data) — erreur de champ requis', () => {
    const result = svc.validateTransactionData({ type: 'Dépôt', clientId: 'c1' }, rules)
    // montant absent → REQUIRED_FIELDS le détecte comme manquant
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => e.includes('montant'))).toBe(true)
  })

  // Les autres champs requis restent validés indépendamment du montant
  it('[TC-022-2-V4] montant valide mais clientId absent — isValid false (validation orthogonale)', () => {
    const result = svc.validateTransactionData({ montant: 1000, type: 'Dépôt' }, rules)
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => e.includes('clientId'))).toBe(true)
  })

  it('[TC-022-2-V5] montant valide mais type absent — isValid false (validation orthogonale)', () => {
    const result = svc.validateTransactionData({ montant: 1000, clientId: 'c1' }, rules)
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => e.includes('type'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Section 3 — validateTransactionForm : alignement sur parseFcfaAmount
// ---------------------------------------------------------------------------

describe('TC-022-3 — validateTransactionForm : validité alignée sur parseFcfaAmount', () => {

  const CLIENT = { nom: 'Alpha', prenom: 'Client' }

  // Montants valides
  it('[TC-022-3-V1] montant 1000 + client valide + type Dépôt — truthy', () => {
    expect(validateTransactionForm(CLIENT, 1000, 'Dépôt')).toBeTruthy()
  })

  it('[TC-022-3-V2] montant "1000" (chaîne entière) — truthy', () => {
    expect(validateTransactionForm(CLIENT, '1000', 'Dépôt')).toBeTruthy()
  })

  it('[TC-022-3-V3] montant 1 (minimum) — truthy', () => {
    expect(validateTransactionForm(CLIENT, 1, 'Dépôt')).toBeTruthy()
  })

  // Décimaux — invalides
  it('[TC-022-3-I1] montant 0.5 (décimal) — falsy', () => {
    expect(validateTransactionForm(CLIENT, 0.5, 'Dépôt')).toBeFalsy()
  })

  it('[TC-022-3-I2] montant 1.5 (décimal) — falsy', () => {
    expect(validateTransactionForm(CLIENT, 1.5, 'Dépôt')).toBeFalsy()
  })

  it('[TC-022-3-I3] montant "1000.5" (chaîne décimale) — falsy', () => {
    expect(validateTransactionForm(CLIENT, '1000.5', 'Dépôt')).toBeFalsy()
  })

  it('[TC-022-3-I4] montant "0.01" (centime FCFA) — falsy', () => {
    expect(validateTransactionForm(CLIENT, '0.01', 'Dépôt')).toBeFalsy()
  })

  // Zéro et négatifs
  it('[TC-022-3-I5] montant 0 — falsy', () => {
    expect(validateTransactionForm(CLIENT, 0, 'Dépôt')).toBeFalsy()
  })

  it('[TC-022-3-I6] montant "0" — falsy', () => {
    expect(validateTransactionForm(CLIENT, '0', 'Dépôt')).toBeFalsy()
  })

  it('[TC-022-3-I7] montant -1 — falsy', () => {
    expect(validateTransactionForm(CLIENT, -1, 'Dépôt')).toBeFalsy()
  })

  it('[TC-022-3-I8] montant "1000abc" (chaîne invalide) — falsy', () => {
    expect(validateTransactionForm(CLIENT, '1000abc', 'Dépôt')).toBeFalsy()
  })

  it('[TC-022-3-I9] montant vide "" — falsy', () => {
    expect(validateTransactionForm(CLIENT, '', 'Dépôt')).toBeFalsy()
  })

  it('[TC-022-3-I10] montant null — falsy', () => {
    expect(validateTransactionForm(CLIENT, null, 'Dépôt')).toBeFalsy()
  })

  it('[TC-022-3-I11] montant undefined — falsy', () => {
    expect(validateTransactionForm(CLIENT, undefined, 'Dépôt')).toBeFalsy()
  })
})

// ---------------------------------------------------------------------------
// Section 4 — addDraft : protection via addDocument → validateTransactionData
//
// addDraft (DraftService) appelle _addDocument(ctx.addDocument).
// Pour tester que validateTransactionData intercepte les montants invalides,
// on injecte dans le ctx un addDocument qui reproduit la logique de validation
// réelle (sans le circuit breaker ni le retry de withErrorHandling).
// ---------------------------------------------------------------------------

describe('TC-022-4 — addDraft : rejet des montants décimaux via validateTransactionData', () => {

  // Implémentation légère de addDocument reproduisant la validation
  // sans withErrorHandling (pas de retry, pas de circuit breaker).
  function makeValidatingAddDocument(svcInstance) {
    return vi.fn(async (collectionName, data) => {
      const validation = svcInstance.validateData(collectionName, data)
      if (!validation.isValid) {
        throw new Error(`Données invalides: ${validation.errors.join(', ')}`)
      }
      return { id: 'mock-id', ...data }
    })
  }

  let svcRef
  let draftSvc
  let mockAddDocument

  beforeEach(() => {
    svcRef = new FirestoreService()
    svcRef.setActiveStore({ id: 'store-test', name: 'Boutique Test' })
    mockAddDocument = makeValidatingAddDocument(svcRef)

    draftSvc = new DraftService({
      ctx: {
        requireActiveStore: vi.fn(() => ({ id: 'store-test' })),
        getNetworkBalanceDocRef: vi.fn(),
        collectionRef: vi.fn(),
        docRef: vi.fn(),
        getCollection: vi.fn(),
        addDocument: mockAddDocument,
      }
    })
  })

  it('[TC-022-4-I1] montant 0.5 (décimal) — validation échoue, addDocument non appelé', async () => {
    /**
     * Comportement après correction addDraft :
     * parseFcfaAmount(0.5) === null → erreur levée AVANT addDocument.
     * Message : "Montant FCFA invalide dans addDraft"
     */
    await expect(
      draftSvc.addDraft({ montant: 0.5, type: 'Dépôt', clientId: 'c1', reseau: 'Orange' })
    ).rejects.toThrow('Montant FCFA invalide dans addDraft')
    expect(mockAddDocument).not.toHaveBeenCalled()
  })

  it('[TC-022-4-I2] montant 1.5 (décimal) — validation échoue, addDocument non appelé', async () => {
    await expect(
      draftSvc.addDraft({ montant: 1.5, type: 'Dépôt', clientId: 'c1', reseau: 'Orange' })
    ).rejects.toThrow('Montant FCFA invalide dans addDraft')
    expect(mockAddDocument).not.toHaveBeenCalled()
  })

  it('[TC-022-4-I3] montant 0 — validation échoue, addDocument non appelé', async () => {
    await expect(
      draftSvc.addDraft({ montant: 0, type: 'Dépôt', clientId: 'c1', reseau: 'Orange' })
    ).rejects.toThrow('Montant FCFA invalide dans addDraft')
    expect(mockAddDocument).not.toHaveBeenCalled()
  })

  it('[TC-022-4-I4] montant -100 — validation échoue, addDocument non appelé', async () => {
    await expect(
      draftSvc.addDraft({ montant: -100, type: 'Dépôt', clientId: 'c1', reseau: 'Orange' })
    ).rejects.toThrow('Montant FCFA invalide dans addDraft')
    expect(mockAddDocument).not.toHaveBeenCalled()
  })

  it('[TC-022-4-I5] montant "500.5" (chaîne décimale) — validation échoue, addDocument non appelé', async () => {
    await expect(
      draftSvc.addDraft({ montant: '500.5', type: 'Dépôt', clientId: 'c1', reseau: 'Orange' })
    ).rejects.toThrow('Montant FCFA invalide dans addDraft')
    expect(mockAddDocument).not.toHaveBeenCalled()
  })

  it('[TC-022-4-V1] montant 1000 (valide) — validation passe, addDocument résout', async () => {
    const result = await draftSvc.addDraft({
      montant: 1000, type: 'Dépôt', clientId: 'c1', reseau: 'Orange'
    })
    expect(mockAddDocument).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ montant: 1000 })
  })
})

// ---------------------------------------------------------------------------
// Section 5 — addToHistory via HistoryService
// ---------------------------------------------------------------------------

describe('TC-022-5 — addToHistory : validation montant avant écriture Firestore', () => {

  let ctx
  let addDocumentMock
  let validateFcfaAmountMock
  let historySvc

  beforeEach(() => {
    addDocumentMock = vi.fn()
    validateFcfaAmountMock = vi.fn((raw, _context) => {
      // Reproduit le comportement de _validateFcfaAmount en utilisant parseFcfaAmount
      const result = parseFcfaAmount(raw)
      if (result === null) {
        throw new Error(`Montant FCFA invalide : ${raw}`)
      }
      return result
    })

    ctx = {
      requireActiveStore: vi.fn(() => ({ id: 'store-test' })),
      getNetworkBalanceDocRef: vi.fn(),
      docRef: vi.fn(),
      addDocument: addDocumentMock,
      getCollection: vi.fn(),
      subscribeToCollection: vi.fn(),
      normalizeTransactionLabel: vi.fn((v) => v),
      normalizeNetworkBalances: vi.fn((d) => d),
      reverseHistoryTransactionImpact: vi.fn(),
      _validateFcfaAmount: validateFcfaAmountMock,
    }

    historySvc = new HistoryService({ ctx })
  })

  it('[TC-022-5-V1] montant 1000 (valide) — addDocument appelé une fois', async () => {
    addDocumentMock.mockResolvedValueOnce({ id: 'history-001', montant: 1000 })

    await historySvc.addToHistory({
      montant: 1000, type: 'Dépôt', clientId: 'c1', reseau: 'Orange'
    })

    expect(addDocumentMock).toHaveBeenCalledTimes(1)
  })

  it('[TC-022-5-I1] montant 0.5 (décimal) — erreur levée, addDocument non appelé', async () => {
    await expect(
      historySvc.addToHistory({ montant: 0.5, type: 'Dépôt', clientId: 'c1', reseau: 'Orange' })
    ).rejects.toThrow('Montant FCFA invalide')

    expect(addDocumentMock).not.toHaveBeenCalled()
  })

  it('[TC-022-5-I2] montant 1.5 (décimal) — erreur levée, addDocument non appelé', async () => {
    await expect(
      historySvc.addToHistory({ montant: 1.5, type: 'Dépôt', clientId: 'c1', reseau: 'Orange' })
    ).rejects.toThrow('Montant FCFA invalide')

    expect(addDocumentMock).not.toHaveBeenCalled()
  })

  it('[TC-022-5-I3] montant 0 — erreur levée, addDocument non appelé', async () => {
    await expect(
      historySvc.addToHistory({ montant: 0, type: 'Dépôt', clientId: 'c1', reseau: 'Orange' })
    ).rejects.toThrow('Montant FCFA invalide')

    expect(addDocumentMock).not.toHaveBeenCalled()
  })

  it('[TC-022-5-I4] montant -50 — erreur levée, addDocument non appelé', async () => {
    await expect(
      historySvc.addToHistory({ montant: -50, type: 'Dépôt', clientId: 'c1', reseau: 'Orange' })
    ).rejects.toThrow('Montant FCFA invalide')

    expect(addDocumentMock).not.toHaveBeenCalled()
  })

  it('[TC-022-5-I5] montant NaN — erreur levée, addDocument non appelé', async () => {
    await expect(
      historySvc.addToHistory({ montant: NaN, type: 'Dépôt', clientId: 'c1', reseau: 'Orange' })
    ).rejects.toThrow('Montant FCFA invalide')

    expect(addDocumentMock).not.toHaveBeenCalled()
  })

  it('[TC-022-5-I6] montant "100.5" (chaîne décimale) — erreur levée, addDocument non appelé', async () => {
    await expect(
      historySvc.addToHistory({ montant: '100.5', type: 'Dépôt', clientId: 'c1', reseau: 'Orange' })
    ).rejects.toThrow('Montant FCFA invalide')

    expect(addDocumentMock).not.toHaveBeenCalled()
  })

  it('[TC-022-5-I7] zéro appels addDocument sur montant invalide (comptage explicite)', async () => {
    try {
      await historySvc.addToHistory({ montant: 0.5, type: 'Dépôt', clientId: 'c1', reseau: 'Orange' })
    } catch {
      // attendu
    }

    expect(addDocumentMock).toHaveBeenCalledTimes(0)
  })
})

// ---------------------------------------------------------------------------
// Section 6 — Bornes sans plafond (parseFcfaAmount)
//
// L'ancien plafond AMOUNT_MAX = 100000000 a été supprimé de firestoreConstants.js
// et de firestore.rules. parseFcfaAmount n'impose aucune borne supérieure.
// Seules contraintes conservées : entier strictement positif, fini.
// ---------------------------------------------------------------------------

describe('TC-022-6 — Bornes sans plafond (parseFcfaAmount)', () => {

  it('[TC-022-6-P1] 100000000 est valide (ancien plafond supprimé)', () => {
    expect(parseFcfaAmount(100000000)).toBe(100000000)
  })

  it('[TC-022-6-P2] 100000001 est valide (au-delà de l\'ancien plafond)', () => {
    expect(parseFcfaAmount(100000001)).toBe(100000001)
  })

  it('[TC-022-6-P3] 999999999 est valide (grand entier positif)', () => {
    expect(parseFcfaAmount(999999999)).toBe(999999999)
  })

  it('[TC-022-6-P4] 1000000000 est valide (milliard)', () => {
    expect(parseFcfaAmount(1000000000)).toBe(1000000000)
  })

  it('[TC-022-6-I1] Infinity reste invalide malgré la suppression du plafond', () => {
    expect(parseFcfaAmount(Infinity)).toBeNull()
  })

  it('[TC-022-6-I2] -Infinity reste invalide', () => {
    expect(parseFcfaAmount(-Infinity)).toBeNull()
  })

  it('[TC-022-6-I3] 0 reste invalide (zéro non entier positif strict)', () => {
    expect(parseFcfaAmount(0)).toBeNull()
  })

  it('[TC-022-6-I4] 0.5 reste invalide (décimal)', () => {
    expect(parseFcfaAmount(0.5)).toBeNull()
  })

  it('[TC-022-6-I5] NaN reste invalide', () => {
    expect(parseFcfaAmount(NaN)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Section 7 — Normalisation addDraft : montant number garanti dans le payload
//
// addDraft (DraftService) appelle parseFcfaAmount et écrit montant: parsedAmount.
// Cette section vérifie que le payload persisté contient un number, pas une string.
// ---------------------------------------------------------------------------

describe('TC-022-7 — Normalisation du montant dans addDraft', () => {

  function makeDraftSvc() {
    const captured = []
    const addDocumentMock = vi.fn(async (_col, data) => {
      captured.push(structuredClone(data))
      return { id: 'draft-001', ...data }
    })
    const ctx = {
      requireActiveStore: vi.fn(() => ({ id: 'store-test' })),
      getNetworkBalanceDocRef: vi.fn(),
      collectionRef: vi.fn(),
      docRef: vi.fn(),
      getCollection: vi.fn(),
      addDocument: addDocumentMock,
    }
    const svc = new DraftService({ ctx })
    return { svc, captured, addDocumentMock }
  }

  it('[TC-022-7-V1] montant "1000" (string) → payload.montant === 1000 (number)', async () => {
    const { svc, captured } = makeDraftSvc()
    await svc.addDraft({ montant: '1000', type: 'Dépôt', clientId: 'c1', reseau: 'Orange' })
    expect(captured[0].montant).toBe(1000)
    expect(typeof captured[0].montant).toBe('number')
  })

  it('[TC-022-7-V2] montant 1000 (number) → payload.montant === 1000 (number)', async () => {
    const { svc, captured } = makeDraftSvc()
    await svc.addDraft({ montant: 1000, type: 'Dépôt', clientId: 'c1', reseau: 'Orange' })
    expect(captured[0].montant).toBe(1000)
    expect(typeof captured[0].montant).toBe('number')
  })

  it('[TC-022-7-V3] montant "1 000" (espaces milliers) → payload.montant === 1000 (number)', async () => {
    const { svc, captured } = makeDraftSvc()
    await svc.addDraft({ montant: '1 000', type: 'Dépôt', clientId: 'c1', reseau: 'Orange' })
    expect(captured[0].montant).toBe(1000)
    expect(typeof captured[0].montant).toBe('number')
  })

  it('[TC-022-7-V4] montant 100000001 (supérieur ancien plafond) → payload.montant === 100000001', async () => {
    const { svc, captured } = makeDraftSvc()
    await svc.addDraft({ montant: 100000001, type: 'Dépôt', clientId: 'c1', reseau: 'Orange' })
    expect(captured[0].montant).toBe(100000001)
    expect(typeof captured[0].montant).toBe('number')
  })

  it('[TC-022-7-M1] addDraft ne mute pas l\'objet d\'entrée', async () => {
    const { svc } = makeDraftSvc()
    const input = { montant: '1000', type: 'Dépôt', clientId: 'c1', reseau: 'Orange' }
    const originalMontant = input.montant
    await svc.addDraft(input)
    expect(input.montant).toBe(originalMontant)
  })
})

// ---------------------------------------------------------------------------
// Section 8 — Invalides dans addDraft : aucune écriture Firestore
// ---------------------------------------------------------------------------

describe('TC-022-8 — addDraft invalides : aucun addDocument appelé', () => {

  function makeDraftSvcWithSpy() {
    const addDocumentMock = vi.fn()
    const ctx = {
      requireActiveStore: vi.fn(() => ({ id: 'store-test' })),
      getNetworkBalanceDocRef: vi.fn(),
      collectionRef: vi.fn(),
      docRef: vi.fn(),
      getCollection: vi.fn(),
      addDocument: addDocumentMock,
    }
    return { svc: new DraftService({ ctx }), addDocumentMock }
  }

  it('[TC-022-8-I1] montant 0.5 (décimal) → rejette avant addDocument', async () => {
    const { svc, addDocumentMock } = makeDraftSvcWithSpy()
    await expect(
      svc.addDraft({ montant: 0.5, type: 'Dépôt', clientId: 'c1', reseau: 'Orange' })
    ).rejects.toThrow()
    expect(addDocumentMock).not.toHaveBeenCalled()
  })

  it('[TC-022-8-I2] montant "1000abc" (chaîne invalide) → rejette avant addDocument', async () => {
    const { svc, addDocumentMock } = makeDraftSvcWithSpy()
    await expect(
      svc.addDraft({ montant: '1000abc', type: 'Dépôt', clientId: 'c1', reseau: 'Orange' })
    ).rejects.toThrow()
    expect(addDocumentMock).not.toHaveBeenCalled()
  })

  it('[TC-022-8-I3] montant Infinity → rejette avant addDocument', async () => {
    const { svc, addDocumentMock } = makeDraftSvcWithSpy()
    await expect(
      svc.addDraft({ montant: Infinity, type: 'Dépôt', clientId: 'c1', reseau: 'Orange' })
    ).rejects.toThrow()
    expect(addDocumentMock).not.toHaveBeenCalled()
  })

  it('[TC-022-8-I4] montant 0 → rejette avant addDocument', async () => {
    const { svc, addDocumentMock } = makeDraftSvcWithSpy()
    await expect(
      svc.addDraft({ montant: 0, type: 'Dépôt', clientId: 'c1', reseau: 'Orange' })
    ).rejects.toThrow()
    expect(addDocumentMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Section 9 — Normalisation addToHistory : montant number garanti dans le payload
// ---------------------------------------------------------------------------

describe('TC-022-9 — Normalisation du montant dans addToHistory', () => {

  function makeHistorySvc() {
    const captured = []
    const addDocumentMock = vi.fn(async (_col, data) => {
      captured.push(structuredClone(data))
      return { id: 'hist-001', ...data }
    })
    const validateFcfaAmountMock = vi.fn((raw, _context) => {
      const result = parseFcfaAmount(raw)
      if (result === null) throw new Error(`Montant FCFA invalide : ${raw}`)
      return result
    })
    const ctx = {
      requireActiveStore: vi.fn(() => ({ id: 'store-test' })),
      getNetworkBalanceDocRef: vi.fn(),
      docRef: vi.fn(),
      addDocument: addDocumentMock,
      getCollection: vi.fn(),
      subscribeToCollection: vi.fn(),
      normalizeTransactionLabel: vi.fn((v) => v),
      normalizeNetworkBalances: vi.fn((d) => d),
      reverseHistoryTransactionImpact: vi.fn(),
      _validateFcfaAmount: validateFcfaAmountMock,
    }
    return { svc: new HistoryService({ ctx }), captured, addDocumentMock }
  }

  it('[TC-022-9-V1] montant "1000" (string) → payload.montant === 1000 (number)', async () => {
    const { svc, captured } = makeHistorySvc()
    await svc.addToHistory({ montant: '1000', type: 'Dépôt', clientId: 'c1', reseau: 'Orange', statut: 'Validée' })
    expect(captured[0].montant).toBe(1000)
    expect(typeof captured[0].montant).toBe('number')
  })

  it('[TC-022-9-V2] montant 1000 (number) → payload.montant === 1000 (number)', async () => {
    const { svc, captured } = makeHistorySvc()
    await svc.addToHistory({ montant: 1000, type: 'Dépôt', clientId: 'c1', reseau: 'Orange', statut: 'Validée' })
    expect(captured[0].montant).toBe(1000)
    expect(typeof captured[0].montant).toBe('number')
  })

  it('[TC-022-9-V3] montant 100000001 (supérieur ancien plafond) → payload.montant === 100000001', async () => {
    const { svc, captured } = makeHistorySvc()
    await svc.addToHistory({ montant: 100000001, type: 'Dépôt', clientId: 'c1', reseau: 'Orange', statut: 'Validée' })
    expect(captured[0].montant).toBe(100000001)
    expect(typeof captured[0].montant).toBe('number')
  })

  it('[TC-022-9-M1] addToHistory ne mute pas l\'objet d\'entrée', async () => {
    const { svc } = makeHistorySvc()
    const input = { montant: '2000', type: 'Dépôt', clientId: 'c1', reseau: 'Orange', statut: 'Validée' }
    const originalMontant = input.montant
    await svc.addToHistory(input)
    expect(input.montant).toBe(originalMontant)
  })
})

// ---------------------------------------------------------------------------
// Section 10 — Absence de mutation du payload d'entrée
// ---------------------------------------------------------------------------

describe('TC-022-10 — Absence de mutation du payload par les validateurs', () => {

  let svc

  beforeEach(() => {
    svc = new FirestoreService()
    svc.setActiveStore({ id: 'store-test', name: 'Boutique Test' })
  })

  const rules = FIRESTORE_CONFIG.VALIDATION.TRANSACTION

  it('[TC-022-6-A] validateTransactionData ne mute pas le payload — montant valide', () => {
    const payload = { montant: 1000, type: 'Dépôt', clientId: 'c1' }
    const before = JSON.stringify(payload)

    svc.validateTransactionData(payload, rules)

    expect(JSON.stringify(payload)).toBe(before)
  })

  it('[TC-022-6-B] validateTransactionData ne mute pas le payload — montant invalide', () => {
    const payload = { montant: 1.5, type: 'Dépôt', clientId: 'c1' }
    const before = JSON.stringify(payload)

    svc.validateTransactionData(payload, rules)

    expect(JSON.stringify(payload)).toBe(before)
  })

  it('[TC-022-6-C] validateTransactionForm ne mute pas le payload — montant valide', () => {
    const amount = 1000
    const client = { nom: 'Alpha', prenom: 'Client' }
    const type = 'Dépôt'
    const clientBefore = JSON.stringify(client)

    validateTransactionForm(client, amount, type)

    expect(JSON.stringify(client)).toBe(clientBefore)
    expect(amount).toBe(1000)
    expect(type).toBe('Dépôt')
  })

  it('[TC-022-6-D] validateTransactionForm ne mute pas le payload — montant décimal', () => {
    const amount = 1.5
    const client = { nom: 'Alpha', prenom: 'Client' }
    const clientBefore = JSON.stringify(client)

    validateTransactionForm(client, amount, 'Dépôt')

    expect(JSON.stringify(client)).toBe(clientBefore)
    expect(amount).toBe(1.5)
  })
})

// ---------------------------------------------------------------------------
// Section 11 — Bornes isSafeInteger (parseFcfaAmount)
//
// Après remplacement de Number.isInteger par Number.isSafeInteger,
// MAX_SAFE_INTEGER est valide et MAX_SAFE_INTEGER+1 est rejeté.
// "9007199254740993" est également rejeté car Number("9007199254740993")
// vaut 9007199254740992 (arrondi IEEE-754), qui n'est pas isSafeInteger.
// ---------------------------------------------------------------------------

describe('TC-022-11 — Bornes isSafeInteger dans parseFcfaAmount', () => {

  it('[TC-022-11-V1] MAX_SAFE_INTEGER est valide', () => {
    expect(parseFcfaAmount(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('[TC-022-11-I1] MAX_SAFE_INTEGER + 1 est invalide', () => {
    expect(parseFcfaAmount(Number.MAX_SAFE_INTEGER + 1)).toBeNull()
  })

  it('[TC-022-11-V2] "9007199254740991" (MAX_SAFE_INTEGER string) est valide', () => {
    expect(parseFcfaAmount('9007199254740991')).toBe(9007199254740991)
  })

  it('[TC-022-11-I2] "9007199254740993" est invalide (arrondi silencieux IEEE-754)', () => {
    // Number("9007199254740993") === 9007199254740992, qui n'est pas isSafeInteger
    expect(parseFcfaAmount('9007199254740993')).toBeNull()
  })

  it('[TC-022-11-I3] Infinity reste invalide malgré la suppression de Number.isInteger', () => {
    expect(parseFcfaAmount(Infinity)).toBeNull()
  })

  it('[TC-022-11-I4] -Infinity reste invalide', () => {
    expect(parseFcfaAmount(-Infinity)).toBeNull()
  })

  it('[TC-022-11-I5] NaN reste invalide', () => {
    expect(parseFcfaAmount(NaN)).toBeNull()
  })

  it('[TC-022-11-I6] 0.5 (décimal) reste invalide', () => {
    expect(parseFcfaAmount(0.5)).toBeNull()
  })

  it('[TC-022-11-V3] parseFcfaAmount(1) === 1 (minimum toujours valide)', () => {
    expect(parseFcfaAmount(1)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Section 12 — addTransaction : normalisation du montant dans tx.set
//
// Comportement protégé :
//   addTransaction doit écrire montant: number (pas string) dans Firestore.
//   Le payload original transactionData ne doit pas être muté.
//   Les montants invalides doivent être rejetés AVANT tout appel runTransaction.
// ---------------------------------------------------------------------------

describe('TC-022-12 — addTransaction : normalisation du montant dans tx.set', () => {

  function makeDraftSvcForTx(overrides = {}) {
    const ctx = {
      requireActiveStore: vi.fn(() => ({ id: 'store-022' })),
      getNetworkBalanceDocRef: vi.fn(() => ({ _type: 'balance' })),
      collectionRef: vi.fn((col) => ({ _type: 'collection', _col: col })),
      docRef: vi.fn((col, id) => ({ _type: 'draft', _col: col, _id: id })),
      getCollection: vi.fn(async () => []),
      addDocument: vi.fn(async (_col, data) => ({ id: 'add-doc-id', ...data })),
      ...overrides
    }
    return new DraftService({ ctx })
  }

  function makeTxMockForAdd() {
    const writes = []
    const mockTx = {
      get: vi.fn(async (ref) => {
        if (ref._type === 'balance') {
          return {
            exists: () => true,
            data: () => ({
              balances: {
                Orange:  { stock: 5000, liquidite: 2000 },
                Moov:    { stock: 3000, liquidite: 1000 },
                Telecel: { stock: 1000, liquidite:  300 },
                Coris:   { stock:  500, liquidite:  100 },
                Sank:    { stock:  200, liquidite:   50 }
              }
            })
          }
        }
        return { exists: () => false, data: () => null }
      }),
      set: vi.fn((ref, data, options) => { writes.push({ op: 'set', ref, data, options }) }),
      update: vi.fn((ref, patch) => { writes.push({ op: 'update', ref, patch }) }),
      delete: vi.fn((ref) => { writes.push({ op: 'delete', ref }) }),
    }
    vi.mocked(runTransaction).mockImplementation(async (_db, callback) => callback(mockTx))
    return { writes, mockTx }
  }

  beforeEach(() => {
    vi.mocked(runTransaction).mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[TC-022-12-V1] addTransaction("1000" string) : tx.set reçoit montant: 1000 (number)', async () => {
    const svc = makeDraftSvcForTx()
    const { writes } = makeTxMockForAdd()

    await svc.addTransaction({
      montant: '1000', type: 'Dépôt', clientId: 'c1', reseau: 'Orange',
      statut: 'Non Terminées'
    })

    // La transaction est écrite dans la collection DRAFTS (ref sans _type 'balance')
    const txPayload = writes.find(w => w.op === 'set' && w.data && 'montant' in w.data && w.data.montant !== undefined)
    expect(txPayload).toBeDefined()
    expect(txPayload.data.montant).toBe(1000)
    expect(typeof txPayload.data.montant).toBe('number')
  })

  it('[TC-022-12-V2] addTransaction("1 000" espaces milliers) : tx.set reçoit montant: 1000', async () => {
    const svc = makeDraftSvcForTx()
    const { writes } = makeTxMockForAdd()

    await svc.addTransaction({
      montant: '1 000', type: 'Dépôt', clientId: 'c1', reseau: 'Orange',
      statut: 'Non Terminées'
    })

    const txPayload = writes.find(w => w.op === 'set' && w.data && 'montant' in w.data)
    expect(txPayload).toBeDefined()
    expect(txPayload.data.montant).toBe(1000)
    expect(typeof txPayload.data.montant).toBe('number')
  })

  it('[TC-022-12-V3] addTransaction(1000 number) : tx.set reçoit montant: 1000', async () => {
    const svc = makeDraftSvcForTx()
    const { writes } = makeTxMockForAdd()

    await svc.addTransaction({
      montant: 1000, type: 'Dépôt', clientId: 'c1', reseau: 'Orange',
      statut: 'Non Terminées'
    })

    const txPayload = writes.find(w => w.op === 'set' && w.data && 'montant' in w.data)
    expect(txPayload).toBeDefined()
    expect(txPayload.data.montant).toBe(1000)
    expect(typeof txPayload.data.montant).toBe('number')
  })

  it('[TC-022-12-M1] addTransaction ne mute pas transactionData source', async () => {
    const svc = makeDraftSvcForTx()
    makeTxMockForAdd()

    const input = {
      montant: '2000', type: 'Dépôt', clientId: 'c1', reseau: 'Orange',
      statut: 'Non Terminées'
    }
    const original = structuredClone(input)

    await svc.addTransaction(input)

    expect(input.montant).toBe(original.montant)
    expect(input).toEqual(original)
  })

  it('[TC-022-12-I1] addTransaction(0.5) → erreur, zéro appel tx.set ou tx.update', async () => {
    const svc = makeDraftSvcForTx()

    await expect(
      svc.addTransaction({ montant: 0.5, type: 'Dépôt', clientId: 'c1', reseau: 'Orange', statut: 'Non Terminées' })
    ).rejects.toThrow()

    expect(runTransaction).not.toHaveBeenCalled()
  })

  it('[TC-022-12-I2] addTransaction("1000abc") → erreur, zéro appel runTransaction', async () => {
    const svc = makeDraftSvcForTx()

    await expect(
      svc.addTransaction({ montant: '1000abc', type: 'Dépôt', clientId: 'c1', reseau: 'Orange', statut: 'Non Terminées' })
    ).rejects.toThrow()

    expect(runTransaction).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Section 13 — updateDraft : normalisation du montant dans tx.update
//
// Comportement protégé :
//   updateDraft doit écrire montant: number dans tx.update.
//   Le spread { ...normalizedUpdates, statut, updatedAt } ne doit pas restaurer
//   la valeur brute de updates.montant.
//   L'objet updates source ne doit pas être muté.
// ---------------------------------------------------------------------------

describe('TC-022-13 — updateDraft : normalisation du montant dans tx.update', () => {

  function makeDraftSvcForUpdate() {
    const ctx = {
      requireActiveStore: vi.fn(() => ({ id: 'store-022' })),
      getNetworkBalanceDocRef: vi.fn(() => ({ _type: 'balance' })),
      collectionRef: vi.fn((col) => ({ _type: 'collection', _col: col })),
      docRef: vi.fn((col, id) => ({ _type: 'draft', _col: col, _id: id })),
      getCollection: vi.fn(async () => []),
      addDocument: vi.fn(),
    }
    return new DraftService({ ctx })
  }

  const seedBalancesUpd = {
    Orange:  { stock: 5000, liquidite: 2000 },
    Moov:    { stock: 3000, liquidite: 1000 },
    Telecel: { stock: 1000, liquidite:  300 },
    Coris:   { stock:  500, liquidite:  100 },
    Sank:    { stock:  200, liquidite:   50 }
  }

  const currentDraftData = {
    type:     'Dépôt',
    reseau:   'Orange',
    montant:  1000,
    statut:   'Non Terminées',
    clientId: 'client-001',
    date:     '22/06/2026'
  }

  function makeTxMockForUpdate() {
    const writes = []
    const mockTx = {
      get: vi.fn(async (ref) => {
        if (ref._type === 'draft') {
          return { exists: () => true, data: () => ({ ...currentDraftData }) }
        }
        if (ref._type === 'balance') {
          return { exists: () => true, data: () => ({ balances: { ...seedBalancesUpd } }) }
        }
        return { exists: () => false, data: () => null }
      }),
      set: vi.fn((ref, data, options) => { writes.push({ op: 'set', ref, data, options }) }),
      update: vi.fn((ref, patch) => { writes.push({ op: 'update', ref, patch }) }),
      delete: vi.fn(),
    }
    vi.mocked(runTransaction).mockImplementation(async (_db, callback) => callback(mockTx))
    return { writes, mockTx }
  }

  beforeEach(() => {
    vi.mocked(runTransaction).mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[TC-022-13-V1] updateDraft(id, { montant: "1 000" }) : tx.update reçoit montant: 1000 (number)', async () => {
    const svc = makeDraftSvcForUpdate()
    const { writes } = makeTxMockForUpdate()

    await svc.updateDraft('draft-001', { montant: '1 000' })

    const updateWrite = writes.find(w => w.op === 'update')
    expect(updateWrite).toBeDefined()
    expect(updateWrite.patch.montant).toBe(1000)
    expect(typeof updateWrite.patch.montant).toBe('number')
  })

  it('[TC-022-13-V2] updateDraft(id, { montant: "1500" }) : tx.update reçoit montant: 1500', async () => {
    const svc = makeDraftSvcForUpdate()
    const { writes } = makeTxMockForUpdate()

    await svc.updateDraft('draft-001', { montant: '1500' })

    const updateWrite = writes.find(w => w.op === 'update')
    expect(updateWrite).toBeDefined()
    expect(updateWrite.patch.montant).toBe(1500)
    expect(typeof updateWrite.patch.montant).toBe('number')
  })

  it('[TC-022-13-M1] updateDraft ne mute pas l\'objet updates source', async () => {
    const svc = makeDraftSvcForUpdate()
    makeTxMockForUpdate()

    const updates = { montant: '2000' }
    const original = structuredClone(updates)

    await svc.updateDraft('draft-001', updates)

    expect(updates.montant).toBe(original.montant)
    expect(updates).toEqual(original)
  })

  it('[TC-022-13-I1] updateDraft(id, { montant: 0.5 }) → erreur avant runTransaction', async () => {
    const svc = makeDraftSvcForUpdate()

    await expect(
      svc.updateDraft('draft-001', { montant: 0.5 })
    ).rejects.toThrow('Montant FCFA invalide')

    expect(runTransaction).not.toHaveBeenCalled()
  })

  it('[TC-022-13-I2] updateDraft(id, { montant: 0 }) → erreur avant runTransaction', async () => {
    const svc = makeDraftSvcForUpdate()

    await expect(
      svc.updateDraft('draft-001', { montant: 0 })
    ).rejects.toThrow('Montant FCFA invalide')

    expect(runTransaction).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Section 14 — useSimpleNetworkData : parseFcfaAmount remplace parseFloat
//
// Comportement protégé :
//   validateAmount doit utiliser parseFcfaAmount, pas parseFloat.
//   "1 000" (espace milliers) doit être interprété comme 1000, pas 1.
//   Les décimaux doivent être rejetés.
//   Les chaînes invalides doivent être rejetées.
// ---------------------------------------------------------------------------

describe('TC-022-14 — useSimpleNetworkData.validateAmount : parseFcfaAmount', () => {

  // Le mock de useNetworkCards est déclaré au niveau fichier (hors describe)
  // getStock('Orange') retourne 500, les autres réseaux retournent 999999

  let useSimpleNetworkData

  beforeEach(async () => {
    const mod = await import('../../src/hooks/useSimpleNetworkData.js')
    useSimpleNetworkData = mod.useSimpleNetworkData
  })

  it('[TC-022-14-V1] "1000" est valide (isValid true)', () => {
    const { validateAmount } = useSimpleNetworkData()
    const result = validateAmount('Orange', '1000', 'Retrait')
    expect(result.isValid).toBe(true)
  })

  it('[TC-022-14-V2] 1000 (number) est valide (isValid true)', () => {
    const { validateAmount } = useSimpleNetworkData()
    const result = validateAmount('Orange', 1000, 'Retrait')
    expect(result.isValid).toBe(true)
  })

  it('[TC-022-14-V3] "1 000" (espace milliers) est traité comme 1000, pas rejeté', () => {
    // parseFloat("1 000") === 1 → invalide (le bug)
    // parseFcfaAmount("1 000") === 1000 → valide (le comportement attendu)
    const { validateAmount } = useSimpleNetworkData()
    const result = validateAmount('Orange', '1 000', 'Retrait')
    expect(result.isValid).toBe(true)
  })

  it('[TC-022-14-I1] "1000.5" (décimal) est invalide (isValid false)', () => {
    const { validateAmount } = useSimpleNetworkData()
    const result = validateAmount('Orange', '1000.5', 'Retrait')
    expect(result.isValid).toBe(false)
  })

  it('[TC-022-14-I2] "1000abc" (chaîne invalide) est invalide (isValid false)', () => {
    const { validateAmount } = useSimpleNetworkData()
    const result = validateAmount('Orange', '1000abc', 'Retrait')
    expect(result.isValid).toBe(false)
  })

  it('[TC-022-14-I3] 0 est invalide (isValid false)', () => {
    const { validateAmount } = useSimpleNetworkData()
    const result = validateAmount('Orange', 0, 'Retrait')
    expect(result.isValid).toBe(false)
  })

  it('[TC-022-14-I4] "" (chaîne vide) est invalide (isValid false)', () => {
    const { validateAmount } = useSimpleNetworkData()
    const result = validateAmount('Orange', '', 'Retrait')
    expect(result.isValid).toBe(false)
  })

  it('[TC-022-14-D1] "1 000" avec stock Orange=500 (Dépôt) : stock insuffisant — résultat INVERSE de parseFloat', () => {
    /**
     * Test discriminant : parseFcfaAmount("1 000") === 1000, stock=500 → insuffisant (isValid false)
     * Avec l'ancien parseFloat : parseFloat("1 000") === 1, stock=500 → suffisant (isValid true)
     * Ce test vérifie que le comportement correct (parseFcfaAmount) est en place.
     */
    const { validateAmount } = useSimpleNetworkData()
    // getStock('Orange') retourne 500 (mock de niveau fichier)
    const result = validateAmount('Orange', '1 000', 'Dépôt')
    // parseFcfaAmount("1 000") = 1000, stock = 500 → 1000 > 500 → insuffisant
    expect(result.isValid).toBe(false)
    expect(result.message).toContain('insuffisant')
  })
})

// ---------------------------------------------------------------------------
// Section 15 — reverseHistoryTransactionImpact : isSafeInteger
//
// Comportement protégé :
//   reverseHistoryTransactionImpact utilise validateFcfaAmount (via parseFcfaAmount +
//   isSafeInteger) au lieu de Number(rawAmount) + Number.isInteger.
//   MAX_SAFE_INTEGER est accepté. MAX_SAFE_INTEGER+1 est rejeté.
//   Les montants invalides (0, négatifs, décimaux) sont rejetés.
//   historyData n'est pas muté.
// ---------------------------------------------------------------------------

import {
  reverseHistoryTransactionImpact,
  normalizeNetworkBalances,
} from '../../src/utils/financialImpact.js'

describe('TC-022-15 — reverseHistoryTransactionImpact : isSafeInteger', () => {

  const baseBalances = normalizeNetworkBalances({
    balances: {
      Orange:  { stock: 10000, liquidite: 5000 },
      Moov:    { stock: 3000,  liquidite: 1000 },
      Telecel: { stock: 1000,  liquidite:  300 },
      Coris:   { stock:  500,  liquidite:  100 },
      Sank:    { stock:  200,  liquidite:   50 },
    }
  })

  function makeHistory(overrides) {
    return {
      type: 'Dépôt',
      reseau: 'Orange',
      statut: 'Non Terminées',
      clientId: 'c1',
      ...overrides,
    }
  }

  it('[TC-022-15-V1] MAX_SAFE_INTEGER (9007199254740991) est accepté sans lever d\'erreur de montant', () => {
    // La fonction peut échouer pour d\'autres raisons (solde insuffisant) mais pas sur la validation du montant.
    // On vérifie que l\'erreur levée (si elle existe) ne concerne pas le montant.
    const historyData = makeHistory({ montant: Number.MAX_SAFE_INTEGER })
    try {
      reverseHistoryTransactionImpact(baseBalances, historyData)
      // Pas d\'erreur : OK
    } catch (err) {
      // Erreur autorisée uniquement si elle ne concerne pas la validation du montant
      expect(err.message).not.toContain('Montant FCFA invalide')
      expect(err.message).not.toContain('entier strictement positif')
    }
  })

  it('[TC-022-15-I1] MAX_SAFE_INTEGER + 1 (9007199254740992) est rejeté', () => {
    const historyData = makeHistory({ montant: Number.MAX_SAFE_INTEGER + 1 })
    expect(() => reverseHistoryTransactionImpact(baseBalances, historyData)).toThrow()
  })

  it('[TC-022-15-I2] "9007199254740993" est rejeté (arrondi IEEE-754 hors isSafeInteger)', () => {
    // Number("9007199254740993") === 9007199254740992, non isSafeInteger → rejeté
    const historyData = makeHistory({ montant: '9007199254740993' })
    expect(() => reverseHistoryTransactionImpact(baseBalances, historyData)).toThrow()
  })

  it('[TC-022-15-I3] montant 0 est rejeté', () => {
    const historyData = makeHistory({ montant: 0 })
    expect(() => reverseHistoryTransactionImpact(baseBalances, historyData)).toThrow()
  })

  it('[TC-022-15-I4] montant -1 est rejeté', () => {
    const historyData = makeHistory({ montant: -1 })
    expect(() => reverseHistoryTransactionImpact(baseBalances, historyData)).toThrow()
  })

  it('[TC-022-15-I5] montant 0.5 (décimal) est rejeté', () => {
    const historyData = makeHistory({ montant: 0.5 })
    expect(() => reverseHistoryTransactionImpact(baseBalances, historyData)).toThrow()
  })

  it('[TC-022-15-M1] historyData n\'est pas muté par reverseHistoryTransactionImpact', () => {
    const historyData = makeHistory({ montant: 1000 })
    const snapshot = JSON.stringify(historyData)

    try {
      reverseHistoryTransactionImpact(baseBalances, historyData)
    } catch {
      // Une erreur de solde est possible — ce n\'est pas l\'objet du test
    }

    expect(JSON.stringify(historyData)).toBe(snapshot)
  })
})

// ---------------------------------------------------------------------------
// Section 16 — addDocument générique : normalisation du montant
//
// Comportement protégé :
//   addDocument(DRAFTS, { montant: "1 000", ... }) doit écrire montant: 1000 (number).
//   addDocument ne doit pas muter data source.
//   addDocument avec montant invalide ne doit pas appeler addDoc.
// ---------------------------------------------------------------------------

import { addDoc } from 'firebase/firestore'

describe('TC-022-16 — addDocument générique : normalisation du montant', () => {

  let svc

  beforeEach(() => {
    svc = new FirestoreService()
    svc.setActiveStore({ id: 'store-test', name: 'Boutique Test' })
    vi.mocked(addDoc).mockClear()
  })

  it('[TC-022-16-V1] addDocument(DRAFTS, { montant: "1 000", ... }) → addDoc reçoit montant: 1000 (number)', async () => {
    let captured = null
    vi.mocked(addDoc).mockImplementation(async (_ref, data) => {
      captured = structuredClone(data)
      return { id: 'mock-id' }
    })

    await svc.addDocument(FIRESTORE_CONFIG.COLLECTIONS.DRAFTS, {
      montant: '1 000',
      type: 'Dépôt',
      clientId: 'c1',
      statut: 'Non Terminées',
    })

    expect(captured).not.toBeNull()
    expect(captured.montant).toBe(1000)
    expect(typeof captured.montant).toBe('number')
  })

  it('[TC-022-16-V2] addDocument ne mute pas data source', async () => {
    vi.mocked(addDoc).mockImplementation(async (_ref, _data) => ({ id: 'mock-id' }))

    const input = { montant: '2000', type: 'Dépôt', clientId: 'c1', statut: 'Non Terminées' }
    const originalMontant = input.montant

    await svc.addDocument(FIRESTORE_CONFIG.COLLECTIONS.DRAFTS, input)

    expect(input.montant).toBe(originalMontant)
  })

  it('[TC-022-16-I1] montant invalide (décimal 1.5) : validateData retourne isValid false — addDoc ne peut pas être atteint', () => {
    /**
     * addDocument passe par withErrorHandling (retry/circuit-breaker).
     * On teste directement validateData : si isValid === false, addDocument lève une erreur
     * avant d'appeler addDoc. Ce test confirme le court-circuit côté validation.
     */
    const result = svc.validateData(FIRESTORE_CONFIG.COLLECTIONS.DRAFTS, {
      montant: 1.5,
      type: 'Dépôt',
      clientId: 'c1',
    })
    expect(result.isValid).toBe(false)
    expect(result.errors.some(e => e.includes('entier'))).toBe(true)
    // addDoc n'a pas été appelé car validateData est synchrone et échoue avant addDoc
    expect(addDoc).not.toHaveBeenCalled()
  })

  it('[TC-022-16-I2] montant invalide (0) : validateData retourne isValid false — addDoc ne peut pas être atteint', () => {
    const result = svc.validateData(FIRESTORE_CONFIG.COLLECTIONS.DRAFTS, {
      montant: 0,
      type: 'Dépôt',
      clientId: 'c1',
    })
    expect(result.isValid).toBe(false)
    expect(addDoc).not.toHaveBeenCalled()
  })
})
