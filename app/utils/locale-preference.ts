/**
 * Lựa chọn ngôn ngữ của người đọc — phần thuần, chạy được ngoài Nuxt để test.
 *
 * Hai nơi lưu, một nguồn chân lý:
 *   - `localStorage['cdkt_lang']` — nguồn chân lý phía trình duyệt;
 *   - cookie `cdkt_lang` — chỉ để máy chủ render đúng ngôn ngữ ở tuyến KHÔNG
 *     cache. Cookie chỉ được GHI ở trình duyệt (xem `useI18n`); máy chủ chỉ đọc.
 *
 * Vì sao máy chủ không bao giờ ghi: Nitro render các tuyến `swr` với request đã
 * bị bỏ header `cookie` rồi phát lại nguyên bộ header đã lưu — kể cả
 * `set-cookie` — cho MỌI khách. Một `set-cookie: cdkt_lang=vi` lúc SSR vì thế
 * đặt lại ngôn ngữ của tất cả người đọc về tiếng Việt.
 */

export const LOCALE_COOKIE = 'cdkt_lang'
export const LOCALE_STORAGE_KEY = 'cdkt_lang'
export const DEFAULT_LOCALE = 'vi'
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/**
 * Mã ngôn ngữ hợp lệ: 2–3 chữ cái, tuỳ chọn một hậu tố vùng (`zh-cn`, `zh_cn`). Giá trị
 * đi vào đường dẫn `/api/public/translations/<code>` và vào chuỗi cookie, nên
 * mọi thứ khác (dấu `;`, `/`, khoảng trắng…) bị coi như không có lựa chọn.
 */
const LOCALE_PATTERN = /^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})?$/

/** Chuẩn hoá một lựa chọn đã lưu; trả `null` khi không có hoặc không hợp lệ. */
export function parseLocale(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toLowerCase()
  return LOCALE_PATTERN.test(code) ? code : null
}

/** Như `parseLocale` nhưng lùi về tiếng Việt — dùng cho ngôn ngữ đang hiển thị. */
export function normalizeLocale(value: unknown): string {
  return parseLocale(value) ?? DEFAULT_LOCALE
}

/** Đọc `cdkt_lang` từ một chuỗi header `Cookie` (hay `document.cookie`). */
export function localeFromCookieHeader(header: string | null | undefined): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1 || part.slice(0, eq).trim() !== LOCALE_COOKIE) continue
    const raw = part.slice(eq + 1).trim()
    try {
      return parseLocale(decodeURIComponent(raw))
    } catch {
      return null
    }
  }
  return null
}

/**
 * Lựa chọn của người đọc: localStorage trước (nguồn chân lý phía trình duyệt),
 * rồi cookie (khách chỉ còn cookie — ví dụ đã xoá dữ liệu trang nhưng giữ cookie).
 * `null` = chưa từng chọn → giữ tiếng Việt, không ghi gì.
 */
export function resolvePreferredLocale(stored: unknown, cookie: unknown): string | null {
  return parseLocale(stored) ?? parseLocale(cookie)
}

/** Chuỗi gán cho `document.cookie` khi người đọc chọn (hoặc khôi phục) ngôn ngữ. */
export function serializeLocaleCookie(locale: string): string {
  const code = normalizeLocale(locale)
  return `${LOCALE_COOKIE}=${encodeURIComponent(code)}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`
}
