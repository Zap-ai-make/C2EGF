import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
} from 'firebase/firestore'
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions'
import { setLogLevel } from 'firebase/app'
import { lireEnvRuntime, resolveFirebaseRuntime } from './firebaseRuntime'

// Désactiver les logs Firebase en production pour éviter le spam dans la console
if (import.meta.env.PROD) {
  setLogLevel('silent')
}

/**
 * Vérifie que toutes les variables d'environnement Firebase sont présentes
 * Evite les erreurs silencieuses si j'oublie de configurer quelque chose
 */
//
// ⚠ CHAQUE VARIABLE SE LIT PAR SON NOM, JAMAIS `import.meta.env[nom]` NI
//   `import.meta.env` ENTIER. Une lecture dynamique oblige Vite à recopier TOUT
//   le `.env` dans le bundle de production — jeton de débogage App Check
//   compris, constaté dans `dist/` le 30 octobre 2026.
const lireVariablesFirebase = () => ({
  VITE_FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY,
  VITE_FIREBASE_AUTH_DOMAIN: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  VITE_FIREBASE_STORAGE_BUCKET: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  VITE_FIREBASE_MESSAGING_SENDER_ID: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  VITE_FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID,
})

const validateEnvironmentVariables = (variables) => {
  const missing = Object.keys(variables).filter(varName => !variables[varName])

  if (missing.length > 0) {
    throw new Error(`Variables d'environnement manquantes: ${missing.join(', ')}\nVeuillez vérifier votre fichier .env`)
  }
}

/**
 * Crée la config Firebase à partir des variables d'environnement
 * Sécurisé car les clés ne sont jamais hardcodées dans le code
 */
const createFirebaseConfig = () => {
  const variables = lireVariablesFirebase()
  validateEnvironmentVariables(variables)

  return {
    apiKey: variables.VITE_FIREBASE_API_KEY,
    authDomain: variables.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: variables.VITE_FIREBASE_PROJECT_ID,
    storageBucket: variables.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: variables.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: variables.VITE_FIREBASE_APP_ID
  }
}

/**
 * Initialisation de Firebase
 * Gère l'auth, Firestore, Functions et la persistence offline pour la PWA
 */
let app
let auth
let db
let functions

try {
  const firebaseConfig = createFirebaseConfig()
  const runtime = resolveFirebaseRuntime(lireEnvRuntime())
  app = initializeApp(firebaseConfig)

  // Init Authentication - pour gérer les connexions utilisateurs
  auth = getAuth(app)

  // Init Firestore avec persistence IndexedDB multi-onglets en prod (API Firebase v9+)
  // En dev/émulateur : client standard sans persistence pour éviter les conflits de cache
  if (runtime.production && import.meta.env.VITE_FIRESTORE_OFFLINE_PERSISTENCE === 'true') {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    })
  } else {
    db = getFirestore(app)
  }

  // Init Functions — région europe-west1 (proximité Afrique de l'Ouest)
  functions = getFunctions(app, 'europe-west1')

  if (runtime.useEmulators) {
    connectAuthEmulator(auth, `http://${runtime.hosts.auth}:${runtime.ports.auth}`, { disableWarnings: true })
    connectFirestoreEmulator(db, runtime.hosts.firestore, runtime.ports.firestore)
    connectFunctionsEmulator(functions, runtime.hosts.functions, runtime.ports.functions)
  }

} catch (error) {
  console.error('❌ Erreur d\'initialisation Firebase:', error.message)
  throw error
}

export { auth, db, functions }
export default app
