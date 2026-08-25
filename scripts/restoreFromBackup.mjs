/**
 * Restauration depuis un backup NDJSON créé par resetDataToZero.mjs.
 *
 * Relit manifest.json + tous les fichiers .ndjson du dossier de backup et
 * réécrit chaque document à son chemin d'origine (Timestamps/GeoPoints/DocRefs
 * restaurés). Les documents existants aux mêmes chemins sont écrasés.
 *
 * Sécurité : dry-run par défaut ; --execute cantonné aux projets demo-*,
 * production derrière les mêmes verrous que la remise à zéro
 * (--allow-production + AKAYIS_ALLOW_PRODUCTION_RESET='true' + confirmation tapée).
 *
 * Usage :
 *   node scripts/restoreFromBackup.mjs --backup-dir=backups/reset-<ts>            # dry-run
 *   node scripts/restoreFromBackup.mjs --backup-dir=backups/reset-<ts> --execute
 */

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getFirestore, Timestamp, GeoPoint } from 'firebase-admin/firestore'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveResetProject, PRODUCTION_PROJECT_ID } from './lib/assertResetProject.mjs'
import { readNdjson, reviveValue } from './lib/firestoreBackup.mjs'
import { withRetry } from './lib/withRetry.mjs'

const BATCH_SIZE = 500

const execute = process.argv.includes('--execute')
const allowProductionFlag = process.argv.includes('--allow-production')
const backupDirArg = process.argv.find((a) => a.startsWith('--backup-dir='))

if (!backupDirArg) {
  console.error('Usage : node scripts/restoreFromBackup.mjs --backup-dir=<dossier> [--execute]')
  process.exit(1)
}
const backupDir = backupDirArg.slice('--backup-dir='.length)

const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
const serviceAccount = serviceAccountPath
  ? JSON.parse(await readFile(serviceAccountPath, 'utf8'))
  : null

const { projectId, isProduction } = resolveResetProject({
  serviceAccount,
  envProjectId: process.env.GCLOUD_PROJECT,
  execute,
  allowProductionFlag,
  envAllowProductionReset: process.env.AKAYIS_ALLOW_PRODUCTION_RESET,
})

const manifest = JSON.parse(await readFile(join(backupDir, 'manifest.json'), 'utf8'))

if (execute && manifest.projectId !== projectId) {
  console.error(
    `REFUS : le backup provient du projet "${manifest.projectId}" mais la cible est "${projectId}".`
  )
  process.exit(1)
}

if (execute && isProduction) {
  if (!process.stdin.isTTY) {
    console.error(
      'REFUS : la restauration en PRODUCTION exige une confirmation interactive au clavier.\n' +
      'Le flux stdin n\'est pas un terminal (exécution en pipe/CI). Opération bloquée.'
    )
    process.exit(1)
  }
  const { createInterface } = await import('node:readline/promises')
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  const answer = await rl.question(
    `ATTENTION : restauration en PRODUCTION (écrasement des documents existants).\n` +
    `Tapez exactement le projectId (${PRODUCTION_PROJECT_ID}) pour confirmer : `
  )
  rl.close()
  if (answer.trim() !== PRODUCTION_PROJECT_ID) {
    console.error('Confirmation invalide. Opération annulée, aucune écriture effectuée.')
    process.exit(1)
  }
}

initializeApp({
  credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
})
const db = getFirestore()
// Transport REST : connexions courtes, plus robustes sur réseau instable.
// Pas sur émulateur : le transport REST exige de vraies clés d'authentification.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  db.settings({ preferRest: true })
}
const sdk = { Timestamp, GeoPoint, db }

console.log(`Projet : ${projectId}${isProduction ? ' (PRODUCTION)' : ''}`)
console.log(`Mode   : ${execute ? 'EXECUTION' : 'DRY-RUN (aucune écriture)'}`)
console.log(`Backup : ${backupDir} (créé le ${manifest.createdAt}, projet ${manifest.projectId})`)
console.log('')

let totalDocs = 0
let pending = []

async function flushBatch() {
  if (pending.length === 0) return
  const ops = pending
  pending = []
  // Batch reconstruit à chaque tentative (un WriteBatch ne se committe qu'une
  // fois) ; des set() complets sont idempotents : nouvelle tentative sûre.
  await withRetry(() => {
    const batch = db.batch()
    for (const { path, data } of ops) batch.set(db.doc(path), data)
    return batch.commit()
  }, 'écriture batch restauration')
}

for (const [fileName, expectedCount] of Object.entries(manifest.files)) {
  const docs = await readNdjson(join(backupDir, fileName))
  if (docs.length !== expectedCount) {
    console.error(
      `ABANDON : ${fileName} contient ${docs.length} document(s) au lieu de ${expectedCount} (backup corrompu ?).`
    )
    process.exit(1)
  }
  for (const { path, data } of docs) {
    totalDocs += 1
    if (execute) {
      pending.push({ path, data: reviveValue(data, sdk) })
      if (pending.length >= BATCH_SIZE) await flushBatch()
    }
  }
  console.log(`  ${execute ? 'restauré' : 'serait restauré'} : ${fileName} (${docs.length} document(s))`)
}

if (execute) await flushBatch()

console.log('')
if (execute) {
  console.log(`Restauration terminée : ${totalDocs} document(s) réécrits depuis ${backupDir}.`)
} else {
  console.log(`Dry-run uniquement : ${totalDocs} document(s) seraient restaurés. Relancer avec --execute.`)
}
