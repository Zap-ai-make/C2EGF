import { initializeApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { getFirestore, doc, getDoc } from 'firebase/firestore'

const email = String(process.env.AKAYIS_LOGIN_EMAIL || '').trim().toLowerCase()
const password = String(process.env.AKAYIS_LOGIN_PASSWORD || '')

if (!email || !password) {
  console.error('Usage: definir AKAYIS_LOGIN_EMAIL et AKAYIS_LOGIN_PASSWORD puis lancer npm run account:test-login')
  process.exit(1)
}

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID
}

const missing = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key)

if (missing.length > 0) {
  console.error(`Variables Firebase manquantes: ${missing.join(', ')}`)
  process.exit(1)
}

const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
const db = getFirestore(app)

try {
  const result = await signInWithEmailAndPassword(auth, email, password)
  console.log(`OK - Firebase Auth accepte les identifiants pour ${email}`)
  console.log(`UID: ${result.user.uid}`)

  const userSnap = await getDoc(doc(db, 'users', result.user.uid))
  console.log(`${userSnap.exists() ? 'OK' : 'ALERTE'} - lecture users/${result.user.uid}`)

  if (userSnap.exists()) {
    const profile = userSnap.data()
    console.log(JSON.stringify({
      active: profile.active,
      role: profile.role,
      storeId: profile.storeId,
      storeName: profile.storeName
    }, null, 2))

    if (profile.storeId) {
      const storeSnap = await getDoc(doc(db, 'stores', profile.storeId))
      console.log(`${storeSnap.exists() ? 'OK' : 'ALERTE'} - lecture stores/${profile.storeId}`)

      if (storeSnap.exists()) {
        const store = storeSnap.data()
        console.log(JSON.stringify({
          active: store.active,
          adminUid: store.adminUid,
          name: store.name
        }, null, 2))
      }
    }
  }

  await signOut(auth)
} catch (error) {
  console.error(`ERREUR - ${error.code || 'unknown'}: ${error.message}`)
  process.exit(1)
}
