/**
 * TC-013 — reverseHistoryTransactionImpact (Lot 3B)
 *
 * Comportement à capturer :
 *   Trois chemins menant à history, trois stratégies de renversement :
 *
 *   Path 1 — direct (addTransaction, statut 'Validée', pas de paymentMethod ni validatedAt)
 *     → annuler applyInitialTransactionImpact(Validée)
 *
 *   Path 2 avec règlement (validateTransaction avec paymentMethod)
 *     → annuler settlement puis annuler l'impact pending
 *
 *   Path 2 sans règlement (validateTransaction sans paymentMethod, validatedAt présent)
 *     → annuler uniquement l'impact pending
 *
 * Gardes :
 *   - statut 'Annulée' → erreur (double-annulation impossible)
 *   - données incomplètes (montant nul, reseau absent) → erreur
 *
 * Invariant :
 *   apply + reverse = identité (balances initiales restituées exactement)
 *
 * Fichier source : src/services/firestore.js — reverseHistoryTransactionImpact,
 *                  _reversePendingOnlyImpact, _reverseDirectValidatedImpact
 * Interdictions   : aucun import Firebase, aucun accès réseau.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest'

// --- Mocks Firebase ---

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

import { FirestoreService } from '../../src/services/firestore.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseBalances = {
  Orange:  { stock: 2000, liquidite: 1000 },
  Moov:    { stock: 1500, liquidite:  600 },
  Telecel: { stock: 1000, liquidite:  400 },
  Coris:   { stock:  500, liquidite:  200 },
  Sank:    { stock:  300, liquidite:  100 },
}

let svc

beforeAll(() => {
  svc = new FirestoreService()
})

// ---------------------------------------------------------------------------

describe('TC-013-A — Path 1 direct (statut Validée, sans paymentMethod ni validatedAt)', () => {

  it('[TC-013-A1] dépôt direct Validée 500 Orange — reverse restitue les balances initiales', () => {
    const historyData = {
      type: 'Dépôt',
      statut: 'Validée',
      montant: 500,
      reseau: 'Orange',
    }

    // Simuler l'impact direct : stock[Orange] -500, liquidite[Orange] +500
    const afterApply = svc.applyInitialTransactionImpact(baseBalances, historyData)
    expect(afterApply.Orange.stock).toBe(1500)       // 2000 - 500
    expect(afterApply.Orange.liquidite).toBe(1500)   // 1000 + 500

    // Reverse doit restituer exactement baseBalances
    const afterReverse = svc.reverseHistoryTransactionImpact(afterApply, historyData)
    for (const network of Object.keys(baseBalances)) {
      expect(afterReverse[network].stock).toBe(baseBalances[network].stock)
      expect(afterReverse[network].liquidite).toBe(baseBalances[network].liquidite)
    }
  })

  it('[TC-013-A2] Path 1 Retrait direct Validée — lève une erreur (répartition liquidité inconnue)', () => {
    const historyData = {
      type: 'Retrait',
      statut: 'Validée',
      montant: 300,
      reseau: 'Moov',
      paymentMethod: null,
      // validatedAt absent
    }
    expect(() => svc.reverseHistoryTransactionImpact(baseBalances, historyData)).toThrow(
      'Renversement impossible'
    )
  })

  it('[TC-013-A3] dépôt direct réseau Moov — liquidité ajoutée sur Orange (premier réseau), reverse correct', () => {
    const historyData = {
      type: 'Dépôt',
      statut: 'Validée',
      montant: 200,
      reseau: 'Moov',
    }

    const afterApply = svc.applyInitialTransactionImpact(baseBalances, historyData)
    expect(afterApply.Moov.stock).toBe(1300)          // 1500 - 200
    expect(afterApply.Orange.liquidite).toBe(1200)    // 1000 + 200 (premier réseau)

    const afterReverse = svc.reverseHistoryTransactionImpact(afterApply, historyData)
    for (const network of Object.keys(baseBalances)) {
      expect(afterReverse[network].stock).toBe(baseBalances[network].stock)
      expect(afterReverse[network].liquidite).toBe(baseBalances[network].liquidite)
    }
  })
})

// ---------------------------------------------------------------------------

describe('TC-013-B — Path 2 avec règlement (paymentMethod présent)', () => {

  it('[TC-013-B1] dépôt via draft, encaissé par Orange Money (effectiveNetwork Orange) — reverse restitue les balances', () => {
    /**
     * Impact:
     *   Draft creation (pending Dépôt Moov 300): stock[Moov] -= 300
     *   Settlement (Dépôt, Orange Money → 'Orange'): stock[Orange] += 300
     * État attendu après ces deux impacts (appliqués manuellement sur baseBalances) :
     *   stock[Moov] = 1200, stock[Orange] = 2300
     */
    const historyData = {
      type: 'Dépôt',
      statut: 'Encaissé par Orange Money',
      montant: 300,
      reseau: 'Moov',
      paymentMethod: 'Orange Money',
      effectiveNetwork: 'Orange',
      validatedAt: '2026-06-18T10:00:00.000Z',
    }

    // Appliquer manuellement l'impact pending + settlement pour partir d'un état cohérent
    const afterPending = svc.adjustBalanceValue(baseBalances, 'Moov', 'stock', -300)
    const afterSettlement = svc.adjustBalanceValue(afterPending, 'Orange', 'stock', 300)
    expect(afterSettlement.Moov.stock).toBe(1200)     // 1500 - 300
    expect(afterSettlement.Orange.stock).toBe(2300)   // 2000 + 300

    // Reverse : settlement puis pending
    const afterReverse = svc.reverseHistoryTransactionImpact(afterSettlement, historyData)
    for (const network of Object.keys(baseBalances)) {
      expect(afterReverse[network].stock).toBe(baseBalances[network].stock)
      expect(afterReverse[network].liquidite).toBe(baseBalances[network].liquidite)
    }
  })

  it('[TC-013-B2] retrait via draft, payé par Cash (effectiveNetwork Liquidite) — reverse restitue les balances', () => {
    /**
     * Impact:
     *   Draft creation (pending Retrait Orange 400): stock[Orange] += 400
     *   Settlement (Retrait, Cash → 'Liquidite'): applyLiquidityDelta(-400)
     *     → Orange.liquidite 1000 → 600
     */
    const historyData = {
      type: 'Retrait',
      statut: 'Payé par Cash',
      montant: 400,
      reseau: 'Orange',
      paymentMethod: 'Cash',
      effectiveNetwork: 'Liquidite',
      validatedAt: '2026-06-18T10:00:00.000Z',
    }

    const afterPending = svc.adjustBalanceValue(baseBalances, 'Orange', 'stock', 400)
    const afterSettlement = svc.applyLiquidityDelta(afterPending, -400)
    expect(afterSettlement.Orange.stock).toBe(2400)   // 2000 + 400
    expect(afterSettlement.Orange.liquidite).toBe(600) // 1000 - 400

    const afterReverse = svc.reverseHistoryTransactionImpact(afterSettlement, historyData)
    for (const network of Object.keys(baseBalances)) {
      expect(afterReverse[network].stock).toBe(baseBalances[network].stock)
      expect(afterReverse[network].liquidite).toBe(baseBalances[network].liquidite)
    }
  })

  it('[TC-013-B3] crédit via draft, remboursé par Moov Money (effectiveNetwork Moov) — reverse restitue les balances', () => {
    /**
     * Impact:
     *   Draft creation (pending Crédit Telecel 150): stock[Telecel] -= 150
     *   Settlement (Crédit, Moov Money → 'Moov'): stock[Moov] += 150
     */
    const historyData = {
      type: 'Crédit',
      statut: 'Remboursé par Moov Money',
      montant: 150,
      reseau: 'Telecel',
      paymentMethod: 'Moov Money',
      effectiveNetwork: 'Moov',
      validatedAt: '2026-06-18T10:00:00.000Z',
    }

    const afterPending = svc.adjustBalanceValue(baseBalances, 'Telecel', 'stock', -150)
    const afterSettlement = svc.adjustBalanceValue(afterPending, 'Moov', 'stock', 150)
    expect(afterSettlement.Telecel.stock).toBe(850)   // 1000 - 150
    expect(afterSettlement.Moov.stock).toBe(1650)     // 1500 + 150

    const afterReverse = svc.reverseHistoryTransactionImpact(afterSettlement, historyData)
    for (const network of Object.keys(baseBalances)) {
      expect(afterReverse[network].stock).toBe(baseBalances[network].stock)
      expect(afterReverse[network].liquidite).toBe(baseBalances[network].liquidite)
    }
  })
})

