import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, RefreshCw, Activity, Pencil } from 'lucide-react'
import { api } from '../api'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Card } from '../components/ui/card'
import { Badge } from '../components/ui/badge'

interface MonitorTarget {
  id: number
  name: string
  check_type: 'http' | 'ping' | 'tcp' | 'dns' | 'ssl' | 'tcp_port' | 'http_keyword' | 'soap' | 'wordpress' | 'whois'
  target: string
  port: number | null
  keyword: string | null
  soap_action: string | null
  request_body: string | null
  interval_minutes: number
  interval_seconds: number | null
  warning_threshold_ms: number | null
  critical_threshold_ms: number | null
  is_active: boolean
  is_public: boolean
  created_at: string
}

interface UptimeStats {
  window_hours: number
  total_checks: number
  uptime_percent: number | null
  avg_response_time_ms: number | null
  last_check: string | null
  currently_up: boolean | null
}

type MonitorForm = {
  name: string
  check_type: MonitorTarget['check_type']
  target: string
  port: string
  keyword: string
  soap_action: string
  request_body: string
  interval_seconds: string
  warning_threshold_ms: string
  critical_threshold_ms: string
  is_active: boolean
  is_public: boolean
}

const emptyForm: MonitorForm = {
  name: '',
  check_type: 'http',
  target: '',
  port: '',
  keyword: '',
  soap_action: '',
  request_body: '',
  interval_seconds: '300',
  warning_threshold_ms: '',
  critical_threshold_ms: '',
  is_active: true,
  is_public: false,
}

function formFromTarget(target: MonitorTarget): MonitorForm {
  return {
    name: target.name,
    check_type: target.check_type,
    target: target.target,
    port: target.port?.toString() || '',
    keyword: target.keyword || '',
    soap_action: target.soap_action || '',
    request_body: target.request_body || '',
    interval_seconds: (target.interval_seconds || target.interval_minutes * 60).toString(),
    warning_threshold_ms: target.warning_threshold_ms?.toString() || '',
    critical_threshold_ms: target.critical_threshold_ms?.toString() || '',
    is_active: target.is_active,
    is_public: target.is_public,
  }
}

