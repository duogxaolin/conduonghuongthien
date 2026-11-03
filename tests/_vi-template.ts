/**
 * A template's source with every `t('key')` it shows replaced by the key's Vietnamese
 * fallback (`app/composables/i18n-default-dictionary.ts`), for the source-text guards that pin
 * WHAT a surface says ("Trợ lý đang soạn…", `>Thử lại<`, `aria-label="Từ khóa tìm kiếm"`).
 *
 * The chat surfaces and /search said it in Vietnamese literals until 2026-11-02 (CHANGELOG
 * § 71); they now say it through `t()`, so the English page is English. A guard reading the
 * literal would go red on the translation, while what it protects — the Vietnamese wording,
 * and that the label is there at all — is unchanged. Reading the template through this keeps
 * the guard on the wording: a key whose Vietnamese changes, or a label dropped, still fails.
 *   `{{ t('k') }}`            → the text
 *   `:attr="t('k')"`          → `attr="the text"`
 * A key with no Vietnamese fallback is left as written, so the guard fails visibly.
 */
import { hardcodedDictionary } from '../app/composables/i18n-default-dictionary.ts'

const vi = (key: string, whole: string) => hardcodedDictionary.vi?.[key] ?? whole

export function inVietnamese(source: string): string {
  return source
    .replace(/\{\{\s*t\('([a-z0-9_]+)'\)\s*\}\}/g, (whole, key: string) => vi(key, whole))
    .replace(/:([a-z-]+)="t\('([a-z0-9_]+)'\)"/g, (whole, attr: string, key: string) => {
      const text = hardcodedDictionary.vi?.[key]
      return text === undefined ? whole : `${attr}="${text}"`
    })
}
