import { describe, it, expect } from 'vitest'
import { regrouperParClientEtType, compterRangees } from '../../src/utils/regroupement.js'

/**
 * TC-237 — Une ligne par client et par type.
 *
 * CE QUE CE FICHIER PROTÈGE
 * ─────────────────────────
 * Cette fonction décide de ce que la boutique VOIT. Trois erreurs sont
 * possibles, et deux d'entre elles ne se verraient pas :
 *
 *   1. PERDRE UNE TRANSACTION. Un regroupement qui en avale une fait disparaître
 *      un montant de l'écran sans rien dire. C'est la propriété de conservation,
 *      testée en premier.
 *   2. MÉLANGER DEUX CLIENTS, ou deux types du même client. Le total serait faux
 *      et personne ne pourrait le rapprocher de rien.
 *   3. REGROUPER CE QUI N'A PAS DE CLIENT. Un ravitaillement et un retour n'ont
 *      pas de `clientId` : les entasser sous un même « sans client » mettrait
 *      dans un seul total l'argent de plusieurs personnes différentes.
 */

const tx = (over = {}) => ({
  id: 't-1',
  clientId: 'c-1',
  client: { nom: 'Ouedraogo', prenom: 'Aïssata' },
  type: 'Dépôt',
  montant: 10_000,
  ...over,
})

/** Toutes les transactions présentes dans les rangées, à plat. */
const aplatir = (rangees) =>
  rangees.flatMap((rangee) => (rangee.seule ? [rangee.seule] : rangee.groupe.lignes))

describe('TC-237 — ce qui est regroupé', () => {
  it('[TC-237-1] deux transactions du même client et du même type', () => {
    const rangees = regrouperParClientEtType([tx({ id: 'a' }), tx({ id: 'b' })])

    expect(rangees).toHaveLength(1)
    expect(rangees[0].groupe.lignes.map((l) => l.id)).toEqual(['a', 'b'])
  })

  /**
   * Replier une transaction seule coûterait un clic pour revenir à ce qu'on
   * voyait déjà. Et c'est l'immense majorité des lignes.
   */
  it('[TC-237-2] une transaction seule reste une rangée ordinaire', () => {
    const rangees = regrouperParClientEtType([tx({ id: 'a' })])

    expect(rangees).toHaveLength(1)
    expect(rangees[0].seule.id).toBe('a')
    expect(rangees[0].groupe).toBeUndefined()
  })

  it('[TC-237-3] deux types du même client ne se mélangent pas', () => {
    const rangees = regrouperParClientEtType([
      tx({ id: 'a', type: 'Dépôt' }),
      tx({ id: 'b', type: 'Retrait' }),
    ])

    expect(rangees).toHaveLength(2)
    expect(rangees.every((r) => r.seule)).toBe(true)
  })

  it('[TC-237-4] deux clients du même type non plus', () => {
    const rangees = regrouperParClientEtType([
      tx({ id: 'a', clientId: 'c-1' }),
      tx({ id: 'b', clientId: 'c-2' }),
    ])

    expect(rangees).toHaveLength(2)
    expect(rangees.every((r) => r.seule)).toBe(true)
  })

  it('[TC-237-5] « Dépôt » et « Depot » sont le même type', () => {
    // L'historique porte les deux orthographes selon l'âge de la ligne.
    const rangees = regrouperParClientEtType([
      tx({ id: 'a', type: 'Dépôt' }),
      tx({ id: 'b', type: 'Depot' }),
    ])

    expect(rangees).toHaveLength(1)
    expect(rangees[0].groupe.lignes).toHaveLength(2)
  })

  /**
   * ⚠ LA PROPRIÉTÉ QUI PROTÈGE LES LIGNES DU DEALER.
   *   Un ravitaillement et un retour n'ont pas de `clientId`. Les regrouper
   *   mettrait dans un seul total l'argent de plusieurs expéditeurs différents.
   */
  it('[TC-237-6] les lignes sans client ne sont jamais regroupées', () => {
    const rangees = regrouperParClientEtType([
      { id: 'rav-1', type: 'Ravitaillement', montant: 100_000 },
      { id: 'rav-2', type: 'Ravitaillement', montant: 200_000 },
      { id: 'ret-1', type: 'Retour', montant: 50_000, clientId: '' },
    ])

    expect(rangees).toHaveLength(3)
    expect(rangees.every((r) => r.seule)).toBe(true)
  })
})

