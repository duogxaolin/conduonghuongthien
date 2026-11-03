import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import type * as TS from 'typescript'
import * as migrations from '../server/db/migrations-additive.ts'
import * as schema from '../server/db/schema.ts'
import { tablesFromSchema } from '../scripts/check-schema-drift.ts'

/**
 * A column added to `schema.ts` and to its table's `CREATE TABLE` reaches a NEW database only.
 * The database of the release in production already has the table — `CREATE TABLE IF NOT
 * EXISTS` skips it — so there the column exists only if a boot migration adds it. Neither gate
 * saw one missing:
 *   - `db:drift` reads the `CREATE TABLE` bodies and the additive calls as ONE source, so the
 *     `CREATE TABLE` line alone satisfies it;
 *   - the upgrade suite (`schema-upgrade-integration`, MySQL) diffs the columns both snapshots
 *     share, so a column that never appears changes nothing it compares.
 * Mutant N22 (verifier of wave3/queue-restore, 2026-10-31) deleted the `ensureColumn` of
 * `livestream_messages.flag_reason`: every suite stayed green, the upgrade suite 7/7 on MySQL —
 * while on an upgraded database every automatic hide of a livestream message fails
 * (`ai_moderation.hide_failed`: the message stays on screen) and every approve of one is a 500.
 *
 * The rule checked here, without MySQL: every column `schema.ts` declares on a table that the
 * previous release has (`tests/fixtures/schema-prev.sql`) but which that table lacks is added by
 * a boot migration — a literal `ensureColumn(db, database, '<table>', '<column>', …)` call in a
 * `server/db/` source (read with the TypeScript parser: a commented-out call does not count), or
 * an entry of an exported column array of `migrations-additive.ts` that a `for … of` there walks
 * (`{ table, column }`, or `[table, column, '<SQL type> …']`). Its limit: it reads code, so a call
 * that the boot never reaches still counts. The upgrade suite's "boot 1 brings the previous
 * release to every table and column schema.ts declares" checks the booted database itself.
 *
 * After the fixture is refreshed (CI-CD.md, after each release) the set of such columns is often
 * empty; the synthetic cases keep the detector itself honest, and the registrations of the
 * columns this fixture lacks stay pinned — restoring an older dump relies on them too.
 */

const requireFromHere = createRequire(import.meta.url)
const ts = requireFromHere('typescript') as typeof TS
const FIXTURE = new URL('./fixtures/schema-prev.sql', import.meta.url)
const DB_DIR = new URL('../server/db/', import.meta.url)

/** `SHOW CREATE TABLE` statements (the fixture's format) → table → its column names. */
function snapshotColumns(sql: string): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>()
  for (const match of sql.matchAll(/^CREATE TABLE `([a-z0-9_]+)` \(\n([\s\S]*?)\n\) ENGINE/gm)) {
    const columns = new Set<string>()
    for (const line of match[2]!.split('\n')) {
      const column = /^ {2}`([a-z0-9_]+)` /.exec(line)
      if (column) columns.add(column[1]!)
    }
    tables.set(match[1]!, columns)
  }
  return tables
}

function walk(node: TS.Node, visit: (node: TS.Node) => void): void {
  visit(node)
  ts.forEachChild(node, child => walk(child, visit))
}

const stringArgument = (node: TS.Expression | undefined): string | null =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null

/**
 * `table.column` of every `ensureColumn(db, database, '<table>', '<column>', …)` call in the
 * sources, and the names of the identifiers a `for … of` walks (`for (… of x)`, `for (… of
 * x.filter(…))`) — an exported array counts only when the boot code walks it.
 */
function scanSources(sources: Array<[path: string, text: string]>): { ensured: Set<string>, walked: Set<string> } {
  const ensured = new Set<string>()
  const walked = new Set<string>()
  for (const [path, text] of sources) {
    walk(ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true), (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'ensureColumn') {
        const table = stringArgument(node.arguments[2])
        const column = stringArgument(node.arguments[3])
        if (table && column) ensured.add(`${table}.${column}`)
      }
      if (ts.isForOfStatement(node)) {
        let walkedOver: TS.Expression = node.expression
        if (ts.isCallExpression(walkedOver) && ts.isPropertyAccessExpression(walkedOver.expression)) walkedOver = walkedOver.expression.expression
        if (ts.isIdentifier(walkedOver)) walked.add(walkedOver.text)
      }
    })
  }
  return { ensured, walked }
}

/** A tuple's third element that starts with a SQL column type is a column definition, not an index. */
const COLUMN_TYPE = /^\s*(VARCHAR|CHAR|TINYINT|SMALLINT|MEDIUMINT|INT|BIGINT|DECIMAL|FLOAT|DOUBLE|BOOLEAN|TEXT|TINYTEXT|MEDIUMTEXT|LONGTEXT|BLOB|JSON|DATE|DATETIME|TIMESTAMP|TIME|YEAR|ENUM|SET)\b/i

/** `table.column` of the column arrays a module exports, restricted to the arrays named in `walked`. */
function arrayColumns(module: Record<string, unknown>, walked: Set<string>): Set<string> {
  const columns = new Set<string>()
  for (const [name, value] of Object.entries(module)) {
    if (!Array.isArray(value) || !walked.has(name)) continue
    for (const entry of value as unknown[]) {
      if (Array.isArray(entry)) {
        const [table, column, definition] = entry as unknown[]
        if (typeof table === 'string' && typeof column === 'string' && typeof definition === 'string' && COLUMN_TYPE.test(definition)) columns.add(`${table}.${column}`)
      } else if (entry && typeof entry === 'object') {
        const { table, column } = entry as { table?: unknown, column?: unknown }
        if (typeof table === 'string' && typeof column === 'string') columns.add(`${table}.${column}`)
      }
    }
  }
  return columns
}

