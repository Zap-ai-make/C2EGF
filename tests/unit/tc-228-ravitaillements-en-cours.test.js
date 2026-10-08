import { describe, it, expect } from 'vitest'
import {
  estRavitaillementEnCours,
  ravitaillementsEnCours,
  grouperParExpediteur,
  expediteursConnus,
  retoursDe,
  EXPEDITEURS_PROFIL,
} from '../../src/utils/ravitaillement.js'

/**
 * TC-228 — Les livraisons encore dues (S8).
 *
 * CE QUE CE FICHIER PROTÈGE
 * ─────────────────────────
 * Ces fonctions décident de ce que la boutique voit le soir : combien elle doit
 * encore, et à qui. Deux erreurs sont possibles et aucune ne se voit :
 *
 *   — compter une livraison qui ne devrait pas l'être. Les lignes d'avant S8
 *     n'ont pas de reste dû, et il est INCONNAISSABLE. Les afficher comme
 *     entièrement dues ferait dire au logiciel que la boutique doit tout.
 *
 *   — séparer un expéditeur en deux. « Patron » et « patron » dans deux groupes
 *     donnent deux totaux justes dont la SÉPARATION est fausse.
 */

const rav = (over = {}) => ({
  id: 'r1',
  type: 'Ravitaillement',
  expediteur: 'Patron',
  montant: 100_000,
  remainingAmount: 100_000,
  createdAt: new Date('2026-10-08T08:00:00Z'),
  ...over,
})

describe('TC-228 — ce qui compte comme « en cours »', () => {
  it('[TC-228-1] une livraison avec un reste dû est en cours', () => {
    expect(estRavitaillementEnCours(rav())).toBe(true)
  })

  it('[TC-228-2] une livraison soldée ne l’est pas', () => {
    expect(estRavitaillementEnCours(rav({ remainingAmount: 0 }))).toBe(false)
  })

  /**
   * ⚠ LA PROPRIÉTÉ LA PLUS IMPORTANTE DU FICHIER.
   *   Une ligne d'avant S8 n'a pas de `remainingAmount`. Son reste dû n'est pas
   *   « zéro » : il est INCONNAISSABLE, parce que ce qui en a été rendu ne fut
   *   jamais enregistré. L'absence du champ vaut donc « soldée » — le seul
   *   choix qui ne fasse pas mentir le logiciel.
   */
  it('[TC-228-3] une livraison d’avant le suivi ne l’est pas', () => {
    const ancienne = rav()
    delete ancienne.remainingAmount
    delete ancienne.expediteur
    expect(estRavitaillementEnCours(ancienne)).toBe(false)
  })

  it('[TC-228-4] une livraison supprimée ne l’est pas', () => {
    expect(estRavitaillementEnCours(rav({ deletedAt: new Date() }))).toBe(false)
  })

  it('[TC-228-5] une transaction client n’en est pas une', () => {
    expect(estRavitaillementEnCours({ type: 'Dépôt', remainingAmount: 50_000 })).toBe(false)
  })
})

describe('TC-228 — la liste', () => {
  it('[TC-228-6] sort de la plus ancienne à la plus récente', () => {
    const liste = ravitaillementsEnCours([
      rav({ id: 'midi', createdAt: new Date('2026-10-08T12:00:00Z') }),
      rav({ id: 'matin', createdAt: new Date('2026-10-08T08:00:00Z') }),
      rav({ id: 'soir', createdAt: new Date('2026-10-08T18:00:00Z') }),
    ])
    expect(liste.map((l) => l.id)).toEqual(['matin', 'midi', 'soir'])
  })

  it('[TC-228-7] déduplique : une ligne livrée deux fois ne compte qu’une', () => {
    // L'abonnement temps réel peut livrer un doublon ; il gonflerait un total
    // que la boutique compare à ce qu'elle doit réellement.
    const liste = ravitaillementsEnCours([rav({ id: 'x' }), rav({ id: 'x' })])
    expect(liste).toHaveLength(1)
  })

  it('[TC-228-8] écarte les soldées et les anciennes', () => {
    const ancienne = rav({ id: 'vieille' })
    delete ancienne.remainingAmount
    const liste = ravitaillementsEnCours([rav({ id: 'due' }), rav({ id: 'soldee', remainingAmount: 0 }), ancienne])
    expect(liste.map((l) => l.id)).toEqual(['due'])
  })
})

