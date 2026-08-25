/**
 * Validation des modules purs de functions/src.
 * Exécuté par : npm test --prefix functions
 * Aucun émulateur requis — tests synchrones et async sur la logique pure.
 */

import assert from 'node:assert/strict'
import { DealerRequestError, HTTP_CODES } from './src/errors.js'
import {
  validateAuthUid,
  validateInputPayload,
  validateRequestId,
  validateRejectionReason,
  readCurrentBalance,
  getBalanceField,
  buildAuditEntry,
} from './src/dealerRequests/shared.js'
import { wrapCallable } from './src/callable.js'

// ── §1 DealerRequestError ────────────────────────────────────────────────────
{
  const err = new DealerRequestError('REQUEST_NOT_FOUND', 'Demande introuvable.')
  assert.equal(err.code, 'REQUEST_NOT_FOUND')
  assert.equal(err.httpCode, 'not-found')
  assert.equal(err.message, 'Demande introuvable.')
  assert.ok(err instanceof Error)

  const err2 = new DealerRequestError('UNAUTHENTICATED', 'Non connecté.')
  assert.equal(err2.httpCode, 'unauthenticated')
}

// ── §2 HTTP_CODES — tous les codes sont des codes HttpsError valides ─────────
{
  const validCodes = new Set([
    'ok', 'cancelled', 'unknown', 'invalid-argument', 'deadline-exceeded',
    'not-found', 'already-exists', 'permission-denied', 'resource-exhausted',
    'failed-precondition', 'aborted', 'out-of-range', 'unimplemented',
    'internal', 'unavailable', 'data-loss', 'unauthenticated',
  ])
  for (const [code, httpCode] of Object.entries(HTTP_CODES)) {
    assert.ok(validCodes.has(httpCode), `HTTP_CODES.${code} = "${httpCode}" n'est pas un code HttpsError valide`)
  }
}

// ── §3 validateAuthUid ───────────────────────────────────────────────────────
{
  assert.equal(validateAuthUid('uid-abc-123'), 'uid-abc-123')
  assert.throws(() => validateAuthUid(undefined), DealerRequestError)
  assert.throws(() => validateAuthUid(null),      DealerRequestError)
  assert.throws(() => validateAuthUid(42),         DealerRequestError)
  assert.throws(() => validateAuthUid(''),          DealerRequestError)
  assert.throws(() => validateAuthUid('   '),       DealerRequestError)
  assert.throws(() => validateAuthUid(' uid'),      DealerRequestError)
  assert.throws(() => validateAuthUid('uid '),      DealerRequestError)
}

// ── §4 validateInputPayload ──────────────────────────────────────────────────
{
  // Objet plain OK — retourne le payload validé
  const payload = validateInputPayload({ requestId: 'r-1' }, ['requestId'])
  assert.deepEqual(payload, { requestId: 'r-1' })

  const payload2 = validateInputPayload({ requestId: 'r-1', rejectionReason: 'Motif.' }, ['requestId', 'rejectionReason'])
  assert.equal(payload2.requestId, 'r-1')

  // Types invalides
  assert.throws(() => validateInputPayload(null,  ['requestId']), DealerRequestError)
  assert.throws(() => validateInputPayload([],    ['requestId']), DealerRequestError)
  assert.throws(() => validateInputPayload(42,    ['requestId']), DealerRequestError)
  assert.throws(() => validateInputPayload('req', ['requestId']), DealerRequestError)

  // Clé supplémentaire
  assert.throws(() => validateInputPayload({ requestId: 'r', extra: 'x' }, ['requestId']), DealerRequestError)

  // Attaques par prototype — prototype non Object.prototype
  assert.throws(() => validateInputPayload(Object.create({ requestId: 'r' }), ['requestId']),  DealerRequestError)
  assert.throws(() => validateInputPayload(Object.create(null),                ['requestId']),  DealerRequestError)
  assert.throws(() => validateInputPayload(new Date(),                         ['requestId']),  DealerRequestError)
  assert.throws(() => validateInputPayload(new Map([['requestId', 'r']]),      ['requestId']),  DealerRequestError)
  class P { constructor() { this.requestId = 'r' } }
  assert.throws(() => validateInputPayload(new P(),                            ['requestId']),  DealerRequestError)

  // Clé __proto__ propre (JSON.parse — ne mute pas le prototype)
  const withProtoKey = JSON.parse('{"requestId":"r","__proto__":{"evil":"x"}}')
  assert.throws(() => validateInputPayload(withProtoKey, ['requestId']), DealerRequestError)
}

