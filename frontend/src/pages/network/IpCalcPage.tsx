import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ToolShell, { DataRow, ResultBox } from '../../components/network/ToolShell'

function calculateSubnet(ipStr: string, cidr: number) {
  const ipParts = ipStr.split('.').map(Number)
  const ipInt = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3]
  const maskInt = ~((1 << (32 - cidr)) - 1) >>> 0
  const networkInt = (ipInt & maskInt) >>> 0
  const broadcastInt = (networkInt | (~maskInt >>> 0)) >>> 0
  const intToIp = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
  const numHosts = cidr >= 31 ? 0 : Math.pow(2, 32 - cidr) - 2
  return { mask: intToIp(maskInt), network: intToIp(networkInt), broadcast: intToIp(broadcastInt), first: cidr < 31 ? intToIp(networkInt + 1) : 'N/A', last: cidr < 31 ? intToIp(broadcastInt - 1) : 'N/A', hosts: numHosts }
}

export default function IpCalcPage() {
  const { t } = useTranslation()
  const [input, setInput] = useState('192.168.1.10/24')
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')

  const run = () => {
    setError('')
    const [ipStr, cidrStr] = input.trim().split('/')
    const cidr = parseInt(cidrStr || '24', 10)
    if (!ipStr?.match(/^(\d{1,3}\.){3}\d{1,3}$/) || isNaN(cidr) || cidr < 0 || cidr > 32) {
      setError(t('network.ipCalc.invalidFormat'))
      return
    }
    const parts = ipStr.split('.').map(Number)
    if (parts.some(p => p < 0 || p > 255)) {
      setError(t('network.ipCalc.octetOutOfRange'))
      return
    }
    setResult({ ip: ipStr, cidr, ...calculateSubnet(ipStr, cidr) })
  }

  return (
    <ToolShell
      title={t('network.ipCalc.title')}
      description={t('network.ipCalc.description')}
    >
      <div className="card flex gap-3">
        <input className="input flex-1 font-mono" placeholder={t('network.ipCalc.placeholder')} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()} />
        <button onClick={run} className="btn-primary">{t('network.ipCalc.run')}</button>
      </div>

      <ResultBox error={error}>
        {result && (
          <div className="space-y-1">
            <DataRow label={t('network.ipCalc.originalIp')} value={result.ip} />
            <DataRow label={t('network.ipCalc.mask')} value={`${result.mask} (/${result.cidr})`} />
            <DataRow label={t('network.ipCalc.network')} value={<span className="text-brand-700 dark:text-brand-400">{result.network}</span>} />
            <DataRow label={t('network.ipCalc.broadcast')} value={result.broadcast} />
            <DataRow label={t('network.ipCalc.firstHost')} value={result.first} />
            <DataRow label={t('network.ipCalc.lastHost')} value={result.last} />
            <DataRow label={t('network.ipCalc.usableHosts')} value={result.hosts.toLocaleString()} />
          </div>
        )}
      </ResultBox>
    </ToolShell>
  )
}
