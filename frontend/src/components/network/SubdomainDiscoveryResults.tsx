import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Download, Search } from 'lucide-react'
import type { SubdomainDiscoveryResult } from '../../api'

export default function SubdomainDiscoveryResults({ result }: { result: SubdomainDiscoveryResult }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [feedback, setFeedback] = useState('')
  const rows = result.subdomains.filter(row => {
    const matchesStatus = status === 'all' || (status === 'resolved' ? row.active : !row.active)
    return matchesStatus && [row.subdomain, row.cname || '', ...row.ips].join(' ').toLowerCase().includes(query.trim().toLowerCase())
  })
  const names = rows.map(row => row.subdomain).join('\n')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(names)
      setFeedback(t('discovery.copied'))
    } catch {
      setFeedback(t('discovery.copyFailed'))
    }
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([names + '\n'], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${result.domain}-subdomains.txt`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="min-w-0 space-y-4" aria-label={t('tools.results')}>
      <h3 className="text-lg font-semibold break-all">{result.domain}</h3>
      <dl className="grid grid-cols-2 gap-4 border-y border-border py-4 sm:grid-cols-4">
        {[
          ['checked', result.total_checked], ['found', result.total_found],
          ['resolved', result.resolved_count], ['filtered', result.wildcard_filtered],
        ].map(([key, value]) => (
          <div key={key}>
            <dt className="text-xs text-muted-foreground">{t(`discovery.${key}`)}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {(result.wildcard_detected || result.warnings.length > 0) && (
        <div role="status" className="space-y-2 border-l-2 border-amber-500 bg-amber-500/10 p-3 text-sm">
          {result.wildcard_detected && <p>{t('discovery.wildcardNotice')}</p>}
          {result.warnings.map(warning => <p key={warning}>{t(`discovery.warnings.${warning}`, { defaultValue: warning })}</p>)}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 basis-full sm:basis-auto sm:flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className="input w-full min-w-0 pl-9" aria-label={t('discovery.search')} placeholder={t('discovery.search')} value={query} onChange={event => { setQuery(event.target.value); setFeedback('') }} />
        </div>
        <select className="input min-w-0 max-w-full" aria-label={t('discovery.status')} value={status} onChange={event => { setStatus(event.target.value); setFeedback('') }}>
          <option value="all">{t('discovery.all')}</option>
          <option value="resolved">{t('discovery.resolved')}</option>
          <option value="unresolved">{t('discovery.unresolved')}</option>
        </select>
        <button type="button" disabled={!rows.length} onClick={copy} className="btn-secondary inline-flex h-10 w-10 shrink-0 items-center justify-center p-0" title={t('discovery.copy')} aria-label={t('discovery.copy')}><Copy size={16} /></button>
        <button type="button" disabled={!rows.length} onClick={download} className="btn-secondary inline-flex h-10 w-10 shrink-0 items-center justify-center p-0" title={t('discovery.download')} aria-label={t('discovery.download')}><Download size={16} /></button>
      </div>
      {feedback && <p role="status" className="text-sm text-muted-foreground">{feedback}</p>}
      <p className="text-xs text-muted-foreground">{t('discovery.showing', { count: rows.length, total: result.total_found })}</p>
      {rows.length ? (
        <div className="max-w-full overflow-x-auto">
          <table className="w-full min-w-[640px] table-fixed text-left text-sm">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="w-[32%] py-3 pr-3 font-medium">{t('discovery.hostname')}</th>
                <th className="w-[30%] py-3 pr-3 font-medium">{t('discovery.addresses')}</th>
                <th className="w-[20%] py-3 pr-3 font-medium">{t('discovery.status')}</th>
                <th className="w-[18%] py-3 font-medium">{t('discovery.sources')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.subdomain} className="border-b border-border align-top">
                  <td className="py-3 pr-3 font-mono break-all">{row.subdomain}</td>
                  <td className="space-y-1 py-3 pr-3 font-mono text-xs break-all">
                    {row.ipv4.map(address => <div key={address}><span className="text-muted-foreground">A </span>{address}</div>)}
                    {row.ipv6.map(address => <div key={address}><span className="text-muted-foreground">AAAA </span>{address}</div>)}
                    {row.cname && <div><span className="text-muted-foreground">CNAME </span>{row.cname}</div>}
                    {!row.ips.length && !row.cname && <span className="text-muted-foreground">{t('discovery.noAddresses')}</span>}
                  </td>
                  <td className="space-y-1 py-3 pr-3">
                    <span className={`badge ${row.active ? 'badge-success' : 'badge-warning'}`}>{t(`discovery.states.${row.status}`)}</span>
                    {row.wildcard && <p className="text-xs text-amber-700 dark:text-amber-400">{t('discovery.possibleWildcard')}</p>}
                    {row.active && row.dns_partial && <p className="text-xs text-muted-foreground">{t('discovery.partial')}</p>}
                  </td>
                  <td className="space-y-1 py-3 text-xs text-muted-foreground">{row.sources.map(source => <p key={source}>{t(`discovery.source.${source}`)}</p>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p role="status" className="py-8 text-center text-muted-foreground">{t(result.total_found ? 'discovery.noMatches' : 'discovery.empty')}</p>}
    </section>
  )
}