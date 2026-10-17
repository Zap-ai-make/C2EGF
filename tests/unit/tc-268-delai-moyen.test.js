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
 */

const JOUR = 24 * 60 * 60 * 1000
const op = (jours) => ({
  createdAt: new Date('2026-10-01T08:00:00Z'),
  validatedAt: new Date(new Date('2026-10-01T08:00:00Z').getTime() + jours * JOUR),
})
const directe = () => ({ createdAt: new Date('2026-10-01T08:00:00Z') })

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
})