// ── §5 validateRequestId ─────────────────────────────────────────────────────
{
  assert.equal(validateRequestId('req-123'), 'req-123')
  assert.equal(validateRequestId('  req-123  '), 'req-123')
  assert.throws(() => validateRequestId(''),    DealerRequestError)
  assert.throws(() => validateRequestId(null),  DealerRequestError)
  assert.throws(() => validateRequestId('   '), DealerRequestError)
}

// ── §6 validateRejectionReason ───────────────────────────────────────────────
{
  assert.equal(validateRejectionReason('Motif valide.'), 'Motif valide.')
  assert.equal(validateRejectionReason('  abc  '), 'abc')
  assert.throws(() => validateRejectionReason('ab'),  DealerRequestError)
  assert.throws(() => validateRejectionReason(null),  DealerRequestError)
  assert.throws(() => validateRejectionReason(42),    DealerRequestError)
  assert.throws(() => validateRejectionReason('x'.repeat(501)), DealerRequestError)
}

// ── §7 readCurrentBalance ────────────────────────────────────────────────────
{
  assert.equal(readCurrentBalance({ balances: { Orange: { stock: 50000 } } }, 'stock_add'), 50000)
  assert.equal(readCurrentBalance({ balances: { Orange: { liquidite: 30000 } } }, 'liquidity_add'), 30000)
  assert.throws(() => readCurrentBalance({ balances: { Orange: { stock: 100.5 } } }, 'stock_add'), DealerRequestError)
  assert.throws(() => readCurrentBalance({ balances: { Orange: { stock: -1 } } },   'stock_add'), DealerRequestError)
  assert.throws(() => readCurrentBalance({ balances: { Orange: { stock: Infinity } } }, 'stock_add'), DealerRequestError)
  assert.throws(() => readCurrentBalance({}, 'stock_add'), DealerRequestError)
  assert.throws(() => readCurrentBalance({ balances: {} }, 'stock_add'), DealerRequestError)
}

// ── §8 getBalanceField ───────────────────────────────────────────────────────
{
  assert.equal(getBalanceField('stock_add'), 'stock')
  assert.equal(getBalanceField('liquidity_add'), 'liquidite')
}

// ── §9 buildAuditEntry ───────────────────────────────────────────────────────
{
  const reqData = { dealerUid: 'd', dealerName: 'D', targetStoreId: 's', requestType: 'stock_add', network: 'Orange', amount: 1000 }
  const entry = buildAuditEntry({ action: 'DEALER_REQUEST_CONFIRMED', actorUid: 'u', actorEmail: null, actorName: null, actorRole: 'store_admin', actorStoreId: 's', requestId: 'r', reqData, previousBalance: 0, newBalance: 1000, rejectionReason: null, createdAt: new Date() })
  assert.equal(entry.action, 'DEALER_REQUEST_CONFIRMED')
  assert.equal(entry.amount, 1000)
  assert.equal(entry.newBalance, 1000)
}

// ── §10 wrapCallable — export et conversion d'erreurs ────────────────────────
{
  assert.equal(typeof wrapCallable, 'function')

  const wrappedOk = wrapCallable(async () => ({ success: true }), {})
  assert.equal(typeof wrappedOk, 'function')

  // Conversion DealerRequestError → HttpsError
  const wrappedFail = wrapCallable(async () => { throw new DealerRequestError('UNAUTHENTICATED', 'Non connecté.') }, {})
  try {
    await wrappedFail({})
    assert.fail('wrapCallable devrait lancer')
  } catch (e) {
    assert.equal(e.code, 'unauthenticated')
    assert.equal(e.message, 'Non connecté.')
    assert.deepEqual(e.details, { code: 'UNAUTHENTICATED' })
  }

  // Masquage des erreurs inconnues
  const wrappedUnknown = wrapCallable(async () => { throw new Error('secret interne') }, {})
  try {
    await wrappedUnknown({})
    assert.fail('wrapCallable devrait lancer')
  } catch (e) {
    assert.equal(e.code, 'internal')
    assert.ok(!e.message.includes('secret'), `Le message "${e.message}" ne doit pas contenir "secret"`)
  }
}

console.log('Functions validation OK — tous les modules purs et callable.js opérationnels.')
