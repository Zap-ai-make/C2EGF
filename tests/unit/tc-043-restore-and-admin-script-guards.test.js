// @vitest-environment node
/**
 * TC-043 — Garde d'écriture du script de restauration + câblage des scripts Admin.
 *
 * Deux objectifs de sécurité (audit) :
 *
 *   A. resolveRestoreProject (restoreDeletedAccount) :
 *      - DRY-RUN (execute=false) autorisé sur TOUT projet, y compris production
 *        (lecture seule pour diagnostic).
 *      - EXECUTE (execute=true) REFUSÉ hors projet demo-* : plus aucune écriture
 *        production possible, même avec l'ancienne variable de confirmation.
 *      - initializeApp jamais atteint quand la garde échoue.
 *
 *   B. Câblage : chaque script Admin legacy valide le projet AVANT initializeApp.
 *      (Preuve textuelle sur les fichiers réels — régression si l'ordre change.)
 */

import { describe, it, expect, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  resolveRestoreProject,
  AssertFirebaseProjectError,
} from '../../scripts/lib/assertRestoreProject.mjs'
import {
  initializeGuardedAdminAuth,
  initializeGuardedAdminAuthCli,
  MISSING_ADMIN_CREDENTIALS_MESSAGE,
} from '../../scripts/lib/initializeGuardedAdminAuth.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const scriptsDir = resolve(__dirname, '../../scripts')

const DEMO = 'demo-akayis-test'
const PROD = 'c2egf-b0b5a'
const OTHER = 'production-autre'
const sa = (projectId) => ({ project_id: projectId })

describe('TC-043-A — resolveRestoreProject', () => {
  it('DRY-RUN sur production → autorisé (lecture seule)', () => {
    expect(resolveRestoreProject({ serviceAccount: sa(PROD), envProjectId: undefined, execute: false })).toBe(PROD)
  })

  it('DRY-RUN sur projet demo → autorisé', () => {
    expect(resolveRestoreProject({ serviceAccount: sa(DEMO), envProjectId: undefined, execute: false })).toBe(DEMO)
  })

  it('EXECUTE sur production (c2egf-b0b5a) → REFUSÉ (PRODUCTION_PROJECT_BLOCKED)', () => {
    expect(() =>
      resolveRestoreProject({ serviceAccount: sa(PROD), envProjectId: undefined, execute: true })
    ).toThrow(AssertFirebaseProjectError)
    try {
      resolveRestoreProject({ serviceAccount: sa(PROD), envProjectId: undefined, execute: true })
    } catch (e) {
      expect(e.code).toBe('PRODUCTION_PROJECT_BLOCKED')
      expect(e.message).not.toContain('private_key')
    }
  })

  it('EXECUTE sur un autre projet non-demo → REFUSÉ (NON_DEMO_PROJECT)', () => {
    try {
      resolveRestoreProject({ serviceAccount: sa(OTHER), envProjectId: undefined, execute: true })
      throw new Error('aurait dû lever')
    } catch (e) {
      expect(e).toBeInstanceOf(AssertFirebaseProjectError)
      expect(e.code).toBe('NON_DEMO_PROJECT')
    }
  })

  it('EXECUTE sur projet demo → autorisé', () => {
    expect(resolveRestoreProject({ serviceAccount: sa(DEMO), envProjectId: DEMO, execute: true })).toBe(DEMO)
  })

  it('project_id absent → REFUSÉ quel que soit le mode', () => {
    for (const execute of [false, true]) {
      try {
        resolveRestoreProject({ serviceAccount: {}, envProjectId: DEMO, execute })
        throw new Error('aurait dû lever')
      } catch (e) {
        expect(e).toBeInstanceOf(AssertFirebaseProjectError)
        expect(e.code).toBe('SERVICE_ACCOUNT_MISSING_PROJECT_ID')
      }
    }
  })

  it('mismatch service account / GCLOUD_PROJECT → REFUSÉ', () => {
    try {
      resolveRestoreProject({ serviceAccount: sa(DEMO), envProjectId: PROD, execute: false })
      throw new Error('aurait dû lever')
    } catch (e) {
      expect(e.code).toBe('PROJECT_ID_MISMATCH')
    }
  })

  it('initializeApp non atteint quand EXECUTE est refusé en production', () => {
    const initializeAppMock = vi.fn()
    function simulate(initializeApp) {
      resolveRestoreProject({ serviceAccount: sa(PROD), envProjectId: undefined, execute: true })
      initializeApp() // ne doit jamais être appelé
    }
    expect(() => simulate(initializeAppMock)).toThrow(AssertFirebaseProjectError)
    expect(initializeAppMock).not.toHaveBeenCalled()
  })
})

