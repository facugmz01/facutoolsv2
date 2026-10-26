import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Building2, Calendar, ChevronDown, ChevronUp, ExternalLink, Globe, Mail, MapPin,
  Plus, Radar, RefreshCw, Server, Shield, Trash2,
} from 'lucide-react'
import { api, SSLCertificate } from '../api'
import {
  ActionButton, AssetHero, Breadcrumbs, DetailLoading, DetailNotFound,
  ErrorBanner, QuickStat, SectionHeader, StatusBadge,
} from '../components/asset/AssetDetailLayout'
import {
  BlacklistCard, ChangeHistoryCard, DetailRow, DnsRecordsPanel, EmailSecurityCard,
  InfoCard, IpList, MonitorCard, SSLCard, SubdomainCard, TechStackCard, ThreatIntelCard,
} from '../components/asset/AssetDetailParts'
import { useDomain, useDomainMutations, useSubdomains, useSubdomainMutations } from '../hooks'
import DomainSettingsCard from '../components/asset/DomainSettingsCard'
import DomainNotificationsCard from '../components/asset/DomainNotificationsCard'
import { formatDate, formatDateTime } from '../utils/domainValidation'
import {
  parseBlacklists, parseDnsRecords, parseEmailSecurity, parseHostIntel, parseProviders, parseTechStack, Snapshot, latestSnapshot,
} from '../utils/snapshotData'