/** Declared columns of tables the previous release has, that the table lacks and nothing adds. */
function unregisteredColumns(previous: Map<string, Set<string>>, declared: Map<string, Iterable<string>>, registered: Set<string>): string[] {
  const missing: string[] = []
  for (const [table, columns] of declared) {
    const before = previous.get(table)
    // A table the previous release does not have is created whole by its CREATE TABLE.
    if (!before) continue
    for (const column of columns) if (!before.has(column) && !registered.has(`${table}.${column}`)) missing.push(`${table}.${column}`)
  }
  return missing.sort()
}

/** Every `.ts` file under `server/db/` (the boot DDL, its migrations, the schema itself). */
function dbSources(): Array<[string, string]> {
  return (readdirSync(DB_DIR, { recursive: true }) as string[])
    .filter(name => name.endsWith('.ts'))
    .sort()
    .map(name => [`server/db/${name}`, readFileSync(new URL(name, DB_DIR), 'utf8')])
}

test('the detector: a column only in CREATE TABLE is reported; an ensureColumn call adds it; a commented-out call does not', () => {
  const previous = snapshotColumns('CREATE TABLE `tin` (\n  `id` int NOT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB')
  assert.deepEqual([...previous.get('tin')!], ['id'], 'the fixture parser reads column lines, not keys')
  const declared = new Map([['tin', ['id', 'dau_an']], ['bang_moi', ['id', 'ten']]])
  const call = "await ensureColumn(db, database, 'tin', 'dau_an', 'VARCHAR(255) NULL')"
  const registered = (text: string) => scanSources([['x.ts', text]]).ensured
  assert.deepEqual(unregisteredColumns(previous, declared, registered('')), ['tin.dau_an'], 'the CREATE TABLE line alone is not an upgrade path; a new table needs nothing')
  assert.deepEqual(unregisteredColumns(previous, declared, registered(call)), [])
  assert.deepEqual(unregisteredColumns(previous, declared, registered(`// ${call}\n/* ${call} */`)), ['tin.dau_an'], 'a commented-out call adds nothing')
  assert.deepEqual(unregisteredColumns(previous, declared, registered(`const prose = "${call}"`)), ['tin.dau_an'], 'a call inside a string adds nothing')
})

test('the detector: a column array counts only when the boot walks it, and only its column entries', () => {
  const module = {
    walkedObjects: [{ table: 'tin', column: 'a', nullableDefinition: 'INT NULL' }],
    walkedTuples: [['tin', 'b', 'VARCHAR(16) NULL'], ['tin', 'tin_b_idx', 'INDEX `tin_b_idx` (`b`)']],
    walkedIndexes: [{ table: 'tin', name: 'tin_c_idx', columns: ['c'] }],
    neverWalked: [{ table: 'tin', column: 'd' }],
  }
  const { walked } = scanSources([['x.ts', 'for (const m of walkedObjects) {}\nfor (const [t, c, d] of walkedTuples.filter(Boolean)) {}\nfor (const i of walkedIndexes) {}']])
  assert.deepEqual([...arrayColumns(module, walked)].sort(), ['tin.a', 'tin.b'])
})

test('every column schema.ts declares on a table of the previous release is in that table or added by a boot migration', (t) => {
  const sql = readFileSync(FIXTURE, 'utf8')
  const previous = snapshotColumns(sql)
  // Non-vacuity of the fixture parse: every table its header counts, each with its columns.
  assert.equal(previous.size, Number(/^-- tables: (\d+)$/m.exec(sql)?.[1]), 'the fixture parser and the fixture header disagree on the table count')
  for (const [table, columns] of previous) assert.ok(columns.size > 0, `the fixture parser read no column of ${table}`)

  const declared = new Map([...tablesFromSchema(schema as Record<string, unknown>, new Set())].map(([table, shape]) => [table, [...shape.columns.keys()]]))
  const { ensured, walked } = scanSources(dbSources())
  const registered = new Set([...ensured, ...arrayColumns(migrations as Record<string, unknown>, walked)])
  // Non-vacuity of the scan, and the pin: the registrations of the columns the 7dfed8c fixture
  // lacks (an older dump restored onto this release relies on them too), one long-standing
  // ensureColumn per source file kind, and the column arrays.
  for (const column of [
    'livestream_messages.flag_reason', 'articles.view_total_real', 'articles.view_total_fabricated', 'articles.view_total',
    'backups.offsite_status', 'media.scanned_source_path', 'reader_accounts.display_name_reserved',
    'article_comments.flag_reason', 'chat_sessions.detected_name', 'submissions.status',
    'chatbot_knowledge.canonical_question', 'analytics_page_view_events.visitor_token', 'analytics_noc_minute_aggregates.details_json',
  ]) assert.ok(registered.has(column), `no boot migration adds ${column} any more`)

  const added = [...declared].flatMap(([table, columns]) => previous.has(table) ? columns.filter(column => !previous.get(table)!.has(column)).map(column => `${table}.${column}`) : [])
  t.diagnostic(`columns this release adds to tables of the previous release: ${added.length} (${added.join(', ') || 'none'})`)
  assert.deepEqual(
    unregisteredColumns(previous, declared, registered), [],
    'a column declared in schema.ts and in its CREATE TABLE, but not added by any boot migration: the database of the release in production never gets it — add an ensureColumn in server/db/migrations-additive.ts',
  )
})
