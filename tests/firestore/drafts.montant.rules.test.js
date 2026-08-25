/**
 * TC-FST-DRAFT-MONTANT — Bornes de montant sur les brouillons (drafts)
 *
 * Comportement protégé :
 *   firestore.rules — validTransaction(data) :
 *     data.montant is number && data.montant > 0 && data.montant == math.floor(data.montant)
 *
 *   Aucun plafond supérieur. L'ancien AMOUNT_MAX = 100000000 a été supprimé.
 *   Seules contraintes : nombre entier strictement positif.
 *
 * Tests couverts :
 *   - montant 100000000 (ancien plafond) → accepté
 *   - montant 100000001 (au-delà de l'ancien plafond) → accepté
 *   - montant 999999999 (grand entier) → accepté
 *   - montant décimal 1.5 → refusé
 *   - montant zéro 0 → refusé
 *   - montant négatif -1 → refusé
 *   - montant string "1000" → refusé (pas un number Firestore)
 *
 * Collection testée : clients/{storeId}/drafts
 * Projet exclusif : demo-akayis-test
 * Aucun accès Firebase production.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, addDoc } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertSucceeds,
  assertFails,
  getAuthenticatedContext,
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
 * Seed du profil utilisateur actif pour les tests.
 * uid-member-aaa appartient à la boutique store-test-aaa.
 */
async function seedMemberAaa() {
  await seedDocument(testEnv, 'users', 'uid-member-aaa', {
    active: true,
    storeId: 'store-test-aaa',
    role: 'member',
    storeName: 'Store A',
  })
}

/**
 * Construit un payload de brouillon valide avec le montant fourni.
 * Tous les champs requis par validTransaction + validStoreScopedTransaction + isPendingStatus.
 */
function draftPayload(montant) {
  return {
    montant,
    type: 'Dépôt',
    clientId: 'client-001',
    storeId: 'store-test-aaa',
    statut: 'Non Terminées',
    reseau: 'Orange',
  }
}

