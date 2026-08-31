/**
 * TC-209 — L'argent dehors : l'agrégation des transactions non terminées.
 *
 * Ce fichier tient un chiffre qui entre dans le rapprochement du dealer. S'il
 * se trompe, l'écart affiché se trompe d'autant — et l'écart est précisément ce
 * que l'écran demande de surveiller. Trois familles de pièges :
 *
 *   §MR — le montant retenu. Une non terminée partiellement réglée ne laisse
 *         dehors que son RESTE DÛ ; sommer le montant d'origine compterait une
 *         deuxième fois ce qui a déjà été payé.
 *   §AG — le regroupement et le signe. `dépôts − retraits`, jamais l'inverse,
 *         et jamais borné à zéro.
 *   §PO — la population. Elle doit être celle des caisses, sinon on ajoute d'un
 *         côté de l'égalité ce qu'on a retiré de l'autre.
 */

import { describe, it, expect } from 'vitest'
import { agregerArgentDehors, montantRestant } from '../../src/utils/argentDehors'

const BOUTIQUES = [
  { storeId: 'store-a', name: 'FADA' },
  { storeId: 'store-b', name: 'POUYTENGA' },
]

const depot = (storeId, over = {}) => ({ storeId, type: 'Dépôt', montant: 100000, ...over })
const retrait = (storeId, over = {}) => ({ storeId, type: 'Retrait', montant: 100000, ...over })

// ===========================================================================
// §MR — le montant retenu
// ===========================================================================

describe('TC-209-MR — le reste dû, pas le montant d’origine', () => {
  it('[MR-01] sans règlement partiel, c’est le montant', () => {
    expect(montantRestant({ montant: 75000 })).toBe(75000)
  })

  it('[MR-02] avec un règlement partiel, c’est le reste dû', () => {
    // 100 000 dus, 40 000 déjà encaissés : il n'y a plus que 60 000 dehors.
    expect(montantRestant({ montant: 100000, remainingAmount: 60000 })).toBe(60000)
  })

  it('[MR-03] un reste dû à ZÉRO fait autorité — il ne retombe pas sur le montant', () => {
    // Le piège exact : `remainingAmount || montant` aurait rendu 100 000 pour
    // une transaction intégralement réglée, parce que 0 est falsy.
    expect(montantRestant({ montant: 100000, remainingAmount: 0 })).toBe(0)
  })

  it('[MR-04] aucun montant lisible → null, jamais zéro', () => {
    for (const t of [{}, { montant: 'x' }, { montant: NaN }, { montant: Infinity }, null]) {
      expect(montantRestant(t)).toBeNull()
    }
  })

  it('[MR-05] un reste dû illisible retombe sur le montant', () => {
    expect(montantRestant({ montant: 50000, remainingAmount: undefined })).toBe(50000)
    expect(montantRestant({ montant: 50000, remainingAmount: 'x' })).toBe(50000)
  })
})

// ===========================================================================
// §AG — le regroupement et le signe
// ===========================================================================

