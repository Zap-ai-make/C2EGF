import { describe, expect, it } from 'vitest'

import {
  businessDateKey,
  getBusinessDayBounds,
  isSameBusinessDay,
  storedBusinessDateKey,
} from '../../src/utils/businessDate.js'

describe('dates métier', () => {
  it('classe un instant selon le fuseau métier, indépendamment du fuseau du poste', () => {
    const instant = new Date('2026-06-30T23:30:00.000Z')

    expect(businessDateKey(instant, 'Africa/Ouagadougou')).toBe('2026-06-30')
    expect(businessDateKey(instant, 'Europe/Paris')).toBe('2026-07-01')
  })

  it('calcule des bornes UTC exactes lors d’un changement d’heure', () => {
    const { start, end } = getBusinessDayBounds('2026-03-29', 'Europe/Paris')

    expect(start.toISOString()).toBe('2026-03-28T23:00:00.000Z')
    expect(end.toISOString()).toBe('2026-03-29T22:00:00.000Z')
  })

  it('compare deux instants dans la même journée métier', () => {
    expect(isSameBusinessDay(
      new Date('2026-07-01T00:15:00.000Z'),
      new Date('2026-06-30T23:30:00.000Z'),
      'Africa/Ouagadougou',
    )).toBe(false)
  })

  it('interprète une date française stockée comme une date murale métier', () => {
    expect(storedBusinessDateKey('01/07/2026 00:15')).toBe('2026-07-01')
  })
})
