import { describe, expect, it } from 'vitest'
import { resolveProfile } from '../../config/clients/index.js'
import { generateStoreProfileFile } from '../../scripts/lib/generateStoreProfile.mjs'
import {
  TYPE_TRANSFERT_ARGENT,
  SERVICES_TRANSFERT,
  OPERATIONS_TRANSFERT,
  TRANCHES_MAX,
  MESSAGE_GESTE_TRANSFERT,
  estTransfertArgent,
  impactSaisieTransfert,
  impactTrancheTransfert,
  impactModificationTransfert,
  impactAnnulationTransfert,
} from '../../functions/src/storeTransactions/transfertArgent.js'

/**
 * TC-403 — l'arithmétique des transferts d'argent, côté serveur
 * (docs/superpowers/specs/2026-11-23-transferts-argent-design.md, « Les règles
 * d'impact » — décidées par l'utilisateur le 2026-11-23).
 *
 * Une seule réserve à la fois ; « Envoyer au siège » et « Encaisser » passent
 * toujours par le stock ; le + d'abord, pour que seul le net puisse refuser.
 */

const B = { Orange: { stock: 300_000, liquidite: 200_000 } }
const soldes = (stock, liquidite) => ({ Orange: { stock, liquidite } })

describe('TC-403 — constantes', () => {
  it('[TC-403-00] le type, les services, les opérations', () => {
    expect(TYPE_TRANSFERT_ARGENT).toBe('Transfert argent')
    expect(SERVICES_TRANSFERT).toEqual(['Western Union', 'Ria', 'MoneyGram', 'Autres'])
    expect(OPERATIONS_TRANSFERT).toEqual(['transfert', 'retrait'])
    expect(TRANCHES_MAX).toBe(50)
    expect(MESSAGE_GESTE_TRANSFERT).toBe('Une ligne de transfert se traite par ses propres boutons.')
    expect(estTransfertArgent({ type: 'Transfert argent' })).toBe(true)
    expect(estTransfertArgent({ type: 'Retrait' })).toBe(false)
    expect(estTransfertArgent(null)).toBe(false)
  })
})

describe('TC-403 — la saisie', () => {
  it('[TC-403-01] transfert reçu en Espèce : +50 000 espèce', () => {
    expect(impactSaisieTransfert(B, 'Orange', { operation: 'transfert', balanceType: 'liquidite', montant: 50_000 }).Orange)
      .toEqual({ stock: 300_000, liquidite: 250_000 })
  })

  it('[TC-403-02] retrait payé en Stock : −75 000 stock', () => {
    expect(impactSaisieTransfert(B, 'Orange', { operation: 'retrait', balanceType: 'stock', montant: 75_000 }).Orange)
      .toEqual({ stock: 225_000, liquidite: 200_000 })
  })

  it('[TC-403-03] retrait payé en Espèce au-delà du disponible : lève', () => {
    expect(() => impactSaisieTransfert(B, 'Orange', { operation: 'retrait', balanceType: 'liquidite', montant: 250_000 })).toThrow()
  })
})

describe('TC-403 — les tranches', () => {
  it('[TC-403-04] tranche d’un transfert : −stock ; d’un retrait : +stock', () => {
    expect(impactTrancheTransfert(B, 'Orange', { operation: 'transfert' }, 20_000).Orange).toEqual({ stock: 280_000, liquidite: 200_000 })
    expect(impactTrancheTransfert(B, 'Orange', { operation: 'retrait' }, 75_000).Orange).toEqual({ stock: 375_000, liquidite: 200_000 })
    expect(() => impactTrancheTransfert(soldes(10_000, 0), 'Orange', { operation: 'transfert' }, 20_000)).toThrow()
  })
})

describe('TC-403 — l’annulation', () => {
  it('[TC-403-05] transfert reçu en Stock, 20 000 envoyés, stock 30 000 : finit à 0 (le + d’abord)', () => {
    const avant = soldes(30_000, 0)
    expect(impactAnnulationTransfert(avant, 'Orange', { operation: 'transfert', balanceType: 'stock', montant: 50_000, montantTraite: 20_000 }).Orange.stock)
      .toBe(0)
  })

  it('[TC-403-06] retrait payé en Espèce, 75 000 encaissés : +75 000 espèce puis −75 000 stock', () => {
    expect(impactAnnulationTransfert(B, 'Orange', { operation: 'retrait', balanceType: 'liquidite', montant: 75_000, montantTraite: 75_000 }).Orange)
      .toEqual({ stock: 225_000, liquidite: 275_000 })
  })

  it('[TC-403-06b] rien de traité : une seule jambe', () => {
    expect(impactAnnulationTransfert(B, 'Orange', { operation: 'transfert', balanceType: 'liquidite', montant: 50_000, montantTraite: 0 }).Orange)
      .toEqual({ stock: 300_000, liquidite: 150_000 })
    expect(impactAnnulationTransfert(B, 'Orange', { operation: 'retrait', balanceType: 'stock', montant: 75_000 }).Orange)
      .toEqual({ stock: 375_000, liquidite: 200_000 })
  })
})

describe('TC-403 — la modification', () => {
  it('[TC-403-07] retrait 75 000 Stock → 60 000 Espèce : stock +75 000, espèce −60 000', () => {
    const avant = { operation: 'retrait', balanceType: 'stock', montant: 75_000 }
    const apres = { operation: 'retrait', balanceType: 'liquidite', montant: 60_000 }
    expect(impactModificationTransfert(B, 'Orange', avant, apres).Orange).toEqual({ stock: 375_000, liquidite: 140_000 })
  })

  it('[TC-403-07b] transfert 50 000 Stock → 80 000 Stock à stock nul : passe (le + d’abord)', () => {
    const avant = { operation: 'transfert', balanceType: 'stock', montant: 50_000 }
    const apres = { operation: 'transfert', balanceType: 'stock', montant: 80_000 }
    expect(impactModificationTransfert(soldes(50_000, 0), 'Orange', avant, apres).Orange).toEqual({ stock: 80_000, liquidite: 0 })
  })
})

describe('TC-403 — le drapeau de profil', () => {
  it('[TC-403-08] C2EGF allumé, pilote éteint, valeur non booléenne refusée', () => {
    expect(generateStoreProfileFile(resolveProfile('c2egf_burkina'))).toContain('export const MONEY_TRANSFER_ENABLED = true')
    expect(generateStoreProfileFile(resolveProfile('_pilot'))).toContain('export const MONEY_TRANSFER_ENABLED = false')
    const profil = resolveProfile('c2egf_burkina')
    expect(() => generateStoreProfileFile({ ...profil, moneyTransfer: { enabled: 'oui' } }))
      .toThrow('Profil invalide : moneyTransfer.enabled doit être un booléen.')
  })
})
