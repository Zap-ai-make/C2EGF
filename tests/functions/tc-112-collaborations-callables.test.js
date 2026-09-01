/**
 * TC-112 — Collaborations inter-boutiques (create / confirm / reject / providers).
 *   Handler integration avec Firestore Emulator, { db, FieldValue } injectés.
 *
 * Comportement protégé :
 *   create   : document `pending`, AUCUN solde ne bouge, AUCUNE dette. Noms client
 *              et boutiques dénormalisés depuis la lecture SERVEUR.
 *   confirm  : seule la fournisseuse ; stock fournisseur −montant (dépôt) /
 *              (dépôt) ou la LIQUIDITÉ (retrait) ; dette toujours de la
 *              demandeuse vers la fournisseuse ; terminal.
 *   reject   : seule la fournisseuse ; motif 3–500 ; aucun mouvement, aucune dette.
 *   providers: annuaire = boutiques ACTIVES sauf soi (le SDK Admin contourne les
 *              règles qui interdisent de lire la fiche d'une autre boutique).
 *
 * Exécution : npm run test:functions (émulateur Firestore, projet demo-akayis-test).
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { createStoreCollaborationHandler } from '../../functions/src/collaborations/createStoreCollaboration.js'
import { confirmStoreCollaborationHandler } from '../../functions/src/collaborations/confirmStoreCollaboration.js'
import { rejectStoreCollaborationHandler } from '../../functions/src/collaborations/rejectStoreCollaboration.js'
import { listStoreCollaborationProvidersHandler } from '../../functions/src/collaborations/listStoreCollaborationProviders.js'

let adminApp
let db

const PROJECT_ID = process.env.GCLOUD_PROJECT
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST

beforeAll(() => {
  if (!FIRESTORE_HOST) throw new Error('SÉCURITÉ : FIRESTORE_EMULATOR_HOST non défini. Lancer via : npm run test:functions')
  if (!PROJECT_ID) throw new Error('SÉCURITÉ : GCLOUD_PROJECT non défini. Lancer via : npm run test:functions')
  if (PROJECT_ID !== 'demo-akayis-test') throw new Error(`SÉCURITÉ : projectId doit être "demo-akayis-test". Reçu : "${PROJECT_ID}"`)
  adminApp = getApps().length === 0 ? initializeApp({ projectId: PROJECT_ID }) : getApps()[0]
  db = getFirestore(adminApp)
})

afterAll(async () => { if (adminApp) await deleteApp(adminApp) })

async function clearFirestoreEmulator() {
  const url = `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`
  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Impossible de vider l'émulateur : HTTP ${res.status}`)
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
const ADMIN_A = 'store-admin-a-uid'   // boutique A — DEMANDEUSE
const ADMIN_B = 'store-admin-b-uid'   // boutique B — FOURNISSEUSE
const ADMIN_C = 'store-admin-c-uid'   // boutique C — tiers
const STORE_A = 'store-A'
const STORE_B = 'store-B'
const STORE_C = 'store-C'
const CLIENT_ID = 'client-001'

const deps = () => ({ db, FieldValue, storeNetworks: ['Orange'], collaborationsEnabled: true })
const makeRequest = (uid, data) => ({ auth: uid ? { uid, token: {} } : null, data: data ?? {} })
const expectError = (promise, code) => expect(promise).rejects.toMatchObject({ code })

async function seedBase({ stockB = 50000 } = {}) {
  await db.doc(`stores/${STORE_A}`).set({ name: 'Boutique A', active: true, adminUid: ADMIN_A })
  await db.doc(`stores/${STORE_B}`).set({ name: 'Boutique B', active: true, adminUid: ADMIN_B })
  await db.doc(`stores/${STORE_C}`).set({ name: 'Boutique C', active: true, adminUid: ADMIN_C })

  await db.doc(`users/${ADMIN_A}`).set({ role: 'store_admin', active: true, storeId: STORE_A, email: 'a@t.test', name: 'Admin A' })
  await db.doc(`users/${ADMIN_B}`).set({ role: 'store_admin', active: true, storeId: STORE_B, email: 'b@t.test', name: 'Admin B' })
  await db.doc(`users/${ADMIN_C}`).set({ role: 'store_admin', active: true, storeId: STORE_C, email: 'c@t.test', name: 'Admin C' })

  await db.doc(`globalClients/${CLIENT_ID}`).set({ nom: 'Ouedraogo', prenom: 'Awa', registeredStoreId: STORE_A })

  await db.doc(`clients/${STORE_B}/networkBalances/current`).set({
    balances: { Orange: { stock: stockB, liquidite: 30000 } },
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  })
  await db.doc(`clients/${STORE_A}/networkBalances/current`).set({
    balances: { Orange: { stock: 1000, liquidite: 80000 } },
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  })
}

const validPayload = (overrides = {}) => ({
  clientId: CLIENT_ID,
  operationType: 'deposit',
  amount: 20000,
  supplierStoreId: STORE_B,
  ...overrides,
})

async function createAs(uid = ADMIN_A, overrides = {}) {
  const res = await createStoreCollaborationHandler(makeRequest(uid, validPayload(overrides)), deps())
  return res.collaborationId
}

const stockOf = async (storeId) =>
  (await db.doc(`clients/${storeId}/networkBalances/current`).get()).data().balances.Orange.stock

const liquiditeOf = async (storeId) =>
  (await db.doc(`clients/${storeId}/networkBalances/current`).get()).data().balances.Orange.liquidite

const auditActions = async (storeId) =>
  (await db.collection(`clients/${storeId}/auditLogs`).get()).docs.map((d) => d.data().action)

beforeEach(async () => {
  await clearFirestoreEmulator()
  await seedBase()
})

// ═════════════════════════════════════════════════════════════════════════════

describe('TC-112-CR — createStoreCollaboration', () => {
  it('[CR-01] crée un document pending sans bouger le moindre solde', async () => {
    const stockBefore = await stockOf(STORE_B)
    const id = await createAs()

    const collab = (await db.doc(`storeCollaborations/${id}`).get()).data()
    expect(collab.status).toBe('pending')
    expect(collab.requestingStoreId).toBe(STORE_A)
    expect(collab.supplierStoreId).toBe(STORE_B)
    expect(collab.amount).toBe(20000)
    expect(collab.debtId).toBeNull()
    expect(collab.previousSupplierBalance).toBeNull()
    expect(collab.newSupplierBalance).toBeNull()

    expect(await stockOf(STORE_B)).toBe(stockBefore)
    expect((await db.collection('internalDebts').get()).size).toBe(0)
  })

  it('[CR-02] le réseau est résolu par le serveur, pas envoyé par le client', async () => {
    const id = await createAs()
    expect((await db.doc(`storeCollaborations/${id}`).get()).data().network).toBe('Orange')
  })

  it('[CR-03] un `network` dans le payload est REFUSÉ (hors liste blanche)', async () => {
    await expectError(
      createStoreCollaborationHandler(makeRequest(ADMIN_A, validPayload({ network: 'Orange' })), deps()),
      'INVALID_REQUEST_ID',
    )
  })

  it('[CR-04] un storeId forgé dans le payload est refusé', async () => {
    await expectError(
      createStoreCollaborationHandler(makeRequest(ADMIN_A, validPayload({ requestingStoreId: STORE_C })), deps()),
      'INVALID_REQUEST_ID',
    )
  })

  it('[CR-05] noms client et boutiques dénormalisés depuis la lecture SERVEUR', async () => {
    const collab = (await db.doc(`storeCollaborations/${await createAs()}`).get()).data()
    expect(collab.clientNom).toBe('Ouedraogo')
    expect(collab.clientPrenom).toBe('Awa')
    expect(collab.requestingStoreName).toBe('Boutique A')
    expect(collab.supplierStoreName).toBe('Boutique B')
  })

  it('[CR-06] se solliciter soi-même est refusé', async () => {
    await expectError(
      createStoreCollaborationHandler(makeRequest(ADMIN_A, validPayload({ supplierStoreId: STORE_A })), deps()),
      'SAME_STORE_COLLABORATION',
    )
  })

  it('[CR-07] fournisseuse inexistante → refus', async () => {
    await expectError(
      createStoreCollaborationHandler(makeRequest(ADMIN_A, validPayload({ supplierStoreId: 'store-ZZZ' })), deps()),
      'SUPPLIER_STORE_NOT_FOUND',
    )
  })

  it('[CR-08] fournisseuse inactive → refus', async () => {
    await db.doc(`stores/${STORE_B}`).set({ name: 'Boutique B', active: false, adminUid: ADMIN_B })
    await expectError(
      createStoreCollaborationHandler(makeRequest(ADMIN_A, validPayload()), deps()),
      'SUPPLIER_STORE_INACTIVE',
    )
  })

  it('[CR-09] client inconnu → refus', async () => {
    await expectError(
      createStoreCollaborationHandler(makeRequest(ADMIN_A, validPayload({ clientId: 'client-inconnu' })), deps()),
      'CLIENT_NOT_FOUND',
    )
  })

  it('[CR-10] montant invalide → refus', async () => {
    for (const amount of [0, -5, 12.5, '20000']) {
      await expectError(
        createStoreCollaborationHandler(makeRequest(ADMIN_A, validPayload({ amount })), deps()),
        'INVALID_COLLABORATION_AMOUNT',
      )
    }
  })

  it('[CR-11] type d’opération invalide → refus', async () => {
    await expectError(
      createStoreCollaborationHandler(makeRequest(ADMIN_A, validPayload({ operationType: 'Dépôt' })), deps()),
      'INVALID_OPERATION_TYPE',
    )
  })

  it('[CR-12] non authentifié → refus', async () => {
    await expectError(
      createStoreCollaborationHandler(makeRequest(null, validPayload()), deps()),
      'UNAUTHENTICATED',
    )
  })

  it('[CR-13] compte inactif → refus', async () => {
    await db.doc(`users/${ADMIN_A}`).update({ active: false })
    await expectError(createStoreCollaborationHandler(makeRequest(ADMIN_A, validPayload()), deps()), 'PROFILE_INACTIVE')
  })

  it('[CR-14] module désactivé par profil → refus jusqu’au serveur', async () => {
    await expectError(
      createStoreCollaborationHandler(makeRequest(ADMIN_A, validPayload()), { ...deps(), collaborationsEnabled: false }),
      'COLLABORATIONS_DISABLED',
    )
  })

  it('[CR-15] audit écrit chez la demandeuse', async () => {
    await createAs()
    expect(await auditActions(STORE_A)).toContain('STORE_COLLABORATION_CREATED')
    expect(await auditActions(STORE_B)).toEqual([])
  })
})

// ═════════════════════════════════════════════════════════════════════════════

describe('TC-112-CO — confirmStoreCollaboration : dépôt', () => {
  it('[CO-01] stock fournisseur −montant, dette DEMANDEUSE → FOURNISSEUSE', async () => {
    const id = await createAs()
    const res = await confirmStoreCollaborationHandler(makeRequest(ADMIN_B, { collaborationId: id }), deps())

    expect(await stockOf(STORE_B)).toBe(30000)
    expect(res.previousSupplierBalance).toBe(50000)
    expect(res.newSupplierBalance).toBe(30000)

    const debt = (await db.doc(`internalDebts/${res.debtId}`).get()).data()
    expect(debt.debtorStoreId).toBe(STORE_A)
    expect(debt.creditorStoreId).toBe(STORE_B)
    expect(debt.debtorStoreName).toBe('Boutique A')
    expect(debt.creditorStoreName).toBe('Boutique B')
    expect(debt.originalAmount).toBe(20000)
    expect(debt.remainingAmount).toBe(20000)
    expect(debt.settledAmount).toBe(0)
    expect(debt.status).toBe('open')
    expect(debt.collaborationId).toBe(id)
  })

  it('[CO-02] le stock de la DEMANDEUSE ne bouge jamais, la liquidité non plus', async () => {
    const id = await createAs()
    await confirmStoreCollaborationHandler(makeRequest(ADMIN_B, { collaborationId: id }), deps())
    expect(await stockOf(STORE_A)).toBe(1000)
    expect(await liquiditeOf(STORE_A)).toBe(80000)
    expect(await liquiditeOf(STORE_B)).toBe(30000)
  })

  it('[CO-03] stock insuffisant → refus, RIEN ne bouge, aucune dette', async () => {
    await clearFirestoreEmulator()
    await seedBase({ stockB: 10000 })
    const id = await createAs()

    await expectError(
      confirmStoreCollaborationHandler(makeRequest(ADMIN_B, { collaborationId: id }), deps()),
      'INSUFFICIENT_SUPPLIER_BALANCE',
    )
    expect(await stockOf(STORE_B)).toBe(10000)
    expect((await db.collection('internalDebts').get()).size).toBe(0)
    expect((await db.doc(`storeCollaborations/${id}`).get()).data().status).toBe('pending')
  })

  it('[CO-04] la collaboration devient terminale et garde sa filiation', async () => {
    const id = await createAs()
    const res = await confirmStoreCollaborationHandler(makeRequest(ADMIN_B, { collaborationId: id }), deps())
    const collab = (await db.doc(`storeCollaborations/${id}`).get()).data()
    expect(collab.status).toBe('confirmed')
    expect(collab.debtId).toBe(res.debtId)
    expect(collab.confirmedBy).toBe(ADMIN_B)
    expect(collab.confirmedAt).not.toBeNull()
  })

  it('[CO-05] double confirmation → un SEUL mouvement, une SEULE dette', async () => {
    const id = await createAs()
    await confirmStoreCollaborationHandler(makeRequest(ADMIN_B, { collaborationId: id }), deps())
    await expectError(
      confirmStoreCollaborationHandler(makeRequest(ADMIN_B, { collaborationId: id }), deps()),
      'COLLABORATION_NOT_PENDING',
    )
    expect(await stockOf(STORE_B)).toBe(30000)
    expect((await db.collection('internalDebts').get()).size).toBe(1)
  })

  it('[CO-06] la DEMANDEUSE ne peut pas confirmer sa propre demande', async () => {
    const id = await createAs()
    await expectError(
      confirmStoreCollaborationHandler(makeRequest(ADMIN_A, { collaborationId: id }), deps()),
      'COLLABORATION_STORE_MISMATCH',
    )
    expect(await stockOf(STORE_B)).toBe(50000)
  })

  it('[CO-07] une tierce boutique ne peut pas confirmer', async () => {
    const id = await createAs()
    await expectError(
      confirmStoreCollaborationHandler(makeRequest(ADMIN_C, { collaborationId: id }), deps()),
      'COLLABORATION_STORE_MISMATCH',
    )
  })

  it('[CO-08] collaboration inexistante → refus', async () => {
    await expectError(
      confirmStoreCollaborationHandler(makeRequest(ADMIN_B, { collaborationId: 'nope' }), deps()),
      'COLLABORATION_NOT_FOUND',
    )
  })

  it('[CO-09] boutique désactivée entre la demande et la confirmation → refus', async () => {
    const id = await createAs()
    await db.doc(`stores/${STORE_B}`).update({ active: false })
    await expectError(
      confirmStoreCollaborationHandler(makeRequest(ADMIN_B, { collaborationId: id }), deps()),
      'STORE_INACTIVE',
    )
    expect(await stockOf(STORE_B)).toBe(50000)
  })

  it('[CO-10] audit avec ancien ET nouveau solde, chez la fournisseuse', async () => {
    const id = await createAs()
    await confirmStoreCollaborationHandler(makeRequest(ADMIN_B, { collaborationId: id }), deps())
    const logs = (await db.collection(`clients/${STORE_B}/auditLogs`).get()).docs.map((d) => d.data())
    const entry = logs.find((l) => l.action === 'STORE_COLLABORATION_CONFIRMED')
    expect(entry).toBeDefined()
    expect(entry.previousBalance).toBe(50000)
    expect(entry.newBalance).toBe(30000)
    expect(entry.actorStoreId).toBe(STORE_B)
    expect(entry.requestingStoreId).toBe(STORE_A)
  })

  it('[CO-11] solde absent chez la fournisseuse → traité comme 0, donc insuffisant', async () => {
    await db.doc(`clients/${STORE_B}/networkBalances/current`).delete()
    const id = await createAs()
    await expectError(
      confirmStoreCollaborationHandler(makeRequest(ADMIN_B, { collaborationId: id }), deps()),
      'INSUFFICIENT_SUPPLIER_BALANCE',
    )
  })

  it('[CO-12] solde corrompu → refus, jamais de réparation silencieuse', async () => {
    await db.doc(`clients/${STORE_B}/networkBalances/current`).set({ balances: { Orange: { stock: -50 } } })
    const id = await createAs()
    await expectError(
      confirmStoreCollaborationHandler(makeRequest(ADMIN_B, { collaborationId: id }), deps()),
      'INVALID_BALANCE_DATA',
    )
  })
})

describe('TC-112-CO — confirmStoreCollaboration : retrait (l’autre ressource)', () => {
  it('[CO-20] LIQUIDITÉ fournisseur −montant, dette DEMANDEUSE → FOURNISSEUSE', async () => {
    // ⚠ RENVERSEMENT DE RÈGLE. Avant, un retrait faisait MONTER le stock de la
    //   fournisseuse et la dette pointait vers la demandeuse. La fournisseuse
    //   avance désormais le CASH remis au client : elle cède, donc on lui doit.
    const id = await createAs(ADMIN_A, { operationType: 'withdrawal', amount: 15000 })
    const res = await confirmStoreCollaborationHandler(makeRequest(ADMIN_B, { collaborationId: id }), deps())

    expect(await liquiditeOf(STORE_B)).toBe(15000)   // 30 000 − 15 000
    expect(await stockOf(STORE_B)).toBe(50000)       // le stock ne bouge PAS
    expect(res.resourceField).toBe('liquidite')

    const debt = (await db.doc(`internalDebts/${res.debtId}`).get()).data()
    expect(debt.debtorStoreId).toBe(STORE_A)
    expect(debt.creditorStoreId).toBe(STORE_B)
    expect(debt.debtorStoreName).toBe('Boutique A')
    expect(debt.creditorStoreName).toBe('Boutique B')
    expect(debt.originalAmount).toBe(15000)
    expect(debt.resourceField).toBe('liquidite')
  })

  it('[CO-21] un retrait SUBIT désormais le contrôle de suffisance', async () => {
    // Le cas qui rendait 15 000 sans le moindre contrôle sous l’ancienne règle.
    const id = await createAs(ADMIN_A, { operationType: 'withdrawal', amount: 40000 })
    await expectError(
      confirmStoreCollaborationHandler(makeRequest(ADMIN_B, { collaborationId: id }), deps()),
      'INSUFFICIENT_SUPPLIER_LIQUIDITY',
    )
    expect(await liquiditeOf(STORE_B)).toBe(30000)
    expect((await db.collection('internalDebts').get()).size).toBe(0)
    expect((await db.doc(`storeCollaborations/${id}`).get()).data().status).toBe('pending')
  })
})

describe('TC-112-HI — la trace laissée chez la demandeuse', () => {
  const historyOf = async (storeId) =>
    (await db.collection(`clients/${storeId}/history`).get()).docs.map((d) => d.data())

  it('[HI-01] la collaboration confirmée écrit l’opération du client chez la DEMANDEUSE', async () => {
    // Le client s’est présenté chez elle : c’est là qu’il ira chercher sa preuve.
    const id = await createAs()
    const res = await confirmStoreCollaborationHandler(makeRequest(ADMIN_B, { collaborationId: id }), deps())

    const lignes = await historyOf(STORE_A)
    expect(lignes).toHaveLength(1)
    expect(lignes[0].type).toBe('Dépôt')
    expect(lignes[0].montant).toBe(20000)
    expect(lignes[0].collaborationId).toBe(id)
    expect(lignes[0].supplierStoreId).toBe(STORE_B)
    expect(res.historyId).toBeTruthy()
  })

  it('[HI-02] la trace est TERMINALE — sinon elle fausserait l’argent dehors', async () => {
    // `argentDehors` ne somme que les non terminées. Une trace « en attente »
    // ferait croire à une jambe manquante qui n’existe pas : la contrepartie
    // de la demandeuse est portée par la dette, pas par un reste à encaisser.
    const id = await createAs()
    await confirmStoreCollaborationHandler(makeRequest(ADMIN_B, { collaborationId: id }), deps())
    expect((await historyOf(STORE_A))[0].statut).toBe('Validée')
  })

  it('[HI-03] la trace ne déplace AUCUN solde chez la demandeuse', async () => {
    const id = await createAs()
    await confirmStoreCollaborationHandler(makeRequest(ADMIN_B, { collaborationId: id }), deps())
    expect(await stockOf(STORE_A)).toBe(1000)
    expect(await liquiditeOf(STORE_A)).toBe(80000)
  })

  it('[HI-04] la fournisseuse n’écrit rien dans SON historique', async () => {
    // L’opération n’est pas la sienne : elle a prêté une ressource, pas servi
    // un client. Une ligne chez elle la compterait deux fois dans le réseau.
    const id = await createAs()
    await confirmStoreCollaborationHandler(makeRequest(ADMIN_B, { collaborationId: id }), deps())
    expect(await historyOf(STORE_B)).toEqual([])
  })

  it('[HI-05] une demande refusée ne laisse aucune trace', async () => {
    const id = await createAs()
    await rejectStoreCollaborationHandler(
      makeRequest(ADMIN_B, { collaborationId: id, rejectionReason: 'Pas de stock ce matin.' }), deps(),
    )
    expect(await historyOf(STORE_A)).toEqual([])
  })
})

// ═════════════════════════════════════════════════════════════════════════════

describe('TC-112-RJ — rejectStoreCollaboration', () => {
  it('[RJ-01] passe rejected, sans mouvement ni dette', async () => {
    const id = await createAs()
    await rejectStoreCollaborationHandler(
      makeRequest(ADMIN_B, { collaborationId: id, rejectionReason: 'Stock épuisé ce matin' }), deps(),
    )
    const collab = (await db.doc(`storeCollaborations/${id}`).get()).data()
    expect(collab.status).toBe('rejected')
    expect(collab.rejectionReason).toBe('Stock épuisé ce matin')
    expect(collab.rejectedBy).toBe(ADMIN_B)
    expect(collab.debtId).toBeNull()

    expect(await stockOf(STORE_B)).toBe(50000)
    expect((await db.collection('internalDebts').get()).size).toBe(0)
  })

  it('[RJ-02] motif trop court → refus', async () => {
    const id = await createAs()
    await expectError(
      rejectStoreCollaborationHandler(makeRequest(ADMIN_B, { collaborationId: id, rejectionReason: 'ok' }), deps()),
      'INVALID_REJECTION_REASON',
    )
    expect((await db.doc(`storeCollaborations/${id}`).get()).data().status).toBe('pending')
  })

  it('[RJ-03] motif trop long → refus', async () => {
    const id = await createAs()
    await expectError(
      rejectStoreCollaborationHandler(makeRequest(ADMIN_B, { collaborationId: id, rejectionReason: 'x'.repeat(501) }), deps()),
      'INVALID_REJECTION_REASON',
    )
  })

  it('[RJ-04] la demandeuse ne rejette pas sa propre demande', async () => {
    const id = await createAs()
    await expectError(
      rejectStoreCollaborationHandler(makeRequest(ADMIN_A, { collaborationId: id, rejectionReason: 'Annulation' }), deps()),
      'COLLABORATION_STORE_MISMATCH',
    )
  })

  it('[RJ-05] une collaboration confirmée ne se rejette plus', async () => {
    const id = await createAs()
    await confirmStoreCollaborationHandler(makeRequest(ADMIN_B, { collaborationId: id }), deps())
    await expectError(
      rejectStoreCollaborationHandler(makeRequest(ADMIN_B, { collaborationId: id, rejectionReason: 'Trop tard' }), deps()),
      'COLLABORATION_NOT_PENDING',
    )
  })

  it('[RJ-06] audit avec le motif', async () => {
    const id = await createAs()
    await rejectStoreCollaborationHandler(
      makeRequest(ADMIN_B, { collaborationId: id, rejectionReason: 'Stock épuisé ce matin' }), deps(),
    )
    const logs = (await db.collection(`clients/${STORE_B}/auditLogs`).get()).docs.map((d) => d.data())
    const entry = logs.find((l) => l.action === 'STORE_COLLABORATION_REJECTED')
    expect(entry.rejectionReason).toBe('Stock épuisé ce matin')
  })
})

// ═════════════════════════════════════════════════════════════════════════════

describe('TC-112-PR — listStoreCollaborationProviders', () => {
  it('[PR-01] retourne les boutiques actives, la sienne exclue', async () => {
    const res = await listStoreCollaborationProvidersHandler(makeRequest(ADMIN_A, {}), deps())
    expect(res.providers.map((p) => p.storeId).sort()).toEqual([STORE_B, STORE_C])
    expect(res.providers.find((p) => p.storeId === STORE_B).storeName).toBe('Boutique B')
  })

  it('[PR-02] une boutique inactive n’apparaît pas', async () => {
    await db.doc(`stores/${STORE_C}`).update({ active: false })
    const res = await listStoreCollaborationProvidersHandler(makeRequest(ADMIN_A, {}), deps())
    expect(res.providers.map((p) => p.storeId)).toEqual([STORE_B])
  })

  it('[PR-03] le point de vue change avec l’acteur', async () => {
    const res = await listStoreCollaborationProvidersHandler(makeRequest(ADMIN_B, {}), deps())
    expect(res.providers.map((p) => p.storeId).sort()).toEqual([STORE_A, STORE_C])
  })

  it('[PR-04] annuaire vide quand aucune consœur active', async () => {
    await db.doc(`stores/${STORE_B}`).update({ active: false })
    await db.doc(`stores/${STORE_C}`).update({ active: false })
    const res = await listStoreCollaborationProvidersHandler(makeRequest(ADMIN_A, {}), deps())
    expect(res.providers).toEqual([])
  })

  it('[PR-05] un réseau inconnu est refusé, pas ignoré', async () => {
    await expectError(
      listStoreCollaborationProvidersHandler(makeRequest(ADMIN_A, { network: 'Moov' }), deps()),
      'INVALID_COLLABORATION_NETWORK',
    )
  })

  it('[PR-06] non authentifié → refus', async () => {
    await expectError(listStoreCollaborationProvidersHandler(makeRequest(null, {}), deps()), 'UNAUTHENTICATED')
  })

  it('[PR-07] rôle non boutique → refus', async () => {
    await db.doc('users/dealer-uid').set({ role: 'dealer', active: true, email: 'd@t.test', name: 'Dealer' })
    await expectError(
      listStoreCollaborationProvidersHandler(makeRequest('dealer-uid', {}), deps()),
      'ROLE_FORBIDDEN',
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════

describe('TC-112-NR — non-régression : ce module ne touche que la FOURNISSEUSE', () => {
  it('[NR-01] un cycle complet ne bouge QUE les soldes de la fournisseuse', async () => {
    const depot = await createAs()
    await confirmStoreCollaborationHandler(makeRequest(ADMIN_B, { collaborationId: depot }), deps())
    const retrait = await createAs(ADMIN_A, { operationType: 'withdrawal', amount: 5000 })
    await confirmStoreCollaborationHandler(makeRequest(ADMIN_B, { collaborationId: retrait }), deps())

    // La demandeuse est INTACTE des deux côtés : sa contrepartie est la dette.
    expect(await liquiditeOf(STORE_A)).toBe(80000)
    expect(await stockOf(STORE_A)).toBe(1000)

    // La fournisseuse cède sur les deux champs, chacun selon son opération.
    expect(await stockOf(STORE_B)).toBe(30000)      // 50 000 − 20 000 (dépôt)
    expect(await liquiditeOf(STORE_B)).toBe(25000)  // 30 000 − 5 000 (retrait)
  })

  it('[NR-01 bis] les deux dettes vont dans le MÊME sens', async () => {
    // C’est l’invariant que le gérant énonce : quand on demande, on doit.
    const depot = await createAs()
    const d1 = await confirmStoreCollaborationHandler(makeRequest(ADMIN_B, { collaborationId: depot }), deps())
    const retrait = await createAs(ADMIN_A, { operationType: 'withdrawal', amount: 5000 })
    const d2 = await confirmStoreCollaborationHandler(makeRequest(ADMIN_B, { collaborationId: retrait }), deps())

    for (const debtId of [d1.debtId, d2.debtId]) {
      const debt = (await db.doc(`internalDebts/${debtId}`).get()).data()
      expect(debt.debtorStoreId).toBe(STORE_A)
      expect(debt.creditorStoreId).toBe(STORE_B)
    }
  })

  it('[NR-02] les autres réseaux ne sont jamais écrasés par le merge', async () => {
    await db.doc(`clients/${STORE_B}/networkBalances/current`).set({
      balances: { Orange: { stock: 50000, liquidite: 30000 }, Moov: { stock: 7777, liquidite: 8888 } },
    })
    const id = await createAs()
    await confirmStoreCollaborationHandler(makeRequest(ADMIN_B, { collaborationId: id }), deps())

    const balances = (await db.doc(`clients/${STORE_B}/networkBalances/current`).get()).data().balances
    expect(balances.Orange.stock).toBe(30000)
    expect(balances.Orange.liquidite).toBe(30000)
    expect(balances.Moov).toEqual({ stock: 7777, liquidite: 8888 })
  })
})
