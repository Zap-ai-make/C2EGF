/**
 * TC-014 — Anomalies d'arrondi, invariants de solde (±1 FCFA) et parseFcfaAmount
 *
 * Comportement à protéger :
 *   1. parseFcfaAmount refuse tout montant non entier positif.
 *   2. Toutes les opérations financières (apply, reverse, settlement) produisent
 *      des soldes exacts, sans écart de ±1 FCFA.
 *   3. Les montants décimaux sont refusés à l'entrée et ne corrompent jamais les soldes.
 *
 * Périmètre audité :
 *   - parseFcfaAmount              (src/utils/fcfaAmount.js)
 *   - adjustBalanceValue           (firestore.js)
 *   - applyLiquidityDelta          (firestore.js)
 *   - applyInitialTransactionImpact (firestore.js)
 *   - reverseInitialTransactionImpact (firestore.js)
 *   - applySettlementImpact        (firestore.js)
 *   - normalizeNetworkBalances     (firestore.js)
 *
 * Invariant universel :
 *   solde_final === solde_initial + Σ(impacts_métier)
 *   Aucun écart de 1 FCFA n'est toléré — un test qui révèle un écart DOIT échouer.
 *
 * Fichiers source : src/services/firestore.js, src/utils/fcfaAmount.js
 * Interdictions : aucun import Firebase, aucun accès réseau.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks Firebase — structure identique à TC-001/TC-013
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
    get: vi.fn(),
    set: vi.fn(),
    invalidate: vi.fn(),
  },
  cacheUtils: {
    invalidatePattern: vi.fn(),
  },
}))

// ---------------------------------------------------------------------------
// Import après mocks
// ---------------------------------------------------------------------------

import { FirestoreService } from '../../src/services/firestore.js'
import { parseFcfaAmount } from '../../src/utils/fcfaAmount.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Balances de référence avec valeurs entières — état neutre pour les tests d'arrondi.
 * Orange est le premier réseau (clé d'ordre d'insertion) : applyLiquidityDelta(+x)
 * y crédite toujours.
 */
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
})

/**
 * Helper : calcule le total des stocks + liquidités sur tous les réseaux.
 */
function totalStock(balances) {
  return Object.values(balances).reduce((s, n) => s + n.stock, 0)
}

function totalLiquidite(balances) {
  return Object.values(balances).reduce((s, n) => s + n.liquidite, 0)
}

// ---------------------------------------------------------------------------
// Groupe TC-014-A — parseFcfaAmount : entrées valides
// ---------------------------------------------------------------------------

describe('TC-014-A — parseFcfaAmount : entrées valides', () => {

  it('[TC-014-A1] "1" → 1', () => {
    expect(parseFcfaAmount('1')).toBe(1)
  })

  it('[TC-014-A2] "10" → 10', () => {
    expect(parseFcfaAmount('10')).toBe(10)
  })

  it('[TC-014-A3] "999" → 999', () => {
    expect(parseFcfaAmount('999')).toBe(999)
  })

  it('[TC-014-A4] "1000" → 1000', () => {
    expect(parseFcfaAmount('1000')).toBe(1000)
  })

  it('[TC-014-A5] "1001" → 1001', () => {
    expect(parseFcfaAmount('1001')).toBe(1001)
  })

  it('[TC-014-A6] 1000 (number) → 1000', () => {
    expect(parseFcfaAmount(1000)).toBe(1000)
  })

  it('[TC-014-A7] "1 000" (espace normal U+0020) → 1000', () => {
    expect(parseFcfaAmount('1 000')).toBe(1000)
  })

  it('[TC-014-A8] "1 000" (espace insécable U+00A0) → 1000', () => {
    expect(parseFcfaAmount('1 000')).toBe(1000)
  })

  it('[TC-014-A9] "1 000" (espace fine insécable U+202F) → 1000', () => {
    expect(parseFcfaAmount('1 000')).toBe(1000)
  })

  it('[TC-014-A10] " 1 000 " (espaces de bord) → 1000', () => {
    expect(parseFcfaAmount(' 1 000 ')).toBe(1000)
  })
})

// ---------------------------------------------------------------------------
// Groupe TC-014-B — parseFcfaAmount : entrées invalides
// ---------------------------------------------------------------------------

