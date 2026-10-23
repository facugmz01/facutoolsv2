import { FormEvent, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import AuthShell from '../components/AuthShell'

export default function InvitePage() {
  const { t } = useTranslation()
  const { user, loading, acceptInvite } = useAuth()
  const [params] = useSearchParams()
  const [token, setToken] = useState(params.get('token') || '')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  if (!loading && user) return <Navigate to="/backoffice" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await acceptInvite(token, name, password)
      navigate('/backoffice')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.inviteFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell tagline={t('nav.tagline')}>
      <form onSubmit={onSubmit} className="bg-surface border border-border rounded-2xl p-6 space-y-4 shadow-sm">
        <h1 className="text-xl font-semibold text-foreground">{t('auth.invite.title')}</h1>
        <label className="block text-sm text-muted-foreground">
          {t('auth.invite.tokenLabel')}
          <input className="input mt-1 w-full" value={token} onChange={(e) => setToken(e.target.value)} required />
        </label>
        <label className="block text-sm text-muted-foreground">
          {t('auth.invite.nameLabel')}
          <input className="input mt-1 w-full" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="block text-sm text-muted-foreground">
          {t('auth.invite.passwordLabel')}
          <input type="password" minLength={8} className="input mt-1 w-full" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={busy} className="btn-primary w-full py-2.5 disabled:opacity-50">
          {t('auth.invite.submit')}
        </button>
        <Link to="/login" className="block text-center text-sm text-brand-700 dark:text-brand-400">{t('auth.invite.backToLogin')}</Link>
      </form>
    </AuthShell>
  )
}
