import { describe, expect, it } from 'vitest'
import {
  RAISON_STOCK_INSUFFISANT,
  effetRembSiegeSurLesSoldes,
  estRembSiege,
  evaluerRembSiege,
  preparerRembSiege,
  verifierEnvoiSiege,
} from '../../src/utils/rembSiege.js'
import { evaluerTransaction } from '../../src/utils/preparationTransaction.js'

/**
 * TC-385 — les règles du remboursement au siège, côté navigateur
 * (docs/superpowers/specs/2026-11-14-remboursement-siege-design.md).
 *
 * Le formulaire et la ligne en attente décident avec ces fonctions ce que les
 * boutons permettent ; le serveur reste le garant (TC-384). Les soldes
 * provisoires, eux, doivent donner les mêmes nombres que le serveur (TC-383).
 */

const AGENT = { id: 'agent-1', nom: 'KABORE', prenom: 'Issa', orange: '1234567' }
const SANS_ORANGE = { id: 'agent-2', nom: 'SANOU', prenom: 'Ali', orange: '' }
const evaluer = (p) => evaluerRembSiege({ client: AGENT, montant: '100000', reseau: 'Orange', balanceType: 'stock', stock: 0, ...p })
const soldes = (stock, liquidite) => ({ Orange: { stock, liquidite } })

describe('TC-385 — ce que le formulaire permet', () => {
  it('[TC-385-1] sans « Reçu en », rien ne part', () => {
    const r = evaluer({ balanceType: '' })
    expect(r.isFormValid).toBe(false)
    expect(r.actionStates.canValidate).toBe(false)
    expect(r.actionStates.canMarkAsNonTermine).toBe(false)
    expect(r.actionStates.validateReason).toBe('Choisissez Stock ou Espèce.')
  })

  it('[TC-385-2] reçu en Stock : « Valider » passe même à stock nul', () => {
    const r = evaluer({ balanceType: 'stock', stock: 0 })
    expect(r.isFormValid).toBe(true)
    expect(r.actionStates.canValidate).toBe(true)
    expect(r.actionStates.canMarkAsNonTermine).toBe(true)
  })

  it('[TC-385-3] reçu en Espèce, stock trop bas : « Valider » refusé, « Non Terminées » permis', () => {
    const r = evaluer({ balanceType: 'liquidite', stock: 50_000 })
    expect(r.actionStates.canValidate).toBe(false)
    expect(r.actionStates.validateReason).toBe(RAISON_STOCK_INSUFFISANT)
    expect(RAISON_STOCK_INSUFFISANT).toBe('Stock insuffisant : utilisez Non Terminées.')
    expect(r.actionStates.canMarkAsNonTermine).toBe(true)
  })

  it('[TC-385-4] un agent sans code Orange : le même message réseau qu’un dépôt', () => {
    const r = evaluer({ client: SANS_ORANGE })
    const depot = evaluerTransaction({ client: SANS_ORANGE, montant: '100000', type: 'Dépôt', reseau: 'Orange', validateAmount: () => ({ isValid: true, message: '' }), liquidite: 0 })
    expect(r.networkValidation.isValid).toBe(false)
    expect(r.networkValidation.message).toBe(depot.networkValidation.message)
    expect(r.actionStates.canValidate).toBe(false)
    expect(r.actionStates.canMarkAsNonTermine).toBe(false)
  })
})

describe('TC-385 — ce qui part au serveur', () => {
  it('[TC-385-5] la saisie ne porte ni type ni réseau : le serveur les pose', () => {
    const r = preparerRembSiege({ client: AGENT, reseau: 'Orange', montant: '100 000', balanceType: 'liquidite', statut: 'Non Terminées' })
    expect(r.ok).toBe(true)
    expect(r.transaction).toEqual({ client: AGENT, clientId: 'agent-1', code: '1234567', montant: 100000, balanceType: 'liquidite', statut: 'Non Terminées' })
    expect(r.details.recuEn).toBe('Espèce')
  })

  it('[TC-385-5b] sans « Reçu en », la préparation refuse', () => {
    expect(preparerRembSiege({ client: AGENT, reseau: 'Orange', montant: '100000', balanceType: '', statut: 'Validée' }).ok).toBe(false)
  })
})

describe('TC-385 — l’envoi au siège', () => {
  const ligne = { id: 'rs-1', resteAuSiege: 100_000 }

  it('[TC-385-6] les deux plafonds, et lequel bloque', () => {
    expect(verifierEnvoiSiege({ ligne, montant: '120000', stock: 500_000 }).motif).toBe('reste')
    const stock = verifierEnvoiSiege({ ligne, montant: '60000', stock: 50_000 })
    expect(stock.motif).toBe('stock')
    expect(stock.raison).toMatch(/50\s000/)
    expect(verifierEnvoiSiege({ ligne, montant: 'abc', stock: 500_000 }).motif).toBe('montant')
    expect(verifierEnvoiSiege({ ligne, montant: '50000', stock: 500_000 })).toEqual({ ok: true, valeur: 50000 })
  })
})

describe('TC-385 — les soldes provisoires suivent le serveur', () => {
  it('[TC-385-7] mêmes nombres que TC-383', () => {
    const saisie = (statut, balanceType) => ({ action: 'addSiegeRepayment', transaction: { statut, balanceType, montant: 100_000 } })
    expect(effetRembSiegeSurLesSoldes(soldes(500_000, 300_000), 'Orange', saisie('Non Terminées', 'stock'), null))
      .toEqual(soldes(600_000, 300_000))
    expect(effetRembSiegeSurLesSoldes(soldes(300_000, 300_000), 'Orange', saisie('Validée', 'liquidite'), null))
      .toEqual(soldes(200_000, 400_000))
    expect(effetRembSiegeSurLesSoldes(soldes(440_000, 400_000), 'Orange', { action: 'trashSiegeRepayment', draftId: 'rs-1' }, { balanceType: 'liquidite', montant: 100_000, envoyeAuSiege: 60_000 }))
      .toEqual(soldes(500_000, 300_000))
    expect(effetRembSiegeSurLesSoldes(soldes(600_000, 300_000), 'Orange', { action: 'updateSiegeRepayment', draftId: 'rs-1', updates: { balanceType: 'liquidite', montant: 80_000 } }, { balanceType: 'stock', montant: 100_000, envoyeAuSiege: 0 }))
      .toEqual(soldes(500_000, 380_000))
    expect(effetRembSiegeSurLesSoldes(soldes(500_000, 300_000), 'Orange', { action: 'sendToSiege', draftId: 'rs-1', amount: 60_000 }, null))
      .toEqual(soldes(440_000, 300_000))
  })

  it('[TC-385-8] seul le type « Remb. siège » est un remboursement au siège', () => {
    expect(estRembSiege({ type: 'Remb. siège' })).toBe(true)
    expect(estRembSiege({ type: 'Retrait' })).toBe(false)
    expect(estRembSiege(undefined)).toBe(false)
  })
})
