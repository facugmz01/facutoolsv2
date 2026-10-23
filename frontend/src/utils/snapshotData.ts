export interface Snapshot {
  id: number
  type: string
  data: Record<string, unknown>
  created_at: string
}

export interface DnsRecordRow {
  type: string
  name: string
  value: string
  ttl: number | null
}

const DNS_TYPE_ORDER = ['SOA', 'NS', 'MX', 'A', 'AAAA', 'CNAME', 'TXT', 'SRV', 'CAA', 'PTR', 'HTTPS']

export function latestSnapshot(snapshots: Snapshot[], type: string): Record<string, unknown> | null {
  const snap = snapshots.find(s => s.type === type)
  return snap?.data ?? null
}

function normalizeRecord(raw: Record<string, unknown>): DnsRecordRow | null {
  const type = String(raw.type ?? '').toUpperCase()
  const value = String(raw.value ?? '').trim()
  if (!type || !value) return null
  return {
    type,
    name: String(raw.name ?? '').trim() || '—',
    value,
    ttl: typeof raw.ttl === 'number' ? raw.ttl : null,
  }
}

export function sortDnsRecords(records: DnsRecordRow[]): DnsRecordRow[] {
  return [...records].sort((a, b) => {
    const typeA = DNS_TYPE_ORDER.indexOf(a.type)
    const typeB = DNS_TYPE_ORDER.indexOf(b.type)
    const orderA = typeA === -1 ? DNS_TYPE_ORDER.length : typeA
    const orderB = typeB === -1 ? DNS_TYPE_ORDER.length : typeB
    if (orderA !== orderB) return orderA - orderB
    const nameCmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    if (nameCmp !== 0) return nameCmp
    return a.value.localeCompare(b.value, undefined, { sensitivity: 'base' })
  })
}

export function parseDnsRecords(snapshots: Snapshot[]): DnsRecordRow[] {
  const dnsData = latestSnapshot(snapshots, 'dns')
  if (!dnsData) return []

  const rawList = Array.isArray(dnsData)
    ? dnsData
    : (dnsData as { data?: unknown[] }).data ?? []

  const records = (rawList as Record<string, unknown>[])
    .map(normalizeRecord)
    .filter((r): r is DnsRecordRow => r != null)

  return sortDnsRecords(records)
}

export function dnsRecordTypes(records: DnsRecordRow[]): string[] {
  const types = [...new Set(records.map(r => r.type))]
  return types.sort((a, b) => {
    const orderA = DNS_TYPE_ORDER.indexOf(a)
    const orderB = DNS_TYPE_ORDER.indexOf(b)
    const idxA = orderA === -1 ? DNS_TYPE_ORDER.length : orderA
    const idxB = orderB === -1 ? DNS_TYPE_ORDER.length : orderB
    return idxA - idxB
  })
}

export interface HealthData {
  is_up: boolean
  status_code: number | null
  response_time_ms: number | null
  ssl_valid?: boolean | null
  checked_at?: string
}

export function parseHealth(snapshots: Snapshot[]): HealthData | null {
  const data = latestSnapshot(snapshots, 'health')
  if (!data) return null
  return data as unknown as HealthData
}

export interface EmailSecurityData {
  domain?: string
  spf?: { found?: boolean; record?: string | null; valid?: boolean }
  dkim?: { found?: boolean; selectors?: string[] }
  dmarc?: { found?: boolean; record?: string | null; policy?: string | null }
  mx_records?: string[]
  score?: number
  recommendations?: string[]
}

export function parseEmailSecurity(snapshots: Snapshot[]): EmailSecurityData | null {
  const data = latestSnapshot(snapshots, 'email_security')
  if (!data || Array.isArray(data)) return null
  return data as EmailSecurityData
}

export interface BlacklistData {
  domain?: string
  is_listed?: boolean
  blacklists_checked?: number
  listings?: {
    blacklist: string
    listed: boolean
    category?: string
    url?: string
    code?: string
    error?: boolean
  }[]
  ip?: string | null
  abuseipdb?: {
    score?: number
    totalReports?: number
    lastReportedAt?: string | null
  } | null
  fortiguard?: string | null
  source?: string
}

export function parseBlacklists(snapshots: Snapshot[]): BlacklistData | null {
  const data = latestSnapshot(snapshots, 'blacklists')
  if (!data || Array.isArray(data)) return null
  return data as BlacklistData
}

export interface HostIntelData {
  ip?: string
  country_name?: string
  country_code?: string
  region?: string
  city?: string
  isp?: string
  org?: string
  asn?: { asn?: string; name?: string; domain?: string; route?: string; type?: string }
  threat?: Record<string, unknown>
  is_threat?: boolean
  threat_flags?: Record<string, boolean | null | undefined>
  emoji_flag?: string
  source?: string
}

export function parseHostIntel(snapshots: Snapshot[]): HostIntelData | null {
  const data = latestSnapshot(snapshots, 'host_intel')
  if (!data || Array.isArray(data)) return null
  return data as HostIntelData
}

export interface ProviderData {
  name: string
  type: string
}

export function parseProviders(snapshots: Snapshot[]): ProviderData[] {
  const data = latestSnapshot(snapshots, 'providers')
  if (!data) return []
  if (Array.isArray(data)) return data as ProviderData[]
  const nested = (data as { data?: unknown }).data
  return Array.isArray(nested) ? (nested as ProviderData[]) : []
}

export interface TechItem {
  name?: string
  category?: string
  version?: string | null
  eol?: boolean
  eol_date?: string | null
  outdated?: boolean
  latest_version?: string | null
  vulnerabilities?: number
  vulnerability_ids?: string[]
}

export interface TechStackData {
  domain?: string
  technologies?: TechItem[]
  server?: string | null
  cms?: string | null
  cdn?: string | null
  analytics?: string[]
}

export function parseTechStack(snapshots: Snapshot[]): TechStackData | null {
  const data = latestSnapshot(snapshots, 'tech_stack')
  if (!data || Array.isArray(data)) return null
  return data as TechStackData
}
