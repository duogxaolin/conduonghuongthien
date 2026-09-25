import { computed, watch } from 'vue'
import { useCookie, useHead, useState } from '#imports'
import { extraDictionaries } from './i18n-extra'

type LocaleCode = 'vi' | 'en' | 'zh' | 'fr' | 'ru' | 'lo'

export const localeOptions = [
  { code: 'vi' as const, label: 'VN', name: 'Tiếng Việt', htmlLang: 'vi' },
  { code: 'en' as const, label: 'EN', name: 'English', htmlLang: 'en' },
  { code: 'zh' as const, label: 'ZH', name: '中文', htmlLang: 'zh' },
  { code: 'fr' as const, label: 'FR', name: 'Français', htmlLang: 'fr' },
  { code: 'ru' as const, label: 'RU', name: 'Русский', htmlLang: 'ru' },
  { code: 'lo' as const, label: 'LAO', name: 'ພາສາລາວ', htmlLang: 'lo' },
] satisfies ReadonlyArray<{ code: LocaleCode, label: string, name: string, htmlLang: string }>
const DEFAULT_LOCALE: LocaleCode = 'vi'
const FALLBACK_LOCALE = localeOptions.find(locale => locale.code === DEFAULT_LOCALE)
  ?? { code: DEFAULT_LOCALE, label: 'VN', name: 'Tiếng Việt', htmlLang: 'vi' }
const LOCALE_CODES = new Set<LocaleCode>(localeOptions.map(locale => locale.code))

const normalizeLocale = (value: unknown): LocaleCode => {
  return typeof value === 'string' && LOCALE_CODES.has(value as LocaleCode)
    ? value as LocaleCode
    : DEFAULT_LOCALE
}

export const useI18n = () => {
  const localeCookie = useCookie<string>('cdkt_lang', {
    default: () => DEFAULT_LOCALE,
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  })
  const currentLang = useState<LocaleCode>('currentLang', () => normalizeLocale(localeCookie.value))
  const currentLocale = computed(() => localeOptions.find(locale => locale.code === currentLang.value) ?? FALLBACK_LOCALE)

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

  // ── Hardcoded dictionaries (fallback only) ────────────────────────────
  // Kept as final fallback: if DB is unreachable, the site still works
  // in Vietnamese. design.md D7.
  const hardcodedDictionary: Record<string, Record<string, string>> = {
    vi: {
      home: 'Trang chủ',
      about: 'Giới thiệu',
      news: 'Bản tin',
      news_featured: 'Tin nổi bật',
      news_activities: 'Tin hoạt động',
      news_local: 'Tin địa phương',
      role_models: 'Tấm gương tiêu biểu',
      reintegration: 'Mô hình tái hòa nhập',
      documents: 'Văn bản',
      video_lib: 'Thư viện Video',
      photo_lib: 'Thư viện Ảnh',
      media: 'Media',
      faq: 'Hỏi đáp pháp luật',
      faq_articles: 'Bài viết Hỏi - Đáp',
      faq_approved_docs: 'Tài liệu Hỏi - Đáp đã duyệt',
      gov_citizen: 'Cơ quan & Người dân',
      register_help: 'Đăng ký tư vấn',
      procedures: 'Thủ tục hành chính',
      legal_qa: 'Hỏi đáp pháp luật',
      qa_documents: 'Tài liệu Hỏi-Đáp',
      contact: 'Liên hệ',
      support: 'Hỗ trợ 24/7',
      hotline: '0903.480.985',
      search: 'Tìm kiếm',
      language: 'Ngôn ngữ',
    },
    en: {
      home: 'Home',
      about: 'About',
      news: 'News',
      news_featured: 'Featured',
      news_activities: 'Activities',
      news_local: 'Local News',
      role_models: 'Role Models',
      reintegration: 'Community Reintegration',
      documents: 'Legal Documents',
      library: 'Library',
      legal_qa: 'Legal Q&A',
      qa_documents: 'Q&A Documents',
      contact: 'Contact',
      support: 'Support 24/7',
      hotline: '0903.480.985',
      search: 'Search',
      language: 'Language',
      video_lib: 'Video Library',
      photo_lib: 'Photo Library',
      media: 'Media Center',
      faq: 'Legal FAQ',
      faq_articles: 'Q&A Articles',
      faq_approved_docs: 'Approved Q&A',
      gov_citizen: 'Government & Citizens',
      register_help: 'Request Assistance',
      procedures: 'Administrative Procedures',
    },
  }
  Object.assign(hardcodedDictionary, extraDictionaries)

  // ── DB-driven translations: fetched once per locale, cached in useState ──
  // design.md D7: fetch from public endpoint, cache via useState (SSR-safe)
  const dbTranslations = useState<Record<string, Record<string, string>> | null>(
    'dbTranslations',
    () => null,
  )
  const dbTranslationsLang = useState<string | null>('dbTranslationsLang', () => null)

  // Fetch translations for current locale (only non-Vietnamese — vi uses hardcoded)
  if (currentLang.value !== 'vi' && dbTranslations.value === null) {
    // Client-side fetch only — public pages are all lazy/SWR, so this runs
    // after mount. On server, falls back to hardcoded dictionary.
    if (import.meta.client) {
      $fetch<{ ok: boolean; translations: Record<string, Record<string, string>> }>(
        `/api/public/translations/${currentLang.value}`,
      )
        .then((res) => {
          if (res.ok && res.translations) {
            // Flatten groups: {"nav": {"home": "Home"}, ...} → {"home": "Home", ...}
            const flat: Record<string, string> = {}
            for (const group of Object.values(res.translations)) {
              Object.assign(flat, group)
            }
            dbTranslations.value = { [currentLang.value]: flat }
            dbTranslationsLang.value = currentLang.value
          }
        })
        .catch(() => {
          dbTranslations.value = {}
        })
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
    // Invalidate DB cache when switching languages
    if (newLocale !== dbTranslationsLang.value) {
      dbTranslations.value = null
      dbTranslationsLang.value = null
    }
    currentLang.value = newLocale
    localeCookie.value = newLocale
    if (import.meta.client) {
      localStorage.setItem('cdkt_lang', newLocale)
    }
  }
  return {
    currentLang,
    currentLocale,
    locales: localeOptions,
    t,
    setLang,
  }
}
