import { FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Settings as SettingsIcon,
  Save,
  RefreshCw,
  Palette,
  Building2,
  SlidersHorizontal,
  Activity,
  Shield,
  Bell,
  Plug,
  Lock,
  Users,
  KeyRound,
  Send,
  Eye,
  EyeOff,
  X,
  Plus,
  ExternalLink,
} from 'lucide-react'
import { api, AppSetting, ScheduleStatus, SsoProvider } from '../api'
import { formatDateTime } from '../utils/domainValidation'
import { isValidTimeZone, listTimeZones } from '../utils/datetime'
import { useTimeZone } from '../timezone/TimezoneContext'
import LanguageSwitcher from '../components/LanguageSwitcher'
import { useTheme, type ThemeMode } from '../theme/ThemeContext'
import { useAuth } from '../auth/AuthContext'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { cn } from '../lib/utils'

const INTERVAL_KEYS = new Set(['monitor_interval_minutes', 'ssl_monitor_interval_minutes'])

const NOTIFICATION_CHANNELS = ['email', 'teams', 'webhook', 'telegram', 'slack', 'discord'] as const

const TAB_IDS = [
  'appearance',
  'organization',
  'general',
  'monitoring',
  'ssl',
  'notifications',
  'integrations',
  'security',
  'access',
] as const

type TabId = (typeof TAB_IDS)[number]

const CATEGORY_TABS: Record<string, TabId> = {
  general: 'general',
  monitoring: 'monitoring',
  ssl: 'ssl',
  notifications: 'notifications',
  integrations: 'integrations',
  security: 'security',
}

const NOTIFICATION_GROUPS: { id: string; keys: string[] }[] = [
  { id: 'channels', keys: ['default_notification_channels', 'notification_email_to', 'notification_dedup_hours'] },
  { id: 'email', keys: ['email_provider', 'smtp_host', 'smtp_port', 'smtp_security', 'smtp_timeout', 'smtp_user', 'smtp_password', 'smtp_from', 'graph_tenant_id', 'graph_client_id', 'graph_client_secret', 'graph_sender'] },
  { id: 'chat', keys: ['teams_webhook_url', 'slack_webhook_url', 'discord_webhook_url', 'telegram_bot_token', 'telegram_chat_id', 'webhook_url'] },
]

const SSO_FIELD_KEYS: Record<string, string> = {
  name: 'name',
  issuer_url: 'issuerUrl',
  client_id: 'clientId',
  client_secret: 'clientSecret',
  scopes: 'scopes',
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []
  } catch {
    return []
  }
}

function TagListEditor({
  values,
  onChange,
  placeholder,
  disabled,
}: {
  values: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  disabled?: boolean
}) {
  const [draft, setDraft] = useState('')

  const commit = () => {
    const next = draft.trim()
    if (!next || values.includes(next)) {
      setDraft('')
      return
    }
    onChange([...values, next])
    setDraft('')
  }

  return (
    <div className={cn('rounded-lg border border-border bg-canvas p-2', disabled && 'opacity-60')}>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {values.length === 0 && (
          <span className="text-xs text-muted-foreground px-1 py-0.5">{placeholder}</span>
        )}
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-foreground"
          >
            {v}
            {!disabled && (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => onChange(values.filter((x) => x !== v))}
                aria-label={`Remove ${v}`}
              >
                <X size={12} />
              </button>
            )}
          </span>
        ))}
      </div>
      {!disabled && (
        <div className="flex gap-2">
          <input
            className="input flex-1 text-sm"
            value={draft}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                commit()
              }
            }}
          />
          <Button type="button" variant="secondary" size="sm" onClick={commit}>
            <Plus size={14} />
          </Button>
        </div>
      )}
    </div>
  )
}

