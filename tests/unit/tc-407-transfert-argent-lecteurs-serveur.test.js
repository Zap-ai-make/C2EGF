import { describe, expect, it } from 'vitest'
import { aggregateOutstandingDrafts } from '../../functions/src/dealerMetrics/listOutstandingDrafts.js'
import { ligneDeDocument } from '../../functions/src/clients/historiqueClient.js'

/**
 * TC-407 — les lecteurs serveur ignorent les transferts d'argent
 * (docs/superpowers/specs/2026-11-23-transferts-argent-design.md, « Les lecteurs
 * à adapter »). Une ligne de transfert n'est ni un dépôt ni un retrait d'agent :
 * elle ne compte pas dans l'argent dehors du dealer, et n'est la dette de
 * personne dans un historique d'agent. Le cas Oxygen est TC-377-TA.
 */

const doc = (id, data) => ({ id, data: () => data })
const TRANSFERT = {
  storeId: 'store-a', type: 'Transfert argent', service: 'Ria', operation: 'retrait', nomClient: 'DIALLO Awa',
  balanceType: 'stock', montant: 75_000, montantTraite: 0, resteATraiter: 75_000, statut: 'Non Terminées',
}

describe('TC-407 — lecteurs serveur', () => {
  it('[TC-407-01] l’agrégat du dealer ignore le transfert, sans le compter parmi les illisibles', () => {
    const resultat = aggregateOutstandingDrafts({
      stores: [doc('store-a', { name: 'FADA' })],
      drafts: [{ storeId: 'store-a', type: 'Dépôt', montant: 100_000 }, TRANSFERT, { ...TRANSFERT, operation: 'transfert' }],
    })
    expect(resultat).toMatchObject({ depots: 100_000, retraits: 0, dehors: 100_000, illisibles: 0, horsReseau: 0 })
  })

  it('[TC-407-03] dans un historique, un transfert n’a pas de reste dû', () => {
    const ligne = ligneDeDocument({
      id: 't1', chemin: 'clients/store-a/drafts/t1', donnees: TRANSFERT, source: 'draft', nomsDeBoutique: new Map(),
    })
    expect(ligne.reste).toBe(0)
  })
})
