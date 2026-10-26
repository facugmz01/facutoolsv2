import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bell } from 'lucide-react'
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
      className={`relative w-11 h-6 shrink-0 rounded-full transition-colors ${checked ? 'bg-brand-600' : 'bg-muted'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-surface transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </button>
  )
}

export default function DomainNotificationsCard({ domainId }: { domainId: number }) {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<DomainNotificationSettings | null>(null)
  const [saved, setSaved] = useState<DomainNotificationSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    setSettings(null)
    api.domains.getNotifications(domainId)
      .then(data => {
        const full = { ...data, preferences: { ...DEFAULT_NOTIFICATIONS, ...data.preferences } }
        setSettings(full)
        setSaved(full)
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
  }, [domainId])

  const dirty = !!settings && JSON.stringify(settings) !== JSON.stringify(saved)

  const save = async () => {
    if (!settings) return
    setSaving(true)
    setError(null)
    setOk(false)
    try {
      const data = await api.domains.updateNotifications(domainId, settings)
      setSettings(data)
      setSaved(data)
      setOk(true)
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
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{t('domains.addWizard.step3.applySubdomains')}</p>
              <p className="text-xs text-muted-foreground">{t('domains.addWizard.step3.applySubdomainsHint')}</p>
            </div>
            <Toggle
              checked={settings.include_subdomains}
              onChange={v => setSettings({ ...settings, include_subdomains: v })}
            />
          </div>
          <div className="divide-y divide-border border border-border rounded-lg">
            {NOTIFICATION_TYPES.map(item => (
              <div key={item.id} className="flex items-start justify-between gap-3 p-3">
                <div>
                  <p className="text-sm font-medium">{t(item.labelKey)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t(item.descriptionKey)}</p>
                </div>
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
          {error && <p className="text-sm text-red-500">{error}</p>}
          {ok && !dirty && <p className="text-sm text-green-500">{t('domains.detail.alertsSaved')}</p>}
          <button onClick={save} disabled={!dirty || saving} className="btn-primary w-full">
            {saving ? t('common.loading') : t('common.save')}
          </button>
        </div>
      )}
    </InfoCard>
  )
}
