import { describe, expect, it } from 'vitest'
import {
  estRembSiege,
  impactAnnulation,
  impactEnvoi,
  impactModification,
  impactSaisie,
} from '../../functions/src/storeTransactions/rembSiege.js'

/**
 * TC-383 — l'arithmétique du remboursement au siège, côté serveur.
 *
 * Les règles d'impact sont celles de la spec (tableau « Les règles d'impact »),
 * décidées par l'utilisateur le 2026-11-14 : une seule réserve à la fois, et
 * « Valider, reçu en Stock » ne bouge rien, même avec un stock à zéro.
 */

const soldes = (stock, liquidite) => ({ Orange: { stock, liquidite } })
const refus = (fn) => {
  try {
    fn()
  } catch (erreur) {
    return erreur
  }
  throw new Error('Aucun refus')
}

describe('TC-383 — la saisie', () => {
  it('[TC-383-1] en attente, reçu en Stock : le stock monte', () => {
    expect(impactSaisie(soldes(500_000, 300_000), 'Orange', { statut: 'Non Terminées', balanceType: 'stock', montant: 100_000 }))
      .toEqual(soldes(600_000, 300_000))
  })

  it('[TC-383-2] en attente, reçu en Espèce : l’espèce monte', () => {
    expect(impactSaisie(soldes(500_000, 300_000), 'Orange', { statut: 'Non Terminées', balanceType: 'liquidite', montant: 100_000 }))
      .toEqual(soldes(500_000, 400_000))
  })

  it('[TC-383-3] validée, reçu en Stock, stock à zéro : rien ne bouge, rien n’est refusé', () => {
    expect(impactSaisie(soldes(0, 300_000), 'Orange', { statut: 'Validée', balanceType: 'stock', montant: 100_000 }))
      .toEqual(soldes(0, 300_000))
  })

  it('[TC-383-4] validée, reçu en Espèce : l’espèce monte, le stock part au siège', () => {
    expect(impactSaisie(soldes(300_000, 300_000), 'Orange', { statut: 'Validee', balanceType: 'liquidite', montant: 100_000 }))
      .toEqual(soldes(200_000, 400_000))
  })

  it('[TC-383-5] validée, reçu en Espèce, stock trop bas : refus métier', () => {
    const erreur = refus(() => impactSaisie(soldes(50_000, 300_000), 'Orange', { statut: 'Validée', balanceType: 'liquidite', montant: 100_000 }))
    expect(erreur.code).toBe('INSUFFICIENT_STORE_BALANCE')
  })
})

describe('TC-383 — l’envoi au siège', () => {
  it('[TC-383-6] une tranche au-delà du stock : refus métier', () => {
    const erreur = refus(() => impactEnvoi(soldes(50_000, 0), 'Orange', 60_000))
    expect(erreur.code).toBe('INSUFFICIENT_STORE_BALANCE')
  })

  it('[TC-383-6b] une tranche sort du stock, et de lui seul', () => {
    expect(impactEnvoi(soldes(500_000, 300_000), 'Orange', 60_000)).toEqual(soldes(440_000, 300_000))
  })
})

describe('TC-383 — l’annulation', () => {
  it('[TC-383-7] défait les deux jambes : le stock envoyé revient, l’espèce reçue repart', () => {
    expect(impactAnnulation(soldes(440_000, 400_000), 'Orange', { balanceType: 'liquidite', montant: 100_000, envoyeAuSiege: 60_000 }))
      .toEqual(soldes(500_000, 300_000))
  })

  it('[TC-383-8] rien d’envoyé : seule la réserve reçue repart', () => {
    expect(impactAnnulation(soldes(600_000, 300_000), 'Orange', { balanceType: 'stock', montant: 100_000, envoyeAuSiege: 0 }))
      .toEqual(soldes(500_000, 300_000))
  })

  it('[TC-383-9] tout envoyé, stock à zéro : le + passe avant le −, rien n’est refusé', () => {
    expect(impactAnnulation(soldes(0, 300_000), 'Orange', { balanceType: 'stock', montant: 100_000, envoyeAuSiege: 100_000 }))
      .toEqual(soldes(0, 300_000))
  })
})

describe('TC-383 — la modification', () => {
  it('[TC-383-10] 100 000 en Stock devient 80 000 en Espèce', () => {
    expect(impactModification(soldes(600_000, 300_000), 'Orange', { balanceType: 'stock', montant: 100_000 }, { balanceType: 'liquidite', montant: 80_000 }))
      .toEqual(soldes(500_000, 380_000))
  })
})

describe('TC-383 — reconnaître la ligne', () => {
  it('[TC-383-11] seul le type « Remb. siège » est un remboursement au siège', () => {
    expect(estRembSiege({ type: 'Remb. siège' })).toBe(true)
    expect(estRembSiege({ type: 'Dépôt' })).toBe(false)
    expect(estRembSiege(null)).toBe(false)
  })
})
