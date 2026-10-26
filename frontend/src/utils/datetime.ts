import i18n, { DATE_LOCALES } from '../i18n'

const DEFAULT_TIME_ZONE = 'UTC'

let systemTimeZone = DEFAULT_TIME_ZONE

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}

export function setSystemTimeZone(value: string | null | undefined): void {
  systemTimeZone = isValidTimeZone(value) ? value : DEFAULT_TIME_ZONE
}

export function getSystemTimeZone(): string {
  return systemTimeZone
}

export function listTimeZones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
  const zones = supported ? supported('timeZone') : []
  return zones.includes('UTC') ? zones : ['UTC', ...zones]
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/

/** The API stores naive UTC datetimes, so a timezone-less string must be read as UTC. */
export function parseApiDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const raw = value.trim()
  const normalized = NAIVE_DATETIME.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

function currentDateLocale(): string {
  return DATE_LOCALES[i18n.language] ?? DATE_LOCALES.en
}

export function formatDate(value: string | Date | null | undefined): string {
  const date = parseApiDate(value)
  if (!date) return value ? String(value) : '—'
  // Date-only values carry no time, so shifting them across zones would change the day.
  const timeZone = typeof value === 'string' && DATE_ONLY.test(value.trim()) ? 'UTC' : systemTimeZone
  return date.toLocaleDateString(currentDateLocale(), { year: 'numeric', month: 'short', day: 'numeric', timeZone })
}

export function formatDateTime(value: string | Date | null | undefined): string {
  const date = parseApiDate(value)
  if (!date) return value ? String(value) : '—'
  return date.toLocaleString(currentDateLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: systemTimeZone,
  })
}

export function formatDateTimeShort(value: string | Date | null | undefined): string {
  const date = parseApiDate(value)
  if (!date) return value ? String(value) : '—'
  return date.toLocaleString(currentDateLocale(), { dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23', timeZone: systemTimeZone })
}

export function formatDateTimeSeconds(value: string | Date | null | undefined): string {
  const date = parseApiDate(value)
  if (!date) return value ? String(value) : '—'
  return new Intl.DateTimeFormat(currentDateLocale(), {
    timeZone: systemTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'shortOffset',
  }).format(date)
}

/** YYYY-MM-DD of the instant in the system time zone, for grouping by local day. */
export function dayKey(value: string | Date | null | undefined): string {
  const date = parseApiDate(value)
  if (!date) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: systemTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}
