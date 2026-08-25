/**
 * TC-016 — Module financialImpact importable sans Firebase
 *
 * Comportement à protéger :
 *   Le module src/utils/financialImpact.js doit être importable sans
 *   initialiser Firebase et doit exporter toutes les fonctions pures
 *   avec les mêmes comportements que les méthodes équivalentes de FirestoreService.
 *
 * Fonctions vérifiées :
 *   - validateFcfaAmount
 *   - normalizeNetworkBalances
 *   - adjustBalanceValue
 *   - applyLiquidityDelta
 *   - normalizeTransactionLabel
 *   - isDepositType / isWithdrawalType / isCreditType
 *   - isPendingStatus / isValidatedStatus
 *   - mapPaymentMethodToNetwork
 *   - getSettlementActionFromStatus
 *   - validateSettlementAction
 *   - applyInitialTransactionImpact
 *   - reverseInitialTransactionImpact
 *   - reversePendingOnlyImpact
 *   - reverseDirectValidatedImpact
 *   - reverseHistoryTransactionImpact
 *   - applySettlementImpact
 *
 * Fichiers source : src/utils/financialImpact.js
 * Interdictions   : aucun import Firebase, aucun accès réseau.
 */

import { describe, it, expect } from 'vitest'

// Aucun mock Firebase nécessaire — le module est pur
import {
  validateFcfaAmount,
  normalizeNetworkBalances,
  adjustBalanceValue,
  applyLiquidityDelta,
  normalizeTransactionLabel,
  isDepositType,
  isWithdrawalType,
  isCreditType,
  isPendingStatus,
  isValidatedStatus,
  mapPaymentMethodToNetwork,
  getSettlementActionFromStatus,
  validateSettlementAction,
  applyInitialTransactionImpact,
  reverseInitialTransactionImpact,
  reversePendingOnlyImpact,
  reverseDirectValidatedImpact,
  reverseHistoryTransactionImpact,
  applySettlementImpact
} from '../../src/utils/financialImpact.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseBalances = {
  Orange:  { stock: 1000, liquidite: 500 },
  Moov:    { stock:  800, liquidite: 300 },
  Telecel: { stock:  600, liquidite: 200 },
  Coris:   { stock:  400, liquidite: 100 },
  Sank:    { stock:  200, liquidite:  50 },
}

// ---------------------------------------------------------------------------
// TC-016-A : Toutes les fonctions sont définies et exportées
// ---------------------------------------------------------------------------