describe('TC-237 — ce que le groupe dit', () => {
  it('[TC-237-7] totalise les montants de ses lignes', () => {
    const rangees = regrouperParClientEtType([
      tx({ id: 'a', montant: 10_000 }),
      tx({ id: 'b', montant: 25_000 }),
      tx({ id: 'c', montant: 5_000 }),
    ])

    expect(rangees[0].groupe.total).toBe(40_000)
    expect(rangees[0].groupe.lignes).toHaveLength(3)
  })

  it('[TC-237-8] ignore les montants illisibles plutôt que de rendre NaN', () => {
    const rangees = regrouperParClientEtType([
      tx({ id: 'a', montant: 10_000 }),
      tx({ id: 'b', montant: undefined }),
    ])

    expect(rangees[0].groupe.total).toBe(10_000)
  })

  it('[TC-237-9] porte le client et le type de ses lignes', () => {
    const rangees = regrouperParClientEtType([tx({ id: 'a' }), tx({ id: 'b' })])

    expect(rangees[0].groupe.client).toEqual({ nom: 'Ouedraogo', prenom: 'Aïssata' })
    expect(rangees[0].groupe.type).toBe('Dépôt')
    expect(rangees[0].groupe.clientId).toBe('c-1')
  })
})

describe('TC-237 — l’ordre', () => {
  /**
   * Les deux tableaux arrivent triés du plus récent au plus ancien. Un groupe
   * posé à la place de sa PREMIÈRE ligne se range donc à la date de sa
   * transaction la plus récente — là où l'œil l'attend.
   */
  it('[TC-237-10] un groupe occupe la place de sa première transaction', () => {
    const rangees = regrouperParClientEtType([
      tx({ id: 'seule-recente', clientId: 'c-9' }),
      tx({ id: 'groupe-1', clientId: 'c-1' }),
      tx({ id: 'seule-vieille', clientId: 'c-8' }),
      tx({ id: 'groupe-2', clientId: 'c-1' }),
    ])

    expect(rangees.map((r) => r.seule?.id ?? r.groupe.lignes[0].id))
      .toEqual(['seule-recente', 'groupe-1', 'seule-vieille'])
  })

  it('[TC-237-11] les lignes d’un groupe gardent leur ordre d’arrivée', () => {
    const rangees = regrouperParClientEtType([
      tx({ id: 'recente' }), tx({ id: 'moyenne' }), tx({ id: 'vieille' }),
    ])

    expect(rangees[0].groupe.lignes.map((l) => l.id)).toEqual(['recente', 'moyenne', 'vieille'])
  })
})

describe('TC-237 — rien ne se perd', () => {
  /**
   * ⚠ LA PROPRIÉTÉ LA PLUS IMPORTANTE DU FICHIER.
   *   Une transaction avalée par le regroupement disparaît de l'écran sans rien
   *   dire — et c'est un montant que la boutique ne verra plus. On vérifie donc
   *   que l'ensemble ressort entier, et exactement une fois chacun.
   */
  it('[TC-237-12] toutes les transactions ressortent, chacune une seule fois', () => {
    const entree = [
      tx({ id: 'a', clientId: 'c-1', type: 'Dépôt' }),
      tx({ id: 'b', clientId: 'c-2', type: 'Retrait' }),
      tx({ id: 'c', clientId: 'c-1', type: 'Dépôt' }),
      tx({ id: 'd', clientId: 'c-1', type: 'Retrait' }),
      { id: 'e', type: 'Ravitaillement', montant: 1 },
      tx({ id: 'f', clientId: 'c-2', type: 'Retrait' }),
    ]

    const sorties = aplatir(regrouperParClientEtType(entree)).map((t) => t.id)

    expect(sorties).toHaveLength(entree.length)
    expect(new Set(sorties)).toEqual(new Set(entree.map((t) => t.id)))
  })

  it('[TC-237-13] la somme de tout est conservée', () => {
    const entree = [
      tx({ id: 'a', montant: 10_000 }),
      tx({ id: 'b', montant: 20_000 }),
      tx({ id: 'c', clientId: 'c-2', montant: 5_000 }),
    ]

    const total = aplatir(regrouperParClientEtType(entree))
      .reduce((somme, t) => somme + t.montant, 0)

    expect(total).toBe(35_000)
  })

  it('[TC-237-14] une liste vide rend une liste vide', () => {
    expect(regrouperParClientEtType([])).toEqual([])
    expect(regrouperParClientEtType()).toEqual([])
  })
})

describe('TC-237 — le compte des rangées affichées', () => {
  const rangees = regrouperParClientEtType([
    tx({ id: 'a' }), tx({ id: 'b' }), tx({ id: 'c' }),
    tx({ id: 'seule', clientId: 'c-2' }),
  ])

  it('[TC-237-15] replié, un groupe ne vaut qu’une rangée', () => {
    expect(compterRangees(rangees, () => false)).toBe(2)
  })

  it('[TC-237-16] déplié, il vaut la sienne plus celles de ses lignes', () => {
    expect(compterRangees(rangees, () => true)).toBe(5)
  })

  it('[TC-237-17] sans prédicat, tout est considéré replié', () => {
    expect(compterRangees(rangees)).toBe(2)
  })
})
