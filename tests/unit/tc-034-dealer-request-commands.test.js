/**
 * TC-034 — Tests unitaires : helpers purs des commandes Dealer (V2-7A)
 *
 * Périmètre : fonctions pures de functions/src/dealerRequests/shared.js
 *   et classe DealerRequestError de functions/src/errors.js.
 *
 * Aucune dépendance Firebase — aucun émulateur requis.
 * Exécuté via : npm run test:commands  (ou inclus dans test:unit).
 *
 * Sections :
 *   §ERR — DealerRequestError
 *   §VRI — validateRequestId
 *   §VRR — validateRejectionReason
 *   §VRD — validateRequestData
 *   §RCB — readCurrentBalance
 *   §GBF — getBalanceField
 *   §BAE — buildAuditEntry
 */

import { describe, it, expect } from 'vitest'
import { DealerRequestError, HTTP_CODES } from '../../functions/src/errors.js'
import {
  validateAuthUid,
  validateInputPayload,
  validateRequestId,
  validateRejectionReason,
  validateRequestData,
  readCurrentBalance,
  getBalanceField,
  buildAuditEntry,
} from '../../functions/src/dealerRequests/shared.js'

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const VALID_REQ_DATA = {
  status:          'pending',
  targetStoreId:   'store-A',
  requestType:     'stock_add',
  network:         'Orange',
  amount:          10000,
  dealerUid:       'dealer-uid',
  dealerName:      'Dealer Test',
  confirmedBy:     null,
  confirmedAt:     null,
  rejectedBy:      null,
  rejectedAt:      null,
  rejectionReason: null,
  previousBalance: null,
  newBalance:      null,
}

const VALID_BALANCE_DATA = {
  balances: {
    Orange:  { stock: 50000, liquidite: 30000 },
    Moov:    { stock: 10000, liquidite:  5000 },
    Telecel: { stock:  8000, liquidite:  2000 },
  },
  updatedAt: null,
}

