/**
 * TC-FST-DRAFT-CORE-FREEZE — Preuves des trous C1 et E1 (contre-revue)
 *
 * Comportement protégé (cible post-correctif) :
 *   Sous match /clients/{storeId}/drafts/{draftId}, la règle update durcit 8 champs
 *   de comptabilité via draftSettlementFieldsUnchanged, mais NE verrouille PAS les champs
 *   "type" et "montant" sur un draft en cours de règlement (settlementStatus présent).
 *
 *   Faille C1 (CRITIQUE) : un membre boutique peut muter draft.type ('Retrait' → 'Dépôt')
 *   entre deux tranches, inversant le signe du delta financier dans applySettlementImpact
 *   (financialUtils.js:153 — delta = isRetrait(type) ? -amount : amount).
 *
 *   Faille E1 (ÉLEVÉ) : un membre boutique peut muter draft.montant sur un draft partiel,
 *   alors que les Cloud Functions liront (draft.remainingAmount ?? montant) à chaque tranche.
 *
 * Ces tests ont d'abord PROUVÉ le trou (assertSucceeds contre les règles non corrigées) ;
 * ils sont désormais INVERSÉS (assertFails) et servent de non-régression du correctif :
 * draftCoreFieldsFrozenIfSettling fige `type`/`montant` dès qu'un règlement est engagé.
 *
 * Deux boutiques distinctes (store-test-aaa, store-test-bbb) pour le cloisonnement.
 * Collection testée : clients/{storeId}/drafts
 * Projet exclusif : demo-akayis-test. Aucun accès Firebase production.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, updateDoc } from 'firebase/firestore'
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

/**
 * Brouillon normal (sans aucun champ de règlement).
 * Représente un draft créé par un membre avant tout règlement.
 */
function draftPayload(storeId, overrides = {}) {
  return {
    montant: 100000,
    type: 'Retrait',
    clientId: 'client-c1e1-001',
    storeId,
    statut: 'Non Terminées',
    reseau: 'Orange',
    ...overrides,
  }
}

/**
 * Draft partiellement réglé tel que le SERVEUR (Admin SDK) l'aurait écrit après
 * une première tranche. Les 8 champs de règlement sont présents (settlementStatus='partial').
 * Seed via seedDocument (withSecurityRulesDisabled) — exactement comme dans le fichier modèle.
 */
function serverPartialDraft(storeId, overrides = {}) {
  return {
    // Champs métier du draft original
    montant: 100000,
    type: 'Retrait',
    clientId: 'client-c1e1-001',
    storeId,
    statut: 'Non Terminées',
    reseau: 'Orange',
    // Champs de comptabilité écrits par la Cloud Function après tranche 1 (50 000 FCFA versés)
    originalAmount: 100000,
    paidAmount: 50000,
    refundedAmount: 0,
    remainingAmount: 50000,
    settlementStatus: 'partial',
    settlementSummary: { netByNetwork: { Orange: { paid: 50000, refunded: 0 } } },
    settlementUpdatedAt: null,
    settlementAmount: null,
    ...overrides,
  }
}

const AAA = { uid: 'uid-member-aaa-freeze', store: 'store-test-aaa' }
const BBB = { uid: 'uid-member-bbb-freeze', store: 'store-test-bbb' }

