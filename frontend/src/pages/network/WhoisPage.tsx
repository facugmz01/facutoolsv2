import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api'
import { getSystemTimeZone } from '../../utils/datetime'
import ToolShell, { Badge, DataRow, ResultBox } from '../../components/network/ToolShell'

function formatWhoisDate(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '—'
  const raw = value.trim()
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw)
  const normalized = raw.replace(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/,
    '$1T$2Z',
  )
  if (!dateOnly && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) return value
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: dateOnly ? 'UTC' : getSystemTimeZone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(dateOnly ? {} : {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'shortOffset',
    } as const),
  }).format(date)
}

export default function WhoisPage() {
  const { t } = useTranslation()
  const [domain, setDomain] = useState('')
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const run = async () => {
    if (!domain.trim()) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      setResult(await api.network.rdap(domain.trim()))
    } catch (e: any) {
      setError(e.message)
    }
    setLoading(false)
  }

  const registrar = result?.entities?.registrar || {}

  return (
    <ToolShell
      title={t('network.whois.title')}
      description={t('network.whois.description')}
    >
      <div className="card flex gap-3">
        <input className="input flex-1" placeholder={t('network.whois.placeholder')} value={domain} onChange={e => setDomain(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()} />
        <button onClick={run} disabled={loading} className="btn-primary">{loading ? t('network.whois.running') : t('network.whois.run')}</button>
      </div>

      <ResultBox error={error}>
        {result && (
          <div className="space-y-6">
            <div>
              <p className="text-xl font-bold text-brand-700 dark:text-brand-400">{result.ldhName || result.domain}</p>
              <p className="text-sm text-muted-foreground">{t('network.whois.source', { source: result.source })}</p>
              {result.days_expiry !== null && result.days_expiry !== undefined && (
                <Badge variant={result.days_expiry < 30 ? 'danger' : result.days_expiry < 90 ? 'warn' : 'ok'}>
                  {t('network.whois.daysUntilExpiry', { count: result.days_expiry })}
                </Badge>
              )}
            </div>

            {result.status?.length > 0 && (
              <div>
                <h3 className="font-semibold mb-2">📋 {t('network.whois.domainStatusTitle')}</h3>
                <div className="flex flex-wrap gap-2">
                  {result.status.map((s: any, i: number) => (
                    <Badge key={i} variant={s.type === 'danger' ? 'danger' : s.type === 'warn' ? 'warn' : 'ok'}>{s.label}</Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <h3 className="font-semibold mb-2">📅 {t('network.whois.datesTitle')}</h3>
                {Object.entries(result.events || {}).map(([k, v]) => (
                  <DataRow key={k} label={k} value={formatWhoisDate(v)} />
                ))}
              </div>
              <div>
                <h3 className="font-semibold mb-2">🏢 {t('network.whois.registrarTitle')}</h3>
                <DataRow label={t('network.whois.name')} value={registrar.name || registrar.org || t('network.whois.notAvailable')} />
                <DataRow label={t('network.whois.handle')} value={registrar.handle || t('network.whois.notAvailable')} />
                <DataRow label={t('network.whois.ianaId')} value={registrar.iana_id || t('network.whois.notAvailable')} />
              </div>
            </div>

            {result.nameservers?.length > 0 && (
              <div>
                <h3 className="font-semibold mb-2">🔗 {t('network.whois.nameserversTitle')}</h3>
                {result.nameservers.map((ns: string, i: number) => <DataRow key={i} label="NS" value={ns} />)}
              </div>
            )}

            <DataRow label={t('network.whois.dnssec')} value={result.dnssec ? t('network.whois.signed') : t('network.whois.unsigned')} />
          </div>
        )}
      </ResultBox>
    </ToolShell>
  )
}
