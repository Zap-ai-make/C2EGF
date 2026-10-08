import { describe, expect, it } from 'vitest'
import { sommesEnAttente, totalCaisse } from '../../src/utils/caisse.js'

/**
 * TC-224 — Le total exact de la caisse.
 *
 *   T = stock + liquidite + depots en attente - retraits en attente
 *
 * CE QUE CE FICHIER PROTEGE
 * ─────────────────────────
 * Un seul chiffre, affiche en permanence, que la caissiere compare a ce
 * qu'elle a physiquement en main en fin de journee. S'il est faux, il est pire
 * qu'absent : elle cherchera l'ecart dans sa caisse, jamais dans le logiciel.
 *
 * Les deux signes sont la seule subtilite, et ils s'inversent. Un depot non
 * terminé a deja quitte le stock mais appartient encore a la boutique (+) ; un
 * retrait non terminé est deja rentre au stock mais ne lui appartient plus (-).
 * Intervertir les deux donne un total qui a l'air plausible — c'est exactement
 * pour cela qu'on le fige ici.
 */

describe('TC-224 — sommesEnAttente', () => {
  it('[TC-224-1] separe les depots des retraits, montants et comptes', () => {
    expect(sommesEnAttente([
      { id: 'a', type: 'Dépôt', montant: 20_000 },
      { id: 'b', type: 'Retrait', montant: 30_000 },
      { id: 'c', type: 'Dépôt', montant: 5_000 },
    ])).toEqual({ depots: 25_000, retraits: 30_000, nbDepots: 2, nbRetraits: 1 })
  })

  it('[TC-224-2] compte les libelles sans accent, ecrits a une autre epoque', () => {
    // « Depot » et « DEPOT » sortent d'imports et de versions anterieures. Les
    // ignorer donnerait un total inferieur a la caisse, sans rien signaler.
    expect(sommesEnAttente([
      { id: 'a', type: 'Depot', montant: 10_000 },
      { id: 'b', type: 'DEPOT', montant: 1_000 },
      { id: 'c', type: 'retrait', montant: 2_000 },
    ])).toEqual({ depots: 11_000, retraits: 2_000, nbDepots: 2, nbRetraits: 1 })
  })

  it('[TC-224-3] ne compte qu une fois une ligne livree en double', () => {
    // L'abonnement temps reel peut livrer deux fois la meme ligne pendant une
    // reconnexion. Un doublon gonflerait le total que la caissiere verifie.
    expect(sommesEnAttente([
      { id: 'a', type: 'Dépôt', montant: 20_000 },
      { id: 'a', type: 'Dépôt', montant: 20_000 },
    ])).toEqual({ depots: 20_000, retraits: 0, nbDepots: 1, nbRetraits: 0 })
  })

  it('[TC-224-4] ignore les types qui ne sont ni depot ni retrait', () => {
    // Un ravitaillement ou une cloture n'est pas une operation client : son
    // montant est deja dans le stock, l'ajouter le compterait deux fois.
    expect(sommesEnAttente([
      { id: 'a', type: 'Ravitaillement', montant: 500_000 },
      { id: 'b', type: 'Clôture', montant: 90_000 },
    ])).toEqual({ depots: 0, retraits: 0, nbDepots: 0, nbRetraits: 0 })
  })

  it('[TC-224-5] traverse une liste vide, nulle ou trouee sans exploser', () => {
    expect(sommesEnAttente()).toEqual({ depots: 0, retraits: 0, nbDepots: 0, nbRetraits: 0 })
    expect(sommesEnAttente([null, undefined, { id: 'a', type: 'Dépôt' }]))
      .toEqual({ depots: 0, retraits: 0, nbDepots: 1, nbRetraits: 0 })
  })
})

describe('TC-224 — totalCaisse', () => {
  it('[TC-224-6] additionne les deux soldes et les deux files', () => {
    // Les chiffres de la capture : 108 000 de stock, 0 de liquidite,
    // 20 000 de depots en attente, 30 000 de retraits en attente.
    expect(totalCaisse({ stock: 108_000, liquidite: 0, depots: 20_000, retraits: 30_000 }))
      .toBe(98_000)
  })

  it('[TC-224-7] le depot AJOUTE, le retrait RETRANCHE', () => {
    // Le piege du fichier. Intervertir les deux signes donne 100 000 au lieu
    // de 120 000 sur ce jeu — un ecart credible, donc invisible.
    const base = { stock: 100_000, liquidite: 10_000 }
    expect(totalCaisse({ ...base, depots: 20_000, retraits: 10_000 })).toBe(120_000)
    expect(totalCaisse({ ...base, depots: 0, retraits: 0 })).toBe(110_000)
  })

  it('[TC-224-8] descend sous zero quand les retraits depassent ce qu on tient', () => {
    // On n affiche pas un plancher a zero : un total negatif DIT quelque chose
    // — la boutique doit plus qu elle ne tient. Le masquer serait mentir.
    expect(totalCaisse({ stock: 0, liquidite: 0, depots: 0, retraits: 5_000 })).toBe(-5_000)
  })

  it('[TC-224-9] vaut zero sans argument', () => {
    expect(totalCaisse()).toBe(0)
  })
})
