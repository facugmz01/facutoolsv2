import { FormEvent, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import AuthShell from '../components/AuthShell'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Card, CardContent } from '../components/ui/card'

interface PublicSSOProvider {
  id: number
  name: string
}

export default function LoginPage() {
  const { t } = useTranslation()
  const { user, loading, login, register, bootstrapRequired } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>(bootstrapRequired ? 'register' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [orgName, setOrgName] = useState('FacuTools')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [providers, setProviders] = useState<PublicSSOProvider[]>([])
  const [params] = useSearchParams()
  const navigate = useNavigate()

  const firstTimeSetup = bootstrapRequired && !loading

  useEffect(() => {
    if (bootstrapRequired) setMode('register')
  }, [bootstrapRequired])

  useEffect(() => {
    const err = params.get('error')
    if (err) setError(err.replace(/_/g, ' '))
  }, [params])

  useEffect(() => {
    fetch('/api/auth/sso/public-providers')
      .then((r) => (r.ok ? r.json() : []))
      .then(setProviders)
      .catch(() => setProviders([]))
  }, [])

  if (!loading && user) {
    return <Navigate to="/backoffice" replace />
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'register') {
        await register({ email, password, name, organization_name: orgName })
      } else {
        await login(email, password)
      }
      navigate('/backoffice')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.authenticationFailed'))
    } finally {
      setBusy(false)
    }
  }

  const tagline =
    mode === 'register' ? t('auth.login.subtitleRegister') : t('nav.tagline')
  const heading = firstTimeSetup ? 'Configura tu espacio' : mode === 'register' ? 'Crea tu cuenta administradora' : 'Inicia sesión'
  const helpText = firstTimeSetup
    ? 'Este es tu primer arranque. Crea la cuenta principal para configurar la organización y empezar a gestionar dominios.'
    : 'Ingresa con tu email y contraseña para continuar.'

  return (
    <AuthShell tagline={tagline}>
      <Card className="rounded-2xl shadow-sm">
        <CardContent className="p-0">
          {firstTimeSetup && (
            <div className="border-b border-border bg-brand-50/80 px-4 py-3 dark:bg-brand-950/20">
              <p className="text-sm font-semibold text-brand-700 dark:text-brand-300">{heading}</p>
              <p className="mt-1 text-xs text-muted-foreground">{helpText}</p>
            </div>
          )}
          <div className="p-4 sm:p-6">
            {!firstTimeSetup && (
              <div className="mb-4">
                <p className="text-lg font-semibold">{heading}</p>
                <p className="mt-1 text-sm text-muted-foreground">{helpText}</p>
              </div>
            )}
            <form onSubmit={onSubmit} className="space-y-4">
            {mode === 'register' && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="name">{t('auth.login.nameLabel')}</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="org">{t('auth.login.workspaceNameLabel')}</Label>
                  <Input id="org" value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">{t('auth.login.emailLabel')}</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{t('auth.login.passwordLabel')}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <Button type="submit" disabled={busy} className="w-full h-11">
              {busy ? t('common.pleaseWait') : mode === 'register' ? t('auth.login.submitCreateAccount') : t('auth.login.submitSignIn')}
            </Button>

            {firstTimeSetup && (
              <div className="rounded-lg border border-dashed border-brand-200 bg-brand-50/40 p-3 text-xs text-muted-foreground dark:border-brand-800 dark:bg-brand-950/20">
                <p className="font-medium text-foreground">Tu cuenta inicial tendrá permisos de administrador.</p>
                <p className="mt-1">Se creará la organización principal y podrás invitar al resto del equipo después.</p>
              </div>
            )}

            {!bootstrapRequired && mode === 'login' && (
              <p className="text-xs text-muted-foreground text-center">
                {t('auth.login.needAccountText')}{' '}
                <Link to="/invite" className="text-brand-700 dark:text-brand-400 hover:underline">{t('auth.login.acceptInviteLink')}</Link>
              </p>
            )}
            {bootstrapRequired && mode === 'login' && (
              <Button type="button" variant="ghost" className="w-full" onClick={() => setMode('register')}>
                {t('auth.login.firstTimeSetup')}
              </Button>
            )}
            </form>
          </div>
        </CardContent>
      </Card>

      {providers.length > 0 && mode === 'login' && (
        <div className="mt-6 space-y-2">
          <p className="text-xs text-center text-muted-foreground uppercase tracking-wide">{t('auth.login.orContinueWithSso')}</p>
          {providers.map((p) => (
            <Button key={p.id} variant="secondary" asChild className="w-full h-11">
              <a href={`/api/auth/sso/${p.id}/authorize`}>{p.name}</a>
            </Button>
          ))}
        </div>
      )}
    </AuthShell>
  )
}
