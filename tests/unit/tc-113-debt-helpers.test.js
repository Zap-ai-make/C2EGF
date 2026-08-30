/**
 * TC-113 — Helpers purs des dettes internes et de la compensation.
 *
 * Ces fonctions décident de combien d'argent change de main. Les points les plus
 * sensibles, chacun avec sa section :
 *   • l'INVARIANT d'une dette : réglé + reste dû === montant initial ;
 *   • la RÉSERVATION par les tranches déclarées — sans elle, on solderait une
 *     dette plusieurs fois en déclarant en parallèle ;
 *   • le MOUVEMENT DE STOCK conditionnel : Mobile Money déplace du float,
 *     Cash et Banque non ;
 *   • les IDENTIFIANTS DÉTERMINISTES, socle de l'idempotence, et le jeu de
 *     caractères de la clé — elle finit dans un chemin Firestore.
 */

import { describe, it, expect } from 'vitest'
import {
  DEBT_STATUSES,
  SETTLEMENT_STATUSES,
  COMPENSATION_METHOD,
  validateDebtId,
  validateSettlementId,
  validateSettlementAmount,
  validateSettlementMethod,
  validateIdempotencyKey,
  deterministicSettlementId,
  deterministicCompensationId,
  deterministicMirrorId,
  readDebtState,
  nextDebtState,
  assertDebtOpen,
  sumDeclaredAmounts,
  availableToDeclare,
  settlementNetwork,
  settlementMovesStock,
  validateOppositeDebtPair,
  assertDistinctDebts,
  compensationCapacity,
  assertCompensationWithinCapacity,
} from '../../functions/src/collaborations/debtShared.js'
import { DEBT_SETTLEMENT_METHODS } from '../../functions/src/config/storeProfile.js'

const expectCode = (fn, code) => {
  try {
    fn()
  } catch (err) {
    expect(err.code).toBe(code)
    return
  }
  throw new Error(`Attendu : DealerRequestError ${code}, mais rien n'a été levé.`)
}

const debt = (overrides = {}) => ({
  debtorStoreId: 'store-A',
  creditorStoreId: 'store-B',
  originalAmount: 20000,
  settledAmount: 0,
  remainingAmount: 20000,
  status: DEBT_STATUSES.OPEN,
  ...overrides,
})

const declared = (amount) => ({ amount, settlementStatus: SETTLEMENT_STATUSES.DECLARED })

// ═════════════════════════════════════════════════════════════════════════════

describe('TC-113-A — Invariant de la dette', () => {
  it('une dette saine se relit', () => {
    expect(readDebtState(debt())).toMatchObject({ originalAmount: 20000, settledAmount: 0, remainingAmount: 20000 })
  })

  it('réglé + reste dû doit égaler le montant initial', () => {
    expectCode(() => readDebtState(debt({ settledAmount: 5000, remainingAmount: 20000 })), 'INVALID_DEBT_DATA')
    expectCode(() => readDebtState(debt({ settledAmount: 5000, remainingAmount: 10000 })), 'INVALID_DEBT_DATA')
  })

  it('une dette partiellement réglée reste cohérente', () => {
    expect(readDebtState(debt({ settledAmount: 8000, remainingAmount: 12000 }))).toMatchObject({
      settledAmount: 8000, remainingAmount: 12000,
    })
  })

  it('montants corrompus → refus', () => {
    for (const bad of [-1, 12.5, NaN, '20000', null, undefined]) {
      expectCode(() => readDebtState(debt({ remainingAmount: bad })), 'INVALID_DEBT_DATA')
    }
    expectCode(() => readDebtState(null), 'INVALID_DEBT_DATA')
  })
})

