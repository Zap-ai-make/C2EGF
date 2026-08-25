/**
 * TC-044 — Handler integration des clôtures Dealer avec Firestore Emulator.
 *
 * Stratégie :
 *   - Les handlers sont appelés directement avec { db, FieldValue } injectés.
 *   - Admin SDK initialisé sur l'émulateur Firestore.
 *   - Fixtures insérées via Admin SDK (bypass rules).
 *   - Émulateur vidé entre chaque test via l'API REST.
 *
 * Projet exclusif : demo-akayis-test — aucun accès Firebase production.
 *
 * Sections :
 *   §CC  — createDealerClosureHandler  (création, validation, idempotence)
 *   §CF  — confirmDealerClosureHandler (confirmation)
 *   §RJ  — rejectDealerClosureHandler  (rejet)
 *   §CON — concurrence réelle          (Promise.allSettled)
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { DealerRequestError } from '../../functions/src/errors.js'
import { createDealerClosureHandler }  from '../../functions/src/closures/createDealerClosure.js'
import { confirmDealerClosureHandler } from '../../functions/src/closures/confirmDealerClosure.js'
import { rejectDealerClosureHandler }  from '../../functions/src/closures/rejectDealerClosure.js'

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

let adminApp
let db

const PROJECT_ID     = process.env.GCLOUD_PROJECT
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST

beforeAll(() => {
  if (!FIRESTORE_HOST) throw new Error('SÉCURITÉ : FIRESTORE_EMULATOR_HOST non défini. Lancer via npm run test:functions')
  if (!PROJECT_ID)     throw new Error('SÉCURITÉ : GCLOUD_PROJECT non défini.')
  if (!PROJECT_ID.startsWith('demo-')) throw new Error(`SÉCURITÉ : projectId non-demo : "${PROJECT_ID}"`)
  if (PROJECT_ID !== 'demo-akayis-test') throw new Error(`SÉCURITÉ : projectId doit être "demo-akayis-test". Reçu : "${PROJECT_ID}"`)
  if (['taofic-ajagbe', 'c2egf-b0b5a'].includes(PROJECT_ID))    throw new Error('SÉCURITÉ : projectId de production interdit.')

  if (getApps().length === 0) adminApp = initializeApp({ projectId: PROJECT_ID })
  else adminApp = getApps()[0]
  db = getFirestore(adminApp)
})

afterAll(async () => { if (adminApp) await deleteApp(adminApp) })

async function clearFirestoreEmulator() {
  const url = `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`
  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Impossible de vider l'émulateur : HTTP ${res.status}`)
}

beforeEach(async () => { await clearFirestoreEmulator() })

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const DEALER_UID       = 'dealer-uid-044'
const DEALER_B_UID     = 'dealer-b-uid-044'
const STORE_ADMIN_UID  = 'store-admin-uid-044'
const OTHER_ADMIN_UID  = 'other-admin-uid-044'
const STORE_A          = 'store-044-A'
const STORE_B          = 'store-044-B'
const BUSINESS_DATE    = '2024-06-15'

const DEALER_PROFILE = {
  role: 'dealer', active: true,
  email: 'dealer@test.044', name: 'Dealer 044',
}
const DEALER_B_PROFILE = {
  role: 'dealer', active: true,
  email: 'dealer-b@test.044', name: 'Dealer B 044',
}
const INACTIVE_DEALER_PROFILE = {
  role: 'dealer', active: false,
  email: 'inactive@test.044', name: 'Inactive 044',
}
const STORE_ADMIN_PROFILE = {
  role: 'store_admin', active: true, storeId: STORE_A,
  email: 'admin@test.044', name: 'Admin 044',
}
const OTHER_ADMIN_PROFILE = {
  role: 'store_admin', active: true, storeId: STORE_B,
  email: 'other-admin@test.044', name: 'Other Admin 044',
}
const STORE_A_DOC = { name: 'Boutique 044-A', active: true, adminUid: STORE_ADMIN_UID }
const STORE_B_DOC = { name: 'Boutique 044-B', active: true, adminUid: OTHER_ADMIN_UID }
const BALANCE_DOC = {
  balances: {
    Orange: { stock: 40000, liquidite: 20000 },
  },
  updatedAt: new Date('2024-01-01'),
}

async function seedDealer(uid = DEALER_UID, profile = DEALER_PROFILE) {
  await db.doc(`users/${uid}`).set(profile)
}
async function seedStoreAdmin(uid = STORE_ADMIN_UID, profile = STORE_ADMIN_PROFILE) {
  await db.doc(`users/${uid}`).set(profile)
}
async function seedStore(storeId = STORE_A, data = STORE_A_DOC) {
  await db.doc(`stores/${storeId}`).set(data)
}
async function seedBalance(storeId = STORE_A, data = BALANCE_DOC) {
  await db.doc(`clients/${storeId}/networkBalances/current`).set(data)
}
function makeRequest(uid, data) {
  return { auth: uid ? { uid } : null, data: data ?? {} }
}

// Payload valide par défaut — écarts nuls, pas de motif
function baseCreatePayload(overrides = {}) {
  return {
    targetStoreId:            STORE_A,
    businessDate:             BUSINESS_DATE,
    declaredStockBalance:     40000, // = recorded → écart nul
    declaredLiquidityBalance: 20000, // = recorded → écart nul
    reason:                   '',
    network:                  'Orange',
    ...overrides,
  }
}

// Identifiant déterministe correspondant au payload par défaut
function defaultClosureId(dealerUid = DEALER_UID) {
  return `${dealerUid}_${STORE_A}_Orange_${BUSINESS_DATE}`
}

// ─────────────────────────────────────────────────────────────────────────────
// §CC — createDealerClosureHandler
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-044-CC — createDealerClosureHandler', () => {

  it('[CC-01] succès : écarts nuls, sans motif → closure créée, audit créé', async () => {
    await seedDealer()
    await seedStore()
    await seedBalance()

    const result = await createDealerClosureHandler(
      makeRequest(DEALER_UID, baseCreatePayload()),
      { db, FieldValue }
    )

    expect(result.success).toBe(true)
    expect(result.idempotent).toBe(false)
    expect(result.stockDifference).toBe(0)
    expect(result.liquidityDifference).toBe(0)
    expect(result.closureId).toBe(defaultClosureId())

    const snap = await db.doc(`dealerClosures/${result.closureId}`).get()
    expect(snap.exists).toBe(true)
    const data = snap.data()
    expect(data.status).toBe('pending')
    expect(data.dealerUid).toBe(DEALER_UID)
    expect(data.targetStoreId).toBe(STORE_A)
    expect(data.recordedStockBalance).toBe(40000)
    expect(data.recordedLiquidityBalance).toBe(20000)
    expect(data.stockDifference).toBe(0)
    expect(data.liquidityDifference).toBe(0)
    expect(data.reason).toBeNull()
    expect(data.confirmedBy).toBeNull()
    expect(data.rejectedBy).toBeNull()

    // Audit créé
    const audit = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(audit.size).toBe(1)
    expect(audit.docs[0].data().action).toBe('DEALER_CLOSURE_CREATED')
    expect(audit.docs[0].data().closureId).toBe(result.closureId)
  })

  it('[CC-02] succès : écart stock avec motif valide', async () => {
    await seedDealer()
    await seedStore()
    await seedBalance()

    const result = await createDealerClosureHandler(
      makeRequest(DEALER_UID, baseCreatePayload({ declaredStockBalance: 35000, reason: 'Erreur de caisse.' })),
      { db, FieldValue }
    )

    expect(result.stockDifference).toBe(-5000)
    const snap = await db.doc(`dealerClosures/${result.closureId}`).get()
    expect(snap.data().reason).toBe('Erreur de caisse.')
    expect(snap.data().stockDifference).toBe(-5000)
  })

  it('[CC-03] écart non nul sans motif → REASON_REQUIRED', async () => {
    await seedDealer()
    await seedStore()
    await seedBalance()

    await expect(
      createDealerClosureHandler(
        makeRequest(DEALER_UID, baseCreatePayload({ declaredStockBalance: 35000, reason: '' })),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'REASON_REQUIRED' })
  })

  it('[CC-04] montant négatif → INVALID_CLOSURE_DATA', async () => {
    await seedDealer()
    await seedStore()
    await seedBalance()

    await expect(
      createDealerClosureHandler(
        makeRequest(DEALER_UID, baseCreatePayload({ declaredStockBalance: -100 })),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'INVALID_CLOSURE_DATA' })
  })

  it('[CC-05] montant décimal → INVALID_CLOSURE_DATA', async () => {
    await seedDealer()
    await seedStore()
    await seedBalance()

    await expect(
      createDealerClosureHandler(
        makeRequest(DEALER_UID, baseCreatePayload({ declaredStockBalance: 100.5 })),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'INVALID_CLOSURE_DATA' })
  })

  it('[CC-06] montant string → INVALID_CLOSURE_DATA', async () => {
    await seedDealer()
    await seedStore()
    await seedBalance()

    await expect(
      createDealerClosureHandler(
        makeRequest(DEALER_UID, baseCreatePayload({ declaredStockBalance: '40000' })),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'INVALID_CLOSURE_DATA' })
  })

  it('[CC-07] date future → INVALID_CLOSURE_DATA', async () => {
    await seedDealer()
    await seedStore()
    await seedBalance()

    await expect(
      createDealerClosureHandler(
        makeRequest(DEALER_UID, baseCreatePayload({ businessDate: '2099-12-31' })),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'INVALID_CLOSURE_DATA' })
  })

  it('[CC-08] boutique inexistante → STORE_NOT_FOUND', async () => {
    await seedDealer()
    // pas de seedStore()

    await expect(
      createDealerClosureHandler(
        makeRequest(DEALER_UID, baseCreatePayload()),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'STORE_NOT_FOUND' })
  })

  it('[CC-09] boutique inactive → STORE_INACTIVE', async () => {
    await seedDealer()
    await seedStore(STORE_A, { ...STORE_A_DOC, active: false })
    await seedBalance()

    await expect(
      createDealerClosureHandler(
        makeRequest(DEALER_UID, baseCreatePayload()),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'STORE_INACTIVE' })
  })

  it('[CC-10] dealer inactif → PROFILE_INACTIVE', async () => {
    await db.doc(`users/${DEALER_UID}`).set(INACTIVE_DEALER_PROFILE)
    await seedStore()
    await seedBalance()

    await expect(
      createDealerClosureHandler(
        makeRequest(DEALER_UID, baseCreatePayload()),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'PROFILE_INACTIVE' })
  })

  it('[CC-11] mauvais rôle (store_admin) → ROLE_FORBIDDEN', async () => {
    await seedStoreAdmin() // rôle store_admin, pas dealer
    await seedStore()
    await seedBalance()

    await expect(
      createDealerClosureHandler(
        makeRequest(STORE_ADMIN_UID, baseCreatePayload()),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'ROLE_FORBIDDEN' })
  })

  it('[CC-12] payload avec champ supplémentaire → INVALID_REQUEST_ID (allow-list)', async () => {
    await seedDealer()
    await expect(
      createDealerClosureHandler(
        makeRequest(DEALER_UID, { ...baseCreatePayload(), status: 'confirmed' }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST_ID' })
  })

  it('[CC-13] payload avec recordedStockBalance → rejeté (allow-list)', async () => {
    await seedDealer()
    await expect(
      createDealerClosureHandler(
        makeRequest(DEALER_UID, { ...baseCreatePayload(), recordedStockBalance: 99999 }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST_ID' })
  })

  it('[CC-14] aucun solde modifié après création', async () => {
    await seedDealer()
    await seedStore()
    await seedBalance()

    await createDealerClosureHandler(
      makeRequest(DEALER_UID, baseCreatePayload({ declaredStockBalance: 35000, reason: 'Test solde.' })),
      { db, FieldValue }
    )

    // Solde Orange inchangé
    const balSnap = await db.doc(`clients/${STORE_A}/networkBalances/current`).get()
    expect(balSnap.data().balances.Orange.stock).toBe(40000)
    expect(balSnap.data().balances.Orange.liquidite).toBe(20000)
  })

  it('[CC-15] idempotence séquentielle : même payload deux fois → même closureId, 1 doc, 1 audit', async () => {
    await seedDealer()
    await seedStore()
    await seedBalance()

    const payload = baseCreatePayload()
    const r1 = await createDealerClosureHandler(makeRequest(DEALER_UID, payload), { db, FieldValue })
    const r2 = await createDealerClosureHandler(makeRequest(DEALER_UID, payload), { db, FieldValue })

    expect(r1.success).toBe(true)
    expect(r2.success).toBe(true)
    expect(r1.idempotent).toBe(false)
    expect(r2.idempotent).toBe(true)
    expect(r1.closureId).toBe(r2.closureId)

    // Exactement 1 document
    const closureSnap = await db.collection('dealerClosures').get()
    expect(closureSnap.size).toBe(1)

    // Exactement 1 audit
    const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.size).toBe(1)
  })

  it('[CC-16] même clé différent payload → CLOSURE_ALREADY_EXISTS', async () => {
    await seedDealer()
    await seedStore()
    await seedBalance()

    // Première création
    await createDealerClosureHandler(
      makeRequest(DEALER_UID, baseCreatePayload()),
      { db, FieldValue }
    )

    // Deuxième création avec stock différent
    await expect(
      createDealerClosureHandler(
        makeRequest(DEALER_UID, baseCreatePayload({ declaredStockBalance: 39000, reason: 'Motif différent.' })),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'CLOSURE_ALREADY_EXISTS' })

    // Toujours 1 seul document
    const snap = await db.collection('dealerClosures').get()
    expect(snap.size).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §CF — confirmDealerClosureHandler
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-044-CF — confirmDealerClosureHandler', () => {

  async function createPendingClosure(closureId = 'closure-044-cf', overrides = {}) {
    await db.doc(`dealerClosures/${closureId}`).set({
      dealerUid:               DEALER_UID,
      dealerName:              'Dealer 044',
      dealerEmail:             'dealer@test.044',
      targetStoreId:           STORE_A,
      targetStoreName:         'Boutique 044-A',
      network:                 'Orange',
      businessDate:            BUSINESS_DATE,
      declaredStockBalance:    40000,
      declaredLiquidityBalance: 20000,
      recordedStockBalance:    40000,
      recordedLiquidityBalance: 20000,
      stockDifference:         0,
      liquidityDifference:     0,
      reason:                  null,
      status:                  'pending',
      createdAt:               new Date(),
      updatedAt:               new Date(),
      confirmedBy:             null, confirmedAt: null,
      rejectedBy:              null, rejectedAt:  null, rejectionReason: null,
      ...overrides,
    })
  }

  it('[CF-01] succès : clôture confirmée, aucun solde modifié, audit créé', async () => {
    await seedStoreAdmin()
    await createPendingClosure()
    await seedBalance()

    const result = await confirmDealerClosureHandler(
      makeRequest(STORE_ADMIN_UID, { closureId: 'closure-044-cf' }),
      { db, FieldValue }
    )

    expect(result.success).toBe(true)
    expect(result.closureId).toBe('closure-044-cf')

    const snap = await db.doc('dealerClosures/closure-044-cf').get()
    expect(snap.data().status).toBe('confirmed')
    expect(snap.data().confirmedBy).toBe(STORE_ADMIN_UID)
    expect(snap.data().rejectedBy).toBeNull()

    // Aucun solde modifié
    const balSnap = await db.doc(`clients/${STORE_A}/networkBalances/current`).get()
    expect(balSnap.data().balances.Orange.stock).toBe(40000)

    // Audit créé
    const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.size).toBe(1)
    expect(auditSnap.docs[0].data().action).toBe('DEALER_CLOSURE_CONFIRMED')
  })

  it('[CF-02] autre boutique → CLOSURE_STORE_MISMATCH', async () => {
    await seedStoreAdmin(OTHER_ADMIN_UID, OTHER_ADMIN_PROFILE)
    await createPendingClosure()

    await expect(
      confirmDealerClosureHandler(
        makeRequest(OTHER_ADMIN_UID, { closureId: 'closure-044-cf' }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'CLOSURE_STORE_MISMATCH' })
  })

  it('[CF-03] closure introuvable → CLOSURE_NOT_FOUND', async () => {
    await seedStoreAdmin()

    await expect(
      confirmDealerClosureHandler(
        makeRequest(STORE_ADMIN_UID, { closureId: 'inexistant' }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'CLOSURE_NOT_FOUND' })
  })

  it('[CF-04] déjà confirmée → CLOSURE_NOT_PENDING', async () => {
    await seedStoreAdmin()
    await createPendingClosure('closure-cf-already', { status: 'confirmed' })

    await expect(
      confirmDealerClosureHandler(
        makeRequest(STORE_ADMIN_UID, { closureId: 'closure-cf-already' }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'CLOSURE_NOT_PENDING' })
  })

  it('[CF-05] dealer tente de confirmer → ROLE_FORBIDDEN', async () => {
    await seedDealer()
    await createPendingClosure()

    await expect(
      confirmDealerClosureHandler(
        makeRequest(DEALER_UID, { closureId: 'closure-044-cf' }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'ROLE_FORBIDDEN' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §RJ — rejectDealerClosureHandler
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-044-RJ — rejectDealerClosureHandler', () => {

  async function createPendingClosure(closureId = 'closure-044-rj', overrides = {}) {
    await db.doc(`dealerClosures/${closureId}`).set({
      dealerUid: DEALER_UID, dealerName: 'Dealer 044', dealerEmail: 'dealer@test.044',
      targetStoreId: STORE_A, targetStoreName: 'Boutique 044-A',
      network: 'Orange', businessDate: BUSINESS_DATE,
      declaredStockBalance: 40000, declaredLiquidityBalance: 20000,
      recordedStockBalance: 40000, recordedLiquidityBalance: 20000,
      stockDifference: 0, liquidityDifference: 0, reason: null,
      status: 'pending', createdAt: new Date(), updatedAt: new Date(),
      confirmedBy: null, confirmedAt: null,
      rejectedBy: null, rejectedAt: null, rejectionReason: null,
      ...overrides,
    })
  }

  it('[RJ-01] succès : clôture rejetée, aucun solde modifié, audit créé', async () => {
    await seedStoreAdmin()
    await createPendingClosure()
    await seedBalance()

    const result = await rejectDealerClosureHandler(
      makeRequest(STORE_ADMIN_UID, { closureId: 'closure-044-rj', rejectionReason: 'Motif de rejet valide.' }),
      { db, FieldValue }
    )

    expect(result.success).toBe(true)

    const snap = await db.doc('dealerClosures/closure-044-rj').get()
    expect(snap.data().status).toBe('rejected')
    expect(snap.data().rejectedBy).toBe(STORE_ADMIN_UID)
    expect(snap.data().rejectionReason).toBe('Motif de rejet valide.')
    expect(snap.data().confirmedBy).toBeNull()

    const balSnap = await db.doc(`clients/${STORE_A}/networkBalances/current`).get()
    expect(balSnap.data().balances.Orange.stock).toBe(40000)

    const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.size).toBe(1)
    expect(auditSnap.docs[0].data().action).toBe('DEALER_CLOSURE_REJECTED')
    expect(auditSnap.docs[0].data().rejectionReason).toBe('Motif de rejet valide.')
  })

  it('[RJ-02] motif trop court → INVALID_REJECTION_REASON', async () => {
    await seedStoreAdmin()
    await createPendingClosure()

    await expect(
      rejectDealerClosureHandler(
        makeRequest(STORE_ADMIN_UID, { closureId: 'closure-044-rj', rejectionReason: 'ab' }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'INVALID_REJECTION_REASON' })
  })

  it('[RJ-03] autre boutique → CLOSURE_STORE_MISMATCH', async () => {
    await seedStoreAdmin(OTHER_ADMIN_UID, OTHER_ADMIN_PROFILE)
    await createPendingClosure()

    await expect(
      rejectDealerClosureHandler(
        makeRequest(OTHER_ADMIN_UID, { closureId: 'closure-044-rj', rejectionReason: 'Boutique incorrecte.' }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'CLOSURE_STORE_MISMATCH' })
  })

  it('[RJ-04] déjà rejetée → CLOSURE_NOT_PENDING', async () => {
    await seedStoreAdmin()
    await createPendingClosure('closure-rj-already', { status: 'rejected' })

    await expect(
      rejectDealerClosureHandler(
        makeRequest(STORE_ADMIN_UID, { closureId: 'closure-rj-already', rejectionReason: 'Déjà rejetée.' }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'CLOSURE_NOT_PENDING' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §CON — Concurrence réelle
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-044-CON — Concurrence réelle', () => {

  it('[CON-01] deux créations simultanées identiques → exactement 1 doc, 1 audit, deux succès', async () => {
    await seedDealer()
    await seedStore()
    await seedBalance()

    const payload = baseCreatePayload()
    const [r1, r2] = await Promise.allSettled([
      createDealerClosureHandler(makeRequest(DEALER_UID, payload), { db, FieldValue }),
      createDealerClosureHandler(makeRequest(DEALER_UID, payload), { db, FieldValue }),
    ])

    // Les deux doivent réussir (idempotence)
    expect(r1.status).toBe('fulfilled')
    expect(r2.status).toBe('fulfilled')

    // Même closureId
    expect(r1.value.closureId).toBe(r2.value.closureId)

    // Exactement 1 document
    const closureSnap = await db.collection('dealerClosures').get()
    expect(closureSnap.size).toBe(1)

    // Exactement 1 audit de création
    const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    const creationAudits = auditSnap.docs.filter(d => d.data().action === 'DEALER_CLOSURE_CREATED')
    expect(creationAudits.length).toBe(1)
  })

  it('[CON-02] deux créations simultanées avec payload différent → 1 succès + 1 CLOSURE_ALREADY_EXISTS, 1 doc', async () => {
    await seedDealer()
    await seedStore()
    await seedBalance()

    const [r1, r2] = await Promise.allSettled([
      createDealerClosureHandler(
        makeRequest(DEALER_UID, baseCreatePayload({ declaredStockBalance: 40000 })),
        { db, FieldValue }
      ),
      createDealerClosureHandler(
        makeRequest(DEALER_UID, baseCreatePayload({ declaredStockBalance: 30000, reason: 'Autre montant.' })),
        { db, FieldValue }
      ),
    ])

    const succeeded = [r1, r2].filter(r => r.status === 'fulfilled')
    const rejected  = [r1, r2].filter(r => r.status === 'rejected')

    // Une réussit, l'autre échoue
    expect(succeeded.length).toBe(1)
    expect(rejected.length).toBe(1)
    expect(rejected[0].reason?.code).toBe('CLOSURE_ALREADY_EXISTS')

    // Exactement 1 document
    const snap = await db.collection('dealerClosures').get()
    expect(snap.size).toBe(1)
  })

  it('[CON-03] double confirmation simultanée → 1 succès + 1 CLOSURE_NOT_PENDING', async () => {
    await seedStoreAdmin()
    await seedBalance()
    await db.doc('dealerClosures/closure-con-03').set({
      dealerUid: DEALER_UID, dealerName: 'Dealer 044', dealerEmail: 'dealer@test.044',
      targetStoreId: STORE_A, targetStoreName: 'Boutique 044-A',
      network: 'Orange', businessDate: BUSINESS_DATE,
      declaredStockBalance: 40000, declaredLiquidityBalance: 20000,
      recordedStockBalance: 40000, recordedLiquidityBalance: 20000,
      stockDifference: 0, liquidityDifference: 0, reason: null,
      status: 'pending', createdAt: new Date(), updatedAt: new Date(),
      confirmedBy: null, confirmedAt: null,
      rejectedBy: null, rejectedAt: null, rejectionReason: null,
    })

    const [r1, r2] = await Promise.allSettled([
      confirmDealerClosureHandler(makeRequest(STORE_ADMIN_UID, { closureId: 'closure-con-03' }), { db, FieldValue }),
      confirmDealerClosureHandler(makeRequest(STORE_ADMIN_UID, { closureId: 'closure-con-03' }), { db, FieldValue }),
    ])

    const succeeded = [r1, r2].filter(r => r.status === 'fulfilled')
    const rejected  = [r1, r2].filter(r => r.status === 'rejected')

    expect(succeeded.length).toBe(1)
    expect(rejected.length).toBe(1)
    expect(['CLOSURE_NOT_PENDING', 'TRANSACTION_FAILED']).toContain(rejected[0].reason?.code)

    const snap = await db.doc('dealerClosures/closure-con-03').get()
    expect(snap.data().status).toBe('confirmed')

    // Exactement 1 audit de confirmation
    const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    const confAudits = auditSnap.docs.filter(d => d.data().action === 'DEALER_CLOSURE_CONFIRMED')
    expect(confAudits.length).toBe(1)
  })

  it('[CON-04] confirmation + rejet simultanés → une seule transition, 1 audit de traitement', async () => {
    await seedStoreAdmin()
    await seedBalance()
    await db.doc('dealerClosures/closure-con-04').set({
      dealerUid: DEALER_UID, dealerName: 'Dealer 044', dealerEmail: 'dealer@test.044',
      targetStoreId: STORE_A, targetStoreName: 'Boutique 044-A',
      network: 'Orange', businessDate: BUSINESS_DATE,
      declaredStockBalance: 40000, declaredLiquidityBalance: 20000,
      recordedStockBalance: 40000, recordedLiquidityBalance: 20000,
      stockDifference: 0, liquidityDifference: 0, reason: null,
      status: 'pending', createdAt: new Date(), updatedAt: new Date(),
      confirmedBy: null, confirmedAt: null,
      rejectedBy: null, rejectedAt: null, rejectionReason: null,
    })

    const [r1, r2] = await Promise.allSettled([
      confirmDealerClosureHandler(makeRequest(STORE_ADMIN_UID, { closureId: 'closure-con-04' }), { db, FieldValue }),
      rejectDealerClosureHandler( makeRequest(STORE_ADMIN_UID, { closureId: 'closure-con-04', rejectionReason: 'Test concurrence.' }), { db, FieldValue }),
    ])

    // Une transition réussit
    const succeeded = [r1, r2].filter(r => r.status === 'fulfilled')
    expect(succeeded.length).toBe(1)

    // Statut final unique
    const snap = await db.doc('dealerClosures/closure-con-04').get()
    expect(['confirmed', 'rejected']).toContain(snap.data().status)

    // 1 seul audit de traitement
    const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    const treatmentAudits = auditSnap.docs.filter(d =>
      d.data().action === 'DEALER_CLOSURE_CONFIRMED' ||
      d.data().action === 'DEALER_CLOSURE_REJECTED'
    )
    expect(treatmentAudits.length).toBe(1)
  })

  it('[CON-05] double rejet simultané → 1 succès + 1 CLOSURE_NOT_PENDING', async () => {
    await seedStoreAdmin()
    await seedBalance()
    await db.doc('dealerClosures/closure-con-05').set({
      dealerUid: DEALER_UID, dealerName: 'Dealer 044', dealerEmail: 'dealer@test.044',
      targetStoreId: STORE_A, targetStoreName: 'Boutique 044-A',
      network: 'Orange', businessDate: BUSINESS_DATE,
      declaredStockBalance: 40000, declaredLiquidityBalance: 20000,
      recordedStockBalance: 40000, recordedLiquidityBalance: 20000,
      stockDifference: 0, liquidityDifference: 0, reason: null,
      status: 'pending', createdAt: new Date(), updatedAt: new Date(),
      confirmedBy: null, confirmedAt: null,
      rejectedBy: null, rejectedAt: null, rejectionReason: null,
    })

    const [r1, r2] = await Promise.allSettled([
      rejectDealerClosureHandler(makeRequest(STORE_ADMIN_UID, { closureId: 'closure-con-05', rejectionReason: 'Rejet concurrent 1.' }), { db, FieldValue }),
      rejectDealerClosureHandler(makeRequest(STORE_ADMIN_UID, { closureId: 'closure-con-05', rejectionReason: 'Rejet concurrent 2.' }), { db, FieldValue }),
    ])

    const succeeded = [r1, r2].filter(r => r.status === 'fulfilled')
    expect(succeeded.length).toBe(1)

    const snap = await db.doc('dealerClosures/closure-con-05').get()
    expect(snap.data().status).toBe('rejected')

    const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    const rejAudits = auditSnap.docs.filter(d => d.data().action === 'DEALER_CLOSURE_REJECTED')
    expect(rejAudits.length).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §MN — Clôture dealer multi-réseaux
//   Le réseau est porté par la clôture (payload) et validé contre dealerNetworks.
//   Les soldes enregistrés sont lus sur balances[network].
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-044-MN — clôture dealer multi-réseaux', () => {
  const MULTI_BALANCE = {
    balances: {
      Orange: { stock: 40000, liquidite: 20000 },
      Moov:   { stock: 15000, liquidite:  8000 },
    },
    updatedAt: new Date('2024-01-01'),
  }

  it('[MN-01] clôture Moov (dealerNetworks=[Orange,Moov]) → écarts calculés sur balances.Moov', async () => {
    await seedDealer()
    await seedStore()
    await seedBalance(STORE_A, MULTI_BALANCE)

    const result = await createDealerClosureHandler(
      makeRequest(DEALER_UID, baseCreatePayload({ network: 'Moov', declaredStockBalance: 15000, declaredLiquidityBalance: 8000 })),
      { db, FieldValue, dealerNetworks: ['Orange', 'Moov'] }
    )

    expect(result.success).toBe(true)
    expect(result.stockDifference).toBe(0)        // 15000 - 15000 (Moov)
    expect(result.liquidityDifference).toBe(0)
    expect(result.closureId).toBe(`${DEALER_UID}_${STORE_A}_Moov_${BUSINESS_DATE}`)

    const data = (await db.doc(`dealerClosures/${result.closureId}`).get()).data()
    expect(data.network).toBe('Moov')
    expect(data.recordedStockBalance).toBe(15000)
    expect(data.recordedLiquidityBalance).toBe(8000)
  })

  it('[MN-02] client mono-réseau (défaut Orange) : clôture Moov refusée → INVALID_CLOSURE_DATA', async () => {
    await seedDealer()
    await seedStore()
    await seedBalance(STORE_A, MULTI_BALANCE)

    await expect(
      createDealerClosureHandler(
        makeRequest(DEALER_UID, baseCreatePayload({ network: 'Moov', declaredStockBalance: 15000, declaredLiquidityBalance: 8000 })),
        { db, FieldValue } // dealerNetworks par défaut = ['Orange']
      )
    ).rejects.toMatchObject({ code: 'INVALID_CLOSURE_DATA' })
  })
})
