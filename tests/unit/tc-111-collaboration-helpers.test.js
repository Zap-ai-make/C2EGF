/**
 * TC-111 — Helpers purs des collaborations inter-boutiques.
 *
 * Testés sans Firestore : ce sont eux qui portent la règle financière, et une
 * erreur ici se paie en argent réel. Le cœur du fichier est la TABLE DE VÉRITÉ
 * complète `debtDirection` × `supplierStockDelta` : les deux règles sont miroir
 * l'une de l'autre, et les confondre inverserait le sens d'une dette.
 *
 * Rappel de la sémantique (mono-réseau : la demandeuse est à court de STOCK,
 * pas privée de SIM) :
 *   dépôt   → stock fournisseur −montant ; DEMANDEUSE doit à FOURNISSEUSE
 *   retrait → stock fournisseur +montant ; FOURNISSEUSE doit à DEMANDEUSE
 */

import { describe, it, expect } from 'vitest'
import {
  assertCollaborationsEnabled,
  resolveCollaborationNetwork,
  validateOperationType,
  validateCollaborationAmount,
  validateCollaborationId,
  validateStoreRef,
  validateClientId,
  supplierStockDelta,
  debtDirection,
  requiresSupplierBalanceCheck,
  nextSupplierBalance,
  readStoreStock,
} from '../../functions/src/collaborations/shared.js'
import { COLLABORATIONS_ENABLED } from '../../functions/src/config/storeProfile.js'

const A = 'store-A' // demandeuse
const B = 'store-B' // fournisseuse

const expectCode = (fn, code) => {
  try {
    fn()
  } catch (err) {
    expect(err.code).toBe(code)
    return
  }
  throw new Error(`Attendu : DealerRequestError ${code}, mais rien n'a été levé.`)
}

// ─────────────────────────────────────────────────────────────────────────────

describe('TC-111-A — Table de vérité : delta de stock × sens de la dette', () => {
  // L'invariant du module tient en quatre lignes. Les voir ensemble est le but.
  const TRUTH_TABLE = [
    {
      operationType: 'deposit',
      amount: 20000,
      delta: -20000,
      debtorStoreId: A,
      creditorStoreId: B,
      pourquoi: 'la demandeuse a encaissé le cash, la fournisseuse a dépensé son float',
    },
    {
      operationType: 'withdrawal',
      amount: 15000,
      delta: 15000,
      debtorStoreId: B,
      creditorStoreId: A,
      pourquoi: 'la demandeuse a sorti le cash de sa caisse, la fournisseuse a reçu le float',
    },
  ]

  for (const row of TRUTH_TABLE) {
    it(`${row.operationType} : stock fournisseur ${row.delta > 0 ? '+' : ''}${row.delta} — ${row.pourquoi}`, () => {
      expect(supplierStockDelta(row.operationType, row.amount)).toBe(row.delta)
      expect(debtDirection(row.operationType, { requestingStoreId: A, supplierStoreId: B })).toEqual({
        debtorStoreId: row.debtorStoreId,
        creditorStoreId: row.creditorStoreId,
      })
    })
  }

  it('le débiteur est TOUJOURS le côté opposé au signe du delta', () => {
    // Formulation indépendante : si le stock du fournisseur baisse, c'est lui le
    // créancier ; s'il monte, c'est lui le débiteur. Un futur refactor qui
    // inverserait l'une des deux règles casserait ici.
    for (const operationType of ['deposit', 'withdrawal']) {
      const delta = supplierStockDelta(operationType, 1000)
      const { creditorStoreId } = debtDirection(operationType, { requestingStoreId: A, supplierStoreId: B })
      expect(creditorStoreId).toBe(delta < 0 ? B : A)
    }
  })

  it('les deux sens sont bien opposés l’un de l’autre', () => {
    const dep = debtDirection('deposit', { requestingStoreId: A, supplierStoreId: B })
    const wit = debtDirection('withdrawal', { requestingStoreId: A, supplierStoreId: B })
    expect(dep.debtorStoreId).toBe(wit.creditorStoreId)
    expect(dep.creditorStoreId).toBe(wit.debtorStoreId)
  })

  it('le sens ne dépend pas de l’ordre des arguments, mais des rôles', () => {
    // Inverser demandeuse et fournisseuse inverse la dette : le rôle décide, pas la position.
    expect(debtDirection('deposit', { requestingStoreId: B, supplierStoreId: A }))
      .toEqual({ debtorStoreId: B, creditorStoreId: A })
  })

  it('une collaboration avec soi-même est refusée', () => {
    expectCode(() => debtDirection('deposit', { requestingStoreId: A, supplierStoreId: A }), 'SAME_STORE_COLLABORATION')
  })

  it('debtDirection valide ses entrées', () => {
    expectCode(() => debtDirection('transfer', { requestingStoreId: A, supplierStoreId: B }), 'INVALID_OPERATION_TYPE')
    expectCode(() => debtDirection('deposit', { requestingStoreId: '', supplierStoreId: B }), 'INVALID_STORE_ID')
    expectCode(() => debtDirection('deposit'), 'INVALID_STORE_ID')
  })
})

describe('TC-111-B — Contrôle de suffisance : le dépôt seulement', () => {
  it('un dépôt exige que le fournisseur ait le stock', () => {
    expect(requiresSupplierBalanceCheck('deposit')).toBe(true)
  })

  it('un retrait n’exige rien : le stock fournisseur MONTE', () => {
    expect(requiresSupplierBalanceCheck('withdrawal')).toBe(false)
  })

  it('dépôt de 20 000 sur un stock de 50 000 → 30 000', () => {
    expect(nextSupplierBalance('deposit', 20000, 50000)).toBe(30000)
  })

  it('dépôt de 20 000 sur un stock de 10 000 → refus, rien ne bouge', () => {
    expectCode(() => nextSupplierBalance('deposit', 20000, 10000), 'INSUFFICIENT_SUPPLIER_BALANCE')
  })

  it('dépôt exactement égal au stock → autorisé, solde à 0', () => {
    expect(nextSupplierBalance('deposit', 20000, 20000)).toBe(0)
  })

  it('retrait de 15 000 sur un stock de 0 → 15 000 (aucun contrôle)', () => {
    expect(nextSupplierBalance('withdrawal', 15000, 0)).toBe(15000)
  })

  it('un retrait qui dépasserait l’entier sûr est refusé', () => {
    expectCode(() => nextSupplierBalance('withdrawal', 1000, Number.MAX_SAFE_INTEGER), 'BALANCE_OVERFLOW')
  })

  it('un solde de départ corrompu n’est jamais « réparé » en silence', () => {
    expectCode(() => nextSupplierBalance('deposit', 100, -5), 'INVALID_BALANCE_DATA')
    expectCode(() => nextSupplierBalance('deposit', 100, 12.5), 'INVALID_BALANCE_DATA')
    expectCode(() => nextSupplierBalance('deposit', 100, NaN), 'INVALID_BALANCE_DATA')
    expectCode(() => nextSupplierBalance('deposit', 100, undefined), 'INVALID_BALANCE_DATA')
  })
})

describe('TC-111-C — Drapeau d’activation du module', () => {
  it('activé → passe', () => {
    expect(() => assertCollaborationsEnabled(true)).not.toThrow()
  })

  it('désactivé → refusé jusqu’au serveur', () => {
    expectCode(() => assertCollaborationsEnabled(false), 'COLLABORATIONS_DISABLED')
  })

  it('valeur absente ou approximative → refusé (pas de « truthy » permissif)', () => {
    // Le cas `undefined` est le vrai piège : un profil incomplet, ou un champ
    // renommé, ne doit pas retomber sur « activé ». D'où l'absence de paramètre
    // par défaut sur ce garde-fou.
    expectCode(() => assertCollaborationsEnabled(undefined), 'COLLABORATIONS_DISABLED')
    expectCode(() => assertCollaborationsEnabled(), 'COLLABORATIONS_DISABLED')
    expectCode(() => assertCollaborationsEnabled(null), 'COLLABORATIONS_DISABLED')
    expectCode(() => assertCollaborationsEnabled('true'), 'COLLABORATIONS_DISABLED')
    expectCode(() => assertCollaborationsEnabled(1), 'COLLABORATIONS_DISABLED')
  })

  it('le profil de CE dépôt active le module', () => {
    expect(() => assertCollaborationsEnabled(COLLABORATIONS_ENABLED)).not.toThrow()
    expect(COLLABORATIONS_ENABLED).toBe(true)
  })
})

