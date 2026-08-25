import { readFile } from 'node:fs/promises'
import { resolveAndAssertAdminProject, AssertFirebaseProjectError } from './lib/resolveAndAssertAdminProject.mjs'

const email = String(process.env.AKAYIS_LOGIN_EMAIL || process.env.npm_config_email || '').trim().toLowerCase()
const password = String(process.env.AKAYIS_LOGIN_PASSWORD || '')
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS

if (!email || !password) {
  console.error('Usage: definir AKAYIS_LOGIN_EMAIL et AKAYIS_LOGIN_PASSWORD puis lancer npm run account:update-password')
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

const auth = getAuth()
const user = await auth.getUserByEmail(email)
await auth.updateUser(user.uid, {
  password,
  disabled: false,
  emailVerified: true
})

console.log(`OK - mot de passe mis a jour et compte actif pour ${email}`)
