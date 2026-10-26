import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Settings } from 'lucide-react'
import { api, Domain } from '../../api'
import { InfoCard } from './AssetDetailParts'

interface FormState {
  registrar: string
  expiresAt: string
  renewalCost: string
  tags: string
  notes: string
}

function toForm(d: Domain): FormState {
  return {
    registrar: d.registrar ?? '',
    expiresAt: d.expires_at ? d.expires_at.slice(0, 10) : '',
    renewalCost: d.renewal_cost != null ? String(d.renewal_cost) : '',
    tags: d.tags.join(', '),
    notes: d.notes ?? '',
  }
}

export default function DomainSettingsCard({ domain, onSaved }: { domain: Domain; onSaved: () => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState<FormState>(() => toForm(domain))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  useEffect(() => { setForm(toForm(domain)) }, [domain])

  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(domain))
  const set = (patch: Partial<FormState>) => { setForm({ ...form, ...patch }); setOk(false) }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.domains.update(domain.id, {
        registrar: form.registrar.trim() || null,
        expires_at: form.expiresAt ? `${form.expiresAt}T00:00:00` : null,
        renewal_cost: form.renewalCost.trim() ? Number(form.renewalCost) : null,
        tags: form.tags.split(',').map(s => s.trim()).filter(Boolean),
        notes: form.notes.trim() || null,
      })
      setOk(true)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const label = 'text-sm text-muted-foreground'
  return (
    <InfoCard title={t('domains.detail.sections.settings')} icon={Settings}>
      <div className="space-y-3">
        <div>
          <label className={label}>{t('domains.addWizard.step2.registrarLabel')}</label>
          <input className="input w-full mt-1" value={form.registrar} onChange={e => set({ registrar: e.target.value })} />
        </div>
        <div>
          <label className={label}>{t('domains.addWizard.step2.expiryLabel')}</label>
          <input type="date" className="input w-full mt-1" value={form.expiresAt} onChange={e => set({ expiresAt: e.target.value })} />
        </div>
        <div>
          <label className={label}>{t('domains.detail.fields.renewalCost')}</label>
          <input type="number" min="0" step="0.01" className="input w-full mt-1" value={form.renewalCost} onChange={e => set({ renewalCost: e.target.value })} />
        </div>
        <div>
          <label className={label}>{t('domains.addWizard.step2.tagsLabel')}</label>
          <input
            className="input w-full mt-1"
            placeholder={t('domains.addWizard.step2.tagsPlaceholder')}
            value={form.tags}
            onChange={e => set({ tags: e.target.value })}
          />
        </div>
        <div>
          <label className={label}>{t('domains.addWizard.step2.notesLabel')}</label>
          <textarea className="input w-full mt-1" rows={3} value={form.notes} onChange={e => set({ notes: e.target.value })} />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        {ok && !dirty && <p className="text-sm text-green-500">{t('domains.detail.settingsSaved')}</p>}
        <button onClick={save} disabled={!dirty || saving} className="btn-primary w-full">
          {saving ? t('common.loading') : t('common.save')}
        </button>
      </div>
    </InfoCard>
  )
}
