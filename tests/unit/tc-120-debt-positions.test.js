/**
 * TC-120 — La position nette par partenaire.
 *
 * C'est la seule couche qui croise « ce que je dois » et « ce qu'on me doit ».
 * Tout ce que le fléau affiche en sort ; une erreur ici se lit comme de l'argent
 * en moins ou en trop sur un écran qui sert à savoir combien on doit.
 *
 * Les quatre pièges verrouillés ici :
 *   • le filtre porte sur les BRAS et non sur le net — sinon la paire opposée,
 *     seul cas réellement actionnable, disparaîtrait de l'écran ;
 *   • l'échelle se prend sur le plus grand BRAS — sinon une paire opposée
 *     déborderait de sa poutre ;
 *   • un montant illisible est écarté ET compté, jamais avalé comme un zéro ;
 *   • un bras ne dépasse jamais la demi-piste, quelle que soit l'échelle reçue.
 */

import { describe, it, expect } from 'vitest'
import { computeDebtPositions, armWidthPercent } from '../../src/utils/debtPositions.js'

const MOI = 'store-a'

const dette = (creditorStoreId, remainingAmount, extra = {}) => ({
  id: `d-${creditorStoreId}-${remainingAmount}`,
  debtorStoreId: MOI,
  creditorStoreId,
  creditorStoreName: `Boutique ${creditorStoreId}`,
  originalAmount: remainingAmount,
  settledAmount: 0,
  remainingAmount,
  status: 'open',
  ...extra,
})

const creance = (debtorStoreId, remainingAmount, extra = {}) => ({
  id: `c-${debtorStoreId}-${remainingAmount}`,
  debtorStoreId,
  debtorStoreName: `Boutique ${debtorStoreId}`,
  creditorStoreId: MOI,
  originalAmount: remainingAmount,
  settledAmount: 0,
  remainingAmount,
  status: 'open',
  ...extra,
})

const positions = (debts, credits) =>
  computeDebtPositions({ storeId: MOI, debts, credits })

// ═════════════════════════════════════════════════════════════════════════════

describe('TC-120-A — les totaux', () => {
  it('[POS-01] sans rien, tout est à zéro et la liste est vide', () => {
    const r = computeDebtPositions({ storeId: MOI })
    expect(r).toMatchObject({ totalDebt: 0, totalCredit: 0, net: 0, maxArm: 0, ignored: 0 })
    expect(r.partners).toEqual([])
  })

  it('[POS-02] les totaux somment le RESTE DÛ, jamais le montant initial', () => {
    const r = positions(
      [dette('b', 90_000, { originalAmount: 180_000, settledAmount: 90_000 })],
      [creance('c', 95_000)],
    )
    expect(r.totalDebt).toBe(90_000)
    expect(r.totalCredit).toBe(95_000)
    expect(r.net).toBe(5_000)
  })

  it('[POS-03] le net est négatif quand je dois plus qu’on ne me doit', () => {
    const r = positions([dette('b', 220_000)], [creance('c', 140_000)])
    expect(r.net).toBe(-80_000)
  })

  it('[POS-04] plusieurs dettes envers la même boutique s’additionnent', () => {
    const r = positions([dette('b', 100_000), dette('b', 80_000)], [])
    expect(r.partners).toHaveLength(1)
    expect(r.partners[0].debt).toBe(180_000)
    expect(r.partners[0].debts).toHaveLength(2)
  })
})

describe('TC-120-B — qui figure sur l’écran', () => {
  it('[POS-05] une boutique entièrement soldée disparaît', () => {
    const r = positions([dette('b', 0, { settledAmount: 50_000, originalAmount: 50_000, status: 'settled' })], [])
    expect(r.partners).toEqual([])
  })

  it('[POS-06] une PAIRE OPPOSÉE reste, alors que son net est nul', () => {
    // Le cas le plus actionnable de l'écran : 45 000 de chaque côté, rien à
    // payer, et pourtant deux dettes ouvertes que la compensation efface d'un
    // geste. Un filtre sur le net l'aurait fait disparaître.
    const r = positions([dette('b', 45_000)], [creance('b', 45_000)])
    expect(r.partners).toHaveLength(1)
    expect(r.partners[0]).toMatchObject({ net: 0, debt: 45_000, credit: 45_000, compensable: 45_000 })
  })

  it('[POS-07] le compensable est le plus petit des deux bras', () => {
    const r = positions([dette('b', 180_000)], [creance('b', 45_000)])
    expect(r.partners[0].compensable).toBe(45_000)
    expect(r.partners[0].net).toBe(-135_000)
  })

  it('[POS-08] sans bras opposé, rien n’est compensable', () => {
    const r = positions([dette('b', 40_000)], [])
    expect(r.partners[0].compensable).toBe(0)
  })
})

