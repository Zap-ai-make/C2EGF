import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
    include: [
      'tests/unit/**/*.test.js',
      'tests/unit/**/*.test.jsx',
      'tests/components/**/*.test.js',
      'tests/components/**/*.test.jsx',
      'tests/integration/**/*.test.js',
      'tests/integration/**/*.test.jsx',
    ],
    globals: false,
  },
})
