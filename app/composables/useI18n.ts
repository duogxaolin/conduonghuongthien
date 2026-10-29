import { computed, type Ref } from 'vue'
import { useHead, useNuxtApp, useRequestHeader, useState } from '#imports'
import { hardcodedDictionary } from './i18n-default-dictionary'
import { publicFetch } from './publicFetch'
import { createSingleFlight } from '~/utils/single-flight'
import type { PublicLanguagesResponse, PublicTranslationsResponse } from '~/types/public-site-api'
import {
  LOCALE_STORAGE_KEY,
  localeFromCookieHeader,
  normalizeLocale,
  resolvePreferredLocale,
  serializeLocaleCookie,
} from '~/utils/locale-preference'

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

// Dùng chung cho mọi lời gọi useI18n(): chỉ MỘT yêu cầu bản dịch/ngôn ngữ đang bay tại một thời điểm.
const singleFlight = createSingleFlight()

type NuxtAppInstance = ReturnType<typeof useNuxtApp>

/**
 * Chạy `fn` khi cây đã hydrate xong (ngay lập tức nếu đã xong).
 *
 * Mọi thay đổi trạng thái làm đổi chữ hiển thị — đổi ngôn ngữ, gắn bản dịch
 * từ DB, gắn danh sách ngôn ngữ từ DB — phải đợi tới đây. Đổi giữa lúc
 * hydrate thì cây client render khác HTML máy chủ đã gửi → "Hydration
 * completed but contains mismatches" và Vue vá lại DOM từng mảnh.
 */
function afterHydration(nuxtApp: NuxtAppInstance, fn: () => void) {
  if (nuxtApp.isHydrating) nuxtApp.hooks.hookOnce('app:suspense:resolve', fn)
  else fn()
}

// ── Trạng thái phía client, một lần cho mỗi lượt tải trang ──
// Biến cấp module chỉ được đọc/ghi sau `import.meta.client` — trên máy chủ,
// module này dùng chung giữa mọi request nên không được giữ gì ở đây.
let clientPreferenceResolved = false
/** Ngôn ngữ người đọc đã chọn nhưng chưa áp (đang chờ hydrate xong). */
let clientPendingLocale: string | null = null
/** Ngôn ngữ đã xin bản dịch DB — chặn mỗi `useI18n()` tự xin lại khi kết quả đang chờ hydrate. */
let clientRequestedTranslationsLang: string | null = null
/** Đã tự xin danh sách ngôn ngữ DB — cùng lý do như trên. */
let clientRequestedLanguages = false

function readStoredLocale(): string | null {
  try {
    return window.localStorage.getItem(LOCALE_STORAGE_KEY)
  } catch {
    return null // Chế độ riêng tư / bị chặn lưu trữ: coi như chưa chọn.
  }
}

/** Ghi lựa chọn ở trình duyệt — nơi DUY NHẤT cookie ngôn ngữ được ghi. */
function persistLocaleOnClient(locale: string) {
  try {
    if (window.localStorage.getItem(LOCALE_STORAGE_KEY) !== locale) {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
    }
  } catch {
    // Không lưu được localStorage thì cookie vẫn giữ lựa chọn.
  }
  if (localeFromCookieHeader(document.cookie) !== locale) {
    document.cookie = serializeLocaleCookie(locale)
  }
}

/**
 * Áp lựa chọn đã lưu của người đọc — một lần mỗi lượt tải trang, SAU hydrate.
 *
 * Trả về ngôn ngữ trang sẽ hiển thị (để tải sẵn đúng bản dịch ngay từ đầu).
 *
 * Cookie được khôi phục từ localStorage nếu lệch: đó vẫn là lựa chọn của chính
 * người đọc, và nó sửa cookie đã bị các phản hồi cache cũ (trước bản vá) đặt
 * lại về `vi`.
 */
function applyStoredPreferenceOnClient(nuxtApp: NuxtAppInstance, currentLang: Ref<string>): string {
  if (!clientPreferenceResolved) {
    clientPreferenceResolved = true
    const preferred = resolvePreferredLocale(readStoredLocale(), localeFromCookieHeader(document.cookie))
    if (preferred) {
      persistLocaleOnClient(preferred)
      if (preferred !== currentLang.value) {
        clientPendingLocale = preferred
        afterHydration(nuxtApp, () => {
          if (clientPendingLocale) currentLang.value = clientPendingLocale
          clientPendingLocale = null
        })
      }
    }
  }
  return clientPendingLocale ?? currentLang.value
}

