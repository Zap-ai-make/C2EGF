/**
 * TC-342 — Règles Firestore de l'annuaire des clients (docs/rester-dans-le-quota-gratuit.md §A1)
 *
 * Comportement protégé :
 *   - Lecture : EXACTEMENT celle de `globalClients` (TC-007) — tout membre ou
 *     administrateur actif d'une boutique, et le gérant système. Le dealer, un
 *     profil inactif et un visiteur non connecté sont refusés.
 *   - Écriture : refusée à TOUS depuis le navigateur, gérant compris. Seuls le
 *     déclencheur et la reconstruction y écrivent, par l'Admin SDK.
 *
 * Deux boutiques, comme l'exige AGENTS.md : l'annuaire est commun au réseau,
 * et chacune doit pouvoir le lire sans pouvoir l'altérer pour l'autre.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, collection, getDocs, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertSucceeds,
  assertFails,
  getAuthenticatedContext,
  getUnauthenticatedContext,
  seedDocument,
} from './helpers.js'

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
  const profils = {
    'uid-member-aaa': { active: true, role: 'member', storeId: 'store-test-aaa' },
    'uid-admin-bbb': { active: true, role: 'store_admin', storeId: 'store-test-bbb' },
    'uid-inactive-aaa': { active: false, role: 'member', storeId: 'store-test-aaa' },
    'uid-manager': { active: true, role: 'system_manager' },
    'uid-dealer': { active: true, role: 'dealer' },
  }
  for (const [uid, profil] of Object.entries(profils)) await seedDocument(testEnv, 'users', uid, profil)
  await seedDocument(testEnv, 'annuaireClients', 't07', {
    entrees: { 'gclient-aaa': { nom: 'Alpha', prenom: 'Client', registeredStoreId: 'store-test-aaa' } },
  })
  await seedDocument(testEnv, 'annuaireClients', '_etat', { complet: true, tranches: 64, fiches: 1 })
})

const tranche = (uid) => doc((uid ? getAuthenticatedContext(testEnv, uid) : getUnauthenticatedContext(testEnv)).firestore(), 'annuaireClients', 't07')
const annuaire = (uid) => collection(getAuthenticatedContext(testEnv, uid).firestore(), 'annuaireClients')

describe('TC-342 — lecture de l’annuaire', () => {
  it('[TC-342-01] boutique A — membre actif — lit une tranche et l’annuaire entier', async () => {
    await assertSucceeds(getDoc(tranche('uid-member-aaa')))
    await assertSucceeds(getDocs(annuaire('uid-member-aaa')))
  })

  it('[TC-342-02] boutique B — administrateur actif — lit la même tranche', async () => {
    await assertSucceeds(getDoc(tranche('uid-admin-bbb')))
    await assertSucceeds(getDocs(annuaire('uid-admin-bbb')))
  })

  it('[TC-342-03] le gérant système lit l’annuaire', async () => {
    await assertSucceeds(getDocs(annuaire('uid-manager')))
  })

  it('[TC-342-04] le dealer est refusé, comme pour globalClients', async () => {
    await assertFails(getDoc(tranche('uid-dealer')))
  })

  it('[TC-342-05] un profil inactif est refusé', async () => {
    await assertFails(getDoc(tranche('uid-inactive-aaa')))
  })

  it('[TC-342-06] un visiteur non connecté est refusé', async () => {
    await assertFails(getDoc(tranche(null)))
  })
})

describe('TC-342 — personne n’écrit dans l’annuaire depuis le navigateur', () => {
  for (const uid of ['uid-member-aaa', 'uid-admin-bbb', 'uid-manager']) {
    it(`[TC-342-07] ${uid} — créer, modifier, supprimer une tranche — refusé`, async () => {
      const fs = getAuthenticatedContext(testEnv, uid).firestore()
      await assertFails(setDoc(doc(fs, 'annuaireClients', 't99'), { entrees: {} }))
      await assertFails(updateDoc(doc(fs, 'annuaireClients', 't07'), { 'entrees.gclient-bbb': { nom: 'Intrus', prenom: 'X' } }))
      await assertFails(deleteDoc(doc(fs, 'annuaireClients', 't07')))
    })
  }

  it('[TC-342-08] l’état « complet » ne se falsifie pas : sans lui, le navigateur garde l’ancien chemin', async () => {
    const fs = getAuthenticatedContext(testEnv, 'uid-member-aaa').firestore()
    await assertFails(setDoc(doc(fs, 'annuaireClients', '_etat'), { complet: false }))
  })
})