// ─────────────────────────────────────────────────────────────────────────────
// §ERR — DealerRequestError
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-034-ERR — DealerRequestError', () => {
  it('[ERR-01] est instanceof Error', () => {
    const err = new DealerRequestError('INVALID_REQUEST_ID', 'msg')
    expect(err).toBeInstanceOf(Error)
  })

  it('[ERR-02] est instanceof DealerRequestError', () => {
    const err = new DealerRequestError('INVALID_REQUEST_ID', 'msg')
    expect(err).toBeInstanceOf(DealerRequestError)
  })

  it('[ERR-03] name vaut "DealerRequestError"', () => {
    const err = new DealerRequestError('PROFILE_NOT_FOUND', 'msg')
    expect(err.name).toBe('DealerRequestError')
  })

  it('[ERR-04] .code correspond au code passé', () => {
    const err = new DealerRequestError('BALANCE_OVERFLOW', 'msg')
    expect(err.code).toBe('BALANCE_OVERFLOW')
  })

  it('[ERR-05] .message correspond au message passé', () => {
    const err = new DealerRequestError('REQUEST_NOT_FOUND', 'Demande introuvable.')
    expect(err.message).toBe('Demande introuvable.')
  })

  it('[ERR-06] .httpCode est "unauthenticated" pour UNAUTHENTICATED', () => {
    expect(new DealerRequestError('UNAUTHENTICATED', '').httpCode).toBe('unauthenticated')
  })

  it('[ERR-07] .httpCode est "permission-denied" pour ROLE_FORBIDDEN', () => {
    expect(new DealerRequestError('ROLE_FORBIDDEN', '').httpCode).toBe('permission-denied')
  })

  it('[ERR-08] .httpCode est "not-found" pour REQUEST_NOT_FOUND', () => {
    expect(new DealerRequestError('REQUEST_NOT_FOUND', '').httpCode).toBe('not-found')
  })

  it('[ERR-09] .httpCode est "failed-precondition" pour REQUEST_NOT_PENDING', () => {
    expect(new DealerRequestError('REQUEST_NOT_PENDING', '').httpCode).toBe('failed-precondition')
  })

  it('[ERR-10] .httpCode est "invalid-argument" pour INVALID_REJECTION_REASON', () => {
    expect(new DealerRequestError('INVALID_REJECTION_REASON', '').httpCode).toBe('invalid-argument')
  })

  it('[ERR-11] .httpCode est "internal" pour TRANSACTION_FAILED', () => {
    expect(new DealerRequestError('TRANSACTION_FAILED', '').httpCode).toBe('internal')
  })

  it('[ERR-12] code inconnu → httpCode "internal"', () => {
    expect(new DealerRequestError('UNKNOWN_CODE_XYZ', '').httpCode).toBe('internal')
  })

  it('[ERR-13] HTTP_CODES couvre tous les codes attendus', () => {
    const expected = [
      'UNAUTHENTICATED', 'PROFILE_NOT_FOUND', 'PROFILE_INACTIVE',
      'ROLE_FORBIDDEN', 'STORE_ID_REQUIRED',
      'INVALID_REQUEST_ID', 'REQUEST_NOT_FOUND', 'REQUEST_NOT_PENDING',
      'REQUEST_STORE_MISMATCH', 'INVALID_REQUEST_DATA',
      'INVALID_REJECTION_REASON',
      'BALANCE_NOT_FOUND', 'INVALID_BALANCE_DATA', 'BALANCE_OVERFLOW',
      'TRANSACTION_FAILED',
    ]
    for (const code of expected) {
      expect(HTTP_CODES).toHaveProperty(code)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §VRI — validateRequestId
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-034-VRI — validateRequestId', () => {
  it('[VRI-01] chaîne valide → retourne la valeur trimée', () => {
    expect(validateRequestId('  req-123  ')).toBe('req-123')
  })

  it('[VRI-02] chaîne sans espaces → retourne la même valeur', () => {
    expect(validateRequestId('req-abc')).toBe('req-abc')
  })

  it('[VRI-03] null → INVALID_REQUEST_ID', () => {
    expect(() => validateRequestId(null)).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST_ID' })
    )
  })

  it('[VRI-04] undefined → INVALID_REQUEST_ID', () => {
    expect(() => validateRequestId(undefined)).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST_ID' })
    )
  })

  it('[VRI-05] chaîne vide → INVALID_REQUEST_ID', () => {
    expect(() => validateRequestId('')).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST_ID' })
    )
  })

  it('[VRI-06] chaîne d\'espaces seuls → INVALID_REQUEST_ID', () => {
    expect(() => validateRequestId('   ')).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST_ID' })
    )
  })

  it('[VRI-07] nombre → INVALID_REQUEST_ID', () => {
    expect(() => validateRequestId(42)).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST_ID' })
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §VRR — validateRejectionReason
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-034-VRR — validateRejectionReason', () => {
  it('[VRR-01] motif valide → retourne la valeur trimée', () => {
    expect(validateRejectionReason('  Motif valide  ')).toBe('Motif valide')
  })

  it('[VRR-02] exactement 3 caractères → ok', () => {
    expect(validateRejectionReason('abc')).toBe('abc')
  })

  it('[VRR-03] exactement 500 caractères → ok', () => {
    const reason = 'a'.repeat(500)
    expect(validateRejectionReason(reason)).toBe(reason)
  })

  it('[VRR-04] null → INVALID_REJECTION_REASON', () => {
    expect(() => validateRejectionReason(null)).toThrow(
      expect.objectContaining({ code: 'INVALID_REJECTION_REASON' })
    )
  })

  it('[VRR-05] undefined → INVALID_REJECTION_REASON', () => {
    expect(() => validateRejectionReason(undefined)).toThrow(
      expect.objectContaining({ code: 'INVALID_REJECTION_REASON' })
    )
  })

  it('[VRR-06] nombre → INVALID_REJECTION_REASON', () => {
    expect(() => validateRejectionReason(42)).toThrow(
      expect.objectContaining({ code: 'INVALID_REJECTION_REASON' })
    )
  })

  it('[VRR-07] chaîne trop courte (2 chars après trim) → INVALID_REJECTION_REASON', () => {
    expect(() => validateRejectionReason('ab')).toThrow(
      expect.objectContaining({ code: 'INVALID_REJECTION_REASON' })
    )
  })

  it('[VRR-08] espaces seuls (< 3 chars après trim) → INVALID_REJECTION_REASON', () => {
    expect(() => validateRejectionReason('   ')).toThrow(
      expect.objectContaining({ code: 'INVALID_REJECTION_REASON' })
    )
  })

  it('[VRR-09] chaîne trop longue (501 chars) → INVALID_REJECTION_REASON', () => {
    expect(() => validateRejectionReason('a'.repeat(501))).toThrow(
      expect.objectContaining({ code: 'INVALID_REJECTION_REASON' })
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §VRD — validateRequestData
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-034-VRD — validateRequestData', () => {
  it('[VRD-01] données valides → ne lance pas', () => {
    expect(() => validateRequestData(VALID_REQ_DATA, 'store-A')).not.toThrow()
  })

  it('[VRD-02] liquidity_add valide → ne lance pas', () => {
    expect(() => validateRequestData(
      { ...VALID_REQ_DATA, requestType: 'liquidity_add' },
      'store-A'
    )).not.toThrow()
  })

  it('[VRD-03] status "confirmed" → REQUEST_NOT_PENDING', () => {
    expect(() => validateRequestData(
      { ...VALID_REQ_DATA, status: 'confirmed' },
      'store-A'
    )).toThrow(expect.objectContaining({ code: 'REQUEST_NOT_PENDING' }))
  })

  it('[VRD-04] status "rejected" → REQUEST_NOT_PENDING', () => {
    expect(() => validateRequestData(
      { ...VALID_REQ_DATA, status: 'rejected' },
      'store-A'
    )).toThrow(expect.objectContaining({ code: 'REQUEST_NOT_PENDING' }))
  })

  it('[VRD-05] targetStoreId différent de actorStoreId → REQUEST_STORE_MISMATCH', () => {
    expect(() => validateRequestData(VALID_REQ_DATA, 'store-B')).toThrow(
      expect.objectContaining({ code: 'REQUEST_STORE_MISMATCH' })
    )
  })

  it('[VRD-06] requestType inconnu → INVALID_REQUEST_DATA', () => {
    expect(() => validateRequestData(
      { ...VALID_REQ_DATA, requestType: 'unknown_type' },
      'store-A'
    )).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST_DATA' }))
  })

  it('[VRD-07] réseau non-Orange → INVALID_REQUEST_DATA', () => {
    expect(() => validateRequestData(
      { ...VALID_REQ_DATA, network: 'Moov' },
      'store-A'
    )).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST_DATA' }))
  })

  it('[VRD-08] amount = 0 → INVALID_REQUEST_DATA', () => {
    expect(() => validateRequestData(
      { ...VALID_REQ_DATA, amount: 0 },
      'store-A'
    )).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST_DATA' }))
  })

  it('[VRD-09] amount négatif → INVALID_REQUEST_DATA', () => {
    expect(() => validateRequestData(
      { ...VALID_REQ_DATA, amount: -100 },
      'store-A'
    )).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST_DATA' }))
  })

  it('[VRD-10] amount décimal → INVALID_REQUEST_DATA', () => {
    expect(() => validateRequestData(
      { ...VALID_REQ_DATA, amount: 100.5 },
      'store-A'
    )).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST_DATA' }))
  })

  it('[VRD-11] amount string → INVALID_REQUEST_DATA', () => {
    expect(() => validateRequestData(
      { ...VALID_REQ_DATA, amount: '10000' },
      'store-A'
    )).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST_DATA' }))
  })

  it('[VRD-12] confirmedBy non-null → INVALID_REQUEST_DATA', () => {
    expect(() => validateRequestData(
      { ...VALID_REQ_DATA, confirmedBy: 'someone' },
      'store-A'
    )).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST_DATA' }))
  })

  it('[VRD-13] previousBalance non-null → INVALID_REQUEST_DATA', () => {
    expect(() => validateRequestData(
      { ...VALID_REQ_DATA, previousBalance: 0 },
      'store-A'
    )).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST_DATA' }))
  })

  it('[VRD-14] rejectionReason non-null → INVALID_REQUEST_DATA', () => {
    expect(() => validateRequestData(
      { ...VALID_REQ_DATA, rejectionReason: 'raison' },
      'store-A'
    )).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST_DATA' }))
  })

  it('[VRD-15] reqData null → INVALID_REQUEST_DATA', () => {
    expect(() => validateRequestData(null, 'store-A')).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST_DATA' })
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §RCB — readCurrentBalance
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-034-RCB — readCurrentBalance', () => {
  it('[RCB-01] stock_add → retourne balances.Orange.stock', () => {
    expect(readCurrentBalance(VALID_BALANCE_DATA, 'stock_add')).toBe(50000)
  })

  it('[RCB-02] liquidity_add → retourne balances.Orange.liquidite', () => {
    expect(readCurrentBalance(VALID_BALANCE_DATA, 'liquidity_add')).toBe(30000)
  })

  it('[RCB-03] solde = 0 accepté', () => {
    const data = { balances: { Orange: { stock: 0, liquidite: 0 } } }
    expect(readCurrentBalance(data, 'stock_add')).toBe(0)
  })

  it('[RCB-04] balanceData null → BALANCE_NOT_FOUND', () => {
    expect(() => readCurrentBalance(null, 'stock_add')).toThrow(
      expect.objectContaining({ code: 'BALANCE_NOT_FOUND' })
    )
  })

  it('[RCB-05] balances manquant → INVALID_BALANCE_DATA', () => {
    expect(() => readCurrentBalance({}, 'stock_add')).toThrow(
      expect.objectContaining({ code: 'INVALID_BALANCE_DATA' })
    )
  })

  it('[RCB-06] balances.Orange manquant → INVALID_BALANCE_DATA', () => {
    expect(() => readCurrentBalance({ balances: {} }, 'stock_add')).toThrow(
      expect.objectContaining({ code: 'INVALID_BALANCE_DATA' })
    )
  })

  it('[RCB-07] stock string → INVALID_BALANCE_DATA', () => {
    const data = { balances: { Orange: { stock: '50000', liquidite: 0 } } }
    expect(() => readCurrentBalance(data, 'stock_add')).toThrow(
      expect.objectContaining({ code: 'INVALID_BALANCE_DATA' })
    )
  })

  it('[RCB-08] stock négatif → INVALID_BALANCE_DATA', () => {
    const data = { balances: { Orange: { stock: -100, liquidite: 0 } } }
    expect(() => readCurrentBalance(data, 'stock_add')).toThrow(
      expect.objectContaining({ code: 'INVALID_BALANCE_DATA' })
    )
  })

  it('[RCB-09] liquidite NaN → INVALID_BALANCE_DATA', () => {
    const data = { balances: { Orange: { stock: 100, liquidite: NaN } } }
    expect(() => readCurrentBalance(data, 'liquidity_add')).toThrow(
      expect.objectContaining({ code: 'INVALID_BALANCE_DATA' })
    )
  })

  it('[RCB-10] liquidite undefined → INVALID_BALANCE_DATA', () => {
    const data = { balances: { Orange: { stock: 100 } } }
    expect(() => readCurrentBalance(data, 'liquidity_add')).toThrow(
      expect.objectContaining({ code: 'INVALID_BALANCE_DATA' })
    )
  })

  it('[RCB-11] préserve les autres réseaux (pas d\'erreur si Moov manquant)', () => {
    const data = { balances: { Orange: { stock: 100, liquidite: 200 } } }
    expect(readCurrentBalance(data, 'stock_add')).toBe(100)
  })

  it('[RCB-12] stock décimal (100.5) → INVALID_BALANCE_DATA', () => {
    const data = { balances: { Orange: { stock: 100.5, liquidite: 0 } } }
    expect(() => readCurrentBalance(data, 'stock_add')).toThrow(
      expect.objectContaining({ code: 'INVALID_BALANCE_DATA' })
    )
  })

  it('[RCB-13] stock Infinity → INVALID_BALANCE_DATA', () => {
    const data = { balances: { Orange: { stock: Infinity, liquidite: 0 } } }
    expect(() => readCurrentBalance(data, 'stock_add')).toThrow(
      expect.objectContaining({ code: 'INVALID_BALANCE_DATA' })
    )
  })

  it('[RCB-14] liquidite false → INVALID_BALANCE_DATA', () => {
    const data = { balances: { Orange: { stock: 100, liquidite: false } } }
    expect(() => readCurrentBalance(data, 'liquidity_add')).toThrow(
      expect.objectContaining({ code: 'INVALID_BALANCE_DATA' })
    )
  })

  it('[RCB-15] stock null → INVALID_BALANCE_DATA', () => {
    const data = { balances: { Orange: { stock: null, liquidite: 0 } } }
    expect(() => readCurrentBalance(data, 'stock_add')).toThrow(
      expect.objectContaining({ code: 'INVALID_BALANCE_DATA' })
    )
  })

  it('[RCB-16] Orange = {} (champ absent) → INVALID_BALANCE_DATA', () => {
    const data = { balances: { Orange: {} } }
    expect(() => readCurrentBalance(data, 'stock_add')).toThrow(
      expect.objectContaining({ code: 'INVALID_BALANCE_DATA' })
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §GBF — getBalanceField
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-034-GBF — getBalanceField', () => {
  it('[GBF-01] stock_add → "stock"', () => {
    expect(getBalanceField('stock_add')).toBe('stock')
  })

  it('[GBF-02] liquidity_add → "liquidite" (sans accent)', () => {
    expect(getBalanceField('liquidity_add')).toBe('liquidite')
  })

  it('[GBF-03] valeur inconnue → "liquidite" (branche else)', () => {
    // Ne pas dépendre du comportement exact pour les valeurs invalides
    // mais documenter qu'il ne lance pas
    expect(() => getBalanceField('unknown')).not.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §BAE — buildAuditEntry
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-034-BAE — buildAuditEntry', () => {
  const BASE_PARAMS = {
    action:          'DEALER_REQUEST_CONFIRMED',
    actorUid:        'admin-uid',
    actorEmail:      'admin@test.test',
    actorName:       'Admin Test',
    actorRole:       'store_admin',
    actorStoreId:    'store-A',
    requestId:       'req-1',
    reqData:         VALID_REQ_DATA,
    previousBalance: 50000,
    newBalance:      60000,
    rejectionReason: null,
    createdAt:       'mock-timestamp',
  }

  it('[BAE-01] retourne un objet avec action correcte', () => {
    const entry = buildAuditEntry(BASE_PARAMS)
    expect(entry.action).toBe('DEALER_REQUEST_CONFIRMED')
  })

  it('[BAE-02] contient actorUid, actorEmail, actorRole, actorStoreId', () => {
    const entry = buildAuditEntry(BASE_PARAMS)
    expect(entry.actorUid).toBe('admin-uid')
    expect(entry.actorEmail).toBe('admin@test.test')
    expect(entry.actorRole).toBe('store_admin')
    expect(entry.actorStoreId).toBe('store-A')
  })

  it('[BAE-03] contient dealerUid et dealerName issus de reqData', () => {
    const entry = buildAuditEntry(BASE_PARAMS)
    expect(entry.dealerUid).toBe('dealer-uid')
    expect(entry.dealerName).toBe('Dealer Test')
  })

  it('[BAE-04] contient requestType, network, amount issus de reqData', () => {
    const entry = buildAuditEntry(BASE_PARAMS)
    expect(entry.requestType).toBe('stock_add')
    expect(entry.network).toBe('Orange')
    expect(entry.amount).toBe(10000)
  })

  it('[BAE-05] previousBalance et newBalance corrects (confirm)', () => {
    const entry = buildAuditEntry(BASE_PARAMS)
    expect(entry.previousBalance).toBe(50000)
    expect(entry.newBalance).toBe(60000)
  })

  it('[BAE-06] rejectionReason null pour un confirm', () => {
    const entry = buildAuditEntry(BASE_PARAMS)
    expect(entry.rejectionReason).toBeNull()
  })

  it('[BAE-07] action DEALER_REQUEST_REJECTED avec motif', () => {
    const entry = buildAuditEntry({
      ...BASE_PARAMS,
      action:          'DEALER_REQUEST_REJECTED',
      previousBalance: null,
      newBalance:      null,
      rejectionReason: 'Motif de test',
    })
    expect(entry.action).toBe('DEALER_REQUEST_REJECTED')
    expect(entry.rejectionReason).toBe('Motif de test')
    expect(entry.previousBalance).toBeNull()
    expect(entry.newBalance).toBeNull()
  })

  it('[BAE-08] actorEmail null si non fourni', () => {
    const entry = buildAuditEntry({ ...BASE_PARAMS, actorEmail: undefined })
    expect(entry.actorEmail).toBeNull()
  })

  it('[BAE-09] actorName null si non fourni', () => {
    const entry = buildAuditEntry({ ...BASE_PARAMS, actorName: undefined })
    expect(entry.actorName).toBeNull()
  })

  it('[BAE-10] createdAt correspond au paramètre passé', () => {
    const entry = buildAuditEntry(BASE_PARAMS)
    expect(entry.createdAt).toBe('mock-timestamp')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §AUT — validateAuthUid
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-034-AUT — validateAuthUid', () => {
  it('[AUT-01] UID valide → retourne la valeur', () => {
    expect(validateAuthUid('abc123XYZ')).toBe('abc123XYZ')
  })

  it('[AUT-02] uid absent (undefined) → UNAUTHENTICATED', () => {
    expect(() => validateAuthUid(undefined)).toThrow(
      expect.objectContaining({ code: 'UNAUTHENTICATED' })
    )
  })

  it('[AUT-03] uid null → UNAUTHENTICATED', () => {
    expect(() => validateAuthUid(null)).toThrow(
      expect.objectContaining({ code: 'UNAUTHENTICATED' })
    )
  })

  it('[AUT-04] uid nombre → UNAUTHENTICATED', () => {
    expect(() => validateAuthUid(42)).toThrow(
      expect.objectContaining({ code: 'UNAUTHENTICATED' })
    )
  })

  it('[AUT-05] uid objet → UNAUTHENTICATED', () => {
    expect(() => validateAuthUid({ uid: 'abc' })).toThrow(
      expect.objectContaining({ code: 'UNAUTHENTICATED' })
    )
  })

  it('[AUT-06] uid chaîne vide → UNAUTHENTICATED', () => {
    expect(() => validateAuthUid('')).toThrow(
      expect.objectContaining({ code: 'UNAUTHENTICATED' })
    )
  })

  it('[AUT-07] uid espaces seuls ("   ") → UNAUTHENTICATED', () => {
    expect(() => validateAuthUid('   ')).toThrow(
      expect.objectContaining({ code: 'UNAUTHENTICATED' })
    )
  })

  it('[AUT-08] uid avec espace en tête (" uid") → UNAUTHENTICATED', () => {
    expect(() => validateAuthUid(' uid123')).toThrow(
      expect.objectContaining({ code: 'UNAUTHENTICATED' })
    )
  })

  it('[AUT-09] uid avec espace en fin ("uid ") → UNAUTHENTICATED', () => {
    expect(() => validateAuthUid('uid123 ')).toThrow(
      expect.objectContaining({ code: 'UNAUTHENTICATED' })
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §IPV — validateInputPayload
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-034-IPV — validateInputPayload', () => {
  // -- Types invalides --

  it('[IPV-01] payload null → INVALID_REQUEST_ID', () => {
    expect(() => validateInputPayload(null, ['requestId'])).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST_ID' })
    )
  })

  it('[IPV-02] payload tableau → INVALID_REQUEST_ID', () => {
    expect(() => validateInputPayload(['requestId'], ['requestId'])).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST_ID' })
    )
  })

  it('[IPV-03] payload nombre → INVALID_REQUEST_ID', () => {
    expect(() => validateInputPayload(42, ['requestId'])).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST_ID' })
    )
  })

  it('[IPV-04] payload string → INVALID_REQUEST_ID', () => {
    expect(() => validateInputPayload('requestId', ['requestId'])).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST_ID' })
    )
  })

  // -- Clés autorisées (confirm) --

  it('[IPV-05] { requestId } avec confirm keys → ne lance pas', () => {
    expect(() => validateInputPayload({ requestId: 'r-1' }, ['requestId'])).not.toThrow()
  })

  it('[IPV-06] payload confirm avec clé supplémentaire actorStoreId → INVALID_REQUEST_ID', () => {
    expect(() =>
      validateInputPayload({ requestId: 'r-1', actorStoreId: 'store-A' }, ['requestId'])
    ).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST_ID' }))
  })

  it('[IPV-07] payload confirm avec clé supplémentaire amount → INVALID_REQUEST_ID', () => {
    expect(() =>
      validateInputPayload({ requestId: 'r-1', amount: 10000 }, ['requestId'])
    ).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST_ID' }))
  })

  it('[IPV-08] payload confirm avec clé supplémentaire newBalance → INVALID_REQUEST_ID', () => {
    expect(() =>
      validateInputPayload({ requestId: 'r-1', newBalance: 999999 }, ['requestId'])
    ).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST_ID' }))
  })

  it('[IPV-09] payload confirm avec clé supplémentaire confirmedBy → INVALID_REQUEST_ID', () => {
    expect(() =>
      validateInputPayload({ requestId: 'r-1', confirmedBy: 'uid' }, ['requestId'])
    ).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST_ID' }))
  })

  // -- Clés autorisées (reject) --

  it('[IPV-10] { requestId, rejectionReason } avec reject keys → ne lance pas', () => {
    expect(() =>
      validateInputPayload({ requestId: 'r-1', rejectionReason: 'motif' }, ['requestId', 'rejectionReason'])
    ).not.toThrow()
  })

  it('[IPV-11] payload reject avec clé supplémentaire confirmedBy → INVALID_REQUEST_ID', () => {
    expect(() =>
      validateInputPayload(
        { requestId: 'r-1', rejectionReason: 'motif', confirmedBy: 'uid' },
        ['requestId', 'rejectionReason']
      )
    ).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST_ID' }))
  })

  it('[IPV-12] payload reject avec clé supplémentaire targetStoreId → INVALID_REQUEST_ID', () => {
    expect(() =>
      validateInputPayload(
        { requestId: 'r-1', rejectionReason: 'motif', targetStoreId: 'store-A' },
        ['requestId', 'rejectionReason']
      )
    ).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST_ID' }))
  })

  it('[IPV-13] payload reject avec clé supplémentaire amount → INVALID_REQUEST_ID', () => {
    expect(() =>
      validateInputPayload(
        { requestId: 'r-1', rejectionReason: 'motif', amount: 1 },
        ['requestId', 'rejectionReason']
      )
    ).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST_ID' }))
  })

  it('[IPV-14] payload reject avec clé supplémentaire rejectedBy → INVALID_REQUEST_ID', () => {
    expect(() =>
      validateInputPayload(
        { requestId: 'r-1', rejectionReason: 'motif', rejectedBy: 'uid' },
        ['requestId', 'rejectionReason']
      )
    ).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST_ID' }))
  })

  // -- Attaques par prototype (confirm keys) --

  it('[IPV-15] Object.create({ requestId }) → INVALID_REQUEST_ID (prototype non-Object.prototype)', () => {
    const payload = Object.create({ requestId: 'request-123' })
    expect(() => validateInputPayload(payload, ['requestId'])).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST_ID' })
    )
  })

  it('[IPV-16] Object.create({ actorStoreId }) + own requestId → INVALID_REQUEST_ID (prototype pollué)', () => {
    const payload = Object.create({ actorStoreId: 'store-other' })
    payload.requestId = 'request-123'
    expect(() => validateInputPayload(payload, ['requestId'])).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST_ID' })
    )
  })

  it('[IPV-17] instance de classe avec requestId → INVALID_REQUEST_ID', () => {
    class ConfirmPayload { constructor() { this.requestId = 'request-123' } }
    expect(() => validateInputPayload(new ConfirmPayload(), ['requestId'])).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST_ID' })
    )
  })

  it('[IPV-18] new Date() → INVALID_REQUEST_ID', () => {
    expect(() => validateInputPayload(new Date(), ['requestId'])).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST_ID' })
    )
  })

  it('[IPV-19] new Map → INVALID_REQUEST_ID', () => {
    expect(() => validateInputPayload(new Map([['requestId', 'request-123']]), ['requestId'])).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST_ID' })
    )
  })

  it('[IPV-20] new Set → INVALID_REQUEST_ID', () => {
    expect(() => validateInputPayload(new Set(['request-123']), ['requestId'])).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST_ID' })
    )
  })

  it('[IPV-21] Object.create(null) → INVALID_REQUEST_ID (null-prototype refusé)', () => {
    expect(() => validateInputPayload(Object.create(null), ['requestId'])).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST_ID' })
    )
  })

  it('[IPV-22] clé __proto__ propre via JSON.parse → INVALID_REQUEST_ID (clé hors whitelist)', () => {
    // JSON.parse crée un objet plain avec __proto__ comme propriété propre, non une mutation de prototype.
    const payload = JSON.parse('{"requestId":"request-123","__proto__":{"actorStoreId":"store-other"}}')
    expect(() => validateInputPayload(payload, ['requestId'])).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST_ID' })
    )
  })

  it('[IPV-23] clé constructor propre → INVALID_REQUEST_ID (clé hors whitelist)', () => {
    const payload = { requestId: 'request-123', constructor: { prototype: { actorStoreId: 'store-other' } } }
    expect(() => validateInputPayload(payload, ['requestId'])).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST_ID' })
    )
  })

  // -- Attaques par prototype (reject keys) --

  it('[IPV-24] Object.create({ requestId, rejectionReason }) → INVALID_REQUEST_ID (propriétés héritées)', () => {
    const payload = Object.create({ requestId: 'request-123', rejectionReason: 'Motif valide.' })
    expect(() => validateInputPayload(payload, ['requestId', 'rejectionReason'])).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST_ID' })
    )
  })

  it('[IPV-25] Object.create({ actorStoreId }) + own requestId + rejectionReason → INVALID_REQUEST_ID', () => {
    const payload = Object.create({ actorStoreId: 'store-other' })
    payload.requestId       = 'request-123'
    payload.rejectionReason = 'Motif valide.'
    expect(() => validateInputPayload(payload, ['requestId', 'rejectionReason'])).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST_ID' })
    )
  })

  it('[IPV-26] instance de classe avec requestId + rejectionReason → INVALID_REQUEST_ID', () => {
    class RejectPayload {
      constructor() { this.requestId = 'request-123'; this.rejectionReason = 'Motif valide.' }
    }
    expect(() => validateInputPayload(new RejectPayload(), ['requestId', 'rejectionReason'])).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST_ID' })
    )
  })
})
