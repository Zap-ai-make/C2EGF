import { describe, it, expect } from 'vitest'
import {
  actionDeReglement,
  montantProposeDuReglement,
  verifierMontantReglement,
} from '../../src/utils/reglement.js'

/**
 * TC-307 — Les règles d'un règlement, hors du tableau.
 *
 * TC-306 garde le tableau des non terminées ; ceci garde les règles qu'il
 * partage désormais avec l'assistant.
 */

const DEPOT = { id: 'd-1', type: 'Dépôt', montant: 50000 }

describe('TC-307 — actionDeReglement', () => {
  it('[RG-01] chaque nature a son geste : encaisser, payer par, rembourser', () => {
    expect(actionDeReglement('Dépôt')).toBe('encaisser')
    expect(actionDeReglement('Retrait')).toBe('payerPar')
    expect(actionDeReglement('Crédit')).toBe('rembourser')
    expect(actionDeReglement('Ravitaillement')).toBeNull()
  })
})

describe('TC-307 — montantProposeDuReglement', () => {
  it('[RG-02] le reste dû, sinon le montant entier', () => {
    expect(montantProposeDuReglement(DEPOT)).toBe(50000)
    expect(montantProposeDuReglement({ ...DEPOT, remainingAmount: 30000 })).toBe(30000)
    expect(montantProposeDuReglement({ ...DEPOT, remainingAmount: 0 })).toBe(0)
  })
})

describe('TC-307 — verifierMontantReglement', () => {
  const verifier = (montant, transaction = DEPOT, action = 'encaisser') =>
    verifierMontantReglement({ transaction, action, montant })

  it('[RG-03] un entier d’au moins 500 FCFA', () => {
    expect(verifier('400')).toEqual({ ok: false, raison: 'Montant invalide (minimum 500 FCFA, entier)' })
    expect(verifier('')).toMatchObject({ ok: false })
    expect(verifier('abc')).toMatchObject({ ok: false })
    expect(verifier('500')).toEqual({ ok: true, valeur: 500 })
    expect(verifier(20000)).toEqual({ ok: true, valeur: 20000 })
  })

  it('[RG-04] au plus le reste dû, pour encaisser comme pour payer', () => {
    const partiel = { ...DEPOT, remainingAmount: 30000 }
    expect(verifier('35000', partiel)).toEqual({
      ok: false,
      raison: `Maximum : ${(30000).toLocaleString('fr-FR')} FCFA (reste dû)`,
    })
    expect(verifier('30000', partiel, 'payerPar')).toEqual({ ok: true, valeur: 30000 })
  })

  it('[RG-05] un remboursement au plus le net payé', () => {
    const credit = { ...DEPOT, type: 'Crédit', paidAmount: 20000, refundedAmount: 5000 }
    expect(verifier('16000', credit, 'rembourser')).toEqual({
      ok: false,
      raison: `Maximum remboursable : ${(15000).toLocaleString('fr-FR')} FCFA`,
    })
    expect(verifier('15000', credit, 'rembourser')).toEqual({ ok: true, valeur: 15000 })
  })

  it('[RG-06] sans trace de paiement, un remboursement n’a pas de plafond', () => {
    expect(verifier('80000', { ...DEPOT, type: 'Crédit' }, 'rembourser')).toEqual({ ok: true, valeur: 80000 })
  })

  it('[RG-07] une ligne disparue ne plafonne rien', () => {
    expect(verifier('999999', null)).toEqual({ ok: true, valeur: 999999 })
  })
})
