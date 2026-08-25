// @vitest-environment node
/**
 * TC-075 — Garde projet du script de remise à zéro : resolveResetProject
 *
 * Matrice de sécurité :
 *
 * Dry-run (execute=false) :
 *   1. SA=prod                        → autorisé, isProduction=true
 *   2. SA=demo-akayis-test            → autorisé, isProduction=false
 *
 * Execute demo :
 *   3. SA=demo-akayis-test            → autorisé
 *   4. env seul demo-akayis-test      → autorisé
 *
 * Execute production (c2egf-b0b5a) :
 *   5. sans flag ni env               → PRODUCTION_RESET_NOT_UNLOCKED
 *   6. flag seul                      → bloqué
 *   7. env 'true' seul                → bloqué
 *   8. env 'TRUE' / '1' + flag        → bloqué (strict 'true')
 *   9. flag + env 'true'              → autorisé, isProduction=true
 *
 * Execute autre projet réel :
 *   10. autre-projet même avec opt-in → NON_DEMO_PROJECT (aucun opt-in hors prod connue)
 *
 * Cohérence (héritée de tc-042) :
 *   11. SA project_id absent/null/non-string/vide → bloqué
 *   12. mismatch SA/env (prod vs demo, demo vs demo) → PROJECT_ID_MISMATCH
 *   13. pas de SA, env absent/vide → MISSING_PROJECT_ID
 *
 * Preuve initializeApp :
 *   14. initializeApp jamais appelé si la garde échoue
 *
 * Sécurité des messages :
 *   15. jamais private_key / client_email
 */

import { describe, it, expect, vi } from 'vitest'
import {
  resolveResetProject,
  AssertFirebaseProjectError,
  PRODUCTION_PROJECT_ID,
} from '../../scripts/lib/assertResetProject.mjs'

const DEMO = 'demo-akayis-test'
const PROD = 'c2egf-b0b5a'
const OTHER_DEMO = 'demo-autre'
const OTHER_REAL = 'autre-projet-reel'

function sa(projectId) {
  return { project_id: projectId }
}

function expectCode(fn, code) {
  expect(fn).toThrow(AssertFirebaseProjectError)
  try {
    fn()
  } catch (e) {
    expect(e.code).toBe(code)
  }
}

