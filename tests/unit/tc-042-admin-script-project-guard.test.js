// @vitest-environment node
/**
 * TC-042 — Garde projet Admin : resolveAndAssertAdminProject
 *
 * Vérifie les 13 cas de la matrice de sécurité + preuve que initializeApp
 * n'est jamais appelé lorsque la validation échoue.
 *
 * Cas A (service account fourni) :
 *   1.  SA=demo-akayis-test, env absent             → autorisé
 *   2.  SA=c2egf-b0b5a, env=demo-akayis-test      → bloqué (production)
 *   3.  SA project_id absent, env=demo-akayis-test  → bloqué
 *   4.  SA project_id vide, env=demo-akayis-test    → bloqué
 *   5.  SA project_id espaces, env=demo-akayis-test → bloqué
 *   6a. SA project_id nombre, env=demo              → bloqué
 *   6b. SA project_id boolean, env=demo             → bloqué
 *   6c. SA project_id null, env=demo                → bloqué
 *   7.  SA=demo-akayis-test, env=c2egf-b0b5a      → bloqué (mismatch)
 *   8.  SA=demo-akayis-test, env=autre-demo         → bloqué (mismatch)
 *   13. SA=demo-akayis-test, env=demo-akayis-test   → autorisé
 *
 * Cas B (pas de service account) :
 *   9.  env=demo-akayis-test  → autorisé
 *   10. env=c2egf-b0b5a     → bloqué
 *   11. env absent            → bloqué
 *   12a. env vide             → bloqué
 *   12b. env espaces          → bloqué
 *
 * initializeApp :
 *   14. initializeApp non appelé si la validation échoue
 */

import { describe, it, expect, vi } from 'vitest'
import { resolveAndAssertAdminProject, AssertFirebaseProjectError } from '../../scripts/lib/resolveAndAssertAdminProject.mjs'

const DEMO = 'demo-akayis-test'
const PROD = 'c2egf-b0b5a'
const OTHER_DEMO = 'demo-autre'

function sa(projectId) {
  return { project_id: projectId }
}