export default function DomainDetail() {
  const { t } = useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()
  const domainId = id ? Number(id) : undefined

  const { data: domain, loading: domainLoading, error: domainError, reload: reloadDomain } = useDomain(domainId)
  const { data: subdomains, loading: subsLoading, error: subsError, reload: reloadSubdomains } = useSubdomains(domainId)
  const { scanningId, error: scanError, scan: scanDomain, remove: removeDomain } = useDomainMutations({
    onSuccess: () => { reloadDomain(); reloadSnapshots() },
  })
  const { mutating: subsMutating, error: subsMutationError, create, discover, remove: removeSub } = useSubdomainMutations({
    onSuccess: reloadSubdomains,
  })

  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [sslCerts, setSslCerts] = useState<SSLCertificate[]>([])
  const [sslBusy, setSslBusy] = useState(false)
  const [showAllSubs, setShowAllSubs] = useState(false)
  const [newSubdomain, setNewSubdomain] = useState('')
  const [showAddSub, setShowAddSub] = useState(false)

  const reloadSnapshots = () => {
    if (!domainId) return
    api.domains.snapshots(domainId).then((data) => setSnapshots(data as Snapshot[])).catch(console.error)
  }

  const reloadSsl = () => {
    if (!domainId) return
    api.ssl.list(domainId).then(setSslCerts).catch(console.error)
  }

  useEffect(() => {
    reloadSnapshots()
    reloadSsl()
  }, [domainId])

  const scanning = scanningId != null || subsMutating || sslBusy
  const loading = domainLoading || subsLoading
  const error = domainError || subsError || scanError || subsMutationError
  const subs = subdomains ?? []

  const whois = latestSnapshot(snapshots, 'whois')
  const dnsRecords = parseDnsRecords(snapshots)
  const liveSsl = latestSnapshot(snapshots, 'ssl')
  const emailSecurity = parseEmailSecurity(snapshots)
  const blacklists = parseBlacklists(snapshots)
  const techStack = parseTechStack(snapshots)
  const hostIntel = parseHostIntel(snapshots)
  const providers = parseProviders(snapshots)
  const hostCerts = sslCerts.filter(c =>
    c.status !== 'revoked'
    && c.acme_status !== 'revoked'
    && !c.subdomain_id
    && (
      c.hostname === domain?.name ||
      c.hostname === `*.${domain?.name}` ||
      (c.managed && c.domain_id === domainId)
    )
  )
  const domainCert =
    hostCerts.find(c => c.issued && c.status !== 'revoked') ||
    hostCerts.find(c => c.hostname === `*.${domain?.name}`) ||
    hostCerts.find(c => c.hostname === domain?.name) ||
    hostCerts[0] ||
    null
  const ipv4 = dnsRecords.filter(r => r.type === 'A').map(r => r.value)
  const ipv6 = dnsRecords.filter(r => r.type === 'AAAA').map(r => r.value)

  const handleScan = () => { if (domainId) scanDomain(domainId) }

  const handleDelete = async () => {
    if (!domainId || !confirm(t('domains.detail.deleteConfirm', { name: domain?.name }))) return
    const ok = await removeDomain(domainId)
    if (ok !== null) navigate('/domains')
  }

  const handleSslGenerate = async (opts: {
    issuer_type: 'letsencrypt' | 'self_signed'
    wildcard?: boolean
    validity_days?: number
    auto_renew?: boolean
  }) => {
    if (!domain) return
    setSslBusy(true)
    try {
      await api.ssl.request({
        hostname: domain.name,
        domain_id: domainId,
        auto_renew: opts.auto_renew ?? true,
        wildcard: opts.wildcard ?? false,
        issuer_type: opts.issuer_type,
        validity_days: opts.validity_days,
      })
      reloadSsl()
    } catch (e) {
      console.error(e)
      alert(e instanceof Error ? e.message : t('errors.sslRequestFailed'))
    }
    setSslBusy(false)
  }

  const handleSslRenew = async (certId: number) => {
    setSslBusy(true)
    try { await api.ssl.renew(certId); reloadSsl() } catch (e) {
      console.error(e)
      alert(e instanceof Error ? e.message : t('errors.renewFailed'))
    }
    setSslBusy(false)
  }

  const handleSslDownload = (certId: number) => { api.ssl.download(certId) }

  const handleSslComplete = async (certId: number) => {
    setSslBusy(true)
    try { await api.ssl.complete(certId); reloadSsl() } catch (e) {
      console.error(e)
      reloadSsl()
      alert(e instanceof Error ? e.message : t('errors.completeFailed'))
    }
    setSslBusy(false)
  }

  const handleSslRetry = async (certId: number) => {
    setSslBusy(true)
    try { await api.ssl.retry(certId); reloadSsl() } catch (e) {
      console.error(e)
      reloadSsl()
      alert(e instanceof Error ? e.message : t('errors.retryFailed'))
    }
    setSslBusy(false)
  }

  const handleSslRevoke = async (certId: number) => {
    setSslBusy(true)
    try { await api.ssl.revoke(certId); reloadSsl() } catch (e) {
      console.error(e)
      alert(e instanceof Error ? e.message : t('errors.revokeFailed'))
    }
    setSslBusy(false)
  }

  const handleAddSubdomain = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!domainId || !newSubdomain) return
    const result = await create(domainId, { hostname: newSubdomain, ssl_monitor: true })
    if (result) { setNewSubdomain(''); setShowAddSub(false) }
  }

  if (loading) return <DetailLoading label={t('domains.detail.loading')} />
  if (!domain) return (
    <DetailNotFound
      label={t('domains.detail.notFound')}
      backTo="/domains"
      backLabel={t('domains.detail.backToDomains')}
    />
  )

  const visibleSubs = showAllSubs ? subs : subs.slice(0, 6)
  const healthUp = domain.latest_health?.is_up
  const sslStatus = domainCert?.status || (liveSsl?.is_valid ? 'valid' : null)

  return (
    <div className="space-y-6 max-w-7xl">
      <Breadcrumbs items={[
        { label: t('domains.detail.breadcrumbHome'), to: '/backoffice' },
        { label: t('domains.detail.breadcrumbDomains'), to: '/domains' },
        { label: domain.name },
      ]} />

      <AssetHero
        favicon={`https://www.google.com/s2/favicons?domain=${domain.name}&sz=64`}
        title={domain.name}
        subtitle={domain.registrar || t('common.unknownRegistrar')}
        badges={
          <>
            {healthUp != null && (
              <StatusBadge
                label={healthUp ? t('asset.badges.online') : t('asset.badges.offline')}
                variant={healthUp ? 'success' : 'danger'}
              />
            )}
            {sslStatus && (
              <StatusBadge
                label={t('asset.badges.ssl', { status: sslStatus })}
                variant={sslStatus === 'valid' ? 'success' : 'warning'}
              />
            )}
            {emailSecurity && (
              <StatusBadge
                label={t('asset.badges.email', { score: emailSecurity.score ?? 0 })}
                variant={(emailSecurity.score ?? 0) >= 80 ? 'success' : (emailSecurity.score ?? 0) >= 50 ? 'warning' : 'danger'}
              />
            )}
            {blacklists && (
              <StatusBadge
                label={blacklists.is_listed ? t('asset.badges.blacklisted') : t('asset.badges.clean')}
                variant={blacklists.is_listed ? 'danger' : 'success'}
              />
            )}
            {domain.days_until_expiry != null && (
              <StatusBadge
                label={t('asset.badges.expiresIn', { count: domain.days_until_expiry })}
                variant={domain.days_until_expiry <= 30 ? 'warning' : 'info'}
              />
            )}
            <StatusBadge label={domain.status} variant="neutral" />
          </>
        }
        actions={
          <>
            <ActionButton onClick={handleDelete} danger>
              <Trash2 size={15} /> {t('common.delete')}
            </ActionButton>
            <ActionButton href={`https://${domain.name}`}>
              <ExternalLink size={15} /> {t('domains.detail.visit')}
            </ActionButton>
            <ActionButton onClick={handleScan} disabled={scanning} variant="primary">
              <RefreshCw size={15} className={scanning ? 'animate-spin' : ''} /> {t('domains.detail.scan')}
            </ActionButton>
          </>
        }
      />

      {error && <ErrorBanner message={error} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <QuickStat
          label={t('asset.quickStats.health')}
          value={healthUp == null ? '—' : healthUp ? t('common.online') : t('common.offline')}
          sub={domain.latest_health?.response_time_ms != null ? `${domain.latest_health.response_time_ms}ms` : undefined}
          icon={Globe}
          accent={healthUp == null ? 'brand' : healthUp ? 'green' : 'red'}
        />
        <QuickStat
          label={t('asset.quickStats.ssl')}
          value={sslStatus || t('asset.quickStats.unknown')}
          sub={domainCert?.days_remaining != null ? t('asset.quickStats.daysLeft', { count: domainCert.days_remaining }) : undefined}
          icon={Shield}
          accent={sslStatus === 'valid' ? 'green' : sslStatus ? 'yellow' : 'brand'}
        />
        <QuickStat
          label={t('asset.quickStats.emailSecurity')}
          value={emailSecurity ? String(emailSecurity.score ?? 0) : '—'}
          sub={emailSecurity ? t('asset.quickStats.spfDkimDmarc') : t('asset.quickStats.notScanned')}
          icon={Mail}
          accent={
            !emailSecurity ? 'brand'
              : (emailSecurity.score ?? 0) >= 80 ? 'green'
                : (emailSecurity.score ?? 0) >= 50 ? 'yellow' : 'red'
          }
        />
        <QuickStat
          label={t('asset.quickStats.blacklists')}
          value={!blacklists ? '—' : blacklists.is_listed ? t('asset.quickStats.listed') : t('asset.quickStats.clean')}
          sub={blacklists ? t('asset.quickStats.checkedCount', { count: blacklists.blacklists_checked ?? 0 }) : t('asset.quickStats.notScanned')}
          icon={Radar}
          accent={!blacklists ? 'brand' : blacklists.is_listed ? 'red' : 'green'}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-4">
          <InfoCard title={t('domains.detail.sections.sslCertificate')} icon={Shield} accent="brand">
            <SSLCard
              certs={hostCerts}
              hostname={domain.name}
              liveSsl={liveSsl}
              busy={sslBusy}
              allowWildcard
              onGenerate={handleSslGenerate}
              onRenew={handleSslRenew}
              onDownload={handleSslDownload}
              onComplete={handleSslComplete}
              onRetry={handleSslRetry}
              onRevoke={handleSslRevoke}
            />
          </InfoCard>

          <InfoCard title={t('domains.detail.sections.dnsRecords')} icon={Server}>
            <DnsRecordsPanel records={dnsRecords} hostname={domain.name} />
          </InfoCard>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <EmailSecurityCard data={emailSecurity} />
            <BlacklistCard data={blacklists} />
          </div>

          <ThreatIntelCard data={hostIntel} />

          <TechStackCard data={techStack} />
        </div>

        <div className="space-y-4">
          <DomainSettingsCard domain={domain} onSaved={reloadDomain} />

          <DomainNotificationsCard domainId={domain.id} />

          <InfoCard title={t('domains.detail.sections.registrar')} icon={Building2}>
            <p className="text-base font-semibold text-foreground">{domain.registrar || whois?.registrar as string || '—'}</p>
            {typeof whois?.registrant === 'string' && whois.registrant && (
              <p className="text-sm text-muted-foreground mt-2">{whois.registrant}</p>
            )}
          </InfoCard>

          <InfoCard title={t('domains.detail.sections.dates')} icon={Calendar}>
            <DetailRow label={t('domains.detail.fields.expiry')} value={domain.expires_at ? formatDate(domain.expires_at) : '—'} />
            <DetailRow label={t('domains.detail.fields.registration')} value={whois?.creation_date ? formatDate(whois.creation_date as string) : '—'} />
            <DetailRow label={t('domains.detail.fields.lastScan')} value={formatDateTime(domain.last_scanned_at || domain.latest_health?.checked_at)} />
            <DetailRow label={t('domains.detail.fields.nextScan')} value={formatDateTime(domain.next_scan_at)} />
          </InfoCard>

          <InfoCard title={t('domains.detail.sections.ipAddresses')} icon={Globe}>
            <IpList ipv4={ipv4} ipv6={ipv6} />
          </InfoCard>

          <InfoCard title={t('asset.hostInfo.title')} icon={MapPin}>
            {hostIntel ? (
              <>
                <DetailRow label={t('asset.hostInfo.isp')} value={hostIntel.isp || hostIntel.org || hostIntel.asn?.name || '—'} />
                <DetailRow label={t('asset.hostInfo.asn')} value={hostIntel.asn?.asn || '—'} />
                <DetailRow label={t('asset.hostInfo.type')} value={hostIntel.asn?.type || '—'} />
                <DetailRow
                  label={t('asset.hostInfo.location')}
                  value={[hostIntel.city, hostIntel.region, hostIntel.country_name].filter(Boolean).join(', ') || '—'}
                />
                <DetailRow label={t('asset.hostInfo.server')} value={techStack?.server || '—'} />
                <DetailRow label={t('asset.hostInfo.cdn')} value={techStack?.cdn || '—'} />
              </>
            ) : (
              <>
                <DetailRow label={t('asset.hostInfo.server')} value={techStack?.server || '—'} />
                <DetailRow label={t('asset.hostInfo.cdn')} value={techStack?.cdn || '—'} />
                <DetailRow label={t('asset.hostInfo.cms')} value={techStack?.cms || '—'} />
              </>
            )}
            {providers.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-xs text-muted-foreground mb-2">{t('asset.hostInfo.detectedProviders')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {providers.map((p, i) => (
                    <span key={i} className="badge badge-info text-[10px]">{p.name}</span>
                  ))}
                </div>
              </div>
            )}
          </InfoCard>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MonitorCard
          health={domain.latest_health}
          lastScannedAt={domain.last_scanned_at}
          nextScanAt={domain.next_scan_at}
          method={domain.monitor_method ?? 'http'}
          port={domain.monitor_port}
          onChangeMethod={async (monitor_method, monitor_port) => {
            if (!domainId) return
            try {
              await api.domains.update(domainId, { monitor_method, monitor_port })
              reloadDomain()
            } catch (e) {
              alert(e instanceof Error ? e.message : String(e))
            }
          }}
        />
        <ChangeHistoryCard snapshots={snapshots} />
      </div>

      <div className="card">
        <SectionHeader
          title={t('domains.detail.subdomainsSection.title', { count: subs.length })}
          description={t('domains.detail.subdomainsSection.description')}
          action={
            <div className="flex gap-2">
              <button onClick={() => domainId && discover(domainId)} disabled={scanning} className="btn-secondary text-sm flex items-center gap-1.5">
                <Radar size={14} /> {t('domains.detail.subdomainsSection.discover')}
              </button>
              <button onClick={() => setShowAddSub(v => !v)} className="btn-primary text-sm flex items-center gap-1.5">
                <Plus size={14} /> {t('domains.detail.subdomainsSection.add')}
              </button>
            </div>
          }
        />

        {showAddSub && (
          <form onSubmit={handleAddSubdomain} className="flex gap-2 mb-4">
            <input
              className="input flex-1"
              placeholder={t('domains.detail.subdomainsSection.addPlaceholder')}
              value={newSubdomain}
              onChange={e => setNewSubdomain(e.target.value)}
              required
            />
            <button type="submit" className="btn-primary text-sm">{t('common.add')}</button>
          </form>
        )}

        {subs.length === 0 ? (
          <p className="text-muted-foreground text-center py-8 text-sm">{t('domains.detail.subdomainsSection.empty')}</p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {visibleSubs.map(sub => (
                <SubdomainCard
                  key={sub.id}
                  hostname={sub.hostname}
                  to={`/domains/${domainId}/subdomains/${sub.id}`}
                  autoDiscovered={sub.auto_discovered}
                  sslStatus={sub.latest_ssl?.status}
                  onDelete={() => removeSub(sub.id)}
                />
              ))}
            </div>
            {subs.length > 6 && (
              <button onClick={() => setShowAllSubs(v => !v)} className="mt-4 text-sm text-brand-700 dark:text-brand-400 hover:underline flex items-center gap-1 mx-auto">
                {showAllSubs ? (
                  <><ChevronUp size={14} /> {t('domains.detail.subdomainsSection.showLess')}</>
                ) : (
                  <><ChevronDown size={14} /> {t('domains.detail.subdomainsSection.showAll', { count: subs.length })}</>
                )}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
