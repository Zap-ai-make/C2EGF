/**
 * Tests d'intégration — Comptes techniques AKAYIS
 *
 * Pré-requis : firebase emulators:exec --only auth,firestore --project demo-akayis-test "npm run test:integration"
 *
 * Ce fichier appelle les vraies fonctions métier (createTechnicalUser, verifyTechnicalUser,
 * deleteTechnicalUser) depuis technicalUserProvisioning.mjs avec des dépendances Auth/Firestore
 * réelles pointant vers les émulateurs.
 *
 * Les tests CLI (processus enfant) vérifient les scripts réels.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { spawn } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

import {
  createTechnicalUser,
  verifyTechnicalUser,
  deleteTechnicalUser,
  PRODUCTION_BLOCKED_PROJECTS,
  isProjectAllowed,
  validateEmulatorEnv,
} from '../../scripts/lib/technicalUserProvisioning.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCRIPTS_DIR = join(__dirname, '../../scripts')

// ─────────────────────────────────────────────
// Garde de sécurité avant toute initialisation
// ─────────────────────────────────────────────
const envCheck = validateEmulatorEnv(process.env)
if (!envCheck.ok) {
  throw new Error(
    `[SÉCURITÉ] Environnement émulateur invalide : [${envCheck.code}] ${envCheck.message}\n` +
    'Lance via : firebase emulators:exec --only auth,firestore --project demo-akayis-test "npm run test:integration"'
  )
}

const PROJECT_ID = envCheck.projectId

if (PROJECT_ID !== 'demo-akayis-test') {
  throw new Error(
    `[SÉCURITÉ] GCLOUD_PROJECT doit être "demo-akayis-test" (reçu : "${PROJECT_ID}")`
  )
}

if (PRODUCTION_BLOCKED_PROJECTS.includes(PROJECT_ID)) {
  throw new Error(`[SÉCURITÉ] "${PROJECT_ID}" est dans la liste bloquée.`)
}

// ─────────────────────────────────────────────
// Initialisation Admin SDK
// ─────────────────────────────────────────────
let app, auth, db

beforeAll(() => {
  app = initializeApp({ projectId: PROJECT_ID }, 'test-integration')
  auth = getAuth(app)
  db = getFirestore(app)
})

afterAll(async () => {
  if (app) await deleteApp(app)
})

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
async function cleanupUser(emailAddr) {
  try {
    const u = await auth.getUserByEmail(emailAddr)
    await auth.deleteUser(u.uid)
    await db.doc(`users/${u.uid}`).delete().catch(() => {})
  } catch {
    // already gone
  }
}

function makeDeps() {
  return {
    auth,
    db,
    projectId: PROJECT_ID,
    isEmulator: true,
    generateResetLink: (em) => auth.generatePasswordResetLink(em),
    writeAudit: (entry) => db.collection('auditLogs').add(entry),
  }
}

// Timeout interne légèrement inférieur au timeout Vitest des tests CLI (30s)
// pour retourner un message diagnostique avant l'expiration du test.
const CLI_PROCESS_TIMEOUT = 25000

async function runCLI(script, args, envOverrides = {}) {
  const env = {
    ...process.env,
    FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099',
    FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080',
    GCLOUD_PROJECT: PROJECT_ID,
    ...envOverrides,
  }

  return new Promise((resolve) => {
    let settled = false
    let stdout = ''
    let stderr = ''

    const proc = spawn(process.execPath, [join(SCRIPTS_DIR, script), ...args], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })

    const killTimer = setTimeout(() => {
      if (settled) return
      settled = true
      try { proc.kill('SIGKILL') } catch (_) { /* ignore */ }
      resolve({
        exitCode: -1,
        stdout: '',
        stderr: `[CLI_PROCESS_TIMEOUT] script=${script} duration=${CLI_PROCESS_TIMEOUT}ms`,
        timedOut: true,
      })
    }, CLI_PROCESS_TIMEOUT)

    proc.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(killTimer)
      resolve({ exitCode: code ?? 0, stdout, stderr, timedOut: false })
    })

    proc.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(killTimer)
      resolve({ exitCode: -1, stdout, stderr: err.message, timedOut: false })
    })
  })
}