export const useI18n = () => {
  const nuxtApp = useNuxtApp()
  const dbLanguages = useState<LocaleOption[]>('dbLanguages', () => [])

  const locales = computed(() => {
    if (dbLanguages.value.length > 0) return dbLanguages.value
    return DEFAULT_LOCALE_OPTIONS
  })

  /**
   * Ngôn ngữ render phía máy chủ: CHỈ ĐỌC cookie, không bao giờ ghi.
   *
   * Không dùng `useCookie(…, { default })`: nó gửi `set-cookie: cdkt_lang=vi`
   * cho request không có cookie, và Nitro lưu header đó cùng bản cache của các
   * tuyến `swr` (`/`, `/about`, `/news/**`…) rồi phát lại cho MỌI khách — mỗi
   * trang cache đặt lại lựa chọn của tất cả người đọc về tiếng Việt.
   *
   * ĐÁNH ĐỔI CÓ CHỦ ĐÍCH: tuyến cache được render với request đã bị bỏ cookie,
   * nên HTML dùng chung luôn là tiếng Việt. Người đọc chọn ngôn ngữ khác thấy
   * trang chuyển sang ngôn ngữ của mình ngay sau hydrate (lớp phủ tải đầu trong
   * app.vue che bước này). Tuyến không cache (`/assistant`, `/profile`…) vẫn
   * render đúng ngôn ngữ ngay từ máy chủ vì nhận được cookie thật.
   */
  const currentLang = useState<string>('currentLang', () =>
    normalizeLocale(import.meta.server ? localeFromCookieHeader(useRequestHeader('cookie')) : null),
  )
  const currentLocale = computed(() => locales.value.find(locale => locale.code === currentLang.value) ?? DEFAULT_LOCALE_OPTIONS[0]!)

  function loadLanguagesFromDb(): Promise<void> {
    return singleFlight('languages', async () => {
      try {
        const res = await publicFetch<PublicLanguagesResponse>('/api/public/languages')
        if (res.ok && Array.isArray(res.items) && res.items.length > 0) {
          const items = res.items.map(l => ({
            code: l.code,
            label: l.code.toUpperCase(),
            name: l.nativeName || l.name,
            htmlLang: l.code,
          }))
          afterHydration(nuxtApp, () => {
            dbLanguages.value = items
          })
        }
      } catch {
        // Non-critical fallback
      }
    })
  }

  if (import.meta.client && dbLanguages.value.length === 0 && !clientRequestedLanguages) {
    clientRequestedLanguages = true
    void loadLanguagesFromDb()
  }

  // Trên client: lựa chọn đã lưu (localStorage → cookie) thắng ngôn ngữ SSR,
  // nhưng chỉ được áp sau hydrate — xem afterHydration.
  const displayLang = import.meta.client ? applyStoredPreferenceOnClient(nuxtApp, currentLang) : currentLang.value

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
  function loadTranslations(lang: string): Promise<void> {
    return singleFlight(`translations:${lang}`, () =>
      publicFetch<PublicTranslationsResponse>(
        `/api/public/translations/${lang}`,
      )
        .then((res) => {
          if (res.ok && res.translations) {
            // Flatten groups: {"nav": {"home": "Home"}, ...} → {"home": "Home", ...}
            const flat: Record<string, string> = {}
            for (const group of Object.values(res.translations)) {
              Object.assign(flat, group)
            }
            // Máy chủ render bằng từ điển hardcoded; gắn bản DB giữa lúc hydrate
            // sẽ làm chữ client khác HTML máy chủ.
            afterHydration(nuxtApp, () => {
              dbTranslations.value = { [lang]: flat }
              dbTranslationsLang.value = lang
            })
          }
        })
        .catch(() => {
          afterHydration(nuxtApp, () => {
            dbTranslations.value = {}
          })
        }),
    )
  }

  // Client-side fetch only — public pages are all lazy/SWR, so this runs
  // after mount. On server, falls back to hardcoded dictionary. Xin thẳng bản
  // dịch của ngôn ngữ SẼ hiển thị (kể cả khi lựa chọn của người đọc còn đang
  // chờ hydrate), không tải tiếng Việt rồi bỏ.
  if (import.meta.client && dbTranslations.value === null && clientRequestedTranslationsLang !== displayLang) {
    clientRequestedTranslationsLang = displayLang
    void loadTranslations(displayLang)
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
      if (import.meta.client) clientRequestedTranslationsLang = null
    }
    currentLang.value = newLocale
    if (import.meta.client) {
      clientPendingLocale = null
      // Nơi duy nhất (cùng lượt khôi phục ở applyStoredPreferenceOnClient) ghi
      // cookie ngôn ngữ: ở trình duyệt, khi người đọc chọn. Ghi thẳng
      // document.cookie để lượt reload ngay sau đó chắc chắn gửi header Cookie.
      persistLocaleOnClient(newLocale)
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