// ---------------------------------------------------------------------------

describe('TC-013-C — Path 2 sans règlement (validatedAt présent, pas de paymentMethod)', () => {

  it('[TC-013-C1] dépôt via draft validé sans paiement (statut Validée + validatedAt) — reverse restitue stock uniquement', () => {
    /**
     * Impact:
     *   Draft creation (pending Dépôt Coris 250): stock[Coris] -= 250
     *   Validation sans paymentMethod : nextBalances = currentBalances (pas de settlement)
     */
    const historyData = {
      type: 'Dépôt',
      statut: 'Validée',
      montant: 250,
      reseau: 'Coris',
      paymentMethod: null,
      effectiveNetwork: 'Coris',
      validatedAt: '2026-06-18T10:00:00.000Z',
    }

    const afterPending = svc.adjustBalanceValue(baseBalances, 'Coris', 'stock', -250)
    expect(afterPending.Coris.stock).toBe(250) // 500 - 250

    const afterReverse = svc.reverseHistoryTransactionImpact(afterPending, historyData)
    // stock Coris restitué
    expect(afterReverse.Coris.stock).toBe(500)
    // liquidité inchangée dans toute la séquence
    for (const network of Object.keys(baseBalances)) {
      expect(afterReverse[network].liquidite).toBe(baseBalances[network].liquidite)
    }
  })

  it('[TC-013-C2] retrait via draft validé sans paiement — reverse restitue stock uniquement', () => {
    const historyData = {
      type: 'Retrait',
      statut: 'Validée',
      montant: 100,
      reseau: 'Sank',
      paymentMethod: null,
      effectiveNetwork: 'Sank',
      validatedAt: '2026-06-18T10:00:00.000Z',
    }

    const afterPending = svc.adjustBalanceValue(baseBalances, 'Sank', 'stock', 100)
    expect(afterPending.Sank.stock).toBe(400) // 300 + 100

    const afterReverse = svc.reverseHistoryTransactionImpact(afterPending, historyData)
    expect(afterReverse.Sank.stock).toBe(300)
    for (const network of Object.keys(baseBalances)) {
      expect(afterReverse[network].liquidite).toBe(baseBalances[network].liquidite)
    }
  })
})

