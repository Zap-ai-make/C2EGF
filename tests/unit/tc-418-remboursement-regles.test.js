import { describe, it, expect } from 'vitest'
import {
  demandeRendue,
  modeDeReserve,
  MODES_REMBOURSEMENT,
  NATURES_DEMANDE,
  plafondRemboursement,
  reserveDuMode,
} from '../../functions/src/oxygen/demande.js'

/**
 * TC-418 — Le remboursement depuis l'app Oxygen : les règles pures
 * (contrat demande-operation v10 §11.1 et §11.2).
 */

describe('TC-418 — le plafond', () => {
  it('[TC-418-01] le reste, moins l’autre demande en attente ; jamais négatif', () => {
    expect(plafondRemboursement({ reste: 20_000, autres: [] })).toBe(20_000)
    expect(plafondRemboursement({ reste: 20_000, autres: [8_000] })).toBe(12_000)
    expect(plafondRemboursement({ reste: 20_000, autres: [25_000] })).toBe(0)
  })
})

describe('TC-418 — le mode et la réserve', () => {
  it('[TC-418-02] Orange Money ↔ stock, Cash ↔ liquidité', () => {
    expect(MODES_REMBOURSEMENT).toEqual(['Orange Money', 'Cash'])
    expect(reserveDuMode('Orange Money')).toBe('stock')
    expect(reserveDuMode('Cash')).toBe('liquidite')
    expect(modeDeReserve('stock')).toBe('Orange Money')
    expect(modeDeReserve('liquidite')).toBe('Cash')
    expect(modeDeReserve('autre')).toBeNull()
  })
})

describe('TC-418 — la demande rendue', () => {
  const base = { boutiqueId: 'b-1', boutiqueNom: 'FADA', sens: 'depot', reseau: 'Orange', montant: 5_000, etat: 'en_attente' }

  it('[TC-418-03] une demande d’avant est une opération, sans cible ni mode ; un remboursement les rend', () => {
    const avant = demandeRendue('d-1', base)
    expect(avant.nature).toBe('operation')
    expect(avant).not.toHaveProperty('cibleId')
    expect(avant).not.toHaveProperty('mode')

    expect(NATURES_DEMANDE).toEqual({ OPERATION: 'operation', REMBOURSEMENT: 'remboursement', REMB_SIEGE: 'remb_siege' })
    expect(demandeRendue('d-2', { ...base, nature: 'remboursement', cibleId: 'op-1', mode: 'Cash' }))
      .toMatchObject({ nature: 'remboursement', cibleId: 'op-1', mode: 'Cash' })
    const siege = demandeRendue('d-3', { ...base, nature: 'remb_siege', mode: 'Orange Money' })
    expect(siege).toMatchObject({ nature: 'remb_siege', mode: 'Orange Money' })
    expect(siege).not.toHaveProperty('cibleId')
  })
})
