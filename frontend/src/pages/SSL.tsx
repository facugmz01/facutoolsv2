import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  Shield, RefreshCw, Plus, AlertTriangle, CheckCircle, XCircle, Clock, Download,
  Trash2, KeyRound, Lock, Asterisk, Settings as SettingsIcon, Globe, ChevronDown, ChevronRight, Search,
} from 'lucide-react'
import { api, AppSetting, Domain, SSLCertificate, SSLDashboard, SSLIssuerType } from '../api'
import { formatDate as formatSystemDate } from '../utils/datetime'

const DOMAIN_PAGE_SIZE = 20
const CERT_PAGE_SIZE = 10

type StatusKey = 'issued' | 'pending' | 'revoked' | 'other'
type StatusFilter = 'all' | 'vigentes' | 'pending' | 'historial'

type StatusGroups = Record<StatusKey, SSLCertificate[]>

type DomainGroup = {
  key: string
  domainId: number | null
  name: string
  groups: StatusGroups
  vigentes: SSLCertificate[]
  pending: SSLCertificate[]
  historial: SSLCertificate[]
  total: number
}

type CertActions = {
  loading: boolean
  onCheck: (cert: SSLCertificate) => void
  onComplete: (cert: SSLCertificate) => void
  onDownload: (cert: SSLCertificate) => void
  onRenew: (cert: SSLCertificate) => void
  onRetry: (cert: SSLCertificate) => void
  onRevoke: (cert: SSLCertificate) => void
  onShowDns: (cert: SSLCertificate) => void
}

function isRevoked(cert: SSLCertificate) {
  return cert.status === 'revoked' || cert.acme_status === 'revoked'
}

function isPending(cert: SSLCertificate) {
  if (isRevoked(cert) || !cert.managed) return false
  return (
    cert.acme_status === 'awaiting_validation'
    || cert.acme_status === 'validating'
    || cert.acme_status === 'pending'
    || cert.acme_status === 'failed'
    || cert.status === 'pending_generation'
  )
}

function isIssuedOk(cert: SSLCertificate) {
  if (isRevoked(cert) || isPending(cert)) return false
  if (cert.managed && (cert.issued || cert.acme_status === 'issued' || cert.downloadable)) return true
  if (!cert.managed && ['valid', 'expiring', 'critical'].includes(cert.status)) return true
  return false
}

function classifyCert(cert: SSLCertificate): StatusKey {
  if (isRevoked(cert)) return 'revoked'
  if (isPending(cert)) return 'pending'
  if (isIssuedOk(cert)) return 'issued'
  return 'other'
}

function emptyStatusGroups(): StatusGroups {
  return { issued: [], pending: [], revoked: [], other: [] }
}

function byHost(a: SSLCertificate, b: SSLCertificate) {
  return a.hostname.localeCompare(b.hostname) || a.id - b.id
}

function resolveDomainGroup(
  cert: SSLCertificate,
  domainById: Map<number, Domain>,
  domainsByNameLen: Domain[],
  unassignedLabel: string,
): Pick<DomainGroup, 'key' | 'domainId' | 'name'> {
  if (cert.domain_id != null) {
    const domain = domainById.get(cert.domain_id)
    if (domain) {
      return { key: `id:${domain.id}`, domainId: domain.id, name: domain.name }
    }
  }

  const host = cert.hostname.replace(/^\*\./, '').toLowerCase()
  for (const domain of domainsByNameLen) {
    const name = domain.name.toLowerCase()
    if (host === name || host.endsWith(`.${name}`)) {
      return { key: `id:${domain.id}`, domainId: domain.id, name: domain.name }
    }
  }

  if (host) return { key: `host:${host}`, domainId: null, name: host }
  return { key: 'unassigned', domainId: null, name: unassignedLabel }
}

function kindLabel(cert: SSLCertificate, t: TFunction) {
  const issuer = cert.cert_type === 'self_signed'
    ? t('ssl.requestForm.issuerSelfSigned')
    : cert.cert_type === 'letsencrypt'
      ? t('ssl.requestForm.issuerLetsEncrypt')
      : cert.managed
        ? (cert.issuer || t('ssl.certCard.kindManaged'))
        : t('common.external')
  const scope = cert.is_wildcard ? t('ssl.certCard.scopeWildcard') : t('ssl.certCard.scopeSingle')
  return `${issuer} · ${scope}`
}

function formatDate(value: string | null | undefined) {
  return formatSystemDate(value)
}