describe('TC-042 — resolveAndAssertAdminProject', () => {
  describe('Cas A — service account fourni', () => {
    it('Cas 1 : SA=demo-akayis-test, env absent → autorisé', () => {
      expect(() =>
        resolveAndAssertAdminProject({ serviceAccount: sa(DEMO), envProjectId: undefined })
      ).not.toThrow()
      const result = resolveAndAssertAdminProject({ serviceAccount: sa(DEMO), envProjectId: undefined })
      expect(result).toBe(DEMO)
    })

    it('Cas 2 : SA=c2egf-b0b5a, env=demo-akayis-test → bloqué (production)', () => {
      expect(() =>
        resolveAndAssertAdminProject({ serviceAccount: sa(PROD), envProjectId: DEMO })
      ).toThrow(AssertFirebaseProjectError)

      try {
        resolveAndAssertAdminProject({ serviceAccount: sa(PROD), envProjectId: DEMO })
      } catch (e) {
        expect(e.code).toBe('PRODUCTION_PROJECT_BLOCKED')
        expect(e.message).not.toContain('private_key')
      }
    })

    it('Cas 3 : SA project_id absent (undefined), env=demo-akayis-test → bloqué', () => {
      expect(() =>
        resolveAndAssertAdminProject({ serviceAccount: {}, envProjectId: DEMO })
      ).toThrow(AssertFirebaseProjectError)

      try {
        resolveAndAssertAdminProject({ serviceAccount: {}, envProjectId: DEMO })
      } catch (e) {
        expect(e.code).toBe('SERVICE_ACCOUNT_MISSING_PROJECT_ID')
      }
    })

    it('Cas 4 : SA project_id vide (""), env=demo-akayis-test → bloqué', () => {
      expect(() =>
        resolveAndAssertAdminProject({ serviceAccount: sa(''), envProjectId: DEMO })
      ).toThrow(AssertFirebaseProjectError)

      try {
        resolveAndAssertAdminProject({ serviceAccount: sa(''), envProjectId: DEMO })
      } catch (e) {
        expect(e.code).toBe('SERVICE_ACCOUNT_EMPTY_PROJECT_ID')
      }
    })

    it('Cas 5 : SA project_id espaces ("   "), env=demo-akayis-test → bloqué', () => {
      expect(() =>
        resolveAndAssertAdminProject({ serviceAccount: sa('   '), envProjectId: DEMO })
      ).toThrow(AssertFirebaseProjectError)

      try {
        resolveAndAssertAdminProject({ serviceAccount: sa('   '), envProjectId: DEMO })
      } catch (e) {
        expect(e.code).toBe('SERVICE_ACCOUNT_EMPTY_PROJECT_ID')
      }
    })

    it('Cas 6a : SA project_id nombre, env=demo → bloqué', () => {
      expect(() =>
        resolveAndAssertAdminProject({ serviceAccount: { project_id: 42 }, envProjectId: 'demo' })
      ).toThrow(AssertFirebaseProjectError)

      try {
        resolveAndAssertAdminProject({ serviceAccount: { project_id: 42 }, envProjectId: 'demo' })
      } catch (e) {
        expect(e.code).toBe('SERVICE_ACCOUNT_INVALID_PROJECT_ID_TYPE')
      }
    })

    it('Cas 6b : SA project_id boolean, env=demo → bloqué', () => {
      expect(() =>
        resolveAndAssertAdminProject({ serviceAccount: { project_id: true }, envProjectId: 'demo' })
      ).toThrow(AssertFirebaseProjectError)

      try {
        resolveAndAssertAdminProject({ serviceAccount: { project_id: true }, envProjectId: 'demo' })
      } catch (e) {
        expect(e.code).toBe('SERVICE_ACCOUNT_INVALID_PROJECT_ID_TYPE')
      }
    })

    it('Cas 6c : SA project_id null, env=demo → bloqué', () => {
      expect(() =>
        resolveAndAssertAdminProject({ serviceAccount: { project_id: null }, envProjectId: 'demo' })
      ).toThrow(AssertFirebaseProjectError)

      try {
        resolveAndAssertAdminProject({ serviceAccount: { project_id: null }, envProjectId: 'demo' })
      } catch (e) {
        expect(e.code).toBe('SERVICE_ACCOUNT_MISSING_PROJECT_ID')
      }
    })

    it('Cas 7 : SA=demo-akayis-test, env=c2egf-b0b5a → bloqué (mismatch)', () => {
      expect(() =>
        resolveAndAssertAdminProject({ serviceAccount: sa(DEMO), envProjectId: PROD })
      ).toThrow(AssertFirebaseProjectError)

      try {
        resolveAndAssertAdminProject({ serviceAccount: sa(DEMO), envProjectId: PROD })
      } catch (e) {
        expect(e.code).toBe('PROJECT_ID_MISMATCH')
        expect(e.message).toContain(DEMO)
        expect(e.message).toContain(PROD)
        expect(e.message).not.toContain('private_key')
      }
    })

    it('Cas 8 : SA=demo-akayis-test, env=autre-demo → bloqué (mismatch)', () => {
      expect(() =>
        resolveAndAssertAdminProject({ serviceAccount: sa(DEMO), envProjectId: OTHER_DEMO })
      ).toThrow(AssertFirebaseProjectError)

      try {
        resolveAndAssertAdminProject({ serviceAccount: sa(DEMO), envProjectId: OTHER_DEMO })
      } catch (e) {
        expect(e.code).toBe('PROJECT_ID_MISMATCH')
        expect(e.message).toContain(DEMO)
        expect(e.message).toContain(OTHER_DEMO)
      }
    })

    it('Cas 13 : SA=demo-akayis-test, env=demo-akayis-test (identique) → autorisé', () => {
      expect(() =>
        resolveAndAssertAdminProject({ serviceAccount: sa(DEMO), envProjectId: DEMO })
      ).not.toThrow()
      const result = resolveAndAssertAdminProject({ serviceAccount: sa(DEMO), envProjectId: DEMO })
      expect(result).toBe(DEMO)
    })
  })

  describe('Cas B — aucun service account', () => {
    it('Cas 9 : env=demo-akayis-test → autorisé', () => {
      expect(() =>
        resolveAndAssertAdminProject({ serviceAccount: null, envProjectId: DEMO })
      ).not.toThrow()
      const result = resolveAndAssertAdminProject({ serviceAccount: null, envProjectId: DEMO })
      expect(result).toBe(DEMO)
    })

    it('Cas 10 : env=c2egf-b0b5a → bloqué', () => {
      expect(() =>
        resolveAndAssertAdminProject({ serviceAccount: null, envProjectId: PROD })
      ).toThrow(AssertFirebaseProjectError)

      try {
        resolveAndAssertAdminProject({ serviceAccount: null, envProjectId: PROD })
      } catch (e) {
        expect(e.code).toBe('PRODUCTION_PROJECT_BLOCKED')
      }
    })

    it('Cas 11 : env absent (undefined) → bloqué', () => {
      expect(() =>
        resolveAndAssertAdminProject({ serviceAccount: null, envProjectId: undefined })
      ).toThrow(AssertFirebaseProjectError)

      try {
        resolveAndAssertAdminProject({ serviceAccount: null, envProjectId: undefined })
      } catch (e) {
        expect(e.code).toBe('MISSING_PROJECT_ID')
      }
    })

    it('Cas 12a : env vide ("") → bloqué', () => {
      expect(() =>
        resolveAndAssertAdminProject({ serviceAccount: null, envProjectId: '' })
      ).toThrow(AssertFirebaseProjectError)

      try {
        resolveAndAssertAdminProject({ serviceAccount: null, envProjectId: '' })
      } catch (e) {
        expect(['MISSING_PROJECT_ID', 'INVALID_PROJECT_ID_TYPE']).toContain(e.code)
      }
    })

    it('Cas 12b : env espaces ("   ") → bloqué', () => {
      expect(() =>
        resolveAndAssertAdminProject({ serviceAccount: null, envProjectId: '   ' })
      ).toThrow(AssertFirebaseProjectError)

      try {
        resolveAndAssertAdminProject({ serviceAccount: null, envProjectId: '   ' })
      } catch (e) {
        expect(e.code).toBe('MISSING_PROJECT_ID')
      }
    })
  })

  describe('Preuve : initializeApp non appelé après échec de validation', () => {
    it('Cas 14 : initializeApp ne doit pas être appelé si la validation échoue', async () => {
      const initializeAppMock = vi.fn()

      function simulateScriptWithFailingGuard(initializeApp) {
        const serviceAccount = { project_id: PROD }
        const envProjectId = DEMO

        resolveAndAssertAdminProject({ serviceAccount, envProjectId })
        initializeApp({ credential: 'cert(serviceAccount)' })
      }

      expect(() => simulateScriptWithFailingGuard(initializeAppMock)).toThrow(AssertFirebaseProjectError)
      expect(initializeAppMock).not.toHaveBeenCalled()
    })

    it('Cas 14b : initializeApp non appelé si project_id absent', () => {
      const initializeAppMock = vi.fn()

      function simulateScriptWithMissingId(initializeApp) {
        const serviceAccount = {}
        const envProjectId = DEMO

        resolveAndAssertAdminProject({ serviceAccount, envProjectId })
        initializeApp({ credential: 'cert(serviceAccount)' })
      }

      expect(() => simulateScriptWithMissingId(initializeAppMock)).toThrow(AssertFirebaseProjectError)
      expect(initializeAppMock).not.toHaveBeenCalled()
    })

    it('Cas 14c : initializeApp non appelé si mismatch SA/env', () => {
      const initializeAppMock = vi.fn()

      function simulateScriptWithMismatch(initializeApp) {
        resolveAndAssertAdminProject({ serviceAccount: sa(DEMO), envProjectId: OTHER_DEMO })
        initializeApp({ credential: 'cert(serviceAccount)' })
      }

      expect(() => simulateScriptWithMismatch(initializeAppMock)).toThrow(AssertFirebaseProjectError)
      expect(initializeAppMock).not.toHaveBeenCalled()
    })
  })

  describe('Sécurité des messages d\'erreur', () => {
    it('Les erreurs ne contiennent jamais private_key', () => {
      const cases = [
        () => resolveAndAssertAdminProject({ serviceAccount: sa(PROD), envProjectId: DEMO }),
        () => resolveAndAssertAdminProject({ serviceAccount: {}, envProjectId: DEMO }),
        () => resolveAndAssertAdminProject({ serviceAccount: sa(DEMO), envProjectId: PROD }),
        () => resolveAndAssertAdminProject({ serviceAccount: null, envProjectId: PROD }),
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
