import { computed, watch } from 'vue'
import { useCookie, useHead, useState } from '#imports'
import { extraDictionaries } from './i18n-extra'

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
  })
  const dbLanguages = useState<LocaleOption[]>('dbLanguages', () => [])

  const locales = computed(() => {
    if (dbLanguages.value.length > 0) return dbLanguages.value
    return DEFAULT_LOCALE_OPTIONS
  })

  const currentLang = useState<string>('currentLang', () => normalizeLocale(localeCookie.value))
  const currentLocale = computed(() => locales.value.find(locale => locale.code === currentLang.value) ?? DEFAULT_LOCALE_OPTIONS[0]!)

  async function loadLanguagesFromDb() {
    try {
      const res = await $fetch<{ ok: boolean; items: Array<{ code: string; name: string; nativeName: string; isDefault: boolean }> }>('/api/public/languages')
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
      profile: 'Trang cá nhân',
      login: 'Đăng nhập',
      logout: 'Đăng xuất',
      notifications: 'Thông báo',
      login_to_comment: 'Đăng nhập để bình luận',
      search_placeholder: 'Nhập nội dung cần tìm kiếm trên website...',
      search_view_all: 'Xem toàn bộ kết quả tìm kiếm',
      portal_title: 'CON ĐƯỜNG HƯỚNG THIỆN',
      footer_desc: 'Trang thông tin điện tử về tái hòa nhập cộng đồng của Bộ Công an, do Cục Cảnh sát quản lý tạm giữ, tạm giam và thi hành án hình sự tại cộng đồng (C11) quản lý và vận hành.',
      footer_links_main: 'Liên kết chính',
      contact_info: 'Thông tin liên hệ',
      address: 'Địa chỉ',
      phone: 'Điện thoại',
      footer_agency: 'Cơ quan chủ quản:',
      footer_copyright: 'Bản quyền thuộc về Cổng thông tin Con Đường Hướng Thiện - C11 Bộ Công an.',
      comments: 'Bình luận',
      comments_loading: 'Đang tải bình luận...',
      reply: 'Trả lời',
      view_details: 'Chi tiết',
      most_read: 'Đọc nhiều',
      documents_title: 'Văn Bản Quy Phạm Pháp Luật',
      documents_library: 'Thư viện pháp luật',
      quick_search: 'Tra cứu nhanh:',
      view_and_download: 'Xem chi tiết & Tải về',
      c11_news_badge: 'Bản tin C11',
      all_news: 'Tất cả bản tin',
      news_category_title: 'Chuyên mục bản tin',
      support_247: 'Hỗ trợ 24/7',
      role_models_title: 'Tấm Gương Tiêu Biểu',
      role_models_subtitle: 'Nghị lực vươn lên',
      reintegration_models_title: 'Mô Hình Tái Hòa Nhập',
      reintegration_models_subtitle: 'Sinh kế bền vững',
      latest_docs_title: 'Văn bản Pháp luật Mới ban hành',
      view_all_docs: 'Tất cả văn bản →',
      view_detail: 'Xem chi tiết',
      view_all: 'Xem tất cả',
      support_form_title: 'Đăng Ký Tư Vấn & Hỗ Trợ Tái Hòa Nhập',
      support_form_subtitle: 'Điền thông tin để cán bộ chuyên môn liên hệ tư vấn miễn phí trong vòng 24 giờ.',
      hotline_support_lbl: 'Hotline hỗ trợ:',
      form_name: 'Họ và tên',
      form_phone: 'Số điện thoại',
      form_city: 'Tỉnh / Thành phố',
      form_message: 'Nội dung cần hỗ trợ',
      form_sending: 'Đang gửi...',
      form_submit: 'Gửi đăng ký tư vấn',
      hero_support_free: 'Hỗ trợ 24/7 miễn phí',
      hero_security: 'Bảo mật thông tin',
      hero_connect_officer: 'Kết nối trực tiếp cán bộ',
    },
    en: {
      home: 'Home',
      about: 'About',
      news: 'News',
      news_featured: 'Featured News',
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
      register_help: 'Request Consultation',
      procedures: 'Administrative Procedures',
      profile: 'My Profile',
      login: 'Sign In',
      logout: 'Sign Out',
      notifications: 'Notifications',
      login_to_comment: 'Sign in to comment',
      search_placeholder: 'Search information on portal...',
      search_view_all: 'View all search results',
      portal_title: 'PATH OF REDEMPTION',
      footer_desc: 'Electronic portal for community reintegration of the Ministry of Public Security, managed and operated by the Police Department for Custody, Detention and Community Sentence Execution (C11).',
      footer_links_main: 'Main Links',
      contact_info: 'Contact Information',
      address: 'Address',
      phone: 'Phone',
      footer_agency: 'Supervisory Authority:',
      footer_copyright: 'Copyright © 2026 Path of Redemption Portal - C11 Ministry of Public Security.',
      comments: 'Comments',
      comments_loading: 'Loading comments...',
      reply: 'Reply',
      view_details: 'Details',
      most_read: 'Most Read',
      documents_title: 'Legal Regulations & Documents',
      documents_library: 'Legal Library',
      quick_search: 'Quick Search:',
      view_and_download: 'View Details & Download',
      c11_news_badge: 'C11 News',
      all_news: 'All News',
      news_category_title: 'News Categories',
      support_247: 'Support 24/7',
      role_models_title: 'Exemplary Role Models',
      role_models_subtitle: 'Inspirational Resilience',
      reintegration_models_title: 'Reintegration Models',
      reintegration_models_subtitle: 'Sustainable Livelihoods',
      latest_docs_title: 'Newly Issued Legal Documents',
      view_all_docs: 'All Documents →',
      view_detail: 'View Details',
      view_all: 'View All',
      support_form_title: 'Request Consultation & Reintegration Support',
      support_form_subtitle: 'Fill in your information for a specialist to contact you for a free consultation within 24 hours.',
      hotline_support_lbl: 'Support Hotline:',
      form_name: 'Full Name',
      form_phone: 'Phone Number',
      form_city: 'Province / City',
      form_message: 'Support Request Details',
      form_sending: 'Sending...',
      form_submit: 'Submit Request',
      hero_support_free: 'Free 24/7 Support',
      hero_security: 'Data Privacy',
      hero_connect_officer: 'Direct Officer Connection',
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
    locales,
    t,
    setLang,
    loadLanguagesFromDb,
  }
}
