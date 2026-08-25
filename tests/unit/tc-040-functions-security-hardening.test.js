/**
 * TC-040 — Sécurisation Functions : logs défensifs et garde de projet Firebase.
 *
 * §LOG    — buildSafeUnexpectedErrorLog : allow-list stricte, aucune fuite.
 * §PRIM   — Primitives exotiques (Symbol, BigInt, boolean, function, sans prototype).
 * §HOSTILE — Getters hostiles et Proxies hostiles comme erreur ou contexte.
 * §WRITER — writeSafeErrorLog : injection de writer, writer qui lève, form exacte.
 * §WRAP   — wrapCallable : erreur hostile, writer spy, aucune fuite client.
 * §GUARD  — assertFirebaseProject : rejet de tout projet non-demo ou production.
 */

import { describe, it, expect, vi } from 'vitest'
import { buildSafeUnexpectedErrorLog, writeSafeErrorLog } from '../../functions/src/logging.js'
import { wrapCallable } from '../../functions/src/callable.js'
import { DealerRequestError } from '../../functions/src/errors.js'
import {
  assertFirebaseProject,
  AssertFirebaseProjectError,
} from '../../scripts/lib/assertFirebaseProject.mjs'

// ── Constante : forme exacte attendue de la sortie ───────────────────────────
const EXPECTED_KEYS = ['action', 'requestId', 'actorUid', 'actorStoreId', 'result', 'errorCode', 'errorType']
const FORBIDDEN_KEYS = ['message', 'stack', 'cause', 'config', 'request', 'response', 'token', 'auth', 'claims', 'payload']
const FORBIDDEN_STRINGS = ['SECRET', 'token=', 'C:\\Users', 'node_modules', 'GETTER_SECRET', 'PROXY_SECRET', 'REQUEST_ID_SECRET', 'PROTOTYPE_SECRET']

function assertSafeLog(log) {
  expect(Object.keys(log)).toEqual(EXPECTED_KEYS)
  expect(log.result).toBe('error')
  expect(log.errorCode).toBe('UNEXPECTED_INTERNAL_ERROR')
  const serialized = JSON.stringify(log)
  for (const key of FORBIDDEN_KEYS) {
    expect(serialized).not.toContain(`"${key}"`)
  }
  for (const str of FORBIDDEN_STRINGS) {
    expect(serialized).not.toContain(str)
  }
}

// ── §LOG : buildSafeUnexpectedErrorLog — cas standard ────────────────────────

