/**
 * TC-081 — Parité financière front ↔ Cloud Functions (audit dealer/gérant)
 *
 * src/utils/financialImpact.js et functions/src/settlements/financialUtils.js
 * dupliquent volontairement la logique financière (voir l'en-tête de
 * financialUtils.js). L'en-tête promettait « parité garantie par TC-060-F »,
 * mais TC-060-F ne teste QUE la version functions. Ce test verrouille
 * réellement la parité : mêmes entrées → mêmes sorties (ou mêmes erreurs)
 * sur les deux implémentations, et caractérise la divergence documentée
 * (validation des montants côté front uniquement).
 *
 * Toute modification de la logique financière doit être répercutée dans les
 * DEUX fichiers — ce test échoue sinon.
 */

import { describe, it, expect } from 'vitest'

import {
  normalizeNetworkBalances as frontNormalize,
  mapPaymentMethodToNetwork as frontMap,
  applySettlementImpact as frontApply,
} from '../../src/utils/financialImpact.js'

import {
  normalizeNetworkBalances as fnNormalize,
  mapPaymentMethodToNetwork as fnMap,
  applySettlementImpact as fnApply,
} from '../../functions/src/settlements/financialUtils.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_BALANCES = {
  Orange:  { stock: 50000, liquidite: 20000 },
  Moov:    { stock: 10000, liquidite: 5000 },
  Telecel: { stock: 5000,  liquidite: 1000 },
  Coris:   { stock: 3000,  liquidite: 500 },
  Sank:    { stock: 2000,  liquidite: 200 },
}

const ALL_METHODS = ['Orange Money', 'Moov Money', 'Telecel Money', 'Coris Money', 'Sank Money', 'Cash']
const ALL_TYPES = ['Dépôt', 'Retrait', 'Crédit']

// Chaque implémentation reçoit sa propre copie profonde (aucun partage d'état).
const clone = (o) => JSON.parse(JSON.stringify(o))

// Exécute fn et capture soit la valeur, soit l'erreur — pour comparer les deux chemins.
function outcome(fn) {
  try {
    return { value: fn(), error: null }
  } catch (e) {
    return { value: null, error: e.message }
  }
}

// ---------------------------------------------------------------------------
// §1 — mapPaymentMethodToNetwork
// ---------------------------------------------------------------------------

describe('TC-081-MAP — mapPaymentMethodToNetwork identique', () => {
  it('[MAP-01] les 6 méthodes officielles produisent le même réseau', () => {
    for (const method of ALL_METHODS) {
      expect(frontMap(method), method).toBe(fnMap(method))
    }
    expect(frontMap('Cash')).toBe('Liquidite')
  })

  it('[MAP-02] méthode inconnue → passthrough identique des deux côtés', () => {
    expect(frontMap('Bitcoin')).toBe('Bitcoin')
    expect(fnMap('Bitcoin')).toBe('Bitcoin')
    expect(frontMap(undefined)).toBe(fnMap(undefined))
  })
})

// ---------------------------------------------------------------------------
// §2 — normalizeNetworkBalances
// ---------------------------------------------------------------------------

describe('TC-081-NRM — normalizeNetworkBalances identique', () => {
  const CASES = [
    ['objet vide', {}],
    ['undefined', undefined],
    ['avec wrapper balances', { balances: { Orange: { stock: 100, liquidite: 50 } } }],
    ['map directe', { Orange: { stock: 100 }, Moov: { liquidite: 7 } }],
    ['valeurs négatives → 0', { Orange: { stock: -5, liquidite: -1 } }],
    ['valeurs non numériques → 0', { Orange: { stock: 'abc', liquidite: null } }],
    ['réseau hors défauts conservé', { Wave: { stock: 42, liquidite: 1 } }],
    ['entrées non-objet ignorées', { Orange: 'broken', Moov: 42, Telecel: { stock: 9 } }],
    ['jeu complet', { balances: clone(BASE_BALANCES) }],
  ]

  for (const [label, input] of CASES) {
    it(`[NRM] ${label}`, () => {
      expect(frontNormalize(input ? clone(input) : input))
        .toEqual(fnNormalize(input ? clone(input) : input))
    })
  }
})

// ---------------------------------------------------------------------------
// §3 — applySettlementImpact : matrice types × méthodes
// ---------------------------------------------------------------------------

