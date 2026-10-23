import i18n from '../i18n'

const DOMAIN_REGEX = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i

export function normalizeDomain(name: string): string {
  return name.trim().toLowerCase().replace(/\.$/, '')
}

export function validateDomainFormat(name: string): string | null {
  const normalized = normalizeDomain(name)
  if (!normalized) return i18n.t('validation.domainRequired')
  if (normalized.length > 253) return i18n.t('validation.domainTooLong')
  if (/https?:\/\//.test(name) || name.includes('/') || name.includes(' ')) {
    return i18n.t('validation.domainOnly')
  }
  if (!DOMAIN_REGEX.test(normalized)) return i18n.t('validation.invalidFormat')
  return null
}

export function normalizeSubdomain(hostname: string, domain: string): string {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '')
  if (!host || /:\/\//.test(host) || host.includes('/') || host.includes(' ') || host === domain) {
    return ''
  }
  if (host.startsWith('.') || host.endsWith('.') || host.includes('..')) return ''
  const fullHost = host.endsWith(`.${domain}`) ? host : `${host}.${domain}`
  const base = fullHost.slice(0, -(domain.length + 1))
  if (!base) return ''
  const labels = base.split('.')
  if (labels.some(label => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    return ''
  }
  return fullHost
}

export function parseSubdomainInput(input: string, domain: string): string[] {
  const seen = new Set<string>()
  const values: string[] = []
  for (const raw of input.split(/[\n,]+/)) {
    const candidate = normalizeSubdomain(raw.trim(), domain)
    if (!candidate || seen.has(candidate)) continue
    seen.add(candidate)
    values.push(candidate)
  }
  return values
}

export { formatDate, formatDateTime } from './datetime'

export function toDateInputValue(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}
