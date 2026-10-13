import { computed, watch } from 'vue'
import { useCookie, useHead, useState } from '#imports'
import { hardcodedDictionary } from './i18n-default-dictionary'
import { createSingleFlight } from '~/utils/single-flight'

export interface LocaleOption {
  code: string
  label: string
  name: string
  htmlLang: string
}

export const DEFAULT_LOCALE_OPTIONS: LocaleOption[] = [
  { code: 'vi', label: 'VN', name: 'Tiếng Việt', htmlLang: 'vi' },
  { code: 'en', label: 'EN', name: 'English', htmlLang: 'en' },
  { code: 'zh', label: 'ZH', name: '中文', htmlLang: 'zh' },
  { code: 'fr', label: 'FR', name: 'Français', htmlLang: 'fr' },
  { code: 'ru', label: 'RU', name: 'Русский', htmlLang: 'ru' },
  { code: 'lo', label: 'LAO', name: 'ພາສາລາວ', htmlLang: 'lo' },
]

export const localeOptions = DEFAULT_LOCALE_OPTIONS
const DEFAULT_LOCALE = 'vi'

// Dùng chung cho mọi lời gọi useI18n(): chỉ MỘT yêu cầu bản dịch/ngôn ngữ đang bay tại một thời điểm.
const singleFlight = createSingleFlight()

const normalizeLocale = (value: unknown): string => {
  if (typeof value === 'string' && value.trim()) {
    return value.trim().toLowerCase()
  }
  return DEFAULT_LOCALE
}

export const useI18n = () => {
  const localeCookie = useCookie<string>('cdkt_lang', {
    default: () => DEFAULT_LOCALE,
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    secure: false, // Cookie ngôn ngữ công khai không chứa bí mật; secure=false để tương thích reverse proxy HTTP loopback
  })
  const dbLanguages = useState<LocaleOption[]>('dbLanguages', () => [])

  const locales = computed(() => {
    if (dbLanguages.value.length > 0) return dbLanguages.value
    return DEFAULT_LOCALE_OPTIONS
  })

  const currentLang = useState<string>('currentLang', () => normalizeLocale(localeCookie.value))
  const currentLocale = computed(() => locales.value.find(locale => locale.code === currentLang.value) ?? DEFAULT_LOCALE_OPTIONS[0]!)

  function loadLanguagesFromDb(): Promise<void> {
    return singleFlight('languages', async () => {
      try {
        const res = await ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; items: Array<{ code: string; name: string; nativeName: string; isDefault: boolean }> }>)('/api/public/languages')
        if (res.ok && Array.isArray(res.items) && res.items.length > 0) {
          dbLanguages.value = res.items.map(l => ({
            code: l.code,
            label: l.code.toUpperCase(),
            name: l.nativeName || l.name,
            htmlLang: l.code,
          }))
        }
      } catch {
        // Non-critical fallback
      }
    })
  }

  if (import.meta.client && dbLanguages.value.length === 0) {
    void loadLanguagesFromDb()
  }

  // On client, prioritize persisted user choice from localStorage/cookie and never overwrite with SSR default
  if (import.meta.client) {
    const stored = localStorage.getItem('cdkt_lang') || localeCookie.value
    if (stored) {
      const preferred = normalizeLocale(stored)
      if (currentLang.value !== preferred) {
        currentLang.value = preferred
      }
      if (localeCookie.value !== preferred) {
        localeCookie.value = preferred
      }
    }
  }

  watch(currentLang, (locale) => {
    localeCookie.value = locale
    if (import.meta.client) {
      localStorage.setItem('cdkt_lang', locale)
    }
  })
  useHead(() => ({
    htmlAttrs: {
      lang: currentLocale.value.htmlLang,
    },
  }))

  // ── DB-driven translations: fetched once per locale, cached in useState ──
  // design.md D7: fetch from public endpoint, cache via useState (SSR-safe)
  const dbTranslations = useState<Record<string, Record<string, string>> | null>(
    'dbTranslations',
    () => null,
  )
  const dbTranslationsLang = useState<string | null>('dbTranslationsLang', () => null)

  // Fetch translations for current locale — kể cả `vi`. Nguồn chân lý là DB
  // (admin sửa ở /admin/languages → frontend hiển thị theo DB). Hardcoded
  // dictionary chỉ còn fallback khi DB chưa seed / API hỏng / SSR chưa fetch xong.
  if (dbTranslations.value === null) {
    // Client-side fetch only — public pages are all lazy/SWR, so this runs
    // after mount. On server, falls back to hardcoded dictionary.
    if (import.meta.client) {
      const lang = currentLang.value
      void singleFlight(`translations:${lang}`, () =>
        ($fetch as (u: string, o?: Record<string, unknown>) => Promise<{ ok: boolean; translations: Record<string, Record<string, string>> }>)(
          `/api/public/translations/${lang}`,
        )
          .then((res) => {
            if (res.ok && res.translations) {
              // Flatten groups: {"nav": {"home": "Home"}, ...} → {"home": "Home", ...}
              const flat: Record<string, string> = {}
              for (const group of Object.values(res.translations)) {
                Object.assign(flat, group)
              }
              dbTranslations.value = { [lang]: flat }
              dbTranslationsLang.value = lang
            }
          })
          .catch(() => {
            dbTranslations.value = {}
          }),
      )
    }
  }

  const t = (key: string): string => {
    const lang = currentLang.value
    // 1. DB translations (if loaded)
    const dbVal = dbTranslations.value?.[lang]?.[key]
    if (dbVal) return dbVal
    // 2. Hardcoded dictionary
    const hardcodedVal = hardcodedDictionary[lang]?.[key]
    if (hardcodedVal) return hardcodedVal
    // 3. Fallback to Vietnamese hardcoded (for keys only defined in vi)
    const viVal = hardcodedDictionary.vi?.[key]
    if (viVal) return viVal
    // 4. Last resort: key name
    return key
  }

  const setLang = (locale: string) => {
    const newLocale = normalizeLocale(locale)
    const changed = currentLang.value !== newLocale
    // Invalidate DB cache when switching languages
    if (newLocale !== dbTranslationsLang.value) {
      dbTranslations.value = null
      dbTranslationsLang.value = null
    }
    currentLang.value = newLocale
    localeCookie.value = newLocale
    if (import.meta.client) {
      localStorage.setItem('cdkt_lang', newLocale)
      // Đặt cookie trực tiếp để trình duyệt chắc chắn gửi header Cookie trong lượt reload tiếp theo
      document.cookie = `cdkt_lang=${newLocale}; path=/; max-age=31536000; SameSite=Lax`
      if (changed && typeof window !== 'undefined') {
        window.location.reload()
      }
    }
  }
  return {
    currentLang,
    currentLocale,
    locales,
    t,
    setLang,
    loadLanguagesFromDb,
  }
}