describe('TC-040 §LOG buildSafeUnexpectedErrorLog', () => {
  it('[LOG-01] Error avec message et stack secrets → pas de fuite', () => {
    const err = new Error('SECRET_INTERNAL_MESSAGE')
    err.stack = 'Error: SECRET_INTERNAL_MESSAGE\n    at C:\\Users\\admin\\token=secret'

    const log = buildSafeUnexpectedErrorLog({
      action:       'wrapCallable',
      requestId:    'req-123',
      actorUid:     'uid-abc',
      actorStoreId: 'store-x',
      error:        err,
    })

    assertSafeLog(log)
    expect(log.errorType).toBe('Error')
    expect(log.action).toBe('wrapCallable')
    expect(log.requestId).toBe('req-123')
    expect(log.actorUid).toBe('uid-abc')
    expect(log.actorStoreId).toBe('store-x')
    expect(JSON.stringify(log)).not.toContain('SECRET_INTERNAL_MESSAGE')
  })

  it('[LOG-02] Erreur Firebase riche avec config/request/response/cause → pas de fuite', () => {
    const err = Object.assign(new Error('Firebase: auth error'), {
      code:     'auth/invalid-token',
      config:   { url: 'https://internal.api', headers: { Authorization: 'Bearer supersecrettoken' } },
      request:  { body: '{"uid":"admin"}' },
      response: { data: { error: 'INTERNAL' }, status: 500 },
      cause:    new Error('cause sensible'),
    })

    const log = buildSafeUnexpectedErrorLog({ action: 'test', error: err })
    assertSafeLog(log)
    expect(log.errorType).toBe('Error')
    expect(JSON.stringify(log)).not.toContain('supersecrettoken')
    expect(JSON.stringify(log)).not.toContain('Firebase: auth error')
  })

  it('[LOG-03] string primitive → type renvoyé, valeur absente', () => {
    const log = buildSafeUnexpectedErrorLog({ action: 'test', error: 'SECRET texte brut' })
    assertSafeLog(log)
    expect(log.errorType).toBe('string')
    expect(JSON.stringify(log)).not.toContain('SECRET texte brut')
  })

  it('[LOG-04] number primitive → stable', () => {
    const log = buildSafeUnexpectedErrorLog({ action: 'test', error: 42 })
    assertSafeLog(log)
    expect(log.errorType).toBe('number')
  })

  it('[LOG-05] null → errorType null (explicite, distingué de objet)', () => {
    const log = buildSafeUnexpectedErrorLog({ action: 'test', error: null })
    assertSafeLog(log)
    expect(log.errorType).toBe('null')
  })

  it('[LOG-06] undefined → stable', () => {
    const log = buildSafeUnexpectedErrorLog({ action: 'test', error: undefined })
    assertSafeLog(log)
    expect(log.errorType).toBe('undefined')
  })

  it('[LOG-07] champs optionnels absents → null', () => {
    const log = buildSafeUnexpectedErrorLog({ action: 'test', error: new Error('x') })
    expect(log.requestId).toBe(null)
    expect(log.actorUid).toBe(null)
    expect(log.actorStoreId).toBe(null)
  })

  it('[LOG-08] sous-classe Error → errorType Error (toString retourne [object Error])', () => {
    class DatabaseError extends Error {
      constructor(msg) { super(msg); this.name = 'DatabaseError' }
    }
    const log = buildSafeUnexpectedErrorLog({ action: 'test', error: new DatabaseError('SECRET db path') })
    assertSafeLog(log)
    // Object.prototype.toString.call(new DatabaseError()) → '[object Error]' → 'Error'
    expect(log.errorType).toBe('Error')
    expect(JSON.stringify(log)).not.toContain('SECRET db path')
  })

  it('[LOG-09] forme exacte des clés — allow-list figée', () => {
    const log = buildSafeUnexpectedErrorLog({
      action:       'test',
      requestId:    'r',
      actorUid:     'u',
      actorStoreId: 's',
      error:        new Error('x'),
    })
    expect(Object.keys(log)).toEqual(EXPECTED_KEYS)
  })

  it('[LOG-10] buildSafeUnexpectedErrorLog() sans argument → ne lève pas', () => {
    expect(() => buildSafeUnexpectedErrorLog()).not.toThrow()
    const log = buildSafeUnexpectedErrorLog()
    assertSafeLog(log)
  })
})

// ── §PRIM : primitives exotiques ─────────────────────────────────────────────

describe('TC-040 §PRIM primitives exotiques', () => {
  it('[PRIM-01] boolean true', () => {
    const log = buildSafeUnexpectedErrorLog({ action: 'test', error: true })
    assertSafeLog(log)
    expect(log.errorType).toBe('boolean')
  })

  it('[PRIM-02] boolean false', () => {
    const log = buildSafeUnexpectedErrorLog({ action: 'test', error: false })
    assertSafeLog(log)
    expect(log.errorType).toBe('boolean')
  })

  it('[PRIM-03] Symbol → ne lève pas, type string (symbol)', () => {
    const log = buildSafeUnexpectedErrorLog({ action: 'test', error: Symbol('secret') })
    assertSafeLog(log)
    expect(log.errorType).toBe('symbol')
    expect(JSON.stringify(log)).not.toContain('secret')
  })

  it('[PRIM-04] BigInt → ne lève pas, type bigint', () => {
    const log = buildSafeUnexpectedErrorLog({ action: 'test', error: BigInt(9999999) })
    assertSafeLog(log)
    expect(log.errorType).toBe('bigint')
  })

  it('[PRIM-05] function → ne lève pas, errorType Function', () => {
    const log = buildSafeUnexpectedErrorLog({ action: 'test', error: function secret() {} })
    assertSafeLog(log)
    expect(log.errorType).toBe('Function')
    expect(JSON.stringify(log)).not.toContain('secret')
  })

  it('[PRIM-06] objet sans prototype (Object.create(null)) → ne lève pas', () => {
    const obj = Object.create(null)
    obj.secret = 'SECRET_VALUE'
    const log = buildSafeUnexpectedErrorLog({ action: 'test', error: obj })
    assertSafeLog(log)
    // Object.prototype.toString.call(Object.create(null)) → '[object Object]'
    expect(log.errorType).toBe('Object')
    expect(JSON.stringify(log)).not.toContain('SECRET_VALUE')
  })
})

