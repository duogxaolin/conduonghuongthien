/**
 * Shapes the `/admin/languages` page holds (`pages/admin/languages/index.vue`) and hands to
 * its parts and composables — moved out of the page when it was split (wave3 4.2), unchanged.
 * Written by hand as the page wrote them: `adminFetch<T>()` states the response type.
 */

/** A row of `GET /api/admin/languages`, with its coverage numbers. */
export type LanguageItem = {
  id: number; code: string; name: string; nativeName: string
  isActive: boolean; isDefault: boolean; displayOrder: number
  stats?: { totalKeys: number; translatedKeys: number; missingKeys: number; aiKeys: number; percent: number }
}

/** A translation row as the table holds it (`value` null → '' on load). */
export type TranslationItem = {
  id: number | null; langCode: string; group: string; key: string; value: string; isAiTranslated: boolean
}

/** A `GET …/:code/translations` row: `value` null = untranslated; `id` null = a vi key with no row here yet. */
export type TranslationRecord = { id: number | null; langCode: string; group: string; key: string; value: string | null; isAiTranslated: boolean }
export type TranslationList = { ok: true; items: TranslationRecord[]; groups: string[] }

/** What the "Tiến trình Dịch AI" dialog shows. */
export type TranslateProgress = {
  done: number
  total: number
  percent: number
  currentKey: string
  finished: boolean
  stopped: boolean
}
export type TranslateLogLine = { key: string; value: string; success: boolean }
