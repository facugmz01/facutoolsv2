import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bell, ChevronDown, ChevronUp } from 'lucide-react'
import { api, DomainNotificationSettings } from '../../api'
import { DEFAULT_NOTIFICATIONS, NOTIFICATION_TYPES } from '../../constants/notifications'
import { InfoCard } from './AssetDetailParts'

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-9 h-5 shrink-0 rounded-full transition-colors ${checked ? 'bg-brand-600' : 'bg-muted'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-surface transition-transform ${checked ? 'translate-x-4' : ''}`} />
    </button>
  )
}

export default function DomainNotificationsCard({ domainId }: { domainId: number }) {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<DomainNotificationSettings | null>(null)
  const [saved, setSaved] = useState<DomainNotificationSettings | null>(null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSettings(null)
    setOpen(false)
    api.domains.getNotifications(domainId)
      .then(data => {
        const full = { ...data, preferences: { ...DEFAULT_NOTIFICATIONS, ...data.preferences } }
        setSettings(full)
        setSaved(full)
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
  }, [domainId])

  const dirty = !!settings && JSON.stringify(settings) !== JSON.stringify(saved)
  const activeCount = settings ? NOTIFICATION_TYPES.filter(i => settings.preferences[i.id]).length : 0

  const save = async () => {
    if (!settings) return
    setSaving(true)
    setError(null)
    try {
      const data = await api.domains.updateNotifications(domainId, settings)
      setSettings(data)
      setSaved(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <InfoCard title={t('domains.detail.sections.alerts')} icon={Bell}>
      {!settings ? (
        <p className="text-sm text-muted-foreground">{error ?? t('common.loading')}</p>
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="w-full flex items-center justify-between text-sm text-muted-foreground hover:text-foreground"
          >
            <span>{t('domains.detail.alertsActive', { active: activeCount, total: NOTIFICATION_TYPES.length })}</span>
            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>

          {open && (
            <>
              <div className="divide-y divide-border border border-border rounded-lg">
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="text-sm">{t('domains.addWizard.step3.applySubdomains')}</span>
                  <Toggle
                    checked={settings.include_subdomains}
                    onChange={v => setSettings({ ...settings, include_subdomains: v })}
                  />
                </div>
                {NOTIFICATION_TYPES.map(item => (
                  <div key={item.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="text-sm" title={t(item.descriptionKey)}>{t(item.labelKey)}</span>
                    <Toggle
                      checked={!!settings.preferences[item.id]}
                      onChange={v => setSettings({
                        ...settings,
                        preferences: { ...settings.preferences, [item.id]: v },
                      })}
                    />
                  </div>
                ))}
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
              {dirty && (
                <button onClick={save} disabled={saving} className="btn-primary w-full py-1.5 text-sm">
                  {saving ? t('common.loading') : t('common.save')}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </InfoCard>
  )
}
