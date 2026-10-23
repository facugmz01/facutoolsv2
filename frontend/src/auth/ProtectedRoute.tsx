import { Navigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from './AuthContext'

export default function ProtectedRoute({
  children,
  permission,
}: {
  children: React.ReactNode
  permission?: string | string[]
}) {
  const { t } = useTranslation()
  const { user, loading, hasPermission } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas text-muted-foreground">
        {t('auth.protectedRoute.loading')}
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (permission) {
    const codes = Array.isArray(permission) ? permission : [permission]
    if (!hasPermission(...codes)) {
      return (
        <div className="p-8 text-muted-foreground">
          <h1 className="text-xl font-semibold text-foreground mb-2">{t('auth.protectedRoute.accessDeniedTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('auth.protectedRoute.accessDeniedMessage')}</p>
        </div>
      )
    }
  }

  return <>{children}</>
}
