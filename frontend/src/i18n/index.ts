import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import en from './locales/en.json'
import esAR from './locales/es-AR.json'

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'es-AR', label: 'Español (Argentina)', nativeLabel: 'Español (Argentina)' },
] as const

export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number]['code']

export const DATE_LOCALES: Record<string, string> = {
  en: 'en-US',
  'es-AR': 'es-AR',
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      'es-AR': { translation: esAR },
    },
    fallbackLng: 'en',
    supportedLngs: ['en', 'es-AR'],
    nonExplicitSupportedLngs: false,
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'domaintools_language',
    },
  })

const syncDocumentLang = (lng: string) => {
  document.documentElement.lang = lng === 'es-AR' ? 'es-AR' : 'en'
}

syncDocumentLang(i18n.language)
i18n.on('languageChanged', syncDocumentLang)

export default i18n
