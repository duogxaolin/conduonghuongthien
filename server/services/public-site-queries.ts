/**
 * Queries of the small public site reads — `home-sections.get.ts`, `languages.get.ts`,
 * `translations/[code].get.ts` (the language lookup) and `settings.get.ts` — moved out of the
 * handlers verbatim: the same statements, in the same order.
 *
 * The handlers keep everything else: the allowlist of public setting keys (a row read here is
 * never handed out as is), the "unknown or inactive language → empty dictionary" rule, the call
 * into `getTranslationsForPublic` (services/languages.ts — the dictionary of EVERY language,
 * `vi` included), the response, and `reportPublicReadFailure()` (503 + `no-store`) around the
 * reads that have it.
 *
 * Imports the database layer and nothing else from it: tests/public-read-failure-behavior.test.ts
 * fakes `getDb` alone.
 */
import { asc, eq } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { homeSections, languages, settings } from '../db/schema'

/** `GET /api/public/home-sections`: every visible section, by display order. */
export async function listVisibleHomeSections() {
  const db = getDb()
  const sections = await db
    .select()
    .from(homeSections)
    .where(eq(homeSections.isVisible, true))
    .orderBy(asc(homeSections.displayOrder))

  return sections
}

/** `GET /api/public/languages`: the active languages, by display order then id. */
export async function listActivePublicLanguages() {
  const db = getDb()
  const rows = await db
    .select({
      code: languages.code,
      name: languages.name,
      nativeName: languages.nativeName,
      isDefault: languages.isDefault,
      displayOrder: languages.displayOrder,
    })
    .from(languages)
    .where(eq(languages.isActive, true))
    .orderBy(asc(languages.displayOrder), asc(languages.id))

  return rows
}

/** `GET /api/public/translations/:code`: the `languages` row of `code`, or undefined. */
export async function findLanguageByCode(code: string) {
  const db = getDb()

  const [lang] = await db.select().from(languages).where(eq(languages.code, code)).limit(1)

  return lang
}

/**
 * `GET /api/public/settings`: every `settings` row. The handler hands out only the keys on its
 * allowlist — the rest (secrets included) never leave it.
 */
export async function listSettingRows() {
  const db = getDb()
  const allSettings = await db.select().from(settings)

  return allSettings
}