describe('TC-016-A — Exports du module financialImpact', () => {
  it('toutes les fonctions sont exportées comme fonctions', () => {
    expect(typeof validateFcfaAmount).toBe('function')
    expect(typeof normalizeNetworkBalances).toBe('function')
    expect(typeof adjustBalanceValue).toBe('function')
    expect(typeof applyLiquidityDelta).toBe('function')
    expect(typeof normalizeTransactionLabel).toBe('function')
    expect(typeof isDepositType).toBe('function')
    expect(typeof isWithdrawalType).toBe('function')
    expect(typeof isCreditType).toBe('function')
    expect(typeof isPendingStatus).toBe('function')
    expect(typeof isValidatedStatus).toBe('function')
    expect(typeof mapPaymentMethodToNetwork).toBe('function')
    expect(typeof getSettlementActionFromStatus).toBe('function')
    expect(typeof validateSettlementAction).toBe('function')
    expect(typeof applyInitialTransactionImpact).toBe('function')
    expect(typeof reverseInitialTransactionImpact).toBe('function')
    expect(typeof reversePendingOnlyImpact).toBe('function')
    expect(typeof reverseDirectValidatedImpact).toBe('function')
    expect(typeof reverseHistoryTransactionImpact).toBe('function')
    expect(typeof applySettlementImpact).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// TC-016-B : validateFcfaAmount
// ---------------------------------------------------------------------------

describe('TC-016-B — validateFcfaAmount', () => {
  it('[TC-016-smoke] accepte un entier positif', () => {
    expect(validateFcfaAmount(1000)).toBe(1000)
    expect(validateFcfaAmount('500')).toBe(500)
  })

  it('rejette zéro', () => {
    expect(() => validateFcfaAmount(0)).toThrow('Montant FCFA invalide')
  })

  it('rejette un montant négatif', () => {
    expect(() => validateFcfaAmount(-100)).toThrow('Montant FCFA invalide')
  })

  it('rejette un décimal', () => {
    expect(() => validateFcfaAmount(100.5)).toThrow('Montant FCFA invalide')
  })

  it('inclut le contexte dans le message d erreur', () => {
    expect(() => validateFcfaAmount('abc', 'monContexte')).toThrow('dans monContexte')
  })
})

// ---------------------------------------------------------------------------
// TC-016-C : normalizeNetworkBalances
// ---------------------------------------------------------------------------

describe('TC-016-C — normalizeNetworkBalances', () => {
  it('retourne les valeurs par défaut pour un objet vide', () => {
    const result = normalizeNetworkBalances({})
    expect(result).toHaveProperty('Orange')
    expect(result.Orange).toEqual({ stock: 0, liquidite: 0 })
    expect(result).toHaveProperty('Moov')
    expect(result).toHaveProperty('Telecel')
    expect(result).toHaveProperty('Coris')
    expect(result).toHaveProperty('Sank')
  })

  it('normalise un objet avec champ balances imbriqué', () => {
    const raw = { balances: { Orange: { stock: 500, liquidite: 200 } } }
    const result = normalizeNetworkBalances(raw)
    expect(result.Orange.stock).toBe(500)
    expect(result.Orange.liquidite).toBe(200)
  })

  it('ramène les valeurs négatives à zéro', () => {
    const raw = { Orange: { stock: -100, liquidite: -50 } }
    const result = normalizeNetworkBalances(raw)
    expect(result.Orange.stock).toBe(0)
    expect(result.Orange.liquidite).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// TC-016-D : adjustBalanceValue
// ---------------------------------------------------------------------------

describe('TC-016-D — adjustBalanceValue', () => {
  it('ajoute un delta positif au stock', () => {
    const result = adjustBalanceValue(baseBalances, 'Orange', 'stock', 100)
    expect(result.Orange.stock).toBe(1100)
    expect(result.Orange.liquidite).toBe(500) // inchangé
  })

  it('soustrait un delta négatif du stock', () => {
    const result = adjustBalanceValue(baseBalances, 'Orange', 'stock', -200)
    expect(result.Orange.stock).toBe(800)
  })

  it('lance une erreur si stock insuffisant', () => {
    expect(() => adjustBalanceValue(baseBalances, 'Orange', 'stock', -2000))
      .toThrow('Stock insuffisant pour Orange')
  })

  it('lance une erreur si liquidite insuffisante', () => {
    expect(() => adjustBalanceValue(baseBalances, 'Orange', 'liquidite', -1000))
      .toThrow('Liquidite insuffisant')
  })

  it('ne mute pas l objet original', () => {
    const original = { Orange: { stock: 1000, liquidite: 500 } }
    adjustBalanceValue(original, 'Orange', 'stock', -100)
    expect(original.Orange.stock).toBe(1000)
  })
})

// ---------------------------------------------------------------------------
// TC-016-E : applyLiquidityDelta
// ---------------------------------------------------------------------------

describe('TC-016-E — applyLiquidityDelta', () => {
  it('ajoute la liquidité au premier réseau pour delta positif', () => {
    const result = applyLiquidityDelta(baseBalances, 100)
    expect(result.Orange.liquidite).toBe(600)
  })

  it('consomme la liquidité progressivement pour delta négatif', () => {
    const result = applyLiquidityDelta(baseBalances, -600)
    // Orange: 500 consommé, Moov: 100 consommé
    expect(result.Orange.liquidite).toBe(0)
    expect(result.Moov.liquidite).toBe(200) // 300 - 100
  })

  it('lance une erreur si liquidité totale insuffisante', () => {
    expect(() => applyLiquidityDelta(baseBalances, -9999))
      .toThrow('Liquidite insuffisante')
  })
})

// ---------------------------------------------------------------------------
// TC-016-F : normalizeTransactionLabel et classificateurs
// ---------------------------------------------------------------------------

describe('TC-016-F — normalizeTransactionLabel et classificateurs', () => {
  it('normalise un libellé avec accents', () => {
    expect(normalizeTransactionLabel('Dépôt')).toBe('depot')
    expect(normalizeTransactionLabel('Crédit')).toBe('credit')
    expect(normalizeTransactionLabel('Retrait')).toBe('retrait')
  })

  it('isDepositType reconnaît Dépôt', () => {
    expect(isDepositType('Dépôt')).toBe(true)
    expect(isDepositType('depot')).toBe(true)
    expect(isDepositType('Retrait')).toBe(false)
  })

  it('isWithdrawalType reconnaît Retrait', () => {
    expect(isWithdrawalType('Retrait')).toBe(true)
    expect(isWithdrawalType('Dépôt')).toBe(false)
  })

  it('isCreditType reconnaît Crédit', () => {
    expect(isCreditType('Crédit')).toBe(true)
    expect(isCreditType('credit')).toBe(true)
    expect(isCreditType('Retrait')).toBe(false)
  })

  it('isPendingStatus reconnaît Non Terminées', () => {
    expect(isPendingStatus('Non Terminées')).toBe(true)
    expect(isPendingStatus('Validée')).toBe(false)
  })

  it('isValidatedStatus reconnaît Validée', () => {
    expect(isValidatedStatus('Validée')).toBe(true)
    expect(isValidatedStatus('Non Terminées')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// TC-016-G : mapPaymentMethodToNetwork
// ---------------------------------------------------------------------------

describe('TC-016-G — mapPaymentMethodToNetwork', () => {
  it('mappe Orange Money vers Orange', () => {
    expect(mapPaymentMethodToNetwork('Orange Money')).toBe('Orange')
  })

  it('mappe Cash vers Liquidite', () => {
    expect(mapPaymentMethodToNetwork('Cash')).toBe('Liquidite')
  })

  it('retourne la valeur inchangée si non reconnue', () => {
    expect(mapPaymentMethodToNetwork('Inconnu')).toBe('Inconnu')
  })
})

// ---------------------------------------------------------------------------
// TC-016-H : getSettlementActionFromStatus / validateSettlementAction
// ---------------------------------------------------------------------------

describe('TC-016-H — actions de règlement', () => {
  it('getSettlementActionFromStatus retourne payerPar', () => {
    expect(getSettlementActionFromStatus('Payé par Orange Money')).toBe('payerPar')
  })

  it('getSettlementActionFromStatus retourne rembourser', () => {
    expect(getSettlementActionFromStatus('Remboursé par Cash')).toBe('rembourser')
  })

  it('getSettlementActionFromStatus retourne null pour Validée', () => {
    expect(getSettlementActionFromStatus('Validée')).toBeNull()
  })

  it('validateSettlementAction ne lance pas d erreur pour une action compatible', () => {
    expect(() => validateSettlementAction('Retrait', 'payerPar')).not.toThrow()
    expect(() => validateSettlementAction('Dépôt', 'encaisser')).not.toThrow()
    expect(() => validateSettlementAction('Crédit', 'rembourser')).not.toThrow()
  })

  it('validateSettlementAction lance une erreur pour action incompatible', () => {
    expect(() => validateSettlementAction('Retrait', 'rembourser')).toThrow('non autorisee')
  })
})

// ---------------------------------------------------------------------------
// TC-016-I : applyInitialTransactionImpact — smoke test
// ---------------------------------------------------------------------------

describe('TC-016-I — applyInitialTransactionImpact (smoke)', () => {
  it('[TC-016-smoke] Dépôt Non Terminées diminue le stock', () => {
    const result = applyInitialTransactionImpact(baseBalances, {
      type: 'Dépôt', statut: 'Non Terminées', montant: 100, reseau: 'Orange'
    })
    expect(result.Orange.stock).toBe(900)
    expect(result.Orange.liquidite).toBe(500) // inchangée
  })

  it('Retrait Non Terminées augmente le stock', () => {
    const result = applyInitialTransactionImpact(baseBalances, {
      type: 'Retrait', statut: 'Non Terminées', montant: 100, reseau: 'Orange'
    })
    expect(result.Orange.stock).toBe(1100)
  })

  it('Crédit Non Terminées diminue le stock', () => {
    const result = applyInitialTransactionImpact(baseBalances, {
      type: 'Crédit', statut: 'Non Terminées', montant: 100, reseau: 'Orange'
    })
    expect(result.Orange.stock).toBe(900)
  })

  it('Dépôt Validée diminue le stock et augmente la liquidite', () => {
    const result = applyInitialTransactionImpact(baseBalances, {
      type: 'Dépôt', statut: 'Validée', montant: 100, reseau: 'Orange'
    })
    expect(result.Orange.stock).toBe(900)
    expect(result.Orange.liquidite).toBe(600)
  })

  it('Crédit Validée lance une erreur', () => {
    expect(() => applyInitialTransactionImpact(baseBalances, {
      type: 'Crédit', statut: 'Validée', montant: 100, reseau: 'Orange'
    })).toThrow('Les credits doivent etre rembourses via une methode de paiement')
  })
})

// ---------------------------------------------------------------------------
// TC-016-J : reverseInitialTransactionImpact
// ---------------------------------------------------------------------------

describe('TC-016-J — reverseInitialTransactionImpact', () => {
  it('Dépôt Non Terminées : restitue le stock', () => {
    const after = applyInitialTransactionImpact(baseBalances, {
      type: 'Dépôt', statut: 'Non Terminées', montant: 100, reseau: 'Orange'
    })
    const restored = reverseInitialTransactionImpact(after, {
      type: 'Dépôt', statut: 'Non Terminées', montant: 100, reseau: 'Orange'
    })
    expect(restored.Orange.stock).toBe(baseBalances.Orange.stock)
  })

  it('ne modifie pas les balances pour un statut Validée', () => {
    const result = reverseInitialTransactionImpact(baseBalances, {
      type: 'Dépôt', statut: 'Validée', montant: 100, reseau: 'Orange'
    })
    expect(result).toEqual(baseBalances)
  })
})

// ---------------------------------------------------------------------------
// TC-016-K : reverseHistoryTransactionImpact
// ---------------------------------------------------------------------------

describe('TC-016-K — reverseHistoryTransactionImpact', () => {
  it('lance une erreur si la transaction est déjà annulée', () => {
    expect(() => reverseHistoryTransactionImpact(baseBalances, {
      montant: 100, reseau: 'Orange', type: 'Dépôt', statut: 'Annulée'
    })).toThrow('déjà annulée')
  })

  it('Path 1 direct Dépôt Validée : restitue stock et liquidite', () => {
    const before = { Orange: { stock: 900, liquidite: 600 }, Moov: { stock: 800, liquidite: 300 }, Telecel: { stock: 600, liquidite: 200 }, Coris: { stock: 400, liquidite: 100 }, Sank: { stock: 200, liquidite: 50 } }
    const result = reverseHistoryTransactionImpact(before, {
      montant: 100, reseau: 'Orange', type: 'Dépôt', statut: 'Validée'
    })
    expect(result.Orange.stock).toBe(1000)
    expect(result.Orange.liquidite).toBe(500)
  })

  it('Path 2 sans règlement : annule uniquement l impact pending', () => {
    const after = applyInitialTransactionImpact(baseBalances, {
      type: 'Dépôt', statut: 'Non Terminées', montant: 200, reseau: 'Moov'
    })
    const restored = reverseHistoryTransactionImpact(after, {
      montant: 200, reseau: 'Moov', type: 'Dépôt', statut: 'Validée', validatedAt: '2024-01-01'
    })
    expect(restored.Moov.stock).toBe(baseBalances.Moov.stock)
  })
})

// ---------------------------------------------------------------------------
// TC-016-L : applySettlementImpact
// ---------------------------------------------------------------------------

describe('TC-016-L — applySettlementImpact', () => {
  it('Dépôt encaissé via Orange Money augmente le stock Orange', () => {
    const result = applySettlementImpact(baseBalances, {
      type: 'Dépôt', montant: 200
    }, 'Orange Money')
    expect(result.Orange.stock).toBe(1200)
  })

  it('Retrait payé via Cash diminue la liquidite', () => {
    const result = applySettlementImpact(baseBalances, {
      type: 'Retrait', montant: 100
    }, 'Cash')
    expect(result.Orange.liquidite).toBe(400) // 500 - 100
  })

  it('lance une erreur pour montant invalide', () => {
    expect(() => applySettlementImpact(baseBalances, {
      type: 'Dépôt', montant: 'abc'
    }, 'Orange Money')).toThrow('Montant FCFA invalide')
  })
})
