import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'

export default function SsoCallbackPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const { completeSsoLogin } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    const access = params.get('access_token')
    const refresh = params.get('refresh_token')
    if (!access || !refresh) {
      navigate('/login?error=sso_failed', { replace: true })
      return
    }
    completeSsoLogin(access, refresh)
      .then(() => navigate('/backoffice', { replace: true }))
      .catch(() => navigate('/login?error=sso_failed', { replace: true }))
  }, [completeSsoLogin, navigate, params])

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas text-muted-foreground">
      {t('auth.sso.completing')}
    </div>
  )
}
