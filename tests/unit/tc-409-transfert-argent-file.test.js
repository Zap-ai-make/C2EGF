import { describe, it, expect, vi, beforeEach } from 'vitest'

const { runStoreTransactionCommand } = vi.hoisted(() => ({ runStoreTransactionCommand: vi.fn() }))
vi.mock('../../src/services/storeTransactionCommandService.js', () => ({ runStoreTransactionCommand }))
vi.mock('../../src/services/settlementService.js', () => ({ addTransactionPayment: vi.fn(), addTransactionRefund: vi.fn() }))
vi.mock('../../src/services/firestore.js', () => ({ firestoreService: {} }))

import { EN_ATTENTE, REFUSEE, TRANSFERT_ARGENT } from '../../src/services/fileEnvoi.js'
import { executerEnvoi } from '../../src/services/envois.js'
import { appliquerFile, soldesProvisoires } from '../../src/utils/envoisEnAttente.js'
import { resumeTransfert } from '../../src/utils/transfertArgent.js'
import { decrireOperation } from '../../src/components/EnvoisListe.jsx'

/**
 * TC-409 — les transferts d'argent passent par la file d'envoi
 * (docs/superpowers/specs/2026-11-23-transferts-argent-design.md, « Le hors
 * connexion »). Écrits d'abord sur l'appareil, ils s'affichent et comptent dans
 * les soldes provisoires avant que le serveur les ait reçus.
 */

const CREE_LE = Date.UTC(2026, 10, 23, 9, 0)
const op = (id, commande, autres = {}) => ({
  id, type: TRANSFERT_ARGENT, charge: { commande, reseau: 'Orange', ...autres.charge }, etat: EN_ATTENTE, creeLe: CREE_LE, tentatives: 0, erreur: null, ...autres.op,
})
const saisie = (id, autres) => op(id, {
  action: 'addMoneyTransfer',
  transaction: { service: 'Western Union', operation: 'transfert', nomClient: 'DIALLO Awa', montant: 50_000, balanceType: 'liquidite', ...autres },
})
const tranche = (id, draftId, amount, avant) => op(id, { action: 'settleMoneyTransfer', draftId, amount }, { charge: { avant } })
const SOLDES = { Orange: { stock: 300_000, liquidite: 200_000 } }
const soldes = operations => soldesProvisoires(SOLDES, operations).soldes.Orange
const serveur = {
  id: 'ta-1', type: 'Transfert argent', service: 'Ria', operation: 'retrait', nomClient: 'OUEDRAOGO Paul', reseau: 'Orange',
  montant: 75_000, balanceType: 'stock', montantTraite: 0, resteATraiter: 75_000, tranches: [], statut: 'Non Terminées',
}

beforeEach(() => runStoreTransactionCommand.mockReset())

describe('TC-409 — l’envoi au serveur', () => {
  it('[TC-409-01] la commande part telle quelle, avec son identifiant et son âge', async () => {
    runStoreTransactionCommand.mockResolvedValue({ settled: true })
    await executerEnvoi(tranche('t-1', 'ta-1', 20_000, resumeTransfert(serveur)), CREE_LE + 5000)
    expect(runStoreTransactionCommand).toHaveBeenCalledWith({ action: 'settleMoneyTransfer', draftId: 'ta-1', amount: 20_000, commandeId: 't-1', ageMs: 5000 })
  })
})

