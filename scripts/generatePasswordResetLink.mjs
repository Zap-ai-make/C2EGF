import { readFile } from 'node:fs/promises'
import { resolveAndAssertAdminProject, AssertFirebaseProjectError } from './lib/resolveAndAssertAdminProject.mjs'

const emailArg = process.argv.find((arg) => arg.startsWith('--email='))
const email = String(emailArg?.slice('--email='.length) || process.env.npm_config_email || process.argv[2] || '').trim().toLowerCase()
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS

if (!email) {
  console.error('Usage: npm run account:reset-link -- --email=compte@example.com')
  process.exit(1)
}

if (!serviceAccountPath) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS doit pointer vers le JSON du service account Firebase Admin.')
  process.exit(1)
}

// Garde projet : lire le service account et valider AVANT toute initialisation
// Firebase (bloque c2egf-b0b5a et tout projet non demo-*).
const serviceAccount = JSON.parse(await readFile(serviceAccountPath, 'utf8'))
try {
  resolveAndAssertAdminProject({ serviceAccount, envProjectId: process.env.GCLOUD_PROJECT })
} catch (error) {
  if (error instanceof AssertFirebaseProjectError) {
    console.error(`Opération bloquée [${error.code}] : ${error.message}`)
    process.exit(1)
  }
  throw error
}

const { initializeApp, cert } = await import('firebase-admin/app')
const { getAuth } = await import('firebase-admin/auth')

initializeApp({
  credential: cert(serviceAccount)
})

const link = await getAuth().generatePasswordResetLink(email)
console.log(link)
