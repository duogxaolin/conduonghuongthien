import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, mock } from 'node:test'
import { gunzipSync, gzipSync } from 'node:zlib'

/**
 * Dump và khôi phục chạy dưới MỘT `sql_mode` cố định (`NO_AUTO_VALUE_ON_ZERO`),
 * không phụ thuộc chế độ của server.
 *
 * Dump thoát `'` bằng `\'`. Dưới `NO_BACKSLASH_ESCAPES` (server có thể đặt chế độ
 * này toàn cục) `\'` kết thúc chuỗi, và phần còn lại của một giá trị người dùng
 * nhập chạy như SQL khi khôi phục. Bản tích hợp với MySQL thật nằm ở
 * `backup-dump-integration.test.ts`; ở đây là hợp đồng không cần CSDL: header của
 * file, phiên dump và phiên khôi phục.
 */

const queries: Array<{ conn: number, sql: string }> = []
let connections = 0

function fakeConnection(options: { multipleStatements?: boolean }) {
  const id = ++connections
  return {
    query: async (input: string | { sql: string }) => {
      const sqlText = typeof input === 'string' ? input : input.sql
      queries.push({ conn: id, sql: sqlText })
      if (/^SHOW TABLES/i.test(sqlText)) return [[{ Tables_in_x: 'articles' }], []]
      if (/information_schema/i.test(sqlText)) return [[{ name: 'articles', engine: 'InnoDB' }], []]
      if (/^SHOW CREATE TABLE/i.test(sqlText)) return [[{ 'Create Table': 'CREATE TABLE `articles` (`id` int NOT NULL AUTO_INCREMENT, `title` varchar(255), PRIMARY KEY (`id`))' }], []]
      if (/^SELECT \* FROM/i.test(sqlText)) {
        return [[['0', "x\\'); DROP TABLE users; -- "]], [{ name: 'id', columnType: 0x03 }, { name: 'title', columnType: 0xfd }]]
      }
      void options
      return [[], []]
    },
    end: async () => {},
  }
}
mock.module('mysql2/promise', {
  namedExports: { createConnection: async (options: { multipleStatements?: boolean }) => fakeConnection(options) },
  defaultExport: { createConnection: async (options: { multipleStatements?: boolean }) => fakeConnection(options) },
})
mock.module('../server/utils/logger', { namedExports: { logWarn: () => {}, logInfo: () => {}, logError: () => {} } })

const { dumpSql, restoreSql, DUMP_SQL_MODE } = await import('../server/services/backup-sql')
const { DUMP_FORMAT_MARKER, isLegacyAppDump } = await import('../server/services/backup-restore-guards')

const workdir = mkdtempSync(path.join(tmpdir(), 'cdkt-sql-mode-'))
after(() => rmSync(workdir, { recursive: true, force: true }))

test('the pinned mode is exactly NO_AUTO_VALUE_ON_ZERO (never NO_BACKSLASH_ESCAPES)', () => {
  assert.equal(DUMP_SQL_MODE, 'NO_AUTO_VALUE_ON_ZERO')
})

test('the dump header pins sql_mode before any data, and keeps the format marker on line 2', async () => {
  queries.length = 0
  const target = path.join(workdir, 'dump.sql.gz')
  await dumpSql(target)
  const text = gunzipSync(readFileSync(target)).toString('utf8')
  const lines = text.split('\n')
  assert.equal(lines[1], DUMP_FORMAT_MARKER)
  assert.equal(isLegacyAppDump(text), false)
  const modeLine = lines.indexOf("SET SESSION sql_mode = 'NO_AUTO_VALUE_ON_ZERO';")
  assert.ok(modeLine > 0 && modeLine < 10, `sql_mode is set in the header (line ${modeLine})`)
  assert.ok(modeLine < lines.findIndex(line => line.startsWith('DROP TABLE')), 'before the first statement that touches data')
  assert.ok(!/NO_BACKSLASH_ESCAPES/i.test(text))
  // The value is written with backslash escapes — which is exactly why the mode must be pinned.
  assert.ok(text.includes("'x\\\\\\'); DROP TABLE users; -- '"), text)
  // The dump session itself runs under the same mode, first.
  assert.match(queries[0]!.sql, /^SET SESSION sql_mode = 'NO_AUTO_VALUE_ON_ZERO'$/)
})

test('restore pins the session mode BEFORE running the file (old dumps carry no sql_mode line)', async () => {
  queries.length = 0
  const file = path.join(workdir, 'legacy.sql.gz')
  writeFileSync(file, gzipSync("-- CDKT backup: cdkt_admin\nINSERT INTO t VALUES ('a\\'b');\n"))
  await restoreSql(file)
  const restoreConn = queries[0]!.conn
  const onRestore = queries.filter(q => q.conn === restoreConn).map(q => q.sql)
  assert.match(onRestore[0]!, /^SET SESSION sql_mode = 'NO_AUTO_VALUE_ON_ZERO'$/)
  const fileIndex = onRestore.findIndex(sql => sql.includes('INSERT INTO t'))
  assert.ok(fileIndex > 0, 'the file runs after the mode is pinned')
})