describe('TC-209-AG — dépôts moins retraits', () => {
  it('[AG-01] le solde est dépôts − retraits, par boutique et en total', () => {
    const r = agregerArgentDehors([
      depot('store-a', { montant: 300000 }),
      depot('store-a', { montant: 200000 }),
      retrait('store-a', { montant: 100000 }),
      retrait('store-b', { montant: 50000 }),
    ], BOUTIQUES)

    expect(r.depots).toBe(500000)
    expect(r.retraits).toBe(150000)
    expect(r.dehors).toBe(350000)

    const fada = r.parBoutique.find(b => b.storeId === 'store-a')
    expect(fada).toMatchObject({ name: 'FADA', depots: 500000, retraits: 100000, dehors: 400000 })
    const pouy = r.parBoutique.find(b => b.storeId === 'store-b')
    expect(pouy).toMatchObject({ depots: 0, retraits: 50000, dehors: -50000 })
  })

  it('[AG-02] le total peut être NÉGATIF, et on ne le borne pas', () => {
    // Plus de retraits en attente que de dépôts : le réseau doit plus qu'il ne
    // lui est dû. Forcer à zéro fabriquerait une donnée fausse et masquerait
    // exactement ce que l'écran doit annoncer.
    const r = agregerArgentDehors([retrait('store-a', { montant: 900000 })], BOUTIQUES)
    expect(r.dehors).toBe(-900000)
  })

  it('[AG-03] les accents et la casse ne changent rien au type', () => {
    // `isDepositType` normalise : « Depot », « dépôt », « DÉPÔT » sont un seul
    // type. Une base qui mélange les deux orthographes ne doit pas produire
    // deux colonnes.
    const r = agregerArgentDehors([
      depot('store-a', { type: 'Depot', montant: 1000 }),
      depot('store-a', { type: 'DÉPÔT', montant: 1000 }),
      retrait('store-a', { type: 'retrait', montant: 500 }),
    ], BOUTIQUES)
    expect(r.depots).toBe(2000)
    expect(r.retraits).toBe(500)
  })

  it('[AG-04] un type inconnu n’est pas rangé au hasard : il est déclaré illisible', () => {
    // Le compter d'un côté fausserait le solde ; le taire ferait croire le
    // total complet.
    const r = agregerArgentDehors([
      depot('store-a', { montant: 1000 }),
      { storeId: 'store-a', type: 'Crédit', montant: 5000 },
    ], BOUTIQUES)
    expect(r.depots).toBe(1000)
    expect(r.retraits).toBe(0)
    expect(r.illisibles).toBe(1)
  })

  it('[AG-05] un montant illisible n’est jamais compté pour zéro', () => {
    const r = agregerArgentDehors([
      depot('store-a', { montant: 1000 }),
      depot('store-a', { montant: 'beaucoup' }),
    ], BOUTIQUES)
    expect(r.depots).toBe(1000)
    expect(r.illisibles).toBe(1)
  })

  it('[AG-06] un règlement partiel ne compte que son reste dû', () => {
    const r = agregerArgentDehors([
      depot('store-a', { montant: 100000, remainingAmount: 60000 }),
      depot('store-a', { montant: 100000, remainingAmount: 0 }),
    ], BOUTIQUES)
    expect(r.depots).toBe(60000)
  })
})

// ===========================================================================
// §PO — la population et la liste
// ===========================================================================

describe('TC-209-PO — la même population que les caisses', () => {
  it('[PO-01] un brouillon d’une boutique hors réseau est écarté, et compté', () => {
    // `sommeDehors` part au rapprochement à côté de sommes qui ne couvrent que
    // les boutiques ACTIVES. Compter ici une boutique fermée ajouterait à un
    // total ce qui a été retiré de l'autre : l'écart bougerait sans qu'un franc
    // n'ait bougé. Mais on ne le jette pas en silence.
    const r = agregerArgentDehors([
      depot('store-a', { montant: 1000 }),
      depot('store-fermee', { montant: 999999 }),
      depot(undefined, { montant: 777 }),
    ], BOUTIQUES)
    expect(r.dehors).toBe(1000)
    expect(r.horsReseau).toBe(2)
  })

  it('[PO-02] la liste ne montre que les boutiques qui ont quelque chose', () => {
    const r = agregerArgentDehors([depot('store-a', { montant: 1000 })], BOUTIQUES)
    expect(r.parBoutique.map(b => b.storeId)).toEqual(['store-a'])
  })

  it('[PO-03] une boutique dont les deux colonnes s’annulent reste dans la liste', () => {
    // Son solde est nul, mais son argent circule : elle a bien de l'argent
    // dehors ET une dette, et c'est une information.
    const r = agregerArgentDehors([
      depot('store-b', { montant: 5000 }),
      retrait('store-b', { montant: 5000 }),
    ], BOUTIQUES)
    expect(r.parBoutique).toHaveLength(1)
    expect(r.parBoutique[0]).toMatchObject({ storeId: 'store-b', dehors: 0 })
  })

  it('[PO-04] la liste est triée du plus exposé au moins exposé', () => {
    const r = agregerArgentDehors([
      depot('store-a', { montant: 100 }),
      depot('store-b', { montant: 900 }),
    ], BOUTIQUES)
    expect(r.parBoutique.map(b => b.storeId)).toEqual(['store-b', 'store-a'])
  })

  it('[PO-05] à solde égal, le nom départage — deux captures restent comparables', () => {
    const r = agregerArgentDehors([
      depot('store-a', { montant: 100 }),
      depot('store-b', { montant: 100 }),
    ], BOUTIQUES)
    expect(r.parBoutique.map(b => b.name)).toEqual(['FADA', 'POUYTENGA'])
  })

  it('[PO-06] aucun brouillon → tout à zéro, liste vide, rien d’inventé', () => {
    const r = agregerArgentDehors([], BOUTIQUES)
    expect(r).toMatchObject({ depots: 0, retraits: 0, dehors: 0, illisibles: 0, horsReseau: 0 })
    expect(r.parBoutique).toEqual([])
  })

  it('[PO-07] appelée sans rien, elle ne casse pas', () => {
    expect(agregerArgentDehors()).toMatchObject({ dehors: 0, parBoutique: [] })
  })
})
