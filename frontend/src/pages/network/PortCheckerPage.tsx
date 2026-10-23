import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api'
import ToolShell, { Badge, ResultBox } from '../../components/network/ToolShell'

type Mode = 'quick' | 'manual'
type Protocol = 'tcp' | 'udp' | 'both'

const PRESETS = ['common', 'web', 'mail', 'db', 'top100', 'well_known'] as const

function statusVariant(status: string): 'ok' | 'warn' | 'danger' | 'dim' {
  if (status === 'open') return 'ok'
  if (status === 'filtered' || status === 'open|filtered') return 'warn'
  if (status === 'closed') return 'danger'
  return 'dim'
}

export default function PortCheckerPage() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('quick')
  const [host, setHost] = useState('')
  const [protocol, setProtocol] = useState<Protocol>('tcp')
  const [preset, setPreset] = useState<string>('common')
  const [ports, setPorts] = useState('')
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const stop = () => abortRef.current?.abort()

  const run = async () => {
    if (!host.trim()) {
      setError(t('network.portCheck.hostRequired'))
      return
    }
    if (mode === 'manual' && !ports.trim()) {
      setError(t('network.portCheck.portsRequired'))
      return
    }
    setLoading(true)
    setError('')
    setResult(null)
    const controller = new AbortController()
    abortRef.current = controller
    const startedAt = performance.now()
    try {
      await api.network.portCheckStream({
        host: host.trim(),
        protocol,
        mode,
        preset: mode === 'quick' ? preset : undefined,
        ports: mode === 'manual' ? ports.trim() : undefined,
      }, ev => {
        if (ev.type === 'start') {
          setResult({ host: ev.host, ip: ev.ip, total: ev.total, done: 0, open: 0, filtered: 0, closed: 0, total_ms: 0, results: [] })
        } else if (ev.type === 'result') {
          setResult((prev: any) => prev && ({
            ...prev,
            done: ev.done,
            open: ev.open,
            filtered: ev.filtered,
            closed: ev.closed,
            total_ms: Math.round(performance.now() - startedAt),
            results: [...prev.results, ev.result].sort(
              (a: any, b: any) => a.port - b.port || a.protocol.localeCompare(b.protocol),
            ),
          }))
        } else if (ev.type === 'done') {
          setResult((prev: any) => prev && ({ ...prev, total_ms: ev.total_ms }))
        }
      }, controller.signal)
    } catch (e: any) {
      if (e.name !== 'AbortError') setError(e.message)
    }
    setLoading(false)
  }

  return (
    <ToolShell
      title={t('network.portCheck.title')}
      description={t('network.portCheck.description')}
    >
      <div className="card space-y-4">
        <div className="flex gap-1 border-b border-border -mt-1">
          <button
            type="button"
            onClick={() => setMode('quick')}
            className={`px-4 py-2 text-sm transition-colors border-b-2 -mb-px ${
              mode === 'quick'
                ? 'border-brand-500 text-foreground font-semibold'
                : 'border-transparent text-muted-foreground hover:text-foreground-secondary'
            }`}
          >
            {t('network.portCheck.modeQuick')}
          </button>
          <button
            type="button"
            onClick={() => setMode('manual')}
            className={`px-4 py-2 text-sm transition-colors border-b-2 -mb-px ${
              mode === 'manual'
                ? 'border-brand-500 text-foreground font-semibold'
                : 'border-transparent text-muted-foreground hover:text-foreground-secondary'
            }`}
          >
            {t('network.portCheck.modeManual')}
          </button>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted-foreground">{t('network.portCheck.hostLabel')}</label>
            <input
              className="input w-full mt-1 font-mono"
              value={host}
              onChange={e => setHost(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && run()}
              placeholder={t('network.portCheck.hostPlaceholder')}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">{t('network.portCheck.protocolLabel')}</label>
            <select
              className="input w-full mt-1"
              value={protocol}
              onChange={e => setProtocol(e.target.value as Protocol)}
            >
              <option value="tcp">{t('network.portCheck.protocolTcp')}</option>
              <option value="udp">{t('network.portCheck.protocolUdp')}</option>
              <option value="both">{t('network.portCheck.protocolBoth')}</option>
            </select>
          </div>
        </div>

        {mode === 'quick' ? (
          <div>
            <label className="text-xs text-muted-foreground">{t('network.portCheck.presetLabel')}</label>
            <div className="flex flex-wrap gap-2 mt-2">
              {PRESETS.map(key => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPreset(key)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    preset === key
                      ? 'border-brand-500 text-brand-700 dark:text-brand-400 bg-brand-500/10'
                      : 'border-border text-muted-foreground hover:border-slate-400 dark:hover:border-slate-500'
                  }`}
                >
                  {t(`network.portCheck.presets.${key}`)}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <label className="text-xs text-muted-foreground">{t('network.portCheck.portsLabel')}</label>
            <input
              className="input w-full mt-1 font-mono"
              value={ports}
              onChange={e => setPorts(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && run()}
              placeholder={t('network.portCheck.portsPlaceholder')}
            />
            <p className="text-xs text-muted-foreground mt-1">{t('network.portCheck.portsHint')}</p>
          </div>
        )}

        <button onClick={run} disabled={loading} className="btn-primary w-full">
          {loading
            ? t('network.portCheck.running')
            : mode === 'quick'
              ? t('network.portCheck.runQuick')
              : t('network.portCheck.runManual')}
        </button>
        {loading && (
          <button type="button" onClick={stop} className="btn-secondary w-full">
            {t('network.portCheck.stop')}
          </button>
        )}
      </div>

      <ResultBox error={error}>
        {result && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-lg font-bold font-mono text-brand-700 dark:text-brand-400">{result.host}</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {result.ip !== result.host && <span className="font-mono">{result.ip} · </span>}
                  {t('network.portCheck.summary', {
                    total: result.total,
                    ms: result.total_ms,
                  })}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="ok">{t('network.portCheck.openCount', { count: result.open })}</Badge>
                <Badge variant="warn">{t('network.portCheck.filteredCount', { count: result.filtered })}</Badge>
                <Badge variant="danger">{t('network.portCheck.closedCount', { count: result.closed })}</Badge>
              </div>
            </div>

            {loading && (
              <div>
                <div className="h-2 rounded-full bg-border overflow-hidden">
                  <div
                    className="h-full bg-brand-500 transition-all"
                    style={{ width: `${result.total ? (result.done / result.total) * 100 : 0}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('network.portCheck.progress', { done: result.done, total: result.total })}
                </p>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b border-border">
                    <th className="text-left py-2">{t('network.portCheck.colPort')}</th>
                    <th className="text-left py-2">{t('network.portCheck.colProtocol')}</th>
                    <th className="text-left py-2">{t('network.portCheck.colService')}</th>
                    <th className="text-left py-2">{t('network.portCheck.colStatus')}</th>
                    <th className="text-right py-2">{t('network.portCheck.colLatency')}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.results?.map((r: any, i: number) => (
                    <tr key={`${r.port}-${r.protocol}-${i}`} className="border-b border-border">
                      <td className="py-2 font-mono">{r.port}</td>
                      <td className="py-2 uppercase text-muted-foreground">{r.protocol}</td>
                      <td className="py-2 text-muted-foreground">
                        {r.detected_service || r.service || '—'}
                        {r.tls && !String(r.detected_service || '').includes('tls') && r.detected_service !== 'https' && ' (TLS)'}
                        {r.banner && (
                          <span className="block text-xs font-mono truncate max-w-xs" title={r.banner}>{r.banner}</span>
                        )}
                      </td>
                      <td className="py-2">
                        <Badge variant={statusVariant(r.status)}>
                          {t(`network.portCheck.status.${r.status === 'open|filtered' ? 'openFiltered' : r.status}`)}
                        </Badge>
                      </td>
                      <td className="py-2 text-right text-muted-foreground">
                        {r.ms != null ? `${r.ms} ms` : '—'}
                      </td>
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
