/**
 * TC-009 — Création d'un profil users/{uid} avec vérification du storeId (MASTER-SEC-001)
 *
 * Correction appliquée (Cas B + getAfter) :
 *   firestore.rules — match /users/{userId} → allow create :
 *     allow create: if signedIn() &&
 *       request.auth.uid == userId &&
 *       request.resource.data.role == 'store_admin' &&
 *       request.resource.data.active == true &&
 *       request.resource.data.storeId is string &&
 *       request.resource.data.storeName is string &&
 *       getAfter(/databases/$(database)/documents/stores/$(request.resource.data.storeId)).data.adminUid == request.auth.uid;
 *
 * Diagnostique MASTER-SEC-001 :
 *   - storeId est distinct du uid (slug + 6 premiers chars de l'uid)
 *   - stores/{storeId} contient adminUid: user.uid
 *   - L'inscription utilise writeBatch atomique (stores + users simultanément)
 *   - getAfter est nécessaire car les deux documents sont créés dans la même transaction
 *
 * Règle update (inchangée) :
 *   firestore.rules:83-85 : seul le champ 'lastLogin' peut être modifié,
 *   uniquement par l'utilisateur lui-même.
 *
 * Couvre : TC-009-01 à TC-009-10
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
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

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rulesPath = resolve(__dirname, '../../firestore.rules')
const rules = readFileSync(rulesPath, 'utf-8')

let testEnv

beforeAll(async () => {
  const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || ''
  if (!projectId.startsWith('demo-')) {
    throw new Error(
      `SÉCURITÉ : projectId manquant ou non-demo. Valeur reçue : "${projectId}"`
    )
  }
  if (projectId !== 'demo-akayis-test') {
    throw new Error(
      `SÉCURITÉ : projectId doit être exactement "demo-akayis-test". Valeur reçue : "${projectId}"`
    )
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

beforeEach(async () => {
  await testEnv.clearFirestore()
})

describe('TC-009 — Création et modification profil users (MASTER-SEC-001 corrigé)', () => {

  it('[TC-009-01] uidB crée users/uidB avec storeId appartenant à uidA — deny', async () => {
    /**
     * MASTER-SEC-001 — Cas d'attaque principal
     *
     * uidA est le vrai propriétaire de store-aaa (adminUid: uidA).
     * uidB tente de créer users/uidB avec storeId: 'store-aaa'.
     *
     * getAfter(stores/store-aaa).data.adminUid == 'uidA' != 'uidB' → DENY.
     *
     * Règle : firestore.rules allow create users/{userId}
     *   getAfter(...stores/store-aaa).data.adminUid == request.auth.uid
     *   'uidA' != 'uidB' → refus.
     */
    // Seed le document store-aaa avec adminUid = uidA (le vrai propriétaire)
    await seedDocument(testEnv, 'stores', 'store-aaa', {
      name: 'Boutique A',
      active: true,
      adminUid: 'uidA',
    })

    // uidB essaie de créer son profil en se rattachant frauduleusement à store-aaa
    const ctxB = getAuthenticatedContext(testEnv, 'uidB')
    const ref = doc(ctxB.firestore(), 'users', 'uidB')
    await assertFails(setDoc(ref, {
      active: true,
      storeId: 'store-aaa',
      role: 'store_admin',
      storeName: 'Boutique A',
    }))
  })

  it('[TC-009-02] exploitation : uidB (profil spoofé store-aaa) tente de lire clients/store-aaa/history — deny', async () => {
    /**
     * MASTER-SEC-001 — Exploitation impossible après correction
     *
     * Avant la correction, uidB pouvait créer un profil spoofé pointant vers store-aaa,
     * puis exploiter isStoreMember('store-aaa') pour lire les ressources de store-aaa.
     *
     * Après correction : la création du profil spoofé elle-même est refusée (TC-009-01).
     * Ce test vérifie que sans profil valide, la lecture de history est également refusée.
     *
     * isStoreMember appelle hasProfile() qui vérifie que users/uidB existe et active==true.
     * Sans profil, hasProfile() est false → DENY.
     */
    await seedDocument(testEnv, 'clients', 'store-aaa', { _placeholder: true })
    await seedDocument(testEnv, 'clients/store-aaa/history', 'hist-001', {
      type: 'Dépôt',
      montant: 500,
      clientId: 'client-001',
      statut: 'Validée',
    })

    // uidB n'a PAS de profil valide dans users/uidB
    const ctxB = getAuthenticatedContext(testEnv, 'uidB')
    const histRef = doc(ctxB.firestore(), 'clients', 'store-aaa', 'history', 'hist-001')
    await assertFails(getDoc(histRef))
  })

  it('[TC-009-03] propriétaire légitime uidA crée users/uidA avec son propre storeId — allow', async () => {
    /**
     * Parcours nominal d'inscription (writeBatch atomique).
     *
     * La règle utilise getAfter() pour lire stores/store-uidA-abc123 après la transaction.
     * Le batch atomique écrit stores/ ET users/ dans la même opération → getAfter valide.
     *
     * Simulation : on seed d'abord stores/store-uidA-abc123 avec adminUid='uidA',
     * puis on crée users/uidA avec storeId='store-uidA-abc123'.
     * L'émulateur évalue getAfter sur le document stores/ déjà présent (ou créé dans batch).
     *
     * Note : dans l'émulateur rules-unit-testing, setDoc sur users/{uid} seul
     * correspond au cas où stores/ est déjà présent. Pour le vrai batch, les deux
     * sont créés atomiquement. On teste ici le cas "stores déjà créé + user create".
     */
    await seedDocument(testEnv, 'stores', 'store-uidA-abc123', {
      name: 'Boutique Légitime',
      active: true,
      adminUid: 'uidA',
    })

    const ctxA = getAuthenticatedContext(testEnv, 'uidA')
    const ref = doc(ctxA.firestore(), 'users', 'uidA')
    await assertSucceeds(setDoc(ref, {
      active: true,
      storeId: 'store-uidA-abc123',
      role: 'store_admin',
      storeName: 'Boutique Légitime',
    }))
  })

  it('[TC-009-04] uidAttacker tente de créer users/uidVictime (uid différent du sien) — deny', async () => {
    /**
     * firestore.rules — allow create users/{userId} :
     *   request.auth.uid == userId
     *
     * request.auth.uid = 'uidAttacker' != userId = 'uidVictime' → DENY.
     * Indépendant de la correction MASTER-SEC-001 : toujours refusé.
     */
    await seedDocument(testEnv, 'stores', 'store-victim-abc123', {
      name: 'Boutique Victime',
      active: true,
      adminUid: 'uidVictime',
    })

    const ctx = getAuthenticatedContext(testEnv, 'uidAttacker')
    const ref = doc(ctx.firestore(), 'users', 'uidVictime')
    await assertFails(setDoc(ref, {
      active: true,
      storeId: 'store-victim-abc123',
      role: 'store_admin',
      storeName: 'Boutique Victime',
    }))
  })

  it('[TC-009-05] auto-création avec role: "member" — deny', async () => {
    /**
     * firestore.rules — allow create users/{userId} :
     *   request.resource.data.role == 'store_admin'
     *
     * role: 'member' != 'store_admin' → DENY.
     * Empêche la création de sous-comptes membres via auto-inscription.
     */
    await seedDocument(testEnv, 'stores', 'store-member-abc123', {
      name: 'Boutique Member',
      active: true,
      adminUid: 'uidMember',
    })

    const ctx = getAuthenticatedContext(testEnv, 'uidMember')
    const ref = doc(ctx.firestore(), 'users', 'uidMember')
    await assertFails(setDoc(ref, {
      active: true,
      storeId: 'store-member-abc123',
      role: 'member',
      storeName: 'Boutique Member',
    }))
  })

  it('[TC-009-06] auto-création avec active: false — deny', async () => {
    /**
     * firestore.rules — allow create users/{userId} :
     *   request.resource.data.active == true
     *
     * active: false != true → DENY.
     */
    await seedDocument(testEnv, 'stores', 'store-inactive-abc123', {
      name: 'Boutique Inactive',
      active: true,
      adminUid: 'uidInactive',
    })

    const ctx = getAuthenticatedContext(testEnv, 'uidInactive')
    const ref = doc(ctx.firestore(), 'users', 'uidInactive')
    await assertFails(setDoc(ref, {
      active: false,
      storeId: 'store-inactive-abc123',
      role: 'store_admin',
      storeName: 'Boutique Inactive',
    }))
  })

  it('[TC-009-07] non authentifié — create users/uid-new — deny', async () => {
    /**
     * firestore.rules — allow create users/{userId} :
     *   signedIn() exige request.auth != null.
     *
     * Contexte non authentifié → DENY.
     */
    const ctx = getUnauthenticatedContext(testEnv)
    const ref = doc(ctx.firestore(), 'users', 'uid-new')
    await assertFails(setDoc(ref, {
      active: true,
      storeId: 'store-test-aaa',
      role: 'store_admin',
      storeName: 'Store A',
    }))
  })

  it('[TC-009-08] utilisateur existant — update role — deny', async () => {
    /**
     * firestore.rules — allow update users/{userId} :
     *   request.resource.data.diff(resource.data).affectedKeys().hasOnly(['lastLogin'])
     *
     * 'role' n'est pas dans la liste des champs modifiables → DENY.
     */
    await seedDocument(testEnv, 'users', 'uid-existing-aaa', {
      active: true,
      storeId: 'store-test-aaa',
      role: 'member',
      storeName: 'Store A',
    })
    const ctx = getAuthenticatedContext(testEnv, 'uid-existing-aaa')
    const ref = doc(ctx.firestore(), 'users', 'uid-existing-aaa')
    await assertFails(updateDoc(ref, { role: 'store_admin' }))
  })

  it('[TC-009-09] utilisateur existant — update storeId — deny', async () => {
    /**
     * firestore.rules — allow update users/{userId} :
     *   request.resource.data.diff(resource.data).affectedKeys().hasOnly(['lastLogin'])
     *
     * 'storeId' n'est pas dans la liste des champs modifiables → DENY.
     * Empêche la réaffectation d'un utilisateur à une autre boutique après inscription.
     */
    await seedDocument(testEnv, 'users', 'uid-existing-aaa', {
      active: true,
      storeId: 'store-test-aaa',
      role: 'member',
      storeName: 'Store A',
    })
    const ctx = getAuthenticatedContext(testEnv, 'uid-existing-aaa')
    const ref = doc(ctx.firestore(), 'users', 'uid-existing-aaa')
    await assertFails(updateDoc(ref, { storeId: 'store-test-bbb' }))
  })

  it('[TC-009-10] préparation V2 : uidSub s\'auto-rattache à une boutique existante avec role "member" — deny', async () => {
    /**
     * PRÉPARATION V2 — Sous-comptes membres
     *
     * Scénario : uidSub est un futur sous-compte qui tente de s'auto-créer
     * avec role: 'member' sur une boutique existante (store-owner-aaa),
     * même si stores/store-owner-aaa existe et que adminUid appartient à uidOwner.
     *
     * Deux protections actives :
     * 1. role: 'member' != 'store_admin' → refus par la règle de rôle
     * 2. getAfter(stores/store-owner-aaa).data.adminUid = 'uidOwner' != 'uidSub' → refus
     *
     * Pour la V2 : la création de sous-comptes membres devra passer par
     * une Cloud Function (ou Admin SDK) qui contourne les règles Firestore,
     * garantissant que l'administrateur de la boutique en est l'initiateur.
     * La règle allow create ne devra PAS être assouplie pour les membres.
     */
    await seedDocument(testEnv, 'stores', 'store-owner-aaa', {
      name: 'Boutique du Propriétaire',
      active: true,
      adminUid: 'uidOwner',
    })

    const ctxSub = getAuthenticatedContext(testEnv, 'uidSub')
    const ref = doc(ctxSub.firestore(), 'users', 'uidSub')
    await assertFails(setDoc(ref, {
      active: true,
      storeId: 'store-owner-aaa',
      role: 'member',
      storeName: 'Boutique du Propriétaire',
    }))
  })
})