describe('TC-409 — la saisie et les tranches', () => {
  it('[TC-409-02] la saisie en file : une non terminée sous l’identifiant de l’opération, l’espèce monte', () => {
    const { nonTerminees } = appliquerFile([], [], [saisie('op-1')])
    expect(nonTerminees).toHaveLength(1)
    expect(nonTerminees[0]).toMatchObject({
      id: 'op-1', type: 'Transfert argent', nomClient: 'DIALLO Awa', statut: 'Non Terminées',
      montantTraite: 0, resteATraiter: 50_000, tranches: [], reseau: 'Orange',
    })
    expect(soldes([saisie('op-1')])).toEqual({ stock: 300_000, liquidite: 250_000 })
  })

  it('[TC-409-03] une tranche en file sur une ligne du serveur : traité et reste projetés', () => {
    const t = tranche('t-1', 'ta-1', 25_000, resumeTransfert(serveur))
    const { nonTerminees } = appliquerFile([serveur], [], [t])
    expect(nonTerminees[0]).toMatchObject({ montantTraite: 25_000, resteATraiter: 50_000 })
    expect(soldes([t])).toEqual({ stock: 325_000, liquidite: 200_000 })
  })

  it('[TC-409-04] saisie et tranches hors ligne sur la même ligne : soldes justes, passage à l’historique', () => {
    const ajout = saisie('op-1', { balanceType: 'stock' })
    const projetee = appliquerFile([], [], [ajout]).nonTerminees[0]
    const t1 = tranche('t-1', 'op-1', 20_000, resumeTransfert(projetee))
    const t2 = tranche('t-2', 'op-1', 30_000, resumeTransfert(projetee))
    const { nonTerminees, historique } = appliquerFile([], [], [ajout, t1, t2])
    expect(nonTerminees).toHaveLength(0)
    expect(historique[0]).toMatchObject({ id: 'op-1', statut: 'Validée', montantTraite: 50_000, resteATraiter: 0 })
    expect(soldes([ajout, t1, t2])).toEqual(SOLDES.Orange)

    // Revenues du serveur, les opérations parties ne s'appliquent plus.
    const duServeur = { ...projetee, id: 'op-1', montantTraite: 50_000, resteATraiter: 0, tranches: [{ id: 't-1', montant: 20_000 }, { id: 't-2', montant: 30_000 }], statut: 'Validée' }
    const apres = appliquerFile([], [duServeur], [])
    expect(apres.historique[0]).toMatchObject({ montantTraite: 50_000 })
  })
})

describe('TC-409 — annuler et modifier', () => {
  it('[TC-409-05] l’annulation d’une ligne du serveur la met à la corbeille et rend sa réserve', () => {
    const annulation = op('transfert_argent-annulation-ta-1', { action: 'trashMoneyTransfer', draftId: 'ta-1' }, { charge: { avant: resumeTransfert(serveur) } })
    const { nonTerminees, historique } = appliquerFile([serveur], [], [annulation])
    expect(nonTerminees).toHaveLength(0)
    expect(historique[0]).toMatchObject({ type: 'Transfert argent', statut: 'Supprimée', origin: 'draft' })
    expect(soldes([annulation])).toEqual({ stock: 375_000, liquidite: 200_000 })
  })

  it('[TC-409-05b] la modification met à jour les champs retenus et le reste, jamais l’opération', () => {
    const modification = op('mod-1', { action: 'updateMoneyTransfer', draftId: 'ta-1', updates: { montant: 60_000, balanceType: 'liquidite', operation: 'transfert', nomClient: 'X' } }, { charge: { avant: resumeTransfert(serveur) } })
    const { nonTerminees } = appliquerFile([serveur], [], [modification])
    expect(nonTerminees[0]).toMatchObject({ operation: 'retrait', montant: 60_000, balanceType: 'liquidite', resteATraiter: 60_000, nomClient: 'X' })
    expect(soldes([modification])).toEqual({ stock: 375_000, liquidite: 140_000 })
  })

  it('[TC-409-05c] une saisie refusée reste visible, hors des soldes', () => {
    const refusee = saisie('op-9')
    refusee.etat = REFUSEE
    refusee.erreur = { code: 'STORE_TRANSACTION_INVALID', message: 'Transferts d’argent non activés pour cette boutique.' }
    const { nonTerminees } = appliquerFile([], [], [refusee])
    expect(nonTerminees[0]?.envoi?.etat).toBe(REFUSEE)
    expect(soldes([refusee])).toEqual(SOLDES.Orange)
  })
})

describe('TC-409 — la liste des envois', () => {
  it('[TC-409-06] dit ce qui attend, dans les mots de la caissière', () => {
    expect(decrireOperation(saisie('op-1'))).toMatch(/^Western Union · Transfert de 50\s000 FCFA en espèce — DIALLO Awa$/)
    expect(decrireOperation(tranche('t', 'ta-1', 20_000, { operation: 'transfert' }))).toMatch(/^Envoi au siège de 20\s000 FCFA$/)
    expect(decrireOperation(tranche('t', 'ta-1', 75_000, { operation: 'retrait' }))).toMatch(/^Encaissement de 75\s000 FCFA$/)
    expect(decrireOperation(op('m', { action: 'updateMoneyTransfer', draftId: 'ta-1', updates: { montant: 60_000 } }, { charge: { avant: resumeTransfert(serveur) } })))
      .toMatch(/^Correction : Retrait de 60\s000 FCFA$/)
    expect(decrireOperation(op('a', { action: 'trashMoneyTransfer', draftId: 'ta-1' }, { charge: { avant: resumeTransfert(serveur) } })))
      .toMatch(/^Annulation : Retrait de 75\s000 FCFA$/)
  })
})
