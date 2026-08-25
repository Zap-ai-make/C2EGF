/**
 * TC-006 — Calculs de soldes (séquences de transactions)
 *
 * Comportement à capturer (golden test) :
 *   - La composition de plusieurs appels successifs à applyInitialTransactionImpact
 *     produit un état final déterministe réseau par réseau.
 *   - applyLiquidityDelta consomme la liquidité en partant du premier réseau (Orange
 *     dans l'ordre des clés de baseBalances) puis déborde sur les suivants.
 *   - apply + reverse sur une transaction "Non Terminées" (pending) est un invariant :
 *     les balances reviennent exactement à leur état initial réseau par réseau.
 *   - reverseInitialTransactionImpact sur une transaction "Validée" ne fait RIEN
 *     (asymétrie documentée — src/services/firestore.js:750). Cette asymétrie est
 *     figée ici dans le contexte d'une séquence plus longue.
 *   - Quand la liquidité est épuisée progressivement par des retraits successifs,
 *     une transaction supplémentaire dépassant la liquidité restante lève une erreur.
 *   - Les objets de balances passés à chaque appel ne sont pas mutés.
 *
 * Fichiers source :
 *   - src/services/firestore.js:652-681  (applyLiquidityDelta)
 *   - src/services/firestore.js:633-650  (adjustBalanceValue)
 *   - src/services/firestore.js:711-744  (applyInitialTransactionImpact)
 *   - src/services/firestore.js:746-761  (reverseInitialTransactionImpact)
 *
 * Interdictions : aucun import Firebase, aucun accès réseau.
 * Les mocks ci-dessous neutralisent les effets de bord au niveau module
 * (initializeApp, getFirestore, import.meta.env) sans modifier src/.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest'

// --- Mocks des modules avec effets de bord au chargement ---
// Stratégie identique à TC-001/TC-002 — non mutualisée dans un fichier partagé.

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

// ---------------------------------------------------------------------------
// Fixtures locales déterministes
// Toutes les valeurs sont des entiers fixes — aucun Date.now(), aucun Math.random().
// Orange est la première clé : applyLiquidityDelta positif y atterrit toujours.
// ---------------------------------------------------------------------------

/**
 * Balances de référence à liquidité suffisante pour les séquences nominales.
 * Liquidité totale = 500 + 300 + 200 + 100 + 50 = 1150 FCFA.
 */
const baseBalances = {
  Orange:  { stock: 1000, liquidite: 500 },
  Moov:    { stock:  800, liquidite: 300 },
  Telecel: { stock:  600, liquidite: 200 },
  Coris:   { stock:  400, liquidite: 100 },
  Sank:    { stock:  200, liquidite:  50 },
}

/**
 * Balances de départ pour le test de liquidité progressivement épuisée.
 * Liquidité totale initiale = 400 FCFA.
 */
const limitedLiquidityBalances = {
  Orange:  { stock: 2000, liquidite: 250 },
  Moov:    { stock: 1500, liquidite: 150 },
  Telecel: { stock: 1000, liquidite:   0 },
  Coris:   { stock:  500, liquidite:   0 },
  Sank:    { stock:  300, liquidite:   0 },
}

// Service instancié une seule fois — le constructeur n'effectue pas d'I/O Firebase
// (setFetchFunction est mocké ci-dessus).
let svc

beforeAll(() => {
  svc = new FirestoreService()
})

// ---------------------------------------------------------------------------