function draftDoc(ctx, storeId, draftId) {
  return doc(ctx.firestore(), 'clients', storeId, 'drafts', draftId)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TC-FST-DRAFT-CORE-FREEZE — Preuves des trous C1 et E1', () => {

  // ---------------------------------------------------------------------------
  // [FREEZE-01] PREUVE DU TROU C1 — mutation de "type" sur draft partial
  //
  // Scénario d'attaque :
  //   1. La Cloud Function addTransactionPayment crée le draft avec settlementStatus='partial'
  //      après une première tranche sur un Retrait de 100 000 FCFA.
  //   2. Entre deux tranches, un membre boutique change draft.type de 'Retrait' → 'Dépôt'.
  //   3. La prochaine tranche lira draft.type='Dépôt', causant un delta +amount au lieu de
  //      -amount dans applySettlementImpact (financialUtils.js:153).
  //      Conséquence : solde Orange gonflé de 2 × la tranche au lieu d'être débité.
  //
  // État attendu MAINTENANT (trou ouvert) : assertSucceeds.
  // État attendu APRÈS CORRECTIF            : assertFails.
  // ---------------------------------------------------------------------------

  it('[FREEZE-01] verrou C1 — mutation type=\'Retrait\'→\'Dépôt\' sur draft partial → refusée', async () => {
    // Arrange
    await seedMember(AAA.uid, AAA.store)
    await seedDocument(
      testEnv,
      `clients/${AAA.store}/drafts`,
      'draft-c1-freeze',
      serverPartialDraft(AAA.store),
    )

    const ctx = getAuthenticatedContext(testEnv, AAA.uid)

    // Act + Assert — CORRECTIF : draftCoreFieldsFrozenIfSettling refuse tout changement de
    // `type` dès que le draft porte un champ de règlement (settlementStatus/paidAmount/…).
    // Ferme l'inversion de signe entre deux tranches.
    await assertFails(
      updateDoc(draftDoc(ctx, AAA.store, 'draft-c1-freeze'), { type: 'Dépôt' })
    )
  })

  // ---------------------------------------------------------------------------
  // [FREEZE-02] PREUVE DU TROU E1 — mutation de "montant" sur draft partial
  //
  // Scénario d'attaque :
  //   1. Même état : draft partial avec settlementStatus='partial', montant original=100 000.
  //   2. Un membre boutique change draft.montant à 999 999 FCFA.
  //   3. Si addTransactionPayment est appelé avec un draft sans remainingAmount (backward-compat
  //      lazy init — addTransactionPayment.js:164), il recalcule :
  //      originalAmount = draft.originalAmount ?? draft.montant → 100 000 (préservé car déjà présent)
  //      Mais le champ montant falsifié reste dans le document history final (l. 251 : ...draft),
  //      polluant la piste d'audit et potentiellement les calculs d'affichage.
  //      Sur les anciens drafts SANS originalAmount, draft.montant serait utilisé directement
  //      comme base, permettant de gonfler le montant de référence d'un règlement.
  //
  // État attendu MAINTENANT (trou ouvert) : assertSucceeds.
  // État attendu APRÈS CORRECTIF            : assertFails.
  // ---------------------------------------------------------------------------

  it('[FREEZE-02] verrou E1 — mutation montant=100000→999999 sur draft partial → refusée', async () => {
    // Arrange
    await seedMember(AAA.uid, AAA.store)
    await seedDocument(
      testEnv,
      `clients/${AAA.store}/drafts`,
      'draft-e1-freeze',
      serverPartialDraft(AAA.store),
    )

    const ctx = getAuthenticatedContext(testEnv, AAA.uid)

    // Act + Assert — CORRECTIF : `montant` est figé au même titre que `type` dès qu'un
    // règlement est engagé → impossible de gonfler la borne entre deux tranches.
    await assertFails(
      updateDoc(draftDoc(ctx, AAA.store, 'draft-e1-freeze'), { montant: 999999 })
    )
  })

  // ---------------------------------------------------------------------------
  // [FREEZE-03] COMPORTEMENT LÉGITIME À PRÉSERVER — édition normale d'un brouillon
  //
  // Un draft sans aucun champ de règlement (brouillon en attente, jamais encore
  // soumis à addTransactionPayment) doit rester librement modifiable.
  // Ce test doit rester assertSucceeds MÊME après le correctif.
  //
  // Logique attendue du correctif : verrouiller type/montant uniquement si
  // settlementStatus est présent dans resource.data (le document existant).
  // ---------------------------------------------------------------------------

  it('[FREEZE-03] édition type et montant sur draft NON réglé → toujours autorisée (doit rester assertSucceeds après correctif)', async () => {
    // Arrange
    await seedMember(BBB.uid, BBB.store)
    await seedDocument(
      testEnv,
      `clients/${BBB.store}/drafts`,
      'draft-no-settlement',
      draftPayload(BBB.store, { type: 'Dépôt', montant: 2000 }),
    )

    const ctx = getAuthenticatedContext(testEnv, BBB.uid)

    // Mutation du type sur un draft sans aucun champ de règlement → doit rester autorisée.
    await assertSucceeds(
      updateDoc(draftDoc(ctx, BBB.store, 'draft-no-settlement'), { type: 'Retrait' })
    )

    // Mutation du montant sur le même draft → doit rester autorisée.
    await assertSucceeds(
      updateDoc(draftDoc(ctx, BBB.store, 'draft-no-settlement'), { montant: 5000 })
    )
  })

  // ---------------------------------------------------------------------------
  // [FREEZE-04] CLOISONNEMENT — un membre d'une autre boutique ne peut pas muter
  //   le draft d'une boutique voisine, même sans champs de règlement.
  //   Ce test documente que le cloisonnement par boutique reste effectif
  //   (isStoreMember est la première barrière, indépendante du trou C1/E1).
  // ---------------------------------------------------------------------------

  it('[FREEZE-04] membre BBB ne peut pas muter type d\'un draft de AAA (cloisonnement boutiques)', async () => {
    // Arrange : BBB seed son propre profil, le draft appartient à AAA
    await seedMember(BBB.uid, BBB.store)
    await seedDocument(
      testEnv,
      `clients/${AAA.store}/drafts`,
      'draft-aaa-cross',
      serverPartialDraft(AAA.store),
    )

    const ctx = getAuthenticatedContext(testEnv, BBB.uid)

    // L'accès inter-boutiques est bloqué par isStoreMember(storeId) — pas de relation
    // avec les trous C1/E1 qui ne concernent que les membres LÉGITIMES de la boutique.
    await assertFails(
      updateDoc(draftDoc(ctx, AAA.store, 'draft-aaa-cross'), { type: 'Dépôt' })
    )
  })

  // ---------------------------------------------------------------------------
  // [FREEZE-05] VÉRIFICATION QUE LES 8 CHAMPS DE RÈGLEMENT RESTENT VERROUILLÉS
  //   (régression : le correctif de C1/E1 ne doit pas casser le verrou existant)
  //   Ce test doit rester assertFails avant ET après le correctif.
  // ---------------------------------------------------------------------------

  it('[FREEZE-05] mutation de remainingAmount sur draft partial → toujours refusée (verrou existant intact)', async () => {
    // Arrange
    await seedMember(AAA.uid, AAA.store)
    await seedDocument(
      testEnv,
      `clients/${AAA.store}/drafts`,
      'draft-remaining-lock',
      serverPartialDraft(AAA.store),
    )

    const ctx = getAuthenticatedContext(testEnv, AAA.uid)

    // Le verrou draftSettlementFieldsUnchanged couvre remainingAmount.
    // Ce test garantit que le correctif de C1/E1 n'affaiblit pas ce verrou.
    await assertFails(
      updateDoc(draftDoc(ctx, AAA.store, 'draft-remaining-lock'), { remainingAmount: 9999999 })
    )
  })

  // ---------------------------------------------------------------------------
  // [FREEZE-06] MUTATION COMBINÉE type + champ de règlement → refusée
  //   Si un attaquant tente de changer type ET paidAmount en même temps,
  //   le verrou existant sur paidAmount doit bloquer l'opération entière.
  //   Note : ce test passe DÉJÀ avec les règles actuelles car paidAmount est verrouillé.
  //   Il sert à documenter que le scénario C1 exploite la mutation SÉPARÉE de type.
  // ---------------------------------------------------------------------------

  it('[FREEZE-06] mutation combinée type+paidAmount sur draft partial → refusée (paidAmount verrouillé bloque tout)', async () => {
    // Arrange
    await seedMember(AAA.uid, AAA.store)
    await seedDocument(
      testEnv,
      `clients/${AAA.store}/drafts`,
      'draft-combo-attack',
      serverPartialDraft(AAA.store),
    )

    const ctx = getAuthenticatedContext(testEnv, AAA.uid)

    // La mutation de paidAmount est bloquée par draftSettlementFieldsUnchanged,
    // ce qui empêche l'attaque combinée. C1 exploite la mutation de type SEULE.
    await assertFails(
      updateDoc(draftDoc(ctx, AAA.store, 'draft-combo-attack'), { type: 'Dépôt', paidAmount: 0 })
    )
  })

  // ---------------------------------------------------------------------------
  // [FREEZE-07] VERROU clientId — réattribution du titulaire sur draft partial
  //   Intégrité de la piste d'audit : une fois un règlement engagé, le clientId
  //   du draft est copié dans chaque settlement + le document history final. Le
  //   changer entre deux tranches réattribuerait le règlement à un autre client.
  //   draftCoreFieldsFrozenIfSettling fige donc aussi clientId.
  // ---------------------------------------------------------------------------

  it('[FREEZE-07] verrou clientId — réattribution sur draft partial → refusée', async () => {
    await seedMember(AAA.uid, AAA.store)
    await seedDocument(
      testEnv,
      `clients/${AAA.store}/drafts`,
      'draft-clientid-freeze',
      serverPartialDraft(AAA.store),
    )

    const ctx = getAuthenticatedContext(testEnv, AAA.uid)

    await assertFails(
      updateDoc(draftDoc(ctx, AAA.store, 'draft-clientid-freeze'), { clientId: 'client-autre-999' })
    )
  })

  // ---------------------------------------------------------------------------
  // [FREEZE-08] COMPORTEMENT LÉGITIME — correction du client sur draft NON réglé
  //   Avant tout règlement, le caissier peut corriger le titulaire d'un brouillon.
  //   Doit rester assertSucceeds.
  // ---------------------------------------------------------------------------

  it('[FREEZE-08] correction clientId sur draft NON réglé → toujours autorisée', async () => {
    await seedMember(BBB.uid, BBB.store)
    await seedDocument(
      testEnv,
      `clients/${BBB.store}/drafts`,
      'draft-clientid-free',
      draftPayload(BBB.store),
    )

    const ctx = getAuthenticatedContext(testEnv, BBB.uid)

    await assertSucceeds(
      updateDoc(draftDoc(ctx, BBB.store, 'draft-clientid-free'), { clientId: 'client-corrige-002' })
    )
  })
})
