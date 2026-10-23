import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api'
import ToolShell, { Badge, ResultBox } from '../../components/network/ToolShell'

const TYPES = ['A', 'AAAA', 'MX', 'NS', 'TXT', 'CNAME', 'SOA']

export default function PropagacionPage() {
  const { t } = useTranslation()
  const [domain, setDomain] = useState('')
  const [type, setType] = useState('A')
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const run = async () => {
    if (!domain.trim()) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      setResult(await api.network.propagation(domain.trim(), type))
    } catch (e: any) {
      setError(e.message)
    }
    setLoading(false)
  }

  return (
    <ToolShell
      title={t('network.propagation.title')}
      description={t('network.propagation.description')}
    >
      <div className="card flex gap-3 flex-wrap">
        <input className="input flex-1 min-w-[180px]" placeholder={t('network.propagation.placeholder')} value={domain} onChange={e => setDomain(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()} />
        <select className="input" value={type} onChange={e => setType(e.target.value)}>
          {TYPES.map(t2 => <option key={t2} value={t2}>{t2}</option>)}
        </select>
        <button onClick={run} disabled={loading} className="btn-primary">{loading ? t('network.propagation.running') : t('network.propagation.run')}</button>
      </div>

      <ResultBox error={error}>
        {result && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-bold">{result.domain} — {result.type}</p>
                <p className="text-sm text-muted-foreground">{t('network.propagation.propagatedOf', { propagated: result.propagated, total: result.total, ms: result.total_ms })}</p>
              </div>
              <Badge variant={result.pct === 100 ? 'ok' : result.pct > 50 ? 'warn' : 'danger'}>{t('network.propagation.percentPropagated', { pct: result.pct })}</Badge>
            </div>
            {!result.consistent && result.propagated > 1 && (
              <p className="text-yellow-600 text-sm">{t('network.propagation.inconsistentWarning')}</p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b border-border">
                    <th className="text-left py-2">{t('network.propagation.server')}</th>
                    <th className="text-left py-2">{t('network.propagation.response')}</th>
                    <th className="text-right py-2">{t('network.propagation.latency')}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.results?.map((r: any, i: number) => (
                    <tr key={i} className="border-b border-border">
                      <td className="py-2">
                        <span>{r.flag} {r.server}</span>
                        <p className="text-xs text-muted-foreground">{r.ip} · {r.location}</p>
                      </td>
                      <td className="py-2 font-mono text-xs">
                        {r.error ? t('network.propagation.timeout') : r.raw === 'NXDOMAIN' ? 'NXDOMAIN' : r.raw === 'NODATA' ? t('network.propagation.noRecords') : r.values?.join(' · ') || '—'}
                      </td>
                      <td className="py-2 text-right text-muted-foreground">{r.error ? '—' : `${r.ms}ms`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </ResultBox>
    </ToolShell>
  )
}
