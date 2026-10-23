import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Download, ShieldAlert, Upload } from 'lucide-react'
import { api, type SSLConvertResult } from '../../api'
import { formatDateTime } from '../../utils/datetime'
import ToolShell, { Badge, DataRow, ResultBox } from '../../components/network/ToolShell'

type ConvertResult = SSLConvertResult

const INPUT_FORMAT_IDS = ['auto', 'pem', 'der', 'pkcs12', 'pkcs7'] as const

const OUTPUT_FORMATS = [
  { id: 'pem', key: 'pem', needsKey: false },
  { id: 'pem_full', key: 'pemFull', needsKey: false },
  { id: 'pem_bundle', key: 'pemBundle', needsKey: true },
  { id: 'pem_key', key: 'pemKey', needsKey: true },
  { id: 'pem_key_rsa', key: 'pemKeyRsa', needsKey: true },
  { id: 'der', key: 'der', needsKey: false },
  { id: 'der_key', key: 'derKey', needsKey: true },
  { id: 'pkcs12', key: 'pkcs12', needsKey: true },
  { id: 'pkcs7', key: 'pkcs7', needsKey: false },
]

function fileToContent(file: File, readFileErrorMsg: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(readFileErrorMsg))
    reader.onload = () => {
      const buf = reader.result as ArrayBuffer
      const bytes = new Uint8Array(buf)
      // Heuristic: if it looks like text/PEM, decode as UTF-8; else Base64
      const sample = bytes.slice(0, Math.min(64, bytes.length))
      const asText = new TextDecoder('utf-8', { fatal: false }).decode(sample)
      if (asText.includes('-----BEGIN') || /^[\x09\x0a\x0d\x20-\x7e]*$/.test(asText)) {
        resolve(new TextDecoder('utf-8').decode(bytes))
      } else {
        let binary = ''
        bytes.forEach(b => { binary += String.fromCharCode(b) })
        resolve(btoa(binary))
      }
    }
    reader.readAsArrayBuffer(file)
  })
}