describe('TC-075 — resolveResetProject', () => {
  it('exporte le projectId de production attendu', () => {
    expect(PRODUCTION_PROJECT_ID).toBe(PROD)
  })

  describe('Dry-run (execute=false)', () => {
    it('Cas 1 : SA=prod → autorisé en lecture seule, isProduction=true', () => {
      const result = resolveResetProject({ serviceAccount: sa(PROD), envProjectId: undefined, execute: false })
      expect(result).toEqual({ projectId: PROD, isProduction: true })
    })

    it('Cas 2 : SA=demo → autorisé, isProduction=false', () => {
      const result = resolveResetProject({ serviceAccount: sa(DEMO), envProjectId: undefined, execute: false })
      expect(result).toEqual({ projectId: DEMO, isProduction: false })
    })
  })

  describe('Execute sur projet demo', () => {
    it('Cas 3 : SA=demo → autorisé', () => {
      const result = resolveResetProject({ serviceAccount: sa(DEMO), envProjectId: DEMO, execute: true })
      expect(result).toEqual({ projectId: DEMO, isProduction: false })
    })

    it('Cas 4 : sans SA, env=demo (émulateur) → autorisé', () => {
      const result = resolveResetProject({ serviceAccount: null, envProjectId: DEMO, execute: true })
      expect(result).toEqual({ projectId: DEMO, isProduction: false })
    })
  })

  describe('Execute sur production (c2egf-b0b5a)', () => {
    it('Cas 5 : sans flag ni env → PRODUCTION_RESET_NOT_UNLOCKED', () => {
      expectCode(
        () => resolveResetProject({ serviceAccount: sa(PROD), envProjectId: undefined, execute: true }),
        'PRODUCTION_RESET_NOT_UNLOCKED'
      )
    })

    it('Cas 6 : --allow-production seul → bloqué', () => {
      expectCode(
        () => resolveResetProject({
          serviceAccount: sa(PROD), envProjectId: undefined, execute: true,
          allowProductionFlag: true,
        }),
        'PRODUCTION_RESET_NOT_UNLOCKED'
      )
    })

    it("Cas 7 : env 'true' seul → bloqué", () => {
      expectCode(
        () => resolveResetProject({
          serviceAccount: sa(PROD), envProjectId: undefined, execute: true,
          envAllowProductionReset: 'true',
        }),
        'PRODUCTION_RESET_NOT_UNLOCKED'
      )
    })

    it("Cas 8a : env 'TRUE' + flag → bloqué (comparaison stricte)", () => {
      expectCode(
        () => resolveResetProject({
          serviceAccount: sa(PROD), envProjectId: undefined, execute: true,
          allowProductionFlag: true, envAllowProductionReset: 'TRUE',
        }),
        'PRODUCTION_RESET_NOT_UNLOCKED'
      )
    })

    it("Cas 8b : env '1' + flag → bloqué", () => {
      expectCode(
        () => resolveResetProject({
          serviceAccount: sa(PROD), envProjectId: undefined, execute: true,
          allowProductionFlag: true, envAllowProductionReset: '1',
        }),
        'PRODUCTION_RESET_NOT_UNLOCKED'
      )
    })

    it("Cas 9 : flag + env 'true' → autorisé, isProduction=true", () => {
      const result = resolveResetProject({
        serviceAccount: sa(PROD), envProjectId: undefined, execute: true,
        allowProductionFlag: true, envAllowProductionReset: 'true',
      })
      expect(result).toEqual({ projectId: PROD, isProduction: true })
    })
  })

  describe('Execute sur un autre projet réel (non-demo, non-prod)', () => {
    it('Cas 10a : sans opt-in → NON_DEMO_PROJECT', () => {
      expectCode(
        () => resolveResetProject({ serviceAccount: sa(OTHER_REAL), envProjectId: undefined, execute: true }),
        'NON_DEMO_PROJECT'
      )
    })

    it("Cas 10b : même avec flag + env 'true' → NON_DEMO_PROJECT (opt-in réservé à la prod connue)", () => {
      expectCode(
        () => resolveResetProject({
          serviceAccount: sa(OTHER_REAL), envProjectId: undefined, execute: true,
          allowProductionFlag: true, envAllowProductionReset: 'true',
        }),
        'NON_DEMO_PROJECT'
      )
    })
  })

  describe('Cohérence service account / environnement', () => {
    it('Cas 11a : SA project_id absent → SERVICE_ACCOUNT_MISSING_PROJECT_ID', () => {
      expectCode(
        () => resolveResetProject({ serviceAccount: {}, envProjectId: DEMO, execute: false }),
        'SERVICE_ACCOUNT_MISSING_PROJECT_ID'
      )
    })

    it('Cas 11b : SA project_id null → SERVICE_ACCOUNT_MISSING_PROJECT_ID', () => {
      expectCode(
        () => resolveResetProject({ serviceAccount: sa(null), envProjectId: DEMO, execute: false }),
        'SERVICE_ACCOUNT_MISSING_PROJECT_ID'
      )
    })

    it('Cas 11c : SA project_id nombre → SERVICE_ACCOUNT_INVALID_PROJECT_ID_TYPE', () => {
      expectCode(
        () => resolveResetProject({ serviceAccount: sa(42), envProjectId: DEMO, execute: false }),
        'SERVICE_ACCOUNT_INVALID_PROJECT_ID_TYPE'
      )
    })

    it('Cas 11d : SA project_id vide/espaces → SERVICE_ACCOUNT_EMPTY_PROJECT_ID', () => {
      expectCode(
        () => resolveResetProject({ serviceAccount: sa('   '), envProjectId: DEMO, execute: false }),
        'SERVICE_ACCOUNT_EMPTY_PROJECT_ID'
      )
    })

    it('Cas 12a : SA=demo, env=prod → PROJECT_ID_MISMATCH', () => {
      expectCode(
        () => resolveResetProject({ serviceAccount: sa(DEMO), envProjectId: PROD, execute: false }),
        'PROJECT_ID_MISMATCH'
      )
    })

    it('Cas 12b : SA=demo, env=autre-demo → PROJECT_ID_MISMATCH', () => {
      expectCode(
        () => resolveResetProject({ serviceAccount: sa(DEMO), envProjectId: OTHER_DEMO, execute: false }),
        'PROJECT_ID_MISMATCH'
      )
    })

    it("Cas 12c : SA=prod, env=demo → PROJECT_ID_MISMATCH (pas de contournement de l'incohérence)", () => {
      expectCode(
        () => resolveResetProject({
          serviceAccount: sa(PROD), envProjectId: DEMO, execute: true,
          allowProductionFlag: true, envAllowProductionReset: 'true',
        }),
        'PROJECT_ID_MISMATCH'
      )
    })

    it('Cas 13a : pas de SA, env absent → MISSING_PROJECT_ID', () => {
      expectCode(
        () => resolveResetProject({ serviceAccount: null, envProjectId: undefined, execute: false }),
        'MISSING_PROJECT_ID'
      )
    })

    it('Cas 13b : pas de SA, env vide/espaces → MISSING_PROJECT_ID', () => {
      expectCode(
        () => resolveResetProject({ serviceAccount: null, envProjectId: '   ', execute: true }),
        'MISSING_PROJECT_ID'
      )
    })
  })

  describe('Preuve : initializeApp non appelé après échec de la garde', () => {
    it('Cas 14 : initializeApp ne doit pas être appelé si la garde échoue', () => {
      const initializeAppMock = vi.fn()

      function simulateScriptWithFailingGuard(initializeApp) {
        resolveResetProject({ serviceAccount: sa(PROD), envProjectId: undefined, execute: true })
        initializeApp({ credential: 'cert(serviceAccount)' })
      }

      expect(() => simulateScriptWithFailingGuard(initializeAppMock)).toThrow(AssertFirebaseProjectError)
      expect(initializeAppMock).not.toHaveBeenCalled()
    })
  })

  describe("Sécurité des messages d'erreur", () => {
    it('Les erreurs ne contiennent jamais private_key ni client_email', () => {
      const cases = [
        () => resolveResetProject({ serviceAccount: sa(PROD), envProjectId: undefined, execute: true }),
        () => resolveResetProject({ serviceAccount: {}, envProjectId: DEMO, execute: false }),
        () => resolveResetProject({ serviceAccount: sa(DEMO), envProjectId: PROD, execute: false }),
        () => resolveResetProject({ serviceAccount: null, envProjectId: undefined, execute: false }),
        () => resolveResetProject({ serviceAccount: sa(OTHER_REAL), envProjectId: undefined, execute: true }),
      ]

      for (const fn of cases) {
        try {
          fn()
        } catch (e) {
          expect(e.message).not.toContain('private_key')
          expect(e.message).not.toContain('client_email')
        }
      }
    })
  })
})