// ─────────────────────────────────────────────
// TI-1 — Cycle de vie complet system_manager
// ─────────────────────────────────────────────
describe('TI-1 — Cycle de vie system_manager (via fonctions métier)', () => {
  const email = 'sm-test@akayis.test'
  let uid

  beforeEach(async () => { await cleanupUser(email) })
  afterAll(async () => { await cleanupUser(email) })

  it('TI-1-A : CREATED — Auth + profil créés', async () => {
    const result = await createTechnicalUser(
      { email, name: 'SM Test', role: 'system_manager' },
      makeDeps()
    )
    expect(result.result).toBe('CREATED')
    expect(result.uid).toBeTruthy()
    expect(result.resetLinkGenerated).toBe(true)
    expect(result.resetLink).toBeUndefined()
    uid = result.uid

    const snap = await db.doc(`users/${uid}`).get()
    expect(snap.exists).toBe(true)
    expect(snap.data().role).toBe('system_manager')
    expect(snap.data().active).toBe(true)
    expect(snap.data().storeId).toBeUndefined()
  }, 15000)

  it('TI-1-B : UNCHANGED — second appel sans modification', async () => {
    const first = await createTechnicalUser({ email, name: 'SM Test', role: 'system_manager' }, makeDeps())
    expect(first.result).toBe('CREATED')
    const before = await db.doc(`users/${first.uid}`).get()

    const second = await createTechnicalUser({ email, name: 'SM Test', role: 'system_manager' }, makeDeps())
    expect(second.result).toBe('UNCHANGED')
    expect(second.uid).toBe(first.uid)

    const after = await db.doc(`users/${first.uid}`).get()
    expect(after.data().createdAt?.toDate()?.getTime()).toBeCloseTo(
      before.data().createdAt?.toDate()?.getTime(), -3
    )
  }, 15000)

  it('TI-1-C : verify VALID après création', async () => {
    await createTechnicalUser({ email, name: 'SM Test', role: 'system_manager' }, makeDeps())
    const r = await verifyTechnicalUser({ email, role: 'system_manager' }, { auth, db })
    expect(r.result).toBe('VALID')
    expect(r.checks.every(c => c.ok)).toBe(true)
  }, 15000)

  it('TI-1-D : delete réussi', async () => {
    const cr = await createTechnicalUser({ email, name: 'SM Test', role: 'system_manager' }, makeDeps())
    expect(cr.result).toBe('CREATED')

    const dr = await deleteTechnicalUser({ email }, makeDeps())
    expect(dr.result).toBe('DELETED')
  }, 15000)

  it('TI-1-E : verify NOT_FOUND après delete', async () => {
    await createTechnicalUser({ email, name: 'SM Test', role: 'system_manager' }, makeDeps())
    await deleteTechnicalUser({ email }, makeDeps())
    const vr = await verifyTechnicalUser({ email, role: 'system_manager' }, { auth, db })
    expect(vr.result).toBe('NOT_FOUND')
  }, 20000)

  it('TI-1-F : reset link ne doit pas apparaître dans l\'audit Firestore', async () => {
    await createTechnicalUser({ email, name: 'SM Test', role: 'system_manager' }, makeDeps())
    const snap = await db.collection('auditLogs').orderBy('executedAt', 'desc').limit(5).get()
    for (const doc of snap.docs) {
      const str = JSON.stringify(doc.data())
      expect(str).not.toMatch(/oobCode/)
      expect(str).not.toMatch(/resetLink/i)
    }
  }, 15000)
})

