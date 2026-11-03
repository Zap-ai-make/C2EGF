import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.js'],
    globals: false,
    fileParallelism: false,
    maxWorkers: 1,
    // Pas de serveur de métadonnées Google Cloud sur émulateur : voir
    // vitest.functions.config.js. Les scripts lancés par ces tests en héritent.
    env: { METADATA_SERVER_DETECTION: 'none' },
  },
})
