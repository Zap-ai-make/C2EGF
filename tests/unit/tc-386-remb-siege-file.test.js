import { describe, it, expect, vi, beforeEach } from 'vitest'

const { runStoreTransactionCommand } = vi.hoisted(() => ({ runStoreTransactionCommand: vi.fn() }))
vi.mock('../../src/services/storeTransactionCommandService.js', () => ({ runStoreTransactionCommand }))
vi.mock('../../src/services/settlementService.js', () => ({ addTransactionPayment: vi.fn(), addTransactionRefund: vi.fn() }))
vi.mock('../../src/services/firestore.js', () => ({ firestoreService: {} }))

import { EN_ATTENTE, REFUSEE, REMB_SIEGE } from '../../src/services/fileEnvoi.js'
import { executerEnvoi } from '../../src/services/envois.js'
import { appliquerFile, soldesProvisoires } from '../../src/utils/envoisEnAttente.js'
import { verifierEnvoiSiege } from '../../src/utils/rembSiege.js'
import { decrireOperation } from '../../src/components/EnvoisListe.jsx'

/**
 * TC-386 — le remboursement au siège passe par la file d'envoi
 * (docs/superpowers/specs/2026-11-14-remboursement-siege-design.md, « Le hors
 * connexion »). Écrit d'abord sur l'appareil, il s'affiche et compte dans les
 * soldes provisoires avant que le serveur l'ait reçu, comme le ravitaillement.
 */

const CREE_LE = Date.UTC(2026, 10, 14, 9, 0)
const op = (id, commande, autres = {}) => ({
  id, type: REMB_SIEGE, charge: { commande, reseau: 'Orange', ...autres.charge }, etat: EN_ATTENTE, creeLe: CREE_LE, tentatives: 0, erreur: null, ...autres.op,
})
const AGENT = { id: 'agent-1', nom: 'KABORE', prenom: 'Issa', orange: '1234567' }
const saisie = (id, autres) => op(id, {
  action: 'addSiegeRepayment',
  transaction: { client: AGENT, clientId: 'agent-1', code: '1234567', montant: 100_000, balanceType: 'liquidite', statut: 'Non Terminées', ...autres },
})
const envoi = (id, draftId, amount) => op(id, { action: 'sendToSiege', draftId, amount })
const SOLDES = { Orange: { stock: 500_000, liquidite: 300_000 } }
const soldes = operations => soldesProvisoires(SOLDES, operations).soldes.Orange
const serveur = { id: 'rs-1', type: 'Remb. siège', clientId: 'agent-1', reseau: 'Orange', montant: 100_000, balanceType: 'liquidite', envoyeAuSiege: 60_000, resteAuSiege: 40_000, envoisSiege: [{ id: 'e0', montant: 60_000 }], statut: 'Non Terminées' }

beforeEach(() => runStoreTransactionCommand.mockReset())

describe('TC-386 — la saisie', () => {
  it('[TC-386-1] en attente, reçu en Espèce : une non terminée sous l’identifiant de l’opération, l’espèce monte', () => {
    const { nonTerminees } = appliquerFile([], [], [saisie('op-1')])
    expect(nonTerminees).toHaveLength(1)
    expect(nonTerminees[0]).toMatchObject({ id: 'op-1', type: 'Remb. siège', resteAuSiege: 100_000, envoyeAuSiege: 0, reseau: 'Orange' })
    expect(soldes([saisie('op-1')])).toEqual({ stock: 500_000, liquidite: 400_000 })
  })

  it('[TC-386-2] validée, reçu en Stock : une ligne d’historique, les soldes ne bougent pas', () => {
    const { nonTerminees, historique } = appliquerFile([], [], [saisie('op-2', { statut: 'Validée', balanceType: 'stock' })])
    expect(nonTerminees).toHaveLength(0)
    expect(historique[0]).toMatchObject({ id: 'op-2', type: 'Remb. siège', statut: 'Validée', resteAuSiege: 0 })
    expect(soldes([saisie('op-2', { statut: 'Validée', balanceType: 'stock' })])).toEqual(SOLDES.Orange)
  })
})

