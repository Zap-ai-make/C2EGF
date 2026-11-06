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
import { demanderStockagePersistant } from './stockagePersistant.js'

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
// Vrai quand Firestore garde son cache sur le disque : l'annuaire y garde
// alors aussi sa copie (`copieAnnuaire.js`, lot G2).
let persistanceHorsLigne = false

try {
  const firebaseConfig = createFirebaseConfig()
  const runtime = resolveFirebaseRuntime(lireEnvRuntime())
  app = initializeApp(firebaseConfig)

  // Init Authentication - pour gérer les connexions utilisateurs
  auth = getAuth(app)

  // Init Firestore avec persistence IndexedDB multi-onglets en prod (API Firebase v9+)
  // En dev/émulateur : client standard sans persistence pour éviter les conflits de cache
  //
  // Sauf demande explicite (`VITE_FIRESTORE_PERSISTANCE_EMULATEURS=true`) : c'est
  // la seule façon d'essayer le hors-ligne sur ce poste, puisque sans cache il
  // n'y a rien à relire une fois le réseau coupé. À réserver à un navigateur
  // neuf (Playwright) : le cache d'une session précédente garderait les
  // données d'émulateurs qui ont redémarré vides depuis.
  const persistance = import.meta.env.VITE_FIRESTORE_OFFLINE_PERSISTENCE === 'true' && (
    runtime.production || import.meta.env.VITE_FIRESTORE_PERSISTANCE_EMULATEURS === 'true'
  )
  persistanceHorsLigne = persistance
  if (persistance) {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    })
    // Un cache que le navigateur peut vider quand le disque se remplit ne
    // garantit pas le démarrage hors ligne : voir `stockagePersistant.js`.
    demanderStockagePersistant().then((reponse) => {
      if (reponse === 'refuse') console.warn('Stockage persistant refusé : le navigateur pourra vider le cache hors ligne.')
    })
  } else {
    db = getFirestore(app)
  }

  // Init Functions — us-central1, à côté de la base nam5 (lot C1,
  // docs/rester-dans-le-quota-gratuit.md §C1). ⚠ Ne pousser qu'une fois les
  // callables déployés dans cette région : sinon chaque appel échoue.
  functions = getFunctions(app, 'us-central1')

  if (runtime.useEmulators) {
    connectAuthEmulator(auth, `http://${runtime.hosts.auth}:${runtime.ports.auth}`, { disableWarnings: true })
    connectFirestoreEmulator(db, runtime.hosts.firestore, runtime.ports.firestore)
    connectFunctionsEmulator(functions, runtime.hosts.functions, runtime.ports.functions)
  }

} catch (error) {
  console.error('❌ Erreur d\'initialisation Firebase:', error.message)
  throw error
}

export { auth, db, functions, persistanceHorsLigne }
export default app