describe('TC-113-B — Imputation et statut dérivé', () => {
  it('imputation partielle → partially_settled', () => {
    expect(nextDebtState(debt(), 5000)).toEqual({
      originalAmount: 20000, settledAmount: 5000, remainingAmount: 15000,
      status: DEBT_STATUSES.PARTIALLY_SETTLED,
    })
  })

  it('imputation exacte du reste → settled', () => {
    expect(nextDebtState(debt({ settledAmount: 15000, remainingAmount: 5000 }), 5000)).toEqual({
      originalAmount: 20000, settledAmount: 20000, remainingAmount: 0,
      status: DEBT_STATUSES.SETTLED,
    })
  })

  it('le statut est DÉRIVÉ du reste dû, jamais transmis', () => {
    // Même en partant d'un statut mensonger, le résultat suit le calcul.
    const menteuse = debt({ status: DEBT_STATUSES.SETTLED, settledAmount: 0, remainingAmount: 20000 })
    expect(nextDebtState(menteuse, 20000).status).toBe(DEBT_STATUSES.SETTLED)
    expect(nextDebtState(menteuse, 1).status).toBe(DEBT_STATUSES.PARTIALLY_SETTLED)
  })

  it('dépasser le reste dû → refus', () => {
    expectCode(() => nextDebtState(debt(), 25000), 'SETTLEMENT_EXCEEDS_REMAINING')
  })

  it('l’invariant est préservé après imputation', () => {
    const next = nextDebtState(debt({ settledAmount: 3000, remainingAmount: 17000 }), 7000)
    expect(next.settledAmount + next.remainingAmount).toBe(next.originalAmount)
  })

  it('une dette déjà réglée n’accepte plus rien', () => {
    expectCode(
      () => assertDebtOpen(debt({ settledAmount: 20000, remainingAmount: 0, status: DEBT_STATUSES.SETTLED })),
      'DEBT_ALREADY_SETTLED',
    )
  })

  it('une dette à reste nul est refusée même si son statut dit le contraire', () => {
    expectCode(
      () => assertDebtOpen(debt({ settledAmount: 20000, remainingAmount: 0, status: DEBT_STATUSES.OPEN })),
      'DEBT_ALREADY_SETTLED',
    )
  })
})

describe('TC-113-C — Réservation par les tranches déclarées', () => {
  it('somme les tranches DÉCLARÉES uniquement', () => {
    const docs = [
      declared(5000),
      declared(3000),
      { amount: 9999, settlementStatus: SETTLEMENT_STATUSES.CONFIRMED },
      { amount: 8888, settlementStatus: SETTLEMENT_STATUSES.REJECTED },
    ]
    expect(sumDeclaredAmounts(docs)).toBe(8000)
  })

  it('accepte des snapshots Firestore comme des objets bruts', () => {
    const snaps = [{ data: () => declared(5000) }, { data: () => declared(2000) }]
    expect(sumDeclaredAmounts(snaps)).toBe(7000)
    expect(sumDeclaredAmounts({ docs: snaps })).toBe(7000)
  })

  it('aucune tranche → 0', () => {
    expect(sumDeclaredAmounts([])).toBe(0)
    expect(sumDeclaredAmounts(undefined)).toBe(0)
  })

  it('un montant corrompu dans une tranche déclarée fait échouer le calcul', () => {
    expectCode(() => sumDeclaredAmounts([declared(5000), declared(-1)]), 'INVALID_SETTLEMENT_AMOUNT')
  })

  it('le disponible retire la réservation du reste dû', () => {
    // 20 000 dus, 10 000 déjà déclarés → seuls 10 000 restent déclarables.
    expect(availableToDeclare(20000, 10000)).toBe(10000)
    expect(availableToDeclare(20000, 0)).toBe(20000)
  })

  it('le disponible ne devient jamais négatif', () => {
    expect(availableToDeclare(5000, 9000)).toBe(0)
  })

  it('un rejet libère la réservation (les rejetées ne comptent pas)', () => {
    const apresRejet = [{ amount: 5000, settlementStatus: SETTLEMENT_STATUSES.REJECTED }]
    expect(availableToDeclare(20000, sumDeclaredAmounts(apresRejet))).toBe(20000)
  })
})

