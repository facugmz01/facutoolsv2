import { Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../theme/ThemeContext'

type Props = {
  className?: string
  compact?: boolean
}

export default function ThemeToggle({ className = '', compact = false }: Props) {
  const { t } = useTranslation()
  const { resolved, toggle } = useTheme()
  const isDark = resolved === 'dark'
  const label = isDark
    ? t('theme.switchToLight', { defaultValue: 'Switch to light mode' })
    : t('theme.switchToDark', { defaultValue: 'Switch to dark mode' })

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      className={`inline-flex items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors ${
        compact ? 'p-1.5' : 'gap-2 px-2.5 py-1.5 text-xs'
      } ${className}`}
    >
      {isDark ? <Sun size={compact ? 16 : 14} /> : <Moon size={compact ? 16 : 14} />}
      {!compact && (
        <span>{isDark ? t('theme.light', { defaultValue: 'Light' }) : t('theme.dark', { defaultValue: 'Dark' })}</span>
      )}
    </button>
  )
}