// ── §HOSTILE : getters hostiles et Proxies hostiles ──────────────────────────

describe('TC-040 §HOSTILE getters et Proxies hostiles', () => {
  it('[HOSTILE-01] getter hostile sur constructor dans error → ne lève pas, aucun secret', () => {
    const hostileGetter = {}
    Object.defineProperty(hostileGetter, 'constructor', {
      get() { throw new Error('GETTER_SECRET') },
    })

    expect(() => buildSafeUnexpectedErrorLog({ action: 'test', error: hostileGetter })).not.toThrow()
    const log = buildSafeUnexpectedErrorLog({ action: 'test', error: hostileGetter })
    assertSafeLog(log)
    expect(JSON.stringify(log)).not.toContain('GETTER_SECRET')
  })

  it('[HOSTILE-02] getter hostile sur requestId dans context → requestId: null, ne lève pas', () => {
    const hostileContext = { action: 'test', error: null }
    Object.defineProperty(hostileContext, 'requestId', {
      get() { throw new Error('REQUEST_ID_SECRET') },
    })

    expect(() => buildSafeUnexpectedErrorLog(hostileContext)).not.toThrow()
    const log = buildSafeUnexpectedErrorLog(hostileContext)
    assertSafeLog(log)
    expect(log.requestId).toBe(null)
    expect(JSON.stringify(log)).not.toContain('REQUEST_ID_SECRET')
  })

  it('[HOSTILE-03] Proxy hostile (get lève) comme error → ne lève pas, errorType Object', () => {
    const hostileProxy = new Proxy({}, {
      get() { throw new Error('PROXY_SECRET') },
      getPrototypeOf() { throw new Error('PROTOTYPE_SECRET') },
    })

    expect(() => buildSafeUnexpectedErrorLog({ action: 'test', error: hostileProxy })).not.toThrow()
    const log = buildSafeUnexpectedErrorLog({ action: 'test', error: hostileProxy })
    assertSafeLog(log)
    expect(JSON.stringify(log)).not.toContain('PROXY_SECRET')
    expect(JSON.stringify(log)).not.toContain('PROTOTYPE_SECRET')
    expect(['Object', 'Unknown']).toContain(log.errorType)
  })

  it('[HOSTILE-04] Proxy hostile comme context complet → ne lève pas, sortie nulle', () => {
    const hostileContext = new Proxy({}, {
      get() { throw new Error('PROXY_SECRET') },
    })

    expect(() => buildSafeUnexpectedErrorLog(hostileContext)).not.toThrow()
    const log = buildSafeUnexpectedErrorLog(hostileContext)
    assertSafeLog(log)
    expect(log.action).toBe(null)
    expect(log.requestId).toBe(null)
    expect(JSON.stringify(log)).not.toContain('PROXY_SECRET')
  })

  it('[HOSTILE-05] error avec Symbol.toStringTag hostile → ne lève pas', () => {
    const hostileTag = {}
    Object.defineProperty(hostileTag, Symbol.toStringTag, {
      get() { throw new Error('TAG_SECRET') },
    })

    expect(() => buildSafeUnexpectedErrorLog({ action: 'test', error: hostileTag })).not.toThrow()
    const log = buildSafeUnexpectedErrorLog({ action: 'test', error: hostileTag })
    assertSafeLog(log)
    expect(['Object', 'Unknown']).toContain(log.errorType)
  })
})

// ── §WRITER : writeSafeErrorLog ──────────────────────────────────────────────

