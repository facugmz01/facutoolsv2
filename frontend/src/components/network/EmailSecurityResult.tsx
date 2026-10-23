import { useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronUp, CircleAlert, Copy, Mail, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { EmailSecurityReport } from '../../api'
import { Badge, DataRow } from './ToolShell'

function CheckCard({
  title,
  found,
  valid,
  detail,
  rawValue,
  expanded,
  onToggle,
  onCopy,
}: {
  title: string
  found: boolean
  valid?: boolean
  detail?: string
  rawValue?: string
  expanded: boolean
  onToggle: () => void
  onCopy: () => void
}) {
  const { t } = useTranslation()
  const ok = found && valid !== false

  return (
    <div className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {ok ? <CheckCircle2 size={18} className="shrink-0 text-green-600" /> : <CircleAlert size={18} className="shrink-0 text-amber-600" />}
          <h3 className="font-semibold">{title}</h3>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={ok ? 'ok' : 'warn'}>{ok ? t('emailSecurity.ok') : t('emailSecurity.review')}</Badge>
          {rawValue && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:text-foreground"
              onClick={onCopy}
              aria-label={`${t('emailSecurity.record')} ${title}`}
            >
              <Copy size={12} />
              {t('emailSecurity.copy')}
            </button>
          )}
        </div>
      </div>

      {detail && (
        <p className="mt-3 text-sm text-muted-foreground">
          {detail}
        </p>
      )}

      {rawValue && (
        <div className="mt-3">
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-md border border-border bg-muted/30 px-2.5 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
            onClick={onToggle}
          >
            <span>{t('emailSecurity.record')}</span>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {expanded && (
            <pre className="mt-2 whitespace-pre-wrap break-words rounded-md border border-border/80 bg-muted/20 px-2.5 py-2.5 font-mono text-xs leading-5 text-foreground">{rawValue}</pre>
          )}
        </div>
      )}
    </div>
  )
}

export default function EmailSecurityResult({ result }: { result: EmailSecurityReport }) {
  const { t } = useTranslation()
  const scoreVariant = result.score >= 80 ? 'ok' : result.score >= 50 ? 'warn' : 'danger'
  const dkimSelectors = result.dkim.selectors || []
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ spf: true, dkim: true, dmarc: true })

  const copyAll = async () => {
    const chunks = [
      result.spf.record ? `SPF\n${result.spf.record}` : null,
      result.dmarc.record ? `DMARC\n${result.dmarc.record}` : null,
      dkimSelectors.length ? `DKIM\n${dkimSelectors.join('\n')}` : null,
    ].filter(Boolean) as string[]

    if (!chunks.length) return

    try {
      await navigator.clipboard.writeText(chunks.join('\n\n'))
    } catch {
      // optional clipboard
    }
  }

  const toggleAll = () => {
    const next = !Object.values(expanded).every(Boolean)
    setExpanded({ spf: next, dkim: next, dmarc: next })
  }

  const copyEntry = async (key: 'spf' | 'dkim' | 'dmarc') => {
    const raw =
      key === 'spf' ? result.spf.record :
      key === 'dkim' ? dkimSelectors.join('\n') :
      result.dmarc.record

    if (!raw) return

    try {
      await navigator.clipboard.writeText(raw)
    } catch {
      // optional clipboard
    }
  }

  return (
    <section className="min-w-0 space-y-5" aria-label={t('tools.results')}>
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
            <ShieldCheck size={24} />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t('emailSecurity.scoreLabel')}</p>
            <p className="text-3xl font-bold tabular-nums">{result.score}<span className="text-base font-normal text-muted-foreground">/100</span></p>
          </div>
        </div>
        <div className="min-w-0 sm:max-w-sm sm:text-right">
          <p className="break-all font-semibold">{result.domain}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('emailSecurity.scoreDescription')}</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" aria-label={t('emailSecurity.scoreLabel')}>
            <div className={`h-full rounded-full ${scoreVariant === 'ok' ? 'bg-green-500' : scoreVariant === 'warn' ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${result.score}%` }} />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground"
          onClick={toggleAll}
        >
          {Object.values(expanded).every(Boolean) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {Object.values(expanded).every(Boolean) ? t('emailSecurity.collapseAll') : t('emailSecurity.expandAll')}
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground"
          onClick={copyAll}
        >
          <Copy size={14} />
          {t('emailSecurity.copyAll')}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <CheckCard
          title="SPF"
          found={result.spf.found}
          valid={result.spf.valid}
          detail={result.spf.record ? t('emailSecurity.spfDetail') : t('emailSecurity.notFound')}
          rawValue={result.spf.record || undefined}
          expanded={expanded.spf}
          onToggle={() => setExpanded((prev) => ({ ...prev, spf: !prev.spf }))}
          onCopy={() => copyEntry('spf')}
        />
        <CheckCard
          title="DMARC"
          found={result.dmarc.found}
          detail={result.dmarc.policy ? `${t('emailSecurity.policy')}: ${result.dmarc.policy}` : t('emailSecurity.notFound')}
          rawValue={result.dmarc.record || undefined}
          expanded={expanded.dmarc}
          onToggle={() => setExpanded((prev) => ({ ...prev, dmarc: !prev.dmarc }))}
          onCopy={() => copyEntry('dmarc')}
        />
        <CheckCard
          title="DKIM"
          found={result.dkim.found}
          detail={dkimSelectors.length ? `${t('emailSecurity.selectors')}: ${dkimSelectors.join(', ')}` : t('emailSecurity.notFound')}
          rawValue={dkimSelectors.length ? dkimSelectors.join('\n') : undefined}
          expanded={expanded.dkim}
          onToggle={() => setExpanded((prev) => ({ ...prev, dkim: !prev.dkim }))}
          onCopy={() => copyEntry('dkim')}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <Mail size={18} className="text-brand-600" />
            <h3 className="font-semibold">{t('emailSecurity.mxTitle')}</h3>
          </div>
          {result.mx_records.length ? result.mx_records.map(record => <DataRow key={record} label="MX" value={record} />) : <p className="text-sm text-muted-foreground">{t('emailSecurity.notFound')}</p>}
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <CircleAlert size={18} className="text-amber-600" />
            <h3 className="font-semibold">{t('emailSecurity.recommendationsTitle')}</h3>
          </div>
          {result.recommendations.length ? (
            <ul className="space-y-2 text-sm text-muted-foreground">
              {result.recommendations.map((recommendation, index) => <li key={`${recommendation}-${index}`} className="flex gap-2"><span className="text-amber-600">•</span><span>{recommendation}</span></li>)}
            </ul>
          ) : <p className="text-sm text-green-700 dark:text-green-400">{t('emailSecurity.noRecommendations')}</p>}
        </div>
      </div>
    </section>
  )
}