describe('TC-120-C — l’ordre des poutres', () => {
  it('[POS-09] la plus grosse exposition passe devant', () => {
    const r = positions([dette('b', 40_000), dette('c', 135_000)], [])
    expect(r.partners.map((p) => p.storeId)).toEqual(['c', 'b'])
  })

  it('[POS-10] une paire opposée pèse son compensable, pas son net nul', () => {
    // Sinon la boutique où il y a le plus à gagner d'un geste finirait en bas
    // de liste, derrière des expositions plus petites.
    const r = positions(
      [dette('pair', 90_000), dette('petite', 40_000)],
      [creance('pair', 90_000)],
    )
    expect(r.partners.map((p) => p.storeId)).toEqual(['pair', 'petite'])
  })

  it('[POS-11] à poids égal, l’ordre est alphabétique — jamais celui de Firestore', () => {
    const r = positions([dette('zeta', 50_000), dette('alpha', 50_000)], [])
    expect(r.partners.map((p) => p.name)).toEqual(['Boutique alpha', 'Boutique zeta'])
  })
})

describe('TC-120-D — le nom du partenaire', () => {
  it('[POS-12] le nom vient de l’AUTRE partie, selon le sens', () => {
    const r = positions([dette('b', 10_000)], [creance('c', 10_000)])
    const noms = Object.fromEntries(r.partners.map((p) => [p.storeId, p.name]))
    expect(noms).toEqual({ b: 'Boutique b', c: 'Boutique c' })
  })

  it('[POS-13] sans nom enregistré, l’identifiant sert de repli', () => {
    const r = positions([dette('b', 10_000, { creditorStoreName: null })], [])
    expect(r.partners[0].name).toBe('b')
  })

  it('[POS-14] le premier nom non nul l’emporte — donc le plus récent', () => {
    // Les documents arrivent du plus récent au plus ancien.
    const r = positions(
      [
        dette('b', 10_000, { creditorStoreName: 'Gounghin' }),
        dette('b', 10_000, { creditorStoreName: 'Ancien nom' }),
      ],
      [],
    )
    expect(r.partners[0].name).toBe('Gounghin')
  })
})

describe('TC-120-E — les données abîmées', () => {
  for (const mauvais of [null, undefined, -1, 1.5, '90000', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    it(`[POS-15] un reste dû « ${String(mauvais)} » est écarté et compté`, () => {
      const r = positions([dette('b', 50_000), dette('c', mauvais)], [])
      expect(r.ignored).toBe(1)
      expect(r.totalDebt).toBe(50_000)
      expect(r.partners.map((p) => p.storeId)).toEqual(['b'])
    })
  }

  it('[POS-16] une dette envers moi-même est écartée, pas rendue', () => {
    const r = positions([dette(MOI, 50_000)], [])
    expect(r.ignored).toBe(1)
    expect(r.partners).toEqual([])
  })

  it('[POS-17] une dette sans partenaire est écartée', () => {
    const r = positions([dette('b', 50_000, { creditorStoreId: null })], [])
    expect(r.ignored).toBe(1)
    expect(r.partners).toEqual([])
  })

  it('[POS-18] un écart ne fait jamais tomber le reste de l’écran', () => {
    const r = positions([null, undefined, dette('b', 50_000)], [])
    expect(r.ignored).toBe(2)
    expect(r.totalDebt).toBe(50_000)
  })
})

describe('TC-120-F — l’échelle des bras', () => {
  it('[POS-19] l’échelle se prend sur le plus grand BRAS, pas sur le plus grand net', () => {
    // Paire opposée 90 000 / 90 000 : net nul, bras de 90 000. Une échelle
    // fondée sur le net vaudrait 40 000 ici, et la poutre déborderait.
    const r = positions([dette('pair', 90_000), dette('seule', 40_000)], [creance('pair', 90_000)])
    expect(r.maxArm).toBe(90_000)
  })

  it('[POS-20] le plus grand bras occupe exactement la demi-piste', () => {
    expect(armWidthPercent(180_000, 180_000)).toBe(50)
  })

  it('[POS-21] les autres sont proportionnels', () => {
    expect(armWidthPercent(90_000, 180_000)).toBe(25)
    expect(armWidthPercent(45_000, 180_000)).toBe(12.5)
  })

  it('[POS-22] un bras ne dépasse JAMAIS la demi-piste, même avec une échelle fausse', () => {
    // Le plafond est la définition de la piste, pas une précaution : au-delà, le
    // dessin mentirait sur la comparaison qu'il propose.
    expect(armWidthPercent(500_000, 180_000)).toBe(50)
  })

  it('[POS-23] sans échelle, aucun bras', () => {
    expect(armWidthPercent(50_000, 0)).toBe(0)
    expect(armWidthPercent(50_000, undefined)).toBe(0)
  })

  it('[POS-24] un montant illisible ne dessine pas de bras', () => {
    expect(armWidthPercent(null, 180_000)).toBe(0)
    expect(armWidthPercent(-10, 180_000)).toBe(0)
    expect(armWidthPercent('50000', 180_000)).toBe(0)
  })
})
