import { readFile } from 'node:fs/promises'
import { resolveAndAssertAdminProject, AssertFirebaseProjectError } from './lib/resolveAndAssertAdminProject.mjs'

const emailArg = process.argv.find((arg) => arg.startsWith('--email='))
const email = String(emailArg?.slice('--email='.length) || process.env.npm_config_email || process.argv[2] || '').trim().toLowerCase()
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS

if (!email) {
  console.error('Usage: npm run account:diagnose -- --email=compte@example.com')
  process.exit(1)
}

let initializeApp
let cert
let getAuth
let getFirestore

try {
  ({ initializeApp, cert } = await import('firebase-admin/app'))
  ;({ getAuth } = await import('firebase-admin/auth'))
  ;({ getFirestore } = await import('firebase-admin/firestore'))
} catch (error) {
  if (error.code === 'ERR_MODULE_NOT_FOUND') {
    console.error('firebase-admin est requis pour ce diagnostic. Installe-le avec: npm install firebase-admin')
    process.exit(1)
  }
  throw error
}

if (!serviceAccountPath) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS doit pointer vers le JSON du service account Firebase Admin.')
  process.exit(1)
}

// Garde projet : lire le service account et valider AVANT toute initialisation
// Firebase (bloque taofic-ajagbe et tout projet non demo-*).
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

initializeApp({
  credential: cert(serviceAccount)
})

const auth = getAuth()
const db = getFirestore()

const printCheck = (ok, message) => {
  console.log(`${ok ? 'OK' : 'ALERTE'} - ${message}`)
}

let user
try {
  user = await auth.getUserByEmail(email)
} catch (error) {
  if (error.code === 'auth/user-not-found') {
    console.log(`Compte Auth introuvable pour ${email}`)
    process.exit(0)
  }
  throw error
}

console.log(`Diagnostic du compte ${email}`)
console.log(`UID: ${user.uid}`)
console.log(`Email verifie: ${user.emailVerified ? 'oui' : 'non'}`)
console.log(`Compte desactive: ${user.disabled ? 'oui' : 'non'}`)
console.log(`Cree le: ${user.metadata.creationTime || 'inconnu'}`)
console.log(`Derniere connexion Auth: ${user.metadata.lastSignInTime || 'jamais'}`)

printCheck(!user.disabled, 'le compte Firebase Auth est actif')

const userSnap = await db.doc(`users/${user.uid}`).get()
printCheck(userSnap.exists, `document users/${user.uid} present`)

if (!userSnap.exists) {
  console.log('Cause probable: le compte existe dans Auth mais pas dans Firestore.')
  console.log('Correction: recreer le profil users/{uid} avec role, active, storeId et storeName.')
  process.exit(0)
}

const profile = userSnap.data()
console.log('Profil Firestore:')
console.log(JSON.stringify({
  name: profile.name,
  email: profile.email,
  role: profile.role,
  active: profile.active,
  storeId: profile.storeId,
  storeName: profile.storeName
}, null, 2))

printCheck(profile.active === true, 'profil utilisateur actif')
printCheck(typeof profile.storeId === 'string' && profile.storeId.length > 0, 'storeId renseigne')
printCheck(profile.role === 'store_admin', 'role store_admin')

if (!profile.storeId) {
  console.log('Cause probable: profil utilisateur non rattache a une boutique.')
  process.exit(0)
}

const storeSnap = await db.doc(`stores/${profile.storeId}`).get()
printCheck(storeSnap.exists, `document stores/${profile.storeId} present`)

if (!storeSnap.exists) {
  console.log('Cause probable: la boutique referencee par le profil n existe pas.')
  process.exit(0)
}

const store = storeSnap.data()
console.log('Boutique Firestore:')
console.log(JSON.stringify({
  name: store.name,
  email: store.email,
  active: store.active,
  adminUid: store.adminUid
}, null, 2))

printCheck(store.active !== false, 'boutique active')
printCheck(!store.adminUid || store.adminUid === user.uid, 'adminUid coherent avec le compte')

if (user.disabled || profile.active !== true || !profile.storeId || !storeSnap.exists || store.active === false) {
  console.log('Resultat: ce compte sera bloque par l application apres authentification.')
} else {
  console.log('Resultat: le rattachement Auth/Firestore semble correct.')
}
