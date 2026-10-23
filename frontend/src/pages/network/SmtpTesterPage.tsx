import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api'
import { useAuth } from '../../auth/AuthContext'
import ToolShell, { Badge, ResultBox } from '../../components/network/ToolShell'

export default function SmtpTesterPage() {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const canSend = hasPermission('network:use')
  const [form, setForm] = useState({
    host: '', port: '25', security: 'auto',
    mail_from: '', rcpt_to: '', user: '', password: '',
    send_message: false,
  })
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const update = (k: string, v: string | boolean) => setForm(prev => ({ ...prev, [k]: v }))

  const run = async () => {
    if (!form.host.trim()) { setError(t('network.smtp.hostRequired')); return }
    setLoading(true)
    setError('')
    setResult(null)
    try {
      setResult(await api.network.smtpTest({
        host: form.host.trim(),
        port: parseInt(form.port) || 25,
        security: form.security,
        mail_from: form.mail_from.trim(),
        rcpt_to: form.rcpt_to.trim(),
        user: form.user.trim(),
        password: form.password,
        send_message: canSend && form.send_message,
      }))
    } catch (e: any) {
      setError(e.message)
    }
    setLoading(false)
  }

  const logColors: Record<string, string> = { tx: 'text-sky-300', rx: 'text-green-300', error: 'text-red-300', info: 'text-yellow-300' }

  return (
    <ToolShell
      title={t('network.smtp.title')}
      description={t('network.smtp.description')}
    >
      <div className="card grid md:grid-cols-2 gap-4">
        <div>
          <label className="text-xs text-muted-foreground">{t('network.smtp.hostLabel')}</label>
          <input className="input w-full mt-1" value={form.host} onChange={e => update('host', e.target.value)} placeholder={t('network.smtp.hostPlaceholder')} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">{t('network.smtp.portLabel')}</label>
          <input className="input w-full mt-1" type="number" value={form.port} onChange={e => update('port', e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">{t('network.smtp.securityLabel')}</label>
          <select className="input w-full mt-1" value={form.security} onChange={e => update('security', e.target.value)}>
            <option value="auto">{t('network.smtp.securityAuto')}</option>
            <option value="ssl">{t('network.smtp.securitySsl')}</option>
            <option value="tls">{t('network.smtp.securityTls')}</option>
            <option value="none">{t('network.smtp.securityNone')}</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">{t('network.smtp.mailFromLabel')}</label>
          <input className="input w-full mt-1" value={form.mail_from} onChange={e => update('mail_from', e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">{t('network.smtp.rcptToLabel')}</label>
          <input className="input w-full mt-1" value={form.rcpt_to} onChange={e => update('rcpt_to', e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">{t('network.smtp.authUserLabel')}</label>
          <input className="input w-full mt-1" value={form.user} onChange={e => update('user', e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs text-muted-foreground">{t('network.smtp.authPasswordLabel')}</label>
          <input className="input w-full mt-1" type="password" value={form.password} onChange={e => update('password', e.target.value)} />
        </div>
        <div className="md:col-span-2 flex items-center gap-2">
          <input
            id="smtp-send-message"
            type="checkbox"
            checked={canSend && form.send_message}
            disabled={!canSend}
            onChange={e => update('send_message', e.target.checked)}
          />
          <label htmlFor="smtp-send-message" className="text-sm text-muted-foreground">
            {t('network.smtp.sendMessage')}{!canSend && ` (${t('publicTools.signInToSend')})`}
          </label>
        </div>
        <div className="md:col-span-2">
          <button onClick={run} disabled={loading} className="btn-primary w-full">
            {loading ? t('network.smtp.running') : t('network.smtp.run')}
          </button>
        </div>
      </div>

      <ResultBox error={error}>
        {result?.log && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">{t('network.smtp.logTitle')}</h3>
              <Badge variant={result.success ? 'ok' : 'danger'}>{result.success ? t('network.smtp.success') : t('network.smtp.failure')}</Badge>
            </div>
            <div className="bg-slate-900 rounded-lg p-4 font-mono text-xs space-y-1 max-h-96 overflow-auto text-slate-100">
              {result.log.map((l: any, i: number) => (
                <div key={i} className={logColors[l.type] || 'text-slate-300'}>
                  <span className="text-muted-foreground">[{l.time}]</span> {l.msg}
                </div>
              ))}
            </div>
          </div>
        )}
      </ResultBox>
    </ToolShell>
  )
}
