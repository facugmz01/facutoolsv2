import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  Activity, AlertTriangle, Asterisk, Check, Download, ExternalLink, History, KeyRound, Lock,
  Mail, Radar, RefreshCw, Search, Server, Shield, Trash2,
} from 'lucide-react'
import { SSLCertificate } from '../../api'
import { EXTERNAL_TOOLS } from '../../constants/externalTools'
import { formatDate, formatDateTime } from '../../utils/domainValidation'
import {
  BlacklistData, DnsRecordRow, EmailSecurityData, HostIntelData, Snapshot, TechStackData, dnsRecordTypes,
} from '../../utils/snapshotData'
import { EmptyHint } from './AssetDetailLayout'

export function InfoCard({
  title,
  icon: Icon,
  children,
  className = '',
  accent,
}: {
  title: string
  icon?: React.ElementType
  children: React.ReactNode
  className?: string
  accent?: 'brand' | 'green' | 'yellow' | 'red'
}) {
  const accentBorder = {
    brand: 'border-l-brand-500/50',
    green: 'border-l-green-500/50',
    yellow: 'border-l-yellow-500/50',
    red: 'border-l-red-500/50',
  }
  return (
    <div className={`card border-l-2 ${accent ? accentBorder[accent] : 'border-l-transparent'} hover:border-border transition-colors ${className}`}>
      <h3 className="text-sm font-semibold text-foreground-secondary flex items-center gap-2 mb-4">
        {Icon && (
          <span className="p-1.5 rounded-md bg-muted">
            <Icon size={14} className="text-brand-700 dark:text-brand-400" />
          </span>
        )}
        {title}
      </h3>
      {children}
    </div>
  )
}

export function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm border-b border-border last:border-0">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-foreground text-right break-all font-medium">{value ?? '—'}</span>
    </div>
  )
}

