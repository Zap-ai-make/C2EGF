/**
 * TC-008 — Suppression et modification d'un document history (règles Firestore)
 * TC-010 — Lecture non paginée history (règle actuelle)
 *
 * Comportement protégé (après correction MASTER-SEC-003) :
 *   TC-008 : firestore.rules — match /clients/{storeId}/history/{historyId}
 *     - allow read:   if isStoreMember(storeId)
 *     - allow create: if isStoreMember(storeId) && validStoreScopedTransaction && validStatus && !isPendingStatus
 *     - allow update: if isStoreMember(storeId) && affectedKeys hasOnly ['statut','updatedAt','notes'] && validStatus
 *     - allow delete: if false  ← MASTER-SEC-003 corrigé
 *
 *   TC-010 : la règle allow list (couverte par allow read) n'impose pas de limite de pagination.
 *
 * Risques couverts : MASTER-SEC-003 (delete bloqué), MASTER-PERF-001 (lecture non bornée).
 * Gap documenté : balance reversal non implémenté — prévu V2/Lot 3B.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, getDocs, deleteDoc, updateDoc, setDoc, collection } from 'firebase/firestore'
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

/**
 * Seeds communs pour TC-008.
 * Appelé au début de chaque `it` car clearFirestore() s'exécute dans beforeEach.
 *
 * Profils seedés :
 *   - uid-member-aaa  : membre actif, boutique A (store-test-aaa)
 *   - uid-member-bbb  : membre actif, boutique B (store-test-bbb)
 *   - uid-inactive-aaa: membre INACTIF, boutique A
 *   - clients/store-test-aaa/history/hist-aaa-001 : transaction Validée, boutique A
 */
async function seedAll() {
  await seedDocument(testEnv, 'users', 'uid-member-aaa', {
    active: true,
    storeId: 'store-test-aaa',
    role: 'member',
    storeName: 'Store A',
  })
  await seedDocument(testEnv, 'users', 'uid-member-bbb', {
    active: true,
    storeId: 'store-test-bbb',
    role: 'member',
    storeName: 'Store B',
  })
  await seedDocument(testEnv, 'users', 'uid-inactive-aaa', {
    active: false,
    storeId: 'store-test-aaa',
    role: 'member',
    storeName: 'Store A',
  })
  await seedDocument(testEnv, 'clients/store-test-aaa/history', 'hist-aaa-001', {
    montant: 1000,
    statut: 'Validée',
    type: 'Dépôt',
    storeId: 'store-test-aaa',
    reseau: 'Orange',
    clientId: 'client-001',
    createdAt: '2026-06-17T08:00:00.000Z',
  })
}

