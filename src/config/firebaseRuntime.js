const LOCAL_EMULATOR_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

function assertLocalHost(host, variableName) {
  if (!LOCAL_EMULATOR_HOSTS.has(host)) {
    throw new Error(`${variableName} doit cibler localhost en développement ou en QA.`)
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
