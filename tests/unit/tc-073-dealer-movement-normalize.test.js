// @vitest-environment node
/**
 * TC-073 — Normalisation des mouvements d'inventaire dealer pour la vue gérant.
 *
 * normalizeDealerMovement mappe chaque entrée de dealerBalances/{uid}/auditLogs
 * en ligne d'affichage : type, ressource, sens (+/−/±), montant, solde après, source.
 * Couvre les 4 actions qui font bouger le stock/la liquidité du dealer.
 */

import { describe, it, expect } from 'vitest'
import { normalizeDealerMovement } from '../../src/services/adminService'

describe('TC-073 — normalizeDealerMovement', () => {
  it('approvisionnement → + / Stock / solde après', () => {
    const r = normalizeDealerMovement({
      action: 'DEALER_INVENTORY_REPLENISHED', resource: 'stock', amount: 5000, newBalance: 25000,
    })
    expect(r.type).toBe('Approvisionnement')
    expect(r.resourceLabel).toBe('Stock')
    expect(r.sens).toBe('+')
    expect(r.amount).toBe(5000)
    expect(r.soldeApres).toBe(25000)
    expect(r.source).toBe('Dealer')
  })

  it('diminution → − / Liquidité / solde après', () => {
    const r = normalizeDealerMovement({
      action: 'DEALER_INVENTORY_DECREASED', resource: 'liquidite', amount: 3000, newBalance: 2000,
    })
    expect(r.type).toBe('Diminution')
    expect(r.resourceLabel).toBe('Liquidité')
    expect(r.sens).toBe('−')
    expect(r.soldeApres).toBe(2000)
  })

  it('retour boutique liquidité (non créditée, newBalance null) → sens neutre, sans impact solde', () => {
    const r = normalizeDealerMovement({
      action: 'STORE_DEALER_TRANSFER_CONFIRMED', transferType: 'return_liquidity',
      amount: 4000, newBalance: null, storeName: 'Boutique Bitou',
    })
    expect(r.type).toBe('Retour boutique')
    expect(r.resourceLabel).toContain('sans impact solde')
    expect(r.sens).toBe('·')
    expect(r.soldeApres).toBeNull()
    expect(r.source).toBe('Boutique Bitou')
  })

  it('retour boutique confirmé (return_stock, crédité) → + / Stock / solde après', () => {
    const r = normalizeDealerMovement({
      action: 'STORE_DEALER_TRANSFER_CONFIRMED', transferType: 'return_stock', amount: 1000, newBalance: 3000,
    })
    expect(r.resourceLabel).toBe('Stock')
    expect(r.sens).toBe('+')
    expect(r.soldeApres).toBe(3000)
  })

  it('dépôt partenaire → ± / deux impacts (newStock/newLiquidite)', () => {
    const r = normalizeDealerMovement({
      action: 'PARTNER_DEPOSIT', amount: 5000,
      newStock: 10000, newLiquidite: 15000, partnerNom: 'Ouedraogo',
    })
    expect(r.type).toBe('Dépôt partenaire')
    expect(r.sens).toBe('±')
    expect(r.newStock).toBe(10000)
    expect(r.newLiquidite).toBe(15000)
    expect(r.soldeApres).toBeNull()
    expect(r.source).toBe('Ouedraogo')
  })

  it('action inconnue → repli neutre', () => {
    const r = normalizeDealerMovement({ action: 'SOMETHING_ELSE', amount: 1 })
    expect(r.type).toBe('SOMETHING_ELSE')
    expect(r.sens).toBe('')
  })
})