function downloadResult(result: ConvertResult) {
  let blob: Blob
  if (result.encoding === 'base64') {
    const bin = atob(result.content)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    blob = new Blob([bytes], { type: result.content_type })
  } else {
    blob = new Blob([result.content], { type: result.content_type })
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = result.filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function SslConverterPage() {
  const { t, i18n } = useTranslation()
  const [content, setContent] = useState('')
  const [chainCert, setChainCert] = useState('')
  const [extraKey, setExtraKey] = useState('')
  const [inputFormat, setInputFormat] = useState('auto')
  const [outputFormat, setOutputFormat] = useState('pem')
  const [password, setPassword] = useState('')
  const [outputPassword, setOutputPassword] = useState('')
  const [friendlyName, setFriendlyName] = useState('certificate')
  const [result, setResult] = useState<ConvertResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')
  const [chainFileName, setChainFileName] = useState('')
  const [keyFileName, setKeyFileName] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const keyRef = useRef<HTMLInputElement>(null)
  const chainRef = useRef<HTMLInputElement>(null)

  const needsOutPassword = outputFormat === 'pkcs12'
  const selectedOut = OUTPUT_FORMATS.find(f => f.id === outputFormat)
  const outputExt = ({
    pem: '.pem', pem_full: '.pem', pem_bundle: '.pem', pem_key: '.pem', pem_key_rsa: '.pem',
    der: '.der', der_key: '.der', pkcs12: '.pfx', pkcs7: '.p7b',
  } as Record<string, string>)[outputFormat] || '.pem'

  const onFile = async (file: File | null, target: 'content' | 'key' | 'chain') => {
    if (!file) return
    try {
      const text = await fileToContent(file, t('network.sslConverter.readFileError'))
      if (target === 'content') {
        setContent(text)
        setFileName(file.name)
        const ext = file.name.toLowerCase().split('.').pop() || ''
        if (['p12', 'pfx', 'pkcs12'].includes(ext)) setInputFormat('pkcs12')
        else if (['p7b', 'p7c'].includes(ext)) setInputFormat('pkcs7')
        else if (ext === 'der') setInputFormat('der')
        else if (['pem', 'crt', 'cer', 'key'].includes(ext)) setInputFormat('pem')
      } else if (target === 'chain') {
        setChainCert(text)
        setChainFileName(file.name)
      } else {
        setExtraKey(text)
        setKeyFileName(file.name)
      }
    } catch (e: any) {
      setError(e.message || t('network.sslConverter.readFileError'))
    }
  }

  const convert = async () => {
    if (!content.trim()) { setError(t('network.sslConverter.pasteOrUpload')); return }
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const fullContent = chainCert.trim() ? `${content.trim()}\n${chainCert.trim()}\n` : content
      const data = await api.network.sslConvert({
        content: fullContent,
        output_format: outputFormat,
        input_format: inputFormat,
        password,
        output_password: outputPassword,
        extra_key: extraKey,
        friendly_name: friendlyName || 'certificate',
      }) as ConvertResult
      setResult(data)
    } catch (e: any) {
      setError(e.message || t('network.sslConverter.convertError'))
    }
    setLoading(false)
  }

  const copyContent = () => {
    if (!result) return
    navigator.clipboard.writeText(result.content)
  }

  return (
    <ToolShell
      title={t('network.sslConverter.title')}
      description={t('network.sslConverter.description')}
    >
      <div className="card space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-secondary flex items-center gap-2 text-sm" onClick={() => fileRef.current?.click()}>
            <Upload size={14} /> {t('network.sslConverter.uploadFile')}
          </button>
          <input ref={fileRef} type="file" className="hidden" accept=".pem,.crt,.cer,.der,.p12,.pfx,.p7b,.p7c,.key,.pkcs12,.pkcs7" onChange={e => onFile(e.target.files?.[0] || null, 'content')} />
          {fileName && <span className="text-xs text-muted-foreground">{fileName}</span>}
        </div>

        <div>
          <label className="text-xs text-muted-foreground">{t('network.sslConverter.inputLabel')}</label>
          <textarea
            className="input w-full mt-1 font-mono text-xs min-h-[140px]"
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder={t('network.sslConverter.inputPlaceholder')}
            spellCheck={false}
          />
        </div>

        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <label className="text-xs text-muted-foreground">{t('network.sslConverter.chainLabel')}</label>
            <button type="button" className="text-xs text-brand-700 dark:text-brand-400 hover:text-brand-800" onClick={() => chainRef.current?.click()}>
              {t('network.sslConverter.uploadChain')}
            </button>
            <input ref={chainRef} type="file" className="hidden" accept=".pem,.crt,.cer" onChange={e => onFile(e.target.files?.[0] || null, 'chain')} />
          </div>
          <textarea
            className="input w-full font-mono text-xs min-h-[100px]"
            value={chainCert}
            onChange={e => setChainCert(e.target.value)}
            placeholder={t('network.sslConverter.chainPlaceholder')}
            spellCheck={false}
          />
          {chainFileName && <span className="text-xs text-muted-foreground">{chainFileName}</span>}
          <p className="text-xs text-muted-foreground mt-1">{t('network.sslConverter.chainHint')}</p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted-foreground">{t('network.sslConverter.inputFormatLabel')}</label>
            <select className="input w-full mt-1" value={inputFormat} onChange={e => setInputFormat(e.target.value)}>
              {INPUT_FORMAT_IDS.map(id => <option key={id} value={id}>{t(`network.sslConverter.inputFormats.${id}`)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">{t('network.sslConverter.outputFormatLabel')}</label>
            <select className="input w-full mt-1" value={outputFormat} onChange={e => setOutputFormat(e.target.value)}>
              {OUTPUT_FORMATS.map(f => <option key={f.id} value={f.id}>{t(`network.sslConverter.outputFormats.${f.key}`)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">{t('network.sslConverter.inputPasswordLabel')}</label>
            <input className="input w-full mt-1" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="off" />
          </div>
          {needsOutPassword && (
            <div>
              <label className="text-xs text-muted-foreground">{t('network.sslConverter.outputPasswordLabel')}</label>
              <input className="input w-full mt-1" type="password" value={outputPassword} onChange={e => setOutputPassword(e.target.value)} autoComplete="off" />
            </div>
          )}
          <div>
            <label className="text-xs text-muted-foreground">{t('network.sslConverter.friendlyNameLabel')}</label>
            <div className="flex items-center gap-2 mt-1">
              <input
                className="input w-full"
                value={friendlyName}
                onChange={e => setFriendlyName(e.target.value)}
                placeholder="certificate"
              />
              <span className="text-xs text-muted-foreground shrink-0">{outputExt}</span>
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <label className="text-xs text-muted-foreground">{t('network.sslConverter.extraKeyLabel')}</label>
            <button type="button" className="text-xs text-brand-700 dark:text-brand-400 hover:text-brand-800" onClick={() => keyRef.current?.click()}>
              {t('network.sslConverter.uploadKey')}
            </button>
            <input ref={keyRef} type="file" className="hidden" accept=".pem,.key,.der" onChange={e => onFile(e.target.files?.[0] || null, 'key')} />
          </div>
          <textarea
            className="input w-full font-mono text-xs min-h-[80px]"
            value={extraKey}
            onChange={e => setExtraKey(e.target.value)}
            placeholder={t('network.sslConverter.extraKeyPlaceholder')}
            spellCheck={false}
          />
          {keyFileName && <span className="text-xs text-muted-foreground">{keyFileName}</span>}
          {!selectedOut?.needsKey && <p className="text-xs text-muted-foreground mt-1">{t('network.sslConverter.extraKeyHint')}</p>}
        </div>

        <p className="text-xs text-muted-foreground">
          {t('network.sslConverter.helperNote')}
        </p>

        <button onClick={convert} disabled={loading} className="btn-primary w-full">
          {loading ? t('network.sslConverter.converting') : t('network.sslConverter.convert')}
        </button>
      </div>

      <ResultBox error={error}>
        {result && (
          <div className="space-y-4">
            {result.warnings.length > 0 && (
              <div role="status" className="space-y-1 border-l-2 border-amber-500 bg-amber-500/10 p-3 text-sm">
                {result.warnings.map(warning => (
                  <p key={warning} className="flex items-center gap-2">
                    <ShieldAlert size={14} className="shrink-0 text-amber-600" />
                    {t(`network.sslConverter.warnings.${warning}`, { defaultValue: warning })}
                  </p>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="info">{t('network.sslConverter.badges.input', { format: result.detected_format })}</Badge>
              <Badge variant="ok">{t('network.sslConverter.badges.output', { format: result.output_format })}</Badge>
              {result.has_private_key && <Badge variant={result.key_matches_certificate === false ? 'danger' : 'warn'}>
                {result.key_matches_certificate === true
                  ? t('network.sslConverter.badges.keyMatches')
                  : result.key_matches_certificate === false
                    ? t('network.sslConverter.badges.keyMismatch')
                    : t('network.sslConverter.badges.hasPrivateKey')}
              </Badge>}
              <Badge variant="dim">{t('network.sslConverter.badges.certCount', { count: result.certificate_count })}</Badge>
            </div>

            {result.certificates?.length > 0 && (
              <div className="space-y-3">
                {result.certificates.map((c, i) => (
                  <div key={i} className="bg-slate-900 text-slate-100 rounded-lg p-3">
                    <p className="text-sm font-semibold mb-2 flex items-center gap-2">
                      {c.common_name || t('network.sslConverter.certLabel', { index: i + 1 })}
                      {c.is_self_signed && <Badge variant="warn">{t('network.sslConverter.selfSigned')}</Badge>}
                      {c.is_expired && <Badge variant="danger">{t('network.sslConverter.expired')}</Badge>}
                    </p>
                    <DataRow label={t('network.sslConverter.subject')} value={c.subject} />
                    <DataRow label={t('network.sslConverter.issuer')} value={c.issuer} />
                    <DataRow
                      label={t('network.sslConverter.validUntil')}
                      value={t('network.sslConverter.validUntilDays', {
                        date: formatDateTime(c.not_after),
                        days: c.days_remaining,
                      })}
                    />
                    <DataRow label={t('network.sslConverter.algorithm')} value={`${c.signature_algorithm || '—'} / ${c.public_key_type || '—'}`} />
                    {c.sans?.length > 0 && <DataRow label={t('network.sslConverter.sans')} value={c.sans.join(', ')} />}
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => downloadResult(result)} className="btn-primary flex items-center gap-2 text-sm">
                <Download size={14} /> {t('network.sslConverter.download', { filename: result.filename })}
              </button>
              <button type="button" onClick={copyContent} className="btn-secondary flex items-center gap-2 text-sm">
                <Copy size={14} /> {t('network.sslConverter.copy')}
              </button>
            </div>

            <pre className="bg-slate-900 text-slate-100 rounded-lg p-4 font-mono text-xs overflow-auto max-h-80 whitespace-pre-wrap break-all">
              {result.encoding === 'base64'
                ? result.content.slice(0, 500) + (result.content.length > 500 ? '…' : '')
                : result.content}
            </pre>
          </div>
        )}
      </ResultBox>
    </ToolShell>
  )
}
