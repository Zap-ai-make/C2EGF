#!/usr/bin/env node
/**
 * CLI — Supprime un compte technique. Émulateur uniquement.
 * Requiert --confirm explicite.
 *
 * Usage :
 *   node scripts/deleteTechnicalUser.mjs --email mgr@example.test --confirm
 *
 * Codes de sortie :
 *   0  DELETED
 *   1  Validation, env, INVALID, ROLE_CONFLICT, EMAIL_MISMATCH, erreur
 *   2  ROLE_CONFLICT store_admin (refus absolu)
 *   3  NOT_FOUND | EMAIL_UID_CONFLICT
 */

import {
  parseStrictArgs,
  normalizeEmail,
  deleteTechnicalUser,
  AdminEnvError,
} from './lib/technicalUserProvisioning.mjs'

// ─── 1. Parser strict ───
let parsed
try {
  parsed = parseStrictArgs(process.argv, {
    keys: ['email'],
    flags: ['confirm'],
  })
} catch (err) {
  console.error(`\n[PARSE] ${err.message}`)
  console.error('Usage : node scripts/deleteTechnicalUser.mjs --email <email> --confirm')
  process.exitCode = 1
  process.exit()
}

let email
try {
  email = normalizeEmail(parsed.email)
} catch (err) {
  console.error(`\n[VALIDATION] ${err.message}`)
  process.exitCode = 1
  process.exit()
}

if (!parsed.confirm) {
  console.error(`\n[SÉCURITÉ] --confirm requis pour supprimer ${email}.\n`)
  process.exitCode = 1
  process.exit()
}

// ─── 2. Chargement Admin SDK ───
let adminMod
try {
  adminMod = await import('./lib/adminApp.mjs')
} catch (err) {
  if (err instanceof AdminEnvError || err.code) {
    console.error(`\n[${err.code ?? 'ENV_ERROR'}] ${err.message}\n`)
  } else {
    console.error(`\n[INIT] ${err.message}\n`)
  }
  process.exitCode = 1
  process.exit()
}

const { auth, db, projectId, isEmulator, closeAdminApp } = adminMod
console.log(`\n[deleteTechnicalUser] ${email} | projet=${projectId} | émulateur=${isEmulator}`)

const EXIT_CODES = {
  DELETED: 0,
  NOT_FOUND: 3,
  EMAIL_UID_CONFLICT: 3,
  ROLE_CONFLICT: 2,
}

// ─── 3. Suppression + résumé ───
let exitCode = 1
try {
  const result = await deleteTechnicalUser({ email }, { auth, db, projectId, isEmulator })

  console.log('\n─────────────────────────────────────────')
  console.log(`Résultat : ${result.result}`)
  if (result.uid) console.log(`UID      : ${result.uid}`)
  if (result.role) console.log(`Rôle     : ${result.role}`)
  if (result.error) console.error(`Détail   : ${result.error}`)
  if (result.rollbackAttempted !== undefined) {
    console.error(`Rollback : tenté=${result.rollbackAttempted} | réussi=${result.rollbackSucceeded}`)
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
