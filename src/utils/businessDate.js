import { activeProfile } from '../config/activeClientProfile.js'

export const BUSINESS_TIME_ZONE = activeProfile.regional?.timezone || 'UTC'

const datePartsFormatter = new Map()

function formatter(timeZone) {
  if (!datePartsFormatter.has(timeZone)) {
    datePartsFormatter.set(timeZone, new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }))
  }
  return datePartsFormatter.get(timeZone)
}

function zonedParts(date, timeZone) {
  return Object.fromEntries(
    formatter(timeZone).formatToParts(date)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, Number(value)]),
  )
}

function parseDateKey(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) throw new Error(`Date métier invalide : ${dateKey}`)
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

function addCalendarDays(dateKey, days) {
  const { year, month, day } = parseDateKey(dateKey)
  const next = new Date(Date.UTC(year, month - 1, day + days))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`
}

function zonedMidnightToUtc(dateKey, timeZone) {
  const target = parseDateKey(dateKey)
  const targetMillis = Date.UTC(target.year, target.month - 1, target.day)
  let candidate = targetMillis

  // Deux passages suffisent pour les changements de décalage ; le troisième
  // stabilise aussi les zones ayant des transitions inhabituelles.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const observed = zonedParts(new Date(candidate), timeZone)
    const observedMillis = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    )
    candidate += targetMillis - observedMillis
  }
  return new Date(candidate)
}

export function businessDateKey(value = new Date(), timeZone = BUSINESS_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('Date métier invalide.')
  const { year, month, day } = zonedParts(date, timeZone)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function isSameBusinessDay(left, right, timeZone = BUSINESS_TIME_ZONE) {
  return businessDateKey(left, timeZone) === businessDateKey(right, timeZone)
}

export function storedBusinessDateKey(value, timeZone = BUSINESS_TIME_ZONE) {
  if (typeof value === 'string') {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s|$)/.exec(value.trim())
    if (match) {
      const key = `${match[3]}-${match[2]}-${match[1]}`
      parseDateKey(key)
      return key
    }
  }
  return businessDateKey(value, timeZone)
}

export function getBusinessDayBounds(dateKey, timeZone = BUSINESS_TIME_ZONE) {
  return {
    start: zonedMidnightToUtc(dateKey, timeZone),
    end: zonedMidnightToUtc(addCalendarDays(dateKey, 1), timeZone),
  }
}

export function millisecondsUntilNextBusinessDay(now = new Date(), timeZone = BUSINESS_TIME_ZONE) {
  const { end } = getBusinessDayBounds(businessDateKey(now, timeZone), timeZone)
  return Math.max(1, end.getTime() - now.getTime())
}
