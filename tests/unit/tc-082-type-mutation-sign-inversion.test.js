/**
 * TC-082 — Preuve unitaire de l'inversion de signe (faille C1)
 *
 * Comportement démontré :
 *   Un draft de type='Retrait' subit un premier règlement partiel (tranche 1).
 *   Entre les deux tranches, draft.type est muté en 'Dépôt' (ce que FREEZE-01 prouve
 *   possible via les règles Firestore actuelles).
 *   La tranche 2 calcule un delta POSITIF (+amount) au lieu de NÉGATIF (-amount),
 *   ce qui AUGMENTE le stock Orange au lieu de le diminuer.
 *
 *   applySettlementImpact (financialUtils.js:153) :
 *     delta = isRetrait(txData.type) ? -amount : amount
 *
 *   Tranche 1 (type='Retrait') : delta = -30000 → stock Orange 50000 → 20000
 *   Tranche 2 (type='Dépôt' après mutation) : delta = +30000 → stock Orange 20000 → 50000
 *   Résultat : le stock revient à son niveau initial malgré un Retrait client de 60000 FCFA.
 *
 * Ce fichier ne modifie pas tc-060. Il est autonome.
 * DB mocké, pas d'émulateur.
 */

import { describe, it, expect, vi } from 'vitest'
import { addTransactionPaymentHandler } from '../../functions/src/settlements/addTransactionPayment.js'

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const ACTOR_UID = 'actor-uid-082'
const STORE_ID  = 'store-082'
const DRAFT_ID  = 'draft-082'

const PROFILE = {
  active:  true,
  role:    'member',
  storeId: STORE_ID,
  name:    'Caissière Test',
  email:   'caisse@test.com',
}

// Soldes initiaux : Orange stock=50000
const BALANCES_INITIAL = {
  balances: {
    Orange:  { stock: 50000, liquidite: 10000 },
    Moov:    { stock: 5000,  liquidite: 2000  },
    Telecel: { stock: 1000,  liquidite: 500   },
    Coris:   { stock: 500,   liquidite: 100   },
    Sank:    { stock: 200,   liquidite: 50    },
  },
}

