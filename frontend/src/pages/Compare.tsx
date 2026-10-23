import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitCompareArrows } from 'lucide-react'
import { api } from '../api'

const METRICS = [
  { key: 'ssl_valid', i18nKey: 'sslValid' },
  { key: 'ssl_days', i18nKey: 'sslDays' },
  { key: 'is_up', i18nKey: 'isUp' },
  { key: 'response_time', i18nKey: 'responseTime' },
  { key: 'email_score', i18nKey: 'emailScore' },
  { key: 'subdomains', i18nKey: 'subdomains' },
  { key: 'blacklisted', i18nKey: 'blacklisted' },
  { key: 'technologies', i18nKey: 'technologies' },
]

export default function Compare() {
  const { t } = useTranslation()
  const [domains, setDomains] = useState(['', ''])
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const addField = () => setDomains([...domains, ''])
  const updateField = (i: number, val: string) => {
    const updated = [...domains]
    updated[i] = val
    setDomains(updated)
  }

  const handleCompare = async () => {
    const names = domains.map(d => d.trim()).filter(Boolean)
    if (names.length < 2) return
    setLoading(true)
    try {
      const res = await api.domains.compare(names)
      setResult(res)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t('compare.title')}</h2>
        <p className="text-muted-foreground mt-1">{t('compare.subtitle')}</p>
      </div>

      <div className="card space-y-3">
        {domains.map((d, i) => (
          <input key={i} className="input w-full" placeholder={t('compare.domainPlaceholder', { index: i + 1 })} value={d} onChange={e => updateField(i, e.target.value)} />
        ))}
        <div className="flex gap-2">
          <button onClick={addField} className="btn-secondary">{t('compare.addDomain')}</button>
          <button onClick={handleCompare} disabled={loading} className="btn-primary flex items-center gap-2">
            <GitCompareArrows size={16} /> {loading ? t('compare.comparing') : t('compare.compare')}
          </button>
        </div>
      </div>

      {result?.comparison && (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[480px]">
            <thead>
              <tr className="border-b border-border text-left text-sm text-muted-foreground">
                <th className="p-4">{t('compare.metricColumn')}</th>
                {result.domains.map((d: string) => <th key={d} className="p-4">{d}</th>)}
              </tr>
            </thead>
            <tbody>
              {METRICS.map(metric => (
                <tr key={metric.key} className="border-b border-border">
                  <td className="p-4 font-medium capitalize">{t(`compare.metrics.${metric.i18nKey}`)}</td>
                  {result.domains.map((d: string) => {
                    const val = result.comparison[d]?.[metric.key]
                    return (
                      <td key={d} className="p-4">
                        {typeof val === 'boolean' ? (
                          <span className={`badge ${val ? 'badge-success' : 'badge-danger'}`}>{val ? t('compare.yes') : t('compare.no')}</span>
                        ) : val ?? '—'}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
