/**
 * Règles Firestore — storeCollaborations (collaborations inter-boutiques).
 *
 * Une collaboration lie DEUX boutiques : la demandeuse (qui a le client en face
 * d'elle) et la fournisseuse (qui exécute l'opération Mobile Money). Les deux
 * doivent lire le même document, une tierce boutique jamais.
 *
 * Invariant non négociable : AUCUNE écriture client. Tout passe par les Cloud
 * Functions (SDK Admin), qui seules relisent soldes et profils de façon autoritative.
 *
 * Matrice utilisateurs :
 *   store-admin-a-uid   store_admin boutique A — DEMANDEUSE
 *   store-admin-b-uid   store_admin boutique B — FOURNISSEUSE
 *   store-admin-c-uid   store_admin boutique C — TIERS (ne doit rien voir)
 *   system-mgr-uid      system_manager actif   — supervision
 *   inactive-uid        store_admin INACTIF de la boutique A
 *   (non authentifié)
 *
 * Projet exclusif : demo-akayis-test. Aucun accès Firebase production.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, getDocs, query, where, orderBy,
} from 'firebase/firestore'
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
  if (!projectId.startsWith('demo-')) {
    throw new Error(`SÉCURITÉ : projectId manquant ou non-demo. Valeur reçue : "${projectId}"`)
  }
  if (projectId !== 'demo-akayis-test') {
    throw new Error(`SÉCURITÉ : projectId doit être "demo-akayis-test". Valeur reçue : "${projectId}"`)
  }
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-akayis-test',
    firestore: { rules, host: '127.0.0.1', port: 8080 },
  })
})

afterAll(async () => { if (testEnv) await testEnv.cleanup() })

beforeEach(async () => {
  await testEnv.clearFirestore()
  await seedAll()
})

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

async function seedAll() {
  await seedDocument(testEnv, 'stores', 'store-A', { name: 'Boutique A', active: true, adminUid: 'store-admin-a-uid' })
  await seedDocument(testEnv, 'stores', 'store-B', { name: 'Boutique B', active: true, adminUid: 'store-admin-b-uid' })
  await seedDocument(testEnv, 'stores', 'store-C', { name: 'Boutique C', active: true, adminUid: 'store-admin-c-uid' })

  await seedDocument(testEnv, 'users', 'store-admin-a-uid', { role: 'store_admin', active: true, storeId: 'store-A', storeName: 'Boutique A', email: 'a@test.test', name: 'Admin A' })
  await seedDocument(testEnv, 'users', 'store-admin-b-uid', { role: 'store_admin', active: true, storeId: 'store-B', storeName: 'Boutique B', email: 'b@test.test', name: 'Admin B' })
  await seedDocument(testEnv, 'users', 'store-admin-c-uid', { role: 'store_admin', active: true, storeId: 'store-C', storeName: 'Boutique C', email: 'c@test.test', name: 'Admin C' })
  await seedDocument(testEnv, 'users', 'system-mgr-uid', { role: 'system_manager', active: true, email: 'mgr@test.test', name: 'Manager' })
  await seedDocument(testEnv, 'users', 'inactive-uid', { role: 'store_admin', active: false, storeId: 'store-A', email: 'inactive@test.test', name: 'Inactive' })

  await seedDocument(testEnv, 'storeCollaborations', 'collab-ab', BASE_COLLAB)
}

// A demande, B fournit.
const BASE_COLLAB = Object.freeze({
  requestingStoreId: 'store-A',
  requestingStoreName: 'Boutique A',
  requestingStoreAdminUid: 'store-admin-a-uid',
  supplierStoreId: 'store-B',
  supplierStoreName: 'Boutique B',
  clientId: 'client-001',
  clientNom: 'Ouedraogo',
  clientPrenom: 'Awa',
  network: 'Orange',
  operationType: 'deposit',
  amount: 20000,
  status: 'pending',
  previousSupplierBalance: null,
  newSupplierBalance: null,
  debtId: null,
})

const collabRef = (ctx) => doc(ctx.firestore(), 'storeCollaborations', 'collab-ab')

// ─────────────────────────────────────────────────────────────

describe('storeCollaborations — lecture', () => {
  it('la boutique DEMANDEUSE lit sa collaboration', async () => {
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertSucceeds(getDoc(collabRef(ctx)))
  })

  it('la boutique FOURNISSEUSE lit la collaboration qui lui est adressée', async () => {
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-b-uid')
    await assertSucceeds(getDoc(collabRef(ctx)))
  })

  it('le gérant lit (supervision)', async () => {
    const ctx = getAuthenticatedContext(testEnv, 'system-mgr-uid')
    await assertSucceeds(getDoc(collabRef(ctx)))
  })

  it('une TIERCE boutique ne lit pas', async () => {
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-c-uid')
    await assertFails(getDoc(collabRef(ctx)))
  })

  it('un store_admin INACTIF ne lit pas, même de sa propre boutique', async () => {
    const ctx = getAuthenticatedContext(testEnv, 'inactive-uid')
    await assertFails(getDoc(collabRef(ctx)))
  })

  it('un anonyme ne lit pas', async () => {
    const ctx = getUnauthenticatedContext(testEnv)
    await assertFails(getDoc(collabRef(ctx)))
  })
})

describe('storeCollaborations — requêtes de liste (chemin réel de l’UI)', () => {
  it('« Reçues » : la fournisseuse liste par supplierStoreId + status', async () => {
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-b-uid')
    const q = query(
      collection(ctx.firestore(), 'storeCollaborations'),
      where('supplierStoreId', '==', 'store-B'),
      where('status', '==', 'pending'),
      orderBy('createdAt', 'desc'),
    )
    await assertSucceeds(getDocs(q))
  })

  it('« Mes demandes » : la demandeuse liste par requestingStoreId + status', async () => {
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    const q = query(
      collection(ctx.firestore(), 'storeCollaborations'),
      where('requestingStoreId', '==', 'store-A'),
      where('status', 'in', ['pending']),
      orderBy('createdAt', 'desc'),
    )
    await assertSucceeds(getDocs(q))
  })

  it('une boutique ne peut pas lister les collaborations d’une autre', async () => {
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-c-uid')
    const q = query(
      collection(ctx.firestore(), 'storeCollaborations'),
      where('supplierStoreId', '==', 'store-B'),
    )
    await assertFails(getDocs(q))
  })

  it('une liste NON contrainte est refusée (pas de moisson de la collection)', async () => {
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertFails(getDocs(collection(ctx.firestore(), 'storeCollaborations')))
  })
})

describe('storeCollaborations — écritures client toujours refusées (CF-only)', () => {
  it('la demandeuse ne crée pas directement', async () => {
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertFails(setDoc(doc(ctx.firestore(), 'storeCollaborations', 'forge'), BASE_COLLAB))
  })

  it('la fournisseuse ne confirme pas en écrivant le document', async () => {
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-b-uid')
    await assertFails(updateDoc(collabRef(ctx), { status: 'confirmed' }))
  })

  it('la demandeuse ne s’auto-sert pas en forgeant un statut', async () => {
    const ctx = getAuthenticatedContext(testEnv, 'store-admin-a-uid')
    await assertFails(updateDoc(collabRef(ctx), { status: 'confirmed', debtId: 'forged' }))
  })

  it('personne ne supprime, pas même le gérant', async () => {
    const mgr = getAuthenticatedContext(testEnv, 'system-mgr-uid')
    await assertFails(deleteDoc(collabRef(mgr)))
    const b = getAuthenticatedContext(testEnv, 'store-admin-b-uid')
    await assertFails(deleteDoc(collabRef(b)))
  })
})
