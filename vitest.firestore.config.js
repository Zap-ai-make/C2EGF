import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/firestore/**/*.test.js'],
    globals: false,
    fileParallelism: false,
    maxWorkers: 1,
  },
})
