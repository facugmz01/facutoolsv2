import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, DnsCheckResult, DnsRecord } from '../../api'
import ToolShell, { Badge, DataRow, ResultBox } from '../../components/network/ToolShell'

export default function DnsCheckerPage() {
  const { t } = useTranslation()
  const [domain, setDomain] = useState('')
  const [result, setResult] = useState<DnsCheckResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const run = async () => {
    if (!domain.trim()) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      setResult(await api.network.dnsCheck(domain.trim()))
    } catch (e: any) {
      setError(e.message)
    }
    setLoading(false)
  }

  const es = result?.email_security || { spf: false, dmarc: false, dkim: [] }
  const cnameQuery = result?.queries?.CNAME
  const cnameRecords = result?.cname_records || cnameQuery?.records || []

  return (
    <ToolShell
      title={t('network.dnsChecker.title')}
      description={t('network.dnsChecker.description')}
    >
      <div className="card flex gap-3">
        <input className="input flex-1" placeholder={t('network.dnsChecker.placeholder')} value={domain} onChange={e => setDomain(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()} />
        <button onClick={run} disabled={loading} className="btn-primary">{loading ? t('network.dnsChecker.running') : t('network.dnsChecker.run')}</button>
      </div>

      <ResultBox error={error}>
        {result && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xl font-bold text-brand-700 dark:text-brand-400">{result.domain}</p>
                <p className="text-sm text-muted-foreground">
                  {result.server_ip ? t('network.dnsChecker.ipResolved', { ip: result.server_ip }) : t('network.dnsChecker.ipNotResolved')} · {t('network.dnsChecker.recordTypesCount', { count: result.total_types })}
                </p>
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-2">✉ {t('network.dnsChecker.emailSecurityTitle')}</h3>
              <div className="flex gap-3">
                {(['spf', 'dmarc'] as const).map(k => (
                  <Badge key={k} variant={es[k] ? 'ok' : 'danger'}>{k.toUpperCase()}: {es[k] ? t('network.dnsChecker.found') : t('network.dnsChecker.notFound')}</Badge>
                ))}
                <Badge variant={es.dkim?.length ? 'ok' : 'danger'}>DKIM: {es.dkim?.length ? es.dkim.join(', ') : t('network.dnsChecker.notFound')}</Badge>
              </div>
            </div>

            {result.providers?.length > 0 && (
              <div>
                <h3 className="font-semibold mb-2">☁ {t('network.dnsChecker.providersTitle')}</h3>
                <div className="flex flex-wrap gap-2">
                  {result.providers.map((p: any, i: number) => (
                    <Badge key={i} variant="info">{p.name} ({p.type})</Badge>
                  ))}
                </div>
              </div>
            )}

            {result.ns?.length > 0 && (
              <div>
                <h3 className="font-semibold mb-2">🔗 {t('network.dnsChecker.nameserversTitle')}</h3>
                {result.ns.map((ns: string, i: number) => <DataRow key={i} label="NS" value={ns} />)}
              </div>
            )}

            {cnameQuery && (
              <div>
                <h3 className="font-semibold mb-2">{t('network.dnsChecker.cnameTitle')}</h3>
                {cnameRecords.length > 0 ? cnameRecords.map((record, index) => (
                  <DataRow key={index} label={record.name || 'CNAME'} value={String(record.rdata || record.value || JSON.stringify(record))} />
                )) : (
                  <p className="text-sm text-muted-foreground">{t('network.dnsChecker.cnameNotFound')}</p>
                )}
              </div>
            )}

            <div className="grid gap-4">
              {Object.entries(result.records || {}).filter(([type]) => type !== 'CNAME').map(([type, recs]: [string, DnsRecord[]]) => (
                <div key={type} className="bg-muted rounded-lg p-4">
                  <h4 className="font-medium text-brand-700 dark:text-brand-400 mb-2">{t('network.dnsChecker.recordsCount', { type, count: recs.length })}</h4>
                  {recs.map((r, i) => (
                    <div key={i} className="text-sm py-1 border-b border-border last:border-0 font-mono break-all">
                      {r.rdata || r.value || JSON.stringify(r)} {r.ttl !== undefined && <span className="text-muted-foreground text-xs">TTL {r.ttl}</span>}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div>
              <h3 className="font-semibold mb-2">DNS query status</h3>
              <div className="flex flex-wrap gap-2">
                {Object.values(result.queries || {}).map(query => (
                  <Badge key={query.type} variant={query.status === 'NOERROR' ? 'ok' : query.status === 'NXDOMAIN' ? 'info' : 'danger'}>
                    {query.type}: {query.status}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        )}
      </ResultBox>
    </ToolShell>
  )
}
