import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Building2, Calendar, ExternalLink, Globe, Mail, MapPin, Radar, RefreshCw, Server, Shield, Trash2,
} from 'lucide-react'
import { api, SSLCertificate } from '../api'
import {
  ActionButton, AssetHero, Breadcrumbs, DetailLoading, DetailNotFound,
  ErrorBanner, QuickStat, StatusBadge,
} from '../components/asset/AssetDetailLayout'
import {
  BlacklistCard, ChangeHistoryCard, DetailRow, DnsRecordsPanel, EmailSecurityCard,
  ExternalToolsGrid, InfoCard, IpList, MonitorCard, SSLCard, TechStackCard, ThreatIntelCard,
} from '../components/asset/AssetDetailParts'
import { useSubdomain, useSubdomainMutations } from '../hooks'
import { formatDate, formatDateTime } from '../utils/domainValidation'
import {
  parseBlacklists, parseDnsRecords, parseEmailSecurity, parseHealth, parseHostIntel, parseProviders, parseTechStack,
  Snapshot, latestSnapshot,
} from '../utils/snapshotData'

export default function SubdomainDetail() {
  const { t } = useTranslation()
  const { domainId, subdomainId } = useParams()
  const navigate = useNavigate()
  const parentId = domainId ? Number(domainId) : undefined
  const subId = subdomainId ? Number(subdomainId) : undefined

  const { data: subdomain, loading, error: loadError, reload: reloadSub } = useSubdomain(subId)
  const { mutating, error: mutationError, remove, scan } = useSubdomainMutations({
    onSuccess: () => { reloadSub(); reloadSnapshots() },
  })

  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [sslCerts, setSslCerts] = useState<SSLCertificate[]>([])
  const [sslBusy, setSslBusy] = useState(false)

  const reloadSnapshots = () => {
    if (!subId) return
    api.subdomains.snapshots(subId).then((data) => setSnapshots(data as Snapshot[])).catch(console.error)
  }

  const reloadSsl = () => {
    if (!parentId || !subdomain?.hostname) return
    api.ssl.list(parentId).then(certs => {
      setSslCerts(certs.filter(c =>
        c.status !== 'revoked'
        && c.acme_status !== 'revoked'
        && (c.subdomain_id === subId || c.hostname === subdomain.hostname)
      ))
    }).catch(console.error)
  }

  useEffect(() => { reloadSnapshots() }, [subId])
  useEffect(() => { reloadSsl() }, [parentId, subdomain?.hostname, subId])

  const scanning = mutating || sslBusy
  const error = loadError || mutationError
  const dnsRecords = parseDnsRecords(snapshots)
  const liveSsl = latestSnapshot(snapshots, 'ssl')
  const techStack = parseTechStack(snapshots)
  const emailSecurity = parseEmailSecurity(snapshots)
  const blacklists = parseBlacklists(snapshots)
  const hostIntel = parseHostIntel(snapshots)
  const providers = parseProviders(snapshots)
  const health = parseHealth(snapshots)
  const ipv4 = dnsRecords.filter(r => r.type === 'A').map(r => r.value)
  const ipv6 = dnsRecords.filter(r => r.type === 'AAAA').map(r => r.value)
  const sslCert = sslCerts.find(c => c.issued && c.status !== 'revoked') || sslCerts[0] || null

  const handleScan = () => { if (subId) scan(subId) }

  const handleDelete = async () => {
    if (!subId || !subdomain || !confirm(t('domains.subdomainDetail.deleteConfirm', { hostname: subdomain.hostname }))) return
    const ok = await remove(subId)
    if (ok !== null) navigate(`/domains/${parentId}`)
  }

  const handleSslGenerate = async (opts: {
    issuer_type: 'letsencrypt' | 'self_signed'
    wildcard?: boolean
    validity_days?: number
    auto_renew?: boolean
  }) => {
    if (!subdomain) return
    setSslBusy(true)
    try {
      await api.ssl.request({
        hostname: subdomain.hostname,
        domain_id: parentId,
        subdomain_id: subId,
        auto_renew: opts.auto_renew ?? subdomain.ssl_auto_renew,
        issuer_type: opts.issuer_type,
        validity_days: opts.validity_days,
        wildcard: false,
      })
      reloadSsl()
    } catch (e) { console.error(e) }
    setSslBusy(false)
  }

  const handleSslRenew = async (certId: number) => {
    setSslBusy(true)
    try { await api.ssl.renew(certId); reloadSsl() } catch (e) { console.error(e) }
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

  if (loading) return <DetailLoading label={t('domains.subdomainDetail.loading')} />
  if (!subdomain) return (
    <DetailNotFound
      label={t('domains.subdomainDetail.notFound')}
      backTo={`/domains/${parentId}`}
      backLabel={t('domains.subdomainDetail.backToDomain')}
    />
  )

  const parentName = subdomain.domain_name || 'domain'
  const sslDays = sslCert?.days_remaining ?? subdomain.latest_ssl?.days_remaining
  const sslStatus = sslCert?.status || subdomain.latest_ssl?.status

  return (
    <div className="space-y-6 max-w-7xl">
      <Breadcrumbs items={[
        { label: t('domains.subdomainDetail.breadcrumbHome'), to: '/backoffice' },
        { label: t('domains.subdomainDetail.breadcrumbDomains'), to: '/domains' },
        { label: parentName, to: `/domains/${parentId}` },
        { label: subdomain.hostname },
      ]} />

      <AssetHero
        favicon={`https://www.google.com/s2/favicons?domain=${subdomain.hostname}&sz=64`}
        title={subdomain.hostname}
        subtitle={
          <>
            {t('domains.subdomainDetail.subdomainOf')}{' '}
            <Link to={`/domains/${parentId}`} className="text-brand-700 dark:text-brand-400 hover:underline">{parentName}</Link>
          </>
        }
        badges={
          <>
            <StatusBadge
              label={subdomain.is_active ? t('asset.badges.active') : t('asset.badges.inactive')}
              variant={subdomain.is_active ? 'success' : 'danger'}
            />
            <StatusBadge
              label={subdomain.auto_discovered ? t('asset.badges.discovered') : t('asset.badges.manual')}
              variant="info"
            />
            {sslStatus && (
              <StatusBadge
                label={t('asset.badges.ssl', { status: sslStatus })}
                variant={sslStatus === 'valid' ? 'success' : 'warning'}
              />
            )}
            {health && (
              <StatusBadge
                label={health.is_up ? t('asset.badges.online') : t('asset.badges.offline')}
                variant={health.is_up ? 'success' : 'danger'}
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
          </>
        }
        actions={
          <>
            <ActionButton onClick={handleDelete} danger>
              <Trash2 size={15} /> {t('common.delete')}
            </ActionButton>
            <ActionButton href={`https://${subdomain.hostname}`}>
              <ExternalLink size={15} /> {t('domains.subdomainDetail.visit')}
            </ActionButton>
            <ActionButton onClick={handleScan} disabled={scanning} variant="primary">
              <RefreshCw size={15} className={scanning ? 'animate-spin' : ''} /> {t('domains.subdomainDetail.scan')}
            </ActionButton>
          </>
        }
      />

      {error && <ErrorBanner message={error} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <QuickStat
          label={t('asset.quickStats.health')}
          value={health ? (health.is_up ? t('common.online') : t('common.offline')) : '—'}
          sub={health?.response_time_ms != null ? `${health.response_time_ms}ms` : undefined}
          icon={Globe}
          accent={!health ? 'brand' : health.is_up ? 'green' : 'red'}
        />
        <QuickStat
          label={t('asset.quickStats.ssl')}
          value={sslStatus || t('asset.quickStats.unknown')}
          sub={sslDays != null ? t('asset.quickStats.daysLeft', { count: sslDays }) : undefined}
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
              certs={sslCerts}
              hostname={subdomain.hostname}
              liveSsl={liveSsl}
              busy={sslBusy}
              onGenerate={handleSslGenerate}
              onRenew={handleSslRenew}
              onDownload={handleSslDownload}
              onComplete={handleSslComplete}
              onRetry={handleSslRetry}
              onRevoke={handleSslRevoke}
            />
          </InfoCard>

          <InfoCard title={t('domains.detail.sections.dnsRecords')} icon={Server}>
            <DnsRecordsPanel records={dnsRecords} hostname={subdomain.hostname} />
          </InfoCard>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <EmailSecurityCard data={emailSecurity} />
            <BlacklistCard data={blacklists} />
          </div>

          <ThreatIntelCard data={hostIntel} />

          <TechStackCard data={techStack} />
        </div>

        <div className="space-y-4">
          <InfoCard title={t('domains.subdomainDetail.status.title')} icon={Building2}>
            <DetailRow label={t('domains.subdomainDetail.status.active')} value={subdomain.is_active ? t('common.yes') : t('common.no')} />
            <DetailRow label={t('domains.subdomainDetail.status.source')} value={subdomain.auto_discovered ? t('asset.badges.discovered') : t('asset.badges.manual')} />
            <DetailRow label={t('domains.subdomainDetail.status.sslMonitor')} value={subdomain.ssl_monitor ? t('common.enabled') : t('common.disabled')} />
            <DetailRow label={t('domains.subdomainDetail.status.autoRenew')} value={subdomain.ssl_auto_renew ? t('common.enabled') : t('common.disabled')} />
          </InfoCard>

          <InfoCard title={t('domains.detail.sections.dates')} icon={Calendar}>
            <DetailRow label={t('domains.subdomainDetail.fields.sslExpiry')} value={sslCert?.valid_until ? formatDate(sslCert.valid_until) : '—'} />
            <DetailRow label={t('domains.subdomainDetail.fields.created')} value={formatDate(subdomain.created_at)} />
            <DetailRow label={t('domains.detail.fields.lastScan')} value={formatDateTime(subdomain.last_scanned_at || subdomain.updated_at)} />
            <DetailRow label={t('domains.detail.fields.nextScan')} value={formatDateTime(subdomain.next_scan_at)} />
          </InfoCard>

          {subdomain.notes && (
            <InfoCard title={t('domains.subdomainDetail.notesTitle')} icon={Globe}>
              <p className="text-sm text-muted-foreground leading-relaxed">{subdomain.notes}</p>
            </InfoCard>
          )}

          <InfoCard title={t('domains.detail.sections.ipAddresses')} icon={Globe}>
            <IpList ipv4={ipv4} ipv6={ipv6} />
          </InfoCard>

          <InfoCard title={t('asset.hostInfo.title')} icon={MapPin}>
            {hostIntel ? (
              <>
                <DetailRow label={t('asset.hostInfo.isp')} value={hostIntel.isp || hostIntel.org || hostIntel.asn?.name || '—'} />
                <DetailRow label={t('asset.hostInfo.asn')} value={hostIntel.asn?.asn || '—'} />
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

          <InfoCard title={t('domains.subdomainDetail.parentDomain')} icon={Building2}>
            <Link to={`/domains/${parentId}`} className="text-brand-700 dark:text-brand-400 hover:underline font-medium">
              {parentName}
            </Link>
            <p className="text-xs text-muted-foreground mt-2">{t('domains.subdomainDetail.viewFullDashboard')}</p>
          </InfoCard>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MonitorCard
          health={health}
          lastScannedAt={subdomain.last_scanned_at || subdomain.updated_at}
          nextScanAt={subdomain.next_scan_at}
        />
        <ChangeHistoryCard snapshots={snapshots} />
      </div>

      <ExternalToolsGrid hostname={subdomain.hostname} />
    </div>
  )
}
