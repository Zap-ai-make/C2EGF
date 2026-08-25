/**
 * TC-060 — Tests unitaires des handlers addTransactionPayment et addTransactionRefund.
 *
 * Teste la logique métier des handlers en isolation totale (db mocké).
 * Couvre : validation, idempotence, calculs financiers, règles de dépassement.
 */

import { describe, it, expect, vi } from 'vitest'
import { addTransactionPaymentHandler } from '../../functions/src/settlements/addTransactionPayment.js'
import { addTransactionRefundHandler }  from '../../functions/src/settlements/addTransactionRefund.js'

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const ACTOR_UID  = 'actor-uid-060'
const STORE_ID   = 'store-060'
const DRAFT_ID   = 'draft-060'

const PROFILE_ADMIN = {
  active:  true,
  role:    'store_admin',
  storeId: STORE_ID,
  name:    'Test Admin',
  email:   'admin@test.com',
}

const BASE_DRAFT = {
  type:     'Dépôt',
  montant:  10000,
  clientId: 'client-001',
  reseau:   'Orange',
  statut:   'Non Terminées',
}

const BASE_BALANCES = {
  balances: {
    Orange:   { stock: 50000, liquidite: 20000 },
    Moov:     { stock: 10000, liquidite: 5000  },
    Telecel:  { stock: 5000,  liquidite: 1000  },
    Coris:    { stock: 2000,  liquidite: 500   },
    Sank:     { stock: 1000,  liquidite: 200   },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de mock
// ─────────────────────────────────────────────────────────────────────────────

function makeRequest(data, uid = ACTOR_UID) {
  return { auth: { uid }, data }
}

function makeDb({ draftData = BASE_DRAFT, profileData = PROFILE_ADMIN, balanceData = BASE_BALANCES, settlementExists = false, settlementData = null } = {}) {
  const written = []

  const makeTxSnap = (data, exists = true) => ({ exists: !!data && exists, data: () => data })
  // settlementData par défaut quand settlementExists=true (payload neutre pour les tests d'idempotence)
  const resolvedSettlementData = settlementExists ? (settlementData ?? { amount: 5000, paymentMethod: 'Cash', fullySettled: false }) : null

  const txGetAll = vi.fn(async (...refs) => refs.map(ref => {
    if (ref._path.endsWith(`drafts/${DRAFT_ID}`))      return makeTxSnap(draftData)
    if (ref._path.includes('/settlements/'))           return makeTxSnap(resolvedSettlementData, settlementExists)
    if (ref._path.endsWith('networkBalances/current')) return makeTxSnap(balanceData)
    if (ref._path.startsWith('users/'))                return makeTxSnap(profileData)
    return makeTxSnap(null, false)
  }))
  const txSet    = vi.fn((ref, data, opts) => written.push({ op: 'set', path: ref._path, data, opts }))
  const txUpdate = vi.fn((ref, data)       => written.push({ op: 'update', path: ref._path, data }))
  const txDelete = vi.fn((ref)             => written.push({ op: 'delete', path: ref._path }))

  const mockTx = {
    get:    vi.fn(async (ref) => {
      // Relecture du profil dans la transaction
      if (ref._path && ref._path.startsWith('users/')) return makeTxSnap(profileData)
      return makeTxSnap(null, false)
    }),
    getAll: txGetAll,
    set:    txSet,
    update: txUpdate,
    delete: txDelete,
  }

  const doc = (path) => ({
    _path: path,
    get:   async () => {
      if (path.startsWith('users/')) return makeTxSnap(profileData)
      return makeTxSnap(null, false)
    },
  })

  const collection = (path) => ({
    doc: (id = '_auto_') => doc(`${path}/${id}`),
  })

  const db = {
    doc:            (path) => doc(path),
    collection:     (path) => collection(path),
    runTransaction: vi.fn(async (fn) => fn(mockTx)),
  }

  return { db, written, mockTx }
}

const FieldValue = {
  serverTimestamp: () => ({ _type: 'serverTimestamp' }),
}

// ─────────────────────────────────────────────────────────────────────────────
// TC-060-A — addTransactionPayment : validation des entrées
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-060-A — addTransactionPayment : validation entrées', () => {
  it('rejette si non authentifié', async () => {
    const { db } = makeDb()
    await expect(
      addTransactionPaymentHandler({ auth: null, data: {} }, { db, FieldValue })
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('rejette si montant non entier', async () => {
    const { db } = makeDb()
    await expect(
      addTransactionPaymentHandler(
        makeRequest({ draftId: DRAFT_ID, amount: 1500.5, paymentMethod: 'Cash', idempotencyKey: 'k1' }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'INVALID_SETTLEMENT_AMOUNT' })
  })

  it('rejette si montant négatif', async () => {
    const { db } = makeDb()
    await expect(
      addTransactionPaymentHandler(
        makeRequest({ draftId: DRAFT_ID, amount: -500, paymentMethod: 'Cash', idempotencyKey: 'k1' }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'INVALID_SETTLEMENT_AMOUNT' })
  })

  it('rejette si méthode non autorisée', async () => {
    const { db } = makeDb()
    await expect(
      addTransactionPaymentHandler(
        makeRequest({ draftId: DRAFT_ID, amount: 5000, paymentMethod: 'Bitcoin', idempotencyKey: 'k1' }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'INVALID_PAYMENT_METHOD' })
  })

  it('rejette si profil inactif', async () => {
    const { db } = makeDb({ profileData: { ...PROFILE_ADMIN, active: false } })
    await expect(
      addTransactionPaymentHandler(
        makeRequest({ draftId: DRAFT_ID, amount: 5000, paymentMethod: 'Cash', idempotencyKey: 'k1' }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'PROFILE_INACTIVE' })
  })

  it('rejette si rôle dealer (non boutique)', async () => {
    const { db } = makeDb({ profileData: { ...PROFILE_ADMIN, role: 'dealer', storeId: undefined } })
    await expect(
      addTransactionPaymentHandler(
        makeRequest({ draftId: DRAFT_ID, amount: 5000, paymentMethod: 'Cash', idempotencyKey: 'k1' }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'ROLE_FORBIDDEN' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-060-B — addTransactionPayment : paiement complet (draft → history)
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-060-B — addTransactionPayment : paiement complet', () => {
  it('Dépôt payé intégralement → history créé, draft supprimé', async () => {
    const { db, written } = makeDb({ draftData: { ...BASE_DRAFT, type: 'Dépôt', montant: 10000 } })

    const result = await addTransactionPaymentHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 10000, paymentMethod: 'Orange Money', idempotencyKey: 'k1' }),
      { db, FieldValue }
    )

    expect(result.success).toBe(true)
    expect(result.fullySettled).toBe(true)

    const historyWrite = written.find(w => w.op === 'set' && w.path.includes('/history/'))
    expect(historyWrite).toBeDefined()
    expect(historyWrite.data.statut).toBe('Encaissé par Orange Money')
    expect(historyWrite.data.settlementStatus).toBe('settled')
    expect(historyWrite.data.remainingAmount).toBe(0)
    expect(historyWrite.data.paidAmount).toBe(10000)

    const draftDelete = written.find(w => w.op === 'delete' && w.path.includes(`/drafts/${DRAFT_ID}`))
    expect(draftDelete).toBeDefined()
  })

  it('Retrait payé → statut "Payé par Cash"', async () => {
    const { db, written } = makeDb({ draftData: { ...BASE_DRAFT, type: 'Retrait', montant: 5000 } })

    await addTransactionPaymentHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 5000, paymentMethod: 'Cash', idempotencyKey: 'k2' }),
      { db, FieldValue }
    )

    const historyWrite = written.find(w => w.op === 'set' && w.path.includes('/history/'))
    expect(historyWrite.data.statut).toBe('Payé par Cash')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-060-C — addTransactionPayment : paiement partiel
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-060-C — addTransactionPayment : paiement partiel', () => {
  it('paiement partiel → draft mis à jour, pas de suppression', async () => {
    const { db, written } = makeDb({ draftData: { ...BASE_DRAFT, montant: 10000 } })

    const result = await addTransactionPaymentHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 4000, paymentMethod: 'Cash', idempotencyKey: 'k3' }),
      { db, FieldValue }
    )

    expect(result.success).toBe(true)
    expect(result.fullySettled).toBe(false)

    const draftUpdate = written.find(w => w.op === 'update' && w.path.includes(`/drafts/${DRAFT_ID}`))
    expect(draftUpdate).toBeDefined()
    expect(draftUpdate.data.paidAmount).toBe(4000)
    expect(draftUpdate.data.remainingAmount).toBe(6000)
    expect(draftUpdate.data.settlementStatus).toBe('partial')

    const historyWrite = written.find(w => w.op === 'set' && w.path.includes('/history/'))
    expect(historyWrite).toBeUndefined()
  })

  it('initialisation lazy : originalAmount = montant si absent', async () => {
    const draftWithoutFields = { ...BASE_DRAFT, montant: 8000 }
    const { db, written } = makeDb({ draftData: draftWithoutFields })

    await addTransactionPaymentHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 3000, paymentMethod: 'Cash', idempotencyKey: 'k4' }),
      { db, FieldValue }
    )

    const draftUpdate = written.find(w => w.op === 'update' && w.path.includes(`/drafts/${DRAFT_ID}`))
    expect(draftUpdate.data.originalAmount).toBe(8000)
    expect(draftUpdate.data.paidAmount).toBe(3000)
    expect(draftUpdate.data.remainingAmount).toBe(5000)
  })

  it('rejette si montant > remainingAmount', async () => {
    const { db } = makeDb({ draftData: { ...BASE_DRAFT, montant: 5000, remainingAmount: 2000, paidAmount: 3000 } })

    await expect(
      addTransactionPaymentHandler(
        makeRequest({ draftId: DRAFT_ID, amount: 3000, paymentMethod: 'Cash', idempotencyKey: 'k5' }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'SETTLEMENT_EXCEEDS_REMAINING' })
  })

  it('rejette si transaction déjà entièrement réglée', async () => {
    const { db } = makeDb({ draftData: { ...BASE_DRAFT, montant: 5000, remainingAmount: 0, paidAmount: 5000, settlementStatus: 'settled' } })

    await expect(
      addTransactionPaymentHandler(
        makeRequest({ draftId: DRAFT_ID, amount: 1000, paymentMethod: 'Cash', idempotencyKey: 'k6' }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'SETTLEMENT_ALREADY_SETTLED' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-060-D — addTransactionPayment : idempotence
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-060-D — addTransactionPayment : idempotence', () => {
  it('retourne idempotent:true si settlement déjà créé avec le même payload', async () => {
    const { db, written } = makeDb({
      settlementExists: true,
      settlementData: { amount: 5000, paymentMethod: 'Cash', fullySettled: false },
    })

    const result = await addTransactionPaymentHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 5000, paymentMethod: 'Cash', idempotencyKey: 'k7' }),
      { db, FieldValue }
    )

    expect(result.success).toBe(true)
    expect(result.idempotent).toBe(true)
    expect(written).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-060-E — addTransactionRefund : validation et règles
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-060-E — addTransactionRefund : validation', () => {
  it('rejette si montant dépasse le net payé', async () => {
    const { db } = makeDb({
      draftData: {
        ...BASE_DRAFT,
        montant: 10000,
        originalAmount:  10000,
        paidAmount:      4000,
        refundedAmount:  1000,
        remainingAmount: 7000,
      }
    })

    await expect(
      addTransactionRefundHandler(
        makeRequest({ draftId: DRAFT_ID, amount: 5000, paymentMethod: 'Cash', idempotencyKey: 'r1' }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'REFUND_EXCEEDS_PAID' })
  })

  it('remboursement partiel → draft mis à jour avec refundedAmount et remainingAmount augmentés', async () => {
    const draftWithPayments = {
      ...BASE_DRAFT,
      originalAmount:  10000,
      paidAmount:      6000,
      refundedAmount:  0,
      remainingAmount: 4000,
    }
    const { db, written } = makeDb({ draftData: draftWithPayments })

    const result = await addTransactionRefundHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 2000, paymentMethod: 'Cash', idempotencyKey: 'r2' }),
      { db, FieldValue }
    )

    expect(result.success).toBe(true)

    const draftUpdate = written.find(w => w.op === 'update' && w.path.includes(`/drafts/${DRAFT_ID}`))
    expect(draftUpdate.data.refundedAmount).toBe(2000)
    expect(draftUpdate.data.remainingAmount).toBe(6000)
    expect(draftUpdate.data.settlementStatus).toBe('partial')

    // Pas de suppression ni de création history
    const historyWrite = written.find(w => w.op === 'set' && w.path.includes('/history/'))
    expect(historyWrite).toBeUndefined()
  })

  it('settlement de type refund est créé', async () => {
    const draftWithPayments = {
      ...BASE_DRAFT,
      originalAmount: 5000, paidAmount: 5000, refundedAmount: 0, remainingAmount: 0,
    }
    const { db, written } = makeDb({ draftData: draftWithPayments })

    await addTransactionRefundHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 1000, paymentMethod: 'Cash', idempotencyKey: 'r3' }),
      { db, FieldValue }
    )

    const settlementWrite = written.find(w => w.op === 'set' && w.path.includes('/settlements/'))
    expect(settlementWrite).toBeDefined()
    expect(settlementWrite.data.type).toBe('refund')
    expect(settlementWrite.data.amount).toBe(1000)
  })

  it('idempotence : retourne idempotent:true si déjà créé avec le même payload', async () => {
    const { db, written } = makeDb({
      settlementExists: true,
      settlementData: { amount: 2000, paymentMethod: 'Cash' },
    })

    const result = await addTransactionRefundHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 2000, paymentMethod: 'Cash', idempotencyKey: 'r4' }),
      { db, FieldValue }
    )

    expect(result.idempotent).toBe(true)
    expect(written).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-060-F — financialUtils : calculs de soldes
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-060-F — financialUtils', () => {
  it('addTransactionPayment Dépôt/Orange Money → stock Orange augmente', async () => {
    const { db, written } = makeDb({ draftData: { ...BASE_DRAFT, type: 'Dépôt', montant: 3000 } })

    await addTransactionPaymentHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 3000, paymentMethod: 'Orange Money', idempotencyKey: 'f1' }),
      { db, FieldValue }
    )

    const balanceWrite = written.find(w => w.op === 'set' && w.path.includes('networkBalances'))
    expect(balanceWrite.data.balances.Orange.stock).toBe(53000) // 50000 + 3000
  })

  it('addTransactionPayment Retrait/Cash → liquidite diminue', async () => {
    const { db, written } = makeDb({ draftData: { ...BASE_DRAFT, type: 'Retrait', montant: 5000 } })

    await addTransactionPaymentHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 5000, paymentMethod: 'Cash', idempotencyKey: 'f2' }),
      { db, FieldValue }
    )

    const balanceWrite = written.find(w => w.op === 'set' && w.path.includes('networkBalances'))
    // applyLiquidityDelta(-5000) : consomme Orange d'abord (20000-5000=15000)
    expect(balanceWrite.data.balances.Orange.liquidite).toBe(15000)
  })

  it('addTransactionRefund Dépôt/Cash → reversal : liquidite augmente', async () => {
    const draftWithPayments = {
      ...BASE_DRAFT, type: 'Dépôt',
      originalAmount: 5000, paidAmount: 5000, refundedAmount: 0, remainingAmount: 0,
    }
    const { db, written } = makeDb({ draftData: draftWithPayments })

    await addTransactionRefundHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 2000, paymentMethod: 'Cash', idempotencyKey: 'f3' }),
      { db, FieldValue }
    )

    const balanceWrite = written.find(w => w.op === 'set' && w.path.includes('networkBalances'))
    // reverseSettlementImpact Dépôt : delta = -2000 (on rend l'argent reçu)
    expect(balanceWrite.data.balances.Orange.liquidite).toBe(18000) // 20000 - 2000
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-060-G — Compatibilité anciens drafts (sans champs settlement)
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-060-G — Compatibilité anciens drafts (initialisation lazy)', () => {
  it('ancien draft sans originalAmount/paidAmount/remainingAmount → paiement partiel OK, pas de NaN', async () => {
    // Draft ancien : uniquement type, montant, clientId, reseau, statut
    const ancienDraft = { type: 'Dépôt', montant: 8000, clientId: 'cl-old', reseau: 'Orange', statut: 'Non Terminées' }
    const { db, written } = makeDb({ draftData: ancienDraft })

    const result = await addTransactionPaymentHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 3000, paymentMethod: 'Orange Money', idempotencyKey: 'g1' }),
      { db, FieldValue }
    )

    expect(result.success).toBe(true)
    expect(result.fullySettled).toBe(false)

    const draftUpdate = written.find(w => w.op === 'update' && w.path.includes(`/drafts/${DRAFT_ID}`))
    expect(draftUpdate).toBeDefined()
    expect(draftUpdate.data.originalAmount).toBe(8000)
    expect(draftUpdate.data.paidAmount).toBe(3000)
    expect(draftUpdate.data.remainingAmount).toBe(5000)
    expect(draftUpdate.data.settlementStatus).toBe('partial')

    // Aucun NaN dans les champs financiers
    expect(Number.isNaN(draftUpdate.data.paidAmount)).toBe(false)
    expect(Number.isNaN(draftUpdate.data.remainingAmount)).toBe(false)
  })

  it('ancien draft sans champs settlement → paiement complet OK', async () => {
    const ancienDraft = { type: 'Retrait', montant: 5000, clientId: 'cl-old', reseau: 'Orange', statut: 'Non Terminées' }
    const { db, written } = makeDb({ draftData: ancienDraft })

    const result = await addTransactionPaymentHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 5000, paymentMethod: 'Cash', idempotencyKey: 'g2' }),
      { db, FieldValue }
    )

    expect(result.success).toBe(true)
    expect(result.fullySettled).toBe(true)

    const historyWrite = written.find(w => w.op === 'set' && w.path.includes('/history/'))
    expect(historyWrite).toBeDefined()
    expect(historyWrite.data.settlementStatus).toBe('settled')
    expect(historyWrite.data.originalAmount).toBe(5000)
    expect(historyWrite.data.paidAmount).toBe(5000)
    expect(historyWrite.data.remainingAmount).toBe(0)
  })

  it('ancien draft sans champs settlement → remboursement rejeté si aucun paiement net', async () => {
    // Un ancien draft sans paidAmount a netPaid = 0 → REFUND_EXCEEDS_PAID
    const ancienDraft = { type: 'Dépôt', montant: 5000, clientId: 'cl-old', reseau: 'Orange', statut: 'Non Terminées' }
    const { db } = makeDb({ draftData: ancienDraft })

    await expect(
      addTransactionRefundHandler(
        makeRequest({ draftId: DRAFT_ID, amount: 1000, paymentMethod: 'Cash', idempotencyKey: 'g3' }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'REFUND_EXCEEDS_PAID' })
  })

  it('ancien draft avec paiements partiels déjà enregistrés → calcul correct', async () => {
    // Draft avec paidAmount=6000, refundedAmount=0 mais sans originalAmount (backward compat)
    const draftMixed = {
      type: 'Dépôt', montant: 10000, clientId: 'cl-mixed', reseau: 'Orange', statut: 'Non Terminées',
      paidAmount: 6000, refundedAmount: 0,
      // originalAmount absent : lazy init = montant = 10000
      // remainingAmount absent : lazy init = 10000 - 6000 + 0 = 4000
    }
    const { db, written } = makeDb({ draftData: draftMixed })

    const result = await addTransactionPaymentHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 4000, paymentMethod: 'Orange Money', idempotencyKey: 'g4' }),
      { db, FieldValue }
    )

    expect(result.success).toBe(true)
    expect(result.fullySettled).toBe(true)

    const historyWrite = written.find(w => w.op === 'set' && w.path.includes('/history/'))
    expect(historyWrite.data.paidAmount).toBe(10000) // 6000 + 4000
    expect(historyWrite.data.remainingAmount).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-060-H — Remboursement après finalisation complète
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-060-H — Remboursement après draft supprimé (finalisation complète)', () => {
  it('remboursement sur draftId inexistant → SETTLEMENT_DRAFT_NOT_FOUND', async () => {
    /**
     * Scénario : transaction payée intégralement (draft → history, draft supprimé).
     * Un appel de remboursement ultérieur avec le même draftId échoue car
     * addTransactionRefund ne travaille que sur les drafts.
     *
     * Comportement attendu et intentionnel : le remboursement post-finalisation
     * n'est pas supporté. Le bouton "Rembourser" n'est visible que sur les drafts
     * (table Non Terminées). Une transaction fully settled est en history et
     * n'apparaît plus dans la table des drafts, donc jamais proposée au remboursement.
     */
    const { db } = makeDb({ draftData: null })

    await expect(
      addTransactionRefundHandler(
        makeRequest({ draftId: DRAFT_ID, amount: 2000, paymentMethod: 'Cash', idempotencyKey: 'h1' }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'SETTLEMENT_DRAFT_NOT_FOUND' })
  })

  it('paiement sur draftId inexistant → SETTLEMENT_DRAFT_NOT_FOUND', async () => {
    const { db } = makeDb({ draftData: null })

    await expect(
      addTransactionPaymentHandler(
        makeRequest({ draftId: DRAFT_ID, amount: 5000, paymentMethod: 'Cash', idempotencyKey: 'h2' }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'SETTLEMENT_DRAFT_NOT_FOUND' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-060-I — Idempotence : conflit de payload
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-060-I — Idempotence : conflit de payload (IDEMPOTENCY_CONFLICT)', () => {
  it('même clé + montant différent → IDEMPOTENCY_CONFLICT', async () => {
    const { db } = makeDb({
      settlementExists: true,
      settlementData: { amount: 5000, paymentMethod: 'Cash', fullySettled: false },
    })

    await expect(
      addTransactionPaymentHandler(
        makeRequest({ draftId: DRAFT_ID, amount: 9999, paymentMethod: 'Cash', idempotencyKey: 'conflict-key' }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
  })

  it('même clé + méthode différente → IDEMPOTENCY_CONFLICT', async () => {
    const { db } = makeDb({
      settlementExists: true,
      settlementData: { amount: 5000, paymentMethod: 'Cash', fullySettled: false },
    })

    await expect(
      addTransactionPaymentHandler(
        makeRequest({ draftId: DRAFT_ID, amount: 5000, paymentMethod: 'Orange Money', idempotencyKey: 'conflict-key' }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
  })

  it('même clé + même payload → idempotent:true, aucune écriture', async () => {
    const { db, written } = makeDb({
      settlementExists: true,
      settlementData: { amount: 5000, paymentMethod: 'Cash', fullySettled: false },
    })

    const result = await addTransactionPaymentHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 5000, paymentMethod: 'Cash', idempotencyKey: 'existing-key' }),
      { db, FieldValue }
    )

    expect(result.idempotent).toBe(true)
    expect(result.success).toBe(true)
    expect(written).toHaveLength(0)
  })

  it('refund : même clé + montant différent → IDEMPOTENCY_CONFLICT', async () => {
    const { db } = makeDb({
      settlementExists: true,
      settlementData: { amount: 2000, paymentMethod: 'Cash' },
    })

    await expect(
      addTransactionRefundHandler(
        makeRequest({ draftId: DRAFT_ID, amount: 3000, paymentMethod: 'Cash', idempotencyKey: 'conflict-ref' }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
  })

  it('deux clés différentes pour le même draft → deux settlements distincts (pas de conflit)', async () => {
    const { db: db1, written: w1 } = makeDb({ settlementExists: false })
    const r1 = await addTransactionPaymentHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 3000, paymentMethod: 'Cash', idempotencyKey: 'key-A' }),
      { db: db1, FieldValue }
    )
    expect(r1.idempotent).toBe(false)
    expect(w1.some(w => w.op === 'set' && w.path.includes('/settlements/'))).toBe(true)

    const draftPartial = { ...BASE_DRAFT, montant: 10000, paidAmount: 3000, remainingAmount: 7000, originalAmount: 10000, refundedAmount: 0 }
    const { db: db2, written: w2 } = makeDb({ draftData: draftPartial, settlementExists: false })
    const r2 = await addTransactionPaymentHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 2000, paymentMethod: 'Cash', idempotencyKey: 'key-B' }),
      { db: db2, FieldValue }
    )
    expect(r2.idempotent).toBe(false)
    expect(w2.some(w => w.op === 'set' && w.path.includes('/settlements/'))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-060-J — Audit : vérification des champs écrits dans le document settlement
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-060-J — Audit : champs du document settlement', () => {
  it('paiement : le document settlement contient tous les champs d\'audit requis', async () => {
    const { db, written } = makeDb()

    await addTransactionPaymentHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 4000, paymentMethod: 'Orange Money', idempotencyKey: 'audit-pay-1' }, ACTOR_UID),
      { db, FieldValue }
    )

    const settlementWrite = written.find(w => w.op === 'set' && w.path.includes('/settlements/'))
    expect(settlementWrite).toBeDefined()

    const d = settlementWrite.data
    // Champs d'identité
    expect(d.type).toBe('payment')
    expect(d.amount).toBe(4000)
    expect(d.paymentMethod).toBe('Orange Money')
    expect(d.draftId).toBe(DRAFT_ID)
    expect(d.idempotencyKey).toBe('audit-pay-1')
    // Champs acteur
    expect(d.actorUid).toBe(ACTOR_UID)
    expect(d.actorRole).toBe('store_admin')
    expect(d.actorStoreId).toBe(STORE_ID)
    expect(d.actorName).toBe('Test Admin')
    // Réseau effectif
    expect(d.effectiveNetwork).toBe('Orange')
    // Timestamp
    expect(d.createdAt).toBeDefined()
  })

  it('remboursement : le document settlement contient tous les champs d\'audit requis', async () => {
    const draftWithPayments = {
      ...BASE_DRAFT, originalAmount: 10000, paidAmount: 6000, refundedAmount: 0, remainingAmount: 4000,
    }
    const { db, written } = makeDb({ draftData: draftWithPayments })

    await addTransactionRefundHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 2000, paymentMethod: 'Cash', idempotencyKey: 'audit-ref-1' }, ACTOR_UID),
      { db, FieldValue }
    )

    const settlementWrite = written.find(w => w.op === 'set' && w.path.includes('/settlements/'))
    expect(settlementWrite).toBeDefined()

    const d = settlementWrite.data
    expect(d.type).toBe('refund')
    expect(d.amount).toBe(2000)
    expect(d.paymentMethod).toBe('Cash')
    expect(d.draftId).toBe(DRAFT_ID)
    expect(d.idempotencyKey).toBe('audit-ref-1')
    expect(d.actorUid).toBe(ACTOR_UID)
    expect(d.actorRole).toBe('store_admin')
    expect(d.actorStoreId).toBe(STORE_ID)
    expect(d.createdAt).toBeDefined()
  })

  it('paiement complet : l\'ID du settlement suit le format pmt_{draftId}_{uid}_{key}', async () => {
    const { db, written } = makeDb()

    await addTransactionPaymentHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 10000, paymentMethod: 'Cash', idempotencyKey: 'audit-id-1' }, ACTOR_UID),
      { db, FieldValue }
    )

    const settlementWrite = written.find(w => w.op === 'set' && w.path.includes('/settlements/'))
    expect(settlementWrite).toBeDefined()

    const expectedId = `pmt_${DRAFT_ID}_${ACTOR_UID}_audit-id-1`
    expect(settlementWrite.path).toContain(expectedId)
  })

  it('remboursement : l\'ID du settlement suit le format ref_{draftId}_{uid}_{key}', async () => {
    const draftWithPayments = {
      ...BASE_DRAFT, originalAmount: 5000, paidAmount: 5000, refundedAmount: 0, remainingAmount: 0,
    }
    const { db, written } = makeDb({ draftData: draftWithPayments })

    await addTransactionRefundHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 1000, paymentMethod: 'Cash', idempotencyKey: 'audit-id-2' }, ACTOR_UID),
      { db, FieldValue }
    )

    const settlementWrite = written.find(w => w.op === 'set' && w.path.includes('/settlements/'))
    expect(settlementWrite).toBeDefined()

    const expectedId = `ref_${DRAFT_ID}_${ACTOR_UID}_audit-id-2`
    expect(settlementWrite.path).toContain(expectedId)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-060-K — Concurrence : deux paiements séquentiels sur le même draft
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-060-K — Concurrence (simulation séquentielle sur mocks)', () => {
  it('deux paiements partiels successifs avec clés différentes → pas de double impact', async () => {
    /**
     * Dans un vrai environnement, les deux transactions Firestore seraient atomiques.
     * En mock, on simule la séquence en mettant à jour l'état du draft après le premier appel.
     */
    const draft1 = { ...BASE_DRAFT, montant: 10000 }
    const { db: db1, written: w1 } = makeDb({ draftData: draft1 })

    const r1 = await addTransactionPaymentHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 4000, paymentMethod: 'Cash', idempotencyKey: 'conc-1' }),
      { db: db1, FieldValue }
    )
    expect(r1.idempotent).toBe(false)

    // État du draft après le premier paiement
    const draftAfter1 = {
      ...draft1,
      originalAmount: 10000, paidAmount: 4000, refundedAmount: 0, remainingAmount: 6000, settlementStatus: 'partial',
    }
    const { db: db2, written: w2 } = makeDb({ draftData: draftAfter1 })

    const r2 = await addTransactionPaymentHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 3000, paymentMethod: 'Cash', idempotencyKey: 'conc-2' }),
      { db: db2, FieldValue }
    )
    expect(r2.idempotent).toBe(false)

    const draftUpdate2 = w2.find(w => w.op === 'update' && w.path.includes(`/drafts/${DRAFT_ID}`))
    expect(draftUpdate2.data.paidAmount).toBe(7000)    // 4000 + 3000
    expect(draftUpdate2.data.remainingAmount).toBe(3000) // 10000 - 7000
    expect(draftUpdate2.data.settlementStatus).toBe('partial')

    // Aucune balance dupliquée : chaque appel écrit une mise à jour balances séparée
    const balWrites1 = w1.filter(w => w.op === 'set' && w.path.includes('networkBalances'))
    const balWrites2 = w2.filter(w => w.op === 'set' && w.path.includes('networkBalances'))
    expect(balWrites1).toHaveLength(1)
    expect(balWrites2).toHaveLength(1)
  })

  it('deux paiements avec la même clé (réseau flaky) → un seul traitement', async () => {
    // Premier appel : pas de settlement existant
    const { db: db1, written: w1 } = makeDb({ settlementExists: false })
    const r1 = await addTransactionPaymentHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 5000, paymentMethod: 'Cash', idempotencyKey: 'retry-key' }),
      { db: db1, FieldValue }
    )
    expect(r1.idempotent).toBe(false)
    expect(w1.filter(w => w.op === 'set' && w.path.includes('/settlements/'))).toHaveLength(1)

    // Deuxième appel (retry réseau) : settlement déjà créé avec exactement le même payload
    const { db: db2, written: w2 } = makeDb({
      settlementExists: true,
      settlementData: { amount: 5000, paymentMethod: 'Cash', fullySettled: false },
    })
    const r2 = await addTransactionPaymentHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 5000, paymentMethod: 'Cash', idempotencyKey: 'retry-key' }),
      { db: db2, FieldValue }
    )
    expect(r2.idempotent).toBe(true)
    expect(w2).toHaveLength(0) // Aucune écriture supplémentaire
  })

  it('paiement et remboursement séquentiels → état cohérent', async () => {
    // Paiement partiel de 7000 sur draft de 10000
    const draft = { ...BASE_DRAFT, montant: 10000 }
    const { db: dbPay } = makeDb({ draftData: draft })

    await addTransactionPaymentHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 7000, paymentMethod: 'Orange Money', idempotencyKey: 'pr-pay' }),
      { db: dbPay, FieldValue }
    )

    const draftAfterPay = {
      ...draft,
      originalAmount: 10000, paidAmount: 7000, refundedAmount: 0, remainingAmount: 3000, settlementStatus: 'partial',
    }

    // Remboursement de 2000
    const { db: dbRef, written: wRef } = makeDb({ draftData: draftAfterPay })
    const rRef = await addTransactionRefundHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 2000, paymentMethod: 'Orange Money', idempotencyKey: 'pr-ref' }),
      { db: dbRef, FieldValue }
    )

    expect(rRef.success).toBe(true)

    const draftUpdate = wRef.find(w => w.op === 'update' && w.path.includes(`/drafts/${DRAFT_ID}`))
    expect(draftUpdate.data.paidAmount).toBe(7000)          // inchangé
    expect(draftUpdate.data.refundedAmount).toBe(2000)
    expect(draftUpdate.data.remainingAmount).toBe(5000)     // 3000 + 2000 (dette rouverte)
    expect(draftUpdate.data.settlementStatus).toBe('partial')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-060-L — Audit du conflit d'idempotence : log serveur émis EXACTEMENT une fois
