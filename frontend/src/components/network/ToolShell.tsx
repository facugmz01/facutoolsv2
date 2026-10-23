import { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'
import { Card } from '../ui/card'

interface ToolShellProps {
  title: string
  description: string
  children: ReactNode
  actions?: ReactNode
  backTo?: string
}

export default function ToolShell({ title, description, children, actions, backTo = '/' }: ToolShellProps) {
  const { t } = useTranslation()
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-foreground tracking-tight">{title}</h2>
          <p className="text-muted-foreground mt-1">{description}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {actions}
          <Button variant="secondary" size="sm" asChild>
            <Link to={backTo}>
              <ArrowLeft size={16} /> {t('network.back')}
            </Link>
          </Button>
        </div>
      </div>
      {children}
    </div>
  )
}

export function ResultBox({ children, error }: { children?: ReactNode; error?: string }) {
  if (error) {
    return (
      <Card className="border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30">
        <p className="text-red-700 dark:text-red-400 text-sm">⚠ {error}</p>
      </Card>
    )
  }
  if (!children) return null
  return <Card>{children}</Card>
}

export function DataRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-border last:border-0 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-foreground text-right break-all">{value}</span>
    </div>
  )
}

export function Badge({ children, variant = 'info' }: { children: ReactNode; variant?: 'ok' | 'warn' | 'danger' | 'info' | 'dim' }) {
  const cls = {
    ok: 'badge-success', warn: 'badge-warning', danger: 'badge-danger',
    info: 'badge-info', dim: 'bg-muted text-muted-foreground',
  }[variant]
  return <span className={`badge ${cls}`}>{children}</span>
}