describe('TC-081-APP — applySettlementImpact identique (fonds suffisants)', () => {
  for (const type of ALL_TYPES) {
    for (const method of ALL_METHODS) {
      it(`[APP] ${type} réglé par ${method}`, () => {
        const tx = { type, montant: 100 }
        const front = outcome(() => frontApply(clone(BASE_BALANCES), tx, method))
        const fns = outcome(() => fnApply(clone(BASE_BALANCES), tx, method))
        expect(front.error, 'les deux doivent réussir').toBeNull()
        expect(fns.error).toBeNull()
        expect(front.value).toEqual(fns.value)
      })
    }
  }

  it('[APP-XN] inter-réseaux : crédit pris sur Orange remboursé par Moov Money → stock Moov crédité, Orange intact (2 impl.)', () => {
    const tx = { type: 'Crédit', montant: 2500, reseau: 'Orange' }
    const front = frontApply(clone(BASE_BALANCES), tx, 'Moov Money')
    const fns = fnApply(clone(BASE_BALANCES), tx, 'Moov Money')
    expect(front).toEqual(fns)
    expect(front.Moov.stock).toBe(12500)
    expect(front.Orange.stock).toBe(50000)
  })
})

// ---------------------------------------------------------------------------
// §4 — Chemins d'erreur : mêmes messages
// ---------------------------------------------------------------------------

describe('TC-081-ERR — erreurs de fonds insuffisants identiques', () => {
  it('[ERR-01] Retrait Cash > liquidité totale → même message des deux côtés', () => {
    const tx = { type: 'Retrait', montant: 100000 } // total liquidité = 26700
    const front = outcome(() => frontApply(clone(BASE_BALANCES), tx, 'Cash'))
    const fns = outcome(() => fnApply(clone(BASE_BALANCES), tx, 'Cash'))
    expect(front.error).not.toBeNull()
    expect(front.error).toBe(fns.error)
    expect(front.error).toMatch(/^Liquidite insuffisante\. Disponible:/)
  })

  it('[ERR-02] Retrait Moov Money > stock Moov → même message des deux côtés', () => {
    const tx = { type: 'Retrait', montant: 99999 } // Moov.stock = 10000
    const front = outcome(() => frontApply(clone(BASE_BALANCES), tx, 'Moov Money'))
    const fns = outcome(() => fnApply(clone(BASE_BALANCES), tx, 'Moov Money'))
    expect(front.error).not.toBeNull()
    expect(front.error).toBe(fns.error)
    expect(front.error).toMatch(/^Stock insuffisant pour Moov\./)
  })

  it('[ERR-03] Retrait Cash consomme la liquidité réseau par réseau dans l\'ordre des clés (2 impl.)', () => {
    const tx = { type: 'Retrait', montant: 24000 } // Orange 20000 + Moov 4000
    const front = frontApply(clone(BASE_BALANCES), tx, 'Cash')
    const fns = fnApply(clone(BASE_BALANCES), tx, 'Cash')
    expect(front).toEqual(fns)
    expect(front.Orange.liquidite).toBe(0)
    expect(front.Moov.liquidite).toBe(1000)
    expect(front.Telecel.liquidite).toBe(1000) // intacte
  })
})

// ---------------------------------------------------------------------------
// §5 — DIVERGENCE DOCUMENTÉE : validation des montants (front uniquement)
// ---------------------------------------------------------------------------

describe('TC-081-DIV — divergence assumée : validateFcfaAmount côté front seulement', () => {
  // financialUtils.js (en-tête) : « applySettlementImpact utilise txData.montant
  // directement (entier déjà validé par le handler) ». Ce test fige cette
  // divergence : si l'un des deux côtés change, il doit être revu explicitement.

  it('[DIV-01] montant décimal : le front REJETTE, la version functions CALCULE', () => {
    const tx = { type: 'Dépôt', montant: 100.5 }
    const front = outcome(() => frontApply(clone(BASE_BALANCES), tx, 'Orange Money'))
    const fns = outcome(() => fnApply(clone(BASE_BALANCES), tx, 'Orange Money'))

    expect(front.error).not.toBeNull()      // front : validateFcfaAmount lève
    expect(fns.error).toBeNull()            // functions : suppose la validation faite en amont
    expect(fns.value.Orange.stock).toBe(50100.5)
  })

  it('[DIV-02] garde-fou amont réel : le handler rejette un montant non entier AVANT financialUtils', async () => {
    // La sécurité de la version functions repose sur la validation du handler :
    // addTransactionPayment.js exige Number.isSafeInteger(amount) && amount > 0
    // avant d'appeler applySettlementImpact. On vérifie ce garde-fou de bout en bout.
    const { addTransactionPaymentHandler } = await import(
      '../../functions/src/settlements/addTransactionPayment.js'
    )

    // db minimal : la validation du montant survient avant tout accès Firestore.
    const db = { runTransaction: async () => { throw new Error('ne doit pas être atteint') } }
    const FieldValue = { serverTimestamp: () => 'TS' }
    const request = {
      auth: { uid: 'actor-081' },
      data: { draftId: 'd1', amount: 100.5, paymentMethod: 'Orange Money', idempotencyKey: 'k1' },
    }

    await expect(
      addTransactionPaymentHandler(request, { db, FieldValue })
    ).rejects.toMatchObject({ code: 'INVALID_SETTLEMENT_AMOUNT' })
  })
})