describe('TC-113-D — Mouvement de stock : Mobile Money oui, Cash et Banque non', () => {
  const NETWORKS = ['Orange']

  it('Orange Money déplace réellement du float', () => {
    expect(settlementNetwork('Orange Money')).toBe('Orange')
    expect(settlementMovesStock('Orange Money', NETWORKS)).toBe(true)
  })

  it('Cash ne bouge aucun solde (l’argent circule hors système)', () => {
    expect(settlementNetwork('Cash')).toBe('Liquidite')
    expect(settlementMovesStock('Cash', NETWORKS)).toBe(false)
  })

  it('Banque ne bouge aucun solde', () => {
    expect(settlementMovesStock('Banque', NETWORKS)).toBe(false)
  })

  it('la compensation ne bouge jamais de stock', () => {
    expect(settlementMovesStock(COMPENSATION_METHOD, NETWORKS)).toBe(false)
  })

  it('une méthode d’un réseau NON activé chez ce client ne bouge rien', () => {
    // Moov Money mappe sur Moov, absent de networks.enabled → aucun solde à créditer.
    expect(settlementNetwork('Moov Money')).toBe('Moov')
    expect(settlementMovesStock('Moov Money', NETWORKS)).toBe(false)
  })

  it('un code historique inconnu ne bouge rien plutôt que de planter', () => {
    for (const legacy of ['especes', 'transfert', 'retour_stock', 'depot_bancaire']) {
      expect(settlementMovesStock(legacy, NETWORKS)).toBe(false)
    }
  })

  it('en profil multi-réseaux, chaque méthode suit son réseau', () => {
    const multi = ['Orange', 'Moov', 'Telecel']
    expect(settlementMovesStock('Moov Money', multi)).toBe(true)
    expect(settlementMovesStock('Telecel Money', multi)).toBe(true)
    expect(settlementMovesStock('Coris Money', multi)).toBe(false)
    expect(settlementMovesStock('Cash', multi)).toBe(false)
  })
})

describe('TC-113-E — Méthodes déclarables (profil + Banque)', () => {
  it('les méthodes du profil passent', () => {
    expect(validateSettlementMethod('Orange Money')).toBe('Orange Money')
    expect(validateSettlementMethod('Cash')).toBe('Cash')
  })

  it('Banque est déclarable pour une dette', () => {
    expect(validateSettlementMethod('Banque')).toBe('Banque')
    expect(DEBT_SETTLEMENT_METHODS).toContain('Banque')
  })

  it('une méthode hors profil est refusée', () => {
    expectCode(() => validateSettlementMethod('Moov Money'), 'INVALID_SETTLEMENT_METHOD')
  })

  it('« compensation » n’est PAS déclarable par ce chemin', () => {
    expectCode(() => validateSettlementMethod(COMPENSATION_METHOD), 'INVALID_SETTLEMENT_METHOD')
  })

  it('les codes historiques ne sont plus proposables à la saisie', () => {
    for (const legacy of ['especes', 'transfert', 'retour_stock']) {
      expectCode(() => validateSettlementMethod(legacy), 'INVALID_SETTLEMENT_METHOD')
    }
  })
})

