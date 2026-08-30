/**
 * TC-086 — shapeDealerInventory : façonnage (pur) de l'inventaire dealer pour l'UI.
 *
 * Chantier dealer multi-réseaux (couche front, affichage). Vérifie :
 *   • mono-réseau : stock/liquidite = réseau unique (rétro-compat vue Orange) ;
 *   • multi-réseaux : une entrée par réseau du profil, réseaux absents → 0 ;
 *   • totalLiquidite = somme des liquidités de tous les réseaux (carte globale) ;
 *   • robustesse aux données Firestore manquantes/invalides (→ 0) ;
 *   • emptyDealerInventory = tous réseaux à 0.
 */

import { describe, it, expect } from 'vitest'
import { shapeDealerInventory, emptyDealerInventory } from '../../src/utils/dealerInventory.js'

describe('TC-086 — shapeDealerInventory', () => {
  it('mono-réseau : stock/liquidite = réseau unique (rétro-compat vue Orange)', () => {
    const r = shapeDealerInventory({ balances: { Orange: { stock: 960000, liquidite: 200000 } } }, ['Orange'])
    expect(r.stock).toBe(960000)
    expect(r.liquidite).toBe(200000)
    expect(r.byNetwork).toEqual({ Orange: { stock: 960000, liquidite: 200000 } })
    expect(r.totalLiquidite).toBe(200000)
  })

  it('multi-réseaux : une entrée par réseau du profil, réseaux absents → 0', () => {
    const r = shapeDealerInventory(
      { balances: { Orange: { stock: 960000, liquidite: 200000 }, Coris: { stock: 20000, liquidite: 5000 } } },
      ['Orange', 'Moov', 'Telecel', 'Coris', 'Sank'],
    )
    expect(r.byNetwork.Orange).toEqual({ stock: 960000, liquidite: 200000 })
    expect(r.byNetwork.Moov).toEqual({ stock: 0, liquidite: 0 })       // absent → 0
    expect(r.byNetwork.Coris).toEqual({ stock: 20000, liquidite: 5000 })
    expect(r.byNetwork.Sank).toEqual({ stock: 0, liquidite: 0 })
    expect(Object.keys(r.byNetwork)).toEqual(['Orange', 'Moov', 'Telecel', 'Coris', 'Sank'])
  })

  it('totalLiquidite = somme des liquidités de tous les réseaux', () => {
    const r = shapeDealerInventory(
      { balances: { Orange: { liquidite: 200000 }, Moov: { liquidite: 5000 }, Coris: { liquidite: 300 } } },
      ['Orange', 'Moov', 'Coris'],
    )
    expect(r.totalLiquidite).toBe(205300)
  })

  it('stock/liquidite = réseau PRIMAIRE (networks[0]) en multi', () => {
    const r = shapeDealerInventory(
      { balances: { Orange: { stock: 1, liquidite: 2 }, Moov: { stock: 9, liquidite: 8 } } },
      ['Orange', 'Moov'],
    )
    expect(r.stock).toBe(1)      // Orange (primaire)
    expect(r.liquidite).toBe(2)
  })

  it('données manquantes/invalides → 0 ; négatif fini conservé (comportement historique)', () => {
    expect(shapeDealerInventory(null, ['Orange']).byNetwork.Orange).toEqual({ stock: 0, liquidite: 0 })
    expect(shapeDealerInventory({}, ['Orange']).byNetwork.Orange).toEqual({ stock: 0, liquidite: 0 })
    // Négatif conservé (anomalie visible pour l'admin) ; NaN → 0. Reproduit `Number(x) || 0`.
    expect(shapeDealerInventory({ balances: { Orange: { stock: -5, liquidite: 'x' } } }, ['Orange']).byNetwork.Orange)
      .toEqual({ stock: -5, liquidite: 0 })
    expect(shapeDealerInventory({ balances: { Orange: null } }, ['Orange']).byNetwork.Orange)
      .toEqual({ stock: 0, liquidite: 0 })
  })

  // Mis à jour par la spec S2 : la forme porte désormais `flux`, les compteurs
  // « envoyé / revenu » qui arrivent par le même document que les soldes.
  // L'égalité est stricte à dessein — c'est ce qui rend un ajout de champ
  // visible au lieu de le laisser passer en silence.
  it('emptyDealerInventory : tous réseaux à 0, agrégats à 0, flux à 0', () => {
    expect(emptyDealerInventory(['Orange', 'Moov'])).toEqual({
      byNetwork: { Orange: { stock: 0, liquidite: 0 }, Moov: { stock: 0, liquidite: 0 } },
      stock: 0, liquidite: 0, totalLiquidite: 0,
      flux: { envoyeCumul: 0, revenuCumul: 0, dehors: 0, amorce: false },
    })
  })

  describe('flux — l’argent dehors (spec S2)', () => {
    it('lit les deux compteurs et en déduit ce qui est dehors', () => {
      const r = shapeDealerInventory(
        { balances: { Orange: { stock: 10, liquidite: 5 } }, flux: { envoyeCumul: 341200000, revenuCumul: 142800000 } },
        ['Orange'],
      )
      expect(r.flux.dehors).toBe(198400000)
      expect(r.flux.amorce).toBe(true)
    })

    it('un document sans compteurs n’est pas amorcé, et ne prétend rien', () => {
      const r = shapeDealerInventory({ balances: { Orange: { stock: 10, liquidite: 5 } } }, ['Orange'])
      expect(r.flux).toEqual({ envoyeCumul: 0, revenuCumul: 0, dehors: 0, amorce: false })
    })

    it('laisse « dehors » négatif quand plus est revenu qu’il n’a été compté parti', () => {
      // Cas réel au démarrage des compteurs : un retour est confirmé alors que
      // le ravitaillement d'origine est antérieur à leur mise en service. Le
      // négatif est le signal d'un cumul incomplet — il ne se masque pas.
      const r = shapeDealerInventory({ flux: { envoyeCumul: 0, revenuCumul: 50000 } }, ['Orange'])
      expect(r.flux.dehors).toBe(-50000)
      expect(r.flux.amorce).toBe(true)
    })
  })

  it('défaut = DEALER_NETWORKS du profil (mono TAOFIC → Orange)', () => {
    const r = shapeDealerInventory({ balances: { Orange: { stock: 7, liquidite: 3 } } })
    expect(r.byNetwork).toEqual({ Orange: { stock: 7, liquidite: 3 } })
    expect(r.stock).toBe(7)
    expect(r.totalLiquidite).toBe(3)
  })
})
