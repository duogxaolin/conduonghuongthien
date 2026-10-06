/**
 * Hằng số flag emoji + hàm chuyển mã ngôn ngữ → cờ quốc gia. Tách khỏi
 * `pages/admin/languages/index.vue` khi 3 tab tách thành component con, để
 * Languages list, Translations tab, Universal hub và orchestrator không phải
 * giữ bản sao riêng.
 *
 * Đây là dữ liệu tĩnh tra cứu hiển thị, không phải state — đặt ở `utils/`
 * cùng lớp với `ai-service-labels.ts` / `nav-config.ts`.
 */

/** Bản đồ cố định cho các mã ngôn ngữ phổ biến — tránh tra ngược country code. */
const FLAG_MAP: Record<string, string> = {
  vi: '🇻🇳',
  en: '🇬🇧',
  zh: '🇨🇳',
  fr: '🇫🇷',
  ru: '🇷🇺',
  lo: '🇱🇦',
  ja: '🇯🇵',
  ko: '🇰🇷',
  es: '🇪🇸',
  de: '🇩🇪',
  th: '🇹🇭',
  km: '🇰🇭',
  my: '🇲🇲',
  id: '🇮🇩',
  pt: '🇵🇹',
  it: '🇮🇹',
  ar: '🇸🇦',
}

/** Map mã ngôn ngữ → mã quốc gia ISO 2 chữ cái (dùng để sinh flag emoji động). */
const LANG_TO_COUNTRY: Record<string, string> = {
  vi: 'VN', en: 'GB', zh: 'CN', ja: 'JP', ko: 'KR', fr: 'FR', de: 'DE',
  es: 'ES', ru: 'RU', th: 'TH', id: 'ID', pt: 'PT', it: 'IT', ar: 'SA',
  pl: 'PL', tr: 'TR', nl: 'NL', sv: 'SE', da: 'DK', fi: 'FI', no: 'NO',
  cs: 'CZ', el: 'GR', he: 'IL', hi: 'IN', ms: 'MY', tl: 'PH', uk: 'UA',
  ro: 'RO', hu: 'HU', sk: 'SK', bg: 'BG', hr: 'HR', sr: 'RS', sl: 'SI',
  lo: 'LA', km: 'KH', my: 'MM', us: 'US',
}

/** Sinh emoji cờ từ mã quốc gia 2 chữ cái (ISO alpha-2). */
export function countryCodeToFlagEmoji(countryCode: string): string {
  const cc = countryCode.toUpperCase()
  if (cc.length !== 2) return ''
  return String.fromCodePoint(
    0x1f1e6 + cc.charCodeAt(0) - 65,
    0x1f1e6 + cc.charCodeAt(1) - 65,
  )
}

/** Lấy emoji cờ cho mã ngôn ngữ — tra FLAG_MAP trước, fallback LANG_TO_COUNTRY,
 *  cuối cùng trả 🌐 (quả cầu) nếu không khớp. */
export function getFlagEmoji(langCode: string): string {
  if (!langCode) return '🌐'
  const code = langCode.toLowerCase()
  if (FLAG_MAP[code]) return FLAG_MAP[code]!
  const cc = LANG_TO_COUNTRY[code]
  return cc ? countryCodeToFlagEmoji(cc) : '🌐'
}
