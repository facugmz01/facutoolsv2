import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES, type AppLanguage } from '../i18n'

type Props = {
  className?: string
  compact?: boolean
}

export default function LanguageSwitcher({ className = '', compact = false }: Props) {
  const { i18n, t } = useTranslation()
  const current = (SUPPORTED_LANGUAGES.some((l) => l.code === i18n.language)
    ? i18n.language
    : 'en') as AppLanguage

  return (
    <label className={`flex items-center gap-2 ${className}`}>
      {!compact && (
        <span className="text-sm text-muted-foreground">{t('settings.language.label')}</span>
      )}
      <select
        className="input text-sm py-1.5"
        value={current}
        aria-label={t('settings.language.label')}
        onChange={(e) => {
          void i18n.changeLanguage(e.target.value)
        }}
      >
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.nativeLabel}
          </option>
        ))}
      </select>
    </label>
  )
}