describe('TC-043-B — câblage : garde projet AVANT initializeApp', () => {
  const guardedAuthScripts = [
    'generatePasswordResetLink.mjs',
    'updateAccountPassword.mjs',
  ]

  it.each(guardedAuthScripts)('%s délègue à initializeGuardedAdminAuthCli', async (file) => {
    const src = await readFile(resolve(scriptsDir, file), 'utf8')
    expect(src).toContain('initializeGuardedAdminAuthCli()')
    expect(src).toContain("from './lib/initializeGuardedAdminAuth.mjs'")
    expect(src).not.toContain('initializeApp(')
  })

  it('diagnoseAccount.mjs appelle encore sa garde directe avant initializeApp', async () => {
    const src = await readFile(resolve(scriptsDir, 'diagnoseAccount.mjs'), 'utf8')
    const guardIdx = src.indexOf('resolveAndAssertAdminProject(')
    const initIdx = src.indexOf('initializeApp(')
    expect(guardIdx).toBeGreaterThan(-1)
    expect(initIdx).toBeGreaterThan(-1)
    expect(guardIdx).toBeLessThan(initIdx)
  })

  it('restoreDeletedAccount.mjs appelle resolveRestoreProject avant initializeApp et n’a plus d’échappatoire prod', async () => {
    const src = await readFile(resolve(scriptsDir, 'restoreDeletedAccount.mjs'), 'utf8')
    const guardIdx = src.indexOf('resolveRestoreProject(')
    const initIdx = src.indexOf('initializeApp(')
    expect(guardIdx).toBeGreaterThan(-1)
    expect(initIdx).toBeGreaterThan(-1)
    expect(guardIdx).toBeLessThan(initIdx)
    // L'ancienne variable de confirmation production ne doit plus exister.
    expect(src).not.toContain('AKAYIS_CONFIRM_PRODUCTION_RESTORE')
  })
})

describe('TC-043-C — initialisation Admin Auth gardée', () => {
  const serviceAccountPath = 'service-account.json'
  const readServiceAccount = (projectId = DEMO) =>
    vi.fn().mockResolvedValue(JSON.stringify({ project_id: projectId, private_key: 'HIDDEN' }))

  it('bloque la production avant de charger Firebase Admin', async () => {
    const loadAdminApp = vi.fn()
    const loadAdminAuth = vi.fn()

    await expect(initializeGuardedAdminAuth({
      serviceAccountPath,
      envProjectId: undefined,
      readFileImpl: readServiceAccount(PROD),
      loadAdminApp,
      loadAdminAuth,
    })).rejects.toMatchObject({ code: 'PRODUCTION_PROJECT_BLOCKED' })

    expect(loadAdminApp).not.toHaveBeenCalled()
    expect(loadAdminAuth).not.toHaveBeenCalled()
  })

  it('bloque une incohérence de projet avant de charger Firebase Admin', async () => {
    const loadAdminApp = vi.fn()
    const loadAdminAuth = vi.fn()

    await expect(initializeGuardedAdminAuth({
      serviceAccountPath,
      envProjectId: 'demo-autre',
      readFileImpl: readServiceAccount(),
      loadAdminApp,
      loadAdminAuth,
    })).rejects.toMatchObject({ code: 'PROJECT_ID_MISMATCH' })

    expect(loadAdminApp).not.toHaveBeenCalled()
    expect(loadAdminAuth).not.toHaveBeenCalled()
  })

  it('initialise Auth sur un projet demo validé', async () => {
    const auth = { getUserByEmail: vi.fn() }
    const credential = { kind: 'credential' }
    const initializeApp = vi.fn()
    const cert = vi.fn().mockReturnValue(credential)
    const getAuth = vi.fn().mockReturnValue(auth)

    await expect(initializeGuardedAdminAuth({
      serviceAccountPath,
      envProjectId: DEMO,
      readFileImpl: readServiceAccount(),
      loadAdminApp: vi.fn().mockResolvedValue({ initializeApp, cert }),
      loadAdminAuth: vi.fn().mockResolvedValue({ getAuth }),
    })).resolves.toBe(auth)

    expect(cert).toHaveBeenCalledWith(expect.objectContaining({ project_id: DEMO }))
    expect(initializeApp).toHaveBeenCalledWith({ credential })
    expect(getAuth).toHaveBeenCalledOnce()
  })

  it('ne charge pas Firebase Admin si le JSON du compte de service est invalide', async () => {
    const loadAdminApp = vi.fn()
    const loadAdminAuth = vi.fn()

    await expect(initializeGuardedAdminAuth({
      serviceAccountPath,
      envProjectId: DEMO,
      readFileImpl: vi.fn().mockResolvedValue('{'),
      loadAdminApp,
      loadAdminAuth,
    })).rejects.toBeInstanceOf(SyntaxError)

    expect(loadAdminApp).not.toHaveBeenCalled()
    expect(loadAdminAuth).not.toHaveBeenCalled()
  })

  it('l’adaptateur CLI conserve le message quand les credentials manquent', async () => {
    const reportError = vi.fn()
    const exitProcess = vi.fn()
    const readFileImpl = vi.fn()

    await expect(initializeGuardedAdminAuthCli({
      env: {},
      reportError,
      exitProcess,
      readFileImpl,
    })).resolves.toBeUndefined()

    expect(reportError).toHaveBeenCalledWith(MISSING_ADMIN_CREDENTIALS_MESSAGE)
    expect(exitProcess).toHaveBeenCalledWith(1)
    expect(readFileImpl).not.toHaveBeenCalled()
  })

  it('l’adaptateur CLI conserve le message typé et bloque avant le SDK', async () => {
    const reportError = vi.fn()
    const exitProcess = vi.fn()
    const loadAdminApp = vi.fn()
    const loadAdminAuth = vi.fn()

    await expect(initializeGuardedAdminAuthCli({
      env: {
        GOOGLE_APPLICATION_CREDENTIALS: serviceAccountPath,
        GCLOUD_PROJECT: PROD,
      },
      reportError,
      exitProcess,
      readFileImpl: readServiceAccount(PROD),
      loadAdminApp,
      loadAdminAuth,
    })).resolves.toBeUndefined()

    expect(reportError).toHaveBeenCalledWith(expect.stringContaining('PRODUCTION_PROJECT_BLOCKED'))
    expect(exitProcess).toHaveBeenCalledWith(1)
    expect(loadAdminApp).not.toHaveBeenCalled()
    expect(loadAdminAuth).not.toHaveBeenCalled()
  })
})