// ─────────────────────────────────────────────
// TI-2 — Cycle de vie dealer
// ─────────────────────────────────────────────
describe('TI-2 — Cycle de vie dealer', () => {
  const email = 'dealer-test@akayis.test'

  beforeEach(async () => { await cleanupUser(email) })
  afterAll(async () => { await cleanupUser(email) })

  it('TI-2-A : CREATED dealer sans champs boutique', async () => {
    const result = await createTechnicalUser({ email, name: 'Dealer Test', role: 'dealer' }, makeDeps())
    expect(result.result).toBe('CREATED')

    const snap = await db.doc(`users/${result.uid}`).get()
    const data = snap.data()
    expect(data.role).toBe('dealer')
    expect(data.storeId).toBeUndefined()
    expect(data.storeName).toBeUndefined()
    expect(data.dealerId).toBeUndefined()
    expect(data.active).toBe(true)
  }, 15000)

  it('TI-2-B : verify VALID dealer', async () => {
    await createTechnicalUser({ email, name: 'Dealer Test', role: 'dealer' }, makeDeps())
    const r = await verifyTechnicalUser({ email, role: 'dealer' }, { auth, db })
    expect(r.result).toBe('VALID')
  }, 15000)
})

// ─────────────────────────────────────────────
// TI-3 — PROFILE_CREATED
// ─────────────────────────────────────────────
describe('TI-3 — PROFILE_CREATED (Auth préexistant, profil absent)', () => {
  const email = 'profile-created@akayis.test'

  beforeEach(async () => { await cleanupUser(email) })
  afterAll(async () => { await cleanupUser(email) })

  it('TI-3-A : PROFILE_CREATED si Auth préexistant cohérent', async () => {
    // Créer un compte Auth sans profil Firestore
    const user = await auth.createUser({ email, displayName: 'Orphan Auth', emailVerified: false, disabled: false })

    const result = await createTechnicalUser({ email, name: 'SM Global', role: 'system_manager' }, makeDeps())
    expect(result.result).toBe('PROFILE_CREATED')
    expect(result.uid).toBe(user.uid)

    const snap = await db.doc(`users/${user.uid}`).get()
    expect(snap.exists).toBe(true)
    expect(snap.data().role).toBe('system_manager')
  }, 15000)

  it('TI-3-B : verify VALID après PROFILE_CREATED', async () => {
    await auth.createUser({ email, displayName: 'PC', emailVerified: false, disabled: false })
    await createTechnicalUser({ email, name: 'SM Global', role: 'system_manager' }, makeDeps())
    const r = await verifyTechnicalUser({ email, role: 'system_manager' }, { auth, db })
    expect(r.result).toBe('VALID')
  }, 15000)
})

// ─────────────────────────────────────────────
// TI-4 — Conflit store_admin
// ─────────────────────────────────────────────
describe('TI-4 — ROLE_CONFLICT store_admin', () => {
  const email = 'store-conflict@akayis.test'
  let uid

  beforeAll(async () => {
    await cleanupUser(email)
    const user = await auth.createUser({ email, displayName: 'Store Admin', emailVerified: false, disabled: false })
    uid = user.uid
    await db.doc(`users/${uid}`).set({
      name: 'Store Admin', email, role: 'store_admin', storeId: 'store-001',
      storeName: 'Boutique Test', active: true, lastLogin: null,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    })
  })
  afterAll(async () => { await cleanupUser(email) })

  it('TI-4-A : ROLE_CONFLICT — rôle dans profil Firestore', async () => {
    const result = await createTechnicalUser({ email, name: 'New', role: 'system_manager' }, makeDeps())
    expect(result.result).toBe('ROLE_CONFLICT')
  }, 10000)

  it('TI-4-B : compte store_admin intact après refus', async () => {
    await createTechnicalUser({ email, name: 'New', role: 'system_manager' }, makeDeps())
    const snap = await db.doc(`users/${uid}`).get()
    expect(snap.data().role).toBe('store_admin')
    expect(snap.data().storeId).toBe('store-001')
  }, 10000)

  it('TI-4-C : delete refusé pour store_admin', async () => {
    const result = await deleteTechnicalUser({ email }, makeDeps())
    expect(result.result).toBe('ROLE_CONFLICT')
  }, 10000)

  it('TI-4-D : ROLE_CONFLICT via custom claim store_admin', async () => {
    const emailClaim = 'claim-conflict@akayis.test'
    await cleanupUser(emailClaim)
    const user = await auth.createUser({ email: emailClaim, displayName: 'Claim', emailVerified: false, disabled: false })
    await auth.setCustomUserClaims(user.uid, { role: 'store_admin' })

    const result = await createTechnicalUser({ email: emailClaim, name: 'Test', role: 'system_manager' }, makeDeps())
    expect(result.result).toBe('ROLE_CONFLICT')
    await cleanupUser(emailClaim)
  }, 15000)
})

