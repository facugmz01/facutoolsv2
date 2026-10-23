import { useTranslation } from 'react-i18next'
import { CheckCircle2, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { SSLCheckResult } from '../../api'
import { Badge, DataRow } from './ToolShell'
import { getSystemTimeZone, parseApiDate } from '../../utils/datetime'

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = parseApiDate(value)
  if (!date) return value
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: getSystemTimeZone(),
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).format(date)
}

export default function SslCheckResult({ result }: { result: SSLCheckResult }) {
  const { t } = useTranslation()
  const expiryVariant = result.days_remaining === null ? 'dim'
    : result.days_remaining < 0 ? 'danger'
    : result.days_remaining < 30 ? 'warn' : 'ok'

  return (
    <section className="min-w-0 space-y-4" aria-label={t('tools.results')}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={result.trusted ? 'ok' : 'danger'}>
          {result.trusted ? <ShieldCheck size={14} className="mr-1 inline" /> : <ShieldAlert size={14} className="mr-1 inline" />}
          {result.trusted ? t('sslCheck.trusted') : t('sslCheck.untrusted')}
        </Badge>
        {result.is_self_signed && <Badge variant="warn">{t('sslCheck.selfSigned')}</Badge>}
        <Badge variant={expiryVariant}>
          {result.days_remaining === null ? t('sslCheck.unknownExpiry')
            : result.days_remaining < 0 ? t('sslCheck.expiredSince', { count: Math.abs(result.days_remaining) })
            : t('sslCheck.daysRemaining', { count: result.days_remaining })}
        </Badge>
        {result.protocol && <Badge variant="info">{result.protocol}</Badge>}
      </div>

      {!result.trusted && result.trust_error && (
        <div role="status" className="border-l-2 border-amber-500 bg-amber-500/10 p-3 text-sm">
          {t('sslCheck.trustErrorPrefix')}: {result.trust_error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="mb-2 font-semibold">{t('sslCheck.certificateTitle')}</h3>
          <DataRow label={t('sslCheck.subject')} value={result.subject || '—'} />
          <DataRow label={t('sslCheck.issuer')} value={result.issuer || '—'} />
          <DataRow label={t('sslCheck.validFrom')} value={formatDate(result.valid_from)} />
          <DataRow label={t('sslCheck.validUntil')} value={formatDate(result.valid_until)} />
          <DataRow label={t('sslCheck.serial')} value={result.serial_number || '—'} />
        </div>
        <div>
          <h3 className="mb-2 font-semibold">{t('sslCheck.technicalTitle')}</h3>
          <DataRow label={t('sslCheck.cipher')} value={result.cipher || '—'} />
          <DataRow label={t('sslCheck.signatureAlgorithm')} value={result.signature_algorithm || '—'} />
          <DataRow
            label={t('sslCheck.publicKey')}
            value={result.key_type ? `${result.key_type}${result.key_bits ? ` (${result.key_bits} bits)` : ''}` : '—'}
          />
        </div>
      </div>

      {result.sans.length > 0 && (
        <div>
          <h3 className="mb-2 font-semibold">{t('sslCheck.sansTitle')}</h3>
          <div className="flex flex-wrap gap-2">
            {result.sans.map(name => (
              <span key={name} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 font-mono text-xs">
                <CheckCircle2 size={12} className="text-brand-600" />{name}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
