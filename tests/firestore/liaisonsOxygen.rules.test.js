/**
 * TC-378 — Règles Firestore des trois collections de la liaison Oxygen.
 *
 * Contrat : C:\dev\oxygen\docs\contrats\liaison-agent.md, version 3, §5.3 —
 * « trois collections nouvelles, fermées par les règles ».
 *
 * Comportement protégé :
 *   - liaisonsOxygen, codesLiaisonOxygen : personne ne lit, personne n'écrit
 *     depuis un navigateur. Seules les Cloud Functions (Admin SDK) y touchent.
 *     Une boutique qui lirait un code pourrait relier n'importe qui.
 *   - journalLiaisonsOxygen : le patron le lit (« le responsable consulte cette
 *     liste ») ; les boutiques ni ne le lisent ni ne l'écrivent — une trace que
 *     son auteur pourrait effacer n'en serait pas une.
 *
 * Testé avec deux boutiques, comme l'exige AGENTS.md.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, getDocs, collection, setDoc, deleteDoc } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertSucceeds, assertFails, getAuthenticatedContext, getUnauthenticatedContext, seedDocument } from './helpers.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf-8')

let testEnv

beforeAll(async () => {
  const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || ''
  if (projectId !== 'demo-akayis-test') {
    throw new Error(`SÉCURITÉ : projectId doit être exactement "demo-akayis-test". Valeur reçue : "${projectId}"`)
  }
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-akayis-test',
    firestore: { rules, host: '127.0.0.1', port: 8080 },
  })
})

afterAll(async () => {
  if (testEnv) await testEnv.cleanup()
})

beforeEach(async () => {
  await testEnv.clearFirestore()
  await Promise.all([
    seedDocument(testEnv, 'stores', 'store-a', { name: 'A', active: true }),
    seedDocument(testEnv, 'stores', 'store-b', { name: 'B', active: true }),
    seedDocument(testEnv, 'users', 'u-admin-a', { active: true, role: 'store_admin', storeId: 'store-a', storeName: 'A' }),
    seedDocument(testEnv, 'users', 'u-member-b', { active: true, role: 'member', storeId: 'store-b', storeName: 'B' }),
    seedDocument(testEnv, 'users', 'u-patron', { active: true, role: 'system_manager' }),
    seedDocument(testEnv, 'users', 'u-dealer', { active: true, role: 'dealer' }),
    seedDocument(testEnv, 'liaisonsOxygen', 'l1', { clientId: 'f1', compteOxygen: 'cpt-1', finLe: null }),
    seedDocument(testEnv, 'codesLiaisonOxygen', 'f1', { clientId: 'f1', codeHache: 'x', storeId: 'store-a' }),
    seedDocument(testEnv, 'journalLiaisonsOxygen', 'j1', { issue: 'genere', clientId: 'f1', storeId: 'store-a' }),
  ])
})

const fs = (uid) => (uid ? getAuthenticatedContext(testEnv, uid) : getUnauthenticatedContext(testEnv)).firestore()

describe('TC-378 — liaisons et codes : fermés à tout navigateur', () => {
  for (const chemin of ['liaisonsOxygen/l1', 'codesLiaisonOxygen/f1']) {
    const [col, id] = chemin.split('/')

    it(`[TC-378] ${col} : ni boutique, ni patron, ni dealer, ni anonyme ne lit`, async () => {
      for (const uid of ['u-admin-a', 'u-member-b', 'u-patron', 'u-dealer', null]) {
        await assertFails(getDoc(doc(fs(uid), col, id)))
        await assertFails(getDocs(collection(fs(uid), col)))
      }
    })

    it(`[TC-378] ${col} : personne n'écrit ni n'efface`, async () => {
      for (const uid of ['u-admin-a', 'u-member-b', 'u-patron']) {
        await assertFails(setDoc(doc(fs(uid), col, 'nouveau'), { clientId: 'f2' }))
        await assertFails(setDoc(doc(fs(uid), col, id), { clientId: 'f1', finLe: 1 }))
        await assertFails(deleteDoc(doc(fs(uid), col, id)))
      }
    })
  }
})

describe('TC-378 — journal : le patron lit, personne n’écrit', () => {
  it('[TC-378] le patron lit le journal', async () => {
    await assertSucceeds(getDoc(doc(fs('u-patron'), 'journalLiaisonsOxygen', 'j1')))
    await assertSucceeds(getDocs(collection(fs('u-patron'), 'journalLiaisonsOxygen')))
  })

  it('[TC-378] aucune boutique ne le lit, pas même celle qui a généré le code', async () => {
    for (const uid of ['u-admin-a', 'u-member-b', 'u-dealer', null]) {
      await assertFails(getDoc(doc(fs(uid), 'journalLiaisonsOxygen', 'j1')))
    }
  })

  it('[TC-378] personne n’écrit ni n’efface une trace, patron compris', async () => {
    for (const uid of ['u-admin-a', 'u-member-b', 'u-patron']) {
      await assertFails(setDoc(doc(fs(uid), 'journalLiaisonsOxygen', 'j2'), { issue: 'genere' }))
      await assertFails(deleteDoc(doc(fs(uid), 'journalLiaisonsOxygen', 'j1')))
    }
  })
})