function ChannelPicker({
  values,
  onChange,
  disabled,
}: {
  values: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {NOTIFICATION_CHANNELS.map((channel) => {
        const active = values.includes(channel)
        return (
          <button
            key={channel}
            type="button"
            disabled={disabled}
            onClick={() =>
              onChange(active ? values.filter((c) => c !== channel) : [...values, channel])
            }
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm border transition-colors capitalize',
              active
                ? 'bg-brand-50 dark:bg-brand-950/30 border-brand-500 text-brand-700 dark:text-brand-400'
                : 'border-border text-muted-foreground hover:bg-muted',
              disabled && 'opacity-60 cursor-not-allowed',
            )}
          >
            {channel}
          </button>
        )
      })}
    </div>
  )
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start py-3 border-b border-border last:border-0">
      <div className="min-w-0">
        <label className="text-sm font-medium text-foreground">{label}</label>
        {description && <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>}
      </div>
      <div className="md:col-span-2">{children}</div>
    </div>
  )
}

export default function Settings() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  const { hasPermission, organization, refreshMe } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const { refreshTimeZone } = useTimeZone()
  const timeZones = useMemo(() => listTimeZones(), [])
  const canWrite = hasPermission('settings:write')
  const canManageOrg = hasPermission('org:manage')
  const canManageSso = hasPermission('sso:manage')
  const canReadUsers = hasPermission('users:read')
  const canReadRoles = hasPermission('roles:read')

  const tabParam = searchParams.get('tab')
  const entraOnboardingStatus = searchParams.get('entra_onboarding')
  const activeTab: TabId = TAB_IDS.includes(tabParam as TabId) ? (tabParam as TabId) : 'appearance'

  const setTab = (tab: TabId) => {
    setSearchParams(tab === 'appearance' ? {} : { tab }, { replace: true })
  }

  const [grouped, setGrouped] = useState<Record<string, AppSetting[]>>({})
  const [form, setForm] = useState<Record<string, string>>({})
  const [baseline, setBaseline] = useState<Record<string, string>>({})
  const [schedule, setSchedule] = useState<ScheduleStatus | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSecret, setShowSecret] = useState(false)

  const [orgName, setOrgName] = useState('')
  const [orgSaving, setOrgSaving] = useState(false)
  const [orgSaved, setOrgSaved] = useState(false)
  const [orgError, setOrgError] = useState<string | null>(null)

  const [providers, setProviders] = useState<SsoProvider[]>([])
  const [ssoForm, setSsoForm] = useState({
    name: '',
    issuer_url: '',
    client_id: '',
    client_secret: '',
    scopes: 'openid email profile',
    auto_provision: false,
  })
  const [ssoError, setSsoError] = useState<string | null>(null)
  const [entraOnboarding, setEntraOnboarding] = useState({
    name: 'Microsoft Entra ID',
    auto_provision: false,
  })
  const [entraOnboardingError, setEntraOnboardingError] = useState<string | null>(null)
  const [startingEntraOnboarding, setStartingEntraOnboarding] = useState(false)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testError, setTestError] = useState<string | null>(null)

  const ACME_DIRECTORIES = [
    {
      label: t('settings.acmeStagingLabel'),
      value: 'https://acme-staging-v02.api.letsencrypt.org/directory',
    },
    {
      label: t('settings.acmeProductionLabel'),
      value: 'https://acme-v02.api.letsencrypt.org/directory',
    },
  ]

  const tabs = useMemo(
    () =>
      [
        { id: 'appearance' as const, label: t('settings.tabs.appearance'), icon: Palette },
        { id: 'organization' as const, label: t('settings.tabs.organization'), icon: Building2 },
        { id: 'general' as const, label: t('settings.tabs.general'), icon: SlidersHorizontal },
        { id: 'monitoring' as const, label: t('settings.tabs.monitoring'), icon: Activity },
        { id: 'ssl' as const, label: t('settings.tabs.ssl'), icon: Shield },
        { id: 'notifications' as const, label: t('settings.tabs.notifications'), icon: Bell },
        { id: 'integrations' as const, label: t('settings.tabs.integrations'), icon: Plug },
        { id: 'security' as const, label: t('settings.tabs.security'), icon: Lock },
        { id: 'access' as const, label: t('settings.tabs.access'), icon: Users },
      ] as const,
    [t],
  )

  const dirtyKeys = useMemo(
    () => Object.keys(form).filter((key) => form[key] !== baseline[key]),
    [form, baseline],
  )
  const isDirty = dirtyKeys.length > 0

  const load = async () => {
    try {
      const [data, scheduleStatus] = await Promise.all([
        api.settings.grouped(),
        api.settings.schedule(),
      ])
      setGrouped(data)
      setSchedule(scheduleStatus)
      const values: Record<string, string> = {}
      Object.values(data).flat().forEach((s) => {
        values[s.key] = typeof s.value === 'object' ? JSON.stringify(s.value) : String(s.value ?? '')
      })
      setForm(values)
      setBaseline(values)
      setError(null)

      if (organization) setOrgName(organization.name)

      if (canManageSso) {
        setProviders(await api.sso.providers())
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errors.settingsLoadFailed'))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    if (organization?.name) setOrgName(organization.name)
  }, [organization?.name])

  const updateField = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = async () => {
    if (!canWrite || !isDirty) return
    setSaving(true)
    setSaved(false)
    setError(null)
    const updates: Record<string, unknown> = {}
    dirtyKeys.forEach((key) => {
      const setting = Object.values(grouped).flat().find((s) => s.key === key)
      const val = form[key]
      if (!setting) return
      if (setting.value_type === 'int') {
        const parsed = parseInt(val, 10)
        updates[key] = INTERVAL_KEYS.has(key)
          ? Math.max(1, Number.isNaN(parsed) ? 1 : parsed)
          : parsed || 0
      } else if (setting.value_type === 'json') {
        try {
          updates[key] = JSON.parse(val)
        } catch {
          updates[key] = val
        }
      } else if (setting.value_type === 'bool') {
        updates[key] = val === 'true'
      } else {
        updates[key] = val
      }
    })
    try {
      const result = await api.settings.updateMany(updates)
      setSchedule(result.schedule)
      setSaved(true)
      await load()
      if (dirtyKeys.includes('timezone')) await refreshTimeZone()
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errors.settingsSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const saveOrg = async (e: FormEvent) => {
    e.preventDefault()
    if (!canManageOrg) return
    setOrgSaving(true)
    setOrgError(null)
    setOrgSaved(false)
    try {
      await api.orgs.update(orgName.trim())
      await refreshMe()
      setOrgSaved(true)
      setTimeout(() => setOrgSaved(false), 3000)
    } catch (err) {
      setOrgError(err instanceof Error ? err.message : t('errors.saveFailed'))
    } finally {
      setOrgSaving(false)
    }
  }

  const createSso = async (e: FormEvent) => {
    e.preventDefault()
    setSsoError(null)
    try {
      await api.sso.createProvider(ssoForm)
      setSsoForm({
        name: '',
        issuer_url: '',
        client_id: '',
        client_secret: '',
        scopes: 'openid email profile',
        auto_provision: false,
      })
      setProviders(await api.sso.providers())
    } catch (err) {
      setSsoError(err instanceof Error ? err.message : t('errors.ssoSaveFailed'))
    }
  }

  const startEntraOnboarding = async () => {
    setStartingEntraOnboarding(true)
    setEntraOnboardingError(null)
    try {
      const result = await api.sso.startEntraOnboarding(entraOnboarding)
      window.location.assign(result.authorization_url)
    } catch (err) {
      setEntraOnboardingError(err instanceof Error ? err.message : t('errors.ssoSaveFailed'))
      setStartingEntraOnboarding(false)
    }
  }

  const sendTest = async () => {
    setTesting(true)
    setTestResult(null)
    setTestError(null)
    try {
      const res = await api.alerts.test()
      const summary = res.results
        .map((r) => `${r.channel}: ${r.skipped ? 'skipped' : r.success ? 'ok' : 'fail'} (${r.detail})`)
        .join(' · ')
      setTestResult(summary || t('alerts.testEmpty'))
    } catch (e) {
      setTestError(e instanceof Error ? e.message : t('alerts.testFailed'))
    } finally {
      setTesting(false)
    }
  }

  const settingLabel = (setting: AppSetting) =>
    t(`settings.fields.${setting.key}.label`, { defaultValue: setting.label || setting.key })

  const settingDescription = (setting: AppSetting) =>
    t(`settings.fields.${setting.key}.description`, { defaultValue: setting.description || '' })

  const renderSettingInput = (setting: AppSetting) => {
    const disabled = !canWrite

    if (setting.key === 'timezone') {
      const current = form[setting.key] || 'UTC'
      const zones = timeZones.includes(current) ? timeZones : [current, ...timeZones]
      return (
        <div className="space-y-2">
          <select
            className="input w-full"
            disabled={disabled}
            value={current}
            onChange={(e) => updateField(setting.key, e.target.value)}
          >
            {zones.map((zone) => (
              <option key={zone} value={zone}>{zone}</option>
            ))}
          </select>
          {isValidTimeZone(current) && (
            <p className="text-xs text-muted-foreground">
              {new Intl.DateTimeFormat(undefined, {
                timeZone: current,
                dateStyle: 'medium',
                timeStyle: 'long',
              }).format(new Date())}
            </p>
          )}
        </div>
      )
    }

    if (setting.key === 'default_notification_channels') {
      return (
        <ChannelPicker
          values={parseJsonArray(form[setting.key] || '[]')}
          onChange={(next) => updateField(setting.key, JSON.stringify(next))}
          disabled={disabled}
        />
      )
    }

    if (setting.key === 'notification_email_to' || setting.key === 'cors_origins') {
      return (
        <TagListEditor
          values={parseJsonArray(form[setting.key] || '[]')}
          onChange={(next) => updateField(setting.key, JSON.stringify(next))}
          placeholder={
            setting.key === 'cors_origins'
              ? t('settings.corsPlaceholder')
              : t('settings.emailPlaceholder')
          }
          disabled={disabled}
        />
      )
    }

    if (setting.key === 'acme_directory_url') {
      const current = form[setting.key] || ''
      const known = ACME_DIRECTORIES.some((d) => d.value === current)
      return (
        <div className="space-y-2">
          <select
            className="input w-full"
            disabled={disabled}
            value={known ? current : '__custom__'}
            onChange={(e) => {
              if (e.target.value === '__custom__') return
              updateField(setting.key, e.target.value)
            }}
          >
            {ACME_DIRECTORIES.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
            <option value="__custom__">{t('settings.acmeCustomOption')}</option>
          </select>
          <input
            className="input w-full font-mono text-sm"
            disabled={disabled}
            value={current}
            placeholder={t('settings.acmeDirectoryPlaceholder')}
            onChange={(e) => updateField(setting.key, e.target.value)}
          />
        </div>
      )
    }

    if (setting.key === 'acme_email') {
      return (
        <input
          className="input w-full"
          type="email"
          disabled={disabled}
          placeholder={t('settings.acmeEmailPlaceholder')}
          value={form[setting.key] || ''}
          onChange={(e) => updateField(setting.key, e.target.value)}
        />
      )
    }

    if (setting.key === 'email_provider') {
      return (
        <select
          className="input w-full"
          disabled={disabled}
          value={form[setting.key] || 'smtp'}
          onChange={(e) => updateField(setting.key, e.target.value)}
        >
          <option value="smtp">SMTP</option>
          <option value="graph">Microsoft Graph (Entra ID)</option>
        </select>
      )
    }

    if (setting.key === 'smtp_security') {
      return (
        <select
          className="input w-full"
          disabled={disabled}
          value={form[setting.key] || 'tls'}
          onChange={(e) => updateField(setting.key, e.target.value)}
        >
          <option value="auto">Auto</option>
          <option value="tls">STARTTLS</option>
          <option value="ssl">SSL/TLS (implicit)</option>
          <option value="none">None</option>
        </select>
      )
    }

    if (setting.key === 'secret_key') {
      return (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              className="input w-full font-mono text-sm"
              type={showSecret ? 'text' : 'password'}
              disabled={disabled}
              value={form[setting.key] || ''}
              onChange={(e) => updateField(setting.key, e.target.value)}
            />
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={() => setShowSecret((v) => !v)}
              aria-label={showSecret ? t('settings.hideSecret') : t('settings.showSecret')}
            >
              {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
            </Button>
          </div>
          <p className="text-xs text-amber-700 dark:text-amber-400">{t('settings.secretKeyWarning')}</p>
        </div>
      )
    }

    if (setting.value_type === 'bool') {
      return (
        <select
          className="input w-full"
          disabled={disabled}
          value={form[setting.key] || 'false'}
          onChange={(e) => updateField(setting.key, e.target.value)}
        >
          <option value="true">{t('settings.boolEnabled')}</option>
          <option value="false">{t('settings.boolDisabled')}</option>
        </select>
      )
    }

    if (setting.value_type === 'json') {
      return (
        <textarea
          className="input w-full font-mono text-sm"
          rows={2}
          disabled={disabled}
          value={form[setting.key] || ''}
          onChange={(e) => updateField(setting.key, e.target.value)}
        />
      )
    }

    const isSecret =
      setting.key.includes('password') ||
      setting.key.includes('secret') ||
      setting.key.includes('token') ||
      setting.key.includes('_key')

    return (
      <input
        className="input w-full"
        disabled={disabled}
        type={setting.value_type === 'int' ? 'number' : isSecret ? 'password' : 'text'}
        min={INTERVAL_KEYS.has(setting.key) ? 1 : undefined}
        value={form[setting.key] || ''}
        onChange={(e) => updateField(setting.key, e.target.value)}
      />
    )
  }

  const renderSettingsList = (settings: AppSetting[], filterKeys?: string[]) => {
    const list = filterKeys
      ? filterKeys.map((k) => settings.find((s) => s.key === k)).filter(Boolean) as AppSetting[]
      : settings
    if (list.length === 0) return null
    return (
      <div>
        {list.map((setting) => (
          <SettingRow
            key={setting.key}
            label={settingLabel(setting)}
            description={settingDescription(setting)}
          >
            {renderSettingInput(setting)}
          </SettingRow>
        ))}
      </div>
    )
  }

  const categorySettings = (category: string) => grouped[category] || []

  const emailProvider = form.email_provider || 'smtp'

  const showSystemSave = ['general', 'monitoring', 'ssl', 'notifications', 'integrations', 'security'].includes(activeTab)

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2 text-foreground">
            <SettingsIcon className="text-brand-700 dark:text-brand-400" /> {t('settings.title')}
          </h2>
          <p className="text-muted-foreground mt-1">{t('settings.subtitle')}</p>
        </div>
        {showSystemSave && (
          <div className="flex flex-wrap gap-2 items-center shrink-0">
            {saved && <span className="text-green-600 text-sm">{t('settings.saved')}</span>}
            {isDirty && canWrite && (
              <span className="text-xs text-amber-700 dark:text-amber-400">
                {t('settings.unsaved', { count: dirtyKeys.length })}
              </span>
            )}
            <Button type="button" variant="secondary" onClick={() => void load()}>
              <RefreshCw size={16} /> {t('settings.reload')}
            </Button>
            {canWrite && (
              <Button type="button" onClick={() => void handleSave()} disabled={saving || !isDirty}>
                <Save size={16} /> {saving ? t('settings.saving') : t('settings.save')}
              </Button>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-sm px-4 py-3">
          {error}
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-6">
        <nav className="lg:w-56 shrink-0">
          <div className="flex lg:flex-col gap-1 overflow-x-auto pb-1 lg:pb-0 -mx-1 px-1">
            {tabs.map(({ id, label, icon: Icon }) => {
              const category = Object.entries(CATEGORY_TABS).find(([, tab]) => tab === id)?.[0]
              const tabDirty =
                !!category &&
                (grouped[category] || []).some((s) => dirtyKeys.includes(s.key))
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors text-left',
                    activeTab === id
                      ? 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-400 font-medium'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon size={16} className="shrink-0" />
                  <span className="flex-1">{label}</span>
                  {tabDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />}
                </button>
              )
            })}
          </div>
        </nav>

        <div className="flex-1 min-w-0 space-y-4">
          {activeTab === 'appearance' && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>{t('settings.language.label')}</CardTitle>
                  <CardDescription>{t('settings.language.description')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <LanguageSwitcher />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>{t('settings.theme.label')}</CardTitle>
                  <CardDescription>{t('settings.theme.description')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {(['light', 'dark', 'system'] as ThemeMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setTheme(mode)}
                        className={cn(
                          'px-3 py-1.5 rounded-lg text-sm border transition-colors',
                          theme === mode
                            ? 'bg-brand-50 dark:bg-brand-950/30 border-brand-500 text-brand-700 dark:text-brand-400'
                            : 'border-border text-muted-foreground hover:bg-muted',
                        )}
                      >
                        {t(`settings.theme.${mode}`)}
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
              <p className="text-xs text-muted-foreground px-1">{t('settings.appearanceNote')}</p>
            </>
          )}

          {activeTab === 'organization' && (
            <Card>
              <CardHeader>
                <CardTitle>{t('settings.organization.title')}</CardTitle>
                <CardDescription>{t('settings.organization.description')}</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={saveOrg} className="space-y-4 max-w-lg">
                  <SettingRow
                    label={t('settings.organization.name')}
                    description={t('settings.organization.nameHint')}
                  >
                    <input
                      className="input w-full"
                      value={orgName}
                      disabled={!canManageOrg}
                      onChange={(e) => setOrgName(e.target.value)}
                      required
                    />
                  </SettingRow>
                  {organization?.slug && (
                    <SettingRow label={t('settings.organization.slug')}>
                      <code className="text-sm text-muted-foreground">{organization.slug}</code>
                    </SettingRow>
                  )}
                  {orgError && <p className="text-sm text-red-600">{orgError}</p>}
                  {orgSaved && <p className="text-sm text-green-600">{t('settings.saved')}</p>}
                  {canManageOrg && (
                    <Button type="submit" disabled={orgSaving || !orgName.trim() || orgName === organization?.name}>
                      <Save size={16} />
                      {orgSaving ? t('settings.saving') : t('settings.organization.save')}
                    </Button>
                  )}
                  {!canManageOrg && (
                    <p className="text-xs text-muted-foreground">{t('settings.organization.readOnly')}</p>
                  )}
                </form>
              </CardContent>
            </Card>
          )}

          {activeTab === 'general' && (
            <Card>
              <CardHeader>
                <CardTitle>{t('settings.categories.general')}</CardTitle>
                <CardDescription>{t('settings.tabHints.general')}</CardDescription>
              </CardHeader>
              <CardContent>{renderSettingsList(categorySettings('general'))}</CardContent>
            </Card>
          )}

          {activeTab === 'monitoring' && (
            <>
              {schedule && (
                <Card className="border-brand-200 dark:border-brand-800/40 bg-brand-50/50 dark:bg-brand-950/20">
                  <CardHeader>
                    <CardTitle className="text-brand-700 dark:text-brand-400">
                      {t('settings.schedule.title')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div className="rounded-lg border border-border bg-surface p-3 space-y-2">
                        <p className="text-muted-foreground">{t('settings.schedule.domainMonitoring')}</p>
                        <p className="text-foreground">
                          {t('settings.schedule.every', { count: schedule.domain_monitor.interval_minutes })}
                        </p>
                        <p className="text-muted-foreground">
                          {t('settings.schedule.next', {
                            date: formatDateTime(schedule.domain_monitor.next_run_at),
                          })}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border bg-surface p-3 space-y-2">
                        <p className="text-muted-foreground">{t('settings.schedule.sslMonitoring')}</p>
                        <p className="text-foreground">
                          {t('settings.schedule.every', { count: schedule.ssl_monitor.interval_minutes })}
                        </p>
                        <p className="text-muted-foreground">
                          {t('settings.schedule.next', {
                            date: formatDateTime(schedule.ssl_monitor.next_run_at),
                          })}
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-3">
                      {t('settings.schedule.status', {
                        status: schedule.running
                          ? t('settings.schedule.running')
                          : t('settings.schedule.stopped'),
                      })}
                    </p>
                  </CardContent>
                </Card>
              )}
              <Card>
                <CardHeader>
                  <CardTitle>{t('settings.categories.monitoring')}</CardTitle>
                  <CardDescription>{t('settings.tabHints.monitoring')}</CardDescription>
                </CardHeader>
                <CardContent>{renderSettingsList(categorySettings('monitoring'))}</CardContent>
              </Card>
            </>
          )}

          {activeTab === 'ssl' && (
            <Card>
              <CardHeader>
                <CardTitle>{t('settings.categories.ssl')}</CardTitle>
                <CardDescription>{t('settings.sslHint')}</CardDescription>
              </CardHeader>
              <CardContent>{renderSettingsList(categorySettings('ssl'))}</CardContent>
            </Card>
          )}

          {activeTab === 'notifications' && (
            <>
              {NOTIFICATION_GROUPS.map((group) => {
                let keys = group.keys
                if (group.id === 'email') {
                  keys =
                    emailProvider === 'graph'
                      ? ['email_provider', 'graph_tenant_id', 'graph_client_id', 'graph_client_secret', 'graph_sender']
                      : ['email_provider', 'smtp_host', 'smtp_port', 'smtp_security', 'smtp_timeout', 'smtp_user', 'smtp_password', 'smtp_from']
                }
                return (
                  <Card key={group.id}>
                    <CardHeader>
                      <CardTitle>{t(`settings.notificationGroups.${group.id}.title`)}</CardTitle>
                      <CardDescription>
                        {t(`settings.notificationGroups.${group.id}.description`)}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {renderSettingsList(categorySettings('notifications'), keys)}
                    </CardContent>
                  </Card>
                )
              })}
              <Card>
                <CardHeader>
                  <CardTitle>{t('settings.testNotifications.title')}</CardTitle>
                  <CardDescription>{t('settings.testNotifications.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Button type="button" variant="secondary" onClick={() => void sendTest()} disabled={testing}>
                    <Send size={16} />
                    {testing ? t('alerts.testing') : t('alerts.sendTest')}
                  </Button>
                  {testResult && <p className="text-sm text-muted-foreground">{testResult}</p>}
                  {testError && <p className="text-sm text-red-600">{testError}</p>}
                </CardContent>
              </Card>
            </>
          )}

          {activeTab === 'integrations' && (
            <Card>
              <CardHeader>
                <CardTitle>{t('settings.categories.integrations')}</CardTitle>
                <CardDescription>{t('settings.tabHints.integrations')}</CardDescription>
              </CardHeader>
              <CardContent>{renderSettingsList(categorySettings('integrations'))}</CardContent>
            </Card>
          )}

          {activeTab === 'security' && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>{t('settings.categories.security')}</CardTitle>
                  <CardDescription>{t('settings.tabHints.security')}</CardDescription>
                </CardHeader>
                <CardContent>{renderSettingsList(categorySettings('security'))}</CardContent>
              </Card>

              {canManageSso && (
                <Card>
                  <CardHeader>
                    <CardTitle>{t('roles.sso.title')}</CardTitle>
                    <CardDescription>{t('settings.ssoDescription')}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {ssoError && <p className="text-sm text-red-600">{ssoError}</p>}
                    <div className="space-y-3 border border-border p-4">
                      <div>
                        <h3 className="text-sm font-medium">{t('settings.entraOnboarding.title')}</h3>
                        <p className="text-xs text-muted-foreground">{t('settings.entraOnboarding.description')}</p>
                      </div>
                      {entraOnboardingStatus === 'success' && (
                        <p className="text-sm text-green-700">{t('settings.entraOnboarding.success')}</p>
                      )}
                      {entraOnboardingStatus && entraOnboardingStatus !== 'success' && (
                        <p className="text-sm text-red-600">{t('settings.entraOnboarding.notCompleted')}</p>
                      )}
                      {entraOnboardingError && <p className="text-sm text-red-600">{entraOnboardingError}</p>}
                      <label className="block text-xs text-muted-foreground">
                        {t('settings.entraOnboarding.name')}
                        <input
                          className="mt-1 w-full input"
                          value={entraOnboarding.name}
                          onChange={(e) => setEntraOnboarding((value) => ({ ...value, name: e.target.value }))}
                          required
                        />
                      </label>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={entraOnboarding.auto_provision}
                          onChange={(e) => setEntraOnboarding((value) => ({ ...value, auto_provision: e.target.checked }))}
                        />
                        {t('roles.sso.autoProvision')}
                      </label>
                      <Button type="button" onClick={startEntraOnboarding} disabled={startingEntraOnboarding || !entraOnboarding.name.trim()}>
                        {startingEntraOnboarding ? t('settings.entraOnboarding.starting') : t('settings.entraOnboarding.start')}
                      </Button>
                    </div>
                    <ul className="space-y-2">
                      {providers.length === 0 && (
                        <li className="text-sm text-muted-foreground">{t('settings.ssoEmpty')}</li>
                      )}
                      {providers.map((p) => (
                        <li
                          key={p.id}
                          className="flex justify-between items-center border border-border rounded-lg px-4 py-3 text-sm"
                        >
                          <span>
                            {p.name} · {p.issuer_url}{' '}
                            {!p.enabled && (
                              <span className="text-muted-foreground">{t('roles.sso.disabled')}</span>
                            )}
                          </span>
                          <button
                            type="button"
                            className="text-red-600 text-xs"
                            onClick={async () => {
                              await api.sso.deleteProvider(p.id)
                              setProviders(await api.sso.providers())
                            }}
                          >
                            {t('roles.sso.delete')}
                          </button>
                        </li>
                      ))}
                    </ul>
                    <form onSubmit={createSso} className="grid md:grid-cols-2 gap-3 border border-border rounded-xl p-4">
                      {(['name', 'issuer_url', 'client_id', 'client_secret', 'scopes'] as const).map((field) => (
                        <label key={field} className="text-xs text-muted-foreground">
                          {t(`roles.sso.fields.${SSO_FIELD_KEYS[field]}`)}
                          <input
                            className="mt-1 w-full input"
                            value={ssoForm[field]}
                            onChange={(e) => setSsoForm((s) => ({ ...s, [field]: e.target.value }))}
                            required={field !== 'scopes'}
                            type={field === 'client_secret' ? 'password' : 'text'}
                          />
                        </label>
                      ))}
                      <label className="text-xs text-muted-foreground flex items-center gap-2 md:col-span-2">
                        <input
                          type="checkbox"
                          checked={ssoForm.auto_provision}
                          onChange={(e) =>
                            setSsoForm((s) => ({ ...s, auto_provision: e.target.checked }))
                          }
                        />
                        {t('roles.sso.autoProvision')}
                      </label>
                      <Button type="submit" className="md:col-span-2">
                        {t('roles.sso.addProvider')}
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {activeTab === 'access' && (
            <div className="grid sm:grid-cols-2 gap-4">
              {canReadUsers && (
                <Card className="hover:border-brand-300 dark:hover:border-brand-700 transition-colors">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Users size={18} className="text-brand-600" />
                      {t('settings.access.usersTitle')}
                    </CardTitle>
                    <CardDescription>{t('settings.access.usersDescription')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button asChild variant="secondary" size="sm">
                      <Link to="/users">
                        {t('settings.access.open')} <ExternalLink size={14} />
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              )}
              {canReadRoles && (
                <Card className="hover:border-brand-300 dark:hover:border-brand-700 transition-colors">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <KeyRound size={18} className="text-brand-600" />
                      {t('settings.access.rolesTitle')}
                    </CardTitle>
                    <CardDescription>{t('settings.access.rolesDescription')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button asChild variant="secondary" size="sm">
                      <Link to="/roles">
                        {t('settings.access.open')} <ExternalLink size={14} />
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              )}
              {canManageSso && (
                <Card className="hover:border-brand-300 dark:hover:border-brand-700 transition-colors sm:col-span-2">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Lock size={18} className="text-brand-600" />
                      {t('settings.access.ssoTitle')}
                    </CardTitle>
                    <CardDescription>{t('settings.access.ssoDescription')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button type="button" variant="secondary" size="sm" onClick={() => setTab('security')}>
                      {t('settings.access.manageSso')}
                    </Button>
                  </CardContent>
                </Card>
              )}
              {!canReadUsers && !canReadRoles && !canManageSso && (
                <Card>
                  <CardContent className="pt-2">
                    <p className="text-sm text-muted-foreground">{t('settings.access.noAccess')}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
