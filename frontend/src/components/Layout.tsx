import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LayoutDashboard, Globe, Wrench, Bell, Eye, GitCompareArrows, Shield, Settings,
  Users, KeyRound, LogOut, Menu, X, PanelLeftClose, PanelLeft, FileText, Activity,
} from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import BrandMark from './BrandMark'
import LanguageSwitcher from './LanguageSwitcher'
import ThemeToggle from './ThemeToggle'

const mainNav = [
  { to: '/backoffice', labelKey: 'nav.dashboard', icon: LayoutDashboard, permission: 'domains:read' },
  { to: '/domains', labelKey: 'nav.domains', icon: Globe, permission: 'domains:read' },
  { to: '/ssl', labelKey: 'nav.ssl', icon: Shield, permission: 'ssl:read' },
  { to: '/', labelKey: 'publicTools.catalogTitle', icon: Wrench },
  { to: '/compare', labelKey: 'nav.compare', icon: GitCompareArrows, permission: 'domains:read' },
  { to: '/alerts', labelKey: 'nav.alerts', icon: Bell, permission: 'alerts:read' },
  { to: '/notification-templates', labelKey: 'nav.notificationTemplates', icon: FileText, permission: 'alerts:read' },
  { to: '/watchlist', labelKey: 'nav.watchlist', icon: Eye, permission: 'watchlist:read' },
  { to: '/monitoring', labelKey: 'nav.monitoring', icon: Activity, permission: 'monitoring:read' },
]

const adminNav = [
  { to: '/users', labelKey: 'nav.users', icon: Users, permission: 'users:read' },
  { to: '/roles', labelKey: 'nav.roles', icon: KeyRound, permission: 'roles:read' },
  { to: '/settings', labelKey: 'nav.settings', icon: Settings, permission: 'settings:read' },
]

const COLLAPSE_KEY = 'facutools-sidebar-collapsed'
const LG_QUERY = '(min-width: 1024px)'
const XL_QUERY = '(min-width: 1280px)'

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  )

  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])

  return matches
}