describe('TC-111-D — Résolution du réseau : jamais accepté du client', () => {
  it('mono-réseau : résolu sans que le client l’envoie', () => {
    expect(resolveCollaborationNetwork(null, ['Orange'])).toBe('Orange')
    expect(resolveCollaborationNetwork(undefined, ['Orange'])).toBe('Orange')
    expect(resolveCollaborationNetwork('', ['Orange'])).toBe('Orange')
  })

  it('mono-réseau : un réseau conforme reste accepté', () => {
    expect(resolveCollaborationNetwork('Orange', ['Orange'])).toBe('Orange')
  })

  it('mono-réseau : un AUTRE réseau est refusé, pas silencieusement corrigé', () => {
    expectCode(() => resolveCollaborationNetwork('Moov', ['Orange']), 'INVALID_COLLABORATION_NETWORK')
  })

  it('multi-réseaux : un réseau explicite est exigé (aucun choix silencieux)', () => {
    expectCode(() => resolveCollaborationNetwork(null, ['Orange', 'Moov']), 'INVALID_COLLABORATION_NETWORK')
    expect(resolveCollaborationNetwork('Moov', ['Orange', 'Moov'])).toBe('Moov')
  })

  it('profil sans réseau → erreur explicite', () => {
    expectCode(() => resolveCollaborationNetwork('Orange', []), 'INVALID_COLLABORATION_NETWORK')
  })

  it('le profil de CE dépôt résout Orange sans argument', () => {
    expect(resolveCollaborationNetwork()).toBe('Orange')
  })
})

describe('TC-111-F — Lecture du stock : tolérante à l’absence, stricte sur la valeur', () => {
  it('document absent → 0 (une boutique neuve n’a pas d’entrée de solde)', () => {
    expect(readStoreStock(undefined, 'Orange')).toBe(0)
    expect(readStoreStock(null, 'Orange')).toBe(0)
    expect(readStoreStock({}, 'Orange')).toBe(0)
  })

  it('réseau ou champ absent → 0', () => {
    expect(readStoreStock({ balances: {} }, 'Orange')).toBe(0)
    expect(readStoreStock({ balances: { Moov: { stock: 500 } } }, 'Orange')).toBe(0)
    expect(readStoreStock({ balances: { Orange: { liquidite: 900 } } }, 'Orange')).toBe(0)
  })

  it('valeur présente et valide → retournée telle quelle', () => {
    expect(readStoreStock({ balances: { Orange: { stock: 50000, liquidite: 12000 } } }, 'Orange')).toBe(50000)
    expect(readStoreStock({ balances: { Orange: { stock: 0 } } }, 'Orange')).toBe(0)
  })

  it('valeur corrompue → refus, jamais de réparation silencieuse', () => {
    for (const bad of [-1, 12.5, NaN, Infinity, '5000', {}]) {
      expectCode(() => readStoreStock({ balances: { Orange: { stock: bad } } }, 'Orange'), 'INVALID_BALANCE_DATA')
    }
  })

  it('ne lit QUE le stock, jamais la liquidité (que ce module ne touche pas)', () => {
    expect(readStoreStock({ balances: { Orange: { stock: 100, liquidite: 999999 } } }, 'Orange')).toBe(100)
  })
})

describe('TC-111-E — Validateurs de champs', () => {
  it('operationType ∈ {deposit, withdrawal}', () => {
    expect(validateOperationType('deposit')).toBe('deposit')
    expect(validateOperationType('withdrawal')).toBe('withdrawal')
    for (const bad of ['Dépôt', 'DEPOSIT', 'credit', '', null, 42, {}]) {
      expectCode(() => validateOperationType(bad), 'INVALID_OPERATION_TYPE')
    }
  })

  it('amount : entier sûr strictement positif', () => {
    expect(validateCollaborationAmount(1)).toBe(1)
    expect(validateCollaborationAmount(20000)).toBe(20000)
    for (const bad of [0, -1, 12.5, NaN, Infinity, '20000', null, undefined, Number.MAX_SAFE_INTEGER + 1]) {
      expectCode(() => validateCollaborationAmount(bad), 'INVALID_COLLABORATION_AMOUNT')
    }
  })

  it('collaborationId : chaîne non vide, rognée', () => {
    expect(validateCollaborationId('  collab-1  ')).toBe('collab-1')
    for (const bad of ['', '   ', null, 42]) {
      expectCode(() => validateCollaborationId(bad), 'INVALID_COLLABORATION_ID')
    }
  })

  it('storeId : refusé s’il n’est pas DÉJÀ normalisé (jamais rogné en silence)', () => {
    // Rogner ferait résoudre « store-A » depuis « store-A » : deux entrées
    // différentes ne doivent jamais désigner la même boutique.
    expect(validateStoreRef('store-A')).toBe('store-A')
    for (const bad of [' store-A', 'store-A ', '', '  ', null, 42]) {
      expectCode(() => validateStoreRef(bad), 'INVALID_STORE_ID')
    }
  })

  it('clientId : chaîne non vide, rognée', () => {
    expect(validateClientId(' client-1 ')).toBe('client-1')
    for (const bad of ['', '   ', null, undefined, 42]) {
      expectCode(() => validateClientId(bad), 'INVALID_CLIENT_ID')
    }
  })
})