// ─────────────────────────────────────────────
// TI-5 — Rollback Auth si Firestore échoue
// ─────────────────────────────────────────────
describe('TI-5 — Rollback', () => {
  const email = 'rollback-test@akayis.test'

  beforeEach(async () => { await cleanupUser(email) })
  afterAll(async () => { await cleanupUser(email) })

  it('TI-5-A : rollback Auth complet si generateResetLink échoue', async () => {
    const failingResetLink = async () => { throw new Error('Reset link injected failure') }
    const result = await createTechnicalUser(
      { email, name: 'Rollback Test', role: 'dealer' },
      { ...makeDeps(), generateResetLink: failingResetLink }
    )
    expect(result.result).toBe('RESET_LINK_FAILED')
    expect(result.rollbackAttempted).toBe(true)
    expect(result.rollbackSucceeded).toBe(true)

    // Compte Auth supprimé
    await expect(auth.getUserByEmail(email)).rejects.toMatchObject({ code: 'auth/user-not-found' })
    // Profil Firestore absent (on ne connaît pas l'uid, mais on peut vérifier via query)
  }, 20000)
})

// ─────────────────────────────────────────────
// TI-6 — Piste d'audit Firestore
// ─────────────────────────────────────────────
describe('TI-6 — Audit Firestore', () => {
  const email = 'audit-test@akayis.test'

  beforeEach(async () => { await cleanupUser(email) })
  afterAll(async () => { await cleanupUser(email) })

  it('TI-6-A : audit TECHNICAL_USER_CREATED écrit dans auditLogs', async () => {
    await createTechnicalUser({ email, name: 'Audit Test', role: 'system_manager' }, makeDeps())

    const snaps = await db.collection('auditLogs')
      .where('targetEmail', '==', email)
      .where('action', '==', 'TECHNICAL_USER_CREATED')
      .get()

    expect(snaps.docs.length).toBeGreaterThan(0)
    const data = snaps.docs[0].data()
    expect(data.actorType).toBe('provisioning_script')
    expect(data.emulator).toBe(true)
    expect(data.projectId).toBe(PROJECT_ID)
    expect(data.targetRole).toBe('system_manager')

    // Aucun secret
    const str = JSON.stringify(data)
    expect(str).not.toMatch(/password/i)
    expect(str).not.toMatch(/resetLink/i)
    expect(str).not.toMatch(/oobCode/i)
  }, 15000)

  it('TI-6-B : audit TECHNICAL_USER_DELETED après suppression', async () => {
    await createTechnicalUser({ email, name: 'Audit Del', role: 'dealer' }, makeDeps())
    await deleteTechnicalUser({ email }, makeDeps())

    const snaps = await db.collection('auditLogs')
      .where('targetEmail', '==', email)
      .where('action', '==', 'TECHNICAL_USER_DELETED')
      .get()

    expect(snaps.docs.length).toBeGreaterThan(0)
  }, 20000)
})

