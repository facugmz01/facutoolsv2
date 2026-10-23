import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Activity, ArrowLeft, AlertTriangle, Clock3, Gauge, Server } from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../api'
import { dayKey, formatDateTimeShort, getSystemTimeZone, parseApiDate } from '../utils/datetime'
import { Badge } from '../components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'

interface MonitorTarget {
  id: number
  name: string
  check_type: string
  target: string
  port: number | null
  is_active: boolean
}

interface MonitorLog {
  id: number
  status: 'UP' | 'DOWN' | 'DEGRADED'
  response_time_ms: number | null
  status_code: number | null
  error_detail: string | null
  created_at: string
}

interface MonitorHistory {
  uptime_percent: number | null
  average_latency_ms: number | null
  logs: MonitorLog[]
}

interface MonitorIncident {
  id: number
  status: 'open' | 'resolved'
  started_at: string
  resolved_at: string | null
}

function formatDate(value: string | null) {
  if (!value) return 'En curso'
  return formatDateTimeShort(value)
}

function duration(start: string, end: string | null) {
  const milliseconds = Math.max(0, (end ? parseApiDate(end)! : new Date()).getTime() - parseApiDate(start)!.getTime())
  const minutes = Math.floor(milliseconds / 60000)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours} h ${remainingMinutes} min`
}

function statusBadge(status: MonitorLog['status']) {
  if (status === 'UP') return <Badge variant="success">UP</Badge>
  if (status === 'DEGRADED') return <Badge variant="warning">DEGRADED</Badge>
  return <Badge variant="danger">DOWN</Badge>
}

function dailyStatus(logs: MonitorLog[]) {
  const days = Array.from({ length: 7 }, (_, index) => new Date(Date.now() - (6 - index) * 86_400_000))

  return days.map((date) => {
    const key = dayKey(date)
    const statuses = logs
      .filter((log) => dayKey(log.created_at) === key)
      .map((log) => log.status)
    const status = statuses.includes('DOWN')
      ? 'DOWN'
      : statuses.includes('DEGRADED')
        ? 'DEGRADED'
        : statuses.includes('UP')
          ? 'UP'
          : 'EMPTY'
    return { key, label: date.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', timeZone: getSystemTimeZone() }), status }
  })
}

export default function MonitorDetail() {
  const { id } = useParams()
  const monitorId = Number(id)
  const [monitor, setMonitor] = useState<MonitorTarget | null>(null)
  const [history, setHistory] = useState<MonitorHistory | null>(null)
  const [incidents, setIncidents] = useState<MonitorIncident[]>([])
  const [incidentLogs, setIncidentLogs] = useState<MonitorLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!Number.isInteger(monitorId)) {
      setError(true)
      setLoading(false)
      return
    }
    Promise.all([
      api.monitoring.list(),
      api.monitoring.history(monitorId, 7),
      api.monitoring.incidents(monitorId, 50),
    ])
      .then(([targets, monitorHistory, monitorIncidents]) => {
        const target = (targets as MonitorTarget[]).find((item) => item.id === monitorId)
        setMonitor(target || null)
        setHistory(monitorHistory as MonitorHistory)
        setIncidents(monitorIncidents as MonitorIncident[])
        setIncidentLogs((monitorHistory as MonitorHistory).logs)
        if (!target) setError(true)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [monitorId])

  if (loading) return <div className="py-12 text-center text-muted-foreground">Cargando historial...</div>
  if (error || !monitor || !history) {
    return (
      <Card className="py-12 text-center">
        <p className="text-muted-foreground">No se pudo cargar el monitor.</p>
        <Link to="/monitoring" className="mt-4 inline-flex items-center gap-2 text-brand-600 hover:underline dark:text-brand-400"><ArrowLeft size={16} /> Volver a monitoreo</Link>
      </Card>
    )
  }

  const chartData = history.logs
    .filter((log) => log.response_time_ms !== null)
    .map((log) => ({
      time: formatDateTimeShort(log.created_at),
      latency: log.response_time_ms,
    }))
  const blocks = dailyStatus(history.logs)
  const average = history.average_latency_ms === null ? '—' : `${history.average_latency_ms.toFixed(2)} ms`
  const uptime = history.uptime_percent === null ? '—' : `${history.uptime_percent.toFixed(2)}%`

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link to="/monitoring" className="mb-3 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={16} /> Monitoreo</Link>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold tracking-tight">{monitor.name}</h2>
            {monitor.is_active ? <Badge variant="success">Activo</Badge> : <Badge variant="secondary">Pausado</Badge>}
          </div>
          <p className="mt-1 text-muted-foreground">{monitor.check_type.toUpperCase()} · {monitor.target}{monitor.port ? `:${monitor.port}` : ''}</p>
        </div>
        <Link to={`/monitoring/${monitor.id}`} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted"><Activity size={16} /> Últimos 7 días</Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="flex items-center gap-3 p-5"><Gauge className="text-green-600" size={22} /><div><p className="text-sm text-muted-foreground">Uptime</p><p className="text-2xl font-semibold">{uptime}</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-5"><Clock3 className="text-sky-600" size={22} /><div><p className="text-sm text-muted-foreground">Latencia promedio</p><p className="text-2xl font-semibold">{average}</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-5"><AlertTriangle className="text-amber-600" size={22} /><div><p className="text-sm text-muted-foreground">Incidentes / caídas</p><p className="text-2xl font-semibold">{incidents.length}</p></div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Disponibilidad histórica</CardTitle><CardDescription>Estado agregado de cada día durante los últimos 7 días.</CardDescription></CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-2">
            {blocks.map((block) => (
              <div key={block.key} className="space-y-2 text-center">
                <div title={`${block.label}: ${block.status}`} className={`h-10 rounded-md ${block.status === 'UP' ? 'bg-green-500' : block.status === 'DEGRADED' ? 'bg-yellow-400' : block.status === 'DOWN' ? 'bg-red-500' : 'bg-muted'}`} />
                <span className="block truncate text-xs text-muted-foreground">{block.label}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground"><span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-green-500" /> UP</span><span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-yellow-400" /> DEGRADED</span><span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-red-500" /> DOWN</span></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Latencia</CardTitle><CardDescription>Tiempo de respuesta en milisegundos por chequeo.</CardDescription></CardHeader>
        <CardContent className="h-72 px-0 sm:px-2">
          {chartData.length === 0 ? <p className="flex h-full items-center justify-center text-sm text-muted-foreground">No hay mediciones de latencia en este periodo.</p> : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 20, left: 4, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} minTickGap={28} />
                <YAxis unit=" ms" width={58} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value) => [`${Number(value).toFixed(2)} ms`, 'Latencia']} />
                <Line type="monotone" dataKey="latency" stroke="#0ea5e9" strokeWidth={2} dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Incidentes recientes</CardTitle><CardDescription>Últimas caídas detectadas durante el periodo consultado.</CardDescription></CardHeader>
        <CardContent className="p-0">
          {incidents.length === 0 ? <p className="px-6 pb-6 text-sm text-muted-foreground">No se detectaron incidentes.</p> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-sm"><thead><tr className="border-y border-border text-left text-muted-foreground"><th className="px-6 py-3 font-medium">Inicio</th><th className="px-6 py-3 font-medium">Duración</th><th className="px-6 py-3 font-medium">Código</th><th className="px-6 py-3 font-medium">Mensaje</th><th className="px-6 py-3 font-medium">Estado</th></tr></thead><tbody>{incidents.map((incident) => {
              const firstLog = incidentLogs.find((log) => log.status === 'DOWN' && parseApiDate(log.created_at)! >= parseApiDate(incident.started_at)! && (!incident.resolved_at || parseApiDate(log.created_at)! <= parseApiDate(incident.resolved_at)!))
              return <tr key={incident.id} className="border-b border-border/60"><td className="px-6 py-4">{formatDate(incident.started_at)}</td><td className="px-6 py-4">{duration(incident.started_at, incident.resolved_at)}</td><td className="px-6 py-4">{firstLog?.status_code ?? '—'}</td><td className="max-w-xs truncate px-6 py-4 text-muted-foreground" title={firstLog?.error_detail || ''}>{firstLog?.error_detail || 'Sin detalles'}</td><td className="px-6 py-4">{incident.status === 'open' ? <Badge variant="danger">Abierto</Badge> : <Badge variant="secondary">Resuelto</Badge>}</td></tr>
            })}</tbody></table></div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