describe('TC-386 — les tranches hors ligne', () => {
  it('[TC-386-3] la seconde tranche lit le reste APRÈS la première', () => {
    const premiere = appliquerFile([], [], [saisie('op-1'), envoi('env-1', 'op-1', 60_000)])
    const ligne = premiere.nonTerminees[0]
    expect(ligne).toMatchObject({ resteAuSiege: 40_000, envoyeAuSiege: 60_000 })
    expect(verifierEnvoiSiege({ ligne, montant: '50000', stock: 1_000_000 }).motif).toBe('reste')

    const toutes = appliquerFile([], [], [saisie('op-1'), envoi('env-1', 'op-1', 60_000), envoi('env-2', 'op-1', 40_000)])
    expect(toutes.nonTerminees).toHaveLength(0)
    expect(toutes.historique[0]).toMatchObject({ id: 'op-1', statut: 'Validée', resteAuSiege: 0, envoyeAuSiege: 100_000 })
    expect(soldes([saisie('op-1'), envoi('env-1', 'op-1', 60_000), envoi('env-2', 'op-1', 40_000)])).toEqual({ stock: 400_000, liquidite: 400_000 })
  })
})

describe('TC-386 — annuler et modifier', () => {
  it('[TC-386-4] l’annulation d’une ligne du serveur rend ses deux jambes et la met à la corbeille', () => {
    const annulation = op('remb_siege-annulation-rs-1', { action: 'trashSiegeRepayment', draftId: 'rs-1' }, { charge: { avant: { montant: 100_000, balanceType: 'liquidite', envoyeAuSiege: 60_000 } } })
    const { nonTerminees, historique } = appliquerFile([serveur], [], [annulation])
    expect(nonTerminees).toHaveLength(0)
    expect(historique[0]).toMatchObject({ type: 'Remb. siège', statut: 'Supprimée' })
    expect(soldes([annulation])).toEqual({ stock: 560_000, liquidite: 200_000 })
  })

  it('[TC-386-5] la modification met à jour le montant, la réserve et le reste', () => {
    const avant = { ...serveur, envoyeAuSiege: 0, resteAuSiege: 100_000, envoisSiege: [] }
    const modification = op('mod-1', { action: 'updateSiegeRepayment', draftId: 'rs-1', updates: { montant: 80_000, balanceType: 'stock' } }, { charge: { avant: { montant: 100_000, balanceType: 'liquidite', envoyeAuSiege: 0 } } })
    const { nonTerminees } = appliquerFile([avant], [], [modification])
    expect(nonTerminees[0]).toMatchObject({ montant: 80_000, balanceType: 'stock', resteAuSiege: 80_000 })
    expect(soldes([modification])).toEqual({ stock: 580_000, liquidite: 200_000 })
  })
})

describe('TC-386 — refusée par le serveur', () => {
  it('[TC-386-6] une saisie refusée reste visible sur sa ligne, avec sa raison, hors des soldes', () => {
    const refusee = saisie('op-9', { statut: 'Validée' })
    refusee.etat = REFUSEE
    refusee.erreur = { code: 'STORE_TRANSACTION_INVALID', message: 'Commande inconnue.' }
    const { historique } = appliquerFile([], [], [refusee])
    expect(historique[0].envoi).toEqual({ etat: REFUSEE, erreur: { code: 'STORE_TRANSACTION_INVALID', message: 'Commande inconnue.' } })
    expect(soldes([refusee])).toEqual(SOLDES.Orange)
  })
})

describe('TC-386 — l’envoi au serveur et sa description', () => {
  it('[TC-386-7] la commande part telle quelle, avec son identifiant et son âge', async () => {
    runStoreTransactionCommand.mockResolvedValue({ id: 'op-1' })
    const operation = envoi('env-1', 'rs-1', 60_000)
    await executerEnvoi(operation, CREE_LE + 5000)
    expect(runStoreTransactionCommand).toHaveBeenCalledWith({ action: 'sendToSiege', draftId: 'rs-1', amount: 60_000, commandeId: 'env-1', ageMs: 5000 })
  })

  it('[TC-386-8] la liste des envois dit ce qui attend', () => {
    expect(decrireOperation(saisie('op-1'))).toMatch(/^Remb\. siège de 100\s000 FCFA en espèce — Issa KABORE$/)
    expect(decrireOperation(envoi('env-1', 'rs-1', 60_000))).toMatch(/^Envoi au siège de 60\s000 FCFA$/)
    expect(decrireOperation(op('a', { action: 'trashSiegeRepayment', draftId: 'rs-1' }, { charge: { avant: { montant: 100_000 } } }))).toMatch(/^Annulation : Remb\. siège de 100\s000 FCFA$/)
    expect(decrireOperation(op('m', { action: 'updateSiegeRepayment', draftId: 'rs-1', updates: { montant: 80_000 } }, { charge: { avant: { montant: 100_000 } } }))).toMatch(/^Correction : Remb\. siège de 80\s000 FCFA$/)
  })
})
