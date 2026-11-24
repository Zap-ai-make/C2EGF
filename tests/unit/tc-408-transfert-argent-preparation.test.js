import { describe, expect, it } from 'vitest'
import { formatCurrency } from '../../src/utils/formatCurrency.js'
import {
  TYPE_TRANSFERT_ARGENT,
  SERVICES_TRANSFERT,
  OPERATIONS_TRANSFERT,
  TRANSFERT_ARGENT_ACTIF,
  estTransfertArgent,
  libelleTransfert,
  evaluerTransfertArgent,
  preparerTransfertArgent,
  montantTranchePropose,
  verifierTrancheTransfert,
  consequenceAnnulationTransfert,
  resumeTransfert,
  effetTransfertSurLesSoldes,
} from '../../src/utils/transfertArgent.js'

/**
 * TC-408 — les transferts d'argent côté navigateur : ce que le formulaire
 * permet, ce qui part au serveur, et ce qu'une commande en attente fait aux
 * soldes provisoires (docs/superpowers/specs/2026-11-23-transferts-argent-design.md).
 * Les soldes recopient l'arithmétique du serveur (TC-403).
 */

const COMPLET = {
  service: 'Western Union', operation: 'transfert', nomClient: 'DIALLO Awa', montant: '50000', balanceType: 'liquidite',
  stock: 300_000, liquidite: 200_000,
}
const fcfa = (montant) => `${montant.toLocaleString('fr-FR')} FCFA`

describe('TC-408 — constantes', () => {
  it('[TC-408-00] recopiées du serveur, drapeau allumé pour C2EGF', () => {
    expect(TYPE_TRANSFERT_ARGENT).toBe('Transfert argent')
    expect(SERVICES_TRANSFERT).toEqual(['Western Union', 'Ria', 'MoneyGram', 'Autres'])
    expect(OPERATIONS_TRANSFERT).toEqual(['transfert', 'retrait'])
    expect(TRANSFERT_ARGENT_ACTIF).toBe(true)
    expect(estTransfertArgent({ type: 'Transfert argent' })).toBe(true)
    expect(estTransfertArgent({ type: 'Dépôt' })).toBe(false)
  })
})

describe('TC-408 — évaluer', () => {
  it('[TC-408-01] la première raison, dans l’ordre', () => {
    const raison = (champs) => evaluerTransfertArgent({ ...COMPLET, ...champs }).raison
    expect(raison({ service: '' })).toBe('Choisissez le service.')
    expect(raison({ operation: '' })).toBe('Choisissez Transfert ou Retrait.')
    expect(raison({ nomClient: '   ' })).toBe('Nom du client obligatoire.')
    expect(raison({ telephone: '70AB' })).toBe('Téléphone : chiffres seulement.')
    expect(raison({ montant: '0' })).toBe('Montant invalide (entier supérieur à 0).')
    expect(raison({ balanceType: '' })).toBe('Choisissez Stock ou Espèce.')
    expect(evaluerTransfertArgent(COMPLET)).toEqual({ ok: true, raison: '' })
  })

  it('[TC-408-02] un retrait demande la réserve ; un transfert, non', () => {
    expect(evaluerTransfertArgent({ ...COMPLET, operation: 'retrait', montant: '250000' })).toEqual({ ok: false, raison: 'Espèce insuffisante.' })
    expect(evaluerTransfertArgent({ ...COMPLET, operation: 'retrait', montant: '350000', balanceType: 'stock' })).toEqual({ ok: false, raison: 'Stock insuffisant.' })
    expect(evaluerTransfertArgent({ ...COMPLET, montant: '250000' }).ok).toBe(true)
  })
})

describe('TC-408 — préparer', () => {
  it('[TC-408-03] la charge exacte de addMoneyTransfer', () => {
    const preparation = preparerTransfertArgent({
      ...COMPLET, nomClient: '  DIALLO   Awa ', telephone: '70 12 34 56', codeTransfert: ' 123 ', servicePrecise: 'Wari',
    })
    expect(preparation.ok).toBe(true)
    expect(preparation.transaction).toEqual({
      service: 'Western Union', operation: 'transfert', nomClient: 'DIALLO Awa', telephone: '70123456',
      codeTransfert: '123', montant: 50_000, balanceType: 'liquidite',
    })
    for (const champ of ['client', 'clientId', 'code', 'servicePrecise']) expect(preparation.transaction).not.toHaveProperty(champ)
    expect(preparation.details).toEqual({
      service: 'Western Union', operation: 'Transfert', clientName: 'DIALLO Awa', amount: (50_000).toLocaleString('fr-FR'), reserve: 'Reçu en Espèce',
    })
    const autre = preparerTransfertArgent({ ...COMPLET, service: 'Autres', servicePrecise: ' Wari ', operation: 'retrait', balanceType: 'stock', montant: '1000' })
    expect(autre.transaction.servicePrecise).toBe('Wari')
    expect(autre.details).toMatchObject({ service: 'Wari', operation: 'Retrait', reserve: 'Payé en Stock' })
    expect(preparerTransfertArgent({ ...COMPLET, service: '' })).toEqual({ ok: false, raison: 'Choisissez le service.' })
  })
})

describe('TC-408 — libellé', () => {
  it('[TC-408-04] service · opération, « Précisez » à la place de Autres', () => {
    expect(libelleTransfert({ service: 'Western Union', operation: 'transfert' })).toBe('Western Union · Transfert')
    expect(libelleTransfert({ service: 'Autres', servicePrecise: 'Wari', operation: 'retrait' })).toBe('Wari · Retrait')
    expect(libelleTransfert({ service: 'Autres', operation: 'retrait' })).toBe('Autres · Retrait')
  })
})

