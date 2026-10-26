/**
 * The "Bản dịch UI" list of one language (`GET /api/admin/languages/:code/translations`)
 * — also the vi source map and the "Dịch AI còn thiếu" scan of the languages page.
 *
 * Everything, on purpose: about 630 keys, and the tab's status filter and counter, the
 * vi source map and the AI scan are only right over all of them (it used to cap at
 * 200/500 and search in JS after the cut). The search runs in SQL (key OR value,
 * wildcards escaped) over every row.
 *
 * The language's own rows come first (id order), then every vi key the language has NO
 * row for — `id: null`, `value: null` — the keys the coverage card counts as missing
 * but the language never got a row for (a vi key added after the language was created
 * and before "Đồng bộ key"). "Xem thiếu" then lists the same set the card counts, and
 * saving or AI-translating such a row creates it (`upsertTranslations` inserts). The
 * group filter applies to them; the search matches their key (they have no value).
 *
 * Split out of `services/languages.ts`, which is at its line cap.
 */
import { and, asc, eq, inArray, isNull, like, or } from 'drizzle-orm'
import { alias } from 'drizzle-orm/mysql-core'
import { getDb, type Database } from '../utils/db'
import { containsPattern } from '../utils/sql-like'
import { langTranslations } from '../db/schema'

export type TranslationListRow = Omit<typeof langTranslations.$inferSelect, 'id'> & { id: number | null }

export async function listTranslations(code: string, opts: { group?: string; search?: string }, db: Database = getDb()): Promise<TranslationListRow[]> {
  const group = opts.group && opts.group !== 'all' ? opts.group : undefined
  const search = opts.search?.trim() ? containsPattern(opts.search.trim()) : undefined

  const own = await db.select().from(langTranslations).where(and(
    eq(langTranslations.langCode, code),
    group ? eq(langTranslations.group, group) : undefined,
    search ? or(like(langTranslations.key, search), like(langTranslations.value, search)) : undefined,
  )).orderBy(asc(langTranslations.id))
  if (code === 'vi') return own

  const target = alias(langTranslations, 'target')
  const absent = await db.select({ group: langTranslations.group, key: langTranslations.key })
    .from(langTranslations)
    .leftJoin(target, and(eq(target.langCode, code), eq(target.group, langTranslations.group), eq(target.key, langTranslations.key)))
    .where(and(
      eq(langTranslations.langCode, 'vi'),
      isNull(target.id),
      group ? eq(langTranslations.group, group) : undefined,
      search ? like(langTranslations.key, search) : undefined,
    ))
    .orderBy(asc(langTranslations.id))
  return [
    ...own,
    ...absent.map(row => ({ id: null, langCode: code, group: row.group, key: row.key, value: null, isAiTranslated: false, createdAt: null, updatedAt: null })),
  ]
}

/** The groups of the language's rows and of the vi keys (which the list also shows). */
export async function listTranslationGroups(code: string, db: Database = getDb()) {
  const rows = await db
    .select({ group: langTranslations.group })
    .from(langTranslations)
    .where(inArray(langTranslations.langCode, [...new Set([code, 'vi'])]))
    .groupBy(langTranslations.group)
  return rows.map((r) => r.group)
}