describe('TC-040 §WRITER writeSafeErrorLog', () => {
  it('[WR-01] writer reçoit exactement {severity: ERROR, ...payload}', () => {
    const payload = buildSafeUnexpectedErrorLog({
      action:       'wrapCallable',
      requestId:    'req-xyz',
      actorUid:     'uid-123',
      actorStoreId: 'store-abc',
      error:        new Error('x'),
    })
    const writer = vi.fn()
    writeSafeErrorLog(writer, payload)

    expect(writer).toHaveBeenCalledOnce()
    const received = writer.mock.calls[0][0]
    expect(received.severity).toBe('ERROR')
    expect(received.action).toBe('wrapCallable')
    expect(received.requestId).toBe('req-xyz')
    expect(received.actorUid).toBe('uid-123')
    expect(received.actorStoreId).toBe('store-abc')
    expect(received.result).toBe('error')
    expect(received.errorCode).toBe('UNEXPECTED_INTERNAL_ERROR')
    expect(received.errorType).toBe('Error')
    // Aucun champ sensible dans l'objet envoyé au writer
    expect(Object.keys(received)).toEqual(['severity', ...EXPECTED_KEYS])
    expect('message' in received).toBe(false)
    expect('stack' in received).toBe(false)
  })

  it('[WR-02] writer qui lève → writeSafeErrorLog ne lève pas', () => {
    const throwingWriter = () => { throw new Error('LOGGER_FAILURE') }
    const payload = buildSafeUnexpectedErrorLog({ action: 'test', error: new Error('x') })
    expect(() => writeSafeErrorLog(throwingWriter, payload)).not.toThrow()
  })

  it('[WR-03] vérification récursive — aucune clé sensible dans l objet envoyé', () => {
    const err = Object.assign(new Error('Firebase: secret'), {
      config: { token: 'Bearer SECRET_TOKEN' },
      cause:  new Error('cause secrète'),
    })
    const payload = buildSafeUnexpectedErrorLog({ action: 'test', error: err })
    const writer = vi.fn()
    writeSafeErrorLog(writer, payload)

    const received = writer.mock.calls[0][0]
    const serialized = JSON.stringify(received)
    expect(serialized).not.toContain('SECRET_TOKEN')
    expect(serialized).not.toContain('Firebase: secret')
    expect(serialized).not.toContain('cause secrète')
    for (const key of FORBIDDEN_KEYS) {
      expect(serialized).not.toContain(`"${key}"`)
    }
  })
})

// ── §WRAP : wrapCallable avec logWriter injectable ────────────────────────────