describe('TC-408 — tranches', () => {
  const transfert = { operation: 'transfert', montant: 50_000, montantTraite: 0, resteATraiter: 50_000 }
  const retrait = { ...transfert, operation: 'retrait' }

  it('[TC-408-05] proposé et vérifié : un transfert est plafonné au stock, un retrait non', () => {
    expect(montantTranchePropose({ ligne: transfert, stock: 20_000 })).toBe('20000')
    expect(montantTranchePropose({ ligne: transfert, stock: 900_000 })).toBe('50000')
    expect(montantTranchePropose({ ligne: retrait, stock: 0 })).toBe('50000')
    expect(verifierTrancheTransfert({ ligne: transfert, montant: '30000', stock: 20_000 }))
      .toEqual({ ok: false, motif: 'stock', raison: `Stock insuffisant. Disponible : ${formatCurrency(20_000)}.` })
    expect(verifierTrancheTransfert({ ligne: retrait, montant: '50000', stock: 0 })).toEqual({ ok: true, valeur: 50_000 })
    expect(verifierTrancheTransfert({ ligne: retrait, montant: '60000', stock: 0 }))
      .toEqual({ ok: false, motif: 'reste', raison: `Supérieur au reste (${formatCurrency(50_000)}).` })
    expect(verifierTrancheTransfert({ ligne: retrait, montant: 'x', stock: 0 }))
      .toEqual({ ok: false, motif: 'montant', raison: 'Montant invalide (entier supérieur à 0).' })
  })
})

describe('TC-408 — soldes provisoires', () => {
  const S = { Orange: { stock: 300_000, liquidite: 200_000 } }
  const ajout = (transaction) => ({ action: 'addMoneyTransfer', transaction })

  it('[TC-408-06] les quatre commandes, égales au serveur (TC-403)', () => {
    expect(effetTransfertSurLesSoldes(S, 'Orange', ajout({ operation: 'transfert', balanceType: 'liquidite', montant: 50_000 })).Orange)
      .toEqual({ stock: 300_000, liquidite: 250_000 })
    expect(effetTransfertSurLesSoldes(S, 'Orange', ajout({ operation: 'retrait', balanceType: 'stock', montant: 75_000 })).Orange)
      .toEqual({ stock: 225_000, liquidite: 200_000 })
    const avantT = { operation: 'transfert', montant: 50_000, balanceType: 'stock', montantTraite: 20_000 }
    expect(effetTransfertSurLesSoldes(S, 'Orange', { action: 'settleMoneyTransfer', amount: 20_000 }, avantT).Orange).toEqual({ stock: 280_000, liquidite: 200_000 })
    expect(effetTransfertSurLesSoldes(S, 'Orange', { action: 'settleMoneyTransfer', amount: 75_000 }, { ...avantT, operation: 'retrait' }).Orange)
      .toEqual({ stock: 375_000, liquidite: 200_000 })
    const avantR = { operation: 'retrait', montant: 75_000, balanceType: 'stock', montantTraite: 0 }
    expect(effetTransfertSurLesSoldes(S, 'Orange', { action: 'updateMoneyTransfer', updates: { montant: 60_000, balanceType: 'liquidite' } }, avantR).Orange)
      .toEqual({ stock: 375_000, liquidite: 140_000 })
    expect(effetTransfertSurLesSoldes({ Orange: { stock: 30_000, liquidite: 0 } }, 'Orange', { action: 'trashMoneyTransfer' }, avantT).Orange.stock).toBe(0)
    // Sans la ligne visée, on ne peut rien dire.
    expect(effetTransfertSurLesSoldes(S, 'Orange', { action: 'settleMoneyTransfer', amount: 1 }, null)).toBeNull()
    expect(effetTransfertSurLesSoldes(S, 'Orange', { action: 'inconnue' })).toBeNull()
  })

  it('[TC-408-06b] le résumé d’une ligne garde ce qu’il faut pour la défaire', () => {
    expect(resumeTransfert({ operation: 'retrait', montant: 75_000, balanceType: 'stock', montantTraite: '10000', nomClient: 'X' }))
      .toEqual({ operation: 'retrait', montant: 75_000, balanceType: 'stock', montantTraite: 10_000 })
  })
})

describe('TC-408 — annulation', () => {
  it('[TC-408-07] la phrase dit ce qui revient et ce qui sort', () => {
    expect(consequenceAnnulationTransfert({ operation: 'transfert', montant: 50_000, balanceType: 'liquidite', montantTraite: 20_000 }))
      .toBe(`Les ${fcfa(50_000)} reçus sortiront de l’espèce ; les ${fcfa(20_000)} déjà envoyés au siège reviendront au stock.`)
    expect(consequenceAnnulationTransfert({ operation: 'transfert', montant: 50_000, balanceType: 'stock', montantTraite: 0 }))
      .toBe(`Les ${fcfa(50_000)} reçus sortiront du stock.`)
    expect(consequenceAnnulationTransfert({ operation: 'retrait', montant: 75_000, balanceType: 'liquidite', montantTraite: 75_000 }))
      .toBe(`Les ${fcfa(75_000)} payés reviendront à l’espèce ; les ${fcfa(75_000)} déjà encaissés sortiront du stock.`)
    expect(consequenceAnnulationTransfert({ operation: 'retrait', montant: 75_000, balanceType: 'stock' }))
      .toBe(`Les ${fcfa(75_000)} payés reviendront au stock.`)
  })
})