//
// Correctif M2 : le détail du conflit (montants/méthode) est capturé DANS la
// transaction mais journalisé UNE SEULE fois hors transaction (dans le catch),
// pour éviter les doublons si le corps de la transaction est rejoué sur contention.
// On injecte un logWriter espion et on vérifie le nombre exact d'appels.
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-060-L — Log d\'audit du conflit d\'idempotence (émission unique)', () => {
  it('paiement : conflit de payload → logWriter appelé EXACTEMENT une fois (WARNING, event dédié)', async () => {
    const logWriter = vi.fn()
    const { db } = makeDb({
      settlementExists: true,
      settlementData: { amount: 5000, paymentMethod: 'Cash', fullySettled: false },
    })

    await expect(
      addTransactionPaymentHandler(
        makeRequest({ draftId: DRAFT_ID, amount: 9999, paymentMethod: 'Cash', idempotencyKey: 'conflict-log-1' }),
        { db, FieldValue, logWriter }
      )
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })

    // Émission unique — pas de doublon sur retry.
    expect(logWriter).toHaveBeenCalledTimes(1)
    const logged = logWriter.mock.calls[0][0]
    expect(logged.severity).toBe('WARNING')
    expect(logged.event).toBe('SETTLEMENT_IDEMPOTENCY_CONFLICT')
    expect(logged.action).toBe('addTransactionPayment')
    expect(logged.existingAmount).toBe(5000)
    expect(logged.newAmount).toBe(9999)
  })

  it('paiement : re-exécution du corps de transaction (contention) → toujours un seul log', async () => {
    // Simule un retry de la transaction Firestore : runTransaction rappelle le corps
    // deux fois. Le log ne doit être émis qu'une fois, hors transaction.
    const logWriter = vi.fn()
    const base = makeDb({
      settlementExists: true,
      settlementData: { amount: 5000, paymentMethod: 'Cash', fullySettled: false },
    })
    base.db.runTransaction = vi.fn(async (fn) => {
      // Premier passage : le corps lève (capture le conflit). Firestore rejouerait
      // silencieusement le corps sur contention — on avale donc cette 1re erreur.
      try { await fn(base.mockTx) } catch { /* rejeu comme Firestore */ }
      // Second passage : le corps relève ; c'est cette erreur qui remonte au handler.
      return fn(base.mockTx)
    })

    await expect(
      addTransactionPaymentHandler(
        makeRequest({ draftId: DRAFT_ID, amount: 9999, paymentMethod: 'Cash', idempotencyKey: 'conflict-log-retry' }),
        { db: base.db, FieldValue, logWriter }
      )
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })

    expect(logWriter).toHaveBeenCalledTimes(1)
  })

  it('paiement : même payload (idempotent OK) → aucun log de conflit', async () => {
    const logWriter = vi.fn()
    const { db } = makeDb({
      settlementExists: true,
      settlementData: { amount: 5000, paymentMethod: 'Cash', fullySettled: false },
    })

    const result = await addTransactionPaymentHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 5000, paymentMethod: 'Cash', idempotencyKey: 'no-conflict' }),
      { db, FieldValue, logWriter }
    )

    expect(result.idempotent).toBe(true)
    expect(logWriter).not.toHaveBeenCalled()
  })

  it('paiement : succès partiel normal → aucun log de conflit', async () => {
    const logWriter = vi.fn()
    const { db } = makeDb({ draftData: { ...BASE_DRAFT, montant: 10000 } })

    await addTransactionPaymentHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 4000, paymentMethod: 'Cash', idempotencyKey: 'ok-partial' }),
      { db, FieldValue, logWriter }
    )

    expect(logWriter).not.toHaveBeenCalled()
  })

  it('remboursement : conflit de payload → logWriter appelé EXACTEMENT une fois (action refund)', async () => {
    const logWriter = vi.fn()
    const { db } = makeDb({
      settlementExists: true,
      settlementData: { amount: 2000, paymentMethod: 'Cash' },
    })

    await expect(
      addTransactionRefundHandler(
        makeRequest({ draftId: DRAFT_ID, amount: 3000, paymentMethod: 'Cash', idempotencyKey: 'conflict-log-ref' }),
        { db, FieldValue, logWriter }
      )
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })

    expect(logWriter).toHaveBeenCalledTimes(1)
    const logged = logWriter.mock.calls[0][0]
    expect(logged.severity).toBe('WARNING')
    expect(logged.event).toBe('SETTLEMENT_IDEMPOTENCY_CONFLICT')
    expect(logged.action).toBe('addTransactionRefund')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-060-M — Défense en profondeur : type ÉPINGLÉ (settlementType) prime sur draft.type
//
// Correctif C1 (défense en profondeur) : dès la 1re tranche, le handler épingle le
// type dans un champ serveur immuable (settlementType) et le relit ensuite. Même si
// le gel des règles Firestore était contourné et draft.type falsifié entre deux
// tranches, le signe de l'impact réseau reste déterminé par settlementType.
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-060-M — Type épinglé (settlementType) neutralise l\'inversion de signe', () => {
  it('paiement : 1re tranche → settlementType est écrit sur le draft (égal à draft.type)', async () => {
    const { db, written } = makeDb({ draftData: { ...BASE_DRAFT, type: 'Retrait', montant: 10000 } })

    await addTransactionPaymentHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 4000, paymentMethod: 'Orange Money', idempotencyKey: 'pin-1' }),
      { db, FieldValue }
    )

    const draftUpdate = written.find(w => w.op === 'update' && w.path.includes(`/drafts/${DRAFT_ID}`))
    expect(draftUpdate.data.settlementType).toBe('Retrait')
  })

  it('paiement : draft.type falsifié (Dépôt) mais settlementType=Retrait → impact reste un DÉBIT', async () => {
    // Simule un draft dont le gel des règles aurait été contourné : draft.type a été
    // basculé en 'Dépôt' entre deux tranches, mais settlementType='Retrait' est épinglé.
    const tamperedDraft = {
      ...BASE_DRAFT,
      type:            'Dépôt',      // ← falsifié
      settlementType:  'Retrait',    // ← épinglé à la 1re tranche (source de vérité)
      originalAmount:  10000,
      paidAmount:      4000,
      refundedAmount:  0,
      remainingAmount: 6000,
      settlementStatus: 'partial',
    }
    const { db, written } = makeDb({ draftData: tamperedDraft })

    await addTransactionPaymentHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 5000, paymentMethod: 'Cash', idempotencyKey: 'pin-2' }),
      { db, FieldValue }
    )

    const balanceWrite = written.find(w => w.op === 'set' && w.path.includes('networkBalances'))
    // Retrait/Cash ⇒ liquidité DÉBITÉE : 20000 - 5000 = 15000 (et non +5000 si Dépôt).
    expect(balanceWrite.data.balances.Orange.liquidite).toBe(15000)

    // settlementType reste épinglé sur Retrait après la tranche.
    const draftUpdate = written.find(w => w.op === 'update' && w.path.includes(`/drafts/${DRAFT_ID}`))
    expect(draftUpdate.data.settlementType).toBe('Retrait')
  })

  it('remboursement : draft.type falsifié mais settlementType=Retrait → reversal reste un CRÉDIT', async () => {
    // Retrait remboursé ⇒ reverseSettlementImpact rend les fonds (liquidité +amount).
    const tamperedDraft = {
      ...BASE_DRAFT,
      type:            'Dépôt',      // ← falsifié (donnerait -amount à tort)
      settlementType:  'Retrait',    // ← épinglé
      originalAmount:  10000,
      paidAmount:      6000,
      refundedAmount:  0,
      remainingAmount: 4000,
      settlementStatus: 'partial',
    }
    const { db, written } = makeDb({ draftData: tamperedDraft })

    await addTransactionRefundHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 2000, paymentMethod: 'Cash', idempotencyKey: 'pin-3' }),
      { db, FieldValue }
    )

    const balanceWrite = written.find(w => w.op === 'set' && w.path.includes('networkBalances'))
    // Retrait remboursé ⇒ +2000 : 20000 + 2000 = 22000 (et non -2000 si Dépôt).
    expect(balanceWrite.data.balances.Orange.liquidite).toBe(22000)
  })

  it('paiement complet : settlementType épinglé propagé dans le document history', async () => {
    const { db, written } = makeDb({ draftData: { ...BASE_DRAFT, type: 'Retrait', montant: 5000 } })

    await addTransactionPaymentHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 5000, paymentMethod: 'Cash', idempotencyKey: 'pin-4' }),
      { db, FieldValue }
    )

    const historyWrite = written.find(w => w.op === 'set' && w.path.includes('/history/'))
    expect(historyWrite.data.settlementType).toBe('Retrait')
    expect(historyWrite.data.statut).toBe('Payé par Cash')
  })
})
