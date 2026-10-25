import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm'
import { getDb, type Database } from '../utils/db'
import { langTranslations } from '../db/schema'
import { affectedRowsOrZero } from '../utils/affected-rows'

/**
 * One-off repair (`npm run db:repair-null-translations`) of UI translations stored as
 * the TEXT "null" — or "undefined" — instead of no value.
 *
 * Since 572ffb4 the translations tab sent `value: null` when "Lưu" was pressed on an
 * untouched empty row, and `PUT /api/admin/languages/:code/translations` stored
 * `String(i.value)`. The public `t()` falls back only on an EMPTY value, so readers saw
 * the word "null"; a "null" in a vi row was also sent to the AI as the source text, and
 * the row counted as translated. Writes are fixed (zod in the handler, model output
 * through `utils/ai/model-translations.ts`); this clears what was already written.
 *
 * Same shape as `stored-plaintext-decode.ts`: a pure planner, preview by default,
 * keyset batches by id, each UPDATE guarded by the value it planned from (an officer
 * who saved a real translation in between keeps it) and `updated_at = updated_at`.
 * A cleared row becomes SQL NULL — exactly the state "Đồng bộ key" gives a new key.
 * Only the exact spellings `String()` produces are taken: the SQL `IN` runs under the
 * column's case-insensitive collation, so the candidates are re-checked here.
 * Not a boot step: a boot write needs a declared conversion in
 * tests/schema-upgrade-integration.test.ts, and the operator should read the list first.
 */

export const NULL_LITERALS: readonly string[] = ['null', 'undefined']

export type NullLiteralRow = { id: number, langCode: string, group: string, key: string, value: string | null }

/** Thuần: the rows whose value is exactly one of `NULL_LITERALS`. */
export function planNullLiteralRepair(rows: readonly NullLiteralRow[]): NullLiteralRow[] {
  return rows.filter(row => row.value !== null && NULL_LITERALS.includes(row.value))
}

export type NullLiteralRepairReport = {
  applied: boolean
  /** Rows the plan takes (preview: would clear; apply: tried to clear). */
  changed: number
  /** Rows cleared (apply only). */
  written: number
  /** Rows not cleared because their value changed after it was read. */
  skipped: number
  rows: NullLiteralRow[]
}

const BATCH = 500

export async function runNullLiteralRepair(options: { apply?: boolean, db?: Database } = {}): Promise<NullLiteralRepairReport> {
  const apply = options.apply === true
  const db = options.db ?? getDb()
  const report: NullLiteralRepairReport = { applied: apply, changed: 0, written: 0, skipped: 0, rows: [] }
  let cursor = 0
  while (true) {
    const candidates = await db
      .select({ id: langTranslations.id, langCode: langTranslations.langCode, group: langTranslations.group, key: langTranslations.key, value: langTranslations.value })
      .from(langTranslations)
      .where(and(gt(langTranslations.id, cursor), inArray(langTranslations.value, [...NULL_LITERALS])))
      .orderBy(asc(langTranslations.id))
      .limit(BATCH)
    if (candidates.length === 0) break
    cursor = candidates[candidates.length - 1]!.id
    const plan = planNullLiteralRepair(candidates)
    report.changed += plan.length
    report.rows.push(...plan)
    if (!apply) continue
    for (const row of plan) {
      const result = await db.update(langTranslations)
        // `updated_at = updated_at`: assigned explicitly so `ON UPDATE CURRENT_TIMESTAMP` does not run.
        .set({ value: null, updatedAt: sql`${langTranslations.updatedAt}` })
        .where(and(eq(langTranslations.id, row.id), eq(langTranslations.value, row.value!)))
      if (affectedRowsOrZero(result) > 0) report.written += 1
      else report.skipped += 1
    }
  }
  return report
}