// ---------------------------------------------------------------------------

describe('TC-013-D — Gardes', () => {

  it('[TC-013-D1] statut "Annulée" — lève une erreur (double-annulation impossible)', () => {
    const historyData = {
      type: 'Dépôt',
      statut: 'Annulée',
      montant: 500,
      reseau: 'Orange',
    }
    expect(() => svc.reverseHistoryTransactionImpact(baseBalances, historyData)).toThrow(
      'déjà annulée'
    )
  })

  it('[TC-013-D2] montant nul — lève une erreur', () => {
    const historyData = {
      type: 'Dépôt',
      statut: 'Validée',
      montant: 0,
      reseau: 'Orange',
    }
    expect(() => svc.reverseHistoryTransactionImpact(baseBalances, historyData)).toThrow(
      'Le montant doit être un entier strictement positif'
    )
  })

  it('[TC-013-D3] reseau absent — lève une erreur', () => {
    const historyData = {
      type: 'Dépôt',
      statut: 'Validée',
      montant: 100,
      reseau: undefined,
    }
    expect(() => svc.reverseHistoryTransactionImpact(baseBalances, historyData)).toThrow(
      'incomplètes'
    )
  })

  it('[TC-013-D-type-inconnu] type inconnu lève une erreur explicite', () => {
    const historyData = {
      type: 'TypeInconnu',
      statut: 'Validée',
      montant: 100,
      reseau: 'Orange',
      paymentMethod: null,
    }
    expect(() => svc.reverseHistoryTransactionImpact(baseBalances, historyData)).toThrow(
      'Type de transaction non reconnu'
    )
  })

  it('[TC-013-D-montant-decimal] montant décimal lève une erreur', () => {
    const historyData = {
      type: 'Dépôt',
      statut: 'Validée',
      montant: 100.5,
      reseau: 'Orange',
      paymentMethod: null,
    }
    expect(() => svc.reverseHistoryTransactionImpact(baseBalances, historyData)).toThrow(
      'Le montant doit être un entier strictement positif'
    )
  })
})

