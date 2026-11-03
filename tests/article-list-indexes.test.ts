import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getTableConfig } from 'drizzle-orm/mysql-core'
import { articles } from '../server/db/schema'

/**
 * Composite indexes for the public article lists (design D18).
 *
 * `articles.get.ts` and `related.get.ts` filter on `status` + `type` (or
 * `category_id`) and order by `published_at DESC, created_at DESC`; with only
 * single-column `status_idx`/`type_idx` MySQL picked one and sorted the rest
 * (filesort) on every list request.
 *
 * An index lives in THREE places and `db:drift` compares columns only, not
 * indexes:
 *   - `schema.ts` `index()` — the source of truth Drizzle generates from;
 *   - `schema-tables/content.ts` — what a fresh database is created with;
 *   - `migrations-additive.ts` `ensureIndex` — what an EXISTING database gets
 *     (`CREATE TABLE IF NOT EXISTS` never adds a key to a table that exists).
 * This test is the drift check for these two: same name, same columns, all three.
 */

const EXPECTED: Record<string, string[]> = {
  articles_status_type_pub_idx: ['status', 'type', 'published_at', 'created_at'],
  articles_status_category_pub_idx: ['status', 'category_id', 'published_at', 'created_at'],
  // "Đọc nhiều" (`sort=views`) ranks by the maintained total (design D6); the
  // tie-break columns let MySQL read `ORDER BY view_total, published_at,
  // created_at` straight off the index instead of sorting.
  articles_status_type_views_idx: ['status', 'type', 'view_total', 'published_at', 'created_at'],
}

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

/** `KEY|INDEX \`name\` (\`a\`, \`b\`)` wherever it appears (CREATE TABLE body or ensureIndex). */
function ddlColumns(source: string, name: string): string[][] {
  const found: string[][] = []
  const pattern = new RegExp(`(?:KEY|INDEX)\\s+\\\\?\`${name}\\\\?\`\\s*\\(([^)]*)\\)`, 'g')
  for (const match of source.matchAll(pattern)) {
    found.push(match[1]!.split(',').map(column => column.replace(/[\\`\s]/g, '')))
  }
  return found
}

test('schema.ts declares both composite indexes on articles', () => {
  const indexes = getTableConfig(articles).indexes.map(index => ({
    name: index.config.name,
    columns: index.config.columns.map(column => (column as { name: string }).name),
  }))
  for (const [name, columns] of Object.entries(EXPECTED)) {
    const declared = indexes.find(index => index.name === name)
    assert.ok(declared, `schema.ts has no index ${name}`)
    assert.deepEqual(declared.columns, columns, `${name}: schema.ts column order differs`)
  }
})

test('the fresh-database DDL creates them with the same columns', () => {
  const content = read('server/db/schema-tables/content.ts')
  for (const [name, columns] of Object.entries(EXPECTED)) {
    const declared = ddlColumns(content, name)
    assert.ok(declared.length > 0, `schema-tables/content.ts does not create ${name}`)
    for (const found of declared) assert.deepEqual(found, columns, `${name}: content.ts column order differs`)
  }
})

test('an existing database converges through ensureIndex with the same columns', () => {
  const additive = read('server/db/migrations-additive.ts')
  for (const [name, columns] of Object.entries(EXPECTED)) {
    assert.match(additive, new RegExp(`ensureIndex\\(db, database, 'articles', '${name}'`), `migrations-additive.ts never adds ${name} to an existing table`)
    const declared = ddlColumns(additive, name)
    assert.equal(declared.length, 1)
    assert.deepEqual(declared[0], columns, `${name}: migrations-additive.ts column order differs`)
  }
})
