import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/functions/**/*.test.js'],
    exclude: [
      'tests/functions/tc-037-callable-http-e2e.test.js',
      'tests/functions/tc-045-closures-callable-http-e2e.test.js',
      'tests/functions/tc-061-settlements-callable-e2e.test.js',
    ],
    globals: false,
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 15000,
    // firebase-admin 14 cherche le serveur de métadonnées de Google Cloud avant
    // sa première opération et attend son échec (~3 s par processus, scripts
    // enfants compris). Sur émulateur, il n'existe pas : on coupe la détection.
    // Mesuré le 3 novembre 2026 : cette suite 278 → 206 s, l'intégration 185 → 122 s.
    env: { METADATA_SERVER_DETECTION: 'none' },
  },
})
