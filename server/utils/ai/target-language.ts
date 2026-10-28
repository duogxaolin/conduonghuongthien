/**
 * The target language of the two on-demand translation routes (`ai/translate`,
 * `ai/translate-ui`), which each kept a copy of this table.
 *
 * Both used `LANGUAGE_NAMES[code] || code` on whatever the request sent: a name of
 * `Object.prototype` (`constructor`, `toString`) resolved to a function, pasted into
 * the prompt as "function Object() { [native code] }", and any other text — of any
 * length, line breaks and "ignore the instructions above" included — was pasted into
 * the prompt as the language. Now only a language code passes (`en`, `zh`, `pt-br`):
 * a code of the table gets its name, another code is its own name.
 */
export const TARGET_LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  en: 'Tiếng Anh (English)',
  zh: 'Tiếng Trung (Chinese - 中文)',
  fr: 'Tiếng Pháp (French - Français)',
  ru: 'Tiếng Nga (Russian - Русский)',
  ja: 'Tiếng Nhật (Japanese - 日本語)',
  ko: 'Tiếng Hàn (Korean - 한국어)',
  es: 'Tiếng Tây Ban Nha (Spanish - Español)',
  de: 'Tiếng Đức (German - Deutsch)',
  lo: 'Tiếng Lào (Lao)',
  km: 'Tiếng Campuchia (Khmer)',
}

const LANGUAGE_CODE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/

export const TARGET_LANGUAGE_INVALID_MESSAGE = 'Ngôn ngữ đích phải là một mã ngôn ngữ (ví dụ: en, zh, fr).'

/** `{ code, name }` — English when nothing is given; null when `value` is not a language code. */
export function resolveTargetLanguage(value: unknown): { code: string, name: string } | null {
  if (value === undefined || value === null || value === '') return { code: 'en', name: TARGET_LANGUAGE_NAMES.en! }
  if (typeof value !== 'string') return null
  const code = value.trim().toLowerCase()
  if (!LANGUAGE_CODE.test(code)) return null
  return { code, name: Object.hasOwn(TARGET_LANGUAGE_NAMES, code) ? TARGET_LANGUAGE_NAMES[code]! : code }
}