describe('TC-008 — Suppression et modification history (règles Firestore)', () => {
  it('[TC-008-01] uid-member-aaa (storeA) — delete hist-aaa-001 (Validée) — deny', async () => {
    /**
     * MASTER-SEC-003 CORRIGÉ
     *
     * firestore.rules — allow delete: if false
     *
     * Aucun membre ne peut supprimer une transaction de l'historique,
     * quelle que soit sa boutique ou son rôle.
     * La suppression a été remplacée par un soft-delete (statut → 'Annulée')
     * via deleteFromHistory dans src/services/firestore.js.
     *
     * Gap documenté : balance reversal non implémenté — prévu V2/Lot 3B.
     */
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-aaa')
    const ref = doc(ctx.firestore(), 'clients', 'store-test-aaa', 'history', 'hist-aaa-001')
    await assertFails(deleteDoc(ref))
  })

  it('[TC-008-02] uid-member-bbb (storeB) — delete clients/store-test-aaa/history/hist-aaa-001 — deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-bbb')
    const ref = doc(ctx.firestore(), 'clients', 'store-test-aaa', 'history', 'hist-aaa-001')
    await assertFails(deleteDoc(ref))
  })

  it('[TC-008-03] non authentifié — delete clients/store-test-aaa/history/hist-aaa-001 — deny', async () => {
    await seedAll()
    const ctx = getUnauthenticatedContext(testEnv)
    const ref = doc(ctx.firestore(), 'clients', 'store-test-aaa', 'history', 'hist-aaa-001')
    await assertFails(deleteDoc(ref))
  })

  it('[TC-008-04] uid-inactive-aaa (active: false) — delete clients/store-test-aaa/history/hist-aaa-001 — deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'uid-inactive-aaa')
    const ref = doc(ctx.firestore(), 'clients', 'store-test-aaa', 'history', 'hist-aaa-001')
    await assertFails(deleteDoc(ref))
  })

  it('[TC-008-05] uid-member-aaa (storeA) — update montant — deny', async () => {
    /**
     * firestore.rules:131-133 :
     *   allow update: if isStoreMember(storeId) &&
     *     request.resource.data.diff(resource.data).affectedKeys().hasOnly(['statut', 'updatedAt', 'notes']) &&
     *     validStatus(request.resource.data.statut);
     *
     * 'montant' n'est pas dans la liste des champs autorisés → DENY.
     */
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-aaa')
    const ref = doc(ctx.firestore(), 'clients', 'store-test-aaa', 'history', 'hist-aaa-001')
    await assertFails(updateDoc(ref, { montant: 9999 }))
  })

  it('[TC-008-06] uid-member-aaa (storeA) — update statut seul vers valeur valide — allow', async () => {
    /**
     * firestore.rules :
     *   allow update: if isStoreMember(storeId) &&
     *     request.resource.data.diff(resource.data).affectedKeys().hasOnly(['statut', 'updatedAt', 'notes']) &&
     *     validStatus(request.resource.data.statut);
     *
     * 'statut' est dans la liste des champs autorisés et 'Non Terminées' est une valeur validStatus → ALLOW.
     * Ce flux est utilisé par deleteFromHistory (soft-delete → 'Annulée').
     */
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-aaa')
    const ref = doc(ctx.firestore(), 'clients', 'store-test-aaa', 'history', 'hist-aaa-001')
    await assertSucceeds(updateDoc(ref, { statut: 'Non Terminées' }))
  })

  it('[TC-008-06b] uid-member-aaa — update type — deny', async () => {
    /**
     * 'type' n'est pas dans la liste des champs autorisés → DENY.
     * Protège l'intégrité de la piste d'audit : le type d'une transaction
     * (Dépôt, Retrait, Crédit) ne peut pas être altéré après création.
     */
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-aaa')
    const ref = doc(ctx.firestore(), 'clients', 'store-test-aaa', 'history', 'hist-aaa-001')
    await assertFails(updateDoc(ref, { type: 'Retrait' }))
  })

  it('[TC-008-06c] uid-member-aaa — update clientId — deny', async () => {
    /**
     * 'clientId' n'est pas dans la liste des champs autorisés → DENY.
     * Protège le rattachement d'une transaction à son client d'origine.
     */
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-aaa')
    const ref = doc(ctx.firestore(), 'clients', 'store-test-aaa', 'history', 'hist-aaa-001')
    await assertFails(updateDoc(ref, { clientId: 'client-frauduleux' }))
  })

  it('[TC-008-06d] uid-member-aaa — update storeId — deny', async () => {
    /**
     * 'storeId' n'est pas dans la liste des champs autorisés → DENY.
     * Protège la séparation inter-boutiques : impossible de déplacer
     * une transaction d'une boutique vers une autre.
     */
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-aaa')
    const ref = doc(ctx.firestore(), 'clients', 'store-test-aaa', 'history', 'hist-aaa-001')
    await assertFails(updateDoc(ref, { storeId: 'store-test-bbb' }))
  })

  it('[TC-008-10] uid-member-aaa — update notes + updatedAt — allow', async () => {
    /**
     * 'notes' et 'updatedAt' sont dans la liste des champs autorisés → ALLOW.
     * Permet d'ajouter un commentaire à une transaction sans altérer
     * les données financières.
     */
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-aaa')
    const ref = doc(ctx.firestore(), 'clients', 'store-test-aaa', 'history', 'hist-aaa-001')
    await assertSucceeds(updateDoc(ref, { notes: 'commentaire', updatedAt: new Date().toISOString() }))
  })

  it('[TC-008-07] uid-member-aaa (storeA) — get clients/store-test-aaa/history/hist-aaa-001 — allow', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-aaa')
    const ref = doc(ctx.firestore(), 'clients', 'store-test-aaa', 'history', 'hist-aaa-001')
    const snap = await assertSucceeds(getDoc(ref))
    expect(snap.exists()).toBe(true)
    expect(snap.data().storeId).toBe('store-test-aaa')
  })

  it('[TC-008-08] uid-member-aaa (storeA) — get clients/store-test-bbb/history/hist-bbb-001 — deny', async () => {
    await seedAll()
    await seedDocument(testEnv, 'clients/store-test-bbb/history', 'hist-bbb-001', {
      montant: 500,
      statut: 'Validée',
      type: 'Retrait',
      storeId: 'store-test-bbb',
      clientId: 'client-002',
      createdAt: '2026-06-17T08:00:00.000Z',
    })
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-aaa')
    const ref = doc(ctx.firestore(), 'clients', 'store-test-bbb', 'history', 'hist-bbb-001')
    await assertFails(getDoc(ref))
  })
})