const FieldValue = {
  serverTimestamp: () => ({ _type: 'serverTimestamp' }),
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper de mock DB
// Capture les soldes écrits dans networkBalances pour assertion ultérieure.
// ─────────────────────────────────────────────────────────────────────────────

function makeDb({ draftData, balanceData = BALANCES_INITIAL, settlementExists = false }) {
  const written = []

  const makeTxSnap = (data, exists = true) => ({ exists: !!data && exists, data: () => data })
  const settlementData = settlementExists
    ? { amount: 30000, paymentMethod: 'Orange Money', fullySettled: false }
    : null

  const txGetAll = vi.fn(async (...refs) =>
    refs.map((ref) => {
      if (ref._path.endsWith(`drafts/${DRAFT_ID}`))       return makeTxSnap(draftData)
      if (ref._path.includes('/settlements/'))            return makeTxSnap(settlementData, settlementExists)
      if (ref._path.endsWith('networkBalances/current'))  return makeTxSnap(balanceData)
      return makeTxSnap(null, false)
    })
  )

  const txSet    = vi.fn((ref, data, opts) => written.push({ op: 'set',    path: ref._path, data, opts }))
  const txUpdate = vi.fn((ref, data)       => written.push({ op: 'update', path: ref._path, data }))
  const txDelete = vi.fn((ref)             => written.push({ op: 'delete', path: ref._path }))

  const mockTx = {
    get:    vi.fn(async (ref) => {
      if (ref._path?.startsWith('users/')) return makeTxSnap(PROFILE)
      return makeTxSnap(null, false)
    }),
    getAll: txGetAll,
    set:    txSet,
    update: txUpdate,
    delete: txDelete,
  }

  const db = {
    doc:        (path) => ({
      _path: path,
      get:   async () => {
        if (path.startsWith('users/')) return makeTxSnap(PROFILE)
        return makeTxSnap(null, false)
      },
    }),
    collection: (path) => ({ doc: (id = '_auto_') => ({ _path: `${path}/${id}` }) }),
    runTransaction: vi.fn(async (fn) => fn(mockTx)),
  }

  return { db, written }
}

function makeRequest(data) {
  return { auth: { uid: ACTOR_UID }, data }
}

// ─────────────────────────────────────────────────────────────────────────────
// TC-082-A — Tranche 1 légitime (type='Retrait') : delta négatif attendu
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-082-A — Tranche 1 légitime sur Retrait : delta négatif (référence)', () => {
  it('Retrait/Orange Money tranche 1 → stock Orange DIMINUE de 30000', async () => {
    // Draft original : Retrait de 100000 FCFA, aucun champ de règlement encore
    const draftTranche1 = {
      type:     'Retrait',
      montant:  100000,
      clientId: 'client-082',
      storeId:  STORE_ID,
      statut:   'Non Terminées',
      reseau:   'Orange',
    }

    const { db, written } = makeDb({ draftData: draftTranche1 })

    const result = await addTransactionPaymentHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 30000, paymentMethod: 'Orange Money', idempotencyKey: 't1-legit' }),
      { db, FieldValue }
    )

    expect(result.success).toBe(true)
    expect(result.fullySettled).toBe(false)

    const balWrite = written.find(w => w.op === 'set' && w.path.includes('networkBalances'))
    expect(balWrite).toBeDefined()

    // Retrait → delta = -30000 → stock Orange : 50000 - 30000 = 20000
    expect(balWrite.data.balances.Orange.stock).toBe(20000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-082-B — Tranche 2 APRÈS MUTATION C1 (type='Dépôt') : delta positif inversé
//
// Ce test démontre que si un attaquant exploite la faille C1 (FREEZE-01) entre
// les deux tranches, le handler applique un delta POSITIF sur Orange stock au
// lieu d'un delta NÉGATIF. L'impact est exactement opposé à l'attendu.
//
// Le mock simule l'état du draft après que :
//   1. La tranche 1 a été enregistrée (settlementStatus='partial', paidAmount=30000).
//   2. Un membre malveillant a muté type 'Retrait' → 'Dépôt' via l'exploit C1.
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-082-B — PREUVE C1 : inversion de signe après mutation type Retrait→Dépôt', () => {
  it('PREUVE C1 : Retrait muté en Dépôt entre deux tranches → stock Orange AUGMENTE au lieu de DIMINUER', async () => {
    // État du draft APRÈS mutation C1 :
    //   - type a été changé de 'Retrait' à 'Dépôt' par l'exploitant (trou FREEZE-01)
    //   - les champs de règlement restent tels que la CF les a écrits (non mutables)
    const draftApresC1 = {
      type:     'Dépôt',        // MUTÉ par l'attaquant (était 'Retrait')
      montant:  100000,
      clientId: 'client-082',
      storeId:  STORE_ID,
      statut:   'Non Terminées',
      reseau:   'Orange',
      // Champs écrits par la CF après tranche 1 (non altérables par le client)
      originalAmount:  100000,
      paidAmount:      30000,
      refundedAmount:  0,
      remainingAmount: 70000,
      settlementStatus: 'partial',
      settlementSummary: { netByNetwork: { Orange: { paid: 30000, refunded: 0 } } },
    }

    // Les soldes courants reflètent l'état APRÈS tranche 1 légitime (stock=20000)
    const balancesApres1 = {
      balances: {
        Orange:  { stock: 20000, liquidite: 10000 },
        Moov:    { stock: 5000,  liquidite: 2000  },
        Telecel: { stock: 1000,  liquidite: 500   },
        Coris:   { stock: 500,   liquidite: 100   },
        Sank:    { stock: 200,   liquidite: 50    },
      },
    }

    const { db, written } = makeDb({ draftData: draftApresC1, balanceData: balancesApres1 })

    const result = await addTransactionPaymentHandler(
      makeRequest({ draftId: DRAFT_ID, amount: 30000, paymentMethod: 'Orange Money', idempotencyKey: 't2-attack' }),
      { db, FieldValue }
    )

    expect(result.success).toBe(true)
    expect(result.fullySettled).toBe(false)

    const balWrite = written.find(w => w.op === 'set' && w.path.includes('networkBalances'))
    expect(balWrite).toBeDefined()

    // COMPORTEMENT RÉEL APRÈS MUTATION C1 :
    // Le handler lit draft.type='Dépôt' (muté) et calcule delta = +30000.
    // Résultat : stock Orange passe de 20000 à 50000 (revient au niveau INITIAL).
    // C'est l'INVERSE de ce qui devrait se passer (un Retrait devrait faire -30000).
    expect(balWrite.data.balances.Orange.stock).toBe(50000) // 20000 + 30000 (INVERSION)

    // Pour démontrer l'impact : après deux tranches de 30000 FCFA sur un Retrait de 100000 FCFA,
    // le stock Orange devrait être à 50000 - 30000 - 30000 = -10000 (ou rejet d'insufficient stock).
    // Or l'exploit C1 l'amène à 50000 (niveau initial) — 60000 FCFA de Retrait non débités.
  })

  it('PREUVE C1 contraire : tranche 2 LÉGITIME (type=Retrait intact, stock insuffisant) → rejetée par le handler', async () => {
    // Ce test de référence démontre le comportement CORRECT sans exploit.
    // Après tranche 1 (stock=20000), une tranche 2 de 30000 en Retrait dépasse le stock.
    // Le handler lève une erreur de stock insuffisant — la protection financière normale fonctionne.
    // Avec l'exploit C1 (type muté en Dépôt), cette même tranche passerait et gonflerait le stock.
    const draftSansC1 = {
      type:     'Retrait',      // Non muté — comportement légal
      montant:  100000,
      clientId: 'client-082',
      storeId:  STORE_ID,
      statut:   'Non Terminées',
      reseau:   'Orange',
      originalAmount:  100000,
      paidAmount:      30000,
      refundedAmount:  0,
      remainingAmount: 70000,
      settlementStatus: 'partial',
      settlementSummary: { netByNetwork: { Orange: { paid: 30000, refunded: 0 } } },
    }

    const balancesApres1 = {
      balances: {
        Orange:  { stock: 20000, liquidite: 10000 },
        Moov:    { stock: 5000,  liquidite: 2000  },
        Telecel: { stock: 1000,  liquidite: 500   },
        Coris:   { stock: 500,   liquidite: 100   },
        Sank:    { stock: 200,   liquidite: 50    },
      },
    }

    const { db } = makeDb({ draftData: draftSansC1, balanceData: balancesApres1 })

    // COMPORTEMENT CORRECT sans exploit : stock=20000 < tranche=30000 → rejeté (stock insuffisant)
    // Le handler enveloppe l'erreur de stock dans TRANSACTION_FAILED.
    await expect(
      addTransactionPaymentHandler(
        makeRequest({ draftId: DRAFT_ID, amount: 30000, paymentMethod: 'Orange Money', idempotencyKey: 't2-legit' }),
        { db, FieldValue }
      )
    ).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// TC-082-C — Démonstration de l'inversion de delta via financialUtils directement
// ─────────────────────────────────────────────────────────────────────────────

describe('TC-082-C — Delta inversé prouvé par financialUtils directement', () => {
  it('applySettlementImpact type=\'Retrait\' → delta négatif sur Orange stock', async () => {
    // Import direct de financialUtils pour tester la logique pure
    const { applySettlementImpact } = await import('../../functions/src/settlements/financialUtils.js')

    const balances = {
      Orange:  { stock: 50000, liquidite: 10000 },
      Moov:    { stock: 5000,  liquidite: 2000  },
      Telecel: { stock: 1000,  liquidite: 500   },
      Coris:   { stock: 500,   liquidite: 100   },
      Sank:    { stock: 200,   liquidite: 50    },
    }

    const result = applySettlementImpact(
      balances,
      { type: 'Retrait', montant: 20000 },
      'Orange Money'
    )

    // Retrait → delta = -20000 → stock Orange diminue
    expect(result.Orange.stock).toBe(30000) // 50000 - 20000
  })

  it('applySettlementImpact type=\'Dépôt\' (simulation mutation C1) → delta POSITIF sur Orange stock', async () => {
    const { applySettlementImpact } = await import('../../functions/src/settlements/financialUtils.js')

    const balances = {
      Orange:  { stock: 30000, liquidite: 10000 },
      Moov:    { stock: 5000,  liquidite: 2000  },
      Telecel: { stock: 1000,  liquidite: 500   },
      Coris:   { stock: 500,   liquidite: 100   },
      Sank:    { stock: 200,   liquidite: 50    },
    }

    // SIMULATION : même montant, mais type='Dépôt' après mutation C1
    const result = applySettlementImpact(
      balances,
      { type: 'Dépôt', montant: 20000 },
      'Orange Money'
    )

    // Dépôt → delta = +20000 → stock Orange AUGMENTE (inversion complète du comportement)
    expect(result.Orange.stock).toBe(50000) // 30000 + 20000 (au lieu de 30000 - 20000 = 10000)
  })

  it('PREUVE C1 quantifiée : delta total sur 2 tranches — légitime vs après mutation', async () => {
    const { applySettlementImpact } = await import('../../functions/src/settlements/financialUtils.js')

    const stockInitial = 50000
    const montantTranche = 20000

    // Scénario LÉGITIME : deux tranches de Retrait
    const balancesT0 = {
      Orange:  { stock: stockInitial, liquidite: 10000 },
      Moov:    { stock: 0, liquidite: 0 }, Telecel: { stock: 0, liquidite: 0 },
      Coris:   { stock: 0, liquidite: 0 }, Sank:    { stock: 0, liquidite: 0 },
    }
    const apresT1Legit = applySettlementImpact(balancesT0, { type: 'Retrait', montant: montantTranche }, 'Orange Money')
    const apresT2Legit = applySettlementImpact(apresT1Legit, { type: 'Retrait', montant: montantTranche }, 'Orange Money')
    // Attendu : 50000 - 20000 - 20000 = 10000
    expect(apresT2Legit.Orange.stock).toBe(10000)

    // Scénario EXPLOIT C1 : tranche 1 légitime (Retrait), tranche 2 après mutation (Dépôt)
    const apresT1Exploit = applySettlementImpact(balancesT0, { type: 'Retrait', montant: montantTranche }, 'Orange Money')
    // Entre T1 et T2 : mutation type → 'Dépôt' (exploit FREEZE-01)
    const apresT2Exploit = applySettlementImpact(apresT1Exploit, { type: 'Dépôt', montant: montantTranche }, 'Orange Money')
    // Résultat réel : 50000 - 20000 + 20000 = 50000 (stock inchangé malgré 2 tranches de Retrait !)
    expect(apresT2Exploit.Orange.stock).toBe(50000)

    // Quantification de l'écart : l'exploit crée un écart de 40000 FCFA sur le stock Orange
    // (10000 légitime vs 50000 exploité → différence = 40000 = 2 × montantTranche)
    const ecart = apresT2Exploit.Orange.stock - apresT2Legit.Orange.stock
    expect(ecart).toBe(2 * montantTranche) // 40000 FCFA de solde fictif
  })
})
