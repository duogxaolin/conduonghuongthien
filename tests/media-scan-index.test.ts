import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getTableConfig, MySqlDialect } from 'drizzle-orm/mysql-core'
import { media } from '../server/db/schema'

/**
 * `media.scanned_source_path` + its prefix index (wave2 D-SCAN).
 *
 * `db:drift` compares columns, not indexes, so the index is pinned here in all three
 * places (same pattern as `tests/article-list-indexes.test.ts`):
 *   - `schema.ts` `index()` — the source of truth Drizzle generates from;
 *   - `schema-tables/core.ts` — what a fresh database is created with;
 *   - `migrations-additive.ts` `ensureColumn` + `ensureIndex` — what an EXISTING
 *     database gets (`CREATE TABLE IF NOT EXISTS` never adds a column or a key).
 * It is a PREFIX index (255 characters): `VARCHAR(1024)` in utf8mb4 is 4096 bytes,
 * past InnoDB's 3072-byte key limit, so a full-column index fails to create.
 */

const NAME = 'media_scanned_source_path_idx'
const COLUMNS = '`scanned_source_path`(255)'
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const normalize = (s: string) => s.replace(/\\`/g, '`').replace(/\s+/g, '')

test('schema.ts declares the column and the prefix index', () => {
  const config = getTableConfig(media)
  const column = config.columns.find(c => c.name === 'scanned_source_path')
  assert.ok(column, 'schema.ts has no media.scanned_source_path')
  assert.equal(column.notNull, false)
  assert.equal(column.getSQLType(), 'varchar(1024)')
  const index = config.indexes.find(i => i.config.name === NAME)
  assert.ok(index, `schema.ts has no index ${NAME}`)
  const dialect = new MySqlDialect()
  const rendered = index.config.columns.map(c => dialect.sqlToQuery(c as Parameters<typeof dialect.sqlToQuery>[0]).sql)
  assert.deepEqual(rendered.map(normalize), [normalize(COLUMNS)])
})

test('the fresh-database DDL creates the column and the same prefix index', () => {
  const core = read('server/db/schema-tables/core.ts')
  const body = /CREATE TABLE IF NOT EXISTS \\`media\\` \(([\s\S]*?)\) ENGINE/.exec(core)?.[1] ?? ''
  assert.match(normalize(body), /`scanned_source_path`VARCHAR\(1024\)NULL,/)
  assert.ok(normalize(body).includes(normalize(`KEY \`${NAME}\` (${COLUMNS})`)), `core.ts media body does not create ${NAME} on ${COLUMNS}`)
})

test('an existing database converges through ensureColumn + ensureIndex with the same definition', () => {
  const additive = read('server/db/migrations-additive.ts')
  assert.match(additive, /ensureColumn\(db, database, 'media', 'scanned_source_path', 'VARCHAR\(1024\) NULL'\)/)
  const call = new RegExp(`ensureIndex\\(db, database, 'media', '${NAME}', '([^']+)'\\)`).exec(additive)
  assert.ok(call, `migrations-additive.ts never adds ${NAME} to an existing table`)
  assert.equal(normalize(call[1]!), normalize(`INDEX \`${NAME}\` (${COLUMNS})`))
})
