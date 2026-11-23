import { describe, expect, it } from 'vitest'
import { sommesEnAttente, totalCaisse, natureEnAttente } from '../../src/utils/caisse.js'
import { agregerArgentDehors } from '../../src/utils/argentDehors.js'
import { compteCommeVisite, compteCommeVolume } from '../../src/utils/reseauStats.js'
import { createExportData } from '../../src/utils/helpers.js'
import { trouverOperationEnAttente } from '../../src/lib/ia/preparations.js'
import { lireLaCaisse } from '../../src/lib/ia/caisse.js'
import { FICHES } from '../../src/content/aideFiches.js'

/**
 * TC-414 — les lecteurs du navigateur face aux transferts d'argent
 * (docs/superpowers/specs/2026-11-23-transferts-argent-design.md, « Les lecteurs
 * à adapter » et « Le total de la caisse »).
 *
 * Une ligne de transfert n'est ni un dépôt ni un retrait d'agent. Le total de
 * la caisse, lui, doit rester vérifiable à la main : il ne bouge ni à la saisie
 * ni à chaque tranche. Le chiffre d'affaires est TC-272-TA.
 */

const AGENT = { id: 'agent-1', nom: 'KABORE', prenom: 'Issa', orange: '1234567' }
const depot = { id: 'd1', storeId: 'store-a', type: 'Dépôt', montant: 100_000, statut: 'Non Terminées', client: AGENT, clientId: 'agent-1', createdAt: new Date(1) }
const transfert = (autres) => ({
  id: 't1', storeId: 'store-a', type: 'Transfert argent', service: 'Western Union', operation: 'transfert', nomClient: 'DIALLO Awa',
  montant: 50_000, balanceType: 'liquidite', montantTraite: 0, resteATraiter: 50_000, statut: 'Non Terminées', createdAt: new Date(2), ...autres,
})
const retrait = (autres) => transfert({ id: 'r1', service: 'MoneyGram', operation: 'retrait', nomClient: 'OUEDRAOGO Paul', montant: 75_000, resteATraiter: 75_000, ...autres })

/** Le total de la caisse avec les réserves données et les lignes en attente. */
const total = (stock, liquidite, lignes) => {
  const { depots, retraits, siege, transfertsDus, retraitsARecevoir } = sommesEnAttente(lignes)
  return totalCaisse({ stock, liquidite, depots, retraits, siege, transfertsDus, retraitsARecevoir })
}

describe('TC-414 — la caisse', () => {
  it('[TC-414-01] cas C : le total ne bouge ni à la saisie ni aux tranches', () => {
    const depart = total(300_000, 200_000, [])
    // T1 : transfert 50 000 reçu en espèce.
    expect(total(300_000, 250_000, [transfert()])).toBe(depart)
    // R1 : retrait 75 000 payé en espèce.
    expect(total(300_000, 175_000, [transfert(), retrait()])).toBe(depart)
    // Envoi de 20 000 au siège, encaissement de 75 000.
    expect(total(280_000, 175_000, [transfert({ montantTraite: 20_000, resteATraiter: 30_000 }), retrait()])).toBe(depart)
    expect(total(355_000, 175_000, [transfert({ montantTraite: 20_000, resteATraiter: 30_000 })])).toBe(depart)
  })

  it('[TC-414-02] les dépôts et retraits d’agent ne bougent pas ; la nature est « transfert »', () => {
    const r = sommesEnAttente([depot, transfert(), retrait()])
    expect(r).toMatchObject({ depots: 100_000, nbDepots: 1, retraits: 0, nbRetraits: 0, siege: 0, transfertsDus: 50_000, retraitsARecevoir: 75_000, nbTransferts: 2 })
    expect(natureEnAttente(transfert())).toBe('transfert')
    expect(natureEnAttente(retrait())).toBe('transfert')
  })
})

describe('TC-414 — les autres lecteurs', () => {
  it('[TC-414-03] l’argent dehors et les statistiques d’agent ignorent la ligne', () => {
    const r = agregerArgentDehors([depot, transfert(), retrait()], [{ storeId: 'store-a', name: 'FADA' }])
    expect(r).toMatchObject({ depots: 100_000, retraits: 0, illisibles: 0 })
    const validee = transfert({ statut: 'Validée', montantTraite: 50_000, resteATraiter: 0 })
    expect(compteCommeVisite(validee)).toBe(false)
    expect(compteCommeVolume(validee)).toBe(false)
    expect(compteCommeVisite({ ...depot, statut: 'Validée' })).toBe(true)
  })

  it('[TC-414-04] l’export garde la ligne avec son nom, son libellé et son code', () => {
    const [ligne] = createExportData([transfert({ codeTransfert: 'MTCN-77', service: 'Autres', servicePrecise: 'Wari' })])
    expect(ligne).toMatchObject({ Client: 'DIALLO Awa', Type: 'Wari · Transfert', Code: 'MTCN-77' })
  })

  it('[TC-414-05] l’assistant : jamais à régler, et la caisse le dit à part', () => {
    expect(trouverOperationEnAttente([transfert({ nomClient: 'KABORE Awa' }), depot], { client: 'KABORE' })).toEqual({ ligne: depot })
    const caisse = lireLaCaisse({ soldes: { Orange: { stock: 300_000, liquidite: 250_000 } }, enAttente: [transfert(), depot] })
    expect(caisse.depots_non_termines).toEqual({ nombre: 1, montant: 100_000 })
    expect(caisse.retraits_non_termines).toEqual({ nombre: 0, montant: 0 })
    expect(caisse.transferts_non_termines).toEqual({ nombre: 1, a_envoyer_au_siege: 50_000, a_encaisser_du_siege: 0 })
    expect(caisse.total_caisse).toBe(300_000 + 250_000 + 100_000 - 50_000)
  })

  it('[TC-414-06] l’aide dit ce que compte la case des transferts', () => {
    const cases = FICHES.find((fiche) => fiche.titre === 'Les cases au-dessus de la liste')
    expect(cases.etapes.some((etape) => etape.startsWith('{{Transferts}}'))).toBe(true)
  })
})
