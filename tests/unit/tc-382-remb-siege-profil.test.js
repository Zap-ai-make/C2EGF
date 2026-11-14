import { describe, expect, it } from 'vitest'
import { resolveProfile } from '../../config/clients/index.js'
import { generateStoreProfileFile } from '../../scripts/lib/generateStoreProfile.mjs'

/**
 * TC-382 — le drapeau du remboursement au siège (spec 2026-11-14).
 *
 * Éteint pour le produit standard, allumé pour C2EGF, et recopié côté
 * functions : le serveur refuse les quatre commandes quand il est éteint.
 */

describe('TC-382 — siegeRepayment.enabled', () => {
  it('[TC-382-1] éteint dans le pilote', () => {
    expect(resolveProfile('_pilot').siegeRepayment.enabled).toBe(false)
  })

  it('[TC-382-2] allumé pour C2EGF', () => {
    expect(resolveProfile('c2egf_burkina').siegeRepayment.enabled).toBe(true)
  })

  it('[TC-382-3] recopié dans le profil des functions', () => {
    expect(generateStoreProfileFile(resolveProfile('c2egf_burkina'))).toContain('export const SIEGE_REPAYMENT_ENABLED = true')
    expect(generateStoreProfileFile(resolveProfile('_pilot'))).toContain('export const SIEGE_REPAYMENT_ENABLED = false')
  })

  it('[TC-382-4] un drapeau qui n’est pas un booléen est refusé', () => {
    const profil = { ...resolveProfile('c2egf_burkina'), siegeRepayment: { enabled: 'oui' } }
    expect(() => generateStoreProfileFile(profil)).toThrow(/siegeRepayment\.enabled/)
  })
})
