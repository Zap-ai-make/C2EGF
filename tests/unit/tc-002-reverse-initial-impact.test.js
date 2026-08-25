/**
 * TC-002 — Impact d'un retrait validé sur les soldes + reverseInitialTransactionImpact
 *
 * Comportement à capturer (golden test) :
 *   - Un retrait statut "Validée" retire `montant` de la liquidité
 *     (via applyLiquidityDelta(-amount)) puis ajoute `montant` au stock du réseau.
 *   - Un retrait statut "Non Terminées" ajoute `montant` au stock du réseau
 *     (sans toucher à la liquidité).
 *   - Liquidité insuffisante pour un retrait Validée → lève une erreur métier.
 *   - reverseInitialTransactionImpact inverse l'impact d'une transaction pending.
 *   - reverseInitialTransactionImpact sur une transaction Validée ne fait RIEN
 *     (asymétrie documentée : src/services/firestore.js:750).
 *
 * Fichier source : src/services/firestore.js:711-744 (applyInitialTransactionImpact)
 *                  src/services/firestore.js:746-761 (reverseInitialTransactionImpact)
 *                  src/services/firestore.js:652-681 (applyLiquidityDelta)
 *
 * Interdictions : aucun import Firebase, aucun accès réseau.
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
 * Balances de référence avec liquidité non nulle.
 * Toutes valeurs entières fixes — aucun Date.now(), aucun Math.random().
 */
const baseBalances = {
  Orange:  { stock: 1000, liquidite: 500 },
  Moov:    { stock:  800, liquidite: 300 },
  Telecel: { stock:  600, liquidite: 200 },
  Coris:   { stock:  400, liquidite: 100 },
  Sank:    { stock:  200, liquidite:  50 },
}

/**
 * Balances avec liquidité totale insuffisante pour tester le cas d'erreur.
 * Liquidité totale = 10 FCFA seulement.
 */
const lowLiquidityBalances = {
  Orange:  { stock: 1000, liquidite:   5 },
  Moov:    { stock:  800, liquidite:   3 },
  Telecel: { stock:  600, liquidite:   2 },
  Coris:   { stock:  400, liquidite:   0 },
  Sank:    { stock:  200, liquidite:   0 },
}

let svc

beforeAll(() => {
  svc = new FirestoreService()
})

// ---------------------------------------------------------------------------

describe('TC-002 — applyInitialTransactionImpact : cas retrait', () => {

  // Cas nominal : retrait Validée
  it('[TC-002-N1] retrait Validée — liquidité diminue de 300, stock Moov augmente de 300', () => {
    const transactionData = {
      type: 'Retrait',
      statut: 'Validée',
      montant: 300,
      reseau: 'Moov',
    }

    const result = svc.applyInitialTransactionImpact(baseBalances, transactionData)

    // applyLiquidityDelta(-300) : retire depuis Orange (premier réseau, liquidite=500)
    // liquidite Orange : 500 - 300 = 200
    expect(result.Orange.liquidite).toBe(200)

    // Stock Moov : 800 + 300 = 1100
    expect(result.Moov.stock).toBe(1100)

    // Liquidité Moov inchangée (seule la liquidité Orange est consommée ici)
    expect(result.Moov.liquidite).toBe(300)
  })

  // Retrait Validée — montant consomme plusieurs réseaux successivement
  it('[TC-002-N2] retrait Validée montant 700 — liquidité prélevée sur Orange puis Moov', () => {
    const transactionData = {
      type: 'Retrait',
      statut: 'Validée',
      montant: 700, // 500 (Orange) + 200 (Moov)
      reseau: 'Orange',
    }

    const result = svc.applyInitialTransactionImpact(baseBalances, transactionData)

    // Orange liquidité épuisée : 500 - 500 = 0
    expect(result.Orange.liquidite).toBe(0)

    // Moov liquidité : 300 - 200 = 100 (les 200 restants prélevés sur Moov)
    expect(result.Moov.liquidite).toBe(100)

    // Stock Orange augmente de 700
    expect(result.Orange.stock).toBe(1700)
  })

  // Retrait statut "Non Terminées" — stock augmente, liquidité inchangée
  it('[TC-002-N3] retrait Non Terminées — stock Moov augmente, liquidité inchangée', () => {
    const transactionData = {
      type: 'Retrait',
      statut: 'Non Terminées',
      montant: 300,
      reseau: 'Moov',
    }

    const result = svc.applyInitialTransactionImpact(baseBalances, transactionData)

    // Stock Moov : 800 + 300 = 1100
    expect(result.Moov.stock).toBe(1100)

    // Liquidités inchangées
    expect(result.Orange.liquidite).toBe(500)
    expect(result.Moov.liquidite).toBe(300)
  })

  // Cas limite : liquidité insuffisante → lève une erreur
  it('[TC-002-L1] retrait Validée montant 300 avec liquidité totale 10 — lève une erreur', () => {
    const transactionData = {
      type: 'Retrait',
      statut: 'Validée',
      montant: 300,
      reseau: 'Orange',
    }

    expect(() => svc.applyInitialTransactionImpact(lowLiquidityBalances, transactionData)).toThrow(
      /Liquidite insuffisante/
    )
  })

  // Retrait Validée montant nul — désormais refusé : lève une erreur FCFA
  it('[TC-002-L2] retrait Validée montant 0 — lève une erreur FCFA invalide', () => {
    const transactionData = {
      type: 'Retrait',
      statut: 'Validée',
      montant: 0,
      reseau: 'Orange',
    }

    expect(() => svc.applyInitialTransactionImpact(baseBalances, transactionData)).toThrow(
      'Montant FCFA invalide'
    )
  })

  // Immutabilité
  it('[TC-002-I1] les balances originales ne sont pas mutées', () => {
    const transactionData = {
      type: 'Retrait',
      statut: 'Validée',
      montant: 300,
      reseau: 'Moov',
    }

    const originalLiquiditeOrange = baseBalances.Orange.liquidite
    svc.applyInitialTransactionImpact(baseBalances, transactionData)
    expect(baseBalances.Orange.liquidite).toBe(originalLiquiditeOrange)
  })
})

