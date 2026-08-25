/**
 * TC-FST-DRAFT-SETTLEMENT — Verrou des champs de comptabilité de règlement (drafts)
 *
 * Comportement protégé (P0 sécurité — frontière de confiance draft→callable) :
 *   firestore.rules — les champs de règlement (originalAmount, paidAmount, refundedAmount,
 *   remainingAmount, settlementStatus, settlementSummary, settlementUpdatedAt,
 *   settlementAmount) sont écrits EXCLUSIVEMENT par les Cloud Functions (Admin SDK).
 *   Un membre boutique ne doit jamais pouvoir les fixer (create) ni les modifier/ajouter/
 *   retirer (update). Sinon addTransactionPayment/Refund, qui lisent remainingAmount/
 *   paidAmount pour borner un règlement, feraient confiance à une donnée falsifiée.
 *
 *   create : draftHasNoSettlementFields(request.resource.data)
 *   update : draftSettlementFieldsUnchanged(request.resource.data, resource.data)
 *
 * Deux boutiques distinctes (store-test-aaa, store-test-bbb) pour vérifier le cloisonnement.
 * Collection testée : clients/{storeId}/drafts
 * Projet exclusif : demo-akayis-test. Aucun accès Firebase production.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, addDoc, doc, updateDoc, deleteField } from 'firebase/firestore'
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

// Brouillon client valide (sans aucun champ de règlement).
function draftPayload(storeId, overrides = {}) {
  return {
    montant: 1000,
    type: 'Dépôt',
    clientId: 'client-001',
    storeId,
    statut: 'Non Terminées',
    reseau: 'Orange',
    ...overrides,
  }
}

// Brouillon déjà partiellement réglé tel que le SERVEUR l'aurait écrit (champs de règlement présents).
function serverSettledDraft(storeId, overrides = {}) {
  return {
    ...draftPayload(storeId),
    originalAmount: 1000,
    paidAmount: 400,
    refundedAmount: 0,
    remainingAmount: 600,
    settlementStatus: 'partial',
    settlementSummary: { netByNetwork: { Orange: { paid: 400, refunded: 0 } } },
    ...overrides,
  }
}

const AAA = { uid: 'uid-member-aaa', store: 'store-test-aaa' }
const BBB = { uid: 'uid-member-bbb', store: 'store-test-bbb' }

function draftsCol(ctx, storeId) {
  return collection(ctx.firestore(), 'clients', storeId, 'drafts')
}
function draftDoc(ctx, storeId, draftId) {
  return doc(ctx.firestore(), 'clients', storeId, 'drafts', draftId)
}

describe('TC-FST-DRAFT-SETTLEMENT — Verrou des champs de règlement (règles Firestore)', () => {

  // ---------------------------------------------------------------------------
  // Positifs — le cycle de vie client normal reste autorisé
  // ---------------------------------------------------------------------------

  it('[SET-01] création normale sans champ de règlement → acceptée', async () => {
    await seedMember(AAA.uid, AAA.store)
    const ctx = getAuthenticatedContext(testEnv, AAA.uid)
    await assertSucceeds(addDoc(draftsCol(ctx, AAA.store), draftPayload(AAA.store)))
  })

  it('[SET-02] update du seul montant (aucun champ de règlement présent) → accepté', async () => {
    await seedMember(AAA.uid, AAA.store)
    await seedDocument(testEnv, `clients/${AAA.store}/drafts`, 'd1', draftPayload(AAA.store))
    const ctx = getAuthenticatedContext(testEnv, AAA.uid)
    await assertSucceeds(updateDoc(draftDoc(ctx, AAA.store, 'd1'), { montant: 2000 }))
  })

  it('[SET-03] update du montant sur un draft déjà réglé côté serveur → REFUSÉ (verrou C1/E1)', async () => {
    // Correctif C1/E1 : dès qu'un règlement est engagé (settlementStatus présent), `montant`
    // et `type` sont figés — un draft partiel ne peut plus voir son montant modifié par le client.
    await seedMember(AAA.uid, AAA.store)
    await seedDocument(testEnv, `clients/${AAA.store}/drafts`, 'd2', serverSettledDraft(AAA.store))
    const ctx = getAuthenticatedContext(testEnv, AAA.uid)
    await assertFails(updateDoc(draftDoc(ctx, AAA.store, 'd2'), { montant: 1500 }))
  })

  // ---------------------------------------------------------------------------
  // Négatifs — CREATE avec champ de règlement forgé
  // ---------------------------------------------------------------------------

  it('[SET-04] création avec remainingAmount forgé → refusée', async () => {
    await seedMember(AAA.uid, AAA.store)
    const ctx = getAuthenticatedContext(testEnv, AAA.uid)
    await assertFails(addDoc(draftsCol(ctx, AAA.store), draftPayload(AAA.store, { remainingAmount: 9999999 })))
  })

  it('[SET-05] création avec paidAmount forgé → refusée', async () => {
    await seedMember(AAA.uid, AAA.store)
    const ctx = getAuthenticatedContext(testEnv, AAA.uid)
    await assertFails(addDoc(draftsCol(ctx, AAA.store), draftPayload(AAA.store, { paidAmount: 0, originalAmount: 9999999 })))
  })

  it('[SET-06] création avec settlementSummary forgé → refusée', async () => {
    await seedMember(AAA.uid, AAA.store)
    const ctx = getAuthenticatedContext(testEnv, AAA.uid)
    await assertFails(addDoc(draftsCol(ctx, AAA.store), draftPayload(AAA.store, {
      settlementSummary: { netByNetwork: { Orange: { paid: 9999999, refunded: 0 } } },
    })))
  })

  // ---------------------------------------------------------------------------
  // Négatifs — UPDATE ajoutant/modifiant un champ de règlement
  // ---------------------------------------------------------------------------

  it('[SET-07] update AJOUTANT remainingAmount sur un draft qui n\'en avait pas → refusé', async () => {
    await seedMember(AAA.uid, AAA.store)
    await seedDocument(testEnv, `clients/${AAA.store}/drafts`, 'd3', draftPayload(AAA.store))
    const ctx = getAuthenticatedContext(testEnv, AAA.uid)
    await assertFails(updateDoc(draftDoc(ctx, AAA.store, 'd3'), { remainingAmount: 9999999 }))
  })

  it('[SET-08] update MODIFIANT un remainingAmount serveur existant → refusé', async () => {
    await seedMember(AAA.uid, AAA.store)
    await seedDocument(testEnv, `clients/${AAA.store}/drafts`, 'd4', serverSettledDraft(AAA.store))
    const ctx = getAuthenticatedContext(testEnv, AAA.uid)
    await assertFails(updateDoc(draftDoc(ctx, AAA.store, 'd4'), { remainingAmount: 9999999 }))
  })

  it('[SET-09] update MODIFIANT paidAmount serveur existant → refusé', async () => {
    await seedMember(AAA.uid, AAA.store)
    await seedDocument(testEnv, `clients/${AAA.store}/drafts`, 'd5', serverSettledDraft(AAA.store))
    const ctx = getAuthenticatedContext(testEnv, AAA.uid)
    await assertFails(updateDoc(draftDoc(ctx, AAA.store, 'd5'), { paidAmount: 0 }))
  })

  it('[SET-10] update ajoutant settlementStatus → refusé', async () => {
    await seedMember(AAA.uid, AAA.store)
    await seedDocument(testEnv, `clients/${AAA.store}/drafts`, 'd6', draftPayload(AAA.store))
    const ctx = getAuthenticatedContext(testEnv, AAA.uid)
    await assertFails(updateDoc(draftDoc(ctx, AAA.store, 'd6'), { settlementStatus: 'settled' }))
  })

  it('[SET-13] SUPPRESSION d\'un champ de règlement via deleteField() → refusée', async () => {
    // affectedKeys() remonte aussi une suppression de champ : draftSettlementFieldsUnchanged
    // doit donc bloquer un deleteField() sur remainingAmount.
    await seedMember(AAA.uid, AAA.store)
    await seedDocument(testEnv, `clients/${AAA.store}/drafts`, 'd7', serverSettledDraft(AAA.store))
    const ctx = getAuthenticatedContext(testEnv, AAA.uid)
    await assertFails(updateDoc(draftDoc(ctx, AAA.store, 'd7'), { remainingAmount: deleteField() }))
  })

  it('[SET-14] update d\'un SOUS-CHAMP imbriqué settlementSummary.netByNetwork.Orange.paid → refusé', async () => {
    // Un chemin de champ imbriqué remonte la clé de premier niveau (settlementSummary) dans
    // affectedKeys() → le verrou l'attrape. Empêche un contournement par sous-champ.
    await seedMember(AAA.uid, AAA.store)
    await seedDocument(testEnv, `clients/${AAA.store}/drafts`, 'd8', serverSettledDraft(AAA.store))
    const ctx = getAuthenticatedContext(testEnv, AAA.uid)
    await assertFails(updateDoc(draftDoc(ctx, AAA.store, 'd8'), {
      'settlementSummary.netByNetwork.Orange.paid': 9999999,
    }))
  })

  it('[SET-15] création avec settlementType forgé → refusée', async () => {
    // settlementType est un champ serveur (épinglage du type, défense en profondeur C1) :
    // le client ne doit jamais le fixer à la création.
    await seedMember(AAA.uid, AAA.store)
    const ctx = getAuthenticatedContext(testEnv, AAA.uid)
    await assertFails(addDoc(draftsCol(ctx, AAA.store), draftPayload(AAA.store, { settlementType: 'Retrait' })))
  })

  it('[SET-16] update AJOUTANT settlementType sur un draft qui n\'en avait pas → refusé', async () => {
    await seedMember(AAA.uid, AAA.store)
    await seedDocument(testEnv, `clients/${AAA.store}/drafts`, 'd9', draftPayload(AAA.store))
    const ctx = getAuthenticatedContext(testEnv, AAA.uid)
    await assertFails(updateDoc(draftDoc(ctx, AAA.store, 'd9'), { settlementType: 'Dépôt' }))
  })

  // ---------------------------------------------------------------------------
  // Cloisonnement — un membre d'une autre boutique ne peut pas forger ailleurs
  // ---------------------------------------------------------------------------

  it('[SET-11] membre boutique BBB ne peut pas forger un règlement sur AAA (cross-store) → refusé', async () => {
    await seedMember(BBB.uid, BBB.store)
    const ctx = getAuthenticatedContext(testEnv, BBB.uid)
    // Double barrière : isStoreMember(AAA) faux ET champ de règlement présent.
    await assertFails(addDoc(draftsCol(ctx, AAA.store), draftPayload(AAA.store, { remainingAmount: 9999999 })))
  })

  it('[SET-12] membre BBB peut créer un draft normal dans SA boutique → accepté', async () => {
    await seedMember(BBB.uid, BBB.store)
    const ctx = getAuthenticatedContext(testEnv, BBB.uid)
    await assertSucceeds(addDoc(draftsCol(ctx, BBB.store), draftPayload(BBB.store)))
  })
})
