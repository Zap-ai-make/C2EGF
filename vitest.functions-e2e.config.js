import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/functions/tc-037-callable-http-e2e.test.js',
      'tests/functions/tc-045-closures-callable-http-e2e.test.js',
      'tests/functions/tc-061-settlements-callable-e2e.test.js',
    ],
    globals: false,
    fileParallelism: false,
    maxWorkers: 1,
    // 60s : un aller-retour E2E complet (createUser Auth → sign-in → httpsCallable
    // sur l'émulateur Functions à froid → sign-out) peut dépasser 30s au premier
    // appel / sous charge. Marge pour un déroulé déterministe, sans masquer un
    // vrai blocage (le test échouerait toujours au-delà de 60s).
    testTimeout: 60000,
    // Même raison pour la mise en place (création des comptes, connexion) :
    // audit QUA-09, un échec sur un délai de hook, passé avec ce délai.
    hookTimeout: 120000,
  },
})
