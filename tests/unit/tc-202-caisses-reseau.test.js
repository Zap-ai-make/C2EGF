/**
 * TC-202 — L'échelle commune, le tri et la recherche des caisses (spec S4)
 *
 * `caissesReseau.js` est pur : c'est lui qui décide de la longueur de chaque
 * barre, de la position du filet de seuil, et de l'ordre des 84 lignes. Un
 * défaut ici ne se voit pas — il se lit comme une caisse pleine là où elle est
 * vide. D'où des tests d'arithmétique, séparés du composant qui les dessine.
 */

import { describe, it, expect } from 'vitest'
import {
  TRIS,
  TRI_DEFAUT,
  arrondiLisible,
  construireEchelle,
  depassePlafond,
  filtrerCaisses,
  largeurBarre,
  normaliser,
  positionSeuil,
  trierCaisses,
  triParId,
} from '../../src/utils/caissesReseau'

const SEUIL = 500000

const caisse = (name, stock, liquidite) => ({ storeId: name, name, stock, liquidite })

// ═══════════════════════════════════════════════════════════════════════════
describe('TC-202-A — l’arrondi lisible du plafond', () => {
// ═══════════════════════════════════════════════════════════════════════════

  it('[EC-01] arrondit au demi-ordre de grandeur supérieur', () => {
    // Le pas vaut la moitié de l'ordre de grandeur : 500 000 au-dessus du
    // million, 50 000 au-dessus de la centaine de mille, 5 000 au-dessus de
    // la dizaine de mille. Le plafond reste donc toujours un nombre qu'on peut
    // lire à voix haute, sans être arrondi si grossièrement qu'il écraserait
    // la moitié de la liste.
    expect(arrondiLisible(2940000)).toBe(3000000)
    expect(arrondiLisible(410000)).toBe(450000)
    expect(arrondiLisible(84000)).toBe(85000)
  })

  it('[EC-02] laisse en place une valeur DÉJÀ ronde', () => {
    // Le piège binaire : 3e6 / 5e5 vaut 6.000000000000001, et sans epsilon le
    // plafond serait poussé d'un cran à chaque chargement.
    expect(arrondiLisible(3000000)).toBe(3000000)
    expect(arrondiLisible(1000000)).toBe(1000000)
    expect(arrondiLisible(500000)).toBe(500000)
  })

  it('[EC-03] rend 0 pour tout ce qui n’est pas un montant positif', () => {
    expect(arrondiLisible(0)).toBe(0)
    expect(arrondiLisible(-5)).toBe(0)
    expect(arrondiLisible(NaN)).toBe(0)
    expect(arrondiLisible(Infinity)).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('TC-202-B — l’échelle commune', () => {
// ═══════════════════════════════════════════════════════════════════════════

  it('[EC-04] cale le plafond sur le neuvième décile, pas sur le maximum', () => {
    // Neuf caisses à 1 000 000 et une à 20 000 000. Sur le maximum, les neuf
    // premières feraient 5 % de piste et la liste ne dirait plus rien.
    const caisses = [
      ...Array.from({ length: 9 }, (_, i) => caisse(`B${i}`, 1000000, 1000000)),
      caisse('GEANTE', 20000000, 1000000),
    ]
    const echelle = construireEchelle(caisses, SEUIL)

    expect(echelle.plafond).toBe(1000000)
    expect(echelle.depassements).toBe(1)
  })

  it('[EC-05] ne descend jamais sous le double du seuil', () => {
    // Un réseau entièrement à sec : sans plancher, le filet du seuil sortirait
    // de la piste et ne signalerait plus rien.
    const echelle = construireEchelle([caisse('A', 1000, 2000)], SEUIL)

    expect(echelle.plafond).toBe(1000000)
    expect(positionSeuil(echelle.seuil, echelle.plafond)).toBe(50)
  })

  it('[EC-06] tient sur une liste vide, et sur des montants inconnus', () => {
    expect(construireEchelle([], SEUIL).plafond).toBe(1000000)
    expect(construireEchelle([caisse('A', null, null)], SEUIL).mesures).toBe(0)
    expect(construireEchelle(null, SEUIL).plafond).toBe(1000000)
  })

  it('[EC-07] compte les dépassements sur les DEUX colonnes', () => {
    const caisses = [
      caisse('A', 5000000, 5000000),
      ...Array.from({ length: 20 }, (_, i) => caisse(`B${i}`, 100000, 100000)),
    ]
    const echelle = construireEchelle(caisses, SEUIL)
    expect(echelle.plafond).toBe(1000000)
    expect(echelle.depassements).toBe(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('TC-202-C — la longueur des barres', () => {
// ═══════════════════════════════════════════════════════════════════════════

  it('[EC-08] est proportionnelle au plafond, et bornée à 100 %', () => {
    expect(largeurBarre(1500000, 3000000)).toBe(50)
    expect(largeurBarre(3000000, 3000000)).toBe(100)
    expect(largeurBarre(4180000, 3000000)).toBe(100)
  })

  it('[EC-09] rend 0 pour un montant inconnu, nul ou négatif', () => {
    // Un solde négatif est une anomalie d'inventaire : elle ne se dessine pas
    // en barre à l'envers, elle se lit dans le montant écrit à côté.
    expect(largeurBarre(null, 3000000)).toBe(0)
    expect(largeurBarre(0, 3000000)).toBe(0)
    expect(largeurBarre(-90000, 3000000)).toBe(0)
    expect(largeurBarre(1000, 0)).toBe(0)
  })

  it('[EC-10] ne signale un cran que STRICTEMENT au-dessus du plafond', () => {
    expect(depassePlafond(3000001, 3000000)).toBe(true)
    expect(depassePlafond(3000000, 3000000)).toBe(false)
    expect(depassePlafond(null, 3000000)).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('TC-202-D — le tri', () => {
// ═══════════════════════════════════════════════════════════════════════════

  const RESEAU = [
    caisse('ZORGHO', 4180000, 410000),
    caisse('KOUDOUGOU', 90000, 120000),
    caisse('POUYTENGA', 180000, 2940000),
    caisse('MUETTE', null, null),
  ]

  it('[TR-01] trie par nom par défaut', () => {
    const noms = trierCaisses(RESEAU, TRI_DEFAUT).map(c => c.name)
    expect(noms).toEqual(['KOUDOUGOU', 'MUETTE', 'POUYTENGA', 'ZORGHO'])
  })

  it('[TR-02] trie par stock, dans les deux sens', () => {
    expect(trierCaisses(RESEAU, 'stock-asc').map(c => c.name))
      .toEqual(['KOUDOUGOU', 'POUYTENGA', 'ZORGHO', 'MUETTE'])
    expect(trierCaisses(RESEAU, 'stock-desc').map(c => c.name))
      .toEqual(['ZORGHO', 'POUYTENGA', 'KOUDOUGOU', 'MUETTE'])
  })

  it('[TR-03] trie par liquidité, dans les deux sens', () => {
    expect(trierCaisses(RESEAU, 'liquidite-asc').map(c => c.name))
      .toEqual(['KOUDOUGOU', 'ZORGHO', 'POUYTENGA', 'MUETTE'])
    expect(trierCaisses(RESEAU, 'liquidite-desc').map(c => c.name))
      .toEqual(['POUYTENGA', 'ZORGHO', 'KOUDOUGOU', 'MUETTE'])
  })

  it('[TR-04] RÈGLE — un montant inconnu finit la liste dans LES DEUX SENS', () => {
    // C'est la règle qui coûte le plus cher si on l'oublie : en tête d'un tri
    // croissant, une caisse muette passerait pour la plus basse du réseau, et
    // le dealer enverrait du stock là où il n'en manque pas.
    for (const id of ['stock-asc', 'stock-desc', 'liquidite-asc', 'liquidite-desc']) {
      expect(trierCaisses(RESEAU, id).at(-1).name).toBe('MUETTE')
    }
  })

  it('[TR-05] départage deux montants égaux par le nom, pas par le hasard', () => {
    const exaequo = [caisse('ZORGHO', 100000, 0), caisse('FADA', 100000, 0)]
    expect(trierCaisses(exaequo, 'stock-asc').map(c => c.name)).toEqual(['FADA', 'ZORGHO'])
    expect(trierCaisses(exaequo, 'stock-desc').map(c => c.name)).toEqual(['FADA', 'ZORGHO'])
  })

  it('[TR-06] ne mute jamais la liste reçue du service', () => {
    const source = [...RESEAU]
    trierCaisses(source, 'stock-desc')
    expect(source.map(c => c.name)).toEqual(RESEAU.map(c => c.name))
  })

  it('[TR-07] retombe sur le tri par défaut pour un identifiant inconnu', () => {
    expect(triParId('inexistant')).toBe(TRIS[0])
    expect(trierCaisses(RESEAU, 'inexistant').map(c => c.name))
      .toEqual(trierCaisses(RESEAU, TRI_DEFAUT).map(c => c.name))
  })

  it('[TR-08] expose une annonce pour chaque tri : aucun n’est muet', () => {
    for (const tri of TRIS) {
      expect(typeof tri.annonce).toBe('string')
      expect(tri.annonce.length).toBeGreaterThan(0)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('TC-202-E — la recherche', () => {
// ═══════════════════════════════════════════════════════════════════════════

  const RESEAU = [
    caisse('KOUPÉLA', 1, 1),
    caisse('OUAGA CENTRE', 1, 1),
    caisse('POUYTENGA', 1, 1),
  ]

  it('[RE-01] ignore la casse et les accents', () => {
    expect(normaliser('KOUPÉLA')).toBe('koupela')
    expect(filtrerCaisses(RESEAU, 'koupela').map(c => c.name)).toEqual(['KOUPÉLA'])
    expect(filtrerCaisses(RESEAU, 'KoUpÉlA').map(c => c.name)).toEqual(['KOUPÉLA'])
  })

  it('[RE-02] cherche n’importe où dans le nom, pas seulement au début', () => {
    expect(filtrerCaisses(RESEAU, 'centre').map(c => c.name)).toEqual(['OUAGA CENTRE'])
  })

  it('[RE-03] rend TOUTE la liste sur un terme vide ou blanc', () => {
    expect(filtrerCaisses(RESEAU, '')).toHaveLength(3)
    expect(filtrerCaisses(RESEAU, '   ')).toHaveLength(3)
    expect(filtrerCaisses(RESEAU, null)).toHaveLength(3)
  })

  it('[RE-04] tient sur une boutique sans nom', () => {
    expect(filtrerCaisses([caisse(null, 1, 1)], 'x')).toHaveLength(0)
  })
})
