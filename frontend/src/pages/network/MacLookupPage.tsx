import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api'
import ToolShell, { DataRow, ResultBox } from '../../components/network/ToolShell'

export default function MacLookupPage() {
  const { t } = useTranslation()
  const [mac, setMac] = useState('')
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const run = async () => {
    if (!mac.trim()) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      setResult(await api.network.mac(mac.trim()))
    } catch (e: any) {
      setError(e.message)
    }
    setLoading(false)
  }

  return (
    <ToolShell
      title={t('network.mac.title')}
      description={t('network.mac.description')}
    >
      <div className="card flex gap-3">
        <input className="input flex-1 font-mono" placeholder={t('network.mac.placeholder')} value={mac} onChange={e => setMac(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()} />
        <button onClick={run} disabled={loading} className="btn-primary">{loading ? t('network.mac.running') : t('network.mac.run')}</button>
      </div>

      <ResultBox error={error}>
        {result && (
          <div className="space-y-2">
            <DataRow label={t('network.mac.address')} value={<span className="font-mono">{result.mac}</span>} />
            <DataRow label={t('network.mac.vendor')} value={<span className="text-brand-700 dark:text-brand-400 font-semibold">{result.vendor}</span>} />
            <DataRow label={t('network.mac.ouiPrefix')} value={<span className="font-mono">{result.oui}</span>} />
            <DataRow label={t('network.mac.source')} value={result.source} />
          </div>
        )}
      </ResultBox>
    </ToolShell>
  )
}
