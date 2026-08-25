#!/usr/bin/env node
/**
 * CLI — Vérifie la cohérence d'un compte technique.
 * --role est obligatoire.
 *
 * Usage :
 *   node scripts/verifyTechnicalUser.mjs --role system_manager --email mgr@example.test
 *
 * Codes de sortie :
 *   0  VALID
 *   1  INVALID | NOT_FOUND | erreur
 */

import {
  parseStrictArgs,
  normalizeEmail,
  validateRole,
  verifyTechnicalUser,
  AdminEnvError,
} from './lib/technicalUserProvisioning.mjs'

// ─── 1. Parser strict ───
let parsed
try {
  parsed = parseStrictArgs(process.argv, {
    keys: ['role', 'email'],
    flags: [],
  })
} catch (err) {
  console.error(`\n[PARSE] ${err.message}`)
  console.error('Usage : node scripts/verifyTechnicalUser.mjs --role <rôle> --email <email>')
  process.exitCode = 1
  process.exit()
}

let email
try {
  if (!parsed.role) throw new Error('--role est obligatoire.')
  validateRole(parsed.role)
  email = normalizeEmail(parsed.email)
} catch (err) {
  console.error(`\n[VALIDATION] ${err.message}`)
  process.exitCode = 1
  process.exit()
}

const { role } = parsed

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

const { auth, db, projectId, closeAdminApp } = adminMod
console.log(`\n[verifyTechnicalUser] ${email} | rôle attendu=${role} | projet=${projectId}`)

// ─── 3. Vérification + résumé ───
let exitCode = 1
try {
  const result = await verifyTechnicalUser({ email, role }, { auth, db })

  console.log('\n─────────────────────────────────────────')
  console.log(`Résultat : ${result.result}`)
  if (result.uid) console.log(`UID      : ${result.uid}`)

  for (const check of result.checks ?? []) {
    console.log(`  ${check.ok ? '✓' : '✗'} ${check.label}`)
  }

  if (result.structErrors?.length > 0) {
    console.log('\nErreurs structurelles :')
    result.structErrors.forEach((e) => console.log(`  – ${e}`))
  }

  console.log('─────────────────────────────────────────\n')
  exitCode = result.result === 'VALID' ? 0 : 1
} catch (err) {
  console.error(`\n[ERREUR] ${err.message}`)
  exitCode = 1
} finally {
  await closeAdminApp().catch(() => {})
}
process.exit(exitCode)
