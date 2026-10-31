/**
 * TC-315 — Un refus de solde arrive jusqu'à l'écran, avec sa raison.
 *
 * Premier essai réel (30 octobre 2026) : payer en Cash un retrait non terminé,
 * sans un franc en caisse. Le serveur a bien refusé — mais l'écran a lu « La
 * transaction a échoué. Veuillez réessayer. », qui invite à réessayer ce qui
 * ne passera jamais.
 *
 * LA CAUSE : les refus de solde de `financialUtils` étaient de simples `Error`.
 *   - les règlements les rattrapaient en TRANSACTION_FAILED, message générique ;
 *   - `storeTransactionCommand` ne rattrape rien : `wrapCallable` en faisait
 *     « Une erreur interne s'est produite. » — un retour sans réserve, une
 *     annulation sans stock, un retrait validé sans espèces.
 * Les tests serveur (TC-227-11) appellent le handler directement, sans
 * `wrapCallable` : ils voyaient le bon message, l'écran jamais.
 *
 * Ce qui est figé : le refus est métier (INSUFFICIENT_STORE_BALANCE,
 * failed-precondition), son message garde le disponible — le même texte que le
 * front (TC-081) —, et rien n'est écrit.
 */

import { describe, it, expect, vi } from 'vitest'
import { addTransactionPaymentHandler } from '../../functions/src/settlements/addTransactionPayment.js'
import { addTransactionRefundHandler } from '../../functions/src/settlements/addTransactionRefund.js'
import {
  applyInitialTransactionImpact,
  applyReplenishmentReturnImpact,
  applySettlementImpact,
  liquidityConsumptionSplit,
  reversePendingOnlyImpact,
} from '../../functions/src/settlements/financialUtils.js'
import { wrapCallable } from '../../functions/src/callable.js'
import { DealerRequestError } from '../../functions/src/errors.js'

const UID = 'caisse-315'
const STORE = 'store-315'
const DRAFT = 'draft-315'
const PROFIL = { active: true, role: 'store_admin', storeId: STORE, name: 'Awa', email: 'awa@test.com' }

/** Le minimum que lisent les deux handlers de règlement (même forme que TC-060). */
function faireDb({ brouillon, soldes }) {
  const ecrits = []
  const instantane = (data) => ({ exists: !!data, data: () => data })
  const tx = {
    get: vi.fn(async (ref) => {
      if (ref._path.startsWith('users/')) return instantane(PROFIL)
      if (ref._path.startsWith('stores/')) return instantane({ active: true })
      return instantane(null)
    }),
    getAll: vi.fn(async (...refs) => refs.map((ref) => {
      if (ref._path.endsWith(`drafts/${DRAFT}`)) return instantane(brouillon)
      if (ref._path.endsWith('networkBalances/current')) return instantane({ balances: soldes })
      if (ref._path.startsWith('users/')) return instantane(PROFIL)
      return instantane(null)
    })),
    set: vi.fn((ref) => ecrits.push(ref._path)),
    update: vi.fn((ref) => ecrits.push(ref._path)),
    delete: vi.fn((ref) => ecrits.push(ref._path)),
  }
  const doc = (path) => ({
    _path: path,
    get: async () => instantane(path.startsWith('users/') ? PROFIL : path.startsWith('stores/') ? { active: true } : null),
  })
  const db = {
    doc,
    collection: (path) => ({ doc: (id = '_auto_') => doc(`${path}/${id}`) }),
    runTransaction: vi.fn(async (fn) => fn(tx)),
  }
  return { db, ecrits }
}

const FieldValue = { serverTimestamp: () => ({ _type: 'serverTimestamp' }) }
const requete = (data) => ({ auth: { uid: UID }, data: { draftId: DRAFT, idempotencyKey: 'k-315', ...data } })
const RETRAIT = { type: 'Retrait', montant: 50000, clientId: 'c-1', reseau: 'Orange', statut: 'Non Terminées' }
const CAISSE_VIDE = { Orange: { stock: 120000, liquidite: 0 } }