describe('TC-FST-DRAFT-MONTANT — Bornes de montant drafts (règles Firestore)', () => {

  // ---------------------------------------------------------------------------
  // Montants valides — plafond supprimé
  // ---------------------------------------------------------------------------

  it('[TC-FST-DM-01] montant 100000000 (ancien plafond AMOUNT_MAX) → accepté', async () => {
    /**
     * L'ancien plafond AMOUNT_MAX = 100000000 a été supprimé de firestoreConstants.js.
     * firestore.rules ne l'a jamais contenu (seulement > 0 et math.floor).
     * Ce test confirme qu'aucune règle ne bloque ce montant.
     */
    await seedMemberAaa()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-aaa')
    const col = collection(ctx.firestore(), 'clients', 'store-test-aaa', 'drafts')
    await assertSucceeds(addDoc(col, draftPayload(100000000)))
  })

  it('[TC-FST-DM-02] montant 100000001 (au-delà de l\'ancien plafond) → accepté', async () => {
    await seedMemberAaa()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-aaa')
    const col = collection(ctx.firestore(), 'clients', 'store-test-aaa', 'drafts')
    await assertSucceeds(addDoc(col, draftPayload(100000001)))
  })

  it('[TC-FST-DM-03] montant 999999999 (grand entier positif) → accepté', async () => {
    await seedMemberAaa()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-aaa')
    const col = collection(ctx.firestore(), 'clients', 'store-test-aaa', 'drafts')
    await assertSucceeds(addDoc(col, draftPayload(999999999)))
  })

  it('[TC-FST-DM-04] montant 1 (minimum entier positif strict) → accepté', async () => {
    await seedMemberAaa()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-aaa')
    const col = collection(ctx.firestore(), 'clients', 'store-test-aaa', 'drafts')
    await assertSucceeds(addDoc(col, draftPayload(1)))
  })

  it('[TC-FST-DM-05] montant 1000 (cas nominal) → accepté', async () => {
    await seedMemberAaa()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-aaa')
    const col = collection(ctx.firestore(), 'clients', 'store-test-aaa', 'drafts')
    await assertSucceeds(addDoc(col, draftPayload(1000)))
  })

  // ---------------------------------------------------------------------------
  // Montants invalides — contraintes conservées
  // ---------------------------------------------------------------------------

  it('[TC-FST-DM-06] montant décimal 1.5 → refusé (math.floor(1.5) != 1.5)', async () => {
    /**
     * firestore.rules — validTransaction :
     *   data.montant == math.floor(data.montant)
     * 1.5 !== math.floor(1.5) = 1 → DENY
     */
    await seedMemberAaa()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-aaa')
    const col = collection(ctx.firestore(), 'clients', 'store-test-aaa', 'drafts')
    await assertFails(addDoc(col, draftPayload(1.5)))
  })

  it('[TC-FST-DM-07] montant zéro 0 → refusé (> 0 requis)', async () => {
    /**
     * firestore.rules — validTransaction :
     *   data.montant > 0
     * 0 n'est pas strictement positif → DENY
     */
    await seedMemberAaa()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-aaa')
    const col = collection(ctx.firestore(), 'clients', 'store-test-aaa', 'drafts')
    await assertFails(addDoc(col, draftPayload(0)))
  })

  it('[TC-FST-DM-08] montant négatif -1 → refusé (> 0 requis)', async () => {
    await seedMemberAaa()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-aaa')
    const col = collection(ctx.firestore(), 'clients', 'store-test-aaa', 'drafts')
    await assertFails(addDoc(col, draftPayload(-1)))
  })

  it('[TC-FST-DM-09] montant string "1000" → refusé (is number requis)', async () => {
    /**
     * firestore.rules — validTransaction :
     *   data.montant is number
     * "1000" est un string, pas un number → DENY
     * Ce test vérifie que le SDK client ne fait pas de coercition implicite.
     */
    await seedMemberAaa()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-aaa')
    const col = collection(ctx.firestore(), 'clients', 'store-test-aaa', 'drafts')
    await assertFails(addDoc(col, draftPayload('1000')))
  })

  it('[TC-FST-DM-10] montant décimal 0.5 → refusé', async () => {
    await seedMemberAaa()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-aaa')
    const col = collection(ctx.firestore(), 'clients', 'store-test-aaa', 'drafts')
    await assertFails(addDoc(col, draftPayload(0.5)))
  })

  // ---------------------------------------------------------------------------
  // Borne technique MAX_SAFE_INTEGER
  // ---------------------------------------------------------------------------

  it('[TC-FST-DM-11] montant Number.MAX_SAFE_INTEGER (9007199254740991) → accepté', async () => {
    /**
     * firestore.rules — validTransaction :
     *   data.montant <= 9007199254740991 (limite technique JavaScript Number.MAX_SAFE_INTEGER)
     * 9007199254740991 doit être accepté.
     */
    await seedMemberAaa()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-aaa')
    const col = collection(ctx.firestore(), 'clients', 'store-test-aaa', 'drafts')
    await assertSucceeds(addDoc(col, draftPayload(9007199254740991)))
  })

  it('[TC-FST-DM-12] montant MAX_SAFE_INTEGER + 1 (9007199254740992) → refusé', async () => {
    /**
     * firestore.rules — validTransaction :
     *   data.montant <= 9007199254740991
     * 9007199254740992 dépasse la borne → DENY.
     * Note : le SDK JS arrondit 9007199254740993 à 9007199254740992 (IEEE-754),
     * donc 9007199254740992 est le vrai test utile au-delà de MAX_SAFE_INTEGER.
     */
    await seedMemberAaa()
    const ctx = getAuthenticatedContext(testEnv, 'uid-member-aaa')
    const col = collection(ctx.firestore(), 'clients', 'store-test-aaa', 'drafts')
    await assertFails(addDoc(col, draftPayload(9007199254740992)))
  })
})
