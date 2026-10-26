import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tag } from 'lucide-react'
import { api, Domain } from '../../api'
import { InfoCard } from './AssetDetailParts'

const toForm = (d: Domain) => ({ tags: d.tags.join(', '), notes: d.notes ?? '' })

export default function DomainSettingsCard({ domain, onSaved }: { domain: Domain; onSaved: () => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState(() => toForm(domain))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setForm(toForm(domain)) }, [domain])

  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(domain))

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.domains.update(domain.id, {
        tags: form.tags.split(',').map(s => s.trim()).filter(Boolean),
        notes: form.notes.trim() || null,
      })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <InfoCard title={t('domains.detail.sections.settings')} icon={Tag}>
      <div className="space-y-2">
        <input
          className="input w-full py-1.5 text-sm"
          aria-label={t('domains.addWizard.step2.tagsLabel')}
          placeholder={t('domains.addWizard.step2.tagsLabel')}
          value={form.tags}
          onChange={e => setForm({ ...form, tags: e.target.value })}
        />
        <textarea
          className="input w-full py-1.5 text-sm resize-none"
          rows={2}
          aria-label={t('domains.addWizard.step2.notesLabel')}
          placeholder={t('domains.addWizard.step2.notesLabel')}
          value={form.notes}
          onChange={e => setForm({ ...form, notes: e.target.value })}
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
        {dirty && (
          <button onClick={save} disabled={saving} className="btn-primary w-full py-1.5 text-sm">
            {saving ? t('common.loading') : t('common.save')}
          </button>
        )}
      </div>
    </InfoCard>
  )
}
