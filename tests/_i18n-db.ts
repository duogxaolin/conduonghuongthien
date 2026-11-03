/**
 * A `useI18n()` stand-in that answers like the real one AFTER hydration, when the
 * translations of the current language have come back from the DB
 * (`app/composables/useI18n.ts` `t()`): DB value → hardcoded dictionary of the language →
 * hardcoded Vietnamese → the key itself.
 *
 * The public-mount harness's own stand-in reads the hardcoded dictionary only — what the
 * server renders and what shows while `/api/public/translations/<lang>` is in flight. That
 * hides every bug that lives in the DB rows: the seeded `form_name` ("Họ và tên người cần
 * hỗ trợ *") is not the hardcoded one ("Họ và tên"). `db: 'seed'` uses the rows
 * `server/data/default-translations-seed.ts` inserts (what a fresh install — and, for keys
 * nobody edited, every install — holds); `db: 'none'` is the API unreachable / not yet
 * loaded; `rows` adds or overrides rows by hand.
 */
import * as Vue from 'vue'

import { hardcodedDictionary } from '../app/composables/i18n-default-dictionary.ts'
import { DEFAULT_TRANSLATIONS_SEED } from '../server/data/default-translations-seed.ts'

export type DbRows = Record<string, Record<string, string>>

/** What `/api/public/translations/<lang>` returns once flattened, from the seed. */
export function seedRows(lang: string): Record<string, string> {
  const flat: Record<string, string> = {}
  for (const row of DEFAULT_TRANSLATIONS_SEED) {
    const value = (row.values as Record<string, string>)[lang]
    // `seedDefaultLanguagesAndTranslations` inserts no row for an empty value; first wins.
    if (value && !(row.key in flat)) flat[row.key] = value
  }
  return flat
}

export function dbI18n(lang: string, options: { db?: 'seed' | 'none', rows?: DbRows } = {}) {
  const currentLang = Vue.ref(lang)
  const db = (code: string): Record<string, string> => ({
    ...(options.db === 'none' ? {} : seedRows(code)),
    ...(options.rows?.[code] ?? {}),
  })
  const t = (key: string): string => {
    const code = currentLang.value
    return db(code)[key] || hardcodedDictionary[code]?.[key] || hardcodedDictionary.vi?.[key] || key
  }
  return { t, currentLang, locales: Vue.computed(() => []), setLang: (code: string) => { currentLang.value = code } }
}

/** For `mountPublic`: the same stand-in under both names a view may reach it by. */
export function i18nOverride(i18n: ReturnType<typeof dbI18n>) {
  return {
    auto: { useI18n: () => i18n },
    modules: { '~/composables/useI18n': { useI18n: () => i18n } },
  }
}

/** Letters only Vietnamese uses — an English screen showing any of them is a leftover. */
export const VIETNAMESE_LETTERS = /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i
