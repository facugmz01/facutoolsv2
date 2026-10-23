import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy } from 'lucide-react'
import ToolShell, { Badge, ResultBox } from '../../components/network/ToolShell'

type Strength = 'weak' | 'good' | 'strong' | ''

export default function ContrasenasPage() {
  const { t } = useTranslation()
  const [length, setLength] = useState(16)
  const [upper, setUpper] = useState(true)
  const [lower, setLower] = useState(true)
  const [nums, setNums] = useState(true)
  const [syms, setSyms] = useState(true)
  const [password, setPassword] = useState('')
  const [strength, setStrength] = useState<Strength>('')

  const generate = () => {
    const chars = {
      upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      lower: 'abcdefghijklmnopqrstuvwxyz',
      num: '0123456789',
      sym: '!@#$%^&*()_+~`|}{[]:;?><,./-=',
    }
    let allowed = ''
    if (upper) allowed += chars.upper
    if (lower) allowed += chars.lower
    if (nums) allowed += chars.num
    if (syms) allowed += chars.sym
    if (!allowed) return

    const array = new Uint32Array(length)
    crypto.getRandomValues(array)
    let pass = ''
    for (let i = 0; i < length; i++) pass += allowed[array[i] % allowed.length]
    setPassword(pass)

    const entropy = Math.log2(allowed.length) * length
    if (entropy < 40) setStrength('weak')
    else if (entropy < 60) setStrength('good')
    else setStrength('strong')
  }

  const copy = () => navigator.clipboard.writeText(password)

  const strengthLabel = strength === 'weak' ? t('network.passwords.strengthWeak')
    : strength === 'good' ? t('network.passwords.strengthGood')
      : strength === 'strong' ? t('network.passwords.strengthStrong')
        : ''

  const options: [string, boolean, (v: boolean) => void][] = [
    [t('network.passwords.uppercase'), upper, setUpper],
    [t('network.passwords.lowercase'), lower, setLower],
    [t('network.passwords.numbers'), nums, setNums],
    [t('network.passwords.symbols'), syms, setSyms],
  ]

  return (
    <ToolShell
      title={t('network.passwords.title')}
      description={t('network.passwords.description')}
    >
      <div className="card space-y-4">
        <div>
          <label className="text-sm text-muted-foreground">{t('network.passwords.lengthLabel', { count: length })}</label>
          <input type="range" min={8} max={64} value={length} onChange={e => setLength(+e.target.value)} className="w-full mt-1" />
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          {options.map(([label, val, set]) => (
            <label key={label} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={val} onChange={e => set(e.target.checked)} />
              {label}
            </label>
          ))}
        </div>
        <button onClick={generate} className="btn-primary w-full">{t('network.passwords.generate')}</button>
      </div>

      <ResultBox>
        {password ? (
          <div className="text-center space-y-3">
            <p className="font-mono text-2xl break-all">{password}</p>
            <div className="flex justify-center gap-3">
              <button onClick={copy} className="btn-secondary flex items-center gap-2 text-sm"><Copy size={14} /> {t('network.passwords.copy')}</button>
              <Badge variant={strength === 'strong' ? 'ok' : strength === 'good' ? 'warn' : 'danger'}>{t('network.passwords.strengthLabel', { strength: strengthLabel })}</Badge>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm text-center">{t('network.passwords.emptyState')}</p>
        )}
      </ResultBox>
    </ToolShell>
  )
}
