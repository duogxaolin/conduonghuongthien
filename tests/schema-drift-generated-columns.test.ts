/**
 * `npm run db:drift` and generated columns (design D6: `articles.view_total`).
 *
 * The gate compares, per column, a coarse type family and NULL-ability. A
 * generated column passes that comparison whether or not one side knows it is
 * generated — `view_total BIGINT` in schema.ts and `view_total BIGINT AS (…)
 * STORED` in the DDL both read as "bigint, nullable". That is not cosmetic: a
 * schema.ts that declares a plain column lets Drizzle put the field in every
 * INSERT, and MySQL rejects any value for a generated column (error 3105). The
 * other direction — DDL plain, schema.ts generated — leaves a column the
 * application believes the database maintains and that nothing ever writes.
 *
 * So the gate now reads a third property, `generated` (`stored` | `virtual` |
 * null), on both sides, and reports a mismatch. These tests exercise the parser
 * on DDL text, the comparison on hand-built shapes, and finally the real repo
 * files, so a regression in either reader is caught.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import * as schema from '../server/db/schema'
import {
  compareSchemas,
  parseDdlColumn,
  readDdlSource,
  tablesFromDdl,
  tablesFromSchema,
  type TableShape,
} from '../scripts/check-schema-drift'

const shape = (columns: Record<string, { type: string, nullable: boolean, generated: 'stored' | 'virtual' | null }>): TableShape =>
  ({ table: 't', columns: new Map(Object.entries(columns)) })

test('the DDL reader recognises a generated column and its storage', () => {
  assert.deepEqual(
    parseDdlColumn('      \\`view_total\\` BIGINT AS (\\`view_total_real\\` + \\`view_total_fabricated\\`) STORED,'),
    ['view_total', { type: 'bigint', nullable: true, generated: 'stored' }],
  )
  assert.deepEqual(
    parseDdlColumn('  \\`full_name\\` VARCHAR(255) GENERATED ALWAYS AS (CONCAT(\\`a\\`, \\`b\\`)) VIRTUAL NOT NULL'),
    ['full_name', { type: 'varchar', nullable: false, generated: 'virtual' }],
  )
  // MySQL's default storage for a generated column is VIRTUAL.
  assert.deepEqual(
    parseDdlColumn('  \\`n\\` INT AS (\\`a\\` + 1)'),
    ['n', { type: 'int', nullable: true, generated: 'virtual' }],
  )
  assert.deepEqual(
    parseDdlColumn('      \\`view_total_real\\` BIGINT NOT NULL DEFAULT 0,'),
    ['view_total_real', { type: 'bigint', nullable: false, generated: null }],
  )
})

test('a column added by ensureColumn keeps its generated storage', () => {
  const source = [
    'CREATE TABLE IF NOT EXISTS \\`t\\` (',
    '  \\`id\\` INT AUTO_INCREMENT PRIMARY KEY',
    ') ENGINE=InnoDB',
    "await ensureColumn(db, database, 't', 'total', 'BIGINT AS (`a` + `b`) STORED')",
    "await ensureColumn(db, database, 't', 'a', 'BIGINT NOT NULL DEFAULT 0')",
  ].join('\n')
  const tables = tablesFromDdl(source)
  assert.deepEqual(tables.get('t')?.columns.get('total'), { type: 'bigint', nullable: true, generated: 'stored' })
  assert.deepEqual(tables.get('t')?.columns.get('a'), { type: 'bigint', nullable: false, generated: null })
})

test('a generated column on one side only, or with a different storage, is drift', () => {
  const ddl = new Map([['t', shape({ total: { type: 'bigint', nullable: true, generated: 'stored' } })]])

  const plainInSchema = compareSchemas(new Map([['t', shape({ total: { type: 'bigint', nullable: true, generated: null } })]]), ddl)
  assert.equal(plainInSchema.problems.length, 1)
  assert.match(plainInSchema.problems[0]!, /"t\.total" LỆCH CỘT SINH: schema\.ts=thường ↔ init\.ts=STORED/)

  const virtualInSchema = compareSchemas(new Map([['t', shape({ total: { type: 'bigint', nullable: true, generated: 'virtual' } })]]), ddl)
  assert.match(virtualInSchema.problems.join('\n'), /schema\.ts=VIRTUAL ↔ init\.ts=STORED/)

  const agreeing = compareSchemas(new Map([['t', shape({ total: { type: 'bigint', nullable: true, generated: 'stored' } })]]), ddl)
  assert.deepEqual(agreeing.problems, [])
  assert.equal(agreeing.comparedColumns, 1)
})

test('the repo agrees with itself, and articles.view_total is read as STORED on both sides', () => {
  const declared = tablesFromSchema(schema as Record<string, unknown>, new Set())
  const created = tablesFromDdl(readDdlSource())
  assert.deepEqual(compareSchemas(declared, created).problems, [])

  for (const [side, tables] of [['schema.ts', declared], ['DDL', created]] as const) {
    const columns = tables.get('articles')?.columns
    assert.deepEqual(columns?.get('view_total'), { type: 'bigint', nullable: true, generated: 'stored' }, `${side}: view_total`)
    assert.deepEqual(columns?.get('view_total_real'), { type: 'bigint', nullable: false, generated: null }, `${side}: view_total_real`)
    assert.deepEqual(columns?.get('view_total_fabricated'), { type: 'bigint', nullable: false, generated: null }, `${side}: view_total_fabricated`)
  }
})
