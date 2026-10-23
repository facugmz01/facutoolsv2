import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BellRing, LayoutDashboard, LogIn, Wrench } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import BrandMark from './BrandMark'
import LanguageSwitcher from './LanguageSwitcher'
import ThemeToggle from './ThemeToggle'

export default function PublicLayout() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { pathname } = useLocation()

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link to="/" aria-label="FacuTools"><BrandMark /></Link>
          <div className="flex flex-wrap items-center gap-3">
            <LanguageSwitcher />
            <ThemeToggle />
            <Link className="btn-primary inline-flex items-center gap-2" to="/backoffice">
              <LayoutDashboard size={16} />
              {t('publicTools.backoffice')}
            </Link>
          </div>
        </div>
        <nav aria-label={t('publicTools.catalogTitle')} className="mx-auto flex max-w-7xl flex-wrap gap-2 px-4 pb-3 sm:px-6">
          <NavLink to="/" className={({ isActive }) => `inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${isActive || pathname.startsWith('/herramientas/') ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'}`}>
            <Wrench size={16} />{t('publicTools.catalogTitle')}
          </NavLink>
        </nav>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        {!user && (
          <aside className="flex flex-col gap-3 border-y border-border bg-muted/50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <BellRing size={20} className="mt-0.5 shrink-0 text-brand-600" />
              <div className="min-w-0">
                <p className="font-semibold">{t('publicTools.monitoring')}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t('publicTools.upsell')}</p>
              </div>
            </div>
            <Link to="/login" className="btn-primary inline-flex shrink-0 items-center justify-center gap-2">
              <LogIn size={16} />{t('auth.login.submitSignIn')}
            </Link>
          </aside>
        )}
        <Outlet />
      </main>
    </div>
  )
}