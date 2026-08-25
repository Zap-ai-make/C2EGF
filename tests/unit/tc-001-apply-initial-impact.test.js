/**
 * TC-001 — Impact d'un dépôt validé sur les soldes
 *
 * Comportement à capturer (golden test) :
 *   - Un dépôt statut "Validée" retire `montant` du stock du réseau
 *     puis ajoute `montant` à la liquidité (via applyLiquidityDelta).
 *   - Un dépôt statut "Non Terminées" retire seulement `montant` du stock,
 *     sans toucher à la liquidité.
 *   - Un crédit statut "Validée" lève une erreur métier spécifique.
 *   - Un type inconnu retourne les balances inchangées.
 *
 * Fichier source : src/services/firestore.js:711-744 (applyInitialTransactionImpact)
 *                  src/services/firestore.js:652-681 (applyLiquidityDelta)
 *
 * Interdictions : aucun import Firebase, aucun accès réseau.
 * Les mocks ci-dessous neutralisent uniquement les effets de bord au niveau
 * module (initializeApp, getFirestore, import.meta.env) sans modifier src/.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest'

// --- Mocks des modules avec effets de bord au chargement ---

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
    get: vi.fn(),
    set: vi.fn(),
    invalidate: vi.fn(),
  },
  cacheUtils: {
    invalidatePattern: vi.fn(),
  },
}))

// --- Import de la classe après les mocks ---
import { FirestoreService } from '../../src/services/firestore.js'

// --- Fixtures locales déterministes ---

/**
 * Balances de référence avec liquidité non nulle sur Orange (premier réseau).
 * Toutes les valeurs sont des entiers fixes — aucun Date.now(), aucun Math.random().
 */
const baseBalances = {
  Orange:  { stock: 1000, liquidite: 500 },
  Moov:    { stock:  800, liquidite: 300 },
  Telecel: { stock:  600, liquidite: 200 },
  Coris:   { stock:  400, liquidite: 100 },
  Sank:    { stock:  200, liquidite:  50 },
}

// Service instancié une seule fois — le constructeur n'effectue pas d'I/O Firebase
// (setFetchFunction est mocké ci-dessus)
let svc

beforeAll(() => {
  svc = new FirestoreService()
})

// ---------------------------------------------------------------------------

describe('TC-001 — applyInitialTransactionImpact : cas dépôt', () => {

  // Cas nominal : dépôt Validée
  it('[TC-001-N1] dépôt Validée — stock Orange diminue de 200, liquidité Orange augmente de 200', () => {
    const transactionData = {
      type: 'Dépôt',
      statut: 'Validée',
      montant: 200,
      reseau: 'Orange',
    }

    const result = svc.applyInitialTransactionImpact(baseBalances, transactionData)

    // Stock Orange : 1000 - 200 = 800
    expect(result.Orange.stock).toBe(800)

    // applyLiquidityDelta(+200) : delta >= 0, donc adjustBalanceValue sur le premier réseau (Orange)
    // liquidite Orange : 500 + 200 = 700
    expect(result.Orange.liquidite).toBe(700)

    // Les autres réseaux restent inchangés
    expect(result.Moov.stock).toBe(800)
    expect(result.Moov.liquidite).toBe(300)
  })

  // Dépôt Validée — réseau Moov (vérifier que le bon réseau est touché pour le stock)
  it('[TC-001-N2] dépôt Validée réseau Moov — stock Moov diminue, liquidité Orange augmente (premier réseau)', () => {
    const transactionData = {
      type: 'Dépôt',
      statut: 'Validée',
      montant: 100,
      reseau: 'Moov',
    }

    const result = svc.applyInitialTransactionImpact(baseBalances, transactionData)

    // Stock Moov : 800 - 100 = 700
    expect(result.Moov.stock).toBe(700)

    // applyLiquidityDelta(+100) : ajoute sur Orange (premier réseau de baseBalances)
    // liquidite Orange : 500 + 100 = 600
    expect(result.Orange.liquidite).toBe(600)

    // Stock Orange ne doit PAS changer (seul Moov est touché pour le stock)
    expect(result.Orange.stock).toBe(1000)
  })

  // Dépôt statut "Non Terminées" — uniquement le stock est affecté, pas la liquidité
  it('[TC-001-N3] dépôt Non Terminées — stock Orange diminue, liquidité inchangée', () => {
    const transactionData = {
      type: 'Dépôt',
      statut: 'Non Terminées',
      montant: 150,
      reseau: 'Orange',
    }

    const result = svc.applyInitialTransactionImpact(baseBalances, transactionData)

    // Stock Orange : 1000 - 150 = 850
    expect(result.Orange.stock).toBe(850)

    // Liquidité Orange inchangée
    expect(result.Orange.liquidite).toBe(500)
  })

  // Montant nul — désormais refusé : lève une erreur (garde FCFA entier strictement positif)
  it('[TC-001-L1] dépôt Validée montant 0 — lève une erreur FCFA invalide', () => {
    const transactionData = {
      type: 'Dépôt',
      statut: 'Validée',
      montant: 0,
      reseau: 'Orange',
    }

    expect(() => svc.applyInitialTransactionImpact(baseBalances, transactionData)).toThrow(
      'Montant FCFA invalide'
    )
  })

  // Crédit statut Validée — doit lever une erreur métier spécifique
  it('[TC-001-L2] crédit Validée — lève une erreur métier', () => {
    const transactionData = {
      type: 'Crédit',
      statut: 'Validée',
      montant: 200,
      reseau: 'Orange',
    }

    expect(() => svc.applyInitialTransactionImpact(baseBalances, transactionData)).toThrow(
      'Les credits doivent etre rembourses via une methode de paiement'
    )
  })

  // Type inconnu — comportement actuel : retourne balances inchangées
  it('[TC-001-L3] type inconnu Validée — retourne balances inchangées', () => {
    const transactionData = {
      type: 'TypeInconnu',
      statut: 'Validée',
      montant: 200,
      reseau: 'Orange',
    }

    const result = svc.applyInitialTransactionImpact(baseBalances, transactionData)

    expect(result.Orange.stock).toBe(1000)
    expect(result.Orange.liquidite).toBe(500)
  })

  // Dépôt Validée — stock insuffisant → doit lever une erreur
  it('[TC-001-L4] dépôt Validée montant supérieur au stock — lève une erreur', () => {
    const transactionData = {
      type: 'Dépôt',
      statut: 'Validée',
      montant: 2000, // supérieur à Orange.stock = 1000
      reseau: 'Orange',
    }

    expect(() => svc.applyInitialTransactionImpact(baseBalances, transactionData)).toThrow()
  })

  // Vérification de l'immutabilité : l'objet original ne doit pas être muté
  it('[TC-001-I1] les balances originales ne sont pas mutées', () => {
    const transactionData = {
      type: 'Dépôt',
      statut: 'Validée',
      montant: 200,
      reseau: 'Orange',
    }

    const originalStockOrange = baseBalances.Orange.stock
    svc.applyInitialTransactionImpact(baseBalances, transactionData)

    expect(baseBalances.Orange.stock).toBe(originalStockOrange)
  })
})
