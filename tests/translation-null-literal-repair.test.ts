import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test, { beforeEach } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/mysql2'
import * as schema from '../server/db/schema'
import { NULL_LITERALS, planTranslationValueRepair, runTranslationValueRepair } from '../server/services/translation-null-repair'

/**
 * `npm run db:repair-null-translations` — the one-off repair for UI translations the
 * old write paths stored as text that is not a translation:
 *   - exactly "null"/"undefined" — `String(null)` in the PUT (since 572ffb4: "Lưu" on an
 *     untouched empty row), and the AI paths' `String(p.value)`: cleared by `--apply`;
 *   - things that are only PROBABLY the bug, listed for review and cleared only by
 *     `--apply --include-review`: "NULL"/" null"/"Null" (the single-key endpoint stored
 *     the model's answer verbatim), "[object Object]" (chunk and universal job), and a
 *     bare number where the vi source is not that number (the bulk endpoint stored the
 *     model's number).
 * The public site shows any of them as is (`t()` only falls back on an empty value).
 *
 * Same shape as `db:decode-excerpts` / `db:sanitize-html`: preview by default, keyset
 * batches, each UPDATE guarded by the BYTES it planned from (HEX: the column's
 * `utf8mb4_unicode_ci` would call "NULL" equal to "null", and PAD SPACE "null " too),
 * `updated_at` kept. Runs again with nothing to do. Not a boot step: a boot write
 * would need a declared conversion in tests/schema-upgrade-integration.test.ts, and
 * the operator should read the list first.
 *
 * Drizzle's MySQL dialect builds the SQL; it runs on an in-memory SQLite table.
 */

const sqlite = new DatabaseSync(':memory:')
sqlite.exec('CREATE TABLE `lang_translations` (`id` INTEGER PRIMARY KEY, `lang_code` TEXT, `group` TEXT, `key` TEXT, `value` TEXT, `is_ai_translated` INTEGER, `created_at` TEXT, `updated_at` TEXT)')
const insert = sqlite.prepare('INSERT INTO `lang_translations` (`id`, `lang_code`, `group`, `key`, `value`, `is_ai_translated`, `updated_at`) VALUES (?, ?, ?, ?, ?, 0, ?)')
const UPDATED_AT = '2026-09-30 10:00:00'

let beforeUpdate: (() => void) | null = null
const statements: string[] = []
const pool = {
  query: async (options: { sql: string, rowsAsArray?: boolean }, params: unknown[] = []) => {
    statements.push(options.sql)
    const statement = sqlite.prepare(options.sql)
    if (/^\s*select/i.test(options.sql)) {
      if (options.rowsAsArray) statement.setReturnArrays(true)
      return [statement.all(...(params as never[]))]
    }
    beforeUpdate?.()
    beforeUpdate = null
    const result = statement.run(...(params as never[]))
    return [{ affectedRows: Number(result.changes), insertId: Number(result.lastInsertRowid) }]
  },
}
const db = drizzle(pool as never, { schema, mode: 'default' }) as never

const valueOf = (id: number) => (sqlite.prepare('SELECT `value`, `updated_at` FROM `lang_translations` WHERE `id` = ?').get(id) as { value: string | null, updated_at: string })

const ROWS: Array<[number, string, string, string, string | null]> = [
  [1, 'vi', 'nav', 'news', 'null'],
  [2, 'en', 'nav', 'news', 'undefined'],
  [3, 'en', 'nav', 'home', 'NULL'],
  [4, 'en', 'nav', 'about', 'null '],
  [5, 'fr', 'nav', 'news', 'Null value'],
  [6, 'lo', 'nav', 'news', null],
  [7, 'en', 'nav', 'contact', 'Contact'],
  [8, 'ru', 'footer', 'copyright', 'null'],
  [9, 'fr', 'nav', 'home', ' Undefined'],
  [10, 'zh', 'nav', 'contact', '[object Object]'],
  [11, 'vi', 'nav', 'contact', 'Liên hệ'],
  [12, 'lo', 'nav', 'contact', '5'],
  [13, 'vi', 'stats', 'year', '2024'],
  [14, 'en', 'stats', 'year', '2024'],
  [15, 'vi', 'stats', 'count', '12'],
  [16, 'ru', 'stats', 'count', '3.5'],
]

beforeEach(() => {
  sqlite.exec('DELETE FROM `lang_translations`')
  statements.length = 0
  for (const row of ROWS) insert.run(...row, UPDATED_AT)
})

test('the plan: the exact spellings String() produces are certain; look-alikes, "[object Object]" and stray numbers are for review', () => {
  assert.deepEqual([...NULL_LITERALS], ['null', 'undefined'])
  const vi = new Map([['nav::contact', 'Liên hệ'], ['stats::year', '2024'], ['stats::count', '12']])
  const row = (id: number, langCode: string, group: string, key: string, value: string | null) => ({ id, langCode, group, key, value })
  const plan = planTranslationValueRepair([
    row(1, 'vi', 'nav', 'a', 'null'),
    row(2, 'en', 'nav', 'b', 'undefined'),
    row(3, 'en', 'nav', 'c', 'NULL'),
    row(4, 'en', 'nav', 'd', 'null '),
    row(5, 'en', 'nav', 'e', ' Undefined'),
    row(6, 'en', 'nav', 'f', '[object Object]'),
    row(7, 'en', 'nav', 'contact', '5'),
    row(8, 'en', 'stats', 'year', '2024'),
    row(9, 'en', 'stats', 'count', '-3.5'),
    row(10, 'vi', 'stats', 'count', '12'),
    row(11, 'en', 'nav', 'g', null),
    row(12, 'en', 'nav', 'h', 'nullable'),
    row(13, 'en', 'nav', 'i', 'Null value'),
    row(14, 'en', 'nav', 'j', '5 phút'),
  ], vi)
  assert.deepEqual(plan.map(p => [p.id, p.bucket, p.reason]), [
    [1, 'exact', 'null_literal'],
    [2, 'exact', 'null_literal'],
    [3, 'review', 'null_like'],
    [4, 'review', 'null_like'],
    [5, 'review', 'null_like'],
    [6, 'review', 'object_text'],
    [7, 'review', 'numeric'],
    [9, 'review', 'numeric'],
  ])
})

