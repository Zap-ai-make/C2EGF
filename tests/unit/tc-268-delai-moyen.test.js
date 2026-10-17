import { describe, it, expect } from 'vitest'
import { delaiMoyen } from '../../src/utils/delaiMoyen.js'

/**
 * TC-268 — « combien de temps il met », et sur combien d'opérations.
 *
 * ⚠ LA MOYENNE NE PORTE PAS SUR TOUT, ET L'ÉCRAN DOIT LE DIRE. `dureeDe` rend
 *   `null` dans deux cas qui ne sont pas des échecs : une opération validée d'un
 *   seul geste au formulaire n'a jamais attendu (pas de `validatedAt`), et une
 *   durée nulle signale une création-validation dans la même écriture serveur.
 *   Annoncer « paie en 9 j » sous un compteur de 24 opérations dont 6 seulement
 *   sont mesurées fait lire une statistique à la place d'une autre. D'où
 *   `mesurees` et `total`, rendus ensemble et jamais séparables.
 *
 * ⚠ RONDE DE CORRECTION 1 (I-2) — SEULS LES DÉPÔTS MESURENT UN RETARD DU
 *   CLIENT. Sur un retrait, `validatedAt − createdAt` est le temps que LA
 *   BOUTIQUE a mis à remettre l'argent, pas un retard de l'agent. `op()` tague
 *   donc `typePlie: 'depot'` par défaut — ce que représentaient déjà
 *   implicitement les six premiers cas, qui caractérisent le calcul de durée
 *   lui-même, pas la distinction de sens. [TC-268-08] isole cette distinction.
 */

const JOUR = 24 * 60 * 60 * 1000
const op = (jours, typePlie = 'depot') => ({
  typePlie,
  createdAt: new Date('2026-10-01T08:00:00Z'),
  validatedAt: new Date(new Date('2026-10-01T08:00:00Z').getTime() + jours * JOUR),
})
const directe = () => ({ typePlie: 'depot', createdAt: new Date('2026-10-01T08:00:00Z') })

describe('TC-268 — la moyenne et son effectif', () => {
  it('[TC-268-01] la moyenne de 2, 4 et 9 jours vaut 5', () => {
    expect(delaiMoyen([op(2), op(4), op(9)])).toEqual({ jours: 5, mesurees: 3, total: 3 })
  })

  it('[TC-268-02] les opérations sans `validatedAt` sont exclues du calcul', () => {
    expect(delaiMoyen([op(4), directe(), directe()]))
      .toEqual({ jours: 4, mesurees: 1, total: 3 })
  })

  it('[TC-268-03] une durée nulle ne compte pas comme un délai de zéro', () => {
    expect(delaiMoyen([op(6), op(0)])).toEqual({ jours: 6, mesurees: 1, total: 2 })
  })

  /** Aucune mesure n'est un résultat, pas une erreur — et ce n'est pas zéro. */
  it('[TC-268-04] sans aucune mesure, `jours` vaut null', () => {
    expect(delaiMoyen([directe(), directe()])).toEqual({ jours: null, mesurees: 0, total: 2 })
  })

  it('[TC-268-05] une liste vide ne prétend rien', () => {
    expect(delaiMoyen([])).toEqual({ jours: null, mesurees: 0, total: 0 })
  })

  it('[TC-268-06] une entrée absente ou nulle ne casse rien', () => {
    expect(delaiMoyen([null, undefined, op(3)])).toEqual({ jours: 3, mesurees: 1, total: 3 })
  })

  it('[TC-268-07] la moyenne est arrondie au jour', () => {
    expect(delaiMoyen([op(2), op(3)]).jours).toBe(3)
  })

  /**
   * I-2 — le cas qui a motivé le filtre. Sur ce retrait, la boutique a mis
   * 4 jours à payer ; ça ne regarde pas le client, et ne doit pas peser dans
   * son délai moyen. `total` compte les deux lignes : le patron regarde bien
   * deux opérations, une seule est un dépôt mesurable.
   */
  it('[TC-268-08] seuls les dépôts mesurent un retard du client, pas les retraits', () => {
    expect(delaiMoyen([op(4, 'retrait'), op(2, 'depot')]))
      .toEqual({ jours: 2, mesurees: 1, total: 2 })
  })
})
