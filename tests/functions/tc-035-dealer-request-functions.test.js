/**
 * TC-035 — Handler integration avec Firestore Emulator (V2-7A)
 *
 * Stratégie :
 *   - Les handlers sont appelés directement (sans émulateur Functions) avec { db, FieldValue } injectés.
 *   - firebase-admin Admin SDK est initialisé en pointant sur l'émulateur Firestore.
 *   - Les données sont insérées/lues via Admin SDK (bypass des règles Firestore).
 *   - L'émulateur est vidé via son API REST entre chaque test.
 *
 * NOTE : Ces tests s'appellent "handler integration" et non "Functions Emulator" car
 *   ils ne passent pas par l'émulateur Functions (port 5001). Le câblage onCall est
 *   vérifié séparément dans TC-036.
 *
 * Prérequis : firebase emulators:exec --only firestore --project demo-akayis-test
 *   → FIRESTORE_EMULATOR_HOST et GCLOUD_PROJECT sont positionnés automatiquement.
 *
 * Exécution : npm run test:functions
 *
 * Projet exclusif : demo-akayis-test — aucun accès Firebase production.
 * Une exécution directe sans firebase emulators:exec échouera immédiatement en beforeAll.
 *
 * Sections :
 *   §CF  — confirmDealerRequestHandler (13 scénarios)
 *   §RJ  — rejectDealerRequestHandler  (9 scénarios)
 *   §CON — concurrence réelle          (3 scénarios Promise.allSettled)
 *   §PE  — effets partiels             (7 scénarios : aucune écriture sur erreur)
 *   §AU  — audit unique sur retry      (1 scénario)
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest'
import { initializeApp, getApps, deleteApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { DealerRequestError } from '../../functions/src/errors.js'
import { confirmDealerRequestHandler } from '../../functions/src/dealerRequests/confirmDealerRequest.js'
import { rejectDealerRequestHandler } from '../../functions/src/dealerRequests/rejectDealerRequest.js'

// ─────────────────────────────────────────────────────────────────────────────
// Setup Admin SDK + sécurité projet
// ─────────────────────────────────────────────────────────────────────────────

let adminApp
let db

// Aucun fallback — une exécution sans firebase emulators:exec doit échouer avant
// d'initialiser l'Admin SDK pour empêcher tout accès à Firebase production.
const PROJECT_ID = process.env.GCLOUD_PROJECT
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST

beforeAll(() => {
  // Garde anti-production : vérifications sans fallback
  if (!FIRESTORE_HOST) {
    throw new Error(
      'SÉCURITÉ : FIRESTORE_EMULATOR_HOST non défini. ' +
      'Lancer via : npm run test:functions'
    )
  }
  if (!PROJECT_ID) {
    throw new Error(
      'SÉCURITÉ : GCLOUD_PROJECT non défini. ' +
      'Lancer via : npm run test:functions'
    )
  }
  if (!PROJECT_ID.startsWith('demo-')) {
    throw new Error(`SÉCURITÉ : projectId non-demo. Valeur reçue : "${PROJECT_ID}"`)
  }
  if (PROJECT_ID !== 'demo-akayis-test') {
    throw new Error(`SÉCURITÉ : projectId doit être "demo-akayis-test". Valeur reçue : "${PROJECT_ID}"`)
  }
  if (['taofic-ajagbe', 'c2egf-b0b5a'].includes(PROJECT_ID)) {
    throw new Error('SÉCURITÉ : projectId de production interdit.')
  }
  if (getApps().length === 0) {
    adminApp = initializeApp({ projectId: PROJECT_ID })
  } else {
    adminApp = getApps()[0]
  }
  db = getFirestore(adminApp)
})

afterAll(async () => {
  if (adminApp) await deleteApp(adminApp)
})

// Vide l'émulateur Firestore entre chaque test via l'API REST (admin uniquement)
async function clearFirestoreEmulator() {
  const url = `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`
  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok) {
    throw new Error(`Impossible de vider l'émulateur Firestore : HTTP ${res.status}`)
  }
}

beforeEach(async () => {
  await clearFirestoreEmulator()
})

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de seed via Admin SDK
// ─────────────────────────────────────────────────────────────────────────────

async function seedUser(uid, data) {
  await db.doc(`users/${uid}`).set(data)
}

async function seedRequest(reqId, data) {
  await db.doc(`dealerRequests/${reqId}`).set(data)
}

async function seedBalance(storeId, data) {
  await db.doc(`clients/${storeId}/networkBalances/current`).set(data)
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures de base
// ─────────────────────────────────────────────────────────────────────────────

const STORE_ADMIN_UID  = 'store-admin-uid'
const DEALER_UID       = 'dealer-uid'
const INACTIVE_UID     = 'inactive-admin-uid'
const OTHER_ADMIN_UID  = 'other-store-admin-uid'
const STORE_A          = 'store-A'
const STORE_B          = 'store-B'

const STORE_ADMIN_PROFILE = {
  role: 'store_admin', active: true, storeId: STORE_A,
  email: 'admin@test.test', name: 'Admin Test',
}
const DEALER_PROFILE = {
  role: 'dealer', active: true, storeId: STORE_A,
  email: 'dealer@test.test', name: 'Dealer Test',
}
const INACTIVE_PROFILE = {
  role: 'store_admin', active: false, storeId: STORE_A,
  email: 'inactive@test.test', name: 'Admin Inactif',
}
const OTHER_ADMIN_PROFILE = {
  role: 'store_admin', active: true, storeId: STORE_B,
  email: 'other@test.test', name: 'Admin Autre',
}

const BASE_REQ = {
  dealerUid:       DEALER_UID,
  dealerEmail:     'dealer@test.test',
  dealerName:      'Dealer Test',
  requestType:     'stock_add',
  network:         'Orange',
  amount:          10000,
  status:          'pending',
  targetStoreId:   STORE_A,
  targetStoreName: 'Boutique A',
  confirmedBy:     null,
  confirmedAt:     null,
  rejectedBy:      null,
  rejectedAt:      null,
  rejectionReason: null,
  previousBalance: null,
  newBalance:      null,
  createdAt:       new Date('2024-01-01T10:00:00Z'),
  updatedAt:       new Date('2024-01-01T10:00:00Z'),
}

const BASE_BALANCE = {
  balances: {
    Orange:  { stock: 50000, liquidite: 30000 },
    Moov:    { stock: 10000, liquidite:  5000 },
    Telecel: { stock:  8000, liquidite:  2000 },
  },
  updatedAt: new Date('2024-01-01T00:00:00Z'),
}

// Helpers mock request
function makeRequest(uid, data) {
  return { auth: uid ? { uid, token: {} } : null, data: data ?? {} }
}

// ─────────────────────────────────────────────────────────────────────────────
// §CF — confirmDealerRequestHandler
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-035-CF — confirmDealerRequestHandler', () => {
  it('[CF-01] succès : demande confirmée, solde mis à jour, audit créé', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedRequest('req-1', BASE_REQ)
    await seedBalance(STORE_A, BASE_BALANCE)

    const result = await confirmDealerRequestHandler(
      makeRequest(STORE_ADMIN_UID, { requestId: 'req-1' }),
      { db, FieldValue }
    )

    expect(result.success).toBe(true)
    expect(result.requestId).toBe('req-1')
    expect(result.previousBalance).toBe(50000)
    expect(result.newBalance).toBe(60000)

    // Vérification Firestore : demande
    const reqSnap = await db.doc('dealerRequests/req-1').get()
    const reqData = reqSnap.data()
    expect(reqData.status).toBe('confirmed')
    expect(reqData.confirmedBy).toBe(STORE_ADMIN_UID)
    expect(reqData.previousBalance).toBe(50000)
    expect(reqData.newBalance).toBe(60000)
    expect(reqData.rejectedBy).toBeNull()
    expect(reqData.rejectionReason).toBeNull()

    // Vérification Firestore : solde Orange.stock
    const balSnap = await db.doc(`clients/${STORE_A}/networkBalances/current`).get()
    const bal = balSnap.data()
    expect(bal.balances.Orange.stock).toBe(60000)
    // Autres réseaux préservés
    expect(bal.balances.Moov.stock).toBe(10000)
    expect(bal.balances.Orange.liquidite).toBe(30000)

    // Vérification Firestore : audit
    const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.size).toBe(1)
    const audit = auditSnap.docs[0].data()
    expect(audit.action).toBe('DEALER_REQUEST_CONFIRMED')
    expect(audit.actorUid).toBe(STORE_ADMIN_UID)
    expect(audit.requestId).toBe('req-1')
    expect(audit.previousBalance).toBe(50000)
    expect(audit.newBalance).toBe(60000)
    expect(audit.rejectionReason).toBeNull()
  })

  it('[CF-02] succès liquidity_add : liquidite mis à jour, stock préservé', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedRequest('req-liq', { ...BASE_REQ, requestType: 'liquidity_add', amount: 5000 })
    await seedBalance(STORE_A, BASE_BALANCE)

    const result = await confirmDealerRequestHandler(
      makeRequest(STORE_ADMIN_UID, { requestId: 'req-liq' }),
      { db, FieldValue }
    )

    expect(result.previousBalance).toBe(30000)
    expect(result.newBalance).toBe(35000)

    const balSnap = await db.doc(`clients/${STORE_A}/networkBalances/current`).get()
    const bal = balSnap.data()
    expect(bal.balances.Orange.liquidite).toBe(35000)
    // Stock Orange inchangé
    expect(bal.balances.Orange.stock).toBe(50000)
  })

  it('[CF-03] sans auth → UNAUTHENTICATED', async () => {
    await expect(
      confirmDealerRequestHandler(makeRequest(null, { requestId: 'req-1' }), { db, FieldValue })
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('[CF-04] requestId manquant → INVALID_REQUEST_ID', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await expect(
      confirmDealerRequestHandler(makeRequest(STORE_ADMIN_UID, {}), { db, FieldValue })
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST_ID' })
  })

  it('[CF-05] acteur inconnu → PROFILE_NOT_FOUND', async () => {
    await expect(
      confirmDealerRequestHandler(makeRequest('uid-inconnu', { requestId: 'req-1' }), { db, FieldValue })
    ).rejects.toMatchObject({ code: 'PROFILE_NOT_FOUND' })
  })

  it('[CF-06] acteur inactif → PROFILE_INACTIVE', async () => {
    await seedUser(INACTIVE_UID, INACTIVE_PROFILE)
    await expect(
      confirmDealerRequestHandler(makeRequest(INACTIVE_UID, { requestId: 'req-1' }), { db, FieldValue })
    ).rejects.toMatchObject({ code: 'PROFILE_INACTIVE' })
  })

  it('[CF-07] rôle dealer (non store_admin) → ROLE_FORBIDDEN', async () => {
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await expect(
      confirmDealerRequestHandler(makeRequest(DEALER_UID, { requestId: 'req-1' }), { db, FieldValue })
    ).rejects.toMatchObject({ code: 'ROLE_FORBIDDEN' })
  })

  it('[CF-08] demande inexistante → REQUEST_NOT_FOUND', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await expect(
      confirmDealerRequestHandler(makeRequest(STORE_ADMIN_UID, { requestId: 'req-inexistante' }), { db, FieldValue })
    ).rejects.toMatchObject({ code: 'REQUEST_NOT_FOUND' })
  })

  it('[CF-09] demande déjà confirmée → REQUEST_NOT_PENDING', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedRequest('req-confirmed', {
      ...BASE_REQ,
      status:          'confirmed',
      confirmedBy:     STORE_ADMIN_UID,
      confirmedAt:     new Date(),
      previousBalance: 40000,
      newBalance:      50000,
    })
    await expect(
      confirmDealerRequestHandler(makeRequest(STORE_ADMIN_UID, { requestId: 'req-confirmed' }), { db, FieldValue })
    ).rejects.toMatchObject({ code: 'REQUEST_NOT_PENDING' })
  })

  it('[CF-10] demande ciblant une autre boutique → REQUEST_STORE_MISMATCH', async () => {
    await seedUser(OTHER_ADMIN_UID, OTHER_ADMIN_PROFILE)
    await seedRequest('req-store-a', BASE_REQ) // targetStoreId = store-A
    await expect(
      confirmDealerRequestHandler(makeRequest(OTHER_ADMIN_UID, { requestId: 'req-store-a' }), { db, FieldValue })
    ).rejects.toMatchObject({ code: 'REQUEST_STORE_MISMATCH' })
  })

  it('[CF-11] document de soldes absent → BALANCE_NOT_FOUND', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedRequest('req-1', BASE_REQ)
    // Pas de seedBalance → BALANCE_NOT_FOUND
    await expect(
      confirmDealerRequestHandler(makeRequest(STORE_ADMIN_UID, { requestId: 'req-1' }), { db, FieldValue })
    ).rejects.toMatchObject({ code: 'BALANCE_NOT_FOUND' })
  })

  it('[CF-12] overflow balance (Number.MAX_SAFE_INTEGER) → BALANCE_OVERFLOW', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedRequest('req-overflow', { ...BASE_REQ, amount: 1 })
    await seedBalance(STORE_A, {
      balances: { Orange: { stock: Number.MAX_SAFE_INTEGER, liquidite: 0 } },
    })
    await expect(
      confirmDealerRequestHandler(makeRequest(STORE_ADMIN_UID, { requestId: 'req-overflow' }), { db, FieldValue })
    ).rejects.toMatchObject({ code: 'BALANCE_OVERFLOW' })
  })

  it('[CF-13] second appel sur même demande (idempotence) → REQUEST_NOT_PENDING', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedRequest('req-1', BASE_REQ)
    await seedBalance(STORE_A, BASE_BALANCE)

    // Premier appel réussit
    await confirmDealerRequestHandler(
      makeRequest(STORE_ADMIN_UID, { requestId: 'req-1' }),
      { db, FieldValue }
    )

    // Deuxième appel sur la même demande → REQUEST_NOT_PENDING
    await expect(
      confirmDealerRequestHandler(makeRequest(STORE_ADMIN_UID, { requestId: 'req-1' }), { db, FieldValue })
    ).rejects.toMatchObject({ code: 'REQUEST_NOT_PENDING' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §RJ — rejectDealerRequestHandler
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-035-RJ — rejectDealerRequestHandler', () => {
  it('[RJ-01] succès : demande rejetée, solde inchangé, audit créé', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedRequest('req-1', BASE_REQ)
    await seedBalance(STORE_A, BASE_BALANCE)

    const result = await rejectDealerRequestHandler(
      makeRequest(STORE_ADMIN_UID, { requestId: 'req-1', rejectionReason: 'Solde insuffisant.' }),
      { db, FieldValue }
    )

    expect(result.success).toBe(true)
    expect(result.requestId).toBe('req-1')

    // Vérification Firestore : demande
    const reqSnap = await db.doc('dealerRequests/req-1').get()
    const reqData = reqSnap.data()
    expect(reqData.status).toBe('rejected')
    expect(reqData.rejectedBy).toBe(STORE_ADMIN_UID)
    expect(reqData.rejectionReason).toBe('Solde insuffisant.')
    expect(reqData.confirmedBy).toBeNull()
    expect(reqData.previousBalance).toBeNull()
    expect(reqData.newBalance).toBeNull()

    // Vérification Firestore : solde INCHANGÉ
    const balSnap = await db.doc(`clients/${STORE_A}/networkBalances/current`).get()
    expect(balSnap.data().balances.Orange.stock).toBe(50000)
    expect(balSnap.data().balances.Orange.liquidite).toBe(30000)

    // Vérification Firestore : audit
    const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.size).toBe(1)
    const audit = auditSnap.docs[0].data()
    expect(audit.action).toBe('DEALER_REQUEST_REJECTED')
    expect(audit.rejectionReason).toBe('Solde insuffisant.')
    expect(audit.previousBalance).toBeNull()
    expect(audit.newBalance).toBeNull()
  })

  it('[RJ-02] motif manquant → INVALID_REJECTION_REASON', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await expect(
      rejectDealerRequestHandler(
        makeRequest(STORE_ADMIN_UID, { requestId: 'req-1' }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'INVALID_REJECTION_REASON' })
  })

  it('[RJ-03] motif trop court → INVALID_REJECTION_REASON', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await expect(
      rejectDealerRequestHandler(
        makeRequest(STORE_ADMIN_UID, { requestId: 'req-1', rejectionReason: 'ab' }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'INVALID_REJECTION_REASON' })
  })

  it('[RJ-04] motif trop long → INVALID_REJECTION_REASON', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await expect(
      rejectDealerRequestHandler(
        makeRequest(STORE_ADMIN_UID, { requestId: 'req-1', rejectionReason: 'a'.repeat(501) }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'INVALID_REJECTION_REASON' })
  })

  it('[RJ-05] sans auth → UNAUTHENTICATED', async () => {
    await expect(
      rejectDealerRequestHandler(
        makeRequest(null, { requestId: 'req-1', rejectionReason: 'Motif valide.' }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('[RJ-06] demande inexistante → REQUEST_NOT_FOUND', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await expect(
      rejectDealerRequestHandler(
        makeRequest(STORE_ADMIN_UID, { requestId: 'req-inexistante', rejectionReason: 'Motif valide.' }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'REQUEST_NOT_FOUND' })
  })

  it('[RJ-07] demande déjà rejetée → REQUEST_NOT_PENDING', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedRequest('req-rejected', {
      ...BASE_REQ,
      status:          'rejected',
      rejectedBy:      STORE_ADMIN_UID,
      rejectedAt:      new Date(),
      rejectionReason: 'Motif initial.',
    })
    await expect(
      rejectDealerRequestHandler(
        makeRequest(STORE_ADMIN_UID, { requestId: 'req-rejected', rejectionReason: 'Second motif.' }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'REQUEST_NOT_PENDING' })
  })

  it('[RJ-08] demande ciblant une autre boutique → REQUEST_STORE_MISMATCH', async () => {
    await seedUser(OTHER_ADMIN_UID, OTHER_ADMIN_PROFILE)
    await seedRequest('req-store-a', BASE_REQ) // targetStoreId = store-A
    await expect(
      rejectDealerRequestHandler(
        makeRequest(OTHER_ADMIN_UID, { requestId: 'req-store-a', rejectionReason: 'Motif valide.' }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'REQUEST_STORE_MISMATCH' })
  })

  it('[RJ-09] demande déjà confirmée → REQUEST_NOT_PENDING', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedRequest('req-confirmed', {
      ...BASE_REQ,
      status:          'confirmed',
      confirmedBy:     STORE_ADMIN_UID,
      confirmedAt:     new Date(),
      previousBalance: 40000,
      newBalance:      50000,
    })
    await expect(
      rejectDealerRequestHandler(
        makeRequest(STORE_ADMIN_UID, { requestId: 'req-confirmed', rejectionReason: 'Motif valide.' }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'REQUEST_NOT_PENDING' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §CON — Concurrence réelle (Promise.allSettled sur Firestore Emulator)
// ─────────────────────────────────────────────────────────────────────────────
// §CON — concurrence réelle
// Stratégie : barrière après lecture initiale de la demande.
//
//   makeBarrierDb intercepte t.get(ref) à l'intérieur de la transaction.
//   Quand les deux handlers ont lu dealerRequests/{requestId}, la barrière
//   les relâche simultanément : les deux transactions entrent en phase de
//   validation et d'écriture en même temps, garantissant un conflit Firestore
//   réel sur le document de demande.
//
//   Sur un retry Firestore (transaction rejouée) : barrier.wait() retourne
//   immédiatement (_arrived >= 2) — aucun deadlock possible.
//   Chaque invocation du callback de transaction possède sa propre variable
//   requestReadReached initialisée à false, donc les retries ne bloquent pas.
// ─────────────────────────────────────────────────────────────────────────────

class TwoPartyBarrier {
  constructor() {
    this._arrived   = 0
    this._resolvers = []
  }

  wait() {
    if (this._arrived >= 2) return Promise.resolve()
    return new Promise(resolve => {
      this._resolvers.push(resolve)
      this._arrived++
      if (this._arrived === 2) {
        this._resolvers.forEach(r => r())
        this._resolvers = []
      }
    })
  }
}

// Proxy db : place la barrière APRÈS que chaque transaction a lu le document
// de demande (targetRequestPath), AVANT validation et écriture.
// doc() et collection() sont transmis tels quels au vrai db.
function makeBarrierDb(realDb, barrier, targetRequestPath) {
  return {
    doc:        (...args) => realDb.doc(...args),
    collection: (...args) => realDb.collection(...args),

    runTransaction: (callback) =>
      realDb.runTransaction(async (realTransaction) => {
        // Réinitialisé à chaque invocation du callback (retry Firestore inclus).
        let requestReadReached = false

        const transactionProxy = {
          get: async (ref) => {
            const snapshot = await realTransaction.get(ref)
            if (!requestReadReached && ref.path === targetRequestPath) {
              requestReadReached = true
              await barrier.wait()
            }
            return snapshot
          },
          update: (...args) => realTransaction.update(...args),
          set:    (...args) => realTransaction.set(...args),
          create: (...args) => realTransaction.create(...args),
          delete: (...args) => realTransaction.delete(...args),
        }

        return callback(transactionProxy)
      }),
  }
}

describe('TC-035-CON — concurrence réelle', () => {
  it('[CON-01] double confirmation concurrente → exactement 1 succès, 1 échec REQUEST_NOT_PENDING, solde +1× seulement, 1 audit', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedRequest('req-con-1', BASE_REQ)
    await seedBalance(STORE_A, BASE_BALANCE)

    const barrier = new TwoPartyBarrier()
    const bDb1    = makeBarrierDb(db, barrier, 'dealerRequests/req-con-1')
    const bDb2    = makeBarrierDb(db, barrier, 'dealerRequests/req-con-1')

    const [r1, r2] = await Promise.allSettled([
      confirmDealerRequestHandler(
        makeRequest(STORE_ADMIN_UID, { requestId: 'req-con-1' }),
        { db: bDb1, FieldValue }
      ),
      confirmDealerRequestHandler(
        makeRequest(STORE_ADMIN_UID, { requestId: 'req-con-1' }),
        { db: bDb2, FieldValue }
      ),
    ])

    const fulfilled = [r1, r2].filter(r => r.status === 'fulfilled')
    const rejected  = [r1, r2].filter(r => r.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toMatchObject({ code: 'REQUEST_NOT_PENDING' })

    // Solde augmenté exactement une fois (50000 + 10000)
    const balSnap = await db.doc(`clients/${STORE_A}/networkBalances/current`).get()
    expect(balSnap.data().balances.Orange.stock).toBe(60000)

    // Statut final : confirmed
    const reqSnap = await db.doc('dealerRequests/req-con-1').get()
    expect(reqSnap.data().status).toBe('confirmed')

    // Exactement 1 audit de confirmation, 0 audit de rejet
    const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.size).toBe(1)
    expect(auditSnap.docs[0].data().action).toBe('DEALER_REQUEST_CONFIRMED')
  })

  it('[CON-02] confirmation + rejet simultanés → exactement 1 succès, 1 échec REQUEST_NOT_PENDING, exactement 1 audit', { timeout: 20000 }, async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedRequest('req-con-2', BASE_REQ)
    await seedBalance(STORE_A, BASE_BALANCE)

    const barrier = new TwoPartyBarrier()
    const bDb1    = makeBarrierDb(db, barrier, 'dealerRequests/req-con-2')
    const bDb2    = makeBarrierDb(db, barrier, 'dealerRequests/req-con-2')

    const [r1, r2] = await Promise.allSettled([
      confirmDealerRequestHandler(
        makeRequest(STORE_ADMIN_UID, { requestId: 'req-con-2' }),
        { db: bDb1, FieldValue }
      ),
      rejectDealerRequestHandler(
        makeRequest(STORE_ADMIN_UID, { requestId: 'req-con-2', rejectionReason: 'Rejet concurrent valide.' }),
        { db: bDb2, FieldValue }
      ),
    ])

    const fulfilled = [r1, r2].filter(r => r.status === 'fulfilled')
    const rejected  = [r1, r2].filter(r => r.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toMatchObject({ code: 'REQUEST_NOT_PENDING' })

    const reqSnap     = await db.doc('dealerRequests/req-con-2').get()
    const finalStatus = reqSnap.data().status
    expect(['confirmed', 'rejected']).toContain(finalStatus)

    const balSnap = await db.doc(`clients/${STORE_A}/networkBalances/current`).get()
    const stock   = balSnap.data().balances.Orange.stock

    if (finalStatus === 'confirmed') {
      expect(stock).toBe(60000)
      const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
      expect(auditSnap.size).toBe(1)
      expect(auditSnap.docs[0].data().action).toBe('DEALER_REQUEST_CONFIRMED')
    } else {
      expect(stock).toBe(50000)
      const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
      expect(auditSnap.size).toBe(1)
      expect(auditSnap.docs[0].data().action).toBe('DEALER_REQUEST_REJECTED')
    }
  })

  it('[CON-03] double rejet concurrent → exactement 1 succès, 1 échec REQUEST_NOT_PENDING, solde inchangé, exactement 1 audit, motif du gagnant', { timeout: 15000 }, async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedRequest('req-con-3', BASE_REQ)
    await seedBalance(STORE_A, BASE_BALANCE)

    const REASON_A = 'Motif A valide ici.'
    const REASON_B = 'Motif B valide ici.'

    const barrier = new TwoPartyBarrier()
    const bDb1    = makeBarrierDb(db, barrier, 'dealerRequests/req-con-3')
    const bDb2    = makeBarrierDb(db, barrier, 'dealerRequests/req-con-3')

    const [r1, r2] = await Promise.allSettled([
      rejectDealerRequestHandler(
        makeRequest(STORE_ADMIN_UID, { requestId: 'req-con-3', rejectionReason: REASON_A }),
        { db: bDb1, FieldValue }
      ),
      rejectDealerRequestHandler(
        makeRequest(STORE_ADMIN_UID, { requestId: 'req-con-3', rejectionReason: REASON_B }),
        { db: bDb2, FieldValue }
      ),
    ])

    const fulfilled = [r1, r2].filter(r => r.status === 'fulfilled')
    const rejected  = [r1, r2].filter(r => r.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toMatchObject({ code: 'REQUEST_NOT_PENDING' })

    // Le solde n'est JAMAIS modifié lors d'un rejet
    const balSnap = await db.doc(`clients/${STORE_A}/networkBalances/current`).get()
    expect(balSnap.data().balances.Orange.stock).toBe(50000)
    expect(balSnap.data().balances.Orange.liquidite).toBe(30000)

    // Statut final : rejected
    const reqSnap  = await db.doc('dealerRequests/req-con-3').get()
    const reqData  = reqSnap.data()
    expect(reqData.status).toBe('rejected')

    // Le motif final correspond exactement au gagnant (r1 gagne → REASON_A, r2 gagne → REASON_B)
    const winnerReason = r1.status === 'fulfilled' ? REASON_A : REASON_B
    expect(reqData.rejectionReason).toBe(winnerReason)

    // Exactement 1 audit de rejet
    const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.size).toBe(1)
    expect(auditSnap.docs[0].data().action).toBe('DEALER_REQUEST_REJECTED')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §PE — Effets partiels : aucune écriture lors d'une erreur dans la transaction
// ─────────────────────────────────────────────────────────────────────────────

// Helper : vérifie l'absence d'effets partiels après un échec de handler.
// expectedBalance = null → vérifie que le document balance n'a pas été créé.
// expectedBalance = number → vérifie que Orange.stock vaut cette valeur.
async function expectNoPartialEffects({ requestRef, expectedStatus, balanceRef, expectedBalance, auditCollectionRef }) {
  if (requestRef && expectedStatus !== undefined) {
    const reqSnap = await requestRef.get()
    expect(reqSnap.data().status).toBe(expectedStatus)
  }
  if (balanceRef) {
    const balSnap = await balanceRef.get()
    if (expectedBalance === null) {
      expect(balSnap.exists).toBe(false)
    } else if (expectedBalance !== undefined) {
      expect(balSnap.data().balances.Orange.stock).toBe(expectedBalance)
    }
  }
  if (auditCollectionRef) {
    const auditSnap = await auditCollectionRef.get()
    expect(auditSnap.size).toBe(0)
  }
}

describe('TC-035-PE — absence d\'effets partiels', () => {
  it('[PE-01] balance absente → demande inchangée, aucun audit', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedRequest('req-pe-1', BASE_REQ)
    // Pas de balance → BALANCE_NOT_FOUND

    await expect(
      confirmDealerRequestHandler(makeRequest(STORE_ADMIN_UID, { requestId: 'req-pe-1' }), { db, FieldValue })
    ).rejects.toMatchObject({ code: 'BALANCE_NOT_FOUND' })

    const reqSnap = await db.doc('dealerRequests/req-pe-1').get()
    expect(reqSnap.data().status).toBe('pending')
    const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.size).toBe(0)
    // Vérification absente auparavant : le document balance ne doit pas avoir été créé
    await expectNoPartialEffects({
      balanceRef: db.doc(`clients/${STORE_A}/networkBalances/current`),
      expectedBalance: null,
    })
  })

  it('[PE-02] balance décimale (100.5) → demande inchangée, solde inchangé, aucun audit', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedRequest('req-pe-2', BASE_REQ)
    const decimalBalance = {
      balances: { Orange: { stock: 100.5, liquidite: 30000 } },
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    }
    await seedBalance(STORE_A, decimalBalance)

    await expect(
      confirmDealerRequestHandler(makeRequest(STORE_ADMIN_UID, { requestId: 'req-pe-2' }), { db, FieldValue })
    ).rejects.toMatchObject({ code: 'INVALID_BALANCE_DATA' })

    const reqSnap = await db.doc('dealerRequests/req-pe-2').get()
    expect(reqSnap.data().status).toBe('pending')

    const balSnap = await db.doc(`clients/${STORE_A}/networkBalances/current`).get()
    expect(balSnap.data().balances.Orange.stock).toBe(100.5)

    const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.size).toBe(0)
  })

  it('[PE-03] balance string → demande inchangée, solde inchangé, aucun audit', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedRequest('req-pe-3', BASE_REQ)
    await seedBalance(STORE_A, {
      balances: { Orange: { stock: '50000', liquidite: 30000 } },
    })

    await expect(
      confirmDealerRequestHandler(makeRequest(STORE_ADMIN_UID, { requestId: 'req-pe-3' }), { db, FieldValue })
    ).rejects.toMatchObject({ code: 'INVALID_BALANCE_DATA' })

    const reqSnap = await db.doc('dealerRequests/req-pe-3').get()
    expect(reqSnap.data().status).toBe('pending')
    const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.size).toBe(0)
    // Vérification absente auparavant : solde inchangé (stock resté à la valeur string)
    await expectNoPartialEffects({
      balanceRef: db.doc(`clients/${STORE_A}/networkBalances/current`),
      expectedBalance: '50000', // la valeur string d'origine doit être préservée
    })
  })

  it('[PE-04] overflow → demande inchangée, solde inchangé, aucun audit', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedRequest('req-pe-4', { ...BASE_REQ, amount: 1 })
    await seedBalance(STORE_A, {
      balances: { Orange: { stock: Number.MAX_SAFE_INTEGER, liquidite: 0 } },
    })

    await expect(
      confirmDealerRequestHandler(makeRequest(STORE_ADMIN_UID, { requestId: 'req-pe-4' }), { db, FieldValue })
    ).rejects.toMatchObject({ code: 'BALANCE_OVERFLOW' })

    const reqSnap = await db.doc('dealerRequests/req-pe-4').get()
    expect(reqSnap.data().status).toBe('pending')
    const balSnap = await db.doc(`clients/${STORE_A}/networkBalances/current`).get()
    expect(balSnap.data().balances.Orange.stock).toBe(Number.MAX_SAFE_INTEGER)
    const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.size).toBe(0)
  })

  it('[PE-05] demande déjà confirmée → solde inchangé, aucun nouvel audit', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedRequest('req-pe-5', {
      ...BASE_REQ,
      status: 'confirmed', confirmedBy: STORE_ADMIN_UID, confirmedAt: new Date(),
      previousBalance: 40000, newBalance: 50000,
    })
    await seedBalance(STORE_A, BASE_BALANCE)

    await expect(
      confirmDealerRequestHandler(makeRequest(STORE_ADMIN_UID, { requestId: 'req-pe-5' }), { db, FieldValue })
    ).rejects.toMatchObject({ code: 'REQUEST_NOT_PENDING' })

    // Solde inchangé
    const balSnap = await db.doc(`clients/${STORE_A}/networkBalances/current`).get()
    expect(balSnap.data().balances.Orange.stock).toBe(50000)
    // Aucun audit
    const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.size).toBe(0)
  })

  it('[PE-06] mauvaise boutique → demande inchangée, solde inchangé, aucun audit', async () => {
    await seedUser(OTHER_ADMIN_UID, OTHER_ADMIN_PROFILE) // storeId = store-B
    await seedRequest('req-pe-6', BASE_REQ)               // targetStoreId = store-A
    await seedBalance(STORE_A, BASE_BALANCE)

    await expect(
      confirmDealerRequestHandler(makeRequest(OTHER_ADMIN_UID, { requestId: 'req-pe-6' }), { db, FieldValue })
    ).rejects.toMatchObject({ code: 'REQUEST_STORE_MISMATCH' })

    const reqSnap = await db.doc('dealerRequests/req-pe-6').get()
    expect(reqSnap.data().status).toBe('pending')
    const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.size).toBe(0)
    const auditSnapB = await db.collection(`clients/${STORE_B}/auditLogs`).get()
    expect(auditSnapB.size).toBe(0)
    // Vérification absente auparavant : solde de STORE_A inchangé
    await expectNoPartialEffects({
      balanceRef: db.doc(`clients/${STORE_A}/networkBalances/current`),
      expectedBalance: 50000,
    })
  })

  it('[PE-07] demande corrompue (confirmedBy set) → solde inchangé, aucun audit', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedRequest('req-pe-7', { ...BASE_REQ, confirmedBy: 'orphan-uid' }) // corrompu
    await seedBalance(STORE_A, BASE_BALANCE)

    await expect(
      confirmDealerRequestHandler(makeRequest(STORE_ADMIN_UID, { requestId: 'req-pe-7' }), { db, FieldValue })
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST_DATA' })

    const balSnap = await db.doc(`clients/${STORE_A}/networkBalances/current`).get()
    expect(balSnap.data().balances.Orange.stock).toBe(50000)
    const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.size).toBe(0)
    // Vérification absente auparavant : statut demande inchangé malgré données corrompues
    await expectNoPartialEffects({
      requestRef: db.doc('dealerRequests/req-pe-7'),
      expectedStatus: 'pending',
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §PE (complément) — effets partiels sur erreurs de profil
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-035-PE2 — effets partiels profil (pré-vérification)', () => {
  it('[PE-08] profil inactif (pre-check) → demande inchangée, aucun audit', async () => {
    await seedUser(INACTIVE_UID, INACTIVE_PROFILE)
    await seedRequest('req-pe-8', BASE_REQ)
    await seedBalance(STORE_A, BASE_BALANCE)

    await expect(
      confirmDealerRequestHandler(makeRequest(INACTIVE_UID, { requestId: 'req-pe-8' }), { db, FieldValue })
    ).rejects.toMatchObject({ code: 'PROFILE_INACTIVE' })

    const reqSnap = await db.doc('dealerRequests/req-pe-8').get()
    expect(reqSnap.data().status).toBe('pending')
    const balSnap = await db.doc(`clients/${STORE_A}/networkBalances/current`).get()
    expect(balSnap.data().balances.Orange.stock).toBe(50000)
    const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.size).toBe(0)
  })

  it('[PE-09] rôle interdit (pre-check) → demande inchangée, solde inchangé, aucun audit', async () => {
    await seedUser(DEALER_UID, DEALER_PROFILE)
    await seedRequest('req-pe-9', BASE_REQ)
    await seedBalance(STORE_A, BASE_BALANCE)

    await expect(
      confirmDealerRequestHandler(makeRequest(DEALER_UID, { requestId: 'req-pe-9' }), { db, FieldValue })
    ).rejects.toMatchObject({ code: 'ROLE_FORBIDDEN' })

    const reqSnap = await db.doc('dealerRequests/req-pe-9').get()
    expect(reqSnap.data().status).toBe('pending')
    const balSnap = await db.doc(`clients/${STORE_A}/networkBalances/current`).get()
    expect(balSnap.data().balances.Orange.stock).toBe(50000)
    const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.size).toBe(0)
  })

  it('[PE-10] storeId changé en transaction → REQUEST_STORE_MISMATCH, demande inchangée, aucun audit', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedRequest('req-pe-10', BASE_REQ) // targetStoreId = STORE_A
    await seedBalance(STORE_A, BASE_BALANCE)

    const iDb = makeSnapshotOverrideDb(db, `users/${STORE_ADMIN_UID}`, { storeId: STORE_B })

    await expect(
      confirmDealerRequestHandler(makeRequest(STORE_ADMIN_UID, { requestId: 'req-pe-10' }), { db: iDb, FieldValue })
    ).rejects.toMatchObject({ code: 'REQUEST_STORE_MISMATCH' })

    const reqSnap = await db.doc('dealerRequests/req-pe-10').get()
    expect(reqSnap.data().status).toBe('pending')
    const balSnap = await db.doc(`clients/${STORE_A}/networkBalances/current`).get()
    expect(balSnap.data().balances.Orange.stock).toBe(50000)
    const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.size).toBe(0)
    const auditSnapB = await db.collection(`clients/${STORE_B}/auditLogs`).get()
    expect(auditSnapB.size).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §PROF — Changements concurrents de profil
//
// Stratégie : makeSnapshotOverrideDb intercepte le premier t.get(targetPath)
// à l'intérieur de la transaction et retourne un snapshot synthétique dont
// les champs sont fusionnés avec overrideData. Cela simule le cas où le profil
// a été modifié entre le pre-check hors-transaction et la lecture in-transaction
// sans écriture externe (qui provoquerait un deadlock sur l'émulateur Firestore,
// car celui-ci utilise un verrou pessimiste sur les documents lus dans une
// transaction).
//
// Ce que le test vérifie : la logique métier in-transaction de validateProfileData
// détecte et rejette le profil invalide, laissant la demande et le solde intacts.
// ─────────────────────────────────────────────────────────────────────────────

function makeSnapshotOverrideDb(realDb, targetPath, overrideData) {
  return {
    doc:        (...args) => realDb.doc(...args),
    collection: (...args) => realDb.collection(...args),

    runTransaction: (callback) =>
      realDb.runTransaction(async (realTransaction) => {
        let overrideApplied = false

        const transactionProxy = {
          get: async (ref) => {
            const snapshot = await realTransaction.get(ref)
            if (!overrideApplied && ref.path === targetPath) {
              overrideApplied = true
              return {
                exists: snapshot.exists,
                id: snapshot.id,
                ref: snapshot.ref,
                data: () => ({ ...snapshot.data(), ...overrideData }),
              }
            }
            return snapshot
          },
          update: (...args) => realTransaction.update(...args),
          set:    (...args) => realTransaction.set(...args),
          create: (...args) => realTransaction.create(...args),
          delete: (...args) => realTransaction.delete(...args),
        }

        return callback(transactionProxy)
      }),
  }
}

describe('TC-035-PROF — changements concurrents de profil', () => {
  it('[PROF-01] confirm — profil active→false entre pre-check et commit → PROFILE_INACTIVE, demande inchangée, aucun audit', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedRequest('req-prof-1', BASE_REQ)
    await seedBalance(STORE_A, BASE_BALANCE)

    const iDb = makeSnapshotOverrideDb(db, `users/${STORE_ADMIN_UID}`, { active: false })

    await expect(
      confirmDealerRequestHandler(makeRequest(STORE_ADMIN_UID, { requestId: 'req-prof-1' }), { db: iDb, FieldValue })
    ).rejects.toMatchObject({ code: 'PROFILE_INACTIVE' })

    const reqSnap = await db.doc('dealerRequests/req-prof-1').get()
    expect(reqSnap.data().status).toBe('pending')
    const balSnap = await db.doc(`clients/${STORE_A}/networkBalances/current`).get()
    expect(balSnap.data().balances.Orange.stock).toBe(50000)
    const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.size).toBe(0)
  })

  it('[PROF-02] confirm — rôle changé entre pre-check et commit → ROLE_FORBIDDEN, demande inchangée, aucun audit', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedRequest('req-prof-2', BASE_REQ)
    await seedBalance(STORE_A, BASE_BALANCE)

    const iDb = makeSnapshotOverrideDb(db, `users/${STORE_ADMIN_UID}`, { role: 'dealer' })

    await expect(
      confirmDealerRequestHandler(makeRequest(STORE_ADMIN_UID, { requestId: 'req-prof-2' }), { db: iDb, FieldValue })
    ).rejects.toMatchObject({ code: 'ROLE_FORBIDDEN' })

    const reqSnap = await db.doc('dealerRequests/req-prof-2').get()
    expect(reqSnap.data().status).toBe('pending')
    const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.size).toBe(0)
  })

  it('[PROF-03] confirm — storeId changé entre pre-check et commit → REQUEST_STORE_MISMATCH, demande inchangée, aucun audit', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedRequest('req-prof-3', BASE_REQ) // targetStoreId = STORE_A
    await seedBalance(STORE_A, BASE_BALANCE)

    const iDb = makeSnapshotOverrideDb(db, `users/${STORE_ADMIN_UID}`, { storeId: STORE_B })

    await expect(
      confirmDealerRequestHandler(makeRequest(STORE_ADMIN_UID, { requestId: 'req-prof-3' }), { db: iDb, FieldValue })
    ).rejects.toMatchObject({ code: 'REQUEST_STORE_MISMATCH' })

    const reqSnap = await db.doc('dealerRequests/req-prof-3').get()
    expect(reqSnap.data().status).toBe('pending')
    const balSnap = await db.doc(`clients/${STORE_A}/networkBalances/current`).get()
    expect(balSnap.data().balances.Orange.stock).toBe(50000)
    const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.size).toBe(0)
    const auditSnapB = await db.collection(`clients/${STORE_B}/auditLogs`).get()
    expect(auditSnapB.size).toBe(0)
  })

  it('[PROF-04] reject — profil active→false entre pre-check et commit → PROFILE_INACTIVE, demande inchangée, aucun audit', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedRequest('req-prof-4', BASE_REQ)

    const iDb = makeSnapshotOverrideDb(db, `users/${STORE_ADMIN_UID}`, { active: false })

    await expect(
      rejectDealerRequestHandler(
        makeRequest(STORE_ADMIN_UID, { requestId: 'req-prof-4', rejectionReason: 'Motif valide.' }),
        { db: iDb, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'PROFILE_INACTIVE' })

    const reqSnap = await db.doc('dealerRequests/req-prof-4').get()
    expect(reqSnap.data().status).toBe('pending')
    const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.size).toBe(0)
  })

  it('[PROF-05] reject — rôle changé entre pre-check et commit → ROLE_FORBIDDEN, demande inchangée, aucun audit', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedRequest('req-prof-5', BASE_REQ)

    const iDb = makeSnapshotOverrideDb(db, `users/${STORE_ADMIN_UID}`, { role: 'system_manager' })

    await expect(
      rejectDealerRequestHandler(
        makeRequest(STORE_ADMIN_UID, { requestId: 'req-prof-5', rejectionReason: 'Motif valide.' }),
        { db: iDb, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'ROLE_FORBIDDEN' })

    const reqSnap = await db.doc('dealerRequests/req-prof-5').get()
    expect(reqSnap.data().status).toBe('pending')
    const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.size).toBe(0)
  })

  it('[PROF-06] reject — storeId changé entre pre-check et commit → REQUEST_STORE_MISMATCH, demande inchangée, aucun audit', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedRequest('req-prof-6', BASE_REQ) // targetStoreId = STORE_A

    const iDb = makeSnapshotOverrideDb(db, `users/${STORE_ADMIN_UID}`, { storeId: STORE_B })

    await expect(
      rejectDealerRequestHandler(
        makeRequest(STORE_ADMIN_UID, { requestId: 'req-prof-6', rejectionReason: 'Motif valide.' }),
        { db: iDb, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'REQUEST_STORE_MISMATCH' })

    const reqSnap = await db.doc('dealerRequests/req-prof-6').get()
    expect(reqSnap.data().status).toBe('pending')
    const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.size).toBe(0)
    const auditSnapB = await db.collection(`clients/${STORE_B}/auditLogs`).get()
    expect(auditSnapB.size).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §AU — Audit unique (preuve de retry-safety)
// ─────────────────────────────────────────────────────────────────────────────
// L'ID d'audit est généré via .doc() dans le callback de transaction.
// En cas de retry Firestore, un nouvel ID est créé mais seule la transaction
// finale commit son écriture → exactement un document audit par opération réussie.

describe('TC-035-AU — audit unique après transaction réussie', () => {
  it('[AU-01] confirmation réussie → exactement 1 document audit (pas de doublon)', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedRequest('req-au-1', BASE_REQ)
    await seedBalance(STORE_A, BASE_BALANCE)

    await confirmDealerRequestHandler(
      makeRequest(STORE_ADMIN_UID, { requestId: 'req-au-1' }),
      { db, FieldValue }
    )

    const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.size).toBe(1)
    expect(auditSnap.docs[0].data().action).toBe('DEALER_REQUEST_CONFIRMED')
    expect(auditSnap.docs[0].data().requestId).toBe('req-au-1')
  })

  it('[AU-02] rejet réussi → exactement 1 document audit (pas de doublon)', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedRequest('req-au-2', BASE_REQ)

    await rejectDealerRequestHandler(
      makeRequest(STORE_ADMIN_UID, { requestId: 'req-au-2', rejectionReason: 'Audit unique test.' }),
      { db, FieldValue }
    )

    const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.size).toBe(1)
    expect(auditSnap.docs[0].data().action).toBe('DEALER_REQUEST_REJECTED')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §MN — Multi-réseaux (chantier dealer multi-réseaux)
//   Le réseau est porté par la demande (reqData.network) et validé contre les
//   réseaux du profil (dealerNetworks, injectable). Sur un client mono-réseau
//   (défaut ['Orange']), une demande sur un autre réseau est refusée.
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-035-MN — dealer multi-réseaux', () => {
  it('[MN-01] confirme une demande Moov (dealerNetworks=[Orange,Moov]) → balances.Moov mis à jour, Orange préservé', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedRequest('req-moov', { ...BASE_REQ, network: 'Moov' })
    await seedBalance(STORE_A, BASE_BALANCE)

    const result = await confirmDealerRequestHandler(
      makeRequest(STORE_ADMIN_UID, { requestId: 'req-moov' }),
      { db, FieldValue, dealerNetworks: ['Orange', 'Moov'] }
    )

    expect(result.previousBalance).toBe(10000) // Moov.stock initial
    expect(result.newBalance).toBe(20000)      // + 10000

    const bal = (await db.doc(`clients/${STORE_A}/networkBalances/current`).get()).data()
    expect(bal.balances.Moov.stock).toBe(20000)
    expect(bal.balances.Orange.stock).toBe(50000) // autre réseau préservé

    const audit = (await db.collection(`clients/${STORE_A}/auditLogs`).get()).docs[0].data()
    expect(audit.network).toBe('Moov')
  })

  it('[MN-02] client mono-réseau (défaut Orange) : demande Moov refusée → INVALID_REQUEST_DATA, solde inchangé', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedRequest('req-moov-mono', { ...BASE_REQ, network: 'Moov' })
    await seedBalance(STORE_A, BASE_BALANCE)

    await expect(
      confirmDealerRequestHandler(
        makeRequest(STORE_ADMIN_UID, { requestId: 'req-moov-mono' }),
        { db, FieldValue } // dealerNetworks par défaut = ['Orange']
      )
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST_DATA' })

    const bal = (await db.doc(`clients/${STORE_A}/networkBalances/current`).get()).data()
    expect(bal.balances.Moov.stock).toBe(10000) // inchangé
    const auditSnap = await db.collection(`clients/${STORE_A}/auditLogs`).get()
    expect(auditSnap.size).toBe(0)
  })

  it('[MN-03] rejette une demande Moov (dealerNetworks=[Orange,Moov]) → status rejected, aucun solde touché', async () => {
    await seedUser(STORE_ADMIN_UID, STORE_ADMIN_PROFILE)
    await seedRequest('req-moov-rej', { ...BASE_REQ, network: 'Moov' })
    await seedBalance(STORE_A, BASE_BALANCE)

    await rejectDealerRequestHandler(
      makeRequest(STORE_ADMIN_UID, { requestId: 'req-moov-rej', rejectionReason: 'Rejet Moov valide.' }),
      { db, FieldValue, dealerNetworks: ['Orange', 'Moov'] }
    )

    const reqData = (await db.doc('dealerRequests/req-moov-rej').get()).data()
    expect(reqData.status).toBe('rejected')
    const bal = (await db.doc(`clients/${STORE_A}/networkBalances/current`).get()).data()
    expect(bal.balances.Moov.stock).toBe(10000) // inchangé
  })
})
