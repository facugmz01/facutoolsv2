import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api'
import ToolShell, { Badge, DataRow, ResultBox } from '../../components/network/ToolShell'

export default function IpLookupPage() {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const [result, setResult] = useState<any>(null)
  const [blResult, setBlResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [blLoading, setBlLoading] = useState(false)
  const [error, setError] = useState('')

  const run = async (ip?: string) => {
    setLoading(true)
    setError('')
    setResult(null)
    setBlResult(null)
    try {
      const res = ip !== undefined
        ? (ip ? await api.network.ipLookup(ip) : await api.network.ipLookupMe())
        : (input.trim() ? await api.network.ipLookup(input.trim()) : await api.network.ipLookupMe())
      setResult(res)
    } catch (e: any) {
      setError(e.message)
    }
    setLoading(false)
  }

  const checkBlacklist = async () => {
    if (!result?.ip) return
    setBlLoading(true)
    try {
      setBlResult(await api.network.blacklist(result.ip))
    } catch (e: any) {
      setBlResult({ error: e.message })
    }
    setBlLoading(false)
  }

  const threat = result?.threat || {}
  const asn = result?.asn || {}
  const tz = result?.time_zone || {}
  const currency = result?.currency || {}

  const yesNo = (val: boolean | undefined) => (val ? t('common.yes') : val === false ? t('common.no') : t('network.whois.notAvailable'))

  const threatItems: [string, boolean | undefined][] = [
    [t('network.ipLookup.tor'), threat.is_tor],
    [t('network.ipLookup.proxy'), threat.is_proxy],
    [t('network.ipLookup.vpn'), threat.is_vpn],
    [t('network.ipLookup.datacenter'), threat.is_datacenter],
    [t('network.ipLookup.threat'), threat.is_threat],
    [t('network.ipLookup.attacker'), threat.is_known_attacker],
    [t('network.ipLookup.abuser'), threat.is_known_abuser],
    [t('network.ipLookup.anonymous'), threat.is_anonymous],
    [t('network.ipLookup.bogon'), threat.is_bogon],
  ]

  return (
    <ToolShell
      title={t('network.ipLookup.title')}
      description={t('network.ipLookup.description')}
    >
      <div className="card flex gap-3 flex-wrap">
        <input
          className="input flex-1 min-w-[200px]"
          placeholder={t('network.ipLookup.placeholder')}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && run()}
        />
        <button onClick={() => run()} disabled={loading} className="btn-primary">
          {loading ? t('network.ipLookup.searching') : t('network.ipLookup.search')}
        </button>
        <button onClick={() => { setInput(''); run('') }} disabled={loading} className="btn-secondary">
          {t('network.ipLookup.myIp')}
        </button>
      </div>

      <ResultBox error={error}>
        {result && (
          <div className="space-y-6">
            <div className="flex items-center gap-4 pb-4 border-b border-border">
              <span className="text-4xl">{result.emoji_flag}</span>
              <div>
                <p className="text-2xl font-mono font-bold text-brand-700 dark:text-brand-400">{result.ip}</p>
                <p className="text-muted-foreground">{[result.city, result.region, result.country_name].filter(Boolean).join(', ')}</p>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <h3 className="font-semibold mb-2 text-brand-700 dark:text-brand-400">📍 {t('network.ipLookup.locationTitle')}</h3>
                <DataRow label={t('network.ipLookup.country')} value={`${result.country_name} (${result.country_code})`} />
                <DataRow label={t('network.ipLookup.continent')} value={`${result.continent_name} (${result.continent_code})`} />
                <DataRow label={t('network.ipLookup.city')} value={result.city || t('network.whois.notAvailable')} />
                <DataRow label={t('network.ipLookup.coordinates')} value={`${result.latitude}, ${result.longitude}`} />
              </div>
              <div>
                <h3 className="font-semibold mb-2 text-brand-700 dark:text-brand-400">🔌 {t('network.ipLookup.networkTitle')}</h3>
                <DataRow label={t('network.ipLookup.asn')} value={asn.asn} />
                <DataRow label={t('network.ipLookup.organization')} value={asn.name} />
                <DataRow label={t('network.ipLookup.type')} value={asn.type} />
                <DataRow label={t('network.ipLookup.route')} value={asn.route} />
              </div>
              <div>
                <h3 className="font-semibold mb-2 text-brand-700 dark:text-brand-400">🕒 {t('network.ipLookup.timezoneTitle')}</h3>
                <DataRow label={t('network.ipLookup.zone')} value={tz.name || t('network.whois.notAvailable')} />
                <DataRow label={t('network.ipLookup.utcOffset')} value={tz.offset || t('network.whois.notAvailable')} />
              </div>
              <div>
                <h3 className="font-semibold mb-2 text-brand-700 dark:text-brand-400">💱 {t('network.ipLookup.currencyTitle')}</h3>
                <DataRow label={t('network.ipLookup.currency')} value={currency.name} />
                <DataRow label={t('network.ipLookup.code')} value={currency.code} />
                <DataRow label={t('network.ipLookup.symbol')} value={currency.symbol} />
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-3 text-brand-700 dark:text-brand-400">🛡 {t('network.ipLookup.threatTitle')}</h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                {threatItems.map(([label, val]) => (
                  <div key={label} className="p-2 bg-muted rounded-lg text-center text-xs">
                    <p className="text-muted-foreground">{label}</p>
                    <Badge variant={val ? 'danger' : val === false ? 'ok' : 'dim'}>
                      {yesNo(val)}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>

            {result.latitude && result.longitude && (
              <div>
                <h3 className="font-semibold mb-2 text-brand-700 dark:text-brand-400">🗺 {t('network.ipLookup.mapTitle')}</h3>
                <iframe
                  title={t('network.ipLookup.mapTitle')}
                  className="w-full h-64 rounded-lg border border-border"
                  src={`https://maps.google.com/maps?q=${result.latitude},${result.longitude}&z=12&output=embed`}
                  loading="lazy"
                />
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-brand-700 dark:text-brand-400">🚫 {t('network.ipLookup.blacklistsTitle')}</h3>
                <button onClick={checkBlacklist} disabled={blLoading} className="btn-secondary text-sm">
                  {blLoading ? t('network.ipLookup.verifying') : blResult ? t('network.ipLookup.reverify') : t('network.ipLookup.verify')}
                </button>
              </div>
              {blResult?.private && <p className="text-muted-foreground text-sm">{t('network.ipLookup.privateIpNote', { note: blResult.note })}</p>}
              {blResult?.dnsbl && (
                <div className="space-y-2">
                  <p className="text-sm">
                    {blResult.clean
                      ? <Badge variant="ok">{t('network.ipLookup.cleanIn', { total: blResult.total })}</Badge>
                      : <Badge variant="danger">{t('network.ipLookup.listedIn', { listed: blResult.listed, total: blResult.total })}</Badge>}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-1 max-h-64 overflow-auto">
                    {blResult.dnsbl.map((r: any, i: number) => (
                      <div key={i} className="flex justify-between text-xs p-2 bg-muted rounded">
                        <span>{r.name}</span>
                        <Badge variant={r.skipped ? 'warn' : r.error ? 'warn' : r.listed ? 'danger' : 'ok'}>
                          {r.skipped
                            ? t('network.ipLookup.skipped')
                            : r.error
                              ? t('network.ipLookup.noResponse')
                              : r.listed
                                ? t('network.ipLookup.listed')
                                : t('network.ipLookup.clean')}
                        </Badge>
                      </div>
                    ))}
                  </div>
                  {blResult.abuseipdb && (
                    <p className="text-sm text-muted-foreground mt-2">
                      {t('network.ipLookup.abuseIpdbSummary', { score: blResult.abuseipdb.score, reports: blResult.abuseipdb.totalReports })}
                    </p>
                  )}
                  {blResult.keys && (
                    <div className="text-xs text-muted-foreground mt-2 space-y-1">
                      <p>{t('network.ipLookup.keysHint')}</p>
                      <div className="flex flex-wrap gap-2">
                        {([
                          ['abuseipdb', 'keyAbuseipdb'],
                          ['spamrats', 'keySpamrats'],
                          ['spamhaus_dqs', 'keySpamhausDqs'],
                        ] as const).map(([key, labelKey]) => (
                          <Badge key={key} variant={blResult.keys[key] ? 'ok' : 'warn'}>
                            {t(`network.ipLookup.${labelKey}`)}: {blResult.keys[key] ? t('network.ipLookup.keyOk') : t('network.ipLookup.keyMissing')}
                          </Badge>
                        ))}
                      </div>
                      <a href="/settings?tab=integrations" className="text-brand-600 dark:text-brand-400 underline">
                        {t('network.ipLookup.settingsLink')}
                      </a>
                    </div>
                  )}
                </div>
              )}
              {blResult?.error && <p className="text-red-600 text-sm">{blResult.error}</p>}
            </div>
          </div>
        )}
      </ResultBox>
    </ToolShell>
  )
}
