/**
 * TC-395 — Règles Firestore des demandes d'agent.
 *
 * Spec : docs/superpowers/specs/2026-11-17-demandes-agent-design.md §5.4.
 *
 * Comportement protégé :
 *   - clients/{boutique}/demandesAgent : la boutique lit les siennes (l'écoute
 *     de la caisse : etat == 'en_attente') ; une autre boutique ne les lit pas.
 *   - personne n'écrit depuis un navigateur : une demande naît au point
 *     d'entrée Oxygen et se ferme par storeTransactionCommand. Une caissière qui
 *     pourrait passer une demande à « validee » sans créer l'opération
 *     fermerait la demande de l'agent sur une opération qui n'existe pas.
 *
 * Testé avec deux boutiques, comme l'exige AGENTS.md.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, getDocs, collection, query, where, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'
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
    seedDocument(testEnv, 'users', 'u-member-a', { active: true, role: 'member', storeId: 'store-a', storeName: 'A' }),
    seedDocument(testEnv, 'users', 'u-member-b', { active: true, role: 'member', storeId: 'store-b', storeName: 'B' }),
    seedDocument(testEnv, 'clients/store-a/demandesAgent', 'k1', { compteOxygen: 'ox-1', clientId: 'c1', etat: 'en_attente', montant: 5000 }),
  ])
})

const fs = (uid) => (uid ? getAuthenticatedContext(testEnv, uid) : getUnauthenticatedContext(testEnv)).firestore()
const demandes = (db) => collection(db, 'clients', 'store-a', 'demandesAgent')

describe('TC-395 — demandes d’agent : la boutique lit, personne n’écrit', () => {
  it('[TC-395-01] la boutique destinataire lit sa demande et écoute ses demandes en attente', async () => {
    for (const uid of ['u-admin-a', 'u-member-a']) {
      await assertSucceeds(getDoc(doc(demandes(fs(uid)), 'k1')))
      await assertSucceeds(getDocs(query(demandes(fs(uid)), where('etat', '==', 'en_attente'))))
    }
  })

  it('[TC-395-02] une autre boutique ne lit pas les demandes de la première', async () => {
    await assertFails(getDoc(doc(demandes(fs('u-member-b')), 'k1')))
    await assertFails(getDocs(query(demandes(fs('u-member-b')), where('etat', '==', 'en_attente'))))
  })

  it('[TC-395-03] personne n’écrit : ni création, ni réponse à la main, ni effacement', async () => {
    for (const uid of ['u-admin-a', 'u-member-a', 'u-member-b']) {
      await assertFails(setDoc(doc(demandes(fs(uid)), 'k2'), { compteOxygen: 'ox-1', etat: 'en_attente', montant: 1 }))
      await assertFails(updateDoc(doc(demandes(fs(uid)), 'k1'), { etat: 'validee' }))
      await assertFails(deleteDoc(doc(demandes(fs(uid)), 'k1')))
    }
  })

  it('[TC-395-04] un visiteur non connecté ne lit rien', async () => {
    await assertFails(getDoc(doc(demandes(fs(null)), 'k1')))
    await assertFails(getDocs(demandes(fs(null))))
  })
})