describe('TC-315 — le paiement d’un retrait que la caisse ne couvre pas', () => {
  it('[RS-01] en Cash : refus métier, avec les espèces disponibles, et rien d’écrit', async () => {
    const { db, ecrits } = faireDb({ brouillon: RETRAIT, soldes: CAISSE_VIDE })
    await expect(
      addTransactionPaymentHandler(requete({ amount: 50000, paymentMethod: 'Cash' }), { db, FieldValue }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STORE_BALANCE', message: expect.stringMatching(/^Liquidite insuffisante\. Disponible: 0 FCFA/) })
    expect(ecrits).toEqual([])
  })

  it('[RS-02] en Orange Money : c’est le stock Orange qui est nommé', async () => {
    const { db } = faireDb({ brouillon: RETRAIT, soldes: { Orange: { stock: 5000, liquidite: 900000 } } })
    await expect(
      addTransactionPaymentHandler(requete({ amount: 50000, paymentMethod: 'Orange Money' }), { db, FieldValue }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STORE_BALANCE', message: expect.stringMatching(/^Stock insuffisant pour Orange\. Disponible: 5\s000 FCFA/) })
  })

  it('[RS-03] jusqu’à l’écran : l’appelable rend failed-precondition et la raison, pas « réessayez »', async () => {
    const { db } = faireDb({ brouillon: RETRAIT, soldes: CAISSE_VIDE })
    const appelable = wrapCallable(addTransactionPaymentHandler, { db, FieldValue }, () => {})
    const refus = await appelable(requete({ amount: 50000, paymentMethod: 'Cash' })).catch((e) => e)
    expect(refus.code).toBe('failed-precondition')
    expect(refus.message).toMatch(/^Liquidite insuffisante\. Disponible: 0 FCFA/)
    expect(refus.details).toEqual({ code: 'INSUFFICIENT_STORE_BALANCE' })
  })
})

describe('TC-315 — le remboursement', () => {
  it('[RS-04] rendre en Cash ce qu’on n’a pas : même refus métier', async () => {
    const credit = { type: 'Crédit', montant: 50000, clientId: 'c-1', reseau: 'Orange', paidAmount: 20000, refundedAmount: 0, remainingAmount: 30000 }
    const { db, ecrits } = faireDb({ brouillon: credit, soldes: CAISSE_VIDE })
    await expect(
      addTransactionRefundHandler(requete({ amount: 10000, paymentMethod: 'Cash' }), { db, FieldValue }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STORE_BALANCE' })
    expect(ecrits).toEqual([])
  })
})

/**
 * `storeTransactionCommand` ne rattrape rien : ses refus de solde sont ceux de
 * ces fonctions, levés tels quels jusqu'à `wrapCallable`. Les typer ICI suffit
 * donc à les faire arriver jusqu'à l'écran.
 */
describe('TC-315 — les refus de solde de toutes les commandes de la boutique', () => {
  const VIDE = { Orange: { stock: 0, liquidite: 0 } }
  const cas = [
    ['un retrait validé sans espèces', () => applyInitialTransactionImpact(VIDE, { type: 'Retrait', reseau: 'Orange', montant: 1000, statut: 'Validée' })],
    ['un dépôt sans stock', () => applyInitialTransactionImpact(VIDE, { type: 'Dépôt', reseau: 'Orange', montant: 1000, statut: 'Non Terminées' })],
    ['l’annulation d’un retrait dont le stock est parti', () => reversePendingOnlyImpact(VIDE, 'Retrait', 'Orange', 1000)],
    ['un retour sans réserve', () => applyReplenishmentReturnImpact(VIDE, 'Orange', 'liquidite', 1000)],
    ['la répartition d’une liquidité absente', () => liquidityConsumptionSplit(VIDE, 1000)],
    ['un règlement sortant', () => applySettlementImpact(VIDE, { type: 'Retrait', montant: 1000 }, 'Cash')],
  ]

  it.each(cas)('[RS-05] %s : refus métier, code INSUFFICIENT_STORE_BALANCE', (_, geste) => {
    let refus
    try { geste() } catch (e) { refus = e }
    expect(refus).toBeInstanceOf(DealerRequestError)
    expect(refus.code).toBe('INSUFFICIENT_STORE_BALANCE')
    expect(refus.httpCode).toBe('failed-precondition')
    expect(refus.message).toMatch(/insuffisante?.*Disponible: 0 FCFA$/)
  })

  it('[RS-06] une donnée mal formée reste une panne, pas un refus de solde', () => {
    let refus
    try { applyReplenishmentReturnImpact(VIDE, 'Orange', 'tiroir', 1000) } catch (e) { refus = e }
    expect(refus).not.toBeInstanceOf(DealerRequestError)
  })
})