function SidebarContent({
  collapsed,
  onToggleCollapse,
  onCloseMobile,
  showCollapseToggle,
}: {
  collapsed: boolean
  onToggleCollapse?: () => void
  onCloseMobile?: () => void
  showCollapseToggle?: boolean
}) {
  const location = useLocation()
  const { t } = useTranslation()
  const { user, organization, logout, hasPermission } = useAuth()
  const visibleMain = mainNav.filter((item) => !item.permission || hasPermission(item.permission))
  const visibleAdmin = adminNav.filter((item) => !item.permission || hasPermission(item.permission))

  const renderNavLink = ({
    to,
    labelKey,
    icon: Icon,
  }: {
    to: string
    labelKey: string
    icon: typeof LayoutDashboard
  }) => {
    const active = to === '/'
      ? location.pathname === '/' || location.pathname.startsWith('/herramientas')
      : location.pathname === to || location.pathname.startsWith(to)
    const label = t(labelKey)
    return (
      <Link
        key={to}
        to={to}
        title={label}
        aria-current={active ? 'page' : undefined}
        className={`flex items-center rounded-lg text-sm font-medium transition-colors ${
          collapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5'
        } ${
          active
            ? 'bg-brand-50 text-brand-700 dark:bg-brand-600/20 dark:text-brand-400'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        }`}
      >
        <Icon size={18} className="shrink-0" aria-hidden />
        {!collapsed && <span className="truncate">{label}</span>}
        {collapsed && <span className="sr-only">{label}</span>}
      </Link>
    )
  }

  return (
    <>
      <div className={`border-b border-border shrink-0 ${collapsed ? 'p-2.5' : 'p-4'}`}>
        <div className={`flex items-center gap-2 ${collapsed ? 'flex-col' : 'justify-between'}`}>
          {collapsed ? (
            <span
              className="text-brand-600 dark:text-brand-400 font-brand font-semibold text-lg tracking-tight leading-none"
              aria-label="FacuTools"
            >
              F
            </span>
          ) : (
            <h1 className="min-w-0 truncate">
              <BrandMark size="sm" />
            </h1>
          )}
          <div className={`flex items-center gap-1 ${collapsed ? '' : 'shrink-0'}`}>
            {showCollapseToggle && onToggleCollapse && (
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={onToggleCollapse}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
              </button>
            )}
            {onCloseMobile && (
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
                onClick={onCloseMobile}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            )}
          </div>
        </div>
        {!collapsed && (
          <p className="text-xs text-muted-foreground mt-2 leading-snug truncate">
            {organization?.name || t('nav.tagline')}
          </p>
        )}
      </div>

      <nav className={`flex-1 min-h-0 space-y-1 overflow-y-auto overscroll-contain ${collapsed ? 'p-2' : 'p-3'}`}>
        {visibleMain.map(renderNavLink)}
        {visibleAdmin.length > 0 && (
          <>
            {!collapsed ? (
              <p className="pt-3 pb-1 px-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
                {t('nav.adminSection')}
              </p>
            ) : (
              <div className="my-2 border-t border-border" />
            )}
            {visibleAdmin.map(renderNavLink)}
          </>
        )}
      </nav>

      <div className={`border-t border-border shrink-0 space-y-2 ${collapsed ? 'p-2' : 'p-4'}`}>
        {!collapsed && user && (
          <div className="text-xs text-muted-foreground truncate" title={user.email}>{user.email}</div>
        )}
        <button
          type="button"
          onClick={() => logout()}
          title={t('common.signOut')}
          className={`flex items-center text-xs text-muted-foreground hover:text-foreground ${
            collapsed ? 'justify-center w-full py-2' : 'gap-2'
          }`}
        >
          <LogOut size={14} />
          {!collapsed && t('common.signOut')}
        </button>
        {!collapsed && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <LanguageSwitcher compact />
              <ThemeToggle compact />
            </div>
            <div className="text-xs text-muted-foreground/80">{t('nav.versionInfo')}</div>
          </>
        )}
        {collapsed && (
          <div className="flex justify-center">
            <ThemeToggle compact />
          </div>
        )}
      </div>
    </>
  )
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const { t } = useTranslation()
  const { logout } = useAuth()
  const isDesktop = useMediaQuery(LG_QUERY)
  const isWide = useMediaQuery(XL_QUERY)

  const [userCollapsed, setUserCollapsed] = useState<boolean | null>(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY)
      if (raw === '1') return true
      if (raw === '0') return false
    } catch {
      /* ignore */
    }
    return null
  })
  const [mobileOpen, setMobileOpen] = useState(false)

  // Auto icon-rail between lg and xl unless the user chose a preference
  const collapsed = userCollapsed ?? (isDesktop && !isWide)

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (isDesktop) setMobileOpen(false)
  }, [isDesktop])

  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [mobileOpen])

  function toggleCollapsed() {
    setUserCollapsed((prev) => {
      const current = prev ?? (isDesktop && !isWide)
      const next = !current
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }

  return (
    <div className="min-h-screen flex bg-canvas">
      {/* Desktop / tablet landscape sidebar */}
      <aside
        className={`hidden lg:flex flex-col bg-surface border-r border-border transition-[width] duration-200 ease-out shrink-0 h-screen sticky top-0 ${
          collapsed ? 'w-[4.5rem]' : 'w-64'
        }`}
        aria-label={t('nav.appName', { defaultValue: 'Navigation' })}
      >
        <SidebarContent
          collapsed={collapsed}
          showCollapseToggle
          onToggleCollapse={toggleCollapsed}
        />
      </aside>

      {/* Mobile drawer */}
      <div
        className={`fixed inset-0 z-40 lg:hidden ${mobileOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}
        aria-hidden={!mobileOpen}
      >
        <button
          type="button"
          className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${
            mobileOpen ? 'opacity-100' : 'opacity-0'
          }`}
          aria-label="Close"
          tabIndex={mobileOpen ? 0 : -1}
          onClick={() => setMobileOpen(false)}
        />
        <aside
          className={`absolute inset-y-0 left-0 w-[min(16rem,85vw)] bg-surface border-r border-border shadow-xl flex flex-col transition-transform duration-200 ease-out ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
          role="dialog"
          aria-modal="true"
          aria-label={t('nav.appName', { defaultValue: 'Navigation' })}
        >
          <SidebarContent collapsed={false} onCloseMobile={() => setMobileOpen(false)} />
        </aside>
      </div>

      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        <header className="lg:hidden sticky top-0 z-30 flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 bg-surface/95 backdrop-blur border-b border-border">
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-lg p-2 text-muted-foreground hover:bg-muted shrink-0"
            onClick={() => setMobileOpen(true)}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            aria-label={t('nav.openMenu', { defaultValue: 'Open menu' })}
          >
            <Menu size={20} />
          </button>
          <div className="min-w-0 flex-1">
            <BrandMark size="sm" className="max-w-full" />
          </div>
          <div className="ml-auto flex items-center gap-1 sm:gap-2 shrink-0">
            <ThemeToggle compact />
            <LanguageSwitcher compact />
            <button
              type="button"
              onClick={() => logout()}
              className="inline-flex items-center justify-center rounded-lg p-2 text-muted-foreground hover:text-foreground hover:bg-muted"
              aria-label={t('common.signOut')}
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          <div className="px-3 py-4 sm:px-4 md:px-6 md:py-6 lg:p-8 max-w-7xl mx-auto w-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
