/**
 * TC-348 — Ce qu'une recherche par dates a le droit de relire (lot G1).
 *
 * `bornerPeriode` décide de la période, `bornesServeur` de ce qui se lit
 * vraiment. Chaque jour relu se paie : on garde le sens que le filtre avait
 * déjà (« Du » seul = à partir de, « Au » seul = jusqu'à, TC-116), dans une
 * limite de 31 jours. La journée en cours n'est jamais relue, puisque son
 * écoute la tient déjà.
 *
 * Ouagadougou est à UTC+0 : minuit métier = minuit UTC.
 */

import { describe, it, expect } from 'vitest'
import { PERIODE_MAX_JOURS, bornerPeriode, bornesServeur } from '../../src/utils/periodeHistorique.js'

const MAINTENANT = new Date('2026-11-06T12:00:00Z')
const minuit = (jour) => new Date(`${jour}T00:00:00Z`)

describe('TC-348 — bornerPeriode', () => {
  it('[PH-01] deux dates dans l\'ordre : telles quelles', () => {
    expect(bornerPeriode({ from: '2026-11-01', to: '2026-11-05' }, MAINTENANT)).toEqual({ from: '2026-11-01', to: '2026-11-05' })
  })

  it('[PH-02] deux dates à l\'envers : remises dans l\'ordre', () => {
    expect(bornerPeriode({ from: '2026-11-05', to: '2026-11-01' }, MAINTENANT)).toEqual({ from: '2026-11-01', to: '2026-11-05' })
  })

  it('[PH-03] « Du » seul : 31 jours, jamais au-delà d\'aujourd\'hui', () => {
    expect(bornerPeriode({ from: '2026-08-25' }, MAINTENANT)).toEqual({ from: '2026-08-25', to: '2026-09-24' })
    expect(bornerPeriode({ from: '2026-11-01' }, MAINTENANT)).toEqual({ from: '2026-11-01', to: '2026-11-06' })
  })

  it('[PH-04] « Du » seul dans le futur : ce seul jour', () => {
    expect(bornerPeriode({ from: '2026-12-01' }, MAINTENANT)).toEqual({ from: '2026-12-01', to: '2026-12-01' })
  })

  it('[PH-05] « Au » seul : les 31 jours qui précèdent, ce jour compris', () => {
    expect(bornerPeriode({ to: '2026-08-25' }, MAINTENANT)).toEqual({ from: '2026-07-26', to: '2026-08-25' })
  })

  it('[PH-06] exactement 31 jours : accepté ; 32 : refusé', () => {
    expect(PERIODE_MAX_JOURS).toBe(31)
    expect(bornerPeriode({ from: '2026-10-01', to: '2026-10-31' }, MAINTENANT)).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(bornerPeriode({ from: '2026-10-01', to: '2026-11-01' }, MAINTENANT)).toEqual({ erreur: 'Choisissez une période de 31 jours au plus.' })
  })

  it('[PH-07] rien ou n\'importe quoi : refusé, avec une raison', () => {
    expect(bornerPeriode({}, MAINTENANT)).toEqual({ erreur: 'Choisissez une date.' })
    expect(bornerPeriode({ from: '06/11/2026' }, MAINTENANT)).toEqual({ erreur: 'Choisissez une date.' })
    expect(bornerPeriode({ from: '2026-11-01', to: 'hier' }, MAINTENANT)).toEqual({ erreur: 'Date invalide.' })
  })
})

describe('TC-348 — bornesServeur', () => {
  it('[PH-08] une période passée : de son premier minuit au lendemain de son dernier jour', () => {
    expect(bornesServeur({ from: '2026-11-01', to: '2026-11-03' }, MAINTENANT))
      .toEqual({ start: minuit('2026-11-01'), endExclusive: minuit('2026-11-04') })
  })

  it('[PH-09] une période qui touche aujourd\'hui s\'arrête à ce matin minuit', () => {
    expect(bornesServeur({ from: '2026-11-05', to: '2026-11-06' }, MAINTENANT))
      .toEqual({ start: minuit('2026-11-05'), endExclusive: minuit('2026-11-06') })
  })

  it('[PH-10] aujourd\'hui ou le futur : rien à lire', () => {
    expect(bornesServeur({ from: '2026-11-06', to: '2026-11-06' }, MAINTENANT)).toBeNull()
    expect(bornesServeur({ from: '2026-12-01', to: '2026-12-01' }, MAINTENANT)).toBeNull()
  })
})