// ---------------------------------------------------------------------------

describe('TC-002 — reverseInitialTransactionImpact : inversion des impacts', () => {

  // Cas nominal : reverse d'un dépôt pending
  it('[TC-002-R1] reverse dépôt Non Terminées — stock Orange revient à sa valeur initiale', () => {
    const transactionData = {
      type: 'Dépôt',
      statut: 'Non Terminées',
      montant: 150,
      reseau: 'Orange',
    }

    // Appliquer d'abord
    const afterApply = svc.applyInitialTransactionImpact(baseBalances, transactionData)
    // Stock Orange : 1000 - 150 = 850

    // Reverser
    const afterReverse = svc.reverseInitialTransactionImpact(afterApply, transactionData)
    // Stock Orange : 850 + 150 = 1000

    expect(afterReverse.Orange.stock).toBe(baseBalances.Orange.stock)
    expect(afterReverse.Orange.liquidite).toBe(baseBalances.Orange.liquidite)
  })

  // Cas nominal : reverse d'un retrait pending
  it('[TC-002-R2] reverse retrait Non Terminées — stock Moov revient à sa valeur initiale', () => {
    const transactionData = {
      type: 'Retrait',
      statut: 'Non Terminées',
      montant: 200,
      reseau: 'Moov',
    }

    // Appliquer : stock Moov : 800 + 200 = 1000
    const afterApply = svc.applyInitialTransactionImpact(baseBalances, transactionData)
    expect(afterApply.Moov.stock).toBe(1000)

    // Reverser : stock Moov : 1000 - 200 = 800
    const afterReverse = svc.reverseInitialTransactionImpact(afterApply, transactionData)
    expect(afterReverse.Moov.stock).toBe(baseBalances.Moov.stock)
  })

  // Asymétrie documentée : reverse sur Validée ne fait RIEN
  // src/services/firestore.js:750 — if (this.isPendingStatus(transactionData.statut)) seulement
  it('[TC-002-R3] reverse retrait Validee — balances inchangees (asymetrie)', () => {
    const transactionData = {
      type: 'Retrait',
      statut: 'Validée',
      montant: 300,
      reseau: 'Moov',
    }

    // Passer des balances quelconques
    const snapshotBefore = JSON.stringify(baseBalances)
    const result = svc.reverseInitialTransactionImpact(baseBalances, transactionData)
    const snapshotAfter = JSON.stringify(result)

    // Le résultat doit être identique aux balances d'entrée
    expect(snapshotAfter).toBe(snapshotBefore)
  })

  // Asymétrie documentée : reverse sur dépôt Validée ne fait RIEN
  it('[TC-002-R4] reverse depot Validee — balances inchangees (asymetrie)', () => {
    const transactionData = {
      type: 'Dépôt',
      statut: 'Validée',
      montant: 200,
      reseau: 'Orange',
    }

    const snapshotBefore = JSON.stringify(baseBalances)
    const result = svc.reverseInitialTransactionImpact(baseBalances, transactionData)
    const snapshotAfter = JSON.stringify(result)

    expect(snapshotAfter).toBe(snapshotBefore)
  })

  // Invariant apply+reverse sur pending : map finale == map initiale
  it('[TC-002-R5] apply puis reverse dépôt Non Terminées — invariant : map finale = map initiale', () => {
    const transactionData = {
      type: 'Dépôt',
      statut: 'Non Terminées',
      montant: 400,
      reseau: 'Orange',
    }

    const afterApply = svc.applyInitialTransactionImpact(baseBalances, transactionData)
    const afterReverse = svc.reverseInitialTransactionImpact(afterApply, transactionData)

    // Comparer réseau par réseau
    for (const network of Object.keys(baseBalances)) {
      expect(afterReverse[network].stock).toBe(baseBalances[network].stock)
      expect(afterReverse[network].liquidite).toBe(baseBalances[network].liquidite)
    }
  })
})
