import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { drizzle } from 'drizzle-orm/mysql2'

/**
 * Every translation write checks its language INSIDE the write transaction with a row
 * lock — `select … from languages … for update` — so a concurrent `deleteLanguage`
 * (which must lock that row to delete it) waits for the write to commit instead of
 * committing in between and leaving orphan `lang_translations` rows that no language
 * owns. A plain SELECT took no lock. `FOR UPDATE`, not `FOR SHARE`: MariaDB (aaPanel
 * installs) rejects `FOR SHARE`; the codebase locks with `.for('update')` elsewhere too.
 *
 * The SQLite harness has no row locks, so the statements drizzle's MySQL dialect sends
 * through a real mysql2-shaped transaction are recorded and pinned: the locking read,
 * its place after `begin` and before the first write.
 */

mock.module('../server/utils/permissions', { namedExports: { requireResourcePermission: () => {} } })
const schema = await import('../server/db/schema')
const { listActiveTranslationTargets, requireLanguage, upsertTranslations } = await import('../server/services/languages')

function recordingDb(languageExists = true) {
  const statements: string[] = []
  const respond = (sql: string) => {
    if (/^select `id` from `languages`/i.test(sql)) return [languageExists ? [[1]] : []]
    if (/^select/i.test(sql)) return [[]]
    return [{ affectedRows: 1, insertId: 7 }]
  }
  const connection = {
    query: async (options: string | { sql: string }) => {
      const sql = typeof options === 'string' ? options : options.sql
      statements.push(sql)
      return respond(sql)
    },
    release: () => {},
  }
  const pool = { ...connection, getConnection: async () => connection }
  return { db: drizzle(pool as never, { schema, mode: 'default' }), statements }
}

test('a translation write checks its language with a row lock, inside the transaction, before writing (RED before: plain select)', async () => {
  const { db, statements } = recordingDb()
  await upsertTranslations({ id: 1 } as never, 'fr', [{ group: 'nav', key: 'news', value: 'Actualités' }], false, db as never)
  const check = statements.findIndex(sql => /from `languages`/i.test(sql))
  assert.ok(check >= 0, statements.join('\n'))
  assert.match(statements[check]!, /^select `id` from `languages` where `languages`\.`code` = \? limit \? for update$/i)
  assert.equal(statements.indexOf('begin'), 0, 'inside the transaction')
  const firstWrite = statements.findIndex(sql => /^(insert|update|delete)/i.test(sql))
  assert.ok(check < firstWrite, 'before the first write')
})

test('an unknown language rolls the transaction back before any write', async () => {
  const { db, statements } = recordingDb(false)
  await assert.rejects(
    upsertTranslations({ id: 1 } as never, 'xx', [{ group: 'nav', key: 'news', value: 'x' }], false, db as never),
    (error: { statusCode?: number }) => error.statusCode === 404,
  )
  assert.ok(!statements.some(sql => /^(insert|update|delete)/i.test(sql)), statements.join('\n'))
  assert.equal(statements.at(-1), 'rollback')
})

test('auto-translation targets come from the languages table: active ones, vi excluded, in display order', async () => {
  const { db, statements } = recordingDb()
  await listActiveTranslationTargets(db as never)
  assert.match(statements.join('\n'), /^select `code`, `name` from `languages` where \(`languages`\.`is_active` = \? and `languages`\.`code` <> \?\) order by `languages`\.`display_order`, `languages`\.`id`$/im)
})

test('the read-only check (list GET, the early refusal before AI calls) takes no lock', async () => {
  const { db, statements } = recordingDb()
  await requireLanguage('fr', db as never)
  assert.doesNotMatch(statements.join('\n'), /for (update|share)/i)
})
