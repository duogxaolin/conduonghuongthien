import { and, asc, eq, gt, sql } from 'drizzle-orm'
import { getDb, type Database } from '../utils/db'
import { langTranslations } from '../db/schema'
import { affectedRowsOrZero } from '../utils/affected-rows'

/**
 * One-off repair (`npm run db:repair-null-translations`) of UI translations stored as
 * text that is not a translation. The public `t()` falls back only on an EMPTY value,
 * so readers saw these words; a vi row's was also sent to the AI as the source text,
 * and every such row counted as translated. Writes are fixed (zod in the PUT handler,
 * model output through `utils/ai/model-translations.ts`); this clears what was written.
 *
 * Two buckets, because only one is certain:
 *   - `exact` — exactly "null" or "undefined": `String(null)` in the PUT (since 572ffb4,
 *     "Lưu" on an untouched empty row) and `String(p.value)` in the AI paths. A UI
 *     string is never that word. Cleared by `--apply`.
 *   - `review` — PROBABLY the same bug, listed for the operator and cleared only with
 *     `--apply --include-review`: "null"/"undefined" in another case or with spaces
 *     (the single-key endpoint stored the model's answer verbatim), "[object Object]"
 *     (chunk endpoint, universal job), and a bare number where the vi source text is not
 *     that number (the bulk endpoint stored the model's number). vi rows are never
 *     numeric candidates: they ARE the source.
 *
 * Same shape as `stored-plaintext-decode.ts`: a pure planner, preview by default, keyset
 * batches by id, `updated_at = updated_at`. Each UPDATE is guarded by the BYTES it
 * planned from — `HEX(value) = HEX(?)` — not by `value = ?`: the column is
 * `utf8mb4_unicode_ci`, which calls "NULL" equal to "null", and PAD SPACE ignores a
 * trailing space; an officer's edit in between, however small, is kept (`skipped`).
 * A cleared row becomes SQL NULL — exactly the state "Đồng bộ key" gives a new key.
 * Not a boot step: a boot write needs a declared conversion in
 * tests/schema-upgrade-integration.test.ts, and the operator should read the list first.
 */

export const NULL_LITERALS: readonly string[] = ['null', 'undefined']

export type TranslationValueRow = { id: number, langCode: string, group: string, key: string, value: string | null }
export type RepairReason = 'null_literal' | 'null_like' | 'object_text' | 'numeric'
export type PlannedRepair = TranslationValueRow & { bucket: 'exact' | 'review', reason: RepairReason }

const NUMBER = /^-?\d+(?:\.\d+)?$/

/** Thuần. `viSource`: `group::key` → the vi value, for the numeric check. */
export function planTranslationValueRepair(rows: readonly TranslationValueRow[], viSource: ReadonlyMap<string, string | null>): PlannedRepair[] {
  const plan: PlannedRepair[] = []
  for (const row of rows) {
    if (row.value === null) continue
    const text = row.value.trim()
    if (NULL_LITERALS.includes(row.value)) plan.push({ ...row, bucket: 'exact', reason: 'null_literal' })
    else if (NULL_LITERALS.includes(text.toLowerCase())) plan.push({ ...row, bucket: 'review', reason: 'null_like' })
    else if (text === '[object Object]') plan.push({ ...row, bucket: 'review', reason: 'object_text' })
    else if (row.langCode !== 'vi' && NUMBER.test(text) && viSource.get(`${row.group}::${row.key}`)?.trim() !== text) {
      plan.push({ ...row, bucket: 'review', reason: 'numeric' })
    }
  }
  return plan
}

export type TranslationValueRepairReport = {
  applied: boolean
  includeReview: boolean
  /** Rows cleared (apply only). */
  written: number
  /** Rows not cleared because their value changed after it was read. */
  skipped: number
  exact: PlannedRepair[]
  review: PlannedRepair[]
}

const BATCH = 500

export async function runTranslationValueRepair(
  options: { apply?: boolean, includeReview?: boolean, db?: Database } = {},
): Promise<TranslationValueRepairReport> {
  const apply = options.apply === true
  const includeReview = options.includeReview === true
  const db = options.db ?? getDb()
  const report: TranslationValueRepairReport = { applied: apply, includeReview, written: 0, skipped: 0, exact: [], review: [] }

  const viRows = await db.select({ group: langTranslations.group, key: langTranslations.key, value: langTranslations.value })
    .from(langTranslations).where(eq(langTranslations.langCode, 'vi'))
  const viSource = new Map(viRows.map(row => [`${row.group}::${row.key}`, row.value]))

  let cursor = 0
  while (true) {
    const rows = await db
      .select({ id: langTranslations.id, langCode: langTranslations.langCode, group: langTranslations.group, key: langTranslations.key, value: langTranslations.value })
      .from(langTranslations)
      .where(gt(langTranslations.id, cursor))
      .orderBy(asc(langTranslations.id))
      .limit(BATCH)
    if (rows.length === 0) break
    cursor = rows[rows.length - 1]!.id
    for (const planned of planTranslationValueRepair(rows, viSource)) {
      report[planned.bucket].push(planned)
      if (!apply || (planned.bucket === 'review' && !includeReview)) continue
      const result = await db.update(langTranslations)
        // `updated_at = updated_at`: assigned explicitly so `ON UPDATE CURRENT_TIMESTAMP` does not run.
        .set({ value: null, updatedAt: sql`${langTranslations.updatedAt}` })
        .where(and(eq(langTranslations.id, planned.id), sql`HEX(${langTranslations.value}) = HEX(${planned.value})`))
      if (affectedRowsOrZero(result) > 0) report.written += 1
      else report.skipped += 1
    }
  }
  return report
}
