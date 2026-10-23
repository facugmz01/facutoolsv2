import { FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Shield, Mail, Radar, Play } from 'lucide-react'
import { api, type EmailSecurityReport, type SSLCheckResult, type SubdomainDiscoveryResult } from '../api'
import ToolShell, { ResultBox } from '../components/network/ToolShell'
import SubdomainDiscoveryResults from '../components/network/SubdomainDiscoveryResults'
import SslCheckResult from '../components/network/SslCheckResult'
import EmailSecurityResult from '../components/network/EmailSecurityResult'

export const domainTools = [
  { id: 'ssl', icon: Shield, group: 'security' },
  { id: 'email', icon: Mail, group: 'email' },
  { id: 'subdomains', icon: Radar, group: 'domains' },
] as const

type DomainToolId = typeof domainTools[number]['id']

export default function Tools({ tool }: { tool: DomainToolId }) {
  const { t } = useTranslation()
  const [domain, setDomain] = useState('')
  const [result, setResult] = useState<unknown>(null)
  const [discovery, setDiscovery] = useState<SubdomainDiscoveryResult | null>(null)
  const [sslResult, setSslResult] = useState<SSLCheckResult | null>(null)
  const [emailResult, setEmailResult] = useState<EmailSecurityReport | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const runTool = async (event: FormEvent) => {
    event.preventDefault()
    if (loading || !domain.trim()) return
    setLoading(true)
    setResult(null)
    setDiscovery(null)
    setSslResult(null)
    setEmailResult(null)
    setError('')
    try {
      let res
      switch (tool) {
        case 'ssl': setSslResult(await api.tools.ssl(domain.trim())); break
        case 'email': setEmailResult(await api.tools.emailSecurity(domain.trim())); break
        case 'subdomains': setDiscovery(await api.tools.subdomains(domain.trim())); break
      }
      if (tool === 'email') setResult(null)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  return (
    <ToolShell title={t(`tools.items.${tool}.label`)} description={t(`tools.items.${tool}.desc`)}>
      <form className="card" onSubmit={runTool}>
        <div className="flex flex-col sm:flex-row gap-3">
          <input required disabled={loading} className="input min-w-0 flex-1" aria-label={t('tools.domainPlaceholder')} placeholder={t('tools.domainPlaceholder')} value={domain} onChange={event => setDomain(event.target.value)} />
          <button type="submit" disabled={loading} className="btn-primary inline-flex items-center justify-center gap-2 shrink-0">
            <Play size={16} />
            {loading ? t('tools.running') : t('tools.run')}
          </button>
        </div>
      </form>

      {loading && tool === 'subdomains' && <p role="status" className="text-sm text-muted-foreground">{t('discovery.loading')}</p>}
      {discovery && <SubdomainDiscoveryResults result={discovery} />}
      {sslResult && <SslCheckResult result={sslResult} />}
      {emailResult && <EmailSecurityResult result={emailResult} />}
      <ResultBox error={error}>
        {result !== null && (
          <div>
            <h3 className="font-semibold mb-4">{t('tools.results')}</h3>
            <pre className="text-sm text-foreground-secondary overflow-auto max-h-96 bg-muted p-4 rounded-lg">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </ResultBox>
    </ToolShell>
  )
}
