import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bell, Check, Send } from 'lucide-react'
import { api, Alert } from '../api'
import { formatDateTime } from '../utils/datetime'

export default function Alerts() {
  const { t } = useTranslation()
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testError, setTestError] = useState<string | null>(null)

  const load = () => api.alerts.list().then(setAlerts).catch(console.error)
  useEffect(() => { load() }, [])

  const markRead = async (id: number) => {
    await api.alerts.markRead(id)
    load()
  }

  const sendTest = async () => {
    setTesting(true)
    setTestResult(null)
    setTestError(null)
    try {
      const res = await api.alerts.test()
      const summary = res.results
        .map(r => `${r.channel}: ${r.skipped ? 'skipped' : r.success ? 'ok' : 'fail'} (${r.detail})`)
        .join(' · ')
      setTestResult(summary || t('alerts.testEmpty'))
    } catch (e) {
      setTestError(e instanceof Error ? e.message : t('alerts.testFailed'))
    } finally {
      setTesting(false)
    }
  }

  const severityColor = (s: string) => {
    if (s === 'critical') return 'badge-danger'
    if (s === 'warning') return 'badge-warning'
    return 'badge-info'
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">{t('alerts.title')}</h2>
          <p className="text-muted-foreground mt-1">{t('alerts.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={sendTest}
          disabled={testing}
          className="btn-secondary inline-flex items-center gap-2 self-start"
        >
          <Send size={16} />
          {testing ? t('alerts.testing') : t('alerts.sendTest')}
        </button>
      </div>

      {testResult && (
        <div className="card text-sm text-muted-foreground">{testResult}</div>
      )}
      {testError && (
        <div className="card text-sm text-red-600">{testError}</div>
      )}

      {alerts.length === 0 ? (
        <div className="card text-center py-12">
          <Bell size={40} className="mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">{t('alerts.empty')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map(a => (
            <div key={a.id} className={`card flex flex-col sm:flex-row sm:items-start justify-between gap-3 ${a.is_read ? 'opacity-60' : ''}`}>
              <div className="flex gap-4">
                <div className={`p-2 rounded-lg ${a.severity === 'critical' ? 'bg-red-50 dark:bg-red-950/30' : a.severity === 'warning' ? 'bg-yellow-50 dark:bg-yellow-950/30' : 'bg-sky-50 dark:bg-sky-950/30'}`}>
                  <Bell size={18} className={a.severity === 'critical' ? 'text-red-600' : a.severity === 'warning' ? 'text-yellow-600' : 'text-sky-600'} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{a.title}</p>
                    <span className={`badge ${severityColor(a.severity)}`}>{a.severity}</span>
                    <span className="badge badge-info">{a.type}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{a.message}</p>
                  <p className="text-xs text-muted-foreground mt-2">{formatDateTime(a.created_at)}</p>
                </div>
              </div>
              {!a.is_read && (
                <button onClick={() => markRead(a.id)} className="text-muted-foreground hover:text-green-600" title={t('alerts.markRead')}>
                  <Check size={18} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