function certMatchesQuery(cert: SSLCertificate, domainName: string, query: string) {
  if (!query) return true
  const q = query.toLowerCase()
  return (
    cert.hostname.toLowerCase().includes(q)
    || domainName.toLowerCase().includes(q)
    || (cert.issuer || '').toLowerCase().includes(q)
  )
}

function certsForFilter(domain: DomainGroup, filter: StatusFilter): SSLCertificate[] {
  switch (filter) {
    case 'vigentes': return domain.vigentes
    case 'pending': return domain.pending
    case 'historial': return domain.historial
    default: return [...domain.vigentes, ...domain.pending, ...domain.historial].sort(byHost)
  }
}

function CertRow({
  cert,
  expanded,
  onToggle,
  actions,
}: {
  cert: SSLCertificate
  expanded: boolean
  onToggle: () => void
  actions: CertActions
}) {
  const { t } = useTranslation()
  const revoked = isRevoked(cert)
  const pending = isPending(cert)
  const awaiting = cert.acme_status === 'awaiting_validation'
  const failed = cert.acme_status === 'failed'
  const canRetry = !!(
    cert.managed
    && cert.cert_type === 'letsencrypt'
    && !revoked
    && (awaiting || failed || cert.acme_status === 'pending' || cert.status === 'pending_generation')
  )
  const canRenew = !!(cert.managed && !revoked && !canRetry)
  const canDownload = !!(cert.downloadable && !revoked)
  const domainLink = cert.domain_id
    ? (cert.subdomain_id
      ? `/domains/${cert.domain_id}/subdomains/${cert.subdomain_id}`
      : `/domains/${cert.domain_id}`)
    : null

  const stop = (e: React.MouseEvent, fn: () => void) => {
    e.stopPropagation()
    fn()
  }

  return (
    <div className={`rounded-lg border ${
      revoked
        ? 'border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30'
        : pending
          ? 'border-yellow-200 dark:border-yellow-900/40 bg-yellow-50 dark:bg-yellow-950/30'
          : 'border-border bg-surface'
    }`}>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        }}
        className="flex flex-wrap items-center gap-2 px-3 py-2.5 cursor-pointer"
      >
        {expanded
          ? <ChevronDown size={16} className="text-muted-foreground shrink-0" />
          : <ChevronRight size={16} className="text-muted-foreground shrink-0" />}

        <p className="text-sm font-semibold text-foreground font-mono truncate min-w-0 flex-1">{cert.hostname}</p>

        <div className="flex flex-wrap items-center gap-1.5">
          {cert.is_wildcard && (
            <span className="badge badge-info inline-flex items-center gap-1">
              <Asterisk size={10} /> {t('ssl.certCard.badges.wildcard')}
            </span>
          )}
          {cert.cert_type === 'letsencrypt' && (
            <span className="badge badge-info inline-flex items-center gap-1">
              <Lock size={10} /> LE
            </span>
          )}
          {cert.cert_type === 'self_signed' && (
            <span className="badge badge-warning inline-flex items-center gap-1">
              <KeyRound size={10} /> {t('ssl.certCard.badges.selfSigned')}
            </span>
          )}
          {!cert.managed && <span className="badge badge-info">{t('ssl.certCard.badges.external')}</span>}
          {revoked && <span className="badge badge-danger">{t('ssl.certCard.badges.revoked')}</span>}
          {cert.issued && !revoked && <span className="badge badge-success">{t('ssl.certCard.badges.issued')}</span>}
          {awaiting && <span className="badge badge-warning">{t('ssl.certCard.badges.awaitingDns')}</span>}
          {failed && <span className="badge badge-danger">{t('ssl.certCard.badges.failed')}</span>}
          {!revoked && !pending && !cert.issued && (
            <span className="badge badge-info capitalize">{cert.status.replace('_', ' ')}</span>
          )}
          {cert.days_remaining != null && !revoked && (
            <span className={`text-xs tabular-nums ${cert.days_remaining <= 30 ? 'text-yellow-600' : 'text-muted-foreground'}`}>
              {t('ssl.certCard.daysRemaining', { count: cert.days_remaining })}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-1 ml-auto" onClick={e => e.stopPropagation()}>
          {!revoked && (
            <button
              type="button"
              onClick={e => stop(e, () => actions.onCheck(cert))}
              disabled={actions.loading}
              className="btn-secondary text-xs px-2 py-1"
              title={t('ssl.certCard.checkTooltip')}
            >
              <RefreshCw size={12} />
            </button>
          )}
          {(awaiting || failed) && (cert.challenge_dns_name || (cert.challenges && cert.challenges.length > 0)) && (
            <button
              type="button"
              onClick={e => stop(e, () => actions.onShowDns(cert))}
              className="btn-secondary text-xs px-2 py-1 text-yellow-600 border-yellow-200 dark:border-yellow-900/40"
            >
              {t('ssl.certCard.dns')}
            </button>
          )}
          {awaiting && (
            <button
              type="button"
              onClick={e => stop(e, () => actions.onComplete(cert))}
              disabled={actions.loading}
              className="btn-secondary text-xs px-2 py-1 text-green-600"
            >
              {t('ssl.certCard.complete')}
            </button>
          )}
          {canRetry && (
            <button
              type="button"
              onClick={e => stop(e, () => actions.onRetry(cert))}
              disabled={actions.loading}
              className="btn-secondary text-xs px-2 py-1 text-brand-700 dark:text-brand-400 border-brand-200 dark:border-brand-800/40"
              title={t('ssl.certCard.retryTooltip')}
            >
              <RefreshCw size={12} />
            </button>
          )}
          {canDownload && (
            <button
              type="button"
              onClick={e => stop(e, () => actions.onDownload(cert))}
              className="btn-secondary text-xs px-2 py-1"
              title={t('common.download')}
            >
              <Download size={12} />
            </button>
          )}
          {canRenew && (
            <button
              type="button"
              onClick={e => stop(e, () => actions.onRenew(cert))}
              disabled={actions.loading}
              className="btn-secondary text-xs px-2 py-1"
              title={t('common.renew')}
            >
              <RefreshCw size={12} />
            </button>
          )}
          {cert.managed && !revoked && (
            <button
              type="button"
              onClick={e => stop(e, () => actions.onRevoke(cert))}
              disabled={actions.loading}
              className="btn-secondary text-xs px-2 py-1 text-red-600 border-red-200 dark:border-red-900/40"
              title={t('common.revoke')}
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-border space-y-3">
          <p className="text-sm text-muted-foreground">{kindLabel(cert, t)}</p>
          {domainLink && (
            <Link to={domainLink} className="text-xs text-brand-700 dark:text-brand-400 hover:underline">
              {t('ssl.certCard.openAssetDetail')}
            </Link>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t('ssl.certCard.status')}</p>
              <p className="text-foreground capitalize mt-0.5">{cert.status.replace('_', ' ')}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t('ssl.certCard.issuer')}</p>
              <p className="text-foreground mt-0.5 truncate">{cert.issuer || '—'}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t('ssl.certCard.validFrom')}</p>
              <p className="text-foreground mt-0.5">{formatDate(cert.valid_from)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t('ssl.certCard.validTo')}</p>
              <p className="text-foreground mt-0.5">
                {formatDate(cert.valid_until)}
                {cert.days_remaining != null && !revoked && (
                  <span className={`ml-1 text-xs ${cert.days_remaining <= 30 ? 'text-yellow-600' : 'text-muted-foreground'}`}>
                    {t('ssl.certCard.daysRemaining', { count: cert.days_remaining })}
                  </span>
                )}
              </p>
            </div>
          </div>

          {cert.sans && cert.sans.length > 0 && (
            <p className="text-xs text-muted-foreground">
              <span className="text-muted-foreground">{t('ssl.certCard.sans')}</span>{' '}
              <span className="font-mono text-muted-foreground break-all">{cert.sans.join(', ')}</span>
            </p>
          )}

          {cert.last_error && (
            <div className="rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-400 leading-relaxed">
              {cert.last_error}
            </div>
          )}

          {awaiting && (cert.challenges?.length || cert.challenge_dns_name) && (
            <div className="rounded-lg border border-yellow-200 dark:border-yellow-900/40 bg-yellow-50 dark:bg-yellow-950/30 px-3 py-2.5 space-y-2">
              <p className="text-xs text-yellow-600 font-medium">{t('ssl.certCard.dnsPending')}</p>
              {(cert.challenges?.length
                ? cert.challenges
                : [{ dns_name: cert.challenge_dns_name || '', dns_value: cert.challenge_dns_value || '' }]
              ).map((row, idx) => (
                <div key={`${row.dns_name}-${idx}`} className="font-mono text-xs text-foreground-secondary break-all">
                  <span className="text-muted-foreground">TXT </span>{row.dns_name}
                  {row.dns_value && <div className="text-muted-foreground mt-1">{row.dns_value}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatusChip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean
  label: string
  count: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
        active
          ? 'bg-brand-700 text-white border-brand-700'
          : 'bg-surface text-muted-foreground border-border hover:border-brand-300'
      }`}
    >
      {label} ({count})
    </button>
  )
}

function DomainTree({
  domains,
  selectedKey,
  onSelect,
  domainSearch,
  onDomainSearch,
  domainVisibleCount,
  onLoadMore,
  totalCerts,
}: {
  domains: DomainGroup[]
  selectedKey: string | null
  onSelect: (key: string) => void
  domainSearch: string
  onDomainSearch: (v: string) => void
  domainVisibleCount: number
  onLoadMore: () => void
  totalCerts: number
}) {
  const { t } = useTranslation()
  const visible = domains.slice(0, domainVisibleCount)

  return (
    <div className="card flex flex-col h-full min-h-[480px] p-0 overflow-hidden">
      <div className="p-3 border-b border-border">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            className="input pl-8 py-1.5 text-sm"
            placeholder={t('ssl.tree.searchDomains')}
            value={domainSearch}
            onChange={e => onDomainSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground p-4">{t('ssl.groups.domainEmpty')}</p>
        ) : (
          <ul className="divide-y divide-slate-100 divide-border">
            {visible.map(domain => (
              <li key={domain.key}>
                <button
                  type="button"
                  onClick={() => onSelect(domain.key)}
                  className={`w-full text-left px-3 py-2.5 flex items-center justify-between gap-2 transition-colors ${
                    selectedKey === domain.key
                      ? 'bg-brand-50 dark:bg-brand-950/30 border-l-2 border-l-brand-700'
                      : 'hover:bg-canvas border-l-2 border-l-transparent'
                  }`}
                >
                  <span className="font-mono text-sm truncate text-foreground">{domain.name}</span>
                  <span className="badge badge-info shrink-0">{domain.total}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="p-3 border-t border-border space-y-2">
        {domains.length > domainVisibleCount && (
          <button type="button" onClick={onLoadMore} className="btn-secondary w-full text-xs py-1.5">
            {t('ssl.groups.loadMoreDomains', { shown: domainVisibleCount, total: domains.length })}
          </button>
        )}
        <p className="text-xs text-muted-foreground text-center">
          {t('ssl.tree.footer', { domains: domains.length, certs: totalCerts })}
        </p>
      </div>
    </div>
  )
}

function DomainDetailPanel({
  domain,
  statusFilter,
  onStatusFilter,
  certPage,
  onCertPage,
  expandedCertId,
  onToggleCert,
  actions,
}: {
  domain: DomainGroup
  statusFilter: StatusFilter
  onStatusFilter: (f: StatusFilter) => void
  certPage: number
  onCertPage: (p: number) => void
  expandedCertId: number | null
  onToggleCert: (id: number | null) => void
  actions: CertActions
}) {
  const { t } = useTranslation()
  const filtered = certsForFilter(domain, statusFilter)
  const totalPages = Math.max(1, Math.ceil(filtered.length / CERT_PAGE_SIZE))
  const safePage = Math.min(certPage, totalPages)
  const pageCerts = filtered.slice((safePage - 1) * CERT_PAGE_SIZE, safePage * CERT_PAGE_SIZE)

  return (
    <div className="card flex flex-col min-h-[480px]">
      <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-border">
        <div>
          <div className="flex items-center gap-2 font-semibold text-foreground">
            <Globe size={18} className="text-brand-700 dark:text-brand-400 shrink-0" />
            <span className="font-mono">{domain.name}</span>
            <span className="badge badge-info">{domain.total}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {t('ssl.groups.domainSummary', {
              vigentes: domain.vigentes.length,
              pending: domain.pending.length,
              historial: domain.historial.length,
            })}
          </p>
        </div>
        {domain.domainId != null && (
          <Link to={`/domains/${domain.domainId}`} className="text-xs text-brand-700 dark:text-brand-400 hover:underline shrink-0">
            {t('ssl.groups.openDomain')}
          </Link>
        )}
      </div>

      <div className="flex flex-wrap gap-2 py-4">
        <StatusChip
          active={statusFilter === 'all'}
          label={t('ssl.tree.filterAll')}
          count={domain.total}
          onClick={() => onStatusFilter('all')}
        />
        <StatusChip
          active={statusFilter === 'vigentes'}
          label={t('ssl.groups.vigentesTitle')}
          count={domain.vigentes.length}
          onClick={() => onStatusFilter('vigentes')}
        />
        <StatusChip
          active={statusFilter === 'pending'}
          label={t('ssl.groups.pendingTitle')}
          count={domain.pending.length}
          onClick={() => onStatusFilter('pending')}
        />
        <StatusChip
          active={statusFilter === 'historial'}
          label={t('ssl.groups.historialTitle')}
          count={domain.historial.length}
          onClick={() => onStatusFilter('historial')}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">{t('ssl.groups.domainEmpty')}</p>
      ) : (
        <>
          <div className="space-y-2 flex-1">
            {pageCerts.map(cert => (
              <CertRow
                key={cert.id}
                cert={cert}
                expanded={expandedCertId === cert.id}
                onToggle={() => onToggleCert(expandedCertId === cert.id ? null : cert.id)}
                actions={actions}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 pt-4 mt-4 border-t border-border">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => onCertPage(safePage - 1)}
                className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-40"
              >
                {t('ssl.tree.prevPage')}
              </button>
              <span className="text-xs text-muted-foreground">
                {t('ssl.tree.pageInfo', { page: safePage, total: totalPages, size: CERT_PAGE_SIZE })}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => onCertPage(safePage + 1)}
                className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-40"
              >
                {t('ssl.tree.nextPage')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function SSL() {
  const { t } = useTranslation()
  const [certs, setCerts] = useState<SSLCertificate[]>([])
  const [domains, setDomains] = useState<Domain[]>([])
  const [dashboard, setDashboard] = useState<SSLDashboard | null>(null)
  const [acmeEmail, setAcmeEmail] = useState('')
  const [acmeDirectory, setAcmeDirectory] = useState('')
  const [loading, setLoading] = useState(false)
  const [showRequest, setShowRequest] = useState(false)
  const [requestForm, setRequestForm] = useState({
    hostname: '',
    auto_renew: true,
    wildcard: false,
    issuer_type: 'letsencrypt' as SSLIssuerType,
    validity_days: 365,
  })
  const [selectedCert, setSelectedCert] = useState<SSLCertificate | null>(null)
  const [domainSearch, setDomainSearch] = useState('')
  const [selectedDomainKey, setSelectedDomainKey] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('vigentes')
  const [certPage, setCertPage] = useState(1)
  const [expandedCertId, setExpandedCertId] = useState<number | null>(null)
  const [domainVisibleCount, setDomainVisibleCount] = useState(DOMAIN_PAGE_SIZE)

  const loadAcmeSettings = async () => {
    try {
      const grouped = await api.settings.grouped()
      const sslSettings = (grouped.ssl || []) as AppSetting[]
      const email = sslSettings.find(s => s.key === 'acme_email')
      const directory = sslSettings.find(s => s.key === 'acme_directory_url')
      setAcmeEmail(String(email?.value ?? ''))
      setAcmeDirectory(String(directory?.value ?? ''))
    } catch (e) {
      console.error(e)
    }
  }

  const load = () => {
    api.ssl.list().then(setCerts).catch(console.error)
    api.domains.list().then(setDomains).catch(console.error)
    api.ssl.dashboard().then(setDashboard).catch(console.error)
    void loadAcmeSettings()
  }
  useEffect(() => { load() }, [])

  const acmeReady = Boolean(acmeEmail && acmeEmail.includes('@') && !acmeEmail.endsWith('@example.com') && acmeDirectory)
  const acmeEnv = acmeDirectory.includes('staging')
    ? t('ssl.acmeEnv.staging')
    : acmeDirectory.includes('acme-v02.api.letsencrypt.org')
      ? t('ssl.acmeEnv.production')
      : t('ssl.acmeEnv.custom')

  const { statusTotals, domainGroups, historyTotal } = useMemo(() => {
    const totals = emptyStatusGroups()
    const domainById = new Map(domains.map(d => [d.id, d]))
    const domainsByNameLen = [...domains].sort((a, b) => b.name.length - a.name.length)
    const byDomain = new Map<string, DomainGroup>()

    for (const cert of certs) {
      const status = classifyCert(cert)
      totals[status].push(cert)

      const resolved = resolveDomainGroup(
        cert,
        domainById,
        domainsByNameLen,
        t('ssl.groups.unassigned'),
      )
      let group = byDomain.get(resolved.key)
      if (!group) {
        group = {
          key: resolved.key,
          domainId: resolved.domainId,
          name: resolved.name,
          groups: emptyStatusGroups(),
          vigentes: [],
          pending: [],
          historial: [],
          total: 0,
        }
        byDomain.set(resolved.key, group)
      }
      group.groups[status].push(cert)
      if (status === 'issued') group.vigentes.push(cert)
      else if (status === 'pending') group.pending.push(cert)
      else group.historial.push(cert)
      group.total += 1
    }

    for (const key of Object.keys(totals) as StatusKey[]) {
      totals[key].sort(byHost)
    }
    for (const group of byDomain.values()) {
      group.vigentes.sort(byHost)
      group.pending.sort(byHost)
      group.historial.sort(byHost)
    }

    const ordered = [...byDomain.values()].sort((a, b) =>
      a.name.localeCompare(b.name) || (a.domainId ?? 0) - (b.domainId ?? 0),
    )

    return {
      statusTotals: totals,
      domainGroups: ordered,
      historyTotal: totals.revoked.length + totals.other.length,
    }
  }, [certs, domains, t])

  const domainQuery = domainSearch.trim().toLowerCase()

  const filteredDomains = useMemo(() => {
    if (!domainQuery) return domainGroups
    return domainGroups.filter(d =>
      d.name.toLowerCase().includes(domainQuery)
      || d.vigentes.some(c => certMatchesQuery(c, d.name, domainQuery))
      || d.pending.some(c => certMatchesQuery(c, d.name, domainQuery))
      || d.historial.some(c => certMatchesQuery(c, d.name, domainQuery)),
    )
  }, [domainGroups, domainQuery])

  const selectedDomain = filteredDomains.find(d => d.key === selectedDomainKey) ?? null

  useEffect(() => {
    setDomainVisibleCount(DOMAIN_PAGE_SIZE)
  }, [domainSearch])

  useEffect(() => {
    if (filteredDomains.length === 0) {
      setSelectedDomainKey(null)
      return
    }
    if (!selectedDomainKey || !filteredDomains.some(d => d.key === selectedDomainKey)) {
      const withPending = filteredDomains.find(d => d.pending.length > 0)
      setSelectedDomainKey(withPending?.key ?? filteredDomains[0].key)
    }
  }, [filteredDomains, selectedDomainKey])

  useEffect(() => {
    setCertPage(1)
    setExpandedCertId(null)
  }, [selectedDomainKey, statusFilter])

  const handleMonitorAll = async () => {
    setLoading(true)
    await api.ssl.monitorAll()
    load()
    setLoading(false)
  }

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    if (requestForm.issuer_type === 'letsencrypt' && !acmeReady) {
      alert(t('errors.acmeNotConfigured'))
      return
    }
    setLoading(true)
    try {
      await api.ssl.request({
        hostname: requestForm.hostname,
        auto_renew: requestForm.issuer_type === 'letsencrypt' ? requestForm.auto_renew : false,
        wildcard: requestForm.wildcard,
        issuer_type: requestForm.issuer_type,
        validity_days: requestForm.validity_days,
      })
      setShowRequest(false)
      setRequestForm({
        hostname: '',
        auto_renew: true,
        wildcard: false,
        issuer_type: 'letsencrypt',
        validity_days: 365,
      })
      load()
    } catch (err) {
      console.error(err)
      alert(err instanceof Error ? err.message : t('errors.requestFailed'))
    }
    setLoading(false)
  }

  const run = async (fn: () => Promise<unknown>) => {
    setLoading(true)
    try {
      await fn()
      load()
    } catch (err) {
      console.error(err)
      load()
      alert(err instanceof Error ? err.message : t('errors.operationFailed'))
    }
    setLoading(false)
  }

  const certActions: CertActions = {
    loading,
    onCheck: cert => { void run(() => api.ssl.check(cert.hostname)) },
    onComplete: cert => { void run(() => api.ssl.complete(cert.id)) },
    onDownload: cert => { void api.ssl.download(cert.id) },
    onRenew: cert => { void run(() => api.ssl.renew(cert.id)) },
    onRetry: cert => {
      void run(async () => {
        const updated = await api.ssl.retry(cert.id)
        setSelectedCert(updated)
      })
    },
    onRevoke: cert => {
      const pending = isPending(cert)
      const issued = isIssuedOk(cert)
      const message = pending
        ? t('ssl.confirmRevokePending', { hostname: cert.hostname })
        : issued
          ? t('ssl.confirmRevoke', { kind: kindLabel(cert, t), hostname: cert.hostname })
          : t('ssl.confirmRevokeGeneric', { hostname: cert.hostname })
      if (!confirm(message)) return
      void run(() => api.ssl.revoke(cert.id))
    },
    onShowDns: cert => setSelectedCert(cert),
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="text-brand-700 dark:text-brand-400" /> {t('ssl.title')}
          </h2>
          <p className="text-muted-foreground mt-1">{t('ssl.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleMonitorAll} disabled={loading} className="btn-secondary flex items-center gap-2">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> {t('ssl.monitorAll')}
          </button>
          <button onClick={() => setShowRequest(true)} className="btn-primary flex items-center gap-2">
            <Plus size={16} /> {t('ssl.generateSsl')}
          </button>
        </div>
      </div>

      <div className={`card border ${acmeReady ? 'border-brand-200 dark:border-brand-800/40 bg-brand-50 dark:bg-brand-950/30' : 'border-yellow-200 dark:border-yellow-900/40 bg-yellow-50 dark:bg-yellow-950/30'}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-semibold text-foreground">
              <Lock size={16} className="text-brand-700 dark:text-brand-400" />
              {t('ssl.letsEncryptFromSettings')}
            </div>
            <p className="text-sm text-muted-foreground">
              {t('ssl.emailLabel')}: <span className="text-foreground">{acmeEmail || '—'}</span>
              {' · '}
              {t('ssl.environmentLabel')}: <span className="text-foreground">{acmeEnv}</span>
            </p>
            <p className="text-xs font-mono text-muted-foreground break-all">{acmeDirectory || t('ssl.noAcmeDirectory')}</p>
            {!acmeReady && (
              <p className="text-xs text-yellow-700 mt-1">{t('ssl.acmeWarning')}</p>
            )}
          </div>
          <Link to="/settings?tab=ssl" className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5">
            <SettingsIcon size={13} /> {t('common.settings')}
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-3">
        {[
          { label: t('ssl.stats.total'), value: certs.length, icon: Shield, color: 'text-brand-700 dark:text-brand-400' },
          { label: t('ssl.stats.issuedOk'), value: statusTotals.issued.length, icon: CheckCircle, color: 'text-green-600' },
          { label: t('ssl.stats.pending'), value: statusTotals.pending.length, icon: Clock, color: 'text-yellow-600' },
          { label: t('ssl.stats.historial'), value: historyTotal, icon: Trash2, color: 'text-muted-foreground' },
          { label: t('ssl.stats.valid'), value: dashboard?.valid ?? 0, icon: CheckCircle, color: 'text-green-600' },
          { label: t('ssl.stats.expiring'), value: dashboard?.expiring ?? 0, icon: Clock, color: 'text-yellow-600' },
          { label: t('ssl.stats.critical'), value: dashboard?.critical ?? 0, icon: AlertTriangle, color: 'text-orange-600' },
          { label: t('ssl.stats.managed'), value: dashboard?.managed ?? 0, icon: Download, color: 'text-sky-600' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="card text-center py-4">
            <Icon size={18} className={`mx-auto ${color}`} />
            <p className="text-2xl font-bold mt-2">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>

      {showRequest && (
        <form onSubmit={handleRequest} className="card space-y-4">
          <h3 className="font-semibold">{t('ssl.requestForm.title')}</h3>
          <p className="text-sm text-muted-foreground">
            {t('ssl.requestForm.description')}{' '}
            {t('ssl.requestForm.scopeHint')}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input
              className="input"
              placeholder={t('ssl.requestForm.hostnamePlaceholder')}
              value={requestForm.hostname}
              onChange={e => setRequestForm({ ...requestForm, hostname: e.target.value })}
              required
            />
            <select
              className="input"
              value={requestForm.issuer_type}
              onChange={e => setRequestForm({
                ...requestForm,
                issuer_type: e.target.value as SSLIssuerType,
              })}
            >
              <option value="letsencrypt">{t('ssl.requestForm.issuerLetsEncrypt')}</option>
              <option value="self_signed">{t('ssl.requestForm.issuerSelfSigned')}</option>
            </select>
          </div>
          <div className="flex flex-wrap gap-6">
            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="ssl-scope-page"
                  checked={!requestForm.wildcard}
                  onChange={() => setRequestForm({ ...requestForm, wildcard: false })}
                />
                {t('ssl.requestForm.scopeDomainOnly')}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="ssl-scope-page"
                  checked={requestForm.wildcard}
                  onChange={() => setRequestForm({ ...requestForm, wildcard: true })}
                />
                {t('ssl.requestForm.scopeWildcardOnly')}
              </label>
            </div>
            {requestForm.issuer_type === 'letsencrypt' ? (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={requestForm.auto_renew}
                  onChange={e => setRequestForm({ ...requestForm, auto_renew: e.target.checked })}
                />
                {t('ssl.requestForm.autoRenew')}
              </label>
            ) : (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                {t('ssl.requestForm.validity')}
                <input
                  type="number"
                  min={1}
                  max={825}
                  className="input w-24 py-1"
                  value={requestForm.validity_days}
                  onChange={e => setRequestForm({
                    ...requestForm,
                    validity_days: Number(e.target.value) || 365,
                  })}
                />
                {t('ssl.requestForm.days')}
              </label>
            )}
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={loading} className="btn-primary">
              {requestForm.issuer_type === 'self_signed'
                ? t('ssl.requestForm.issueCertificate')
                : t('ssl.requestForm.requestCertificate')}
            </button>
            <button type="button" onClick={() => setShowRequest(false)} className="btn-secondary">{t('common.cancel')}</button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(240px,30%)_1fr] gap-4 items-start">
        <DomainTree
          domains={filteredDomains}
          selectedKey={selectedDomainKey}
          onSelect={setSelectedDomainKey}
          domainSearch={domainSearch}
          onDomainSearch={setDomainSearch}
          domainVisibleCount={domainVisibleCount}
          onLoadMore={() => setDomainVisibleCount(c => c + DOMAIN_PAGE_SIZE)}
          totalCerts={certs.length}
        />

        {selectedDomain ? (
          <DomainDetailPanel
            domain={selectedDomain}
            statusFilter={statusFilter}
            onStatusFilter={setStatusFilter}
            certPage={certPage}
            onCertPage={setCertPage}
            expandedCertId={expandedCertId}
            onToggleCert={setExpandedCertId}
            actions={certActions}
          />
        ) : (
          <div className="card min-h-[480px] flex items-center justify-center">
            <p className="text-sm text-muted-foreground">{t('ssl.tree.selectDomain')}</p>
          </div>
        )}
      </div>

      {selectedCert && (selectedCert.challenge_dns_name || selectedCert.challenges?.length) && (
        <div className="card border-yellow-200 dark:border-yellow-900/40 bg-yellow-50 dark:bg-yellow-950/30">
          <h3 className="font-semibold text-yellow-600 mb-3">
            {t('ssl.dnsChallenge.title', { hostname: selectedCert.hostname })}
          </h3>
          <p className="text-sm text-muted-foreground mb-4">{t('ssl.dnsChallenge.description')}</p>
          <div className="space-y-3">
            {(selectedCert.challenges?.length
              ? selectedCert.challenges
              : [{
                  dns_name: selectedCert.challenge_dns_name || '',
                  dns_value: selectedCert.challenge_dns_value || '',
                }]
            ).map((row, idx) => (
              <div key={`${row.dns_name}-${idx}`} className="space-y-2 bg-muted rounded-lg p-4 font-mono text-sm">
                <div>
                  <span className="text-muted-foreground">{t('ssl.dnsChallenge.recordType')}</span>{' '}
                  <span className="text-brand-700 dark:text-brand-400">TXT</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('ssl.dnsChallenge.name')}</span>{' '}
                  <span className="text-green-600 break-all">{row.dns_name}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('ssl.dnsChallenge.value')}</span>{' '}
                  <span className="text-green-600 break-all">{row.dns_value}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-4">
            {selectedCert.acme_status === 'awaiting_validation' && (
              <button
                onClick={() => {
                  void run(async () => {
                    await api.ssl.complete(selectedCert.id)
                    setSelectedCert(null)
                  })
                }}
                disabled={loading}
                className="btn-primary"
              >
                {t('ssl.dnsChallenge.complete')}
              </button>
            )}
            {selectedCert.cert_type === 'letsencrypt' && selectedCert.managed && (
              <button
                onClick={() => {
                  void run(async () => {
                    const updated = await api.ssl.retry(selectedCert.id)
                    setSelectedCert(updated)
                  })
                }}
                disabled={loading}
                className="btn-secondary flex items-center gap-1 text-brand-700 dark:text-brand-400 border-brand-200 dark:border-brand-800/40"
              >
                <RefreshCw size={14} /> {t('common.retry')}
              </button>
            )}
            <button onClick={() => setSelectedCert(null)} className="btn-secondary">{t('common.close')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
