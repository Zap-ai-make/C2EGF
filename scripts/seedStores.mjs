import { readFile } from 'node:fs/promises'
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { resolveAndAssertAdminProject } from './lib/resolveAndAssertAdminProject.mjs'

const seedFile = process.argv[2] || 'admin/store-seed.json'
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS

const serviceAccount = serviceAccountPath
  ? JSON.parse(await readFile(serviceAccountPath, 'utf8'))
  : null

resolveAndAssertAdminProject({
  serviceAccount,
  envProjectId: process.env.GCLOUD_PROJECT,
})

initializeApp({
  credential: serviceAccount ? cert(serviceAccount) : applicationDefault()
})

const db = getFirestore()
const auth = getAuth()
const seed = JSON.parse(await readFile(seedFile, 'utf8'))

if (!Array.isArray(seed.stores) || seed.stores.length !== 6) {
  throw new Error('Le seed doit contenir exactement 6 boutiques dans stores[]')
}

for (const store of seed.stores) {
  const id = String(store.id || '').trim()
  const name = String(store.name || '').trim()
  const email = String(store.email || '').trim().toLowerCase()

  if (!id || !name || !email) {
    throw new Error(`Boutique invalide: ${JSON.stringify(store)}`)
  }

  let user
  try {
    user = await auth.getUserByEmail(email)
  } catch {
    user = await auth.createUser({
      email,
      displayName: name,
      emailVerified: false,
      disabled: false
    })
  }

  await db.doc(`stores/${id}`).set({
    name,
    email,
    active: true,
    adminUid: user.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true })

  await db.doc(`users/${user.uid}`).set({
    name,
    email,
    role: 'store_admin',
    active: true,
    storeId: id,
    storeName: name,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true })

  const resetLink = await auth.generatePasswordResetLink(email)
  console.log(`${name} (${email}) -> ${resetLink}`)
}
