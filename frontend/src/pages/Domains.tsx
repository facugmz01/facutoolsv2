import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, Search, RefreshCw, Trash2, Upload, Globe } from 'lucide-react'
import { useDomains, useDomainMutations, filterDomains } from '../hooks'
import { formatDateTime } from '../utils/domainValidation'
import { api } from '../api'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Card, CardContent } from '../components/ui/card'
import { Badge } from '../components/ui/badge'

const BULK_IMPORT_CHUNK_SIZE = 250
const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i

function normalizeImportToken(value: string): string {
  let token = value.trim().replace(/^['"]|['"]$/g, '').toLowerCase()
  if (!token) return ''
  token = token.replace(/^https?:\/\//, '')
  token = token.split(/[/?#]/)[0]
  token = token.replace(/^www\.(?=.+\.)/, 'www.')
  return token.replace(/\.$/, '')
}

function parseDomainImport(text: string) {
  const seen = new Set<string>()
  const domains: string[] = []
  const invalid: string[] = []
  const tokens = text.split(/[\s,;]+/)
  for (const raw of tokens) {
    const domain = normalizeImportToken(raw)
    if (!domain) continue
    if (!DOMAIN_PATTERN.test(domain)) {
      invalid.push(raw.trim())
      continue
    }
    if (seen.has(domain)) continue
    seen.add(domain)
    domains.push(domain)
  }
  return { domains, invalid }
}

function wait(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

export default function Domains() {
  const { t } = useTranslation()
  const { data: domains, loading, error, reload } = useDomains()
  const { scanningId, error: mutationError, remove, scan } = useDomainMutations({ onSuccess: reload })

  const [search, setSearch] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importProgress, setImportProgress] = useState<{
    total: number
    processed: number
    created: number
    skipped: number
    invalid: number
  } | null>(null)

  const list = domains ?? []
  const filtered = filterDomains(list, search)
  const displayError = error || mutationError || importError
  const nextScanAt = list.find(d => d.next_scan_at)?.next_scan_at ?? null

  const handleScan = (id: number) => scan(id)

  const handleDelete = async (id: number) => {
    if (!confirm(t('domains.list.deleteConfirm'))) return
    await remove(id)
  }

  const handleBulkImport = async () => {
    const parsed = parseDomainImport(importText)
    if (!parsed.domains.length) {
      setImportError(t('domains.list.bulkImportNoValidDomains', { defaultValue: 'No valid domains found.' }))
      return
    }

    setImporting(true)
    setImportError(null)
    setImportProgress({ total: parsed.domains.length, processed: 0, created: 0, skipped: 0, invalid: parsed.invalid.length })

    try {
      let processedBase = 0
      let created = 0
      let skipped = 0
      let invalid = parsed.invalid.length

      for (let index = 0; index < parsed.domains.length; index += BULK_IMPORT_CHUNK_SIZE) {
        const chunk = parsed.domains.slice(index, index + BULK_IMPORT_CHUNK_SIZE)
        const started = await api.domains.startBulkImportJob(chunk.map(name => ({ name })))
        let job = started
        while (job.status === 'queued' || job.status === 'running') {
          setImportProgress({
            total: parsed.domains.length,
            processed: processedBase + Math.min(job.processed, chunk.length),
            created: created + job.created,
            skipped: skipped + job.skipped_existing + job.skipped_duplicates,
            invalid: invalid + job.invalid,
          })
          await wait(600)
          job = await api.domains.bulkImportJob(job.id)
        }
        if (job.status === 'failed') throw new Error(job.error || t('errors.generic'))

        processedBase += chunk.length
        created += job.created
        skipped += job.skipped_existing + job.skipped_duplicates
        invalid += job.invalid
        setImportProgress({ total: parsed.domains.length, processed: processedBase, created, skipped, invalid })
      }

      await reload()
      setImportText('')
    } catch (e) {
      setImportError(e instanceof Error ? e.message : t('errors.generic'))
    } finally {
      setImporting(false)
    }
  }

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return
    const text = await file.text()
    setImportText(text)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight">{t('domains.list.title')}</h2>
          <p className="text-muted-foreground mt-1">{t('domains.list.subtitle', { count: list.length })}</p>
          {nextScanAt && (
            <p className="text-xs text-muted-foreground mt-1">
              {t('domains.list.nextScanScheduled', { date: formatDateTime(nextScanAt) })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Button variant="secondary" onClick={() => setImportOpen(v => !v)}>
            <Upload size={16} /> {t('domains.list.import')}
          </Button>
          <Button asChild>
            <Link to="/domains/add">
              <Plus size={16} /> {t('domains.list.addDomain')}
            </Link>
          </Button>
        </div>
      </div>

      {displayError && (
        <Card className="border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-sm">
          <CardContent className="p-0">{displayError}</CardContent>
        </Card>
      )}

      {importOpen && (
        <Card className="p-0">
          <CardContent className="space-y-4 p-4">
            <div>
              <h3 className="font-semibold text-foreground">{t('domains.list.bulkImportTitle', { defaultValue: 'Bulk import domains' })}</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {t('domains.list.bulkImportHelp', { defaultValue: 'Paste domains or upload a CSV/TXT file. URLs, empty lines and duplicates are cleaned before import.' })}
              </p>
            </div>
            <textarea
              className="input min-h-[160px] w-full"
              value={importText}
              onChange={e => setImportText(e.target.value)}
              placeholder={t('domains.list.bulkImportPrompt')}
              disabled={importing}
            />
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                disabled={importing}
                onChange={e => handleImportFile(e.target.files?.[0])}
                className="text-sm text-muted-foreground"
              />
              <Button onClick={handleBulkImport} disabled={importing || !importText.trim()}>
                <Upload size={16} /> {importing ? t('common.loading') : t('domains.list.import')}
              </Button>
              <Button variant="secondary" onClick={() => setImportOpen(false)} disabled={importing}>
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </Button>
            </div>
            {importProgress && (
              <div className="space-y-2">
                <div className="h-2 overflow-hidden rounded bg-muted">
                  <div
                    className="h-full bg-brand-600 transition-all"
                    style={{ width: `${Math.min(100, Math.round((importProgress.processed / Math.max(importProgress.total, 1)) * 100))}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('domains.list.bulkImportProgress', {
                    defaultValue: 'Processed {{processed}}/{{total}}. Created: {{created}}. Skipped: {{skipped}}. Invalid: {{invalid}}.',
                    processed: importProgress.processed,
                    total: importProgress.total,
                    created: importProgress.created,
                    skipped: importProgress.skipped,
                    invalid: importProgress.invalid,
                  })}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          className="pl-10"
          placeholder={t('domains.list.searchPlaceholder')}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {!loading && filtered.length === 0 ? (
        <Card className="text-center py-14">
          <Globe size={40} className="mx-auto text-muted-foreground mb-4" />
          <p className="text-foreground font-medium">{t('domains.list.empty')}</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            {search
              ? t('domains.list.emptySearch', { defaultValue: 'No domains match your search.' })
              : t('domains.list.emptyHint', { defaultValue: 'Add your first domain to start monitoring DNS, SSL and uptime.' })}
          </p>
          {!search && (
            <Button asChild className="mt-5">
              <Link to="/domains/add">
                <Plus size={16} /> {t('domains.list.addDomain')}
              </Link>
            </Button>
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="border-b border-border text-left text-sm text-muted-foreground bg-muted/40">
                  <th className="p-4 font-medium">{t('domains.list.columns.domain')}</th>
                  <th className="p-4 font-medium">{t('domains.list.columns.registrar')}</th>
                  <th className="p-4 font-medium">{t('domains.list.columns.status')}</th>
                  <th className="p-4 font-medium">{t('domains.list.columns.expires')}</th>
                  <th className="p-4 font-medium">{t('domains.list.columns.health')}</th>
                  <th className="p-4 font-medium">{t('domains.list.columns.lastScan')}</th>
                  <th className="p-4 font-medium">{t('domains.list.columns.value')}</th>
                  <th className="p-4 font-medium">{t('domains.list.columns.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted-foreground">{t('domains.list.loading')}</td>
                  </tr>
                ) : filtered.map(d => (
                  <tr key={d.id} className="border-b border-border/60 hover:bg-surface-hover/80">
                    <td className="p-4">
                      <Link to={`/domains/${d.id}`} className="font-medium text-brand-700 dark:text-brand-400 hover:underline">
                        {d.name}
                      </Link>
                      {d.tags.length > 0 && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {d.tags.map(tag => <Badge key={tag} variant="info">{tag}</Badge>)}
                        </div>
                      )}
                    </td>
                    <td className="p-4 text-muted-foreground">{d.registrar || '—'}</td>
                    <td className="p-4"><Badge variant="success">{d.status}</Badge></td>
                    <td className="p-4 text-muted-foreground">
                      {d.days_until_expiry != null ? (
                        <span className={d.days_until_expiry <= 30 ? 'text-yellow-600 dark:text-yellow-400 font-medium' : ''}>
                          {t('domains.list.daysShort', { count: d.days_until_expiry })}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="p-4">
                      <Badge variant={d.latest_health?.is_up ? 'success' : d.latest_health ? 'danger' : 'info'}>
                        {d.latest_health?.is_up ? `${d.latest_health.response_time_ms}ms` : d.latest_health ? t('domains.list.down') : '—'}
                      </Badge>
                    </td>
                    <td className="p-4 text-muted-foreground text-sm">
                      {formatDateTime(d.last_scanned_at || d.latest_health?.checked_at)}
                    </td>
                    <td className="p-4 text-muted-foreground">{d.estimated_value ? `$${d.estimated_value}` : '—'}</td>
                    <td className="p-4">
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleScan(d.id)}
                          disabled={scanningId === d.id}
                          aria-label={t('domains.list.scan', { defaultValue: 'Scan' })}
                        >
                          <RefreshCw size={16} className={scanningId === d.id ? 'animate-spin' : ''} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(d.id)}
                          className="hover:text-red-600"
                          aria-label={t('domains.list.delete', { defaultValue: 'Delete' })}
                        >
                          <Trash2 size={16} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
