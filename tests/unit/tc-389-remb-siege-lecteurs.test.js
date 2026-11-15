import { describe, expect, it } from 'vitest'
import { agregerArgentDehors } from '../../src/utils/argentDehors.js'
import { sommesEnAttente } from '../../src/utils/caisse.js'
import { trouverOperationEnAttente } from '../../src/lib/ia/preparations.js'

/**
 * TC-389 — les lecteurs du navigateur face au remboursement au siège
 * (spec 2026-11-14, « Les lecteurs à adapter »).
 *
 * Une ligne « Remb. siège » en attente est de l'argent que la boutique doit au
 * siège. Aucun lecteur ne doit la prendre pour un dépôt ou un retrait d'agent.
 */

const AGENT = { id: 'agent-1', nom: 'KABORE', prenom: 'Issa', orange: '1234567' }
const depot = { id: 'd1', storeId: 'store-a', type: 'Dépôt', montant: 100000, statut: 'Non Terminées', client: AGENT, clientId: 'agent-1', createdAt: new Date(1) }
const remb = { id: 'r1', storeId: 'store-a', type: 'Remb. siège', montant: 70000, balanceType: 'liquidite', envoyeAuSiege: 0, resteAuSiege: 70000, statut: 'Non Terminées', client: AGENT, clientId: 'agent-1', createdAt: new Date(2) }

describe('TC-389 — argent dehors et caisse', () => {
  it('[TC-389-1] l’argent dehors ne compte que le dépôt, sans ligne illisible', () => {
    const r = agregerArgentDehors([depot, remb], [{ storeId: 'store-a', name: 'FADA' }])
    expect(r.depots).toBe(100000)
    expect(r.retraits).toBe(0)
    expect(r.illisibles).toBe(0)
  })

  it('[TC-389-2] le bandeau des sommes en attente ne compte que le dépôt', () => {
    expect(sommesEnAttente([depot, remb])).toMatchObject({ depots: 100000, nbDepots: 1, retraits: 0, nbRetraits: 0 })
  })
})

describe('TC-389 — l’assistant', () => {
  it('[TC-389-3] l’assistant ne propose pas de régler un remboursement au siège', () => {
    expect(trouverOperationEnAttente([remb, depot], { client: 'KABORE' })).toEqual({ ligne: depot })
    expect(trouverOperationEnAttente([remb], { client: 'KABORE' }).ligne).toBeUndefined()
  })
})