export function DnsRecordsPanel({ records, hostname }: { records: DnsRecordRow[]; hostname?: string }) {
  const { t } = useTranslation()
  const types = useMemo(() => dnsRecordTypes(records), [records])
  const [filter, setFilter] = useState<string>('ALL')

  const filtered = filter === 'ALL' ? records : records.filter(r => r.type === filter)

  if (records.length === 0) {
    return (
      <EmptyHint
        icon={Search}
        title={t('asset.dnsRecords.empty.title')}
        hint={t('asset.dnsRecords.empty.hint')}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {t('asset.dnsRecords.recordsCount', { count: records.length })}
          {hostname && <span className="text-muted-foreground"> · {hostname}</span>}
        </p>
        <div className="flex gap-1 flex-wrap">
          <FilterPill active={filter === 'ALL'} onClick={() => setFilter('ALL')} label={t('asset.dnsRecords.allFilter', { count: records.length })} />
          {types.map(t => (
            <FilterPill
              key={t}
              active={filter === t}
              onClick={() => setFilter(t)}
              label={`${t} (${records.filter(r => r.type === t).length})`}
            />
          ))}
        </div>
      </div>

      <div className="overflow-auto max-h-96 rounded-xl border border-border bg-muted/50">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 sticky top-0 backdrop-blur-sm">
            <tr className="text-left text-muted-foreground text-xs uppercase tracking-wide">
              <th className="px-4 py-3 font-medium w-20">{t('asset.dnsRecords.columns.type')}</th>
              <th className="px-4 py-3 font-medium w-1/4">{t('asset.dnsRecords.columns.name')}</th>
              <th className="px-4 py-3 font-medium">{t('asset.dnsRecords.columns.value')}</th>
              <th className="px-4 py-3 font-medium w-20 text-right">{t('asset.dnsRecords.columns.ttl')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((r, i) => (
              <tr key={`${r.type}-${r.name}-${r.value}-${i}`} className="hover:bg-canvas/20 transition-colors">
                <td className="px-4 py-3">
                  <span className="badge badge-info font-mono">{r.type}</span>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground break-all">{r.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-foreground break-all">{r.value}</td>
                <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">{r.ttl ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FilterPill({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
        active
          ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/20'
          : 'bg-canvas text-muted-foreground hover:text-foreground hover:bg-canvas'
      }`}
    >
      {label}
    </button>
  )
}

function sslStatusVariant(cert: SSLCertificate | null, liveSsl: Record<string, unknown> | null): 'success' | 'warning' | 'danger' | 'neutral' {
  const status = cert?.status || (liveSsl?.is_valid === true ? 'valid' : liveSsl?.is_valid === false ? 'invalid' : null)
  if (status === 'valid') return 'success'
  if (status === 'expiring' || status === 'critical') return 'warning'
  if (status === 'expired' || status === 'missing') return 'danger'
  return 'neutral'
}

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
      className="text-[10px] uppercase tracking-wide text-muted-foreground hover:text-brand-700 dark:text-brand-400 transition-colors shrink-0"
    >
      {copied ? t('common.copied') : t('common.copy')}
    </button>
  )
}

export type SSLGenerateOptions = {
  issuer_type: 'letsencrypt' | 'self_signed'
  wildcard?: boolean
  validity_days?: number
  auto_renew?: boolean
}

function certKindLabel(cert: SSLCertificate, t: TFunction): string {
  const issuer = cert.cert_type === 'self_signed'
    ? t('asset.sslCard.kindSelfSigned')
    : cert.cert_type === 'letsencrypt'
      ? t('asset.sslCard.kindLetsEncrypt')
      : cert.issuer || t('asset.sslCard.kindExternal')
  const scope = cert.is_wildcard ? t('asset.sslCard.scopeWildcard') : t('asset.sslCard.scopeSingle')
  return `${issuer} · ${scope}`
}

function managedIssueLabel(cert: SSLCertificate, t: TFunction): { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral' } {
  if (cert.status === 'revoked' || cert.acme_status === 'revoked') {
    return { label: t('asset.sslCard.statusRevoked'), variant: 'danger' }
  }
  if (cert.acme_status === 'awaiting_validation') {
    return { label: t('asset.sslCard.statusAwaitingDns'), variant: 'warning' }
  }
  if (cert.acme_status === 'validating' || cert.status === 'pending_generation') {
    return { label: t('asset.sslCard.statusPending'), variant: 'info' }
  }
  if (cert.acme_status === 'failed') {
    return { label: t('asset.sslCard.statusFailed'), variant: 'danger' }
  }
  if (cert.issued || cert.acme_status === 'issued' || (cert.downloadable && cert.status === 'valid')) {
    return { label: t('asset.sslCard.statusIssued'), variant: 'success' }
  }
  return { label: cert.status.replace('_', ' '), variant: 'neutral' }
}

function issueBadgeClass(variant: string): string {
  if (variant === 'success') return 'badge-success'
  if (variant === 'warning') return 'badge-warning'
  if (variant === 'danger') return 'badge-danger'
  if (variant === 'info') return 'badge-info'
  return 'badge-info'
}

export function SSLCard({
  certs,
  hostname,
  liveSsl,
  busy,
  allowWildcard = false,
  onGenerate,
  onRenew,
  onDownload,
  onComplete,
  onRetry,
  onRevoke,
}: {
  certs: SSLCertificate[]
  hostname: string
  liveSsl: Record<string, unknown> | null
  busy: boolean
  allowWildcard?: boolean
  onGenerate: (opts: SSLGenerateOptions) => void
  onRenew: (certId: number) => void
  onDownload: (certId: number) => void
  onComplete: (certId: number) => void
  onRetry: (certId: number) => void
  onRevoke: (certId: number) => void
}) {
  const { t } = useTranslation()
  const [showOptions, setShowOptions] = useState(false)
  const [issuerType, setIssuerType] = useState<'letsencrypt' | 'self_signed'>('letsencrypt')
  const [wildcard, setWildcard] = useState(false)
  const [validityDays, setValidityDays] = useState(365)
  const [autoRenew, setAutoRenew] = useState(true)
  const [challengeCertId, setChallengeCertId] = useState<number | null>(null)

  const managedCerts = useMemo(
    () => certs.filter(c =>
      c.managed
      && (c.cert_type === 'letsencrypt' || c.cert_type === 'self_signed')
      && c.status !== 'revoked'
      && c.acme_status !== 'revoked'
    ),
    [certs],
  )
  const liveCert = managedCerts.find(c => c.issued && c.status !== 'revoked') || managedCerts[0] || null
  const challengeCert =
    managedCerts.find(c => c.id === challengeCertId) ||
    managedCerts.find(c => c.acme_status === 'awaiting_validation' && c.challenge_dns_name) ||
    null

  const issuer = liveCert?.issuer || (liveSsl?.issuer as string) || '—'
  const subject = liveCert?.subject || (liveSsl?.subject as string) || hostname
  const validFrom = liveCert?.valid_from || (liveSsl?.valid_from as string)
  const validUntil = liveCert?.valid_until || (liveSsl?.valid_until as string)
  const fingerprint = (liveSsl?.fingerprint as string) || null
  const protocol = liveCert?.protocol || (liveSsl?.protocol as string) || null
  const daysLeft = liveCert?.days_remaining ?? (typeof liveSsl?.days_remaining === 'number' ? liveSsl.days_remaining : null)
  const statusLabel = liveCert?.status?.replace('_', ' ') || (liveSsl?.is_valid ? 'valid' : liveSsl ? 'invalid' : 'unknown')
  const variant = sslStatusVariant(liveCert, liveSsl)
  const sans = liveCert?.sans?.length ? liveCert.sans : null
  const coverageNames = allowWildcard && wildcard
    ? [`*.${hostname}`]
    : [hostname]
  const issuedCount = managedCerts.filter(c => c.issued && c.status !== 'revoked').length

  const statusDot = {
    success: 'bg-green-400',
    warning: 'bg-yellow-400',
    danger: 'bg-red-400',
    neutral: 'bg-slate-400',
  }
  const statusText = {
    success: 'text-green-600',
    warning: 'text-yellow-600',
    danger: 'text-red-600',
    neutral: 'text-muted-foreground',
  }

  const submitGenerate = () => {
    onGenerate({
      issuer_type: issuerType,
      wildcard: allowWildcard ? wildcard : false,
      validity_days: issuerType === 'self_signed' ? validityDays : undefined,
      auto_renew: issuerType === 'letsencrypt' ? autoRenew : false,
    })
    setShowOptions(false)
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className={`flex items-center gap-2 text-sm font-medium capitalize ${statusText[variant]}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${statusDot[variant]} ${variant === 'success' ? 'animate-pulse' : ''}`} />
          {statusLabel}
          {daysLeft != null && (
            <span className="text-muted-foreground font-normal normal-case">{t('asset.sslCard.daysLeftShort', { count: daysLeft })}</span>
          )}
          {issuedCount > 0 && (
            <span className="badge badge-success normal-case">
              {t('asset.sslCard.issuedCount', { count: issuedCount })}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowOptions(v => !v)}
          disabled={busy}
          aria-expanded={showOptions}
          className={`text-xs px-2.5 py-1.5 flex items-center gap-1.5 disabled:opacity-50 ${
            showOptions ? 'btn-secondary ring-1 ring-brand-500/40' : 'btn-primary'
          }`}
        >
          {busy ? <RefreshCw size={13} className="animate-spin" /> : <Shield size={13} />}
          {showOptions ? t('common.close') : t('common.generate')}
        </button>
      </div>

      {showOptions && (
        <div className="mb-4 mt-3 rounded-xl border border-border bg-gradient-to-b from-slate-50 dark:from-surface to-white dark:to-surface overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-sm font-medium text-foreground">{t('asset.sslCard.newCertificate')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('asset.sslCard.newCertificateHint')}
            </p>
          </div>

          <div className="p-4 space-y-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{t('asset.sslCard.issuerLabel')}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setIssuerType('letsencrypt')}
                  className={`text-left rounded-lg border px-3 py-3 transition-colors ${
                    issuerType === 'letsencrypt'
                      ? 'border-brand-500/60 bg-brand-500/10'
                      : 'border-border bg-surface hover:border-border'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Lock size={15} className={issuerType === 'letsencrypt' ? 'text-brand-700 dark:text-brand-400' : 'text-muted-foreground'} />
                      <span className="text-sm font-medium text-foreground">{t('asset.sslCard.issuerLetsEncrypt')}</span>
                    </div>
                    {issuerType === 'letsencrypt' && <Check size={14} className="text-brand-700 dark:text-brand-400 mt-0.5" />}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                    {t('asset.sslCard.issuerLetsEncryptHint')}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setIssuerType('self_signed')}
                  className={`text-left rounded-lg border px-3 py-3 transition-colors ${
                    issuerType === 'self_signed'
                      ? 'border-brand-500/60 bg-brand-500/10'
                      : 'border-border bg-surface hover:border-border'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <KeyRound size={15} className={issuerType === 'self_signed' ? 'text-brand-700 dark:text-brand-400' : 'text-muted-foreground'} />
                      <span className="text-sm font-medium text-foreground">{t('asset.sslCard.issuerSelfSigned')}</span>
                    </div>
                    {issuerType === 'self_signed' && <Check size={14} className="text-brand-700 dark:text-brand-400 mt-0.5" />}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                    {t('asset.sslCard.issuerSelfSignedHint')}
                  </p>
                </button>
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{t('asset.sslCard.coverage')}</p>
              <div className="rounded-lg border border-border bg-surface px-3 py-2.5">
                <ul className="space-y-1.5">
                  {coverageNames.map(name => (
                    <li key={name} className="flex items-center gap-2 text-sm font-mono text-foreground">
                      <span className="w-1.5 h-1.5 rounded-full bg-brand-500/80 shrink-0" />
                      {name}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="space-y-2">
              {allowWildcard && (
                <div className="rounded-lg border border-border bg-surface px-3 py-2.5 space-y-2">
                  <p className="text-sm text-foreground">{t('asset.sslCard.scopeTitle')}</p>
                  <p className="text-xs text-muted-foreground">{t('asset.sslCard.scopeHint')}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    <label className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                      !wildcard ? 'border-brand-500/60 bg-brand-500/10' : 'border-border hover:border-border'
                    }`}>
                      <input
                        type="radio"
                        className="mt-0.5 accent-brand-500"
                        name="ssl-scope"
                        checked={!wildcard}
                        onChange={() => setWildcard(false)}
                      />
                      <span>
                        <span className="text-sm text-foreground block">{t('asset.sslCard.scopeDomainOnly')}</span>
                        <span className="text-xs text-muted-foreground font-mono">{hostname}</span>
                      </span>
                    </label>
                    <label className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                      wildcard ? 'border-brand-500/60 bg-brand-500/10' : 'border-border hover:border-border'
                    }`}>
                      <input
                        type="radio"
                        className="mt-0.5 accent-brand-500"
                        name="ssl-scope"
                        checked={wildcard}
                        onChange={() => setWildcard(true)}
                      />
                      <span>
                        <span className="text-sm text-foreground block flex items-center gap-1">
                          <Asterisk size={13} className="text-muted-foreground" /> {t('asset.sslCard.scopeWildcardOnly')}
                        </span>
                        <span className="text-xs text-muted-foreground font-mono">*.{hostname}</span>
                      </span>
                    </label>
                  </div>
                </div>
              )}

              {issuerType === 'letsencrypt' ? (
                <label className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 cursor-pointer hover:border-border transition-colors">
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">{t('asset.sslCard.autoRenew')}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t('asset.sslCard.autoRenewHint')}
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    className="accent-brand-500 w-4 h-4 shrink-0"
                    checked={autoRenew}
                    onChange={e => setAutoRenew(e.target.checked)}
                  />
                </label>
              ) : (
                <div className="rounded-lg border border-border bg-surface px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm text-foreground">{t('asset.sslCard.validity')}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{t('asset.sslCard.validityHint')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {[90, 365, 825].map(days => (
                        <button
                          key={days}
                          type="button"
                          onClick={() => setValidityDays(days)}
                          className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                            validityDays === days
                              ? 'border-brand-500/60 bg-brand-50 dark:bg-brand-950/30 text-brand-700 dark:text-brand-400'
                              : 'border-border text-muted-foreground hover:border-slate-300 dark:hover:border-slate-600'
                          }`}
                        >
                          {days}d
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs leading-relaxed ${
              issuerType === 'letsencrypt'
                ? 'bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-900/40 text-yellow-800 dark:text-yellow-400'
                : 'bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900/40 text-sky-800'
            }`}>
              <AlertTriangle size={13} className="mt-0.5 shrink-0 opacity-80" />
              <span>
                {issuerType === 'letsencrypt'
                  ? t('asset.sslCard.letsEncryptNotice')
                  : t('asset.sslCard.selfSignedNotice')}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={submitGenerate}
                disabled={busy}
                className="btn-primary text-xs px-3.5 py-2 disabled:opacity-50 flex items-center gap-1.5"
              >
                {busy ? <RefreshCw size={13} className="animate-spin" /> : <Shield size={13} />}
                {issuerType === 'self_signed'
                  ? t('asset.sslCard.issueCertificate')
                  : t('asset.sslCard.requestCertificate')}
              </button>
              <button
                type="button"
                onClick={() => setShowOptions(false)}
                className="btn-secondary text-xs px-3.5 py-2"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {managedCerts.length > 0 && (
        <div className="mt-3 mb-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('asset.sslCard.managedCertificates')}</p>
          {managedCerts.map(cert => {
            const issue = managedIssueLabel(cert, t)
            const canDownload = !!(cert.downloadable ?? (cert.cert_path && cert.key_path && cert.status !== 'revoked'))
            const awaiting = cert.acme_status === 'awaiting_validation' && !!cert.challenge_dns_name
            const failed = cert.acme_status === 'failed'
            const revoked = cert.status === 'revoked'
            const canRetry = !!(
              cert.managed
              && cert.cert_type === 'letsencrypt'
              && !revoked
              && (awaiting || failed || cert.acme_status === 'pending' || cert.status === 'pending_generation')
            )
            const canRenew = !!(cert.managed && !revoked && !canRetry)
            return (
              <div
                key={cert.id}
                className={`rounded-lg border px-3 py-2.5 ${
                  revoked ? 'border-border bg-surface/20 opacity-70' : 'border-border bg-surface'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{certKindLabel(cert, t)}</p>
                      <span className={`badge ${issueBadgeClass(issue.variant)}`}>{issue.label}</span>
                    </div>
                    <p className="text-xs font-mono text-muted-foreground mt-1 truncate">{cert.hostname}</p>
                    {cert.sans && cert.sans.length > 0 && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                        {t('asset.sslCard.sans')}: {cert.sans.join(', ')}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {revoked
                        ? t('asset.sslCard.filesRemoved')
                        : cert.valid_until
                          ? (cert.days_remaining != null
                              ? t('asset.sslCard.expiresOn', { date: formatDate(cert.valid_until), days: cert.days_remaining })
                              : t('asset.sslCard.expiresDateOnly', { date: formatDate(cert.valid_until) }))
                          : t('asset.sslCard.notIssuedYet')}
                    </p>
                    {cert.last_error && (
                      <p className="text-[11px] text-red-600 mt-1 leading-relaxed line-clamp-3">{cert.last_error}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(awaiting || failed) && (cert.challenge_dns_name || (cert.challenges && cert.challenges.length > 0)) && (
                      <button
                        type="button"
                        onClick={() => setChallengeCertId(cert.id)}
                        className="btn-secondary text-xs px-2 py-1 text-yellow-600 border-yellow-200 dark:border-yellow-900/40"
                      >
                        {t('asset.sslCard.dns')}
                      </button>
                    )}
                    {awaiting && (
                      <button
                        type="button"
                        onClick={() => onComplete(cert.id)}
                        disabled={busy}
                        className="btn-secondary text-xs px-2 py-1 text-green-600 border-green-800/40 disabled:opacity-40"
                      >
                        {t('asset.sslCard.complete')}
                      </button>
                    )}
                    {canRetry && (
                      <button
                        type="button"
                        onClick={() => {
                          onRetry(cert.id)
                          setChallengeCertId(cert.id)
                        }}
                        disabled={busy}
                        title={t('asset.sslCard.retryTooltip')}
                        className="btn-secondary text-xs px-2 py-1 flex items-center gap-1 text-brand-700 dark:text-brand-400 border-brand-200 dark:border-brand-800/40 disabled:opacity-40"
                      >
                        <RefreshCw size={12} />
                        {t('common.retry')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onDownload(cert.id)}
                      disabled={!canDownload}
                      title={t('asset.sslCard.downloadTooltip', { kind: certKindLabel(cert, t) })}
                      className="btn-secondary text-xs px-2 py-1 flex items-center gap-1 disabled:opacity-40"
                    >
                      <Download size={12} />
                      {t('common.download')}
                    </button>
                    {canRenew && (
                      <button
                        type="button"
                        onClick={() => onRenew(cert.id)}
                        disabled={busy || revoked}
                        title={t('asset.sslCard.renewTooltip')}
                        className="btn-secondary text-xs px-2 py-1 flex items-center gap-1 disabled:opacity-40"
                      >
                        <RefreshCw size={12} />
                        {t('common.renew')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(t('asset.sslCard.revokeConfirm', { kind: certKindLabel(cert, t), hostname: cert.hostname }))) {
                          onRevoke(cert.id)
                        }
                      }}
                      disabled={busy || revoked}
                      title={t('asset.sslCard.revokeTooltip')}
                      className="btn-secondary text-xs px-2 py-1 flex items-center gap-1 text-red-600 border-red-200 dark:border-red-900/40 hover:bg-red-50 dark:hover:bg-red-950/40 dark:bg-red-950/30 disabled:opacity-40"
                    >
                      <Trash2 size={12} />
                      {t('common.revoke')}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!showOptions && (
        <>
          <DetailRow label={t('asset.sslCard.issuer')} value={issuer} />
          <DetailRow label={t('asset.sslCard.subject')} value={subject} />
          {sans && (
            <DetailRow
              label={t('asset.sslCard.sans')}
              value={<span className="text-xs font-mono text-muted-foreground break-all">{sans.join(', ')}</span>}
            />
          )}
          <DetailRow label={t('asset.sslCard.validFrom')} value={validFrom ? formatDate(validFrom) : '—'} />
          <DetailRow label={t('asset.sslCard.validTo')} value={validUntil ? formatDate(validUntil) : '—'} />
          {protocol && <DetailRow label={t('asset.sslCard.protocol')} value={protocol} />}
          {fingerprint && (
            <DetailRow
              label={t('asset.sslCard.fingerprint')}
              value={<span className="text-xs font-mono text-muted-foreground break-all">{fingerprint}</span>}
            />
          )}
        </>
      )}

      {managedCerts.some(c => c.last_error) && !showOptions && (
        <div className="mb-3 rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-400">
          {managedCerts.filter(c => c.last_error).map(c => (
            <p key={c.id} className="leading-relaxed">
              <span className="font-medium">{certKindLabel(c, t)}:</span> {c.last_error}
            </p>
          ))}
        </div>
      )}

      {challengeCert && (challengeCert.challenge_dns_name || (challengeCert.challenges && challengeCert.challenges.length > 0)) && (
        <div className="mt-3 pt-3 border-t border-border">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 text-xs text-yellow-600">
              <AlertTriangle size={13} />
              <span className="font-medium">{t('asset.sslCard.dnsChallengeTitle', { kind: certKindLabel(challengeCert, t) })}</span>
            </div>
            {challengeCertId != null && (
              <button
                type="button"
                onClick={() => setChallengeCertId(null)}
                className="text-xs text-muted-foreground hover:text-foreground-secondary"
              >
                {t('asset.sslCard.hide')}
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            {t('asset.sslCard.dnsChallengeHint')}
          </p>
          <div className="space-y-2">
            {(challengeCert.challenges && challengeCert.challenges.length > 0
              ? challengeCert.challenges
              : [{
                  dns_name: challengeCert.challenge_dns_name || '',
                  dns_value: challengeCert.challenge_dns_value || '',
                }]
            ).map((row, idx) => (
              <div key={`${row.dns_name}-${idx}`} className="rounded-lg bg-muted/50 border border-border px-3 py-2.5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-mono text-xs text-muted-foreground break-all">
                    <span className="text-muted-foreground">TXT </span>
                    {row.dns_name}
                  </p>
                  <CopyButton text={row.dns_name} />
                </div>
                {row.dns_value && (
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-mono text-xs text-foreground-secondary break-all">{row.dns_value}</p>
                    <CopyButton text={row.dns_value} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function ChangeHistoryCard({ snapshots }: { snapshots: Snapshot[] }) {
  const { t } = useTranslation()
  return (
    <InfoCard title={t('asset.changeHistory.title')} icon={History}>
      {snapshots.length === 0 ? (
        <EmptyHint icon={History} title={t('asset.changeHistory.empty.title')} hint={t('asset.changeHistory.empty.hint')} />
      ) : (
        <ul className="space-y-0 max-h-56 overflow-auto">
          {snapshots.slice(0, 12).map((s, i) => (
            <li key={s.id} className="flex gap-3 py-3 border-b border-border last:border-0">
              <div className="flex flex-col items-center">
                <div className="w-2 h-2 rounded-full bg-brand-500 mt-1.5" />
                {i < snapshots.length - 1 && <div className="w-px flex-1 bg-muted mt-1" />}
              </div>
              <div className="flex-1 min-w-0 flex justify-between gap-2">
                <span className="badge badge-info capitalize">{s.type.replace('_', ' ')}</span>
                <span className="text-xs text-muted-foreground shrink-0">{formatDate(s.created_at)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </InfoCard>
  )
}

function CheckPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border ${
      ok
        ? 'bg-green-500/10 text-green-600 border-green-500/30'
        : 'bg-red-500/10 text-red-600 border-red-500/30'
    }`}>
      {label}
    </span>
  )
}

export function EmailSecurityCard({ data }: { data: EmailSecurityData | null }) {
  const { t } = useTranslation()

  const spfStatus = data?.spf?.found
    ? (data.spf.valid ? t('asset.emailSecurity.statusOk') : t('asset.emailSecurity.statusWeak'))
    : t('asset.emailSecurity.statusMissing')
  const dkimStatus = data?.dkim?.found ? t('asset.emailSecurity.statusOk') : t('asset.emailSecurity.statusMissing')
  const dmarcStatus = data?.dmarc?.found
    ? (data.dmarc.policy || t('asset.emailSecurity.statusOk'))
    : t('asset.emailSecurity.statusMissing')

  if (!data) {
    return (
      <InfoCard title={t('asset.emailSecurity.title')} icon={Mail}>
        <EmptyHint icon={Mail} title={t('asset.emailSecurity.empty.title')} hint={t('asset.emailSecurity.empty.hint')} />
      </InfoCard>
    )
  }

  const score = data.score ?? 0
  const scoreColor = score >= 80 ? 'text-green-600' : score >= 50 ? 'text-yellow-600' : 'text-red-600'
  const accent = score >= 80 ? 'green' : score >= 50 ? 'yellow' : 'red'

  return (
    <InfoCard title={t('asset.emailSecurity.title')} icon={Mail} accent={accent}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">{t('asset.emailSecurity.score')}</p>
            <p className={`text-3xl font-bold ${scoreColor}`}>{score}</p>
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            <CheckPill ok={!!data.spf?.found} label={t('asset.emailSecurity.spfLabel', { status: spfStatus })} />
            <CheckPill ok={!!data.dkim?.found} label={t('asset.emailSecurity.dkimLabel', { status: dkimStatus })} />
            <CheckPill
              ok={!!data.dmarc?.found && data.dmarc.policy !== 'none'}
              label={t('asset.emailSecurity.dmarcLabel', { status: dmarcStatus })}
            />
          </div>
        </div>

        {data.dkim?.selectors && data.dkim.selectors.length > 0 && (
          <DetailRow label={t('asset.emailSecurity.dkimSelectors')} value={data.dkim.selectors.join(', ')} />
        )}
        {data.mx_records && data.mx_records.length > 0 && (
          <DetailRow label={t('asset.emailSecurity.mx')} value={data.mx_records.slice(0, 3).join(', ')} />
        )}
        {data.spf?.record && (
          <div>
            <p className="text-xs text-muted-foreground mb-1">{t('asset.emailSecurity.spfRecord')}</p>
            <p className="text-xs font-mono text-muted-foreground break-all bg-muted/50 border border-border rounded-lg p-2">
              {data.spf.record}
            </p>
          </div>
        )}
        {data.recommendations && data.recommendations.length > 0 && (
          <ul className="space-y-1.5">
            {data.recommendations.map((rec, i) => (
              <li key={i} className="text-xs text-yellow-600/90 flex gap-2">
                <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                <span>{rec}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </InfoCard>
  )
}

export function BlacklistCard({ data }: { data: BlacklistData | null }) {
  const { t } = useTranslation()

  if (!data) {
    return (
      <InfoCard title={t('asset.blacklist.title')} icon={Radar}>
        <EmptyHint icon={Radar} title={t('asset.blacklist.empty.title')} hint={t('asset.blacklist.empty.hint')} />
      </InfoCard>
    )
  }

  const listed = data.listings?.filter(l => l.listed) ?? []
  const checked = data.blacklists_checked ?? data.listings?.length ?? 0
  const isListed = !!data.is_listed || listed.length > 0
  const abuse = data.abuseipdb
  const abuseHigh = (abuse?.score ?? 0) >= 50

  return (
    <InfoCard title={t('asset.blacklist.title')} icon={Radar} accent={isListed || abuseHigh ? 'red' : 'green'}>
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center border ${
            isListed || abuseHigh ? 'bg-red-500/10 border-red-500/30' : 'bg-green-500/10 border-green-500/30'
          }`}>
            <span className={`text-sm font-bold ${isListed || abuseHigh ? 'text-red-600' : 'text-green-600'}`}>
              {isListed || abuseHigh ? t('asset.blacklist.listed') : t('asset.blacklist.clean')}
            </span>
          </div>
          <div>
            <p className="text-lg font-semibold">{isListed ? t('asset.blacklist.onBlacklists') : t('asset.blacklist.noListings')}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {t('asset.blacklist.positiveOf', { listed: listed.length, checked })}
              {data.ip ? t('asset.blacklist.ipSuffix', { ip: data.ip }) : ''}
              {data.source === 'extended' ? t('asset.blacklist.sourceIpscope') : ''}
            </p>
          </div>
        </div>

        {abuse && (
          <div className={`rounded-lg border p-3 text-sm ${
            abuseHigh ? 'border-red-500/30 bg-red-500/5' : 'border-border bg-surface'
          }`}>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{t('asset.blacklist.abuseIpdb')}</p>
            <p className={abuseHigh ? 'text-red-600 font-semibold' : 'text-foreground-secondary'}>
              {t('asset.blacklist.abuseScore', { score: abuse.score ?? 0, reports: abuse.totalReports ?? 0 })}
            </p>
          </div>
        )}

        {listed.length > 0 ? (
          <ul className="space-y-2 max-h-48 overflow-auto">
            {listed.map(item => (
              <li key={item.blacklist} className="flex items-center justify-between gap-2 text-sm py-1.5 border-b border-border last:border-0">
                <div className="min-w-0">
                  <span className="font-mono text-xs text-foreground-secondary truncate block">{item.blacklist}</span>
                  {item.category && <span className="text-[10px] text-muted-foreground">{item.category}</span>}
                </div>
                <span className="badge badge-danger text-[10px]">{t('asset.blacklist.listedBadge')}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('asset.blacklist.notListedIn', { count: checked })}</p>
        )}

        {data.fortiguard && (
          <a href={data.fortiguard} target="_blank" rel="noreferrer" className="text-xs text-brand-700 dark:text-brand-400 hover:underline inline-flex items-center gap-1">
            {t('asset.blacklist.viewFortiguard')} <ExternalLink size={10} />
          </a>
        )}
      </div>
    </InfoCard>
  )
}

export function ThreatIntelCard({ data }: { data: HostIntelData | null }) {
  const { t } = useTranslation()

  if (!data) {
    return (
      <InfoCard title={t('asset.threatIntel.title')} icon={Shield}>
        <EmptyHint icon={Shield} title={t('asset.threatIntel.empty.title')} hint={t('asset.threatIntel.empty.hint')} />
      </InfoCard>
    )
  }

  const flags = data.threat_flags || {}
  const flagKeys = ['tor', 'proxy', 'vpn', 'datacenter', 'attacker', 'abuser', 'anonymous', 'bogon'] as const
  const items = flagKeys.map(key => [t(`asset.threatIntel.flags.${key}`), flags[key]] as const)

  return (
    <InfoCard title={t('asset.threatIntel.title')} icon={Shield} accent={data.is_threat ? 'red' : 'green'}>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {data.emoji_flag} {data.ip}
          </p>
          <span className={`badge ${data.is_threat ? 'badge-danger' : 'badge-success'}`}>
            {data.is_threat ? t('asset.threatIntel.threat') : t('asset.threatIntel.clean')}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {items.map(([label, val]) => (
            <div key={label} className="rounded-lg bg-muted/50 border border-border px-2 py-1.5 text-xs flex justify-between">
              <span className="text-muted-foreground">{label}</span>
              <span className={val ? 'text-red-600' : val === false ? 'text-green-600' : 'text-muted-foreground'}>
                {val ? t('asset.threatIntel.yes') : val === false ? t('asset.threatIntel.no') : '—'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </InfoCard>
  )
}

export function TechStackCard({ data }: { data: TechStackData | null }) {
  const { t } = useTranslation()

  if (!data) {
    return (
      <InfoCard title={t('asset.techStack.title')} icon={Server}>
        <EmptyHint icon={Server} title={t('asset.techStack.empty.title')} hint={t('asset.techStack.empty.hint')} />
      </InfoCard>
    )
  }

  const techs = data.technologies ?? []

  return (
    <InfoCard title={t('asset.techStack.title')} icon={Server} accent="brand">
      <div className="space-y-3">
        <DetailRow label={t('asset.techStack.server')} value={data.server || '—'} />
        <DetailRow label={t('asset.techStack.cms')} value={data.cms || '—'} />
        <DetailRow label={t('asset.techStack.cdn')} value={data.cdn || '—'} />
        {data.analytics && data.analytics.length > 0 && (
          <DetailRow label={t('asset.techStack.analytics')} value={data.analytics.join(', ')} />
        )}
        {techs.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {techs.map((tech, i) => {
              const risky = tech.eol || (tech.vulnerabilities ?? 0) > 0
              const tooltip = [
                tech.eol ? t('asset.techStack.eol', { date: tech.eol_date ?? '' }) : tech.outdated ? t('asset.techStack.outdated') : '',
                tech.latest_version ? t('asset.techStack.latest', { version: tech.latest_version }) : '',
                (tech.vulnerabilities ?? 0) > 0 ? `${t('asset.techStack.vulns', { count: tech.vulnerabilities })}: ${(tech.vulnerability_ids ?? []).join(', ')}` : '',
              ].filter(Boolean).join(' · ')
              return (
                <span
                  key={`${tech.name}-${i}`}
                  title={tooltip || undefined}
                  className={`badge text-[10px] ${risky ? 'badge-danger' : tech.outdated ? 'badge-warning' : 'badge-info'}`}
                >
                  {tech.name}{tech.version ? ` ${tech.version}` : ''}{tech.category ? ` · ${tech.category}` : ''}
                  {tech.eol ? ` · ${t('asset.techStack.eolShort')}` : ''}
                  {(tech.vulnerabilities ?? 0) > 0 ? ` · ${t('asset.techStack.vulns', { count: tech.vulnerabilities })}` : ''}
                </span>
              )
            })}
          </div>
        )}
      </div>
    </InfoCard>
  )
}

export type MonitorMethodValue = 'http' | 'ping' | 'tcp' | 'dns' | 'ssl'
const MONITOR_METHODS: MonitorMethodValue[] = ['http', 'ping', 'tcp', 'dns', 'ssl']

export function MonitorCard({ health, lastScannedAt, nextScanAt, method, port, onChangeMethod }: {
  health: {
    is_up: boolean
    status_code?: number | null
    response_time_ms?: number | null
    ssl_valid?: boolean | null
    checked_at?: string
  } | null
  lastScannedAt?: string | null
  nextScanAt?: string | null
  method?: MonitorMethodValue
  port?: number | null
  onChangeMethod?: (method: MonitorMethodValue, port: number | null) => void
}) {
  const { t } = useTranslation()
  const lastScan = lastScannedAt || health?.checked_at || null
  const [portDraft, setPortDraft] = useState(port ? String(port) : '')
  const needsPort = method === 'tcp' || method === 'ssl'
  const methodSelector = onChangeMethod && method ? (
    <div className="rounded-lg bg-muted/50 border border-border p-3 space-y-2">
      <label className="text-xs text-muted-foreground uppercase tracking-wide">{t('asset.monitor.method.label')}</label>
      <div className="flex gap-2">
        <select
          className="input flex-1"
          value={method}
          onChange={e => onChangeMethod(e.target.value as MonitorMethodValue, port ?? null)}
        >
          {MONITOR_METHODS.map(m => (
            <option key={m} value={m}>{t(`asset.monitor.method.${m}`)}</option>
          ))}
        </select>
        {needsPort && (
          <input
            className="input w-24"
            type="number"
            min={1}
            max={65535}
            placeholder="443"
            value={portDraft}
            onChange={e => setPortDraft(e.target.value)}
            onBlur={() => onChangeMethod(method, portDraft ? Number(portDraft) : null)}
          />
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t('asset.monitor.method.hint')}</p>
    </div>
  ) : null
  return (
    <InfoCard title={t('asset.monitor.title')} icon={Activity} accent={health ? (health.is_up ? 'green' : 'red') : undefined}>
      <div className="space-y-5">
      {methodSelector}
      {health ? (
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <div className={`relative w-16 h-16 rounded-2xl flex items-center justify-center ${
              health.is_up ? 'bg-green-500/10 border border-green-500/30' : 'bg-red-500/10 border border-red-500/30'
            }`}>
              {health.is_up && (
                <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              )}
              <span className={`text-lg font-bold ${health.is_up ? 'text-green-600' : 'text-red-600'}`}>
                {health.is_up ? t('asset.monitor.up') : t('asset.monitor.down')}
              </span>
            </div>
            <div>
              <p className="text-2xl font-bold">{health.is_up ? t('asset.monitor.online') : t('asset.monitor.offline')}</p>
              {lastScan && (
                <p className="text-xs text-muted-foreground mt-1">{t('asset.monitor.lastScanAt', { date: formatDateTime(lastScan) })}</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <MetricBox label={t('asset.monitor.http')} value={health.status_code?.toString() ?? '—'} />
            <MetricBox label={t('asset.monitor.latency')} value={health.response_time_ms != null ? `${health.response_time_ms}ms` : '—'} />
            <MetricBox
              label={t('asset.monitor.ssl')}
              value={health.ssl_valid == null ? '—' : health.ssl_valid ? t('asset.monitor.sslValid') : t('asset.monitor.sslInvalid')}
              highlight={health.ssl_valid === false ? 'danger' : health.ssl_valid ? 'success' : undefined}
            />
          </div>
          <div className="rounded-lg bg-muted/50 border border-border p-3 space-y-2">
            <DetailRow label={t('asset.monitor.lastScanField')} value={formatDateTime(lastScan)} />
            <DetailRow label={t('asset.monitor.nextScanField')} value={formatDateTime(nextScanAt)} />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <EmptyHint icon={Activity} title={t('asset.monitor.empty.title')} hint={t('asset.monitor.empty.hint')} />
          <div className="rounded-lg bg-muted/50 border border-border p-3 space-y-2">
            <DetailRow label={t('asset.monitor.lastScanField')} value={formatDateTime(lastScan)} />
            <DetailRow label={t('asset.monitor.nextScanField')} value={formatDateTime(nextScanAt)} />
          </div>
        </div>
      )}
      </div>
    </InfoCard>
  )
}

function MetricBox({ label, value, highlight }: { label: string; value: string; highlight?: 'success' | 'danger' }) {
  const valueColor = highlight === 'success' ? 'text-green-600' : highlight === 'danger' ? 'text-red-600' : 'text-foreground'
  return (
    <div className="rounded-lg bg-muted/50 border border-border p-3 text-center">
      <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-sm font-semibold mt-1 ${valueColor}`}>{value}</p>
    </div>
  )
}

export function ExternalToolsGrid({ hostname }: { hostname: string }) {
  const { t } = useTranslation()
  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">{t('asset.externalTools.title')}</h2>
      <p className="text-sm text-muted-foreground mb-4">{t('asset.externalTools.subtitle')}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {EXTERNAL_TOOLS.map(tool => (
          <a
            key={tool.id}
            href={tool.url(hostname)}
            target="_blank"
            rel="noreferrer"
            className="group rounded-xl border border-border bg-surface p-4 hover:border-brand-500/40 hover:bg-brand-50 dark:hover:bg-brand-950/20 dark:bg-brand-950/30 transition-all"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium text-sm group-hover:text-brand-700 dark:text-brand-400 transition-colors">{t(tool.nameKey)}</p>
              <ExternalLink size={14} className="text-muted-foreground group-hover:text-brand-700 dark:text-brand-400 shrink-0 transition-colors" />
            </div>
            <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{t(tool.descriptionKey)}</p>
          </a>
        ))}
      </div>
    </div>
  )
}

export function IpList({ ipv4, ipv6 }: { ipv4: string[]; ipv6: string[] }) {
  const { t } = useTranslation()

  if (ipv4.length === 0 && ipv6.length === 0) {
    return <EmptyHint title={t('asset.ipList.empty.title')} hint={t('asset.ipList.empty.hint')} />
  }
  return (
    <div className="space-y-3">
      {ipv4.map(ip => (
        <div key={ip} className="flex items-center gap-2 font-mono text-sm">
          <span className="badge badge-info text-[10px]">{t('asset.ipList.ipv4')}</span>
          <span className="text-foreground">{ip}</span>
        </div>
      ))}
      {ipv6.map(ip => (
        <div key={ip} className="flex items-center gap-2 font-mono text-xs">
          <span className="badge badge-info text-[10px]">{t('asset.ipList.ipv6')}</span>
          <span className="text-muted-foreground break-all">{ip}</span>
        </div>
      ))}
    </div>
  )
}

export function SubdomainCard({
  hostname,
  to,
  autoDiscovered,
  sslStatus,
  onDelete,
}: {
  hostname: string
  to: string
  autoDiscovered: boolean
  sslStatus?: string | null
  onDelete: () => void
}) {
  const { t } = useTranslation()

  return (
    <Link
      to={to}
      className="group block rounded-xl border border-border bg-surface p-4 hover:border-brand-500/40 hover:bg-brand-50 dark:hover:bg-brand-950/20 dark:bg-brand-950/30 transition-all"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-sm truncate group-hover:text-brand-700 dark:text-brand-400 transition-colors">{hostname}</p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <span className={`badge ${autoDiscovered ? 'badge-info' : 'badge-success'}`}>
              {autoDiscovered ? t('asset.subdomainCard.discovered') : t('asset.subdomainCard.manual')}
            </span>
            {sslStatus && (
              <span className={`badge ${sslStatus === 'valid' ? 'badge-success' : 'badge-warning'}`}>
                {t('asset.subdomainCard.sslLabel', { status: sslStatus })}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={e => { e.preventDefault(); onDelete() }}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 dark:bg-red-950/30 transition-colors"
          aria-label={t('asset.subdomainCard.deleteAriaLabel', { hostname })}
        >
          <Trash2 size={14} />
        </button>
      </div>
      <p className="text-xs text-muted-foreground mt-3 group-hover:text-brand-500/70 transition-colors">{t('asset.subdomainCard.viewDetails')}</p>
    </Link>
  )
}
