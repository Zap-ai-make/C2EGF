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
  },
})
