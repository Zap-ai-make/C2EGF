import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/firestore/**/*.test.js'],
    globals: false,
    fileParallelism: false,
    maxWorkers: 1,
    // Le premier fichier d'un émulateur froid ne charge pas ses règles dans les
    // 10 s par défaut sur un poste chargé (audit QUA-09 : 7 dépassements, 176
    // tests sautés, aucune assertion fausse). Ces délais sont ceux qui ont fait
    // passer les 233 tests ; un vrai blocage échoue toujours, plus tard.
    hookTimeout: 120000,
    testTimeout: 60000,
  },
})
