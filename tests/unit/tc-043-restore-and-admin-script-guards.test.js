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

const __dirname = dirname(fileURLToPath(import.meta.url))
const scriptsDir = resolve(__dirname, '../../scripts')

const DEMO = 'demo-akayis-test'
const PROD = 'taofic-ajagbe'
const OTHER = 'production-autre'
const sa = (projectId) => ({ project_id: projectId })

describe('TC-043-A — resolveRestoreProject', () => {
  it('DRY-RUN sur production → autorisé (lecture seule)', () => {
    expect(resolveRestoreProject({ serviceAccount: sa(PROD), envProjectId: undefined, execute: false })).toBe(PROD)
  })

  it('DRY-RUN sur projet demo → autorisé', () => {
    expect(resolveRestoreProject({ serviceAccount: sa(DEMO), envProjectId: undefined, execute: false })).toBe(DEMO)
  })

  it('EXECUTE sur production (taofic-ajagbe) → REFUSÉ (PRODUCTION_PROJECT_BLOCKED)', () => {
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
  const legacyGuardScripts = [
    'generatePasswordResetLink.mjs',
    'updateAccountPassword.mjs',
    'diagnoseAccount.mjs',
  ]

  it.each(legacyGuardScripts)('%s appelle resolveAndAssertAdminProject avant initializeApp', async (file) => {
    const src = await readFile(resolve(scriptsDir, file), 'utf8')
    const guardIdx = src.indexOf('resolveAndAssertAdminProject(')
    const initIdx = src.indexOf('initializeApp(')
    expect(guardIdx, `${file}: appel de garde manquant`).toBeGreaterThan(-1)
    expect(initIdx, `${file}: initializeApp manquant`).toBeGreaterThan(-1)
    expect(guardIdx, `${file}: la garde doit précéder initializeApp`).toBeLessThan(initIdx)
    expect(src).toContain("from './lib/resolveAndAssertAdminProject.mjs'")
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
