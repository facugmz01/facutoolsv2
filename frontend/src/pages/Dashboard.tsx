import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Globe, AlertTriangle, DollarSign, Shield, Activity, TrendingUp, ArrowRight,
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { useDomains, useDashboardStats } from '../hooks'
import { useTheme } from '../theme/ThemeContext'

const COLORS_LIGHT = ['#0d9488', '#14b8a6', '#2dd4bf', '#5eead4', '#99f6e4']
const COLORS_DARK = ['#2dd4bf', '#14b8a6', '#0d9488', '#5eead4', '#134e4a']

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; color: string
}) {
  return (
    <div className="card flex items-start gap-4">
      <div className={`p-3 rounded-lg ${color}`}>
        <Icon size={22} />
      </div>
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold mt-1 text-foreground">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { t } = useTranslation()
  const { resolved } = useTheme()
  const { data: stats, loading: statsLoading, error: statsError } = useDashboardStats()
  const { data: domains, loading: domainsLoading, error: domainsError } = useDomains()

  const loading = statsLoading || domainsLoading
  const error = statsError || domainsError
  const list = domains ?? []
  const COLORS = resolved === 'dark' ? COLORS_DARK : COLORS_LIGHT
  const axis = resolved === 'dark' ? '#94a3b8' : '#64748b'
  const tooltipStyle = resolved === 'dark'
    ? { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, color: '#f1f5f9' }
    : { background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, color: '#0f172a' }

  if (loading) return <div className="text-muted-foreground">{t('dashboard.loading')}</div>
  if (!stats) return <div className="text-muted-foreground">{t('dashboard.noData')}</div>

  const registrarData = Object.entries(stats.by_registrar).map(([name, value]) => ({ name, value }))

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-foreground">{t('dashboard.title')}</h2>
        <p className="text-muted-foreground mt-1">{t('dashboard.subtitle')}</p>
      </div>

      {error && (
        <div className="card border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Globe} label={t('dashboard.stats.totalDomains')} value={stats.total_domains} color="bg-brand-50 dark:bg-brand-950/30 text-brand-700 dark:text-brand-400" />
        <StatCard icon={AlertTriangle} label={t('dashboard.stats.expiringSoon')} value={stats.expiring_soon} sub={t('dashboard.stats.within30Days')} color="bg-yellow-50 dark:bg-yellow-950/30 text-yellow-700 dark:text-yellow-400" />
        <StatCard icon={DollarSign} label={t('dashboard.stats.portfolioValue')} value={`$${stats.total_value.toLocaleString()}`} color="bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400" />
        <StatCard icon={Shield} label={t('dashboard.stats.sslExpiring')} value={stats.ssl_expiring_soon} sub={t('dashboard.stats.within30Days')} color="bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-foreground">
            <TrendingUp size={18} className="text-brand-600 dark:text-brand-400" /> {t('dashboard.portfolioTrend')}
          </h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={stats.portfolio_trend}>
              <XAxis dataKey="month" stroke={axis} fontSize={12} />
              <YAxis stroke={axis} fontSize={12} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="value" fill="#0d9488" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold mb-4 text-foreground">{t('dashboard.byRegistrar')}</h3>
          {registrarData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={registrarData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                  {registrarData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-muted-foreground text-center py-12">{t('dashboard.noDomainsYet')}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold flex items-center gap-2 text-foreground">
              <Activity size={18} className="text-green-600 dark:text-green-400" /> {t('dashboard.healthStatus')}
            </h3>
          </div>
          <div className="flex gap-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-green-600 dark:text-green-400">{stats.domains_up}</p>
              <p className="text-sm text-muted-foreground">{t('dashboard.online')}</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-red-600 dark:text-red-400">{stats.domains_down}</p>
              <p className="text-sm text-muted-foreground">{t('dashboard.offline')}</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-yellow-600 dark:text-yellow-400">{stats.recent_alerts}</p>
              <p className="text-sm text-muted-foreground">{t('dashboard.alerts7d')}</p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-foreground">{t('dashboard.recentDomains')}</h3>
            <Link to="/domains" className="text-brand-700 dark:text-brand-400 text-sm flex items-center gap-1 hover:underline">
              {t('dashboard.viewAll')} <ArrowRight size={14} />
            </Link>
          </div>
          {list.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">{t('dashboard.emptyState.text')} <Link to="/domains" className="text-brand-700 dark:text-brand-400">{t('dashboard.emptyState.cta')}</Link></p>
          ) : (
            <div className="space-y-3">
              {list.slice(0, 5).map(d => (
                <Link key={d.id} to={`/domains/${d.id}`} className="flex items-center justify-between p-3 rounded-lg hover:bg-surface-hover transition-colors">
                  <div>
                    <p className="font-medium text-foreground">{d.name}</p>
                    <p className="text-xs text-muted-foreground">{d.registrar || t('common.unknownRegistrar')}</p>
                  </div>
                  <span className={`badge ${d.latest_health?.is_up ? 'badge-success' : d.latest_health ? 'badge-danger' : 'badge-info'}`}>
                    {d.latest_health?.is_up ? t('dashboard.online') : d.latest_health ? t('dashboard.offline') : t('common.notScanned')}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
