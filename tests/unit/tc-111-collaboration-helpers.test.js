/**
 * TC-111 — Helpers purs des collaborations inter-boutiques.
 *
 * Testés sans Firestore : ce sont eux qui portent la règle financière, et une
 * erreur ici se paie en argent réel. Le cœur du fichier est la TABLE DE VÉRITÉ
 * `supplierResourceField` × `debtDirection` : quelle ressource la fournisseuse
 * cède, et vers qui la dette pointe.
 *
 * Sémantique — LA FOURNISSEUSE SE DÉPOUILLE DANS LES DEUX SENS :
 *   dépôt   → elle cède du STOCK (elle envoie l'e-float depuis sa SIM)
 *   retrait → elle cède de la LIQUIDITÉ (elle avance le cash remis au client)
 *   et, dans les deux cas, LA DEMANDEUSE DOIT.
 *
 * ⚠ CE FICHIER A CHANGÉ DE RÈGLE (chantier collaborations, 09/2026).
 *   Avant, un retrait faisait MONTER le stock du fournisseur et la dette
 *   pointait de la fournisseuse vers la demandeuse. Ce modèle ne coûtait rien
 *   au fournisseur sur un retrait — donc rien à exiger de lui, donc rien à
 *   filtrer — et laissait la demandeuse créancière d'une opération qu'elle
 *   avait sollicitée. Aucune dette n'existait en base au changement.
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
  supplierResourceField,
  supplierBalanceDelta,
  debtDirection,
  nextSupplierBalance,
  readStoreStock,
  readStoreBalance,
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

describe('TC-111-A — Table de vérité : ressource cédée × sens de la dette', () => {
  // L'invariant du module tient en deux lignes. Les voir ensemble est le but.
  const TRUTH_TABLE = [
    {
      operationType: 'deposit',
      amount: 20000,
      resourceField: 'stock',
      pourquoi: 'elle envoie l’e-float depuis sa SIM ; la demandeuse encaisse le cash',
    },
    {
      operationType: 'withdrawal',
      amount: 15000,
      resourceField: 'liquidite',
      pourquoi: 'elle avance le cash remis au client ; la demandeuse recoit le float',
    },
  ]

  for (const row of TRUTH_TABLE) {
    it(`${row.operationType} : la fournisseuse cede ${row.resourceField} — ${row.pourquoi}`, () => {
      expect(supplierResourceField(row.operationType)).toBe(row.resourceField)
      // Toujours négatif : elle cède, elle ne reçoit jamais.
      expect(supplierBalanceDelta(row.operationType, row.amount)).toBe(-row.amount)
      expect(debtDirection(row.operationType, { requestingStoreId: A, supplierStoreId: B })).toEqual({
        debtorStoreId: A,
        creditorStoreId: B,
      })
    })
  }

  it('la DEMANDEUSE doit, quelle que soit l’opération', () => {
    // Formulation indépendante de la table : c'est LA règle que le gérant
    // énonce, et celle qu'un refactor ne doit jamais retourner.
    for (const operationType of ['deposit', 'withdrawal']) {
      expect(debtDirection(operationType, { requestingStoreId: A, supplierStoreId: B }))
        .toEqual({ debtorStoreId: A, creditorStoreId: B })
    }
  })

  it('le sens ne dépend pas de l’ordre des arguments, mais des rôles', () => {
    // Inverser demandeuse et fournisseuse inverse la dette : le rôle décide,
    // pas la position dans l'objet.
    expect(debtDirection('deposit', { requestingStoreId: B, supplierStoreId: A }))
      .toEqual({ debtorStoreId: B, creditorStoreId: A })
  })

  it('une collaboration avec soi-même est refusée', () => {
    expectCode(() => debtDirection('deposit', { requestingStoreId: A, supplierStoreId: A }), 'SAME_STORE_COLLABORATION')
  })

  it('debtDirection valide ses entrées', () => {
    // Le sens ne dépend plus du type d'opération, mais un type inconnu reste
    // refusé : il ne doit jamais produire une dette silencieuse.
    expectCode(() => debtDirection('transfer', { requestingStoreId: A, supplierStoreId: B }), 'INVALID_OPERATION_TYPE')
    expectCode(() => debtDirection('deposit', { requestingStoreId: '', supplierStoreId: B }), 'INVALID_STORE_ID')
    expectCode(() => debtDirection('deposit'), 'INVALID_STORE_ID')
  })

  it('supplierResourceField refuse un type inconnu', () => {
    expectCode(() => supplierResourceField('transfer'), 'INVALID_OPERATION_TYPE')
  })
})

describe('TC-111-B — Contrôle de suffisance : les DEUX sens', () => {
  it('dépôt de 20 000 sur un stock de 50 000 → 30 000', () => {
    expect(nextSupplierBalance('deposit', 20000, 50000)).toBe(30000)
  })

  it('dépôt de 20 000 sur un stock de 10 000 → refus, rien ne bouge', () => {
    expectCode(() => nextSupplierBalance('deposit', 20000, 10000), 'INSUFFICIENT_SUPPLIER_BALANCE')
  })

  it('dépôt exactement égal au stock → autorisé, solde à 0', () => {
    expect(nextSupplierBalance('deposit', 20000, 20000)).toBe(0)
  })

  it('retrait de 15 000 sur une liquidité de 40 000 → 25 000', () => {
    // Le retrait DÉBITE désormais lui aussi. C'est le renversement de règle.
    expect(nextSupplierBalance('withdrawal', 15000, 40000)).toBe(25000)
  })

  it('retrait de 15 000 sur une liquidité de 0 → refus', () => {
    // Sous l'ancienne règle, ce cas rendait 15 000 sans le moindre contrôle.
    expectCode(() => nextSupplierBalance('withdrawal', 15000, 0), 'INSUFFICIENT_SUPPLIER_LIQUIDITY')
  })

  it('le code d’erreur nomme la ressource qui manque', () => {
    // « Stock insuffisant » affiché pour une caisse vide enverrait le gérant
    // chercher au mauvais endroit.
    expectCode(() => nextSupplierBalance('deposit', 100, 0), 'INSUFFICIENT_SUPPLIER_BALANCE')
    expectCode(() => nextSupplierBalance('withdrawal', 100, 0), 'INSUFFICIENT_SUPPLIER_LIQUIDITY')
  })

  it('un solde de départ corrompu n’est jamais « réparé » en silence', () => {
    expectCode(() => nextSupplierBalance('deposit', 100, -5), 'INVALID_BALANCE_DATA')
    expectCode(() => nextSupplierBalance('deposit', 100, 12.5), 'INVALID_BALANCE_DATA')
    expectCode(() => nextSupplierBalance('deposit', 100, NaN), 'INVALID_BALANCE_DATA')
    expectCode(() => nextSupplierBalance('deposit', 100, undefined), 'INVALID_BALANCE_DATA')
  })

  it('un type d’opération inconnu est refusé avant tout calcul', () => {
    expectCode(() => nextSupplierBalance('transfer', 100, 1000), 'INVALID_OPERATION_TYPE')
  })
})

describe('TC-111-B bis — readStoreBalance lit le champ qu’on lui nomme', () => {
  const doc = { balances: { Orange: { stock: 50000, liquidite: 12000 } } }

  it('sépare bien les deux champs du même réseau', () => {
    expect(readStoreBalance(doc, 'Orange', 'stock')).toBe(50000)
    expect(readStoreBalance(doc, 'Orange', 'liquidite')).toBe(12000)
  })

  it('par défaut c’est le stock, et readStoreStock en est l’alias', () => {
    expect(readStoreBalance(doc, 'Orange')).toBe(50000)
    expect(readStoreStock(doc, 'Orange')).toBe(50000)
  })

  it('un champ absent vaut 0, une valeur corrompue est refusée', () => {
    expect(readStoreBalance({ balances: { Orange: { stock: 10 } } }, 'Orange', 'liquidite')).toBe(0)
    expectCode(
      () => readStoreBalance({ balances: { Orange: { liquidite: -5 } } }, 'Orange', 'liquidite'),
      'INVALID_BALANCE_DATA',
    )
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
