import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { api } from '../api'
import { DEFAULT_NOTIFICATIONS, NOTIFICATION_TYPES, enabledNotificationLabels } from '../constants/notifications'
import {
  formatDate,
  normalizeDomain,
  toDateInputValue,
  validateDomainFormat,
} from '../utils/domainValidation'

const STEP_KEYS = ['domainName', 'domainDetails', 'notifications', 'confirm'] as const

interface WizardState {
  name: string
  registrar: string
  expiresAt: string
  tags: string
  notes: string
  notifications: Record<string, boolean>
  includeSubdomains: boolean
}

const initialState: WizardState = {
  name: '',
  registrar: '',
  expiresAt: '',
  tags: '',
  notes: '',
  notifications: { ...DEFAULT_NOTIFICATIONS },
  includeSubdomains: true,
}

function StepIndicator({ current }: { current: number }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-center gap-2 mb-8 overflow-x-auto pb-2">
      {STEP_KEYS.map((key, i) => {
        const step = i + 1
        const active = step === current
        const done = step < current
        const label = t(`domains.addWizard.steps.${key}`)
        return (
          <div key={key} className="flex items-center gap-2">
            <div className="flex flex-col items-center min-w-[72px] sm:min-w-[90px]">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 ${
                active ? 'border-brand-500 bg-brand-600 text-white' :
                done ? 'border-brand-500 text-brand-700 dark:text-brand-400' :
                'border-border text-muted-foreground'
              }`}>
                {step}
              </div>
              <span className={`text-xs mt-2 text-center ${active ? 'text-brand-700 dark:text-brand-400' : 'text-muted-foreground'}`}>
                {label}
              </span>
            </div>
            {i < STEP_KEYS.length - 1 && (
              <div className={`w-12 h-0.5 mb-6 ${done ? 'bg-brand-500' : 'bg-muted'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors ${checked ? 'bg-brand-600' : 'bg-muted'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-surface transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </button>
  )
}

export default function AddDomain() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [state, setState] = useState<WizardState>(initialState)
  const [error, setError] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [previewDetails, setPreviewDetails] = useState<Record<string, unknown> | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const previewRequestIdRef = useRef(0)
  const saveRequestIdRef = useRef(0)
  const previewTimerRef = useRef<number | null>(null)

  const normalizedName = normalizeDomain(state.name)

  useEffect(() => {
    if (step !== 2 || !normalizedName) {
      if (previewTimerRef.current) {
        window.clearTimeout(previewTimerRef.current)
        previewTimerRef.current = null
      }
      setLoadingPreview(false)
      return
    }

    const requestId = ++previewRequestIdRef.current
    setLoadingPreview(true)
    setError(null)

    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current)
    }

    previewTimerRef.current = window.setTimeout(() => {
      api.domains.preview(normalizedName)
        .then(preview => {
          if (requestId !== previewRequestIdRef.current) return
          setState(prev => ({
            ...prev,
            registrar: preview.registrar || prev.registrar,
            expiresAt: toDateInputValue(preview.expires_at) || prev.expiresAt,
          }))
          setPreviewDetails(preview.details)
        })
        .catch(e => {
          if (requestId === previewRequestIdRef.current) {
            setError(e instanceof Error ? e.message : t('errors.domainInfoFetchFailed'))
          }
        })
        .finally(() => {
          if (requestId === previewRequestIdRef.current) {
            setLoadingPreview(false)
          }
          if (previewTimerRef.current) {
            window.clearTimeout(previewTimerRef.current)
            previewTimerRef.current = null
          }
        })
    }, 350)

    return () => {
      if (previewTimerRef.current) {
        window.clearTimeout(previewTimerRef.current)
        previewTimerRef.current = null
      }
      previewRequestIdRef.current += 1
    }
  }, [step, normalizedName, t])

  const update = (patch: Partial<WizardState>) => setState(prev => ({ ...prev, ...patch }))

  const handleStep1Next = async () => {
    const formatError = validateDomainFormat(state.name)
    if (formatError) {
      setError(formatError)
      return
    }

    setValidating(true)
    setError(null)
    try {
      const result = await api.domains.validate(normalizedName)
      if (!result.valid || !result.available) {
        setError(result.error || t('errors.invalidDomain'))
        return
      }
      update({ name: result.normalized })
      setStep(2)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errors.domainValidationFailed'))
    } finally {
      setValidating(false)
    }
  }

  const handleStep2Next = () => {
    setStep(3)
  }

  const handleSave = async () => {
    if (saving) return
    const requestId = ++saveRequestIdRef.current

    setSaving(true)
    setError(null)
    const idempotencyKey = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `domain-setup-${Date.now()}-${Math.random().toString(16).slice(2)}`
    try {
      const result = await api.domains.setup({
        name: normalizedName,
        registrar: state.registrar || undefined,
        expires_at: state.expiresAt ? new Date(state.expiresAt).toISOString() : undefined,
        notes: state.notes || undefined,
        tags: state.tags ? state.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        subdomains: [],
        notifications: {
          preferences: state.notifications,
          include_subdomains: state.includeSubdomains,
        },
      }, idempotencyKey)
      if (requestId !== saveRequestIdRef.current) return
      navigate(`/domains/${result.domain.id}`)
    } catch (e) {
      if (requestId !== saveRequestIdRef.current) return
      setError(e instanceof Error ? e.message : t('errors.domainSaveFailed'))
    } finally {
      if (requestId === saveRequestIdRef.current) {
        setSaving(false)
      }
    }
  }

  const enabledNotifications = enabledNotificationLabels(state.notifications, t)

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <div className="text-sm text-muted-foreground mb-2">
          <Link to="/backoffice" className="hover:text-foreground-secondary">{t('domains.addWizard.breadcrumbHome')}</Link>
          <span className="mx-2">›</span>
          <Link to="/domains" className="hover:text-foreground-secondary">{t('domains.addWizard.breadcrumbDomains')}</Link>
          <span className="mx-2">›</span>
          <span className="text-muted-foreground">{t('domains.addWizard.breadcrumbAdd')}</span>
        </div>
        <h2 className="text-2xl font-bold">{t('domains.addWizard.title')}</h2>
      </div>

      <StepIndicator current={step} />

      {error && (
        <div className="card border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="card space-y-6">
        {step === 1 && (
          <>
            <div>
              <h3 className="text-lg font-semibold">{t('domains.addWizard.step1.title')}</h3>
              <p className="text-muted-foreground text-sm mt-1">{t('domains.addWizard.step1.subtitle')}</p>
            </div>
            <input
              className="input w-full"
              placeholder={t('domains.addWizard.step1.placeholder')}
              value={state.name}
              onChange={e => update({ name: e.target.value })}
              autoFocus
            />
            <p className="text-sm text-muted-foreground">
              {t('domains.addWizard.step1.bulkImportQuestion')}{' '}
              <Link to="/domains" className="text-brand-700 dark:text-brand-400 hover:underline">{t('domains.addWizard.step1.bulkImportLink')}</Link>
            </p>
            <div className="flex justify-end">
              <button onClick={handleStep1Next} disabled={validating || saving} className="btn-primary flex items-center gap-2" aria-busy={validating}>
                {validating && <Loader2 size={16} className="animate-spin" />}
                {t('domains.addWizard.step1.next')}
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div>
              <h3 className="text-lg font-semibold">{t('domains.addWizard.step2.title')}</h3>
              <p className="text-muted-foreground text-sm mt-1">
                {t('domains.addWizard.step2.infoFor', { domain: normalizedName })}
                {loadingPreview && <span className="ml-2 text-muted-foreground">{t('domains.addWizard.step2.loadingData')}</span>}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-muted-foreground">{t('domains.addWizard.step2.registrarLabel')}</label>
                <input
                  className="input w-full mt-1"
                  placeholder={t('domains.addWizard.step2.registrarPlaceholder')}
                  value={state.registrar}
                  onChange={e => update({ registrar: e.target.value })}
                />
                <p className="text-xs text-muted-foreground mt-1">{t('domains.addWizard.step2.registrarHint')}</p>
              </div>
              <div>
                <label className="text-sm text-muted-foreground">{t('domains.addWizard.step2.expiryLabel')}</label>
                <input
                  type="date"
                  className="input w-full mt-1"
                  value={state.expiresAt}
                  onChange={e => update({ expiresAt: e.target.value })}
                />
                <p className="text-xs text-muted-foreground mt-1">{t('domains.addWizard.step2.expiryHint')}</p>
              </div>
              <div>
                <label className="text-sm text-muted-foreground">{t('domains.addWizard.step2.tagsLabel')}</label>
                <input
                  className="input w-full mt-1"
                  placeholder={t('domains.addWizard.step2.tagsPlaceholder')}
                  value={state.tags}
                  onChange={e => update({ tags: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">{t('domains.addWizard.step2.notesLabel')}</label>
                <input
                  className="input w-full mt-1"
                  placeholder={t('domains.addWizard.step2.notesPlaceholder')}
                  value={state.notes}
                  onChange={e => update({ notes: e.target.value })}
                />
              </div>
            </div>

            {previewDetails && (
              <div className="border border-border rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowDetails(v => !v)}
                  className="w-full flex items-center justify-between p-4 bg-canvas hover:bg-canvas transition-colors"
                >
                  <span className="font-medium">{t('domains.addWizard.step2.domainInformation')}</span>
                  {showDetails ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                </button>
                {showDetails && (
                  <div className="p-4 max-h-80 overflow-auto">
                    <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono">
                      {JSON.stringify(previewDetails, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-between">
              <button onClick={() => setStep(1)} className="btn-secondary" disabled={loadingPreview}>{t('domains.addWizard.step2.previous')}</button>
              <button onClick={handleStep2Next} disabled={loadingPreview} className="btn-primary" aria-busy={loadingPreview}>{t('domains.addWizard.step2.next')}</button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div>
              <h3 className="text-lg font-semibold">{t('domains.addWizard.step3.title')}</h3>
              <p className="text-muted-foreground text-sm mt-1">
                {t('domains.addWizard.step3.subtitle')}
              </p>
            </div>

            <div className="flex items-center justify-between p-4 bg-brand-600/10 border border-brand-600/30 rounded-lg">
              <div>
                <p className="font-medium text-brand-700 dark:text-brand-400">{t('domains.addWizard.step3.applySubdomains')}</p>
                <p className="text-sm text-muted-foreground">
                  {t('domains.addWizard.step3.applySubdomainsHint')}
                </p>
              </div>
              <Toggle
                checked={state.includeSubdomains}
                onChange={v => update({ includeSubdomains: v })}
              />
            </div>

            <div className="divide-y divide-border border border-border rounded-lg">
              {NOTIFICATION_TYPES.map(item => (
                <div key={item.id} className="flex items-start justify-between gap-4 p-4">
                  <div>
                    <p className="font-medium">{t(item.labelKey)}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">{t(item.descriptionKey)}</p>
                    {'warningKey' in item && item.warningKey && (
                      <p className="text-xs text-yellow-500 mt-1">{t(item.warningKey)}</p>
                    )}
                  </div>
                  <Toggle
                    checked={!!state.notifications[item.id]}
                    onChange={v => update({
                      notifications: { ...state.notifications, [item.id]: v },
                    })}
                  />
                </div>
              ))}
            </div>

            <div className="flex justify-between">
              <button onClick={() => setStep(2)} className="btn-secondary">{t('domains.addWizard.step3.previous')}</button>
              <button onClick={() => setStep(4)} className="btn-primary">{t('domains.addWizard.step3.next')}</button>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <div>
              <h3 className="text-lg font-semibold">{t('domains.addWizard.step4.title')}</h3>
              <p className="text-muted-foreground text-sm mt-1">
                {t('domains.addWizard.step4.readyToAdd', { domain: normalizedName })}
              </p>
            </div>

            <div className="space-y-4 border border-border rounded-lg p-4">
              <h4 className="font-medium text-foreground-secondary">{t('domains.addWizard.step4.reviewTitle')}</h4>
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">{t('domains.addWizard.step4.domainName')}</dt>
                  <dd className="font-medium">{normalizedName}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('domains.addWizard.step4.registrar')}</dt>
                  <dd>{state.registrar || '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('domains.addWizard.step4.expiryDate')}</dt>
                  <dd>{state.expiresAt ? formatDate(state.expiresAt) : '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('domains.addWizard.step4.tags')}</dt>
                  <dd>{state.tags || '—'}</dd>
                </div>
                <div className="md:col-span-2">
                  <dt className="text-muted-foreground">{t('domains.addWizard.step4.notes')}</dt>
                  <dd>{state.notes || '—'}</dd>
                </div>
                <div className="md:col-span-2">
                  <dt className="text-muted-foreground">{t('domains.addWizard.step4.notifications')}</dt>
                  <dd>
                    {enabledNotifications.length > 0 ? (
                      <ul className="list-disc list-inside mt-1 text-foreground-secondary">
                        {enabledNotifications.map(n => <li key={n}>{n}</li>)}
                      </ul>
                    ) : t('domains.addWizard.step4.noNotifications')}
                    {state.includeSubdomains && enabledNotifications.length > 0 && (
                      <p className="text-xs text-brand-700 dark:text-brand-400 mt-1">{t('domains.addWizard.step4.includesSubdomains')}</p>
                    )}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="flex justify-between">
              <button onClick={() => setStep(3)} className="btn-secondary" disabled={saving}>{t('domains.addWizard.step4.previous')}</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2" aria-busy={saving}>
                {saving && <Loader2 size={16} className="animate-spin" />}
                {t('domains.addWizard.step4.save')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