describe('TC-040 §WRAP wrapCallable avec erreur hostile', () => {
  it('[WRAP-01] erreur DealerRequestError → pas de log, HttpsError métier', async () => {
    const spy = vi.fn()
    const wrapped = wrapCallable(
      async () => { throw new DealerRequestError('REQUEST_NOT_FOUND', 'Demande introuvable.') },
      {},
      spy,
    )
    await expect(wrapped({})).rejects.toMatchObject({ code: 'not-found' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('[WRAP-02] erreur inconnue → HttpsError internal générique, writer appelé une fois', async () => {
    const spy = vi.fn()
    const wrapped = wrapCallable(
      async () => { throw new Error('SECRET_ERROR_DETAIL') },
      {},
      spy,
    )
    const err = await wrapped({}).catch(e => e)
    expect(err.code).toBe('internal')
    expect(err.message).not.toContain('SECRET_ERROR_DETAIL')
    expect(spy).toHaveBeenCalledOnce()
    const logged = spy.mock.calls[0][0]
    expect(JSON.stringify(logged)).not.toContain('SECRET_ERROR_DETAIL')
    expect(logged.severity).toBe('ERROR')
    expect(logged.errorCode).toBe('UNEXPECTED_INTERNAL_ERROR')
  })

  it('[WRAP-03] Proxy hostile comme erreur → HttpsError internal, writer ne lève pas', async () => {
    const hostileProxy = new Proxy({}, {
      get() { throw new Error('PROXY_SECRET') },
      getPrototypeOf() { throw new Error('PROTOTYPE_SECRET') },
    })
    const spy = vi.fn()
    const wrapped = wrapCallable(async () => { throw hostileProxy }, {}, spy)
    const err = await wrapped({}).catch(e => e)
    expect(err.code).toBe('internal')
    expect(err.message).not.toContain('PROXY_SECRET')
    expect(err.message).not.toContain('PROTOTYPE_SECRET')
    expect(spy).toHaveBeenCalledOnce()
    const logged = spy.mock.calls[0][0]
    expect(JSON.stringify(logged)).not.toContain('PROXY_SECRET')
    expect(JSON.stringify(logged)).not.toContain('PROTOTYPE_SECRET')
  })

  it('[WRAP-04] writer qui lève → callable retourne tout de même HttpsError internal', async () => {
    const throwingWriter = () => { throw new Error('LOGGER_FAILURE') }
    const wrapped = wrapCallable(
      async () => { throw new Error('some error') },
      {},
      throwingWriter,
    )
    const err = await wrapped({}).catch(e => e)
    expect(err.code).toBe('internal')
  })

  it('[WRAP-05] erreur avec getter hostile sur constructor → HttpsError internal, aucun secret', async () => {
    const hostileGetter = {}
    Object.defineProperty(hostileGetter, 'constructor', {
      get() { throw new Error('GETTER_SECRET') },
    })
    const spy = vi.fn()
    const wrapped = wrapCallable(async () => { throw hostileGetter }, {}, spy)
    const err = await wrapped({}).catch(e => e)
    expect(err.code).toBe('internal')
    // instanceof ne lève pas pour un objet ordinaire → le writer est toujours appelé une fois.
    expect(spy).toHaveBeenCalledOnce()
    expect(JSON.stringify(spy.mock.calls[0][0])).not.toContain('GETTER_SECRET')
  })
})

// ── §GUARD : assertFirebaseProject ──────────────────────────────────────────

describe('TC-040 §GUARD assertFirebaseProject', () => {
  it('[GUARD-01] demo-akayis-test → accepté', () => {
    expect(assertFirebaseProject('demo-akayis-test')).toBe('demo-akayis-test')
  })

  it('[GUARD-02] autre projet demo → accepté', () => {
    expect(assertFirebaseProject('demo-autre-projet')).toBe('demo-autre-projet')
    expect(assertFirebaseProject('demo-staging-v2')).toBe('demo-staging-v2')
  })

  it('[GUARD-03] taofic-ajagbe → rejeté PRODUCTION_PROJECT_BLOCKED', () => {
    let thrown
    try { assertFirebaseProject('taofic-ajagbe') } catch (e) { thrown = e }
    expect(thrown).toBeInstanceOf(AssertFirebaseProjectError)
    expect(thrown.code).toBe('PRODUCTION_PROJECT_BLOCKED')
  })

  it('[GUARD-04] projet non-demo → rejeté NON_DEMO_PROJECT', () => {
    let thrown
    try { assertFirebaseProject('mon-projet-perso') } catch (e) { thrown = e }
    expect(thrown).toBeInstanceOf(AssertFirebaseProjectError)
    expect(thrown.code).toBe('NON_DEMO_PROJECT')
  })

  it('[GUARD-05] projectId absent (undefined) → rejeté MISSING_PROJECT_ID', () => {
    let thrown
    try { assertFirebaseProject(undefined) } catch (e) { thrown = e }
    expect(thrown).toBeInstanceOf(AssertFirebaseProjectError)
    expect(thrown.code).toBe('MISSING_PROJECT_ID')
  })

  it('[GUARD-06] projectId null → rejeté MISSING_PROJECT_ID', () => {
    let thrown
    try { assertFirebaseProject(null) } catch (e) { thrown = e }
    expect(thrown).toBeInstanceOf(AssertFirebaseProjectError)
    expect(thrown.code).toBe('MISSING_PROJECT_ID')
  })

  it('[GUARD-07] espaces uniquement → rejeté MISSING_PROJECT_ID', () => {
    let thrown
    try { assertFirebaseProject('   ') } catch (e) { thrown = e }
    expect(thrown).toBeInstanceOf(AssertFirebaseProjectError)
    expect(thrown.code).toBe('MISSING_PROJECT_ID')
  })

  it('[GUARD-08] mauvaise casse DEMO-akayis-test → rejeté NON_DEMO_PROJECT', () => {
    let thrown
    try { assertFirebaseProject('DEMO-akayis-test') } catch (e) { thrown = e }
    expect(thrown).toBeInstanceOf(AssertFirebaseProjectError)
    expect(thrown.code).toBe('NON_DEMO_PROJECT')
  })

  it('[GUARD-09] projectId non-string (number) → rejeté INVALID_PROJECT_ID_TYPE', () => {
    let thrown
    try { assertFirebaseProject(42) } catch (e) { thrown = e }
    expect(thrown).toBeInstanceOf(AssertFirebaseProjectError)
    expect(thrown.code).toBe('INVALID_PROJECT_ID_TYPE')
  })

  it('[GUARD-10] taofic-ajagbe → rejet synchrone, aucun SDK initialisé', () => {
    let didThrow = false
    try { assertFirebaseProject('taofic-ajagbe') } catch { didThrow = true }
    expect(didThrow).toBe(true)
  })

  it('[GUARD-11] demo-akayis-test avec espaces → normalisé et accepté', () => {
    expect(assertFirebaseProject('  demo-akayis-test  ')).toBe('demo-akayis-test')
  })
})
