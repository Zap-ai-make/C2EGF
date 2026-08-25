/**
 * TC-FST-HISTORY-SETTLEMENT-LOCK — Verrou de cohérence des champs de règlement (history/create)
 *
 * Comportement protégé (M1 — intégrité de la piste d'audit) :
 *   firestore.rules — la création d'un doc `history` par un membre boutique (flux
 *   paiement-unique legacy, écrit côté client) ne validait que type/montant/clientId + statut,
 *   PAS les champs de comptabilité de règlement. Un membre pouvait donc forger paidAmount,
 *   settlementStatus, settlementSummary, remainingAmount… dans un doc history terminal :
 *     - corruption des agrégations/rapports (chiffre d'affaires par réseau/méthode),
 *     - blanchiment d'un renversement : reverseHistoryTransactionImpact lit
 *       historyData.settlementSummary.netByNetwork pour recréditer « exactement » les soldes ;
 *       un settlementSummary forgé (qu'aucun writer client légitime ne pose) fait recréditer
 *       un montant fabriqué lors d'une annulation.
 *
 * Forme LÉGITIME (client) — cf. src/services/draftService.js:311-326 :
 *   settlementStatus:'settled', remainingAmount:0, refundedAmount:0, originalAmount==montant,
 *   paidAmount==settlementAmount (= effectiveAmount, éventuellement > montant via amountOverride),
 *   et AUCUN settlementSummary (réservé à la Cloud Function / Admin SDK).
 *
 * Correctif : validClientHistorySettlement(request.resource.data) sur `allow create` history.
 * Le circuit serveur (Admin SDK) contourne les règles et n'est pas affecté.
 *
 * Deux boutiques distinctes (store-test-aaa, store-test-bbb) pour vérifier le cloisonnement.
 * Collection testée : clients/{storeId}/history
 * Projet exclusif : demo-akayis-test. Aucun accès Firebase production.
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
    throw new Error(`SÉCURITÉ : projectId manquant ou non-demo. Valeur reçue : "${projectId}"`)
  }
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
})

// ── Fixtures ──────────────────────────────────────────────────────────────────

async function seedMember(uid, storeId) {
  await seedDocument(testEnv, 'users', uid, {
    active: true,
    storeId,
    role: 'member',
    storeName: `Store ${storeId}`,
  })
}

// History légitime « paiement unique complet » tel que draftService.validateTransaction l'écrit.
function settledHistory(storeId, overrides = {}) {
  return {
    montant: 100000,
    type: 'Dépôt',
    clientId: 'client-h-001',
    storeId,
    statut: 'Encaissé par Cash',
    reseau: 'Orange',
    paymentMethod: 'Cash',
    effectiveNetwork: 'Liquidite',
    settlementAmount: 100000,
    originalAmount: 100000,
    paidAmount: 100000,
    refundedAmount: 0,
    remainingAmount: 0,
    settlementStatus: 'settled',
    // Pas de settlementSummary — jamais posé par un writer client.
    ...overrides,
  }
}

const AAA = { uid: 'uid-member-aaa-hist', store: 'store-test-aaa' }
const BBB = { uid: 'uid-member-bbb-hist', store: 'store-test-bbb' }

function historyCol(ctx, storeId) {
  return collection(ctx.firestore(), 'clients', storeId, 'history')
}

describe('TC-FST-HISTORY-SETTLEMENT-LOCK — Cohérence des champs de règlement (history/create)', () => {

  // ---------------------------------------------------------------------------
  // Positifs — les formes légitimes restent autorisées
  // ---------------------------------------------------------------------------

  it('[HIST-01] paiement unique complet (forme draftService) → accepté', async () => {
    await seedMember(AAA.uid, AAA.store)
    const ctx = getAuthenticatedContext(testEnv, AAA.uid)
    await assertSucceeds(addDoc(historyCol(ctx, AAA.store), settledHistory(AAA.store)))
  })

  it('[HIST-02] « Validée » minimal sans champ de règlement (addToHistory) → accepté', async () => {
    await seedMember(AAA.uid, AAA.store)
    const ctx = getAuthenticatedContext(testEnv, AAA.uid)
    await assertSucceeds(addDoc(historyCol(ctx, AAA.store), {
      montant: 5000,
      type: 'Dépôt',
      clientId: 'client-h-002',
      storeId: AAA.store,
      statut: 'Validée',
      reseau: 'Orange',
    }))
  })

  it('[HIST-03] règlement avec amountOverride > montant (paidAmount==settlementAmount) → accepté (pas de borne haute)', async () => {
    // amountOverride n'est pas borné à montant (draftService.js:274) : paidAmount peut dépasser montant.
    await seedMember(AAA.uid, AAA.store)
    const ctx = getAuthenticatedContext(testEnv, AAA.uid)
    await assertSucceeds(addDoc(historyCol(ctx, AAA.store), settledHistory(AAA.store, {
      settlementAmount: 150000,
      paidAmount: 150000,
      // originalAmount reste == montant (100000)
    })))
  })

  // ---------------------------------------------------------------------------
  // Négatifs — forge des champs de règlement dans un history terminal
  // ---------------------------------------------------------------------------

  it('[HIST-04] settlementSummary FORGÉ présent → refusé (vecteur de blanchiment d\'annulation)', async () => {
    await seedMember(AAA.uid, AAA.store)
    const ctx = getAuthenticatedContext(testEnv, AAA.uid)
    await assertFails(addDoc(historyCol(ctx, AAA.store), settledHistory(AAA.store, {
      settlementSummary: { netByNetwork: { Orange: { paid: 9999999, refunded: 0 } } },
    })))
  })

  it('[HIST-05] settlementStatus=\'partial\' sur un history → refusé', async () => {
    await seedMember(AAA.uid, AAA.store)
    const ctx = getAuthenticatedContext(testEnv, AAA.uid)
    await assertFails(addDoc(historyCol(ctx, AAA.store), settledHistory(AAA.store, {
      settlementStatus: 'partial',
    })))
  })

  it('[HIST-06] remainingAmount > 0 sur un history → refusé', async () => {
    await seedMember(AAA.uid, AAA.store)
    const ctx = getAuthenticatedContext(testEnv, AAA.uid)
    await assertFails(addDoc(historyCol(ctx, AAA.store), settledHistory(AAA.store, {
      remainingAmount: 50000,
    })))
  })

  it('[HIST-07] refundedAmount > 0 sur un history → refusé', async () => {
    await seedMember(AAA.uid, AAA.store)
    const ctx = getAuthenticatedContext(testEnv, AAA.uid)
    await assertFails(addDoc(historyCol(ctx, AAA.store), settledHistory(AAA.store, {
      refundedAmount: 30000,
    })))
  })

  it('[HIST-08] originalAmount ≠ montant → refusé (borne de référence gonflée)', async () => {
    await seedMember(AAA.uid, AAA.store)
    const ctx = getAuthenticatedContext(testEnv, AAA.uid)
    await assertFails(addDoc(historyCol(ctx, AAA.store), settledHistory(AAA.store, {
      originalAmount: 9999999,
    })))
  })

  it('[HIST-09] paidAmount non entier → refusé', async () => {
    await seedMember(AAA.uid, AAA.store)
    const ctx = getAuthenticatedContext(testEnv, AAA.uid)
    await assertFails(addDoc(historyCol(ctx, AAA.store), settledHistory(AAA.store, {
      paidAmount: 100000.5,
      settlementAmount: 100000.5,
    })))
  })

  // ---------------------------------------------------------------------------
  // Cloisonnement — un membre d'une autre boutique ne peut pas forger ailleurs
  // ---------------------------------------------------------------------------

  it('[HIST-10] membre BBB ne peut pas créer un history forgé dans AAA (cross-store) → refusé', async () => {
    await seedMember(BBB.uid, BBB.store)
    const ctx = getAuthenticatedContext(testEnv, BBB.uid)
    await assertFails(addDoc(historyCol(ctx, AAA.store), settledHistory(AAA.store, {
      settlementSummary: { netByNetwork: { Orange: { paid: 9999999, refunded: 0 } } },
    })))
  })

  it('[HIST-11] membre BBB crée un history légitime dans SA boutique → accepté', async () => {
    await seedMember(BBB.uid, BBB.store)
    const ctx = getAuthenticatedContext(testEnv, BBB.uid)
    await assertSucceeds(addDoc(historyCol(ctx, BBB.store), settledHistory(BBB.store)))
  })
})