// ---------------------------------------------------------------------------

describe('TC-013-E — Immutabilité', () => {

  it('[TC-013-E1] reverseHistoryTransactionImpact ne mute pas les balances d\'entrée', () => {
    const historyData = {
      type: 'Dépôt',
      statut: 'Validée',
      montant: 200,
      reseau: 'Orange',
    }
    const snapshot = JSON.stringify(baseBalances)
    svc.reverseHistoryTransactionImpact(baseBalances, historyData)
    expect(JSON.stringify(baseBalances)).toBe(snapshot)
  })
})

// ---------------------------------------------------------------------------

describe('TC-013-F — Retrait Path 1 : erreur systématique (renversement interdit)', () => {
  /**
   * COMPORTEMENT SÉCURISÉ — Lot 3B
   *
   * Depuis la correction A1 (Lot 3B), tout Retrait Path 1 direct (sans validatedAt ni
   * paymentMethod) lève une erreur explicite au lieu de produire une asymétrie silencieuse.
   *
   * Raison : sans la répartition exacte de la liquidité stockée par réseau dans le
   * document history, le renversement d'un Retrait qui a consommé plusieurs réseaux en
   * cascade est mathématiquement impossible à rendre exact.
   *
   * Ce chemin est pratiquement inaccessible via l'UI (transactions.jsx force
   * statut = 'Non Terminées' par défaut → Retraits passent toujours par
   * draft → validateTransaction).
   *
   * Solution future : stocker le delta par réseau dans history lors de la création.
   */

  it('[TC-013-F1] retrait Path 1 avec cascade de liquidité — lève une erreur (renversement impossible)', () => {
    const sparseBalances = {
      Orange:  { stock: 2000, liquidite:   50 },
      Moov:    { stock: 1500, liquidite: 1000 },
      Telecel: { stock: 1000, liquidite:  200 },
      Coris:   { stock:  500, liquidite:  100 },
      Sank:    { stock:  300, liquidite:   50 },
    }

    const historyData = {
      type: 'Retrait',
      statut: 'Validée',
      montant: 300,          // > Orange.liquidite (50) → cascade vers Moov
      reseau: 'Moov',
      // Pas de paymentMethod ni validatedAt → Path 1
    }

    // Vérifier que apply fonctionne toujours (impact appliqué)
    const afterApply = svc.applyInitialTransactionImpact(sparseBalances, historyData)
    expect(afterApply.Orange.liquidite).toBe(0)    // cascade consommée
    expect(afterApply.Moov.liquidite).toBe(750)
    expect(afterApply.Moov.stock).toBe(1800)

    // Le reverse doit lever une erreur (pas d'asymétrie silencieuse)
    expect(() => svc.reverseHistoryTransactionImpact(afterApply, historyData)).toThrow(
      'Renversement impossible'
    )
  })

  it('[TC-013-F2] retrait Path 1 même sans cascade — lève une erreur (protection systématique)', () => {
    // Même quand la liquidité Orange est suffisante, Retrait Path 1 reste interdit
    // car on ne peut pas garantir que la cascade n'a pas eu lieu au moment de l'apply initial
    const richBalances = {
      Orange:  { stock: 2000, liquidite: 1000 },
      Moov:    { stock: 1500, liquidite:  600 },
      Telecel: { stock: 1000, liquidite:  400 },
      Coris:   { stock:  500, liquidite:  200 },
      Sank:    { stock:  300, liquidite:  100 },
    }

    const historyData = {
      type: 'Retrait',
      statut: 'Validée',
      montant: 300,          // < Orange.liquidite (1000)
      reseau: 'Moov',
      // Pas de paymentMethod ni validatedAt → Path 1
    }

    expect(() => svc.reverseHistoryTransactionImpact(richBalances, historyData)).toThrow(
      'Renversement impossible'
    )
  })
})
