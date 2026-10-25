import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test, { beforeEach } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/mysql2'
import * as schema from '../server/db/schema'
import { NULL_LITERALS, planNullLiteralRepair, runNullLiteralRepair } from '../server/services/translation-null-repair'

/**
 * `npm run db:repair-null-translations` — the one-off repair for rows the old
 * `PUT /api/admin/languages/:code/translations` wrote as the TEXT "null"
 * (`String(null)`, since 572ffb4: "Lưu" on an untouched empty row). The public site
 * shows such a value as the word "null" (`t()` only falls back on an empty value),
 * and a "null" in a vi row was sent to the AI as the source text.
 *
 * Same shape as `db:decode-excerpts` / `db:sanitize-html`: preview by default,
 * `--apply` to write, keyset batches, each UPDATE guarded by the value it planned
 * from, `updated_at` kept. Runs again with nothing to do. Not a boot step: a boot
 * write would need a declared conversion in tests/schema-upgrade-integration.test.ts,
 * and the operator should see the list first.
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

beforeEach(() => {
  sqlite.exec('DELETE FROM `lang_translations`')
  statements.length = 0
  const rows: Array<[number, string, string, string, string | null]> = [
    [1, 'vi', 'nav', 'news', 'null'],
    [2, 'en', 'nav', 'news', 'undefined'],
    [3, 'en', 'nav', 'home', 'NULL'],
    [4, 'en', 'nav', 'about', 'null '],
    [5, 'fr', 'nav', 'news', 'Null value'],
    [6, 'lo', 'nav', 'news', null],
    [7, 'en', 'nav', 'contact', 'Contact'],
    [8, 'ru', 'footer', 'copyright', 'null'],
  ]
  for (const row of rows) insert.run(...row, UPDATED_AT)
})

test('the plan takes exactly the two spellings String() produces, nothing that only resembles them', () => {
  assert.deepEqual([...NULL_LITERALS], ['null', 'undefined'])
  const plan = planNullLiteralRepair([
    { id: 1, langCode: 'vi', group: 'nav', key: 'a', value: 'null' },
    { id: 2, langCode: 'vi', group: 'nav', key: 'b', value: 'undefined' },
    { id: 3, langCode: 'vi', group: 'nav', key: 'c', value: 'NULL' },
    { id: 4, langCode: 'vi', group: 'nav', key: 'd', value: 'null ' },
    { id: 5, langCode: 'vi', group: 'nav', key: 'e', value: null },
    { id: 6, langCode: 'vi', group: 'nav', key: 'f', value: 'nullable' },
  ])
  assert.deepEqual(plan.map(row => row.id), [1, 2])
})

test('preview lists the rows it would clear and writes nothing', async () => {
  const report = await runNullLiteralRepair({ db })
  assert.equal(report.applied, false)
  assert.equal(report.changed, 3)
  assert.equal(report.written, 0)
  assert.deepEqual(report.rows, [
    { id: 1, langCode: 'vi', group: 'nav', key: 'news', value: 'null' },
    { id: 2, langCode: 'en', group: 'nav', key: 'news', value: 'undefined' },
    { id: 8, langCode: 'ru', group: 'footer', key: 'copyright', value: 'null' },
  ])
  assert.equal(valueOf(1).value, 'null')
  assert.ok(statements.every(sql => /^\s*select/i.test(sql)), 'preview only reads')
})

test('--apply sets those rows to SQL NULL (the untranslated state), keeps updated_at, and touches nothing else', async () => {
  const report = await runNullLiteralRepair({ apply: true, db })
  assert.deepEqual([report.applied, report.changed, report.written, report.skipped], [true, 3, 3, 0])
  for (const id of [1, 2, 8]) {
    assert.equal(valueOf(id).value, null, `row ${id}`)
    assert.equal(valueOf(id).updated_at, UPDATED_AT, `row ${id}: updated_at kept`)
  }
  assert.deepEqual([3, 4, 5, 6, 7].map(id => valueOf(id).value), ['NULL', 'null ', 'Null value', null, 'Contact'])

  const again = await runNullLiteralRepair({ apply: true, db })
  assert.deepEqual([again.changed, again.written], [0, 0], 'a second run has nothing to do')
})

test('a row an officer edits between the read and the write is left alone and counted as skipped', async () => {
  beforeUpdate = () => { sqlite.prepare('UPDATE `lang_translations` SET `value` = ? WHERE `id` = 1').run('Tin tức') }
  const report = await runNullLiteralRepair({ apply: true, db })
  assert.deepEqual([report.changed, report.written, report.skipped], [3, 2, 1])
  assert.equal(valueOf(1).value, 'Tin tức')
})

test('operator wiring: npm run db:repair-null-translations runs the script, preview unless --apply', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> }
  assert.equal(pkg.scripts['db:repair-null-translations'], 'node --experimental-strip-types --import ./scripts/ts-resolver.mjs scripts/repair-null-translations.ts')
  const script = readFileSync(new URL('../scripts/repair-null-translations.ts', import.meta.url), 'utf8')
  assert.match(script, /runNullLiteralRepair\(\{ apply \}\)/)
  assert.match(script, /const apply = process\.argv\.includes\('--apply'\)/)
})

test('more rows than one batch are all found', async () => {
  sqlite.exec('DELETE FROM `lang_translations`')
  for (let id = 1; id <= 1203; id++) insert.run(id, 'en', 'bulk', `k${id}`, id % 2 ? 'null' : 'ok', UPDATED_AT)
  const report = await runNullLiteralRepair({ apply: true, db })
  assert.equal(report.changed, 602)
  assert.equal(report.written, 602)
  assert.equal(Number((sqlite.prepare('SELECT COUNT(*) AS n FROM `lang_translations` WHERE `value` = ?').get('null') as { n: number }).n), 0)
})
