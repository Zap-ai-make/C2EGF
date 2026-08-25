import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rulesPath = resolve(__dirname, '../../firestore.rules')
const rules = readFileSync(rulesPath, 'utf-8')

let testEnv

beforeAll(async () => {
  const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || ''
  if (!projectId.startsWith('demo-')) {
    throw new Error(`SÉCURITÉ : projectId manquant ou non-demo. Valeur reçue : "${projectId}"`)
  }

  testEnv = await initializeTestEnvironment({
    projectId: 'demo-akayis-test',
    firestore: {
      rules,
      host: '127.0.0.1',
      port: 8080,
    },
  })
})

afterAll(async () => {
  if (testEnv) await testEnv.cleanup()
})

describe('Smoke — infrastructure émulateur Firestore', () => {
  it('projectId est demo-akayis-test', () => {
    expect(testEnv.projectId).toBe('demo-akayis-test')
  })
})