describe("TC-006 — calculs de soldes (séquences de transactions)", () => {

  // -------------------------------------------------------------------------
  describe('[TC-006-N1] séquence nominale multi-transactions (3 opérations)', () => {
    /**
     * Séquence :
     *   T1 — Dépôt Non Terminées, 200 FCFA, Orange
     *         → stock Orange -200 (pending : pas de liquidité)
     *   T2 — Retrait Non Terminées, 100 FCFA, Moov
     *         → stock Moov +100 (pending : pas de liquidité)
     *   T3 — Dépôt Validée, 150 FCFA, Telecel
     *         → stock Telecel -150 ET liquidité Orange +150 (validée)
     *
     * État initial Orange  : stock 1000, liquidite 500
     * État initial Moov    : stock  800, liquidite 300
     * État initial Telecel : stock  600, liquidite 200
     *
     * Après T1 : Orange.stock = 800
     * Après T2 : Moov.stock   = 900
     * Après T3 : Telecel.stock = 450 ; Orange.liquidite = 650
     */

    it('[TC-006-N1-a] stock Orange après T1 (dépôt pending 200 Orange)', () => {
      const t1 = { type: 'Dépôt', statut: 'Non Terminées', montant: 200, reseau: 'Orange' }
      const after1 = svc.applyInitialTransactionImpact(baseBalances, t1)
      expect(after1.Orange.stock).toBe(800)
      expect(after1.Orange.liquidite).toBe(500) // inchangée (pending)
    })

    it('[TC-006-N1-b] stock Moov après T2 (retrait pending 100 Moov)', () => {
      const t1 = { type: 'Dépôt', statut: 'Non Terminées', montant: 200, reseau: 'Orange' }
      const t2 = { type: 'Retrait', statut: 'Non Terminées', montant: 100, reseau: 'Moov' }
      const after1 = svc.applyInitialTransactionImpact(baseBalances, t1)
      const after2 = svc.applyInitialTransactionImpact(after1, t2)
      expect(after2.Moov.stock).toBe(900)
      expect(after2.Orange.stock).toBe(800) // inchangé depuis T1
      expect(after2.Moov.liquidite).toBe(300) // inchangée (pending)
    })

    it('[TC-006-N1-c] état final après T3 (dépôt validé 150 Telecel) — réseau par réseau', () => {
      const t1 = { type: 'Dépôt', statut: 'Non Terminées', montant: 200, reseau: 'Orange' }
      const t2 = { type: 'Retrait', statut: 'Non Terminées', montant: 100, reseau: 'Moov' }
      const t3 = { type: 'Dépôt', statut: 'Validée',        montant: 150, reseau: 'Telecel' }

      const after1 = svc.applyInitialTransactionImpact(baseBalances, t1)
      const after2 = svc.applyInitialTransactionImpact(after1, t2)
      const after3 = svc.applyInitialTransactionImpact(after2, t3)

      // Orange : stock inchangé depuis T1 (850→800), liquidité +150 (T3 validée)
      expect(after3.Orange.stock).toBe(800)
      expect(after3.Orange.liquidite).toBe(650) // 500 + 150

      // Moov : stock depuis T2 (900), liquidité inchangée
      expect(after3.Moov.stock).toBe(900)
      expect(after3.Moov.liquidite).toBe(300)

      // Telecel : stock -150 (T3 validée : retire du stock)
      expect(after3.Telecel.stock).toBe(450) // 600 - 150
      expect(after3.Telecel.liquidite).toBe(200) // inchangée

      // Coris / Sank : inchangés
      expect(after3.Coris.stock).toBe(400)
      expect(after3.Coris.liquidite).toBe(100)
      expect(after3.Sank.stock).toBe(200)
      expect(after3.Sank.liquidite).toBe(50)
    })
  })

  // -------------------------------------------------------------------------
  describe('[TC-006-N2] ordre de consommation de liquidité (retrait validé multi-réseaux)', () => {
    /**
     * applyLiquidityDelta(delta < 0) consomme dans l'ordre des clés de baseBalances :
     * Orange (500) → Moov (300) → Telecel (200) → ...
     *
     * Retrait Validée 700 FCFA sur réseau Moov :
     *   - applyLiquidityDelta(-700) : prend 500 sur Orange (épuisé), 200 sur Moov (reste 100)
     *   - adjustBalanceValue(Moov, stock, +700)
     */

    it('[TC-006-N2-a] retrait validé 700 — Orange liquidité épuisée, Moov partiellement consommé', () => {
      const tx = { type: 'Retrait', statut: 'Validée', montant: 700, reseau: 'Moov' }
      const result = svc.applyInitialTransactionImpact(baseBalances, tx)

      // Orange liquidité : 500 - 500 = 0 (épuisé en premier)
      expect(result.Orange.liquidite).toBe(0)

      // Moov liquidité : 300 - 200 = 100 (reste 200 après Orange, pris sur Moov)
      expect(result.Moov.liquidite).toBe(100)

      // Telecel / Coris / Sank : inchangés (pas besoin d'aller jusque-là)
      expect(result.Telecel.liquidite).toBe(200)
      expect(result.Coris.liquidite).toBe(100)
      expect(result.Sank.liquidite).toBe(50)

      // Stock Moov (réseau de la transaction) augmente
      expect(result.Moov.stock).toBe(1500) // 800 + 700
    })

    it('[TC-006-N2-b] retrait validé 1050 — Orange + Moov + Telecel consommés, Coris/Sank inchangés', () => {
      const tx = { type: 'Retrait', statut: 'Validée', montant: 1050, reseau: 'Orange' }
      // Liquidité totale = 1150. On consomme 1050 : 500 (Orange) + 300 (Moov) + 200 (Telecel) + 50 (Coris)
      const result = svc.applyInitialTransactionImpact(baseBalances, tx)

      expect(result.Orange.liquidite).toBe(0)   // épuisé
      expect(result.Moov.liquidite).toBe(0)     // épuisé
      expect(result.Telecel.liquidite).toBe(0)  // épuisé
      expect(result.Coris.liquidite).toBe(50)   // 100 - 50 = 50
      expect(result.Sank.liquidite).toBe(50)    // inchangé

      // Stock Orange augmente (réseau de la transaction)
      expect(result.Orange.stock).toBe(2050) // 1000 + 1050
    })

    it('[TC-006-N2-c] dépôt validé — liquidité ajoutée UNIQUEMENT sur le premier réseau (Orange)', () => {
      const tx = { type: 'Dépôt', statut: 'Validée', montant: 300, reseau: 'Moov' }
      // applyInitialTransactionImpact branche dépôt Validée :
      //   1. adjustBalanceValue(balances, 'Moov', 'stock', -300) → Moov.stock = 800 - 300 = 500
      //   2. applyLiquidityDelta(+300) : delta >= 0 → adjustBalanceValue(firstNetwork='Orange', liquidite, +300)
      //      → Orange.liquidite = 500 + 300 = 800
      const result = svc.applyInitialTransactionImpact(baseBalances, tx)

      expect(result.Orange.liquidite).toBe(800) // 500 + 300 — ajouté sur Orange (premier réseau)
      expect(result.Moov.liquidite).toBe(300)   // inchangé
      expect(result.Moov.stock).toBe(500)       // 800 - 300 (stock réseau de la transaction)
    })
  })

  // -------------------------------------------------------------------------
  describe('[TC-006-N3] invariant apply + reverse sur transaction pending', () => {
    /**
     * Pour tout statut "Non Terminées", appliquer puis reverser
     * doit ramener chaque réseau exactement à sa valeur initiale.
     */

    it('[TC-006-N3-a] dépôt pending 200 Orange — apply puis reverse = état initial', () => {
      const tx = { type: 'Dépôt', statut: 'Non Terminées', montant: 200, reseau: 'Orange' }

      const afterApply   = svc.applyInitialTransactionImpact(baseBalances, tx)
      const afterReverse = svc.reverseInitialTransactionImpact(afterApply, tx)

      for (const network of Object.keys(baseBalances)) {
        expect(afterReverse[network].stock).toBe(baseBalances[network].stock)
        expect(afterReverse[network].liquidite).toBe(baseBalances[network].liquidite)
      }
    })

    it('[TC-006-N3-b] retrait pending 300 Moov — apply puis reverse = état initial', () => {
      const tx = { type: 'Retrait', statut: 'Non Terminées', montant: 300, reseau: 'Moov' }

      const afterApply   = svc.applyInitialTransactionImpact(baseBalances, tx)
      const afterReverse = svc.reverseInitialTransactionImpact(afterApply, tx)

      for (const network of Object.keys(baseBalances)) {
        expect(afterReverse[network].stock).toBe(baseBalances[network].stock)
        expect(afterReverse[network].liquidite).toBe(baseBalances[network].liquidite)
      }
    })

    it('[TC-006-N3-c] crédit pending 100 Telecel — apply puis reverse = état initial', () => {
      const tx = { type: 'Crédit', statut: 'Non Terminées', montant: 100, reseau: 'Telecel' }

      const afterApply   = svc.applyInitialTransactionImpact(baseBalances, tx)
      const afterReverse = svc.reverseInitialTransactionImpact(afterApply, tx)

      for (const network of Object.keys(baseBalances)) {
        expect(afterReverse[network].stock).toBe(baseBalances[network].stock)
        expect(afterReverse[network].liquidite).toBe(baseBalances[network].liquidite)
      }
    })
  })

  // -------------------------------------------------------------------------
  describe('[TC-006-N4] asymétrie Validée / reverse — comportement actuel figé', () => {
    /**
     * reverseInitialTransactionImpact ne traite QUE le statut "Non Terminées"
     * (src/services/firestore.js:750 — if (this.isPendingStatus(...))).
     * Pour une transaction Validée, reverse retourne les balances INCHANGÉES.
     *
     * Ce test fige ce comportement dans une séquence plus longue :
     *   1. Appliquer un dépôt Validée (modifie stock + liquidité)
     *   2. Tenter de reverser : aucun effet
     *   3. L'état après reverse est identique à l'état après apply.
     *
     * Lien MASTER-SEC-004 : pas de compensation automatique lors de la suppression
     * d'une transaction validée — le solde reste dans l'état post-application.
     */

    it('[TC-006-N4-a] dépôt Validée appliqué puis reversé — reverse sans effet (asymétrie)', () => {
      const tx = { type: 'Dépôt', statut: 'Validée', montant: 200, reseau: 'Orange' }

      const afterApply   = svc.applyInitialTransactionImpact(baseBalances, tx)
      const afterReverse = svc.reverseInitialTransactionImpact(afterApply, tx)

      // apply a modifié Orange.stock et Orange.liquidite
      expect(afterApply.Orange.stock).toBe(800)    // 1000 - 200
      expect(afterApply.Orange.liquidite).toBe(700) // 500 + 200

      // reverse ne fait rien : l'état après reverse == état après apply
      expect(afterReverse.Orange.stock).toBe(800)
      expect(afterReverse.Orange.liquidite).toBe(700)
    })

    it('[TC-006-N4-b] séquence : pending apply → validée apply → pending reverse — réseau par réseau', () => {
      /**
       * Séquence :
       *   S1 — Dépôt Non Terminées 100 Orange  → stock Orange -100
       *   S2 — Dépôt Validée       150 Moov    → stock Moov -150, liquidité Orange +150
       *   S3 — reverse S1 (pending) 100 Orange → stock Orange +100 (restitution)
       *        reverse S2 (validée)  150 Moov  → RIEN (asymétrie)
       *
       * État attendu après S3 :
       *   Orange.stock     = 1000 (S1 appliqué puis reversé, net zéro)
       *   Orange.liquidite = 650  (500 + 150 de S2 — S2 ne peut pas être reversé)
       *   Moov.stock       = 650  (800 - 150 de S2 — non compensé)
       *   Moov.liquidite   = 300  (inchangé)
       */
      const s1 = { type: 'Dépôt', statut: 'Non Terminées', montant: 100, reseau: 'Orange' }
      const s2 = { type: 'Dépôt', statut: 'Validée',       montant: 150, reseau: 'Moov' }

      const afterS1     = svc.applyInitialTransactionImpact(baseBalances, s1)
      const afterS2     = svc.applyInitialTransactionImpact(afterS1, s2)
      const afterRevS1  = svc.reverseInitialTransactionImpact(afterS2, s1)
      const afterRevS2  = svc.reverseInitialTransactionImpact(afterRevS1, s2)

      // S1 reversé correctement
      expect(afterRevS2.Orange.stock).toBe(1000)

      // S2 (Validée) non reversé — liquidité reste augmentée de 150
      expect(afterRevS2.Orange.liquidite).toBe(650) // 500 + 150

      // S2 (Validée) non reversé — stock Moov reste diminué de 150
      expect(afterRevS2.Moov.stock).toBe(650) // 800 - 150

      // Moov liquidité inchangée dans toute la séquence
      expect(afterRevS2.Moov.liquidite).toBe(300)
    })
  })

  // -------------------------------------------------------------------------
  describe('[TC-006-N5] liquidité insuffisante dans une séquence progressive', () => {
    /**
     * Séquence avec limitedLiquidityBalances (liquidité totale = 400 FCFA) :
     *   R1 — Retrait Validée 250 Orange → applyLiquidityDelta(-250) : Orange 250→0
     *   R2 — Retrait Validée 150 Moov  → applyLiquidityDelta(-150) : Moov  150→0
     *   R3 — Retrait Validée  50 Telecel → applyLiquidityDelta(-50) → ERREUR
     *        (liquidité totale restante = 0, insuffisante)
     */

    it('[TC-006-N5-a] R1 : retrait validé 250 Orange — Orange liquidité épuisée', () => {
      const r1 = { type: 'Retrait', statut: 'Validée', montant: 250, reseau: 'Orange' }
      const afterR1 = svc.applyInitialTransactionImpact(limitedLiquidityBalances, r1)

      expect(afterR1.Orange.liquidite).toBe(0)
      expect(afterR1.Moov.liquidite).toBe(150) // inchangée
      expect(afterR1.Orange.stock).toBe(2250)  // 2000 + 250
    })

    it('[TC-006-N5-b] R2 : retrait validé 150 Moov — Moov liquidité épuisée', () => {
      const r1 = { type: 'Retrait', statut: 'Validée', montant: 250, reseau: 'Orange' }
      const r2 = { type: 'Retrait', statut: 'Validée', montant: 150, reseau: 'Moov' }

      const afterR1 = svc.applyInitialTransactionImpact(limitedLiquidityBalances, r1)
      const afterR2 = svc.applyInitialTransactionImpact(afterR1, r2)

      expect(afterR2.Orange.liquidite).toBe(0)
      expect(afterR2.Moov.liquidite).toBe(0)
      expect(afterR2.Telecel.liquidite).toBe(0)
      expect(afterR2.Moov.stock).toBe(1650) // 1500 + 150
    })

    it('[TC-006-N5-c] R3 : retrait validé 50 sur liquidité totale = 0 — lève une erreur', () => {
      const r1 = { type: 'Retrait', statut: 'Validée', montant: 250, reseau: 'Orange' }
      const r2 = { type: 'Retrait', statut: 'Validée', montant: 150, reseau: 'Moov' }
      const r3 = { type: 'Retrait', statut: 'Validée', montant:  50, reseau: 'Telecel' }

      const afterR1 = svc.applyInitialTransactionImpact(limitedLiquidityBalances, r1)
      const afterR2 = svc.applyInitialTransactionImpact(afterR1, r2)

      expect(() => svc.applyInitialTransactionImpact(afterR2, r3)).toThrow(/Liquidite insuffisante/)
    })

    it('[TC-006-N5-d] après erreur R3, les balances de R2 sont inchangées (erreur non propagée)', () => {
      const r1 = { type: 'Retrait', statut: 'Validée', montant: 250, reseau: 'Orange' }
      const r2 = { type: 'Retrait', statut: 'Validée', montant: 150, reseau: 'Moov' }
      const r3 = { type: 'Retrait', statut: 'Validée', montant:  50, reseau: 'Telecel' }

      const afterR1 = svc.applyInitialTransactionImpact(limitedLiquidityBalances, r1)
      const afterR2 = svc.applyInitialTransactionImpact(afterR1, r2)

      // Capturer état avant tentative R3
      const snapshotBeforeR3 = JSON.stringify(afterR2)

      try {
        svc.applyInitialTransactionImpact(afterR2, r3)
      } catch (_) {
        // attendu
      }

      // afterR2 ne doit pas avoir été muté par la tentative qui a levé l'erreur
      expect(JSON.stringify(afterR2)).toBe(snapshotBeforeR3)
    })
  })

  // -------------------------------------------------------------------------
  describe('[TC-006-N6] immutabilité des balances à chaque appel de la séquence', () => {
    /**
     * Chaque appel doit retourner un nouvel objet sans muter l'objet d'entrée.
     * Vérifié sur chaque étape intermédiaire de la séquence.
     */

    it('[TC-006-N6-a] applyInitialTransactionImpact ne mute pas les balances d\'entrée', () => {
      const tx = { type: 'Dépôt', statut: 'Validée', montant: 200, reseau: 'Orange' }
      const snapshot = JSON.stringify(baseBalances)

      svc.applyInitialTransactionImpact(baseBalances, tx)

      expect(JSON.stringify(baseBalances)).toBe(snapshot)
    })

    it('[TC-006-N6-b] reverseInitialTransactionImpact ne mute pas les balances d\'entrée', () => {
      const tx = { type: 'Dépôt', statut: 'Non Terminées', montant: 200, reseau: 'Orange' }

      const afterApply = svc.applyInitialTransactionImpact(baseBalances, tx)
      const snapshotAfterApply = JSON.stringify(afterApply)

      svc.reverseInitialTransactionImpact(afterApply, tx)

      expect(JSON.stringify(afterApply)).toBe(snapshotAfterApply)
    })

    it('[TC-006-N6-c] chaque étape intermédiaire d\'une séquence 3-transactions est indépendante', () => {
      const t1 = { type: 'Dépôt',   statut: 'Non Terminées', montant: 100, reseau: 'Orange' }
      const t2 = { type: 'Retrait', statut: 'Non Terminées', montant:  80, reseau: 'Moov' }
      const t3 = { type: 'Dépôt',   statut: 'Validée',       montant:  60, reseau: 'Telecel' }

      const snap0 = JSON.stringify(baseBalances)
      const after1 = svc.applyInitialTransactionImpact(baseBalances, t1)
      expect(JSON.stringify(baseBalances)).toBe(snap0) // base non mutée par T1

      const snap1 = JSON.stringify(after1)
      const after2 = svc.applyInitialTransactionImpact(after1, t2)
      expect(JSON.stringify(after1)).toBe(snap1) // after1 non muté par T2

      const snap2 = JSON.stringify(after2)
      svc.applyInitialTransactionImpact(after2, t3)
      expect(JSON.stringify(after2)).toBe(snap2) // after2 non muté par T3
    })
  })

  // -------------------------------------------------------------------------
  describe('[TC-006-N7] couverture explicite Orange et Moov dans les assertions', () => {
    /**
     * Séquence mix réseaux : vérifier les deux réseaux Orange et Moov explicitement
     * dans chaque assertion finale (pas uniquement le réseau cible).
     *
     * Séquence :
     *   A — Dépôt Non Terminées 200 Orange  → Orange.stock -200
     *   B — Retrait Validée     150 Moov    → applyLiquidityDelta(-150) : Orange -150 ;
     *                                          Moov.stock +150
     *   C — Dépôt Validée       80  Orange  → Orange.stock -80 ;
     *                                          applyLiquidityDelta(+80) : Orange.liquidite +80
     */
    it('[TC-006-N7] état final : Orange et Moov vérifiés explicitement réseau par réseau', () => {
      const tA = { type: 'Dépôt',   statut: 'Non Terminées', montant: 200, reseau: 'Orange' }
      const tB = { type: 'Retrait', statut: 'Validée',       montant: 150, reseau: 'Moov' }
      const tC = { type: 'Dépôt',   statut: 'Validée',       montant:  80, reseau: 'Orange' }

      const afterA = svc.applyInitialTransactionImpact(baseBalances, tA)
      const afterB = svc.applyInitialTransactionImpact(afterA, tB)
      const afterC = svc.applyInitialTransactionImpact(afterB, tC)

      // Orange : stock initial 1000
      //   tA : -200 (pending) → 800
      //   tB : 0 (retrait réseau Moov, stock Orange non touché) → 800
      //   tC : -80 (validée, retire du stock Orange) → 720
      expect(afterC.Orange.stock).toBe(720)

      // Orange : liquidite initiale 500
      //   tB : applyLiquidityDelta(-150) → Orange 500-150=350
      //   tC : applyLiquidityDelta(+80)  → Orange 350+80=430
      expect(afterC.Orange.liquidite).toBe(430)

      // Moov : stock initial 800
      //   tB : +150 (retrait validé, stock réseau Moov) → 950
      expect(afterC.Moov.stock).toBe(950)

      // Moov : liquidite initiale 300
      //   tB : applyLiquidityDelta(-150) épuise Orange (350 après tA-liquidité=500, prend 150 sur Orange)
      //        → Moov.liquidite inchangée (Orange suffisait)
      expect(afterC.Moov.liquidite).toBe(300)

      // Telecel / Coris / Sank : inchangés
      expect(afterC.Telecel.stock).toBe(600)
      expect(afterC.Telecel.liquidite).toBe(200)
      expect(afterC.Coris.stock).toBe(400)
      expect(afterC.Sank.stock).toBe(200)
    })
  })
})
