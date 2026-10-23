import { getAuthHeaders, refreshAccessToken } from './auth/AuthContext'
import i18n from './i18n'

const API = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const isPublic = path.startsWith('/public/')
  const doFetch = async () => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    if (!isPublic) {
      Object.entries(getAuthHeaders()).forEach(([key, value]) => headers.set(key, value))
    }
    new Headers(options?.headers).forEach((value, key) => headers.set(key, value))
    if (isPublic) headers.delete('Authorization')
    return fetch(`${API}${path}`, {
      ...options,
      credentials: isPublic ? 'omit' : options?.credentials,
      headers,
    })
  }

  let res = await doFetch()
  if (res.status === 401 && !isPublic && !path.startsWith('/auth/')) {
    const newToken = await refreshAccessToken()
    if (newToken) {
      res = await doFetch()
    }
  }
  if (!res.ok) {
    let msg = i18n.t('errors.apiError', { status: res.status })
    try {
      const err = await res.json()
      const detail = err.detail ?? err.message ?? err.error
      if (typeof detail === 'string') msg = detail
      else if (Array.isArray(detail)) msg = detail.map((d: { msg?: string }) => d.msg || d).join(', ')
    } catch { /* ignore */ }
    throw new Error(msg)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export interface DomainValidateResult {
  valid: boolean
  normalized: string
  available: boolean
  error?: string | null
}

export interface DnsRecord {
  name?: string
  value?: string
  rdata?: string
  ttl?: number
  priority?: string | number
  [key: string]: unknown
}

export interface DnsQueryResult {
  name: string
  type: string
  status: 'NOERROR' | 'NXDOMAIN' | 'ERROR'
  records: DnsRecord[]
}

export interface DnsCheckResult {
  domain: string
  records: Record<string, DnsRecord[]>
  cname_records?: DnsRecord[]
  queries: Record<string, DnsQueryResult>
  resolver: { name: string; protocol: string }
  ns: string[]
  server_ip: string | null
  providers: Array<{ name: string; type: string }>
  email_security: { spf: boolean; dmarc: boolean; dkim: string[] }
  total_types: number
}

export interface DomainPreview {
  domain: string
  registrar: string | null
  expires_at: string | null
  whois: Record<string, unknown> | null
  details: Record<string, unknown>
}

export interface DomainNotificationSettings {
  preferences: Record<string, boolean>
  include_subdomains: boolean
}

export interface DomainSetupResult {
  domain: Domain
  subdomains: Subdomain[]
  notifications: DomainNotificationSettings
}

export interface DomainSetupPayload {
  name: string
  registrar?: string
  expires_at?: string
  renewal_cost?: number
  notes?: string
  tags: string[]
  subdomains: string[]
  notifications: DomainNotificationSettings
}

export interface BulkImportJob {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  total: number
  processed: number
  created: number
  skipped_existing: number
  skipped_duplicates: number
  invalid: number
  invalid_items: { name: string; error: string }[]
  error?: string | null
}

export type MonitorMethod = 'http' | 'ping' | 'tcp' | 'dns' | 'ssl';

export interface Domain {
  id: number;
  name: string;
  registrar: string | null;
  status: string;
  purchase_price: number | null;
  renewal_cost: number | null;
  estimated_value: number | null;
  expires_at: string | null;
  auto_renew: boolean;
  monitor_method?: MonitorMethod;
  monitor_port?: number | null;
  notes: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  days_until_expiry: number | null;
  latest_health: {
    is_up: boolean;
    status_code: number | null;
    response_time_ms: number | null;
    ssl_valid: boolean | null;
    checked_at: string;
  } | null;
  last_scanned_at?: string | null;
  next_scan_at?: string | null;
}

export interface DashboardStats {
  total_domains: number;
  expiring_soon: number;
  total_value: number;
  total_renewal_cost: number;
  domains_up: number;
  domains_down: number;
  ssl_expiring_soon: number;
  recent_alerts: number;
  by_registrar: Record<string, number>;
  by_status: Record<string, number>;
  portfolio_trend: { month: string; value: number }[];
}

export interface Alert {
  id: number;
  domain_id: number | null;
  type: string;
  severity: string;
  title: string;
  message: string;
  channel: string;
  is_read: boolean;
  created_at: string;
}

export interface NotificationTemplate {
  id: number
  name: string
  channel: string
  alert_type: string
  subject_template: string | null
  body_html: string | null
  body_text: string | null
  body_json: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface NotificationTemplatePayload {
  name: string
  channel: string
  alert_type: string
  subject_template?: string | null
  body_html?: string | null
  body_text?: string | null
  body_json?: string | null
  is_active?: boolean
}

export type SSLIssuerType = 'letsencrypt' | 'self_signed'

export interface SSLRequestOptions {
  hostname: string
  domain_id?: number
  subdomain_id?: number
  challenge_type?: string
  auto_renew?: boolean
  wildcard?: boolean
  issuer_type?: SSLIssuerType
  validity_days?: number
}

export interface SSLCertificate {
  id: number;
  domain_id: number | null;
  subdomain_id: number | null;
  hostname: string;
  issuer: string | null;
  subject: string | null;
  valid_from: string | null;
  valid_until: string | null;
  days_remaining: number | null;
  is_valid: boolean;
  status: string;
  protocol: string | null;
  cipher: string | null;
  sans?: string[];
  is_wildcard?: boolean;
  cert_type?: string;
  auto_renew: boolean;
  managed: boolean;
  acme_status: string;
  challenge_type: string | null;
  challenge_dns_name: string | null;
  challenge_dns_value: string | null;
  challenges?: { dns_name: string; dns_value: string; identifier?: string }[];
  cert_path: string | null;
  key_path: string | null;
  issued?: boolean;
  downloadable?: boolean;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SSLDashboard {
  total: number;
  valid: number;
  expiring: number;
  critical: number;
  expired: number;
  missing: number;
  managed: number;
  issued?: number;
  revoked?: number;
  pending_generation?: number;
}

export interface Subdomain {
  id: number;
  domain_id: number;
  hostname: string;
  is_active: boolean;
  auto_discovered: boolean;
  ssl_monitor: boolean;
  ssl_auto_renew: boolean;
  notes: string | null;
  latest_ssl: {
    status: string;
    days_remaining: number | null;
    is_valid: boolean;
    issuer: string | null;
  } | null;
  created_at: string;
  updated_at: string;
  last_scanned_at?: string | null;
  next_scan_at?: string | null;
  domain_name?: string;
}

export interface AppSetting {
  key: string;
  value: unknown;
  value_type: string;
  category: string;
  label: string;
  description: string;
}

export interface ScheduleStatus {
  running: boolean;
  domain_monitor: {
    interval_minutes: number;
    next_run_at: string | null;
  };
  ssl_monitor: {
    interval_minutes: number;
    next_run_at: string | null;
  };
}

export interface SubdomainDiscoveryResult {
  domain: string
  total_found: number
  total_checked: number
  resolved_count: number
  wildcard_detected: boolean
  wildcard_filtered: number
  warnings: string[]
  subdomains: {
    subdomain: string
    ips: string[]
    ipv4: string[]
    ipv6: string[]
    cname: string | null
    active: boolean
    status: 'resolved' | 'no_address' | 'dns_error'
    dns_partial: boolean
    wildcard: boolean
    sources: string[]
  }[]
}

export interface SSLCheckResult {
  issuer: string | null
  subject: string | null
  valid_from: string | null
  valid_until: string | null
  days_remaining: number | null
  is_valid: boolean
  protocol: string | null
  cipher: string | null
  sans: string[]
  serial_number: string | null
  signature_algorithm: string | null
  key_type: string | null
  key_bits: number | null
  is_self_signed: boolean
  trusted: boolean
  trust_error: string | null
}

export interface EmailSecurityReport {
  domain: string
  spf: { found: boolean; record: string | null; valid: boolean }
  dkim: { found: boolean; selectors: string[] }
  dmarc: { found: boolean; record: string | null; policy: string | null }
  mx_records: string[]
  score: number
  recommendations: string[]
}

export interface SSLConvertResult {
  detected_format: string
  output_format: string
  encoding: 'text' | 'base64'
  content_type: string
  filename: string
  content: string
  has_private_key: boolean
  key_matches_certificate: boolean | null
  certificate_count: number
  warnings: string[]
  certificates: {
    subject: string
    issuer: string
    common_name?: string
    serial_number: string
    not_before: string
    not_after: string
    days_remaining: number
    is_expired: boolean
    is_self_signed: boolean
    signature_algorithm?: string
    public_key_type?: string
    public_key_bits?: number | null
    sans: string[]
  }[]
}

export const api = {
  domains: {
    list: () => request<Domain[]>('/domains'),
    get: (id: number) => request<Domain>(`/domains/${id}`),
    create: (data: Partial<Domain>) => request<Domain>('/domains', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Domain>) => request<Domain>(`/domains/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<void>(`/domains/${id}`, { method: 'DELETE' }),
    scan: (id: number) => request(`/domains/${id}/scan`, { method: 'POST' }),
    stats: () => request<DashboardStats>('/domains/stats'),
    export: () => request('/domains/export/json'),
    compare: (names: string[]) => request('/domains/compare', { method: 'POST', body: JSON.stringify(names) }),
    snapshots: (id: number) => request(`/domains/${id}/snapshots`),
    bulkImport: (domains: Partial<Domain>[]) => request('/domains/bulk-import', { method: 'POST', body: JSON.stringify({ domains }) }),
    startBulkImportJob: (domains: { name: string }[]) => request<BulkImportJob>('/domains/bulk-import/jobs', { method: 'POST', body: JSON.stringify({ domains }) }),
    bulkImportJob: (id: string) => request<BulkImportJob>(`/domains/bulk-import/jobs/${id}`),
    validate: (name: string) => request<DomainValidateResult>('/domains/validate', { method: 'POST', body: JSON.stringify({ name }) }),
    preview: (domain: string) => request<DomainPreview>(`/domains/preview/${encodeURIComponent(domain)}`),
    setup: (data: DomainSetupPayload, idempotencyKey?: string) => request<DomainSetupResult>('/domains/setup', {
      method: 'POST',
      body: JSON.stringify(data),
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    }),
  },
  tools: {
    whois: (domain: string) => request(`/tools/whois/${encodeURIComponent(domain)}`),
    dns: (domain: string) => request(`/tools/dns/${encodeURIComponent(domain)}`),
    ssl: (domain: string) => request<SSLCheckResult>(`/tools/ssl/${encodeURIComponent(domain)}`),
    emailSecurity: (domain: string) => request<EmailSecurityReport>(`/tools/email-security/${encodeURIComponent(domain)}`),
    propagation: (domain: string) => request(`/tools/propagation/${encodeURIComponent(domain)}`),
    blacklists: (domain: string) => request(`/tools/blacklists/${encodeURIComponent(domain)}`),
    subdomains: (domain: string) => request<SubdomainDiscoveryResult>(`/tools/subdomains/${encodeURIComponent(domain)}`),
  },
  network: {
    ipLookupMe: () => request('/network/ip'),
    ipLookup: (target: string) => request(`/network/ip/${encodeURIComponent(target)}`),
    blacklist: (ip: string) => request(`/network/blacklist/${encodeURIComponent(ip)}`),
    dnsCheck: (domain: string) => request<DnsCheckResult>(`/network/dns/${encodeURIComponent(domain)}`),
    rdap: (domain: string) => request(`/network/rdap/${encodeURIComponent(domain)}`),
    propagation: (domain: string, type = 'A') =>
      request(`/network/propagation/${encodeURIComponent(domain)}?type=${encodeURIComponent(type)}`),
    mac: (mac: string) => request(`/network/mac/${encodeURIComponent(mac)}`),
    smtpTest: (data: {
      host: string; port: number; security?: string;
      mail_from?: string; rcpt_to?: string; user?: string; password?: string;
      send_message?: boolean; subject?: string; body?: string;
    }) => request('/network/smtp-test', { method: 'POST', body: JSON.stringify(data) }),
    portCheck: (data: {
      host: string
      protocol?: string
      mode?: string
      preset?: string
      ports?: string
      timeout?: number
      concurrency?: number
    }) => request('/network/port-check', { method: 'POST', body: JSON.stringify(data) }),
    portCheckStream: async (
      data: {
        host: string
        protocol?: string
        mode?: string
        preset?: string
        ports?: string
      },
      onEvent: (event: any) => void,
      signal?: AbortSignal,
    ) => {
      const doFetch = () => fetch(`${API}/network/port-check/stream`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(data),
      })
      let res = await doFetch()
      if (res.status === 401 && await refreshAccessToken()) res = await doFetch()
      if (!res.ok || !res.body) {
        let msg = i18n.t('errors.apiError', { status: res.status })
        try {
          const err = await res.json()
          if (typeof err.detail === 'string') msg = err.detail
        } catch { /* ignore */ }
        throw new Error(msg)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) if (line.trim()) onEvent(JSON.parse(line))
      }
      if (buffer.trim()) onEvent(JSON.parse(buffer))
    },
    sslConvertFormats: () => request('/network/ssl-convert/formats'),
    sslConvert: (data: {
      content: string
      output_format: string
      input_format?: string
      password?: string
      output_password?: string
      extra_key?: string
      friendly_name?: string
    }) => request<SSLConvertResult>('/network/ssl-convert', { method: 'POST', body: JSON.stringify(data) }),
  },
  alerts: {
    list: () => request<Alert[]>('/alerts'),
    markRead: (id: number) => request(`/alerts/${id}/read`, { method: 'PATCH' }),
    test: (data?: {
      channels?: string[]
      recipients?: string[]
      title?: string
      message?: string
    }) =>
      request<{
        ok: boolean
        results: { channel: string; success: boolean; skipped: boolean; detail: string }[]
      }>('/alerts/test', { method: 'POST', body: JSON.stringify(data || {}) }),
    rules: () => request('/alerts/rules'),
    createRule: (data: object) => request('/alerts/rules', { method: 'POST', body: JSON.stringify(data) }),
  },
  watchlist: {
    list: () => request('/watchlist'),
    add: (data: { domain_name: string; target_price?: number; notes?: string }) =>
      request('/watchlist', { method: 'POST', body: JSON.stringify(data) }),
    remove: (id: number) => request(`/watchlist/${id}`, { method: 'DELETE' }),
  },
  monitoring: {
    list: () => request('/monitoring'),
    create: (data: { name: string; check_type: string; target: string; port?: number; keyword?: string; soap_action?: string; request_body?: string; interval_minutes?: number; interval_seconds?: number; warning_threshold_ms?: number; critical_threshold_ms?: number; is_active?: boolean; is_public?: boolean }) =>
      request('/monitoring', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: object) => request(`/monitoring/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: number) => request(`/monitoring/${id}`, { method: 'DELETE' }),
    runNow: (id: number) => request(`/monitoring/${id}/run`, { method: 'POST' }),
    results: (id: number, limit = 100) => request(`/monitoring/${id}/results?limit=${limit}`),
    uptime: (id: number, hours = 24) => request(`/monitoring/${id}/uptime?hours=${hours}`),
    incidents: (id: number, limit = 50) => request(`/monitoring/${id}/incidents?limit=${limit}`),
    history: (id: number, days = 7) => request(`/monitors/${id}/history?days=${days}`),
  },
  notificationTemplates: {
    list: () => request<NotificationTemplate[]>('/notification-templates'),
    get: (id: number) => request<NotificationTemplate>(`/notification-templates/${id}`),
    defaults: () =>
      request<{
        channels: string[]
        variables: string[]
        defaults: Record<string, Record<string, string>>
      }>('/notification-templates/defaults'),
    create: (data: NotificationTemplatePayload) =>
      request<NotificationTemplate>('/notification-templates', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: number, data: Partial<NotificationTemplatePayload>) =>
      request<NotificationTemplate>(`/notification-templates/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    remove: (id: number) => request(`/notification-templates/${id}`, { method: 'DELETE' }),
    seedDefaults: () =>
      request<{ created: { channel: string; alert_type: string }[]; count: number }>(
        '/notification-templates/seed-defaults',
        { method: 'POST' },
      ),
    preview: (data: {
      channel: string
      subject_template?: string
      body_html?: string
      body_text?: string
      body_json?: string
      title?: string
      message?: string
      alert_type?: string
      severity?: string
      domain_name?: string
    }) =>
      request<{
        channel: string
        subject?: string
        html?: string
        text?: string
        card?: unknown
        raw?: string
      }>('/notification-templates/preview', { method: 'POST', body: JSON.stringify(data) }),
  },
  ssl: {
    list: (domainId?: number) => request<SSLCertificate[]>(domainId ? `/ssl?domain_id=${domainId}` : '/ssl'),
    dashboard: () => request<SSLDashboard>('/ssl/dashboard'),
    get: (id: number) => request<SSLCertificate>(`/ssl/${id}`),
    history: (id: number) => request(`/ssl/${id}/history`),
    check: (hostname: string, domainId?: number, subdomainId?: number) => {
      const params = new URLSearchParams()
      if (domainId) params.set('domain_id', String(domainId))
      if (subdomainId) params.set('subdomain_id', String(subdomainId))
      const qs = params.toString()
      return request(`/ssl/check/${hostname}${qs ? `?${qs}` : ''}`, { method: 'POST' })
    },
    monitorAll: () => request('/ssl/monitor-all', { method: 'POST' }),
    request: (data: SSLRequestOptions) =>
      request('/ssl/request', { method: 'POST', body: JSON.stringify(data) }),
    complete: (id: number) => request(`/ssl/${id}/complete`, { method: 'POST' }),
    retry: (id: number) => request<SSLCertificate>(`/ssl/${id}/retry`, { method: 'POST' }),
    renew: (id: number) => request<SSLCertificate>(`/ssl/${id}/renew`, { method: 'POST' }),
    revoke: (id: number) => request<SSLCertificate>(`/ssl/${id}/revoke`, { method: 'POST' }),
    download: async (id: number) => {
      const headers = getAuthHeaders()
      const res = await fetch(`/api/ssl/${id}/download`, { headers })
      if (!res.ok) throw new Error(`Download failed: ${res.status}`)
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') || ''
      const match = disposition.match(/filename="?([^"]+)"?/)
      const filename = match?.[1] || `ssl-${id}.zip`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    },
    renewExpiring: () => request('/ssl/renew-expiring', { method: 'POST' }),
  },
  subdomains: {
    list: (domainId: number) => request<Subdomain[]>(`/subdomains/domain/${domainId}`),
    get: (id: number) => request<Subdomain & { domain_name?: string }>(`/subdomains/${id}`),
    scan: (id: number) => request(`/subdomains/${id}/scan`, { method: 'POST' }),
    snapshots: (id: number) => request(`/subdomains/${id}/snapshots`),
    create: (domainId: number, data: { hostname: string; ssl_monitor?: boolean; ssl_auto_renew?: boolean; notes?: string }) =>
      request(`/subdomains/domain/${domainId}`, { method: 'POST', body: JSON.stringify(data) }),
    bulk: (domainId: number, hostnames: string[]) =>
      request(`/subdomains/domain/${domainId}/bulk`, { method: 'POST', body: JSON.stringify({ hostnames }) }),
    discover: (domainId: number) => request<Subdomain[]>(`/subdomains/domain/${domainId}/discover`, { method: 'POST' }),
    update: (id: number, data: Partial<Subdomain>) =>
      request(`/subdomains/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request(`/subdomains/${id}`, { method: 'DELETE' }),
  },
  settings: {
    list: () => request<AppSetting[]>('/settings'),
    grouped: () => request<Record<string, AppSetting[]>>('/settings/grouped'),
    schedule: () => request<ScheduleStatus>('/settings/schedule'),
    timezone: () => request<{ timezone: string }>('/settings/timezone'),
    get: (key: string) => request<{ key: string; value: unknown }>(`/settings/${key}`),
    update: (key: string, value: unknown) =>
      request(`/settings/${key}`, { method: 'PUT', body: JSON.stringify({ value }) }),
    updateMany: (settings: Record<string, unknown>) =>
      request<{ updated: unknown[]; schedule: ScheduleStatus }>('/settings', {
        method: 'PUT',
        body: JSON.stringify({ settings }),
      }),
  },
  auth: {
    status: () => request<{ bootstrap_required: boolean }>('/auth/status'),
  },
  orgs: {
    current: () => request<{ id: number; name: string; slug: string }>('/orgs/current'),
    update: (name: string) =>
      request('/orgs/current', { method: 'PATCH', body: JSON.stringify({ name }) }),
    members: () => request<OrgMember[]>('/orgs/members'),
    updateMember: (id: number, role_id: number) =>
      request(`/orgs/members/${id}`, { method: 'PATCH', body: JSON.stringify({ role_id }) }),
    removeMember: (id: number) => request<void>(`/orgs/members/${id}`, { method: 'DELETE' }),
    invitations: () => request<OrgInvite[]>('/orgs/invitations'),
    invite: (email: string, role_id: number) =>
      request<OrgInvite>('/orgs/invitations', { method: 'POST', body: JSON.stringify({ email, role_id }) }),
    revokeInvite: (id: number) => request<void>(`/orgs/invitations/${id}`, { method: 'DELETE' }),
  },
  roles: {
    list: () => request<OrgRole[]>('/roles'),
    permissions: () => request<{ code: string; description: string }[]>('/roles/permissions'),
    create: (data: { name: string; description?: string; permission_codes: string[] }) =>
      request<OrgRole>('/roles', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: { name?: string; description?: string; permission_codes?: string[] }) =>
      request<OrgRole>(`/roles/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<void>(`/roles/${id}`, { method: 'DELETE' }),
  },
  sso: {
    providers: () => request<SsoProvider[]>('/auth/sso/providers'),
    startEntraOnboarding: (data: { name: string; auto_provision: boolean }) =>
      request<{ authorization_url: string }>('/auth/sso/entra-onboarding/start', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    createProvider: (data: object) =>
      request<SsoProvider>('/auth/sso/providers', { method: 'POST', body: JSON.stringify(data) }),
    updateProvider: (id: number, data: object) =>
      request<SsoProvider>(`/auth/sso/providers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteProvider: (id: number) => request<void>(`/auth/sso/providers/${id}`, { method: 'DELETE' }),
  },
  features: () => request('/features'),
};

export interface OrgMember {
  id: number
  user_id: number
  email: string
  name: string
  role_id: number
  role_name: string
  status: string
  created_at: string
}

export interface OrgInvite {
  id: number
  email: string
  role_id: number
  role_name: string
  expires_at: string
  invite_token?: string | null
  created_at: string
}

export interface OrgRole {
  id: number
  name: string
  description: string | null
  is_system: boolean
  permission_codes: string[]
  created_at: string
}

export interface SsoProvider {
  id: number
  name: string
  type: string
  issuer_url: string
  client_id: string
  scopes: string
  enabled: boolean
  auto_provision: boolean
  default_role_id: number | null
  created_at: string
}
