import { readFile } from 'node:fs/promises'
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { resolveAndAssertAdminProject } from './lib/resolveAndAssertAdminProject.mjs'

const sourceEmail = String(process.env.AKAYIS_SOURCE_EMAIL || '').trim().toLowerCase()
const targetEmail = String(process.env.AKAYIS_TARGET_EMAIL || '').trim().toLowerCase()
const password = String(process.env.AKAYIS_LOGIN_PASSWORD || '')
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS

if (!sourceEmail || !targetEmail || !password) {
  console.error('Usage: definir AKAYIS_SOURCE_EMAIL, AKAYIS_TARGET_EMAIL et AKAYIS_LOGIN_PASSWORD puis lancer npm run account:create-temp-access')
  process.exit(1)
}

if (!serviceAccountPath) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS doit pointer vers le JSON du service account Firebase Admin.')
  process.exit(1)
}

const serviceAccount = JSON.parse(await readFile(serviceAccountPath, 'utf8'))

resolveAndAssertAdminProject({
  serviceAccount,
  envProjectId: process.env.GCLOUD_PROJECT,
})

initializeApp({
  credential: cert(serviceAccount)
})

const auth = getAuth()
const db = getFirestore()

const sourceUser = await auth.getUserByEmail(sourceEmail)
const sourceProfileSnap = await db.doc(`users/${sourceUser.uid}`).get()

if (!sourceProfileSnap.exists) {
  throw new Error(`Profil source users/${sourceUser.uid} introuvable`)
}

const sourceProfile = sourceProfileSnap.data()
if (!sourceProfile.storeId) {
  throw new Error('Le profil source n a pas de storeId')
}

const storeSnap = await db.doc(`stores/${sourceProfile.storeId}`).get()
if (!storeSnap.exists) {
  throw new Error(`Boutique stores/${sourceProfile.storeId} introuvable`)
}

let targetUser
try {
  targetUser = await auth.getUserByEmail(targetEmail)
  targetUser = await auth.updateUser(targetUser.uid, {
    password,
    disabled: false,
    emailVerified: true,
    displayName: sourceProfile.name || sourceProfile.storeName || targetEmail
  })
} catch (error) {
  if (error.code !== 'auth/user-not-found') {
    throw error
  }

  targetUser = await auth.createUser({
    email: targetEmail,
    password,
    disabled: false,
    emailVerified: true,
    displayName: sourceProfile.name || sourceProfile.storeName || targetEmail
  })
}

await db.doc(`users/${targetUser.uid}`).set({
  name: sourceProfile.name || sourceProfile.storeName || targetEmail,
  email: targetEmail,
  role: 'store_admin',
  active: true,
  storeId: sourceProfile.storeId,
  storeName: sourceProfile.storeName || storeSnap.data().name || 'Boutique',
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp()
}, { merge: true })

console.log(`OK - acces temporaire cree pour ${targetEmail}`)
console.log(`UID: ${targetUser.uid}`)
console.log(`Boutique: ${sourceProfile.storeId}`)
