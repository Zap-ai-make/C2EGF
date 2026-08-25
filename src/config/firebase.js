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

// Désactiver les logs Firebase en production pour éviter le spam dans la console
if (import.meta.env.PROD) {
  setLogLevel('silent')
}

/**
 * Vérifie que toutes les variables d'environnement Firebase sont présentes
 * Evite les erreurs silencieuses si j'oublie de configurer quelque chose
 */
const validateEnvironmentVariables = () => {
  const requiredVars = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID'
  ]

  const missing = requiredVars.filter(varName => !import.meta.env[varName])

  if (missing.length > 0) {
    throw new Error(`Variables d'environnement manquantes: ${missing.join(', ')}\nVeuillez vérifier votre fichier .env`)
  }
}

/**
 * Crée la config Firebase à partir des variables d'environnement
 * Sécurisé car les clés ne sont jamais hardcodées dans le code
 */
const createFirebaseConfig = () => {
  validateEnvironmentVariables()

  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
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
  app = initializeApp(firebaseConfig)

  // Init Authentication - pour gérer les connexions utilisateurs
  auth = getAuth(app)

  // Init Firestore avec persistence IndexedDB multi-onglets en prod (API Firebase v9+)
  // En dev/émulateur : client standard sans persistence pour éviter les conflits de cache
  const isDev = import.meta.env.DEV
  const useEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'

  if (!isDev && import.meta.env.VITE_FIRESTORE_OFFLINE_PERSISTENCE === 'true') {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    })
  } else {
    db = getFirestore(app)
  }

  // Init Functions — région europe-west1 (proximité Afrique de l'Ouest)
  functions = getFunctions(app, 'europe-west1')

  // Configuration dev : utiliser les émulateurs Firebase si activés
  if (isDev && useEmulators) {
    try {
      connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true })
      connectFirestoreEmulator(db, 'localhost', 8080)
      connectFunctionsEmulator(functions, 'localhost', 5001)
    } catch {
      // Ignorer si les émulateurs ne sont pas lancés
    }
  }

} catch (error) {
  console.error('❌ Erreur d\'initialisation Firebase:', error.message)
  throw error
}

// Configuration utile pour debugging
export const firebaseInfo = {
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  isDev: import.meta.env.DEV,
  useEmulators: import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'
}

export { auth, db, functions }
export default app
