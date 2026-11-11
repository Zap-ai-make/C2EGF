/**
 * TC-371 — le retour au dealer (retour du terrain, 2026-11-10) :
 *   le montant proposé d'office, et plusieurs livraisons rendues en un geste.
 */

import { describe, it, expect } from 'vitest'
import { montantRetourPropose, preparerRetour, preparerRetours } from '../../src/utils/ravitaillement.js'

const livraison = (id, remainingAmount) => ({ id, expediteur: 'Maï', remainingAmount, balanceType: 'stock' })

describe('TC-371 — le montant proposé', () => {
  it('[RG-01] tout le reste dû quand la réserve le contient', () => {
    expect(montantRetourPropose({ reste: 3_000_000, disponible: 23_760_000 })).toBe('3000000')
    expect(montantRetourPropose({ reste: 500_000, disponible: 500_000 })).toBe('500000')
  })

  it('[RG-02] sinon ce que la réserve contient', () => {
    expect(montantRetourPropose({ reste: 500_000, disponible: 200_000 })).toBe('200000')
  })

  it('[RG-03] rien quand la réserve est vide ou qu’il ne reste rien', () => {
    expect(montantRetourPropose({ reste: 500_000, disponible: 0 })).toBe('')
    expect(montantRetourPropose({ reste: 0, disponible: 900_000 })).toBe('')
    expect(montantRetourPropose({ reste: 500_000, disponible: undefined })).toBe('')
  })
})

describe('TC-371 — plusieurs livraisons en un geste', () => {
  it('[RG-04] une seule livraison : la même commande qu’avant', () => {
    const une = livraison('r-1', 300_000)
    const p = preparerRetours({ livraisons: [une], montant: '100000', vase: 'liquidite', disponible: 150_000 })
    expect(p).toEqual({
      ok: true,
      valeur: 100_000,
      commandes: [preparerRetour({ ravitaillement: une, montant: '100000', vase: 'liquidite', disponible: 150_000 }).commande],
    })
  })

  it('[RG-05] le montant va d’abord à la plus ancienne, puis à la suivante', () => {
    const p = preparerRetours({
      livraisons: [livraison('ancienne', 100_000), livraison('recente', 50_000)],
      montant: '120000', vase: 'stock', disponible: 1_000_000,
    })
    expect(p.commandes).toEqual([
      { action: 'returnReplenishment', replenishmentId: 'ancienne', amount: 100_000, balanceType: 'stock' },
      { action: 'returnReplenishment', replenishmentId: 'recente', amount: 20_000, balanceType: 'stock' },
    ])
  })

  it('[RG-06] un montant qui ne couvre que la première ne touche pas les autres', () => {
    const p = preparerRetours({
      livraisons: [livraison('ancienne', 100_000), livraison('recente', 50_000)],
      montant: '80000', vase: 'stock', disponible: 1_000_000,
    })
    expect(p.commandes).toEqual([
      { action: 'returnReplenishment', replenishmentId: 'ancienne', amount: 80_000, balanceType: 'stock' },
    ])
  })

  it('[RG-07] tout rendre solde chaque livraison exactement', () => {
    const p = preparerRetours({
      livraisons: [livraison('a', 100_000), livraison('b', 50_000), livraison('c', 25_000)],
      montant: '175000', vase: 'liquidite', disponible: 175_000,
    })
    expect(p.commandes.map((c) => [c.replenishmentId, c.amount])).toEqual([['a', 100_000], ['b', 50_000], ['c', 25_000]])
  })

  it('[RG-08] les plafonds portent sur le total : reste dû, puis réserve', () => {
    const deux = [livraison('a', 100_000), livraison('b', 50_000)]
    expect(preparerRetours({ livraisons: deux, montant: '150001', vase: 'stock', disponible: 1_000_000 }))
      .toMatchObject({ ok: false, motif: 'reste' })
    expect(preparerRetours({ livraisons: deux, montant: '150000', vase: 'stock', disponible: 149_999 }))
      .toMatchObject({ ok: false, motif: 'reserve' })
    expect(preparerRetours({ livraisons: deux, montant: '0', vase: 'stock', disponible: 1_000_000 }))
      .toMatchObject({ ok: false, motif: 'montant' })
  })

  it('[RG-09] une livraison déjà soldée n’entre pas dans la répartition', () => {
    const p = preparerRetours({
      livraisons: [livraison('soldee', 0), livraison('due', 40_000)],
      montant: '40000', vase: 'stock', disponible: 1_000_000,
    })
    expect(p.commandes).toEqual([
      { action: 'returnReplenishment', replenishmentId: 'due', amount: 40_000, balanceType: 'stock' },
    ])
  })
})