test('preview lists both buckets and writes nothing', async () => {
  const report = await runTranslationValueRepair({ db })
  assert.equal(report.applied, false)
  assert.deepEqual(report.exact.map(r => r.id), [1, 2, 8])
  assert.deepEqual(report.review.map(r => [r.id, r.reason]), [[3, 'null_like'], [4, 'null_like'], [9, 'null_like'], [10, 'object_text'], [12, 'numeric'], [16, 'numeric']])
  assert.equal(report.written, 0)
  assert.equal(valueOf(1).value, 'null')
  assert.ok(statements.every(sql => /^\s*select/i.test(sql)), 'preview only reads')
})

test('--apply clears only the certain rows to SQL NULL, keeps updated_at, and touches nothing else', async () => {
  const report = await runTranslationValueRepair({ apply: true, db })
  assert.deepEqual([report.applied, report.includeReview, report.written, report.skipped], [true, false, 3, 0])
  for (const id of [1, 2, 8]) {
    assert.equal(valueOf(id).value, null, `row ${id}`)
    assert.equal(valueOf(id).updated_at, UPDATED_AT, `row ${id}: updated_at kept`)
  }
  assert.deepEqual([3, 4, 9, 10, 12, 16].map(id => valueOf(id).value), ['NULL', 'null ', ' Undefined', '[object Object]', '5', '3.5'], 'review rows untouched')

  const again = await runTranslationValueRepair({ apply: true, db })
  assert.deepEqual([again.exact.length, again.written], [0, 0], 'a second run has nothing certain left')
})

test('--apply --include-review also clears the reviewed rows (RED before: they were never even listed)', async () => {
  const report = await runTranslationValueRepair({ apply: true, includeReview: true, db })
  assert.deepEqual([report.written, report.skipped], [9, 0])
  for (const id of [1, 2, 8, 3, 4, 9, 10, 12, 16]) assert.equal(valueOf(id).value, null, `row ${id}`)
  assert.deepEqual([5, 7, 11, 13, 14, 15].map(id => valueOf(id).value), ['Null value', 'Contact', 'Liên hệ', '2024', '2024', '12'])
})

test('a row an officer edits between the read and the write is left alone and counted as skipped', async () => {
  beforeUpdate = () => { sqlite.prepare('UPDATE `lang_translations` SET `value` = ? WHERE `id` = 1').run('Tin tức') }
  const report = await runTranslationValueRepair({ apply: true, db })
  assert.deepEqual([report.written, report.skipped], [2, 1])
  assert.equal(valueOf(1).value, 'Tin tức')
})

test('the write guard compares bytes, not the column\'s collation — "NULL" or "null " typed in between is not "null" (RED before: `value = ?`)', async () => {
  // MySQL's utf8mb4_unicode_ci would call these equal to the planned "null"; SQLite
  // compares exactly, so the SQL itself is checked: the guard is a byte comparison.
  beforeUpdate = () => { sqlite.prepare('UPDATE `lang_translations` SET `value` = ? WHERE `id` = 1').run('NULL') }
  const report = await runTranslationValueRepair({ apply: true, db })
  assert.equal(valueOf(1).value, 'NULL')
  assert.equal(report.skipped, 1)
  const updates = statements.filter(sql => /^\s*update/i.test(sql))
  assert.ok(updates.length > 0)
  for (const sql of updates) assert.match(sql, /hex\(`lang_translations`\.`value`\) = hex\(\?\)/i, sql)
})

test('operator wiring: npm run db:repair-null-translations runs the script, preview unless --apply, review only with --include-review', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> }
  assert.equal(pkg.scripts['db:repair-null-translations'], 'node --experimental-strip-types --import ./scripts/ts-resolver.mjs scripts/repair-null-translations.ts')
  const script = readFileSync(new URL('../scripts/repair-null-translations.ts', import.meta.url), 'utf8')
  assert.match(script, /const apply = process\.argv\.includes\('--apply'\)/)
  assert.match(script, /const includeReview = process\.argv\.includes\('--include-review'\)/)
  assert.match(script, /runTranslationValueRepair\(\{ apply, includeReview \}\)/)
})

test('more rows than one batch are all found', async () => {
  sqlite.exec('DELETE FROM `lang_translations`')
  for (let id = 1; id <= 1203; id++) insert.run(id, 'en', 'bulk', `k${id}`, id % 2 ? 'null' : 'ok', UPDATED_AT)
  const report = await runTranslationValueRepair({ apply: true, db })
  assert.equal(report.exact.length, 602)
  assert.equal(report.written, 602)
  assert.equal(Number((sqlite.prepare('SELECT COUNT(*) AS n FROM `lang_translations` WHERE `value` = ?').get('null') as { n: number }).n), 0)
})