export default function Monitoring() {
  const { t } = useTranslation()
  const [targets, setTargets] = useState<MonitorTarget[]>([])
  const [uptime, setUptime] = useState<Record<number, UptimeStats>>({})
  const [showAdd, setShowAdd] = useState(false)
  const [editingTarget, setEditingTarget] = useState<MonitorTarget | null>(null)
  const [runningId, setRunningId] = useState<number | null>(null)
  const [form, setForm] = useState<MonitorForm>(emptyForm)

  const load = async () => {
    const list = (await api.monitoring.list()) as MonitorTarget[]
    setTargets(list)
    const entries = await Promise.all(
      list.map(async (item) => [item.id, (await api.monitoring.uptime(item.id, 24)) as UptimeStats] as const),
    )
    setUptime(Object.fromEntries(entries) as Record<number, UptimeStats>)
  }

  useEffect(() => { load().catch(console.error) }, [])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    await api.monitoring.create({
      name: form.name,
      check_type: form.check_type,
      target: form.target,
      port: form.port ? parseInt(form.port, 10) : undefined,
      keyword: form.keyword || undefined,
      soap_action: form.soap_action || undefined,
      request_body: form.request_body || undefined,
      interval_seconds: parseInt(form.interval_seconds, 10) || 0,
      warning_threshold_ms: form.warning_threshold_ms ? parseInt(form.warning_threshold_ms, 10) : undefined,
      critical_threshold_ms: form.critical_threshold_ms ? parseInt(form.critical_threshold_ms, 10) : undefined,
      is_active: form.is_active,
      is_public: form.is_public,
    })
    setShowAdd(false)
    setForm(emptyForm)
    load()
  }

  const openEdit = (target: MonitorTarget) => {
    setEditingTarget(target)
    setForm(formFromTarget(target))
    setShowAdd(false)
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingTarget) return
    const updated = (await api.monitoring.update(editingTarget.id, {
      name: form.name,
      check_type: form.check_type,
      target: form.target,
      port: form.port ? parseInt(form.port, 10) : null,
      keyword: form.keyword || null,
      soap_action: form.soap_action || null,
      request_body: form.request_body || null,
      interval_seconds: parseInt(form.interval_seconds, 10) || 0,
      warning_threshold_ms: form.warning_threshold_ms ? parseInt(form.warning_threshold_ms, 10) : null,
      critical_threshold_ms: form.critical_threshold_ms ? parseInt(form.critical_threshold_ms, 10) : null,
      is_active: form.is_active,
      is_public: form.is_public,
    })) as MonitorTarget
    setTargets(current => current.map(target => target.id === updated.id ? updated : target))
    setEditingTarget(null)
    setForm(emptyForm)
  }

  const handleRemove = async (id: number) => {
    if (!window.confirm(t('monitoring.form.deleteConfirm'))) return
    await api.monitoring.remove(id)
    setTargets(current => current.filter(target => target.id !== id))
    setUptime(current => {
      const next = { ...current }
      delete next[id]
      return next
    })
  }

  const handleRunNow = async (id: number) => {
    setRunningId(id)
    try {
      await api.monitoring.runNow(id)
      await load()
    } finally {
      setRunningId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight">{t('monitoring.title')}</h2>
          <p className="text-muted-foreground mt-1">{t('monitoring.subtitle')}</p>
        </div>
        <Button onClick={() => setShowAdd(true)} className="shrink-0">
          <Plus size={16} /> {t('monitoring.addButton')}
        </Button>
      </div>

      {editingTarget && (
        <Card>
          <form onSubmit={handleUpdate} className="space-y-4">
            <h3 className="font-semibold">{t('monitoring.form.editTitle')}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Input placeholder={t('monitoring.form.namePlaceholder')} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
              <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.check_type} onChange={e => setForm({ ...form, check_type: e.target.value as MonitorTarget['check_type'] })}>
                <option value="http">HTTP</option><option value="ping">Ping</option><option value="tcp">TCP</option><option value="dns">DNS</option><option value="ssl">SSL</option><option value="tcp_port">TCP Port</option><option value="http_keyword">HTTP Keyword</option><option value="soap">SOAP</option><option value="wordpress">WordPress</option><option value="whois">WHOIS expiration</option>
              </select>
              <Input placeholder={t('monitoring.form.targetPlaceholder')} value={form.target} onChange={e => setForm({ ...form, target: e.target.value })} required />
              {(form.check_type === 'tcp' || form.check_type === 'tcp_port' || form.check_type === 'ssl') && <Input placeholder={t('monitoring.form.portPlaceholder')} type="number" value={form.port} onChange={e => setForm({ ...form, port: e.target.value })} required />}
              {form.check_type === 'http_keyword' && <Input placeholder={t('monitoring.form.keywordPlaceholder')} value={form.keyword} onChange={e => setForm({ ...form, keyword: e.target.value })} required />}
              {form.check_type === 'soap' && (
                <>
                  <Input placeholder={t('monitoring.form.soapActionPlaceholder')} value={form.soap_action} onChange={e => setForm({ ...form, soap_action: e.target.value })} required />
                  <textarea className="min-h-32 rounded-md border border-input bg-background px-3 py-2 text-sm lg:col-span-2" placeholder={t('monitoring.form.requestBodyPlaceholder')} value={form.request_body} onChange={e => setForm({ ...form, request_body: e.target.value })} required />
                </>
              )}
              <Input placeholder={t('monitoring.form.intervalSecondsPlaceholder')} type="number" min={5} value={form.interval_seconds} onChange={e => setForm({ ...form, interval_seconds: e.target.value })} required />
              <Input placeholder={t('monitoring.form.warningThresholdPlaceholder')} type="number" min={0} value={form.warning_threshold_ms} onChange={e => setForm({ ...form, warning_threshold_ms: e.target.value })} />
              <Input placeholder={t('monitoring.form.criticalThresholdPlaceholder')} type="number" min={0} value={form.critical_threshold_ms} onChange={e => setForm({ ...form, critical_threshold_ms: e.target.value })} />
            </div>
            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} />{t('monitoring.form.active')}</label>
            </div>
            <div className="flex gap-2"><Button type="submit">{t('monitoring.form.save')}</Button><Button type="button" variant="secondary" onClick={() => { setEditingTarget(null); setForm(emptyForm) }}>{t('monitoring.form.cancel')}</Button></div>
          </form>
        </Card>
      )}

      {showAdd && (
        <Card>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <Input placeholder={t('monitoring.form.namePlaceholder')} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={form.check_type}
                onChange={e => setForm({ ...form, check_type: e.target.value as MonitorTarget['check_type'] })}
              >
                <option value="http">HTTP</option>
                <option value="ping">Ping</option>
                <option value="tcp">TCP</option>
                <option value="dns">DNS</option>
                <option value="ssl">SSL</option>
                <option value="tcp_port">TCP Port</option>
                <option value="http_keyword">HTTP Keyword</option>
                <option value="soap">SOAP</option>
                <option value="wordpress">WordPress</option>
                <option value="whois">WHOIS expiration</option>
              </select>
              <Input placeholder={t('monitoring.form.targetPlaceholder')} value={form.target} onChange={e => setForm({ ...form, target: e.target.value })} required />
              {(form.check_type === 'tcp' || form.check_type === 'tcp_port' || form.check_type === 'ssl') && (
                <Input placeholder={t('monitoring.form.portPlaceholder')} type="number" value={form.port} onChange={e => setForm({ ...form, port: e.target.value })} required />
              )}
              {form.check_type === 'http_keyword' && (
                <Input placeholder={t('monitoring.form.keywordPlaceholder')} value={form.keyword} onChange={e => setForm({ ...form, keyword: e.target.value })} required />
              )}
              {form.check_type === 'soap' && (
                <>
                  <Input placeholder={t('monitoring.form.soapActionPlaceholder')} value={form.soap_action} onChange={e => setForm({ ...form, soap_action: e.target.value })} required />
                  <textarea className="min-h-32 rounded-md border border-input bg-background px-3 py-2 text-sm lg:col-span-2" placeholder={t('monitoring.form.requestBodyPlaceholder')} value={form.request_body} onChange={e => setForm({ ...form, request_body: e.target.value })} required />
                </>
              )}
              <Input placeholder={t('monitoring.form.intervalSecondsPlaceholder')} type="number" min={5} value={form.interval_seconds} onChange={e => setForm({ ...form, interval_seconds: e.target.value })} required />
            </div>
            <div className="flex gap-2">
              <Button type="submit">{t('monitoring.form.add')}</Button>
              <Button type="button" variant="secondary" onClick={() => setShowAdd(false)}>{t('monitoring.form.cancel')}</Button>
            </div>
          </form>
        </Card>
      )}

      {targets.length === 0 ? (
        <Card className="text-center py-14">
          <Activity size={40} className="mx-auto text-muted-foreground mb-4" />
          <p className="text-foreground font-medium">{t('monitoring.empty')}</p>
          <p className="text-sm text-muted-foreground mt-1">{t('monitoring.emptyHint')}</p>
          <Button className="mt-5" onClick={() => setShowAdd(true)}>
            <Plus size={16} /> {t('monitoring.addButton')}
          </Button>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="border-b border-border text-left text-sm text-muted-foreground bg-muted/40">
                  <th className="p-4 font-medium">{t('monitoring.columns.name')}</th>
                  <th className="p-4 font-medium">{t('monitoring.columns.target')}</th>
                  <th className="p-4 font-medium">{t('monitoring.columns.status')}</th>
                  <th className="p-4 font-medium">{t('monitoring.columns.uptime')}</th>
                  <th className="p-4 font-medium">{t('monitoring.columns.avgResponse')}</th>
                  <th className="p-4 font-medium">{t('monitoring.columns.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {targets.map(target => {
                  const stats = uptime[target.id]
                  return (
                    <tr key={target.id} className="border-b border-border/60 hover:bg-surface-hover/80">
                      <td className="p-4 font-medium"><Link to={`/monitoring/${target.id}`} className="text-brand-600 hover:underline dark:text-brand-400">{target.name}</Link></td>
                      <td className="p-4 text-muted-foreground">
                        {target.check_type.toUpperCase()} · {target.target}{target.port ? `:${target.port}` : ''}
                      </td>
                      <td className="p-4">
                        {stats?.currently_up === null || stats?.currently_up === undefined ? (
                          <Badge variant="secondary">{t('monitoring.status.unknown')}</Badge>
                        ) : stats.currently_up ? (
                          <Badge variant="success">{t('monitoring.status.up')}</Badge>
                        ) : (
                          <Badge variant="danger">{t('monitoring.status.down')}</Badge>
                        )}
                      </td>
                      <td className="p-4 text-muted-foreground">
                        {stats?.uptime_percent != null ? `${stats.uptime_percent}%` : '—'}
                      </td>
                      <td className="p-4 text-muted-foreground">
                        {stats?.avg_response_time_ms != null ? `${Math.round(stats.avg_response_time_ms)} ms` : '—'}
                      </td>
                      <td className="p-4">
                        <div className="flex gap-2">
                          <Button size="sm" variant="secondary" onClick={() => openEdit(target)} title={t('monitoring.form.edit')}>
                            <Pencil size={14} />
                          </Button>
                          <Button size="sm" variant="secondary" disabled={runningId === target.id} onClick={() => handleRunNow(target.id)}>
                            <RefreshCw size={14} className={runningId === target.id ? 'animate-spin' : ''} />
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => handleRemove(target.id)}>
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
