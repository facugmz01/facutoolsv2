import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Plus, Trash2, Eye, Sparkles } from 'lucide-react'
import { api, NotificationTemplate } from '../api'
import { useAuth } from '../auth/AuthContext'
import { NOTIFICATION_TYPES } from '../constants/notifications'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Card } from '../components/ui/card'

type Channel = 'email' | 'teams'

interface FormState {
  name: string
  channel: Channel
  alert_type: string
  subject_template: string
  body_html: string
  body_text: string
  body_json: string
  is_active: boolean
}

const emptyForm = (channel: Channel = 'email'): FormState => ({
  name: '',
  channel,
  alert_type: '*',
  subject_template: '',
  body_html: '',
  body_text: '',
  body_json: '',
  is_active: true,
})

export default function NotificationTemplates() {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const canWrite = hasPermission('alerts:write')

  const [items, setItems] = useState<NotificationTemplate[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<{
    subject?: string
    html?: string
    text?: string
    card?: unknown
    raw?: string
  } | null>(null)
  const [variables, setVariables] = useState<string[]>([])
  const [defaults, setDefaults] = useState<Record<string, Record<string, string>>>({})

  const alertTypeOptions = useMemo(
    () => [
      { value: '*', label: t('notificationTemplates.alertTypes.all') },
      ...NOTIFICATION_TYPES.map(n => ({ value: n.id, label: t(n.labelKey) })),
      { value: 'test', label: t('notificationTemplates.alertTypes.test') },
      { value: 'renewal', label: t('notificationTemplates.alertTypes.renewal') },
      { value: 'downtime', label: t('notificationTemplates.alertTypes.downtime') },
      { value: 'blacklist', label: t('notificationTemplates.alertTypes.blacklist') },
      { value: 'threat', label: t('notificationTemplates.alertTypes.threat') },
      { value: 'email_security', label: t('notificationTemplates.alertTypes.emailSecurity') },
    ],
    [t],
  )

  const load = async () => {
    const [list, meta] = await Promise.all([
      api.notificationTemplates.list(),
      api.notificationTemplates.defaults(),
    ])
    setItems(list)
    setVariables(meta.variables)
    setDefaults(meta.defaults)
  }

  useEffect(() => {
    load().catch(e => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const startCreate = (channel: Channel = 'email') => {
    const builtIn = defaults[channel] || {}
    setSelectedId(null)
    setEditing(true)
    setPreview(null)
    setForm({
      ...emptyForm(channel),
      name: channel === 'email' ? t('notificationTemplates.defaultEmailName') : t('notificationTemplates.defaultTeamsName'),
      subject_template: builtIn.subject_template || '',
      body_html: builtIn.body_html || '',
      body_text: builtIn.body_text || '',
      body_json: builtIn.body_json || '',
    })
  }

  const startEdit = (item: NotificationTemplate) => {
    setSelectedId(item.id)
    setEditing(true)
    setPreview(null)
    setForm({
      name: item.name,
      channel: item.channel as Channel,
      alert_type: item.alert_type,
      subject_template: item.subject_template || '',
      body_html: item.body_html || '',
      body_text: item.body_text || '',
      body_json: item.body_json || '',
      is_active: item.is_active,
    })
  }

  const cancelEdit = () => {
    setEditing(false)
    setSelectedId(null)
    setPreview(null)
    setForm(emptyForm())
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const payload = {
        name: form.name,
        channel: form.channel,
        alert_type: form.alert_type,
        subject_template: form.channel === 'email' ? form.subject_template : null,
        body_html: form.channel === 'email' ? form.body_html : null,
        body_text: form.channel === 'email' ? form.body_text : null,
        body_json: form.channel === 'teams' ? form.body_json : null,
        is_active: form.is_active,
      }
      if (selectedId) {
        await api.notificationTemplates.update(selectedId, payload)
      } else {
        await api.notificationTemplates.create(payload)
      }
      cancelEdit()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm(t('notificationTemplates.confirmDelete'))) return
    setError('')
    try {
      await api.notificationTemplates.remove(id)
      if (selectedId === id) cancelEdit()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.saveFailed'))
    }
  }

  const handleSeed = async () => {
    setError('')
    try {
      await api.notificationTemplates.seedDefaults()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.saveFailed'))
    }
  }

  const handlePreview = async () => {
    setError('')
    try {
      const res = await api.notificationTemplates.preview({
        channel: form.channel,
        subject_template: form.channel === 'email' ? form.subject_template : undefined,
        body_html: form.channel === 'email' ? form.body_html : undefined,
        body_text: form.channel === 'email' ? form.body_text : undefined,
        body_json: form.channel === 'teams' ? form.body_json : undefined,
      })
      setPreview(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('notificationTemplates.previewFailed'))
      setPreview(null)
    }
  }

  const applyBuiltin = () => {
    const builtIn = defaults[form.channel] || {}
    setForm(prev => ({
      ...prev,
      subject_template: builtIn.subject_template || prev.subject_template,
      body_html: builtIn.body_html || prev.body_html,
      body_text: builtIn.body_text || prev.body_text,
      body_json: builtIn.body_json || prev.body_json,
    }))
  }

  const alertTypeLabel = (value: string) =>
    alertTypeOptions.find(o => o.value === value)?.label || value

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground tracking-tight">
            {t('notificationTemplates.title')}
          </h2>
          <p className="text-muted-foreground mt-1">{t('notificationTemplates.subtitle')}</p>
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2 shrink-0">
            <Button variant="secondary" onClick={handleSeed}>
              <Sparkles size={16} /> {t('notificationTemplates.seedDefaults')}
            </Button>
            <Button onClick={() => startCreate('email')}>
              <Plus size={16} /> {t('notificationTemplates.newTemplate')}
            </Button>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid lg:grid-cols-5 gap-6">
        <section className="lg:col-span-2 space-y-3">
          {items.length === 0 ? (
            <Card className="text-center py-12">
              <FileText size={40} className="mx-auto text-muted-foreground mb-4" />
              <p className="text-foreground font-medium">{t('notificationTemplates.empty')}</p>
              <p className="text-sm text-muted-foreground mt-1">{t('notificationTemplates.emptyHint')}</p>
              {canWrite && (
                <div className="flex flex-wrap justify-center gap-2 mt-5">
                  <Button variant="secondary" onClick={handleSeed}>
                    <Sparkles size={16} /> {t('notificationTemplates.seedDefaults')}
                  </Button>
                  <Button onClick={() => startCreate('email')}>
                    <Plus size={16} /> {t('notificationTemplates.newTemplate')}
                  </Button>
                </div>
              )}
            </Card>
          ) : (
            items.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => startEdit(item)}
                className={`w-full text-left border rounded-xl px-4 py-3 transition-colors ${
                  selectedId === item.id
                    ? 'border-primary bg-surface'
                    : 'border-border hover:bg-surface'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-foreground">{item.name}</div>
                    <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-2">
                      <span className="badge badge-info">{item.channel}</span>
                      <span className="badge badge-info">{alertTypeLabel(item.alert_type)}</span>
                      {!item.is_active && (
                        <span className="badge badge-warning">{t('notificationTemplates.inactive')}</span>
                      )}
                    </div>
                  </div>
                  {canWrite && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="hover:text-red-600 shrink-0"
                      onClick={e => {
                        e.stopPropagation()
                        handleDelete(item.id)
                      }}
                    >
                      <Trash2 size={16} />
                    </Button>
                  )}
                </div>
              </button>
            ))
          )}
        </section>

        <section className="lg:col-span-3">
          {editing ? (
            <Card>
              <form onSubmit={handleSave} className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-lg font-semibold text-foreground">
                    {selectedId
                      ? t('notificationTemplates.editTitle')
                      : t('notificationTemplates.createTitle')}
                  </h3>
                  <Button type="button" variant="secondary" size="sm" onClick={applyBuiltin}>
                    {t('notificationTemplates.loadBuiltin')}
                  </Button>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground">{t('notificationTemplates.fields.name')}</label>
                    <Input
                      value={form.name}
                      onChange={e => setForm({ ...form, name: e.target.value })}
                      required
                      disabled={!canWrite}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">{t('notificationTemplates.fields.channel')}</label>
                    <select
                      className="w-full rounded-lg bg-surface border border-border px-3 py-2 text-foreground text-sm"
                      value={form.channel}
                      disabled={!canWrite}
                      onChange={e => {
                        const channel = e.target.value as Channel
                        const builtIn = defaults[channel] || {}
                        setForm(prev => ({
                          ...prev,
                          channel,
                          subject_template: channel === 'email' ? (prev.subject_template || builtIn.subject_template || '') : '',
                          body_html: channel === 'email' ? (prev.body_html || builtIn.body_html || '') : '',
                          body_text: channel === 'email' ? (prev.body_text || builtIn.body_text || '') : '',
                          body_json: channel === 'teams' ? (prev.body_json || builtIn.body_json || '') : '',
                        }))
                        setPreview(null)
                      }}
                    >
                      <option value="email">Email</option>
                      <option value="teams">Microsoft Teams</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">{t('notificationTemplates.fields.alertType')}</label>
                    <select
                      className="w-full rounded-lg bg-surface border border-border px-3 py-2 text-foreground text-sm"
                      value={form.alert_type}
                      disabled={!canWrite}
                      onChange={e => setForm({ ...form, alert_type: e.target.value })}
                    >
                      {alertTypeOptions.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 text-sm text-muted-foreground pb-2">
                      <input
                        type="checkbox"
                        checked={form.is_active}
                        disabled={!canWrite}
                        onChange={e => setForm({ ...form, is_active: e.target.checked })}
                      />
                      {t('notificationTemplates.fields.active')}
                    </label>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  {t('notificationTemplates.variablesHint')}:{' '}
                  {variables.map(v => (
                    <code key={v} className="mx-0.5 px-1 py-0.5 rounded bg-muted text-[11px]">{`{{ ${v} }}`}</code>
                  ))}
                </p>

                {form.channel === 'email' ? (
                  <>
                    <div>
                      <label className="text-xs text-muted-foreground">{t('notificationTemplates.fields.subject')}</label>
                      <Input
                        value={form.subject_template}
                        onChange={e => setForm({ ...form, subject_template: e.target.value })}
                        disabled={!canWrite}
                        className="font-mono text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">{t('notificationTemplates.fields.bodyHtml')}</label>
                      <textarea
                        value={form.body_html}
                        onChange={e => setForm({ ...form, body_html: e.target.value })}
                        disabled={!canWrite}
                        rows={12}
                        className="w-full rounded-lg bg-surface border border-border px-3 py-2 text-foreground font-mono text-xs leading-relaxed"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">{t('notificationTemplates.fields.bodyText')}</label>
                      <textarea
                        value={form.body_text}
                        onChange={e => setForm({ ...form, body_text: e.target.value })}
                        disabled={!canWrite}
                        rows={6}
                        className="w-full rounded-lg bg-surface border border-border px-3 py-2 text-foreground font-mono text-xs leading-relaxed"
                      />
                    </div>
                  </>
                ) : (
                  <div>
                    <label className="text-xs text-muted-foreground">{t('notificationTemplates.fields.bodyJson')}</label>
                    <textarea
                      value={form.body_json}
                      onChange={e => setForm({ ...form, body_json: e.target.value })}
                      disabled={!canWrite}
                      rows={16}
                      className="w-full rounded-lg bg-surface border border-border px-3 py-2 text-foreground font-mono text-xs leading-relaxed"
                    />
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {canWrite && (
                    <Button type="submit" disabled={saving}>
                      {saving ? t('notificationTemplates.saving') : t('notificationTemplates.save')}
                    </Button>
                  )}
                  <Button type="button" variant="secondary" onClick={handlePreview}>
                    <Eye size={16} /> {t('notificationTemplates.preview')}
                  </Button>
                  <Button type="button" variant="ghost" onClick={cancelEdit}>
                    {t('notificationTemplates.cancel')}
                  </Button>
                </div>

                {preview && (
                  <div className="border border-border rounded-xl p-4 space-y-3 bg-muted/30">
                    <h4 className="text-sm font-medium text-foreground">{t('notificationTemplates.previewTitle')}</h4>
                    {preview.subject && (
                      <p className="text-sm"><span className="text-muted-foreground">{t('notificationTemplates.fields.subject')}:</span> {preview.subject}</p>
                    )}
                    {preview.html && (
                      <iframe
                        title="email-preview"
                        sandbox=""
                        srcDoc={preview.html}
                        className="w-full h-72 rounded-lg border border-border bg-white"
                      />
                    )}
                    {preview.text && (
                      <pre className="text-xs whitespace-pre-wrap text-muted-foreground bg-surface border border-border rounded-lg p-3">{preview.text}</pre>
                    )}
                    {preview.card != null && (
                      <pre className="text-xs overflow-auto text-muted-foreground bg-surface border border-border rounded-lg p-3">
                        {JSON.stringify(preview.card, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </form>
            </Card>
          ) : (
            <Card className="text-center py-16 text-muted-foreground">
              <FileText size={36} className="mx-auto mb-3 opacity-50" />
              <p>{t('notificationTemplates.selectHint')}</p>
            </Card>
          )}
        </section>
      </div>
    </div>
  )
}
