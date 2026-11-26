import { describe, it, expect, vi, beforeEach } from 'vitest'
import { REFUSEE } from '../../src/services/fileEnvoi.js'

/**
 * TC-396 — Les demandes d'agent, côté caisse, hors de l'écran : la ligne
 * qu'on affiche, l'ordre, la saisie en double, et les deux gestes envoyés au
 * serveur (docs/superpowers/specs/2026-11-17-demandes-agent-design.md §5.5).
 */

const runStoreTransactionCommand = vi.fn()
vi.mock('../../src/services/storeTransactionCommandService.js', () => ({
  runStoreTransactionCommand: (...args) => runStoreTransactionCommand(...args),
}))

import { dejaSaisie, ligneDeDemande, trierDemandes } from '../../src/utils/demandesAgent.js'
import { accepterDemandeAgent, rejeterDemandeAgent } from '../../src/services/demandesAgentService.js'

const H = (heure, minute = 0) => new Date(2026, 10, 17, heure, minute)
const instant = (date) => ({ toDate: () => date, toMillis: () => date.getTime() })

const brute = (over = {}) => ({
  clientId: 'c1', agent: { nom: 'KABORE', prenom: 'Awa', code: '70123456' },
  sens: 'retrait', reseau: 'Orange', montant: 75000, etat: 'en_attente', creeLe: instant(H(10, 34)),
  ...over,
})

beforeEach(() => runStoreTransactionCommand.mockReset())

describe('TC-396 — la ligne d’une demande', () => {
  it('[TC-396-01] le sens devient le type, l’agent le client, sa copie du code le code, creeLe une date', () => {
    expect(ligneDeDemande('d1', brute({ sens: 'depot' }))).toEqual({
      id: 'd1', estDemandeAgent: true, nature: 'operation', sens: 'depot', clientId: 'c1',
      client: { nom: 'KABORE', prenom: 'Awa' }, code: '70123456',
      type: 'Dépôt', reseau: 'Orange', montant: 75000, createdAt: H(10, 34),
    })
    expect(ligneDeDemande('d2', brute()).type).toBe('Retrait')
    expect(ligneDeDemande('d3', brute({ creeLe: H(9).getTime() })).createdAt).toEqual(H(9))
    expect(ligneDeDemande('d4', brute({ creeLe: null })).createdAt).toBeNull()
  })

  it('[TC-396-02] la plus ancienne d’abord : c’est l’agent qui attend depuis le plus longtemps', () => {
    const lignes = [
      ligneDeDemande('b', brute({ creeLe: instant(H(10, 40)) })),
      ligneDeDemande('a', brute({ creeLe: instant(H(10, 5)) })),
      ligneDeDemande('c', brute({ creeLe: instant(H(11)) })),
    ]
    expect(trierDemandes(lignes).map((l) => l.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('TC-396 — déjà saisi ?', () => {
  const demande = ligneDeDemande('d1', brute())
  const op = (over = {}) => ({ id: 'op1', clientId: 'c1', type: 'Retrait', montant: 75000, statut: 'Non Terminées', createdAt: H(10, 51), ...over })

  it('[TC-396-03] une opération du même agent, du même type et du même montant, saisie après la demande', () => {
    expect(dejaSaisie(demande, [op()])).toEqual({ id: 'op1', instantMs: H(10, 51).getTime() })
    // L'historique écrit parfois « Retrait » sans majuscule ni accent identique.
    expect(dejaSaisie(demande, [op({ type: 'retrait', statut: 'Validée' })])).not.toBeNull()
    // La première qui suit la demande, pas la dernière.
    expect(dejaSaisie(demande, [op({ id: 'op2', createdAt: H(11, 30) }), op()])?.id).toBe('op1')
  })

  it('[TC-396-04] rien pour une opération plus ancienne, d’un autre montant, d’un autre type ou agent, supprimée, annulée ou refusée', () => {
    for (const autre of [
      op({ createdAt: H(10, 0) }),
      op({ montant: 70000 }),
      op({ type: 'Dépôt' }),
      op({ clientId: 'c2' }),
      op({ statut: 'Supprimée' }),
      op({ statut: 'Annulée' }),
      op({ envoi: { etat: REFUSEE } }),
      op({ id: 'd1' }),
    ]) {
      expect(dejaSaisie(demande, [autre])).toBeNull()
    }
    expect(dejaSaisie(demande, [])).toBeNull()
  })
})

describe('TC-396 — les gestes envoyés au serveur', () => {
  it('[TC-396-05] accepter et rejeter appellent la commande de la caisse, sans la file d’envoi', async () => {
    runStoreTransactionCommand.mockResolvedValue({ accepted: true })
    await accepterDemandeAgent('d1', 'Validée')
    expect(runStoreTransactionCommand).toHaveBeenLastCalledWith({ action: 'acceptAgentRequest', demandeId: 'd1', statut: 'Validée' })
    await accepterDemandeAgent('d1', 'Non Terminées')
    expect(runStoreTransactionCommand).toHaveBeenLastCalledWith({ action: 'acceptAgentRequest', demandeId: 'd1', statut: 'Non Terminées' })
    await rejeterDemandeAgent('d1')
    expect(runStoreTransactionCommand).toHaveBeenLastCalledWith({ action: 'rejectAgentRequest', demandeId: 'd1' })

    const refus = Object.assign(new Error('L’agent a annulé cette demande.'), { code: 'DEMANDE_CLOSE' })
    runStoreTransactionCommand.mockRejectedValueOnce(refus)
    await expect(accepterDemandeAgent('d1', 'Validée')).rejects.toBe(refus)
  })
})