// ─────────────────────────────────────────────
// TI-7 — Sécurité projet
// ─────────────────────────────────────────────
describe('TI-7 — Sécurité projet', () => {
  it('TI-7-A : PRODUCTION_BLOCKED_PROJECTS contient taofic-ajagbe', () => {
    expect([...PRODUCTION_BLOCKED_PROJECTS]).toContain('taofic-ajagbe')
  })

  it('TI-7-B : taofic-ajagbe refusé par isProjectAllowed', () => {
    expect(isProjectAllowed('taofic-ajagbe')).toBe(false)
  })

  it('TI-7-C : demo-akayis-test autorisé', () => {
    expect(isProjectAllowed('demo-akayis-test')).toBe(true)
  })

  it('TI-7-D : projet courant est demo-akayis-test', () => {
    expect(PROJECT_ID).toBe('demo-akayis-test')
  })

  it('TI-7-E : validateEmulatorEnv bloque taofic-ajagbe', () => {
    const r = validateEmulatorEnv({
      FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      GCLOUD_PROJECT: 'taofic-ajagbe',
    })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('PRODUCTION_PROJECT_BLOCKED')
  })

  it('TI-7-F : validateEmulatorEnv bloque projet non-demo', () => {
    const r = validateEmulatorEnv({
      FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      GCLOUD_PROJECT: 'akayis-test',
    })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('NON_DEMO_PROJECT_BLOCKED')
  })
})

