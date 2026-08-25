#!/usr/bin/env node
/**
 * CLI — Crée un compte technique (system_manager ou dealer).
 *
 * Usage :
 *   node scripts/createTechnicalUser.mjs --role system_manager --email mgr@example.test --name "Gérant"
 *   node scripts/createTechnicalUser.mjs --role dealer --email dl@example.test --name "Dealer" [--show-reset-link]
 *
 * Codes de sortie :
 *   0  CREATED | PROFILE_CREATED | UNCHANGED
 *   1  Validation, env ou erreur inattendue
 *   3  ROLE_CONFLICT | EMAIL_UID_CONFLICT | ORPHAN_PROFILE
 *   4  PROFILE_MISMATCH | EMAIL_MISMATCH
 *   5  AUTH_CREATE_FAILED
 *   6  FIRESTORE_CREATE_FAILED
 *   7  RESET_LINK_FAILED
 */

import {
  parseStrictArgs,
  normalizeEmail,
  validateRole,
  validateName,
  createTechnicalUser,
  AdminEnvError,
} from './lib/technicalUserProvisioning.mjs'

// ─── 1. Parser strict ───
let parsed
try {
  parsed = parseStrictArgs(process.argv, {
    keys: ['role', 'email', 'name'],
    flags: ['show-reset-link'],
  })
} catch (err) {
  console.error(`\n[PARSE] ${err.message}`)
  console.error('Usage : node scripts/createTechnicalUser.mjs --role <rôle> --email <email> --name "<nom>" [--show-reset-link]')
  process.exitCode = 1
  process.exit()
}

let email, name
try {
  validateRole(parsed.role)
  email = normalizeEmail(parsed.email)
  validateName(parsed.name)
  name = parsed.name.trim()
} catch (err) {
  console.error(`\n[VALIDATION] ${err.message}`)
  process.exitCode = 1
  process.exit()
}

const { role } = parsed
const showResetLink = Boolean(parsed['show-reset-link'])

// ─── 2. Chargement Admin SDK (émulateur obligatoire) ───
let adminMod
try {
  adminMod = await import('./lib/adminApp.mjs')
} catch (err) {
  if (err instanceof AdminEnvError || err.code?.startsWith('EMULATOR') || err.code?.includes('PROJECT')) {
    console.error(`\n[${err.code ?? 'ENV_ERROR'}] ${err.message}\n`)
  } else {
    console.error(`\n[INIT] Initialisation Admin SDK échouée : ${err.message}\n`)
  }
  process.exitCode = 1
  process.exit()
}

const { auth, db, projectId, isEmulator, closeAdminApp } = adminMod
console.log(`\n[createTechnicalUser] ${email} | rôle=${role} | projet=${projectId} | émulateur=${isEmulator}`)

// ─── 3. Callback reset link ───
let resetLinkValue = null
const onResetLink = (link) => {
  resetLinkValue = link
}

const EXIT_CODES = {
  UNCHANGED: 0, CREATED: 0, PROFILE_CREATED: 0, CREATED_WITH_AUDIT_FAILURE: 0,
  ROLE_CONFLICT: 3, EMAIL_UID_CONFLICT: 3, ORPHAN_PROFILE: 3,
  PROFILE_MISMATCH: 4, EMAIL_MISMATCH: 4,
  AUTH_CREATE_FAILED: 5,
  FIRESTORE_CREATE_FAILED: 6,
  RESET_LINK_FAILED: 7,
}

// ─── 4. Exécution + résumé ───
let exitCode = 1
try {
  const result = await createTechnicalUser(
    { email, name, role, onResetLink },
    { auth, db, projectId, isEmulator }
  )

  console.log('\n─────────────────────────────────────────')
  console.log(`Résultat : ${result.result}`)
  console.log(`Email    : ${email}`)
  console.log(`Rôle     : ${role}`)
  console.log(`UID      : ${result.uid ?? 'N/A'}`)
  console.log(`Projet   : ${projectId}`)

  if (result.result === 'UNCHANGED') {
    console.log('(compte déjà valide — aucune modification)')
  } else if (result.result === 'CREATED' || result.result === 'PROFILE_CREATED') {
    console.log(`Lien reset : ${result.resetLinkGenerated ? 'RESET_LINK_GENERATED' : 'NON_GÉNÉRÉ'}`)
    if (showResetLink && resetLinkValue) {
      console.log('\n[--show-reset-link] Ce lien est réservé à l\'émulateur local. Ne jamais committer.')
      console.log(resetLinkValue)
    }
  } else if (result.result === 'CREATED_WITH_AUDIT_FAILURE') {
    console.log('[AVERTISSEMENT] Compte créé mais audit Firestore raté. Le compte est fonctionnel.')
  } else {
    console.error(`\n[ÉCHEC] ${result.result}`)
    if (result.error) console.error(`Détail : ${result.error}`)
    if (result.errors) result.errors.forEach((e) => console.error(`  – ${e}`))
    if (result.rollbackAttempted !== undefined) {
      console.error(`Rollback tenté : ${result.rollbackAttempted} | Réussi : ${result.rollbackSucceeded}`)
    }
  }

  console.log('─────────────────────────────────────────\n')
  exitCode = EXIT_CODES[result.result] ?? 1
} catch (err) {
  console.error(`\n[ERREUR] ${err.message}`)
  exitCode = 1
} finally {
  await closeAdminApp().catch(() => {})
}
process.exit(exitCode)