describe('TC-228 — le groupement par expéditeur', () => {
  /**
   * C'est ce total qui règle le soir, et non le total général : l'argent n'est
   * pas fongible d'un expéditeur à l'autre.
   */
  it('[TC-228-9] totalise ce qui est dû à chacun', () => {
    const groupes = grouperParExpediteur([
      rav({ id: 'a', expediteur: 'Patron', remainingAmount: 100_000 }),
      rav({ id: 'b', expediteur: 'Mme Sawadogo', remainingAmount: 70_000 }),
      rav({ id: 'c', expediteur: 'Patron', remainingAmount: 20_000 }),
    ])

    const parNom = Object.fromEntries(groupes.map((g) => [g.expediteur, g.total]))
    expect(parNom).toEqual({ Patron: 120_000, 'Mme Sawadogo': 70_000 })
  })

  it('[TC-228-10] une casse ou un espace de différence ne fait pas deux créanciers', () => {
    const groupes = grouperParExpediteur([
      rav({ id: 'a', expediteur: 'Mme Sawadogo', remainingAmount: 100_000 }),
      rav({ id: 'b', expediteur: '  mme   sawadogo ', remainingAmount: 50_000 }),
    ])

    expect(groupes).toHaveLength(1)
    expect(groupes[0].total).toBe(150_000)
    // Le premier nom rencontré fait foi pour l'affichage.
    expect(groupes[0].expediteur).toBe('Mme Sawadogo')
  })

  it('[TC-228-11] une livraison sans expéditeur reste lisible', () => {
    const groupes = grouperParExpediteur([rav({ expediteur: undefined })])
    expect(groupes[0].expediteur).toBe('Sans expéditeur')
  })
})

describe('TC-228 — les noms proposés', () => {
  it('[TC-228-12] part du profil', () => {
    expect(expediteursConnus([])).toEqual([...EXPEDITEURS_PROFIL])
  })

  it('[TC-228-13] ajoute les noms vus dans l’historique, sans doublon', () => {
    const noms = expediteursConnus([
      rav({ expediteur: 'Issouf' }),
      rav({ expediteur: 'issouf' }),
      rav({ expediteur: EXPEDITEURS_PROFIL[0] ?? 'Patron' }),
    ])

    expect(noms.filter((n) => n.toLowerCase() === 'issouf')).toEqual(['Issouf'])
    expect(new Set(noms).size).toBe(noms.length)
  })

  it('[TC-228-14] ignore les lignes qui ne sont pas des ravitaillements', () => {
    const noms = expediteursConnus([{ type: 'Retour', expediteur: 'Fantôme' }])
    expect(noms).not.toContain('Fantôme')
  })
})

describe('TC-228 — les retours d’une livraison', () => {
  it('[TC-228-15] ne retient que les siens, du plus récent au plus ancien', () => {
    const retours = retoursDe([
      { id: 'r-vieux', type: 'Retour', replenishmentId: 'rav-1', createdAt: new Date('2026-10-08T09:00:00Z') },
      { id: 'r-neuf', type: 'Retour', replenishmentId: 'rav-1', createdAt: new Date('2026-10-08T17:00:00Z') },
      { id: 'autre', type: 'Retour', replenishmentId: 'rav-2', createdAt: new Date('2026-10-08T10:00:00Z') },
      { id: 'supprime', type: 'Retour', replenishmentId: 'rav-1', deletedAt: new Date() },
    ], 'rav-1')

    expect(retours.map((r) => r.id)).toEqual(['r-neuf', 'r-vieux'])
  })
})
