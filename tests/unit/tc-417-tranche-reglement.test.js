import { describe, it, expect } from 'vitest'
import { calculerTranche, REGLEMENTS_MAX } from '../../functions/src/settlements/tranche.js'

/**
 * TC-417 — Le cœur d'« Encaisser » / « Payer par », hors de la callable
 * (docs/superpowers/plans/2026-11-26-remboursement-agent.md, Task 1).
 *
 * `addTransactionPayment` et l'acceptation d'un remboursement demandé par
 * l'agent (contrat Oxygen v10 §11.3) font la même tranche : ce module la
 * calcule une fois. Il ajoute aussi `reglements`, la liste des tranches écrite
 * sur la ligne pour l'historique de l'agent (§11.4).
 */

const LE = new Date(Date.UTC(2026, 10, 26, 9, 30))
const SOLDES = { Orange: { stock: 300_000, liquidite: 100_000 } }
const DEPOT = { type: 'Dépôt', montant: 50_000, reseau: 'Orange', statut: 'Non Terminées', clientId: 'c-1' }
const tranche = (autres) => calculerTranche({ draft: DEPOT, amount: 20_000, paymentMethod: 'Cash', balances: SOLDES, le: LE, ...autres })

describe('TC-417 — une tranche', () => {
  it('[TC-417-01] dépôt de 50 000, tranche de 20 000 en Cash : reste 30 000, liquidité +20 000, une tranche notée', () => {
    const calcul = tranche()
    expect(calcul).toMatchObject({
      effectiveType: 'Dépôt', originalAmount: 50_000, paidAmount: 0, remainingAmount: 50_000,
      newPaid: 20_000, newRemaining: 30_000, fullySettled: false, affectedNetwork: 'Liquidite',
    })
    expect(calcul.nextBalances.Orange).toEqual({ stock: 300_000, liquidite: 120_000 })
    expect(calcul.reglements).toEqual([{ montant: 20_000, mode: 'Cash', le: LE }])
    expect(calcul.newSummary.netByNetwork.Liquidite).toEqual({ paid: 20_000, refunded: 0 })
  })

  it('[TC-417-02] les tranches s’ajoutent dans l’ordre, au plus cinquante', () => {
    const avant = [{ montant: 1, mode: 'Cash', le: LE }, { montant: 2, mode: 'Orange Money', le: LE }]
    const calcul = tranche({ draft: { ...DEPOT, reglements: avant } })
    expect(calcul.reglements.map((r) => r.montant)).toEqual([1, 2, 20_000])

    const pleines = Array.from({ length: REGLEMENTS_MAX }, (_, i) => ({ montant: i + 1, mode: 'Cash', le: LE }))
    const bornee = tranche({ draft: { ...DEPOT, reglements: pleines } }).reglements
    expect(REGLEMENTS_MAX).toBe(50)
    expect(bornee).toHaveLength(50)
    expect(bornee[0].montant).toBe(2)
    expect(bornee.at(-1).montant).toBe(20_000)
  })

  it('[TC-417-03] au-delà du reste, ou sur une ligne déjà réglée : refusé', () => {
    expect(() => tranche({ amount: 50_001 })).toThrow(expect.objectContaining({ code: 'SETTLEMENT_EXCEEDS_REMAINING' }))
    expect(() => tranche({ draft: { ...DEPOT, paidAmount: 50_000, remainingAmount: 0 } }))
      .toThrow(expect.objectContaining({ code: 'SETTLEMENT_ALREADY_SETTLED' }))
  })

  it('[TC-417-04] un retrait payé en Orange Money sort du stock, et le reste à 0 solde la ligne', () => {
    const calcul = calculerTranche({
      draft: { ...DEPOT, type: 'Retrait' }, amount: 50_000, paymentMethod: 'Orange Money', balances: SOLDES, le: LE,
    })
    expect(calcul.nextBalances.Orange).toEqual({ stock: 250_000, liquidite: 100_000 })
    expect(calcul).toMatchObject({ fullySettled: true, newRemaining: 0, affectedNetwork: 'Orange' })
  })
})