describe('TC-014-B — parseFcfaAmount : entrées invalides → null', () => {

  it('[TC-014-B1] "" → null', () => {
    expect(parseFcfaAmount('')).toBeNull()
  })

  it('[TC-014-B2] "abc" → null', () => {
    expect(parseFcfaAmount('abc')).toBeNull()
  })

  it('[TC-014-B3] "0" → null', () => {
    expect(parseFcfaAmount('0')).toBeNull()
  })

  it('[TC-014-B4] "0.0" → null', () => {
    expect(parseFcfaAmount('0.0')).toBeNull()
  })

  it('[TC-014-B5] "-1" → null', () => {
    expect(parseFcfaAmount('-1')).toBeNull()
  })

  it('[TC-014-B6] -1 (number) → null', () => {
    expect(parseFcfaAmount(-1)).toBeNull()
  })

  it('[TC-014-B7] NaN → null', () => {
    expect(parseFcfaAmount(NaN)).toBeNull()
  })

  it('[TC-014-B8] Infinity → null', () => {
    expect(parseFcfaAmount(Infinity)).toBeNull()
  })

  it('[TC-014-B9] "1000.5" → null', () => {
    expect(parseFcfaAmount('1000.5')).toBeNull()
  })

  it('[TC-014-B10] "1000,5" → null', () => {
    expect(parseFcfaAmount('1000,5')).toBeNull()
  })

  it('[TC-014-B11] 1000.5 (number) → null', () => {
    expect(parseFcfaAmount(1000.5)).toBeNull()
  })

  it('[TC-014-B12] "1 000abc" → null', () => {
    expect(parseFcfaAmount('1 000abc')).toBeNull()
  })

  it('[TC-014-B13] "1.000" → null', () => {
    expect(parseFcfaAmount('1.000')).toBeNull()
  })

  it('[TC-014-B14] "1,000" → null', () => {
    expect(parseFcfaAmount('1,000')).toBeNull()
  })

  it('[TC-014-B15] "1e3" (notation scientifique) → null', () => {
    expect(parseFcfaAmount('1e3')).toBeNull()
  })

  it('[TC-014-B16] null → null', () => {
    expect(parseFcfaAmount(null)).toBeNull()
  })

  it('[TC-014-B17] undefined → null', () => {
    expect(parseFcfaAmount(undefined)).toBeNull()
  })

  it('[TC-014-B18] {} → null', () => {
    expect(parseFcfaAmount({})).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Groupe TC-014-C — Garde IEEE 754 (montants décimaux refusés par parseFcfaAmount)
// ---------------------------------------------------------------------------

describe('TC-014-C — Garde IEEE 754 : décimaux refusés par parseFcfaAmount', () => {
  /**
   * Le FCFA est une devise entière. parseFcfaAmount doit rejeter tout décimal.
   * Cette garde empêche la dérive IEEE 754 en amont des calculs financiers.
   */

  it('[TC-014-C1] parseFcfaAmount("0.1") === null', () => {
    expect(parseFcfaAmount('0.1')).toBeNull()
  })

  it('[TC-014-C2] parseFcfaAmount(0.1) === null', () => {
    expect(parseFcfaAmount(0.1)).toBeNull()
  })

  it('[TC-014-C3] montant décimal 0.1 refusé par parseFcfaAmount', () => {
    expect(parseFcfaAmount('0.1')).toBeNull()
    expect(parseFcfaAmount(0.1)).toBeNull()
    expect(parseFcfaAmount('0,1')).toBeNull()
  })

  it('[TC-014-C4] parseFcfaAmount("100.9") === null', () => {
    expect(parseFcfaAmount('100.9')).toBeNull()
  })

  it('[TC-014-C5] parseFcfaAmount(100.9) === null', () => {
    expect(parseFcfaAmount(100.9)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Groupe TC-014-D — Cascade de liquidité (applyLiquidityDelta) — entiers
// ---------------------------------------------------------------------------

describe('TC-014-D — Cascade de liquidité (applyLiquidityDelta)', () => {

  it('[TC-014-D1] delta positif — tout crédité sur Orange (premier réseau)', () => {
    const delta = 1234
    const result = svc.applyLiquidityDelta(baseBalances, delta)
    expect(result.Orange.liquidite).toBe(baseBalances.Orange.liquidite + delta)
    // Les autres réseaux inchangés
    expect(result.Moov.liquidite).toBe(baseBalances.Moov.liquidite)
    expect(result.Telecel.liquidite).toBe(baseBalances.Telecel.liquidite)
  })

  it('[TC-014-D2] delta négatif exact = Orange.liquidite — Orange épuisé exactement', () => {
    const delta = -5000
    const result = svc.applyLiquidityDelta(baseBalances, delta)
    expect(result.Orange.liquidite).toBe(0)
    expect(result.Moov.liquidite).toBe(3000)
  })

  it('[TC-014-D3] delta négatif > Orange.liquidite — cascade sur Moov, conservation exacte', () => {
    const delta = -6000
    const result = svc.applyLiquidityDelta(baseBalances, delta)
    expect(result.Orange.liquidite).toBe(0)
    expect(result.Moov.liquidite).toBe(2000)
    expect(result.Telecel.liquidite).toBe(2000)

    const totalAvant = totalLiquidite(baseBalances)
    const totalApres = totalLiquidite(result)
    expect(totalApres).toBe(totalAvant - 6000)
  })

  it('[TC-014-D4] cascade complète sur 3 réseaux — conservation exacte de la liquidité', () => {
    const delta = -8500
    const result = svc.applyLiquidityDelta(baseBalances, delta)
    expect(result.Orange.liquidite).toBe(0)
    expect(result.Moov.liquidite).toBe(0)
    expect(result.Telecel.liquidite).toBe(1500)
    expect(result.Coris.liquidite).toBe(1000)

    const totalAvant = totalLiquidite(baseBalances)
    const totalApres = totalLiquidite(result)
    expect(totalApres).toBe(totalAvant - 8500)
  })

  it('[TC-014-D5] cascade totale sur tous les réseaux — liquidité totale = 0', () => {
    const delta = -11500
    const result = svc.applyLiquidityDelta(baseBalances, delta)
    expect(totalLiquidite(result)).toBe(0)
    for (const network of Object.keys(baseBalances)) {
      expect(result[network].liquidite).toBe(0)
    }
  })

  it('[TC-014-D6] delta zéro — balances inchangées', () => {
    const result = svc.applyLiquidityDelta(baseBalances, 0)
    expect(result.Orange.liquidite).toBe(baseBalances.Orange.liquidite)
    expect(totalLiquidite(result)).toBe(totalLiquidite(baseBalances))
  })

  it('[TC-014-D7] delta négatif = 1 sur liquidité suffisante — précision exacte', () => {
    const result = svc.applyLiquidityDelta(baseBalances, -1)
    expect(result.Orange.liquidite).toBe(4999)
    expect(totalLiquidite(result)).toBe(totalLiquidite(baseBalances) - 1)
  })
})

// ---------------------------------------------------------------------------
// Groupe TC-014-E — Séquences complètes apply + settlement (entiers)
// ---------------------------------------------------------------------------

describe('TC-014-E — Séquences complètes apply + settlement', () => {

  it('[TC-014-E1] dépôt pending 500 Orange → settlement encaissé Orange Money — stock total conservé', () => {
    const draftData = {
      type: 'Dépôt',
      statut: 'Non Terminées',
      montant: 500,
      reseau: 'Orange',
    }
    const historyData = {
      ...draftData,
      statut: 'Encaissé par Orange Money',
      paymentMethod: 'Orange Money',
      effectiveNetwork: 'Orange',
      validatedAt: '2026-06-19T10:00:00.000Z',
    }

    const afterPending = svc.applyInitialTransactionImpact(baseBalances, draftData)
    expect(afterPending.Orange.stock).toBe(9500)

    const afterSettlement = svc.applySettlementImpact(afterPending, historyData, 'Orange Money')
    expect(afterSettlement.Orange.stock).toBe(10000)

    expect(totalStock(afterSettlement)).toBe(totalStock(baseBalances))
    expect(totalLiquidite(afterSettlement)).toBe(totalLiquidite(baseBalances))
  })

  it('[TC-014-E2] retrait pending 300 Moov → settlement payé par Cash — stock/liquidité corrects', () => {
    const draftData = {
      type: 'Retrait',
      statut: 'Non Terminées',
      montant: 300,
      reseau: 'Moov',
    }
    const historyData = {
      ...draftData,
      statut: 'Payé par Cash',
      paymentMethod: 'Cash',
      effectiveNetwork: 'Liquidite',
      validatedAt: '2026-06-19T10:00:00.000Z',
    }

    const afterPending = svc.applyInitialTransactionImpact(baseBalances, draftData)
    expect(afterPending.Moov.stock).toBe(8300)

    const afterSettlement = svc.applySettlementImpact(afterPending, historyData, 'Cash')
    expect(afterSettlement.Orange.liquidite).toBe(4700)
    expect(afterSettlement.Moov.stock).toBe(8300)
  })

  it('[TC-014-E3] crédit pending 200 Telecel → settlement remboursé Moov Money — exact', () => {
    const draftData = {
      type: 'Crédit',
      statut: 'Non Terminées',
      montant: 200,
      reseau: 'Telecel',
    }
    const historyData = {
      ...draftData,
      statut: 'Remboursé par Moov Money',
      paymentMethod: 'Moov Money',
      effectiveNetwork: 'Moov',
      validatedAt: '2026-06-19T10:00:00.000Z',
    }

    const afterPending = svc.applyInitialTransactionImpact(baseBalances, draftData)
    expect(afterPending.Telecel.stock).toBe(5800)

    const afterSettlement = svc.applySettlementImpact(afterPending, historyData, 'Moov Money')
    expect(afterSettlement.Moov.stock).toBe(8200)
    expect(afterSettlement.Telecel.stock).toBe(5800)
  })

  it('[TC-014-E4] séquence : dépôt pending → annulation (reverse) — balances restituées exactement', () => {
    const draftData = {
      type: 'Dépôt',
      statut: 'Non Terminées',
      montant: 750,
      reseau: 'Coris',
    }

    const afterPending = svc.applyInitialTransactionImpact(baseBalances, draftData)
    expect(afterPending.Coris.stock).toBe(3250)

    const afterReverse = svc.reverseInitialTransactionImpact(afterPending, draftData)
    for (const network of Object.keys(baseBalances)) {
      expect(afterReverse[network].stock).toBe(baseBalances[network].stock)
      expect(afterReverse[network].liquidite).toBe(baseBalances[network].liquidite)
    }
  })
})

// ---------------------------------------------------------------------------
// Groupe TC-014-F — "1 000" ne produit jamais 1 (invariant espace-milliers)
// ---------------------------------------------------------------------------

describe('TC-014-F — "1 000" ne produit jamais 1', () => {

  it('[TC-014-F1] parseFcfaAmount("1 000") === 1000, jamais 1', () => {
    const amount = parseFcfaAmount('1 000')
    expect(amount).toBe(1000)
    expect(amount).not.toBe(1)
  })

  it('[TC-014-F2] parseFcfaAmount("10 000") === 10000, jamais 10', () => {
    const amount = parseFcfaAmount('10 000')
    expect(amount).toBe(10000)
    expect(amount).not.toBe(10)
  })

  it('[TC-014-F3] parseFcfaAmount("1 000") === 1000 (U+00A0), jamais 1', () => {
    const amount = parseFcfaAmount('1 000')
    expect(amount).toBe(1000)
    expect(amount).not.toBe(1)
  })

  it('[TC-014-F4] parseFcfaAmount("1 000") === 1000 (U+202F), jamais 1', () => {
    const amount = parseFcfaAmount('1 000')
    expect(amount).toBe(1000)
    expect(amount).not.toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Groupe TC-014-G — Séquences complètes création + modification + settlement
// ---------------------------------------------------------------------------

describe('TC-014-G — Séquence complète création + modification + settlement', () => {

  it('[TC-014-G1] dépôt 400→600 Orange, settlement Moov Money — état final exact', () => {
    const draft400 = { type: 'Dépôt', statut: 'Non Terminées', montant: 400, reseau: 'Orange' }
    const draft600 = { type: 'Dépôt', statut: 'Non Terminées', montant: 600, reseau: 'Orange' }
    const historyData = {
      type: 'Dépôt',
      statut: 'Encaissé par Moov Money',
      montant: 600,
      reseau: 'Orange',
      paymentMethod: 'Moov Money',
      effectiveNetwork: 'Moov',
      validatedAt: '2026-06-19T10:00:00.000Z',
    }

    const afterCreate = svc.applyInitialTransactionImpact(baseBalances, draft400)
    const afterRev = svc.reverseInitialTransactionImpact(afterCreate, draft400)
    const afterMod = svc.applyInitialTransactionImpact(afterRev, draft600)
    expect(afterMod.Orange.stock).toBe(9400)

    const afterSettlement = svc.applySettlementImpact(afterMod, historyData, 'Moov Money')
    expect(afterSettlement.Orange.stock).toBe(9400)
    expect(afterSettlement.Moov.stock).toBe(8600)

    expect(totalLiquidite(afterSettlement)).toBe(totalLiquidite(baseBalances))
  })

  it('[TC-014-G2] retrait 200→500 Moov, settlement Cash — liquidité diminuée exactement', () => {
    const draft200 = { type: 'Retrait', statut: 'Non Terminées', montant: 200, reseau: 'Moov' }
    const draft500 = { type: 'Retrait', statut: 'Non Terminées', montant: 500, reseau: 'Moov' }
    const historyData = {
      type: 'Retrait',
      statut: 'Payé par Cash',
      montant: 500,
      reseau: 'Moov',
      paymentMethod: 'Cash',
      effectiveNetwork: 'Liquidite',
      validatedAt: '2026-06-19T10:00:00.000Z',
    }

    const afterCreate = svc.applyInitialTransactionImpact(baseBalances, draft200)
    const afterRev = svc.reverseInitialTransactionImpact(afterCreate, draft200)
    const afterMod = svc.applyInitialTransactionImpact(afterRev, draft500)
    expect(afterMod.Moov.stock).toBe(8500)

    const afterSettlement = svc.applySettlementImpact(afterMod, historyData, 'Cash')
    expect(afterSettlement.Orange.liquidite).toBe(4500)
    expect(afterSettlement.Moov.stock).toBe(8500)

    expect(totalStock(afterSettlement)).toBe(totalStock(afterMod))
  })
})

// ---------------------------------------------------------------------------
// Groupe TC-014-H — Modification de draft (updateDraft : reverse + re-apply)
// ---------------------------------------------------------------------------

describe('TC-014-H — Modification de draft (updateDraft : reverse + re-apply)', () => {

  it('[TC-014-H1] modif dépôt 500→700 Orange — solde final = base - 700 exactement', () => {
    const originalDraft = { type: 'Dépôt', statut: 'Non Terminées', montant: 500, reseau: 'Orange' }
    const updatedDraft = { type: 'Dépôt', statut: 'Non Terminées', montant: 700, reseau: 'Orange' }

    const afterOriginalApply = svc.applyInitialTransactionImpact(baseBalances, originalDraft)
    expect(afterOriginalApply.Orange.stock).toBe(9500)

    const afterReverse = svc.reverseInitialTransactionImpact(afterOriginalApply, originalDraft)
    expect(afterReverse.Orange.stock).toBe(10000)

    const afterNewApply = svc.applyInitialTransactionImpact(afterReverse, updatedDraft)
    expect(afterNewApply.Orange.stock).toBe(9300)

    const directApply = svc.applyInitialTransactionImpact(baseBalances, updatedDraft)
    expect(afterNewApply.Orange.stock).toBe(directApply.Orange.stock)
  })

  it('[TC-014-H2] modif retrait 200→400 Moov — solde final = base + 400 exactement', () => {
    const originalDraft = { type: 'Retrait', statut: 'Non Terminées', montant: 200, reseau: 'Moov' }
    const updatedDraft = { type: 'Retrait', statut: 'Non Terminées', montant: 400, reseau: 'Moov' }

    const afterOriginalApply = svc.applyInitialTransactionImpact(baseBalances, originalDraft)
    expect(afterOriginalApply.Moov.stock).toBe(8200)

    const afterReverse = svc.reverseInitialTransactionImpact(afterOriginalApply, originalDraft)
    expect(afterReverse.Moov.stock).toBe(8000)

    const afterNewApply = svc.applyInitialTransactionImpact(afterReverse, updatedDraft)
    expect(afterNewApply.Moov.stock).toBe(8400)

    const directApply = svc.applyInitialTransactionImpact(baseBalances, updatedDraft)
    expect(afterNewApply.Moov.stock).toBe(directApply.Moov.stock)
  })

  it('[TC-014-H3] modif crédit 300→150 Telecel — solde final = base - 150 exactement', () => {
    const originalDraft = { type: 'Crédit', statut: 'Non Terminées', montant: 300, reseau: 'Telecel' }
    const updatedDraft = { type: 'Crédit', statut: 'Non Terminées', montant: 150, reseau: 'Telecel' }

    const afterOriginalApply = svc.applyInitialTransactionImpact(baseBalances, originalDraft)
    expect(afterOriginalApply.Telecel.stock).toBe(5700)

    const afterReverse = svc.reverseInitialTransactionImpact(afterOriginalApply, originalDraft)
    expect(afterReverse.Telecel.stock).toBe(6000)

    const afterNewApply = svc.applyInitialTransactionImpact(afterReverse, updatedDraft)
    expect(afterNewApply.Telecel.stock).toBe(5850)

    const directApply = svc.applyInitialTransactionImpact(baseBalances, updatedDraft)
    expect(afterNewApply.Telecel.stock).toBe(directApply.Telecel.stock)
  })

  it('[TC-014-H4] modif réseau : dépôt Orange → Moov (même montant 1000) — impacts sur bons réseaux', () => {
    const originalDraft = { type: 'Dépôt', statut: 'Non Terminées', montant: 1000, reseau: 'Orange' }
    const updatedDraft = { type: 'Dépôt', statut: 'Non Terminées', montant: 1000, reseau: 'Moov' }

    const afterOriginalApply = svc.applyInitialTransactionImpact(baseBalances, originalDraft)
    expect(afterOriginalApply.Orange.stock).toBe(9000)

    const afterReverse = svc.reverseInitialTransactionImpact(afterOriginalApply, originalDraft)
    expect(afterReverse.Orange.stock).toBe(10000)

    const afterNewApply = svc.applyInitialTransactionImpact(afterReverse, updatedDraft)
    expect(afterNewApply.Orange.stock).toBe(10000)
    expect(afterNewApply.Moov.stock).toBe(7000)
  })

  it('[TC-014-H5] double modification sans écart — trois passes reverse+apply', () => {
    const draft1 = { type: 'Dépôt', statut: 'Non Terminées', montant: 500, reseau: 'Sank' }
    const draft2 = { type: 'Dépôt', statut: 'Non Terminées', montant: 700, reseau: 'Sank' }
    const draft3 = { type: 'Dépôt', statut: 'Non Terminées', montant: 300, reseau: 'Sank' }

    const after1 = svc.applyInitialTransactionImpact(baseBalances, draft1)
    expect(after1.Sank.stock).toBe(1500)

    const afterRev1 = svc.reverseInitialTransactionImpact(after1, draft1)
    const after2 = svc.applyInitialTransactionImpact(afterRev1, draft2)
    expect(after2.Sank.stock).toBe(1300)

    const afterRev2 = svc.reverseInitialTransactionImpact(after2, draft2)
    const after3 = svc.applyInitialTransactionImpact(afterRev2, draft3)
    expect(after3.Sank.stock).toBe(1700)

    const directApply = svc.applyInitialTransactionImpact(baseBalances, draft3)
    expect(after3.Sank.stock).toBe(directApply.Sank.stock)
  })
})

// ---------------------------------------------------------------------------
// Groupe TC-014-I — Transactions successives (accumulation sans dérive)
// ---------------------------------------------------------------------------

describe('TC-014-I — Transactions successives (accumulation sans dérive)', () => {

  it('[TC-014-I1] 10 dépôts pending identiques de 100 — stock diminue de 1000 exactement', () => {
    const tx = { type: 'Dépôt', statut: 'Non Terminées', montant: 100, reseau: 'Orange' }
    let balances = baseBalances

    for (let i = 0; i < 10; i++) {
      balances = svc.applyInitialTransactionImpact(balances, tx)
    }

    expect(balances.Orange.stock).toBe(baseBalances.Orange.stock - 1000)
  })

  it('[TC-014-I2] 10 retraits pending identiques de 100 — stock augmente de 1000 exactement', () => {
    const tx = { type: 'Retrait', statut: 'Non Terminées', montant: 100, reseau: 'Moov' }
    let balances = baseBalances

    for (let i = 0; i < 10; i++) {
      balances = svc.applyInitialTransactionImpact(balances, tx)
    }

    expect(balances.Moov.stock).toBe(baseBalances.Moov.stock + 1000)
  })

  it('[TC-014-I3] 5 apply + 5 reverse symétriques — retour exact à l\'état initial', () => {
    const tx = { type: 'Dépôt', statut: 'Non Terminées', montant: 200, reseau: 'Coris' }
    let balances = baseBalances

    for (let i = 0; i < 5; i++) {
      balances = svc.applyInitialTransactionImpact(balances, tx)
    }
    for (let i = 0; i < 5; i++) {
      balances = svc.reverseInitialTransactionImpact(balances, tx)
    }

    for (const network of Object.keys(baseBalances)) {
      expect(balances[network].stock).toBe(baseBalances[network].stock)
      expect(balances[network].liquidite).toBe(baseBalances[network].liquidite)
    }
  })

  it('[TC-014-I4] transactions mixtes successives — invariant total conservation', () => {
    const txs = [
      { type: 'Dépôt',   statut: 'Non Terminées', montant: 100, reseau: 'Orange' },
      { type: 'Retrait', statut: 'Non Terminées', montant: 200, reseau: 'Moov' },
      { type: 'Crédit',  statut: 'Non Terminées', montant:  50, reseau: 'Telecel' },
      { type: 'Dépôt',   statut: 'Non Terminées', montant: 300, reseau: 'Coris' },
      { type: 'Retrait', statut: 'Non Terminées', montant: 150, reseau: 'Sank' },
    ]

    let balances = baseBalances
    for (const tx of txs) {
      balances = svc.applyInitialTransactionImpact(balances, tx)
    }

    expect(totalLiquidite(balances)).toBe(totalLiquidite(baseBalances))

    const expectedStockTotal = totalStock(baseBalances) - 100
    expect(totalStock(balances)).toBe(expectedStockTotal)
  })
})

// ---------------------------------------------------------------------------
// Groupe TC-014-J — normalizeNetworkBalances (conversion et plancher)
// ---------------------------------------------------------------------------

describe('TC-014-J — normalizeNetworkBalances (conversion et plancher zéro)', () => {

  it('[TC-014-J1] valeurs numériques valides — retournées telles quelles', () => {
    const data = {
      balances: {
        Orange: { stock: 1000, liquidite: 500 },
        Moov:   { stock:  800, liquidite: 300 },
      }
    }
    const result = svc.normalizeNetworkBalances(data)
    expect(result.Orange.stock).toBe(1000)
    expect(result.Orange.liquidite).toBe(500)
    expect(result.Moov.stock).toBe(800)
  })

  it('[TC-014-J2] valeurs comme chaînes — converties exactement sans arrondi', () => {
    const data = {
      balances: {
        Orange: { stock: '9999', liquidite: '5000' },
        Moov:   { stock: '1234', liquidite: '567' },
      }
    }
    const result = svc.normalizeNetworkBalances(data)
    expect(result.Orange.stock).toBe(9999)
    expect(result.Orange.liquidite).toBe(5000)
    expect(result.Moov.stock).toBe(1234)
  })

  it('[TC-014-J3] valeurs négatives — plancher à 0 (Math.max)', () => {
    const data = {
      balances: {
        Orange: { stock: -100, liquidite: -50 },
      }
    }
    const result = svc.normalizeNetworkBalances(data)
    expect(result.Orange.stock).toBe(0)
    expect(result.Orange.liquidite).toBe(0)
  })

  it('[TC-014-J4] valeurs null/undefined — traitées comme 0', () => {
    const data = {
      balances: {
        Orange: { stock: null, liquidite: undefined },
      }
    }
    const result = svc.normalizeNetworkBalances(data)
    expect(result.Orange.stock).toBe(0)
    expect(result.Orange.liquidite).toBe(0)
  })

  it('[TC-014-J5] réseau inconnu dans Firestore — réseaux par défaut complétés', () => {
    const data = {
      balances: {
        Orange: { stock: 1000, liquidite: 500 },
      }
    }
    const result = svc.normalizeNetworkBalances(data)
    expect(result.Moov.stock).toBe(0)
    expect(result.Moov.liquidite).toBe(0)
    expect(result.Orange.stock).toBe(1000)
  })
})

// ---------------------------------------------------------------------------
// Groupe TC-014-K — Invariant solde final = solde initial + Σ impacts métier
// ---------------------------------------------------------------------------

describe('TC-014-K — Invariant solde final = solde initial + Σ impacts métier', () => {

  it('[TC-014-K1] séquence 3 dépôts pending 333+334+333 = 1000 — conservation exacte', () => {
    const tx1 = { type: 'Dépôt', statut: 'Non Terminées', montant: 333, reseau: 'Orange' }
    const tx2 = { type: 'Dépôt', statut: 'Non Terminées', montant: 334, reseau: 'Orange' }
    const tx3 = { type: 'Dépôt', statut: 'Non Terminées', montant: 333, reseau: 'Orange' }

    const after1 = svc.applyInitialTransactionImpact(baseBalances, tx1)
    const after2 = svc.applyInitialTransactionImpact(after1, tx2)
    const after3 = svc.applyInitialTransactionImpact(after2, tx3)

    expect(after3.Orange.stock).toBe(baseBalances.Orange.stock - 1000)
  })

  it('[TC-014-K2] apply validé + settlement = total stock conservé (dépôt)', () => {
    const tx = { type: 'Dépôt', statut: 'Validée', montant: 1001, reseau: 'Moov' }
    const result = svc.applyInitialTransactionImpact(baseBalances, tx)

    const totalAvant = totalStock(baseBalances) + totalLiquidite(baseBalances)
    const totalApres = totalStock(result) + totalLiquidite(result)

    expect(totalApres).toBe(totalAvant)
  })

  it('[TC-014-K3] retrait validé — total (stock+liquidité) conservé', () => {
    const tx = { type: 'Retrait', statut: 'Validée', montant: 999, reseau: 'Orange' }
    const result = svc.applyInitialTransactionImpact(baseBalances, tx)

    const totalAvant = totalStock(baseBalances) + totalLiquidite(baseBalances)
    const totalApres = totalStock(result) + totalLiquidite(result)

    expect(totalApres).toBe(totalAvant)
  })

  it('[TC-014-K4] apply(pending) + settlement → total (stock+liquidité) conservé (dépôt via draft)', () => {
    const draftData = { type: 'Dépôt', statut: 'Non Terminées', montant: 1000, reseau: 'Orange' }
    const historyData = {
      ...draftData,
      paymentMethod: 'Moov Money',
      effectiveNetwork: 'Moov',
      validatedAt: '2026-06-19T10:00:00.000Z',
    }

    const afterPending = svc.applyInitialTransactionImpact(baseBalances, draftData)
    const afterSettlement = svc.applySettlementImpact(afterPending, historyData, 'Moov Money')

    const totalAvant = totalStock(baseBalances) + totalLiquidite(baseBalances)
    const totalApres = totalStock(afterSettlement) + totalLiquidite(afterSettlement)

    expect(totalApres).toBe(totalAvant)
  })

  it('[TC-014-K5] apply(pending) + reverse(pending) = identité exacte pour montant 1 FCFA', () => {
    const tx = { type: 'Dépôt', statut: 'Non Terminées', montant: 1, reseau: 'Sank' }
    const afterApply = svc.applyInitialTransactionImpact(baseBalances, tx)
    expect(afterApply.Sank.stock).toBe(baseBalances.Sank.stock - 1)

    const afterReverse = svc.reverseInitialTransactionImpact(afterApply, tx)
    expect(afterReverse.Sank.stock).toBe(baseBalances.Sank.stock)
  })
})
