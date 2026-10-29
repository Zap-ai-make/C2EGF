const LOCAL_EMULATOR_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

function assertLocalHost(host, variableName) {
  if (!LOCAL_EMULATOR_HOSTS.has(host)) {
    throw new Error(`${variableName} doit cibler localhost en développement ou en QA.`)
  }
}

/**
 * Les seules variables que lit `resolveFirebaseRuntime`, chacune par son nom.
 *
 * ⚠ C'EST CE QU'ON LUI PASSE, JAMAIS `import.meta.env` ENTIER. Vite remplace
 *   l'objet entier par TOUT le `.env` recopié en clair dans le bundle de
 *   production ; une lecture par nom n'emporte que la variable lue. Le jeton de
 *   débogage App Check a fui ainsi, constaté dans `dist/` le 30 octobre 2026.
 */
export function lireEnvRuntime() {
  return {
    DEV: import.meta.env.DEV,
    VITE_FIREBASE_RUNTIME_MODE: import.meta.env.VITE_FIREBASE_RUNTIME_MODE,
    VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    VITE_USE_FIREBASE_EMULATORS: import.meta.env.VITE_USE_FIREBASE_EMULATORS,
    VITE_FIREBASE_AUTH_EMULATOR_HOST: import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST,
    VITE_FIREBASE_AUTH_EMULATOR_PORT: import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_PORT,
    VITE_FIRESTORE_EMULATOR_HOST: import.meta.env.VITE_FIRESTORE_EMULATOR_HOST,
    VITE_FIRESTORE_EMULATOR_PORT: import.meta.env.VITE_FIRESTORE_EMULATOR_PORT,
    VITE_FUNCTIONS_EMULATOR_HOST: import.meta.env.VITE_FUNCTIONS_EMULATOR_HOST,
    VITE_FUNCTIONS_EMULATOR_PORT: import.meta.env.VITE_FUNCTIONS_EMULATOR_PORT,
  }
}

/**
 * Politique fail-closed : tout environnement hors production utilise un projet
 * demo-* et les trois émulateurs locaux. La production doit être déclarée
 * explicitement par Vite (PROD) ou par VITE_FIREBASE_RUNTIME_MODE=production.
 */
export function resolveFirebaseRuntime(env) {
  const runtimeMode = env.VITE_FIREBASE_RUNTIME_MODE || (env.DEV ? 'development' : 'production')
  const production = runtimeMode === 'production'
  const projectId = env.VITE_FIREBASE_PROJECT_ID || ''

  if (!production) {
    if (env.VITE_USE_FIREBASE_EMULATORS !== 'true') {
      throw new Error('Les émulateurs Firebase sont obligatoires hors production.')
    }
    if (!projectId.startsWith('demo-')) {
      throw new Error('Le projet Firebase doit commencer par demo- hors production.')
    }
  }

  const hosts = {
    auth: env.VITE_FIREBASE_AUTH_EMULATOR_HOST || 'localhost',
    firestore: env.VITE_FIRESTORE_EMULATOR_HOST || 'localhost',
    functions: env.VITE_FUNCTIONS_EMULATOR_HOST || 'localhost',
  }

  if (!production) {
    assertLocalHost(hosts.auth, 'VITE_FIREBASE_AUTH_EMULATOR_HOST')
    assertLocalHost(hosts.firestore, 'VITE_FIRESTORE_EMULATOR_HOST')
    assertLocalHost(hosts.functions, 'VITE_FUNCTIONS_EMULATOR_HOST')
  }

  return {
    runtimeMode,
    production,
    useEmulators: !production,
    hosts,
    ports: {
      auth: Number(env.VITE_FIREBASE_AUTH_EMULATOR_PORT || 9099),
      firestore: Number(env.VITE_FIRESTORE_EMULATOR_PORT || 8080),
      functions: Number(env.VITE_FUNCTIONS_EMULATOR_PORT || 5001),
    },
  }
}