describe('TC-010 — Lecture non paginée history (règles Firestore)', () => {
  it('[TC-010-01] uid-member-aaa — getDocs sans limit sur clients/store-test-aaa/history — allow — 5 documents reçus', async () => {
    /**
     * COMPORTEMENT ACTUEL FIGÉ — MASTER-PERF-001
     *
     * firestore.rules:126 — allow read: if isStoreMember(storeId)
     * La règle n'impose aucune limite de pagination (pas de limit() requis).
     * Un getDocs sans limit charge toute la collection history.
     *
     * Ce test fige ce comportement actuel. Ne pas corriger en Lot 0.
     * Correction prévue au Lot 4.
     */
    await seedDocument(testEnv, 'users', 'uid-member-aaa', {
      active: true,
      storeId: 'store-test-aaa',
      role: 'member',
      storeName: 'Store A',
    })
    for (let i = 1; i <= 5; i++) {
      await seedDocument(testEnv, 'clients/store-test-aaa/history', `hist-${i}`, {
        montant: i * 100,
        statut: 'Validée',
        type: 'Dépôt',
        storeId: 'store-test-aaa',
        clientId: `client-00${i}`,
        createdAt: '2026-06-17T08:00:00.000Z',
      })
    }
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-aaa')
    const col = collection(ctx.firestore(), 'clients', 'store-test-aaa', 'history')
    const snap = await assertSucceeds(getDocs(col))
    expect(snap.size).toBe(5)
  })

  it('[TC-010-02] uid-member-bbb (storeB) — getDocs sur clients/store-test-aaa/history — deny', async () => {
    await seedDocument(testEnv, 'users', 'uid-member-aaa', {
      active: true,
      storeId: 'store-test-aaa',
      role: 'member',
      storeName: 'Store A',
    })
    await seedDocument(testEnv, 'users', 'uid-member-bbb', {
      active: true,
      storeId: 'store-test-bbb',
      role: 'member',
      storeName: 'Store B',
    })
    for (let i = 1; i <= 5; i++) {
      await seedDocument(testEnv, 'clients/store-test-aaa/history', `hist-${i}`, {
        montant: i * 100,
        statut: 'Validée',
        type: 'Dépôt',
        storeId: 'store-test-aaa',
        clientId: `client-00${i}`,
        createdAt: '2026-06-17T08:00:00.000Z',
      })
    }
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-bbb')
    const col = collection(ctx.firestore(), 'clients', 'store-test-aaa', 'history')
    await assertFails(getDocs(col))
  })
})

describe('TC-V2-16-UTF8 — Valeurs corrompues retirées de validStatus/validTransaction', () => {
  /**
   * CARACTÉRISATION : avant correction V2-16, firestore.rules acceptait des
   * valeurs corrompues en encodage Latin-1 ('DÃ©pÃ´t', 'CrÃ©dit', 'ValidÃ©e',
   * 'RemboursÃ©e', 'AnnulÃ©e', 'Non TerminÃ©es') dans validTransaction(),
   * validStatus() et isPendingStatus(). Ces séquences ne peuvent jamais être
   * produites par un client correctement encodé en UTF-8 — elles ont été
   * retirées. Les valeurs correctes (accentuées et non accentuées) restent
   * acceptées.
   */
  it('[UTF8-01] update statut vers valeur corrompue "ValidÃ©e" → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-aaa')
    const ref = doc(ctx.firestore(), 'clients', 'store-test-aaa', 'history', 'hist-aaa-001')
    await assertFails(updateDoc(ref, { statut: 'ValidÃ©e' }))
  })

  it('[UTF8-02] update statut vers valeur correcte accentuée "Remboursée" → allow', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-aaa')
    const ref = doc(ctx.firestore(), 'clients', 'store-test-aaa', 'history', 'hist-aaa-001')
    await assertSucceeds(updateDoc(ref, { statut: 'Remboursée' }))
  })

  it('[UTF8-03] update statut vers valeur correcte sans accent "Annulee" → allow', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-aaa')
    const ref = doc(ctx.firestore(), 'clients', 'store-test-aaa', 'history', 'hist-aaa-001')
    await assertSucceeds(updateDoc(ref, { statut: 'Annulee' }))
  })

  it('[UTF8-04] create draft avec statut corrompu "Non TerminÃ©es" → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-aaa')
    const ref = doc(ctx.firestore(), 'clients', 'store-test-aaa', 'drafts', 'draft-utf8')
    await assertFails(setDoc(ref, {
      montant: 100, type: 'Dépôt', clientId: 'client-001', storeId: 'store-test-aaa', statut: 'Non TerminÃ©es',
    }))
  })

  it('[UTF8-05] create history avec type corrompu "DÃ©pÃ´t" → deny', async () => {
    await seedAll()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-aaa')
    const ref = doc(ctx.firestore(), 'clients', 'store-test-aaa', 'history', 'hist-utf8')
    await assertFails(setDoc(ref, {
      montant: 100, type: 'DÃ©pÃ´t', clientId: 'client-001', storeId: 'store-test-aaa', statut: 'Validée',
    }))
  })
})
