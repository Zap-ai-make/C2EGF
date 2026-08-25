// @vitest-environment node
/**
 * TC-077 — Porte de vérification du backup de remise à zéro (verifyResetBackup).
 *
 * Le moindre écart entre comptages et backup doit être détecté AVANT toute
 * suppression. Cas critiques issus de la revue indépendante :
 *   - M-1 : un document de solde (networkBalances/current ou dealerBalances)
 *     existant mais absent du backup doit être détecté.
 *   - M-2 : un écart de settlements compensé entre deux boutiques (total global
 *     inchangé) doit être détecté par le contrôle PAR BOUTIQUE.
 */

import { describe, it, expect } from 'vitest'
import { verifyResetBackup } from '../../scripts/lib/verifyResetBackup.mjs'

const TOP_LEVEL_DELETE = ['dealerRequests', 'dealerClosures', 'auditLogs']
const STORE_SUBS = ['drafts', 'history', 'sessions', 'auditLogs']

function baseline() {
  return {
    counts: {
      topLevel: { dealerRequests: 2, dealerClosures: 1, auditLogs: 3 },
      settlementsTotal: 4,
      stores: {
        S1: { drafts: 2, history: 2, sessions: 1, auditLogs: 3, networkBalancesCurrent: true },
        S2: { drafts: 1, history: 0, sessions: 0, auditLogs: 1, networkBalancesCurrent: false },
      },
      dealers: {
        d1: { balanceDoc: true, auditLogs: 2 },
        d2: { balanceDoc: false, auditLogs: 0 },
      },
    },
    backupTotals: {
      topLevel: { dealerRequests: 2, dealerClosures: 1, auditLogs: 3 },
      settlementsTotal: 4,
      stores: {
        S1: { drafts: 2, history: 2, sessions: 1, auditLogs: 3, settlements: 3, settlementsExpected: 3, networkBalancesBackedUp: true },
        S2: { drafts: 1, history: 0, sessions: 0, auditLogs: 1, settlements: 1, settlementsExpected: 1, networkBalancesBackedUp: false },
      },
      dealers: {
        d1: { auditLogs: 2, balanceBackedUp: true },
        d2: { auditLogs: 0, balanceBackedUp: false },
      },
    },
    topLevelDelete: TOP_LEVEL_DELETE,
    storeSubcollectionsDelete: STORE_SUBS,
  }
}

describe('TC-077 — verifyResetBackup', () => {
  it('backup complet → aucun écart', () => {
    expect(verifyResetBackup(baseline())).toEqual([])
  })

  it('écart sur une collection top-level → détecté', () => {
    const input = baseline()
    input.backupTotals.topLevel.dealerRequests = 1
    const errors = verifyResetBackup(input)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('dealerRequests')
  })

  it('écart sur une sous-collection boutique → détecté', () => {
    const input = baseline()
    input.backupTotals.stores.S1.history = 1
    const errors = verifyResetBackup(input)
    expect(errors.some((e) => e.includes('clients/S1/history'))).toBe(true)
  })

  it('M-2 : écart settlements compensé entre boutiques (total global identique) → détecté', () => {
    const input = baseline()
    // S1 : un settlement non sauvegardé ; S2 : un settlement de plus.
    // Le total global (4) reste identique : seul le contrôle par boutique le voit.
    input.backupTotals.stores.S1.settlements = 2
    input.backupTotals.stores.S2.settlements = 2
    input.backupTotals.stores.S2.settlementsExpected = 2
    const errors = verifyResetBackup(input)
    expect(errors.some((e) => e.includes('clients/S1 settlements'))).toBe(true)
  })

  it('M-1 : networkBalances/current existait mais absent du backup → détecté', () => {
    const input = baseline()
    input.backupTotals.stores.S1.networkBalancesBackedUp = false
    const errors = verifyResetBackup(input)
    expect(errors.some((e) => e.includes('clients/S1/networkBalances/current'))).toBe(true)
  })

  it('M-1 : doc de solde dealer existait mais absent du backup → détecté', () => {
    const input = baseline()
    input.backupTotals.dealers.d1.balanceBackedUp = false
    const errors = verifyResetBackup(input)
    expect(errors.some((e) => e.includes('dealerBalances/d1'))).toBe(true)
  })

  it('boutique entière absente du backup → détecté', () => {
    const input = baseline()
    delete input.backupTotals.stores.S2
    const errors = verifyResetBackup(input)
    expect(errors.some((e) => e.includes('clients/S2 : absent du backup'))).toBe(true)
  })

  it('dealer entier absent du backup → détecté', () => {
    const input = baseline()
    delete input.backupTotals.dealers.d2
    const errors = verifyResetBackup(input)
    expect(errors.some((e) => e.includes('dealerBalances/d2 : absent du backup'))).toBe(true)
  })

  it("solde absent au comptage et absent du backup → pas d'écart (rien à écraser)", () => {
    // S2 (networkBalancesCurrent=false) et d2 (balanceDoc=false) du baseline.
    expect(verifyResetBackup(baseline())).toEqual([])
  })
})