describe('TC-113-F — Identifiants déterministes et clé d’idempotence', () => {
  it('même acteur + même dette + même clé → même identifiant', () => {
    const a = deterministicSettlementId('debt-1', 'uid-1', 'k1')
    const b = deterministicSettlementId('debt-1', 'uid-1', 'k1')
    expect(a).toBe(b)
    expect(a).toBe('dst_debt-1_uid-1_k1')
  })

  it('les trois formes ne peuvent pas entrer en collision', () => {
    expect(deterministicSettlementId('d1', 'u', 'k')).toMatch(/^dst_/)
    expect(deterministicCompensationId('d1', 'u', 'k')).toMatch(/^dcp_/)
    expect(deterministicMirrorId('d1', 'dcp_d1_u_k')).toMatch(/^comp_/)
    const ids = new Set([
      deterministicSettlementId('d1', 'u', 'k'),
      deterministicCompensationId('d1', 'u', 'k'),
      deterministicMirrorId('d1', 'dcp_d1_u_k'),
    ])
    expect(ids.size).toBe(3)
  })

  it('changer un seul composant change l’identifiant', () => {
    const base = deterministicSettlementId('debt-1', 'uid-1', 'k1')
    expect(deterministicSettlementId('debt-2', 'uid-1', 'k1')).not.toBe(base)
    expect(deterministicSettlementId('debt-1', 'uid-2', 'k1')).not.toBe(base)
    expect(deterministicSettlementId('debt-1', 'uid-1', 'k2')).not.toBe(base)
  })

  it('le miroir porte l’id de la dette SOURCE, pas celui de sa destination', () => {
    // Il vit sous D2 mais référence D1 : c'est ce qui le rend traçable.
    expect(deterministicMirrorId('D1', 'dcp_D1_uid_k1')).toBe('comp_D1_dcp_D1_uid_k1')
  })

  it('la clé accepte le base36 généré par le front', () => {
    expect(validateIdempotencyKey('m1x2y3z4abc')).toBe('m1x2y3z4abc')
    expect(validateIdempotencyKey('  k-1_2  ')).toBe('k-1_2')
  })

  it('une clé contenant « / » ou « . » est REFUSÉE : elle casserait le chemin Firestore', () => {
    // dst_{debtId}_{uid}_{clé} devient un id de document. Un « / » en ferait un
    // chemin de sous-collection, et la tranche s'écrirait ailleurs que prévu ;
    // « . » et « .. » sont des identifiants interdits par Firestore.
    expectCode(() => validateIdempotencyKey('a/b'), 'INVALID_IDEMPOTENCY_KEY')
    expectCode(() => validateIdempotencyKey('../escape'), 'INVALID_IDEMPOTENCY_KEY')
    expectCode(() => validateIdempotencyKey('a.b'), 'INVALID_IDEMPOTENCY_KEY')
    expectCode(() => validateIdempotencyKey('clé accentuée'), 'INVALID_IDEMPOTENCY_KEY')
  })

  it('le préfixe obligatoire met l’identifiant hors de portée des id réservés', () => {
    // Firestore réserve les identifiants de la forme __…__. Une clé à underscores
    // est donc inoffensive ici : l'id composé commence TOUJOURS par dst_/dcp_/comp_,
    // il ne peut pas commencer par « __ ». D'où un jeu de caractères qui autorise
    // « _ » sans exposer au motif réservé.
    expect(validateIdempotencyKey('__proto__')).toBe('__proto__')
    expect(deterministicSettlementId('d1', 'u1', '__proto__')).toBe('dst_d1_u1___proto__')
    expect(deterministicSettlementId('d1', 'u1', '__proto__').startsWith('__')).toBe(false)
  })

  it('clé vide, trop longue ou non textuelle → refus', () => {
    expectCode(() => validateIdempotencyKey(''), 'INVALID_IDEMPOTENCY_KEY')
    expectCode(() => validateIdempotencyKey('   '), 'INVALID_IDEMPOTENCY_KEY')
    expectCode(() => validateIdempotencyKey('x'.repeat(101)), 'INVALID_IDEMPOTENCY_KEY')
    expectCode(() => validateIdempotencyKey(null), 'INVALID_IDEMPOTENCY_KEY')
    expectCode(() => validateIdempotencyKey(42), 'INVALID_IDEMPOTENCY_KEY')
  })

  it('une clé de 100 caractères passe (borne haute incluse)', () => {
    expect(validateIdempotencyKey('a'.repeat(100))).toHaveLength(100)
  })
})