// ─────────────────────────────────────────────
// TI-8 — Tests des CLI réels (processus enfant)
// ─────────────────────────────────────────────
describe('TI-8 — Scripts CLI (processus enfant)', () => {
  const email = 'cli-test@akayis.test'
  const emailResetDefault = 'cli-reset-default@akayis.test'
  const emailResetLink = 'cli-reset-link@akayis.test'

  beforeEach(async () => { await cleanupUser(email) })
  afterAll(async () => {
    await cleanupUser(email)
    await cleanupUser(emailResetDefault)
    await cleanupUser(emailResetLink)
  })

  it('TI-8-A : create valide → exit 0, résultat CREATED', async () => {
    const r = await runCLI('createTechnicalUser.mjs', [
      '--role', 'system_manager', '--email', email, '--name', 'CLI Test',
    ])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toMatch(/CREATED/)
  }, 20000)

  it('TI-8-B : create idempotente → exit 0, résultat UNCHANGED', async () => {
    await runCLI('createTechnicalUser.mjs', ['--role', 'system_manager', '--email', email, '--name', 'CLI Test'])
    const r2 = await runCLI('createTechnicalUser.mjs', ['--role', 'system_manager', '--email', email, '--name', 'CLI Test'])
    expect(r2.exitCode).toBe(0)
    expect(r2.stdout).toMatch(/UNCHANGED/)
  }, 30000)

  it('TI-8-C : verify après create → exit 0', async () => {
    await runCLI('createTechnicalUser.mjs', ['--role', 'system_manager', '--email', email, '--name', 'CLI Test'])
    const r = await runCLI('verifyTechnicalUser.mjs', ['--role', 'system_manager', '--email', email])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toMatch(/VALID/)
  }, 30000)

  it('TI-8-D : delete sans --confirm → exit non nul', async () => {
    const r = await runCLI('deleteTechnicalUser.mjs', ['--email', email])
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toMatch(/confirm/)
    // 30s (> CLI_PROCESS_TIMEOUT interne de 25s) : le démarrage à froid d'un
    // processus enfant + import firebase-admin peut dépasser 10s sous charge.
    // Le kill interne du helper reste le garde-fou contre un vrai blocage.
  }, 30000)

  it('TI-8-E : delete avec --confirm → exit 0', async () => {
    await runCLI('createTechnicalUser.mjs', ['--role', 'dealer', '--email', email, '--name', 'CLI Del'])
    const r = await runCLI('deleteTechnicalUser.mjs', ['--email', email, '--confirm'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toMatch(/DELETED/)
  }, 25000)

  it('TI-8-F : verify après delete → exit non nul', async () => {
    await runCLI('createTechnicalUser.mjs', ['--role', 'dealer', '--email', email, '--name', 'CLI Del'])
    await runCLI('deleteTechnicalUser.mjs', ['--email', email, '--confirm'])
    const r = await runCLI('verifyTechnicalUser.mjs', ['--role', 'dealer', '--email', email])
    expect(r.exitCode).not.toBe(0)
    expect(r.stdout + r.stderr).toMatch(/NOT_FOUND/)
  }, 30000)

  it('TI-8-G : option inconnue → exit non nul', async () => {
    const r = await runCLI('createTechnicalUser.mjs', ['--role', 'dealer', '--unknown-option'])
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toMatch(/inconnue/)
  }, 30000)

  it('TI-8-H : rôle store_admin → exit non nul', async () => {
    const r = await runCLI('createTechnicalUser.mjs', ['--role', 'store_admin', '--email', email, '--name', 'Test'])
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toMatch(/boutique/)
  }, 30000)

  it('TI-8-I : GCLOUD_PROJECT=taofic-ajagbe → exit non nul', async () => {
    const r = await runCLI(
      'createTechnicalUser.mjs',
      ['--role', 'dealer', '--email', email, '--name', 'Test'],
      { GCLOUD_PROJECT: 'taofic-ajagbe' }
    )
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr + r.stdout).toMatch(/taofic-ajagbe/)
  }, 30000)

  it('TI-8-J : FIREBASE_AUTH_EMULATOR_HOST absent → exit non nul', async () => {
    const envWithout = {
      FIREBASE_AUTH_EMULATOR_HOST: '',
      FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
      GCLOUD_PROJECT: PROJECT_ID,
    }
    const r = await runCLI(
      'createTechnicalUser.mjs',
      ['--role', 'dealer', '--email', email, '--name', 'Test'],
      envWithout
    )
    expect(r.exitCode).not.toBe(0)
  }, 30000)

  it('TI-8-K : GCLOUD_PROJECT non-demo (akayis-test) → exit non nul', async () => {
    const r = await runCLI(
      'createTechnicalUser.mjs',
      ['--role', 'dealer', '--email', email, '--name', 'Test'],
      { GCLOUD_PROJECT: 'akayis-test' }
    )
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr + r.stdout).toMatch(/demo|NON_DEMO/)
  }, 30000)

  it('TI-8-L : verify sans --role → exit non nul', async () => {
    const r = await runCLI('verifyTechnicalUser.mjs', ['--email', email])
    expect(r.exitCode).not.toBe(0)
  }, 30000)

  it('TI-8-M1 : sans --show-reset-link, le lien complet est masqué dans stdout', async () => {
    await cleanupUser(emailResetDefault)
    const r = await runCLI('createTechnicalUser.mjs', [
      '--role', 'system_manager', '--email', emailResetDefault, '--name', 'RL Default',
    ])
    expect(r.timedOut).toBe(false)
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toMatch(/CREATED/)
    expect(r.stdout).toMatch(/RESET_LINK_GENERATED/)
    expect(r.stdout).not.toMatch(/oobCode/)
    expect(r.stderr).not.toMatch(/oobCode/)
  }, 30000)

  it('TI-8-M2 : avec --show-reset-link, le lien oobCode est affiché et absent de l\'audit', async () => {
    await cleanupUser(emailResetLink)
    const r = await runCLI('createTechnicalUser.mjs', [
      '--role', 'system_manager', '--email', emailResetLink, '--name', 'RL Link', '--show-reset-link',
    ])
    expect(r.timedOut).toBe(false)
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toMatch(/CREATED/)
    expect(r.stdout).toMatch(/oobCode/)

    // Vérifier que l'audit Firestore ne contient pas le lien
    const auditSnap = await db.collection('auditLogs').where('targetEmail', '==', emailResetLink).get()
    for (const doc of auditSnap.docs) {
      expect(JSON.stringify(doc.data())).not.toMatch(/oobCode/)
    }
  }, 30000)
})
