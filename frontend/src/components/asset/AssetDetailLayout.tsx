import { Link } from 'react-router-dom'
import { ChevronRight, Loader2 } from 'lucide-react'

export interface BreadcrumbItem {
  label: string
  to?: string
}

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav className="flex items-center gap-1 text-sm text-muted-foreground flex-wrap">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight size={14} className="text-muted-foreground shrink-0" />}
          {item.to ? (
            <Link to={item.to} className="hover:text-foreground transition-colors">{item.label}</Link>
          ) : (
            <span className="text-muted-foreground">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

export function AssetHero({
  favicon,
  title,
  subtitle,
  badges,
  actions,
}: {
  favicon: string
  title: string
  subtitle?: React.ReactNode
  badges?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-surface via-surface to-brand-50 dark:to-brand-950/40 p-6 shadow-sm">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-brand-500/10 via-transparent to-transparent pointer-events-none" />
      <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-5">
        <div className="flex items-start gap-4 min-w-0">
          <div className="shrink-0 w-14 h-14 rounded-xl bg-canvas border border-border flex items-center justify-center shadow-sm">
            <img src={favicon} alt="" className="w-8 h-8 rounded" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight truncate text-foreground">{title}</h1>
            {subtitle && <div className="text-muted-foreground text-sm mt-1">{subtitle}</div>}
            {badges && <div className="flex flex-wrap gap-2 mt-3">{badges}</div>}
          </div>
        </div>
        {actions && <div className="flex gap-2 flex-wrap shrink-0">{actions}</div>}
      </div>
    </div>
  )
}

export function StatusBadge({
  label,
  variant = 'neutral',
}: {
  label: string
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'neutral'
}) {
  const styles = {
    success: 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-900/40',
    warning: 'bg-yellow-50 dark:bg-yellow-950/30 text-yellow-800 dark:text-yellow-400 border-yellow-200 dark:border-yellow-900/40',
    danger: 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-900/40',
    info: 'bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-900/40',
    neutral: 'bg-canvas text-muted-foreground border-border',
  }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${styles[variant]}`}>
      {variant === 'success' && <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />}
      {variant === 'danger' && <span className="w-1.5 h-1.5 rounded-full bg-red-500" />}
      {label}
    </span>
  )
}

export function QuickStat({
  label,
  value,
  sub,
  icon: Icon,
  accent = 'brand',
}: {
  label: string
  value: string | number
  sub?: string
  icon?: React.ElementType
  accent?: 'brand' | 'green' | 'yellow' | 'red' | 'blue'
}) {
  const styles = {
    brand: { card: 'border-brand-200 dark:border-brand-800/40', icon: 'bg-brand-50 dark:bg-brand-950/30 text-brand-700 dark:text-brand-400' },
    green: { card: 'border-green-200 dark:border-green-900/40', icon: 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400' },
    yellow: { card: 'border-yellow-200 dark:border-yellow-900/40', icon: 'bg-yellow-50 dark:bg-yellow-950/30 text-yellow-700' },
    red: { card: 'border-red-200 dark:border-red-900/40', icon: 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400' },
    blue: { card: 'border-sky-200 dark:border-sky-900/40', icon: 'bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-400' },
  }
  const s = styles[accent]
  return (
    <div className={`rounded-xl border bg-surface p-4 shadow-sm ${s.card}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
          <p className="text-xl font-bold mt-1 truncate capitalize text-foreground">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</p>}
        </div>
        {Icon && (
          <div className={`p-2 rounded-lg ${s.icon}`}>
            <Icon size={18} />
          </div>
        )}
      </div>
    </div>
  )
}

export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function DetailLoading({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <Loader2 size={32} className="text-brand-600 animate-spin" />
      <p className="text-muted-foreground">{label}</p>
    </div>
  )
}

export function DetailNotFound({ label, backTo, backLabel }: { label: string; backTo: string; backLabel: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <p className="text-muted-foreground text-lg">{label}</p>
      <Link to={backTo} className="btn-primary text-sm">{backLabel}</Link>
    </div>
  )
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-red-700 dark:text-red-400 text-sm flex items-center gap-2">
      <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
      {message}
    </div>
  )
}

export function ActionButton({
  onClick,
  href,
  variant = 'secondary',
  danger,
  disabled,
  children,
}: {
  onClick?: () => void
  href?: string
  variant?: 'primary' | 'secondary'
  danger?: boolean
  disabled?: boolean
  children: React.ReactNode
}) {
  const base = variant === 'primary' ? 'btn-primary' : 'btn-secondary'
  const dangerCls = danger ? 'text-red-600 border-red-200 dark:border-red-900/40 hover:bg-red-50 dark:hover:bg-red-950/40 dark:bg-red-950/30' : ''
  const cls = `${base} text-sm flex items-center gap-2 ${dangerCls} disabled:opacity-50`

  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {children}
      </a>
    )
  }
  return (
    <button onClick={onClick} disabled={disabled} className={cls}>
      {children}
    </button>
  )
}

export function EmptyHint({ icon: Icon, title, hint }: { icon?: React.ElementType; title: string; hint?: string }) {
  return (
    <div className="text-center py-6 px-4">
      {Icon && <Icon size={28} className="mx-auto text-muted-foreground mb-2" />}
      <p className="text-sm text-muted-foreground">{title}</p>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  )
}
