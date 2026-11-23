import { describe, expect, it } from 'vitest'
import { natureEnAttente, sommesEnAttente, totalCaisse } from '../../src/utils/caisse.js'
import { REFUSEE } from '../../src/services/fileEnvoi.js'

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
    ])).toEqual({ depots: 25_000, retraits: 30_000, nbDepots: 2, nbRetraits: 1, siege: 0, nbSiege: 0, transfertsDus: 0, retraitsARecevoir: 0, nbTransferts: 0 })
  })

  it('[TC-224-2] compte les libelles sans accent, ecrits a une autre epoque', () => {
    // « Depot » et « DEPOT » sortent d'imports et de versions anterieures. Les
    // ignorer donnerait un total inferieur a la caisse, sans rien signaler.
    expect(sommesEnAttente([
      { id: 'a', type: 'Depot', montant: 10_000 },
      { id: 'b', type: 'DEPOT', montant: 1_000 },
      { id: 'c', type: 'retrait', montant: 2_000 },
    ])).toEqual({ depots: 11_000, retraits: 2_000, nbDepots: 2, nbRetraits: 1, siege: 0, nbSiege: 0, transfertsDus: 0, retraitsARecevoir: 0, nbTransferts: 0 })
  })

  it('[TC-224-3] ne compte qu une fois une ligne livree en double', () => {
    // L'abonnement temps reel peut livrer deux fois la meme ligne pendant une
    // reconnexion. Un doublon gonflerait le total que la caissiere verifie.
    expect(sommesEnAttente([
      { id: 'a', type: 'Dépôt', montant: 20_000 },
      { id: 'a', type: 'Dépôt', montant: 20_000 },
    ])).toEqual({ depots: 20_000, retraits: 0, nbDepots: 1, nbRetraits: 0, siege: 0, nbSiege: 0, transfertsDus: 0, retraitsARecevoir: 0, nbTransferts: 0 })
  })

  it('[TC-224-4] ignore les types qui ne sont ni depot ni retrait', () => {
    // Un ravitaillement ou une cloture n'est pas une operation client : son
    // montant est deja dans le stock, l'ajouter le compterait deux fois.
    expect(sommesEnAttente([
      { id: 'a', type: 'Ravitaillement', montant: 500_000 },
      { id: 'b', type: 'Clôture', montant: 90_000 },
    ])).toEqual({ depots: 0, retraits: 0, nbDepots: 0, nbRetraits: 0, siege: 0, nbSiege: 0, transfertsDus: 0, retraitsARecevoir: 0, nbTransferts: 0 })
  })

  it('[TC-224-5] traverse une liste vide, nulle ou trouee sans exploser', () => {
    expect(sommesEnAttente()).toEqual({ depots: 0, retraits: 0, nbDepots: 0, nbRetraits: 0, siege: 0, nbSiege: 0, transfertsDus: 0, retraitsARecevoir: 0, nbTransferts: 0 })
    expect(sommesEnAttente([null, undefined, { id: 'a', type: 'Dépôt' }]))
      .toEqual({ depots: 0, retraits: 0, nbDepots: 1, nbRetraits: 0, siege: 0, nbSiege: 0, transfertsDus: 0, retraitsARecevoir: 0, nbTransferts: 0 })
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

/**
 * L'argent du siège (15 novembre 2026, décision de l'utilisateur).
 *
 * Un remboursement au siège non terminé a fait entrer l'argent de l'agent dans
 * une réserve, mais cet argent part au siège. Comme un retrait non terminé, il
 * n'appartient pas à la boutique : le total retranche ce qui reste à envoyer.
 */
describe('TC-224 — l argent qui part au siege', () => {
  const remb = (over = {}) => ({
    id: 'r1', type: 'Remb. siège', statut: 'Non Terminées', montant: 100_000,
    balanceType: 'liquidite', envoyeAuSiege: 0, resteAuSiege: 100_000, ...over,
  })
  const depot = { id: 'd1', type: 'Dépôt', montant: 20_000 }
  const retrait = { id: 'w1', type: 'Retrait', montant: 30_000 }

  it('[TC-224-10] compte a part le reste a envoyer, sans toucher depots ni retraits', () => {
    expect(sommesEnAttente([depot, retrait, remb()])).toEqual({
      depots: 20_000, nbDepots: 1, retraits: 30_000, nbRetraits: 1, siege: 100_000, nbSiege: 1,
      transfertsDus: 0, retraitsARecevoir: 0, nbTransferts: 0,
    })
  })

  it('[TC-224-11] une ligne deja envoyee en partie ne compte que son reste', () => {
    expect(sommesEnAttente([remb({ envoyeAuSiege: 30_000, resteAuSiege: 70_000 })]).siege).toBe(70_000)
  })

  it('[TC-224-12] une ligne livree deux fois compte une fois ; une ligne refusee ne compte pas', () => {
    expect(sommesEnAttente([remb(), remb()])).toMatchObject({ siege: 100_000, nbSiege: 1 })
    expect(sommesEnAttente([remb({ envoi: { etat: REFUSEE } })])).toMatchObject({ siege: 0, nbSiege: 0, transfertsDus: 0, retraitsARecevoir: 0, nbTransferts: 0 })
  })

  it('[TC-224-13] sans reste lisible, le reste vaut le montant moins ce qui est parti — jamais zero', () => {
    // Un zero ferait croire au total que tout l argent du siege est a la boutique.
    expect(sommesEnAttente([remb({ resteAuSiege: undefined, envoyeAuSiege: 40_000 })]).siege).toBe(60_000)
  })

  it('[TC-224-14] recevoir un remboursement ne change pas le total caisse', () => {
    // La reserve monte de 100 000, le reste a envoyer aussi : ils s annulent.
    const avant = totalCaisse({ stock: 1_000_000, liquidite: 500_000 })
    expect(totalCaisse({ stock: 1_100_000, liquidite: 500_000, siege: 100_000 })).toBe(avant)
    expect(avant).toBe(1_500_000)
  })
})

/**
 * Une seule lecture de la nature d'une ligne (16 novembre 2026) : les cases
 * au-dessus des non terminées la comptent, et le filtre du tableau la trie.
 * Deux lectures finiraient par montrer une case à 2 et un filtre à 1.
 */
describe('TC-224 — la nature d une non terminee', () => {
  it('[TC-224-15] depot, retrait, siege, ou rien', () => {
    for (const type of ['Dépôt', 'Depot', 'DEPOT']) expect(natureEnAttente({ type })).toBe('depot')
    expect(natureEnAttente({ type: 'retrait' })).toBe('retrait')
    expect(natureEnAttente({ type: 'Remb. siège' })).toBe('siege')
    expect(natureEnAttente({ type: 'Ravitaillement' })).toBeNull()
    expect(natureEnAttente(null)).toBeNull()
    expect(natureEnAttente({})).toBeNull()
  })
})