describe('TC-113-G — Compensation : la paire opposée', () => {
  const D1 = { debtorStoreId: 'store-A', creditorStoreId: 'store-B' }

  it('une vraie paire opposée passe', () => {
    expect(validateOppositeDebtPair(D1, { debtorStoreId: 'store-B', creditorStoreId: 'store-A' })).toBe(true)
  })

  it('une dette de MÊME sens n’est pas opposée', () => {
    expectCode(() => validateOppositeDebtPair(D1, { debtorStoreId: 'store-A', creditorStoreId: 'store-B' }), 'NOT_OPPOSITE_PAIR')
  })

  it('une dette impliquant un TIERS n’est pas opposée', () => {
    expectCode(() => validateOppositeDebtPair(D1, { debtorStoreId: 'store-B', creditorStoreId: 'store-C' }), 'NOT_OPPOSITE_PAIR')
    expectCode(() => validateOppositeDebtPair(D1, { debtorStoreId: 'store-C', creditorStoreId: 'store-A' }), 'NOT_OPPOSITE_PAIR')
  })

  it('compenser une dette avec elle-même est refusé', () => {
    expectCode(() => assertDistinctDebts('debt-1', 'debt-1'), 'INVALID_OPPOSITE_DEBT')
    expect(assertDistinctDebts('debt-1', 'debt-2')).toBe(true)
  })
})

describe('TC-113-H — Compensation : le plafond', () => {
  it('plafond = le plus petit des deux restes disponibles', () => {
    // A doit 20 000 à B, B doit 12 000 à A → on ne peut compenser que 12 000.
    expect(compensationCapacity({ remainingD1: 20000, remainingD2: 12000 })).toBe(12000)
    expect(compensationCapacity({ remainingD1: 8000, remainingD2: 30000 })).toBe(8000)
  })

  it('les tranches en attente des DEUX dettes réduisent le plafond', () => {
    expect(compensationCapacity({ remainingD1: 20000, pendingD1: 15000, remainingD2: 12000 })).toBe(5000)
    expect(compensationCapacity({ remainingD1: 20000, remainingD2: 12000, pendingD2: 10000 })).toBe(2000)
  })

  it('plafond nul quand une des deux dettes est saturée', () => {
    expect(compensationCapacity({ remainingD1: 20000, pendingD1: 20000, remainingD2: 12000 })).toBe(0)
    expect(compensationCapacity({ remainingD1: 0, remainingD2: 12000 })).toBe(0)
  })

  it('dépasser le plafond → refus', () => {
    const capacity = compensationCapacity({ remainingD1: 20000, remainingD2: 12000 })
    expect(assertCompensationWithinCapacity(12000, capacity)).toBe(12000)
    expectCode(() => assertCompensationWithinCapacity(12001, capacity), 'COMPENSATION_EXCEEDS_REMAINING')
  })

  it('un montant invalide est rejeté avant le plafond', () => {
    expectCode(() => assertCompensationWithinCapacity(0, 12000), 'INVALID_SETTLEMENT_AMOUNT')
    expectCode(() => assertCompensationWithinCapacity(-5, 12000), 'INVALID_SETTLEMENT_AMOUNT')
  })
})

describe('TC-113-I — Validateurs d’identifiants', () => {
  it('debtId et settlementId : chaîne non vide, rognée', () => {
    expect(validateDebtId('  debt-1 ')).toBe('debt-1')
    expect(validateSettlementId(' dst_x ')).toBe('dst_x')
    for (const bad of ['', '  ', null, 42]) {
      expectCode(() => validateDebtId(bad), 'INVALID_DEBT_ID')
      expectCode(() => validateSettlementId(bad), 'INVALID_SETTLEMENT_ID')
    }
  })

  it('montant de tranche : entier sûr strictement positif', () => {
    expect(validateSettlementAmount(5000)).toBe(5000)
    for (const bad of [0, -1, 12.5, NaN, '5000', null]) {
      expectCode(() => validateSettlementAmount(bad), 'INVALID_SETTLEMENT_AMOUNT')
    }
  })
})
