/**
 * Booting a new release on the previous release's database keeps its rows — real MySQL.
 *
 * The container runs `init.ts` → `seed.ts` → server on EVERY start (Dockerfile CMD),
 * so every boot-time write in `server/db/migrations-additive.ts`, the DDL files under
 * `server/db/schema-tables/` and `server/db/seed.ts` runs again on every deploy and
 * every restart, against the agency's live data. The media-category wipe (Wave 0)
 * was one unconditional `UPDATE` in that path; nothing caught it because no suite
 * loaded an old database with real rows in it and booted the new code on top.
 *
 * This suite does exactly that:
 *
 *   1. loads `tests/fixtures/schema-prev.sql` — the schema the previous release's own
 *      `initDb()` builds, captured by `scripts/snapshot-schema.ts` (refresh: CI-CD.md);
 *   2. inserts representative rows into every table a boot migration touches and
 *      every table the seed writes. Both lists are DERIVED from the code (the exported
 *      migration arrays, helper calls and raw DML in `migrations-additive.ts` and
 *      `schema-tables/*.ts`; the `insert(…)`/`update(…)` targets of `seed.ts`), plus
 *      the tables those rows reference — so new code is covered without editing this
 *      file, and a table the generator cannot fill fails here by name. Hand-written
 *      rows trip the known one-time conversions, and give every seed-written table a
 *      row with a DEFAULT key and staff-edited values, so a seed upsert that
 *      overwrites staff data is a visible change;
 *   3. boots twice, exactly like the container (`init.ts`, then `seed.ts`, each its own
 *      process with a time limit) and compares every table, row by row and column by
 *      column:
 *        - boot 1: nothing may change except a write a DECLARED CONVERSION below
 *          covers — each one names its code (re-located by content, not line number)
 *          and why it may rewrite data. A row the seed adds must be one of the
 *          seed's own defaults by FULL natural key, read from the seed's data, and
 *          missing before the boot;
 *        - boot 2: nothing may change at all, in any table or column, nor the schema.
 *
 * A failure names the write: `media_items.category_id [id=1]: "1" → NULL`.
 *
 * Gated and self-cleaning like the other *-integration suites:
 *
 *   SCHEMA_UPGRADE_INTEGRATION=1 SCHEMA_UPGRADE_PORT=33069 SCHEMA_UPGRADE_PASSWORD=... \
 *     node --experimental-strip-types --experimental-test-module-mocks \
 *     --import ./scripts/ts-resolver.mjs --test tests/schema-upgrade-integration.test.ts
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test, { after, before } from 'node:test'
import { createRequire } from 'node:module'
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise'
import { getTableColumns, getTableName, type Table } from 'drizzle-orm'
import type * as TS from 'typescript'
import * as migrations from '../server/db/migrations-additive.ts'
import * as schema from '../server/db/schema.ts'
import { MODERATION_RULES_SEED, SEED_GROUPS, SEED_GROUP_SPECS, seedMarkerKey } from '../server/db/seed-groups.ts'
import { CHATBOT_SMALL_TALK_SEED } from '../server/data/chatbot-small-talk-seed.ts'
import { DEFAULT_TRANSLATIONS_SEED } from '../server/data/default-translations-seed.ts'
import { normalizeQuestion } from '../server/utils/chatbot/small-talk.ts'
import { DEFAULT_ROLE_PERMISSION_ARRAYS, evaluateInitializer, seedResources } from './_seed-source.ts'

const enabled = process.env.SCHEMA_UPGRADE_INTEGRATION === '1'
const host = process.env.SCHEMA_UPGRADE_HOST || '127.0.0.1'
const port = Number(process.env.SCHEMA_UPGRADE_PORT || 3306)
const user = process.env.SCHEMA_UPGRADE_USER || 'root'
const password = process.env.SCHEMA_UPGRADE_PASSWORD || ''
const runId = `${Date.now()}_${process.pid}`
const DB_NAME = `cdkt_upgrade_${runId}`
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/schema-prev.sql', import.meta.url))
const originalEnv = { ...process.env }

// One deployment's secrets, shared by both boots — generated per run, never printed.
const BOOT_SECRETS = {
  JWT_SECRET: randomBytes(32).toString('hex'),
  CHATBOT_ENCRYPTION_SECRET: randomBytes(32).toString('base64'),
  ANALYTICS_HMAC_SECRET: randomBytes(32).toString('hex'),
}

/** Never let a typo in the env point this at a real deployment. */
function assertDisposableDatabase(name: string) {
  assert.match(name, /^cdkt_upgrade_\d+_\d+$/)
  assert.notEqual(name, 'cdkt_admin')
  if (originalEnv.DB_NAME) assert.notEqual(name, originalEnv.DB_NAME)
}

/**
 * Exact values: dates, BIGINT, DECIMAL and JSON come back as the strings MySQL
 * holds, not through `Date`/`Number`/`JSON.parse` — a comparison through those
 * would hide exactly the precision and time-zone damage this suite looks for.
 */
async function open(options: { multipleStatements?: boolean } = {}): Promise<Connection> {
  assertDisposableDatabase(DB_NAME)
  const conn = await mysql.createConnection({
    host, port, user, password, database: DB_NAME,
    dateStrings: true, jsonStrings: true, supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false,
    multipleStatements: options.multipleStatements === true,
  })
  await conn.query("SET SESSION time_zone = '+00:00'")
  return conn
}

async function withConnection<T>(work: (conn: Connection) => Promise<T>): Promise<T> {
  const conn = await open()
  try {
    return await work(conn)
  } finally {
    await conn.end()
  }
}

// ── The boot, exactly as the container runs it ────────────────────────────────

/**
 * Both halves of a container start (Dockerfile CMD: `init.ts` → `seed.ts`) run as
 * their own processes, with a time limit. `init.ts` exits 1 when a migration throws.
 * In process, its connection would stay open (there is no try/finally around it),
 * and the test file would hang for minutes after the failure instead of reporting it.
 */
const BOOT_STEP_TIMEOUT_MS = 240_000

function runBootStep(script: 'server/db/init.ts' | 'server/db/seed.ts', extraEnv: Record<string, string> = {}) {
  assertDisposableDatabase(DB_NAME)
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--import', './scripts/ts-resolver.mjs', script],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: BOOT_STEP_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      env: {
        ...originalEnv,
        DB_HOST: host, DB_PORT: String(port), DB_USER: user, DB_PASSWORD: password, DB_NAME,
        ...BOOT_SECRETS,
        ...extraEnv,
      },
    },
  )
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
  assert.notEqual(result.signal, 'SIGKILL', `${script} did not finish within ${BOOT_STEP_TIMEOUT_MS / 1000} s\n${output}`)
  assert.equal(result.status, 0, `${script} failed (exit ${result.status})\n${output}`)
}

/** The `init.ts` half — what `npm run db:init` runs. */
function bootInit() {
  runBootStep('server/db/init.ts')
}

/**
 * The `seed.ts` half. The admin password is generated per run, checked with the
 * policy the seed enforces, and never printed.
 */
async function bootSeed() {
  const { passwordRejectionMessage } = await import('../server/utils/password-policy.ts')
  let adminPassword = ''
  for (let attempt = 0; attempt < 5 && !adminPassword; attempt += 1) {
    const candidate = `Qx7#${randomBytes(12).toString('base64url')}`
    if (!passwordRejectionMessage(candidate, { username: 'admin' })) adminPassword = candidate
  }
  assert.ok(adminPassword, 'could not generate a password satisfying the policy')
  runBootStep('server/db/seed.ts', { ADMIN_PASSWORD: adminPassword, ADMIN_EMAIL: 'upgrade@example.test' })
}

async function boot() {
  bootInit()
  await bootSeed()
}

// ── Schema introspection ──────────────────────────────────────────────────────

type ColumnInfo = {
  name: string
  dataType: string
  columnType: string
  nullable: boolean
  extra: string
  maxLength: number | null
  charset: string | null
  precision: number | null
  scale: number | null
  datetimePrecision: number | null
}
type ForeignKey = { table: string, name: string, columns: string[], refTable: string, refColumns: string[] }
type TableInfo = { columns: ColumnInfo[], primaryKey: string[] }
type SchemaInfo = { tables: Map<string, TableInfo>, foreignKeys: ForeignKey[] }

async function readSchema(conn: Connection): Promise<SchemaInfo> {
  const [columnRows] = await conn.query<RowDataPacket[]>(
    `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, EXTRA, CHARACTER_MAXIMUM_LENGTH,
            CHARACTER_SET_NAME, NUMERIC_PRECISION, NUMERIC_SCALE, DATETIME_PRECISION
     FROM information_schema.COLUMNS c
     WHERE c.TABLE_SCHEMA = DATABASE()
       AND c.TABLE_NAME IN (SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE')
     ORDER BY TABLE_NAME, ORDINAL_POSITION`,
  )
  const tables = new Map<string, TableInfo>()
  for (const row of columnRows) {
    const table = String(row.TABLE_NAME)
    if (!tables.has(table)) tables.set(table, { columns: [], primaryKey: [] })
    tables.get(table)!.columns.push({
      name: String(row.COLUMN_NAME),
      dataType: String(row.DATA_TYPE).toLowerCase(),
      columnType: String(row.COLUMN_TYPE).toLowerCase(),
      nullable: row.IS_NULLABLE === 'YES',
      extra: String(row.EXTRA ?? '').toLowerCase(),
      maxLength: row.CHARACTER_MAXIMUM_LENGTH === null ? null : Number(row.CHARACTER_MAXIMUM_LENGTH),
      charset: row.CHARACTER_SET_NAME === null ? null : String(row.CHARACTER_SET_NAME),
      precision: row.NUMERIC_PRECISION === null ? null : Number(row.NUMERIC_PRECISION),
      scale: row.NUMERIC_SCALE === null ? null : Number(row.NUMERIC_SCALE),
      datetimePrecision: row.DATETIME_PRECISION === null ? null : Number(row.DATETIME_PRECISION),
    })
  }
  const [pkRows] = await conn.query<RowDataPacket[]>(
    `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND INDEX_NAME = 'PRIMARY' ORDER BY TABLE_NAME, SEQ_IN_INDEX`,
  )
  for (const row of pkRows) tables.get(String(row.TABLE_NAME))?.primaryKey.push(String(row.COLUMN_NAME))
  const [fkRows] = await conn.query<RowDataPacket[]>(
    `SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
     ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`,
  )
  const byName = new Map<string, ForeignKey>()
  for (const row of fkRows) {
    const id = `${row.TABLE_NAME}.${row.CONSTRAINT_NAME}`
    if (!byName.has(id)) byName.set(id, { table: String(row.TABLE_NAME), name: String(row.CONSTRAINT_NAME), columns: [], refTable: String(row.REFERENCED_TABLE_NAME), refColumns: [] })
    byName.get(id)!.columns.push(String(row.COLUMN_NAME))
    byName.get(id)!.refColumns.push(String(row.REFERENCED_COLUMN_NAME))
  }
  return { tables, foreignKeys: [...byName.values()] }
}

/** Every table's DDL without the auto-increment counter (data, not schema). */
async function readDdl(conn: Connection): Promise<Record<string, string>> {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
  )
  const ddl: Record<string, string> = {}
  for (const row of rows) {
    const [create] = await conn.query<RowDataPacket[]>(`SHOW CREATE TABLE \`${String(row.name)}\``)
    ddl[String(row.name)] = String(create[0]?.['Create Table'] ?? '').replace(/ AUTO_INCREMENT=\d+/g, '')
  }
  return ddl
}

// ── Which tables a boot migration touches — derived from the code ─────────────

const MIGRATION_SOURCES = [
  'server/db/migrations-additive.ts',
  // `repairLegacyMediaUrls`, called from `applyAdditiveMigrations` (moved out in wave2 D-SCAN).
  'server/db/legacy-media-urls.ts',
  ...readdirSync(new URL('../server/db/schema-tables/', import.meta.url)).filter(name => name.endsWith('.ts')).sort().map(name => `server/db/schema-tables/${name}`),
]
const sourceCache = new Map<string, string>()
function readSource(path: string): string {
  if (!sourceCache.has(path)) sourceCache.set(path, readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'))
  return sourceCache.get(path)!
}

/**
 * Tables named by a boot migration step:
 *   - every entry of every array `migrations-additive.ts` exports (`{ table }`,
 *     `{ referencedTable }` or a `[table, …]` tuple) — the column/index/FK lists
 *     the convergence loops walk;
 *   - the literal table argument of every `ensureColumn`/`ensureIndex`/`modifyColumn`/
 *     `ensureForeignKeyIfMissing`/`ensureRequiredColumn` call in the boot sources;
 *   - the target of every raw `UPDATE`/`INSERT … INTO`/`DELETE FROM`/`REPLACE INTO`/
 *     `ALTER TABLE` statement in them (the data conversions).
 * Names that are not tables of the previous release are tables the new release
 * creates: nothing old to preserve, so they are returned separately.
 */
function tablesTouchedByBootMigrations(previousTables: Set<string>) {
  const named = new Set<string>()
  for (const value of Object.values(migrations) as unknown[]) {
    if (!Array.isArray(value)) continue
    for (const entry of value) {
      if (Array.isArray(entry) && typeof entry[0] === 'string') named.add(entry[0])
      else if (entry && typeof entry === 'object') {
        const { table, referencedTable } = entry as { table?: unknown, referencedTable?: unknown }
        if (typeof table === 'string') named.add(table)
        if (typeof referencedTable === 'string') named.add(referencedTable)
      }
    }
  }
  const helperCall = /\b(?:ensureColumn|ensureIndex|modifyColumn|ensureForeignKeyIfMissing|ensureRequiredColumn)\(\s*db\s*,\s*database\s*,\s*'([a-z0-9_]+)'/g
  const dataWrite = /\b(?:UPDATE|INSERT\s+(?:IGNORE\s+)?INTO|DELETE\s+FROM|REPLACE\s+INTO|ALTER\s+TABLE)\s+\\?`?([a-z_][a-z0-9_]*)/gi
  const created = /CREATE TABLE IF NOT EXISTS \\?`([a-z0-9_]+)\\?`/g
  const currentTables = new Set<string>()
  for (const path of MIGRATION_SOURCES) {
    const source = readSource(path)
    for (const match of source.matchAll(helperCall)) named.add(match[1]!)
    for (const match of source.matchAll(dataWrite)) named.add(match[1]!)
    for (const match of source.matchAll(created)) currentTables.add(match[1]!)
  }
  // Prose in comments can match too ("UPDATE về NULL"); only real table names count.
  return {
    touched: [...named].filter(name => previousTables.has(name)).sort(),
    newTables: [...named].filter(name => currentTables.has(name) && !previousTables.has(name)).sort(),
  }
}

// ── The seed's own default rows ───────────────────────────────────────────────
//
// "The boot inserted a default the seed defines" is decided against the seed's
// DATA, by each table's full natural key — never by a text search. Exported data is
// imported (translations, small talk, the once-per-database seed groups of
// `seed-groups.ts`). `seed.ts` runs itself on import and keeps its other defaults in
// local constants, so those constants are read with the TypeScript parser and
// evaluated as literals. A renamed or restructured constant fails here by name
// instead of quietly widening a declaration.

const SEED_SOURCE = 'server/db/seed.ts'
const LANGUAGES_SOURCE = 'server/services/languages.ts'
const NOT_A_LITERAL = Symbol('not a literal')
const requireFromHere = createRequire(import.meta.url)
let typescriptModule: typeof TS | undefined
const typescript = (): typeof TS => (typescriptModule ??= requireFromHere('typescript') as typeof TS)
const parsedSources = new Map<string, TS.SourceFile>()

function parsed(path: string): TS.SourceFile {
  const ts = typescript()
  if (!parsedSources.has(path)) parsedSources.set(path, ts.createSourceFile(path, readSource(path), ts.ScriptTarget.Latest, true))
  return parsedSources.get(path)!
}

function walk(node: TS.Node, visit: (node: TS.Node) => void) {
  visit(node)
  typescript().forEachChild(node, child => walk(child, visit))
}

/** Literal value of an expression; anything computed becomes `NOT_A_LITERAL`. */
function literalValue(node: TS.Expression): unknown {
  const ts = typescript()
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (node.kind === ts.SyntaxKind.NullKeyword) return null
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) return literalValue(node.expression)
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(element => literalValue(element))
  if (ts.isObjectLiteralExpression(node)) {
    const object: Record<string, unknown> = {}
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
        object[property.name.text] = literalValue(property.initializer)
      }
    }
    return object
  }
  return NOT_A_LITERAL
}

/** The one variable named `name` in `path`, evaluated as a literal. */
function declaredConstant(path: string, name: string): unknown {
  const ts = typescript()
  const found: TS.Expression[] = []
  walk(parsed(path), (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) found.push(node.initializer)
  })
  if (found.length !== 1) throw new Error(`${path} declares ${found.length} variables named ${name} — the upgrade suite reads the seed's defaults from it; update loadSeedData()`)
  return literalValue(found[0]!)
}

/** The node of function `name` in `path`. */
function functionNamed(path: string, name: string): TS.Node {
  const ts = typescript()
  let found: TS.Node | undefined
  walk(parsed(path), (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node
  })
  if (!found) throw new Error(`${path} has no function ${name} — update loadSeedData()`)
  return found
}

/** `X` of every `….insert(X)` / `….update(X)` / `….delete(X)` call under `root` (also `insert(schema.X)`). */
function writtenIdentifiers(root: TS.Node): string[] {
  const ts = typescript()
  const names = new Set<string>()
  walk(root, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)
      || !['insert', 'update', 'delete'].includes(node.expression.name.text) || node.arguments.length !== 1) return
    const target = node.arguments[0]!
    if (ts.isIdentifier(target)) names.add(target.text)
    else if (ts.isPropertyAccessExpression(target)) names.add(target.name.text)
  })
  return [...names].sort()
}

/** SQL tables written by raw SQL (`….execute(sql\`…\`)`, `….query('…')`) under `root`. */
function rawSqlWrittenTables(root: TS.Node): string[] {
  const ts = typescript()
  const tables = new Set<string>()
  const dataWrite = /\b(?:UPDATE|INSERT\s+(?:IGNORE\s+)?INTO|DELETE\s+FROM|REPLACE\s+INTO)\s+`?([a-z_][a-z0-9_]*)/gi
  walk(root, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || !['execute', 'query'].includes(node.expression.name.text)) return
    const first = node.arguments[0]
    if (!first) return
    const text = ts.isTaggedTemplateExpression(first) ? first.template.getText() : first.getText()
    for (const match of text.matchAll(dataWrite)) tables.add(match[1]!)
  })
  return [...tables].sort()
}

/** The literal argument of every `….insert(<identifier>).values(…)` call in `path`. */
function insertedValues(path: string, identifier: string): unknown[] {
  const ts = typescript()
  const values: unknown[] = []
  walk(parsed(path), (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== 'values') return
    const target = node.expression.expression
    if (ts.isCallExpression(target) && ts.isPropertyAccessExpression(target.expression) && target.expression.name.text === 'insert'
      && ts.isIdentifier(target.arguments[0]!) && target.arguments[0].text === identifier && node.arguments[0]) {
      values.push(literalValue(node.arguments[0]))
    }
  })
  if (values.length === 0) throw new Error(`${path} has no insert(${identifier}).values(…) — update loadSeedData()`)
  return values
}

function stringsOf(value: unknown, field: string | number, where: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${where} is not a literal array — update loadSeedData()`)
  return value.map((entry) => {
    const item = (entry as Record<string | number, unknown> | undefined)?.[field]
    if (typeof item !== 'string' && typeof item !== 'number') throw new Error(`${where}[].${field} is not a literal — update loadSeedData()`)
    return String(item)
  })
}

/**
 * The once-per-database seed groups' defaults (wave2 D7), as SQL column → value —
 * read through each spec's own `toInsert`, the exact object `applySeedGroups` hands
 * to `insert(…).values(…)`. The data is importable (unlike `seed.ts`, which runs on
 * import), so it is read as data, not parsed.
 */
let groupDefaultRowsCache: Array<{ group: string, table: string, key: string, values: Record<string, unknown> }> | undefined
function groupDefaultRows() {
  if (groupDefaultRowsCache) return groupDefaultRowsCache
  const rows: Array<{ group: string, table: string, key: string, values: Record<string, unknown> }> = []
  for (const spec of SEED_GROUP_SPECS) {
    const columns = new Map(Object.entries(getTableColumns(spec.table)).map(([property, column]) => [property, column.name]))
    const allRows = [...spec.sets].sort((a, b) => a.version - b.version).flatMap(set => set.rows as readonly unknown[])
    for (const row of allRows) {
      const values: Record<string, unknown> = {}
      for (const [property, value] of Object.entries((spec.toInsert as (r: unknown, all: readonly unknown[]) => Record<string, unknown>)(row, allRows))) {
        const column = columns.get(property)
        if (!column) throw new Error(`seed group ${spec.name} writes ${property}, which is not a column of ${getTableName(spec.table)}`)
        values[column] = value
      }
      rows.push({ group: spec.name, table: getTableName(spec.table), key: (spec.keyOf as (r: unknown) => string)(row), values })
    }
  }
  groupDefaultRowsCache = rows
  return rows
}

type SeedData = {
  /** SQL tables `seed.ts` (and the languages seed it calls) insert into or update. */
  writtenTables: string[]
  /** usernames in seed.ts's `insert(users).values(…)` — must stay exactly `admin` */
  seededAccounts: string[]
  /** table → natural keys of the rows the seed may add. `page_blocks` of `home` are added per database (copied from home_sections). */
  keys: Map<string, Set<string>>
  /** table → natural key → every column the seed writes for that default row, with its value */
  contents: DefaultContents
  /** every `seed.<group>.v<N>.done` marker the seed groups write (wave2 D7). */
  markerKeys: Set<string>
  pricingModels: string[]
  moderationRules: Array<{ category: string, pattern: string }>
}
let seedDataCache: SeedData | undefined

function loadSeedData(): SeedData {
  if (seedDataCache) return seedDataCache
  const tableNames = new Map<string, string>()
  for (const [name, value] of Object.entries(schema)) {
    if (value && typeof value === 'object' && Symbol.for('drizzle:Name') in (value as object)) tableNames.set(name, getTableName(value as Table))
  }
  const toTable = (identifier: string) => {
    const table = tableNames.get(identifier)
    if (!table) throw new Error(`the seed writes ${identifier}, which is not a table export of server/db/schema.ts`)
    return table
  }
  const languagesSeed = functionNamed(LANGUAGES_SOURCE, 'seedDefaultLanguagesAndTranslations')
  // Every group the seed runs once per database (wave2 D7) is one of these specs — a new
  // group must say how its rows are recognised here.
  if (SEED_GROUPS.map(group => group.name).sort().join() !== SEED_GROUP_SPECS.map(spec => spec.name).sort().join()) {
    throw new Error('SEED_GROUPS changed — add the new group spec to SEED_GROUP_SPECS')
  }
  const groupKeys = (name: string) => new Set(groupDefaultRows().filter(row => row.group === name).map(row => row.key))
  const writtenTables = [...new Set([
    ...[...writtenIdentifiers(parsed(SEED_SOURCE)), ...writtenIdentifiers(languagesSeed)].map(toTable),
    ...rawSqlWrittenTables(parsed(SEED_SOURCE)),
    ...rawSqlWrittenTables(languagesSeed),
    // `applySeedGroups` writes each group's table and its markers in `settings`.
    ...SEED_GROUP_SPECS.map(spec => getTableName(spec.table)),
    'settings',
  ])].sort()

  const roles = insertedValues(SEED_SOURCE, 'roles').flatMap(value => stringsOf(value, 'name', 'insert(roles).values'))
  const resources = stringsOf((declaredConstant(SEED_SOURCE, 'RESOURCES') as unknown[]).map(resource => ({ resource })), 'resource', 'RESOURCES')
  const block = (name: string, page: string) => {
    const blocks = declaredConstant(SEED_SOURCE, name) as Array<Record<string, unknown>>
    const types = stringsOf(blocks, 'blockType', name)
    const orders = stringsOf(blocks, 'displayOrder', name)
    return types.map((type, i) => `${page}|${type}|${orders[i]}`)
  }
  const seededAccounts = insertedValues(SEED_SOURCE, 'users').map(value => String((value as Record<string, unknown>).username))
  const keys = new Map<string, Set<string>>([
    // Pinned, not read from the seed: the one account a boot may ever create is
    // `admin`. Another account added to seed.ts is a security change to review —
    // it must fail here, not become a "default" by being in the seed's data.
    ['users', new Set(['admin'])],
    ['roles', new Set(roles)],
    ['permissions', new Set(roles.flatMap(role => resources.map(resource => `${role}|${resource}`)))],
    ['home_sections', new Set(stringsOf(declaredConstant(SEED_SOURCE, 'defaultSections'), 'type', 'defaultSections'))],
    ['settings', new Set(stringsOf(declaredConstant(SEED_SOURCE, 'defaultSettings'), 'key', 'defaultSettings'))],
    ['content_types', groupKeys('content_types')],
    ['categories', groupKeys('categories')],
    ['media_categories', groupKeys('media_categories')],
    ['pages', new Set(stringsOf(declaredConstant(SEED_SOURCE, 'DEFAULT_PAGES'), 'slug', 'DEFAULT_PAGES'))],
    ['page_blocks', new Set([...block('aboutBlocks', 'about'), ...block('contactBlocks', 'contact')])],
    ['chatbot_settings', new Set(insertedValues(SEED_SOURCE, 'chatbotSettings').map(value => String((value as Record<string, unknown>).id)))],
    ['chatbot_small_talk', new Set(CHATBOT_SMALL_TALK_SEED.map(entry => normalizeQuestion(entry.question)))],
    ['ai_model_pricing', new Set(stringsOf(declaredConstant(SEED_SOURCE, 'defaultPricing'), 'model', 'defaultPricing'))],
    ['ai_service_configs', new Set(stringsOf(declaredConstant(SEED_SOURCE, 'defaultServices'), 'serviceKey', 'defaultServices'))],
    ['ai_budget_settings', new Set(insertedValues(SEED_SOURCE, 'aiBudgetSettings').map(value => String((value as Record<string, unknown>).id)))],
    ['ai_providers', new Set(stringsOf(declaredConstant(SEED_SOURCE, 'defaultProviders'), 'provider', 'defaultProviders'))],
    ['ai_moderation_rules', groupKeys('moderation_rules')],
    ['social_links', groupKeys('social_links')],
    ['languages', new Set(stringsOf(declaredConstant(LANGUAGES_SOURCE, 'DEFAULT_LANGUAGES'), 'code', 'DEFAULT_LANGUAGES'))],
    ['lang_translations', new Set(DEFAULT_TRANSLATIONS_SEED.flatMap(item =>
      Object.entries(item.values).filter(([, value]) => value).map(([lang]) => `${lang}|${item.group}|${item.key}`)))],
  ])
  const missing = writtenTables.filter(table => !keys.has(table))
  if (missing.length) throw new Error(`the seed writes ${missing.join(', ')} — say how a default row of it is recognised in loadSeedData()`)
  const contents = collectDefaults(
    [
      ...seedInsertRows(SEED_SOURCE, parsed(SEED_SOURCE)),
      ...seedInsertRows(LANGUAGES_SOURCE, languagesSeed),
      ...groupDefaultRows().map(({ table, values }) => ({ table, values })),
    ],
    // The languages seed skips an empty translation (`if (!value) continue`).
    (table, values) => table === 'lang_translations' && !values.value,
  )
  // The DDL files are DDL only since wave2 D7: no INSERT is left for ddlDefaultRows to find.
  for (const path of ['server/db/schema-tables/core.ts', 'server/db/schema-tables/content.ts']) {
    if (ddlDefaultRows(path).length) throw new Error(`${path} inserts default rows again — the once-per-database groups live in server/db/seed-groups.ts (wave2 D7)`)
  }
  seedDataCache = {
    writtenTables,
    seededAccounts,
    keys,
    contents,
    markerKeys: new Set(SEED_GROUPS.flatMap(group => group.sets.map(set => seedMarkerKey(group.name, set.version)))),
    pricingModels: [...keys.get('ai_model_pricing')!],
    moderationRules: MODERATION_RULES_SEED.sets.flatMap(set => set.rows).map(rule => ({ category: rule.category, pattern: rule.pattern })),
  }
  return seedDataCache
}

const KEY_COLUMN: Record<string, string> = {
  users: 'username', roles: 'name', settings: 'key', home_sections: 'type', content_types: 'slug', categories: 'slug',
  media_categories: 'slug', pages: 'slug', chatbot_settings: 'id', chatbot_small_talk: 'normalized_question',
  ai_model_pricing: 'model', ai_service_configs: 'service_key', ai_budget_settings: 'id', ai_providers: 'provider',
  ai_moderation_rules: 'pattern', social_links: 'platform', languages: 'code',
}

/** A row's natural key as the seed identifies it; parent rows are looked up in the same snapshot. */
function naturalKey(table: string, row: Cells, snap: Snapshot): string | null {
  const parent = (parentTable: string, id: string | null | undefined, column: string) =>
    id == null ? null : snap.get(parentTable)?.rows.get(`id=${id}`)?.[column] ?? null
  if (table === 'permissions') {
    const role = parent('roles', row.role_id, 'name')
    return role === null ? null : `${role}|${row.resource}`
  }
  if (table === 'page_blocks') {
    const page = parent('pages', row.page_id, 'slug')
    return page === null ? null : `${page}|${row.block_type}|${row.display_order}`
  }
  if (table === 'lang_translations') return `${row.lang_code}|${row.group}|${row.key}`
  const column = KEY_COLUMN[table]
  return column ? row[column] ?? null : null
}

// ── The seed's default rows, with every column it writes ─────────────────────
//
// Each `insert(T).values(…)` call of the seed is evaluated with its `for … of`
// loop variables bound to the seed's own constants, so a default row is known with
// exactly the columns the seed writes and the values it writes. Values the seed
// computes at run time (a password hash, an e-mail from the environment) are
// NOT_A_LITERAL and are not compared. Rows the seed copies from the database (the
// home page's blocks) are not evaluated here — see `expectedContent`.

/** A reference the seed resolves in the database at run time: `@role:<name>`, `@page:<slug>`. */
const REF = /^@(role|page):(.+)$/
const NO_VALUE = Symbol('no binding')

type Bindings = Map<string, unknown>

function evaluateExpression(node: TS.Expression, env: Bindings, resolve: (name: string) => unknown): unknown {
  const ts = typescript()
  const known = (value: unknown) => value !== NOT_A_LITERAL
  if (ts.isIdentifier(node)) return env.has(node.text) ? env.get(node.text) : resolve(node.text)
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) return evaluateExpression(node.expression, env, resolve)
  if (ts.isPropertyAccessExpression(node)) {
    const base = evaluateExpression(node.expression, env, resolve)
    return base && typeof base === 'object' && known(base) ? (base as Record<string, unknown>)[node.name.text] : NOT_A_LITERAL
  }
  if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)) {
    const left = evaluateExpression(node.left, env, resolve)
    if (!known(left)) return NOT_A_LITERAL
    const useRight = node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ? left == null : !left
    return useRight ? evaluateExpression(node.right, env, resolve) : left
  }
  if (ts.isArrayLiteralExpression(node)) {
    const items: unknown[] = []
    for (const element of node.elements) {
      if (ts.isSpreadElement(element)) {
        const spread = evaluateExpression(element.expression, env, resolve)
        if (!Array.isArray(spread)) return NOT_A_LITERAL
        items.push(...spread)
      } else {
        items.push(evaluateExpression(element, env, resolve))
      }
    }
    return items
  }
  if (ts.isObjectLiteralExpression(node)) {
    const object: Record<string, unknown> = {}
    for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) {
        const spread = evaluateExpression(property.expression, env, resolve)
        if (!spread || typeof spread !== 'object' || !known(spread)) return NOT_A_LITERAL
        Object.assign(object, spread)
      } else if (ts.isShorthandPropertyAssignment(property)) {
        object[property.name.text] = evaluateExpression(property.name, env, resolve)
      } else if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
        object[property.name.text] = evaluateExpression(property.initializer, env, resolve)
      }
    }
    return object
  }
  if (ts.isCallExpression(node)) {
    const callee = node.expression
    if (ts.isPropertyAccessExpression(callee)) {
      const method = callee.name.text
      if (ts.isIdentifier(callee.expression) && callee.expression.text === 'Object' && method === 'entries') {
        const target = evaluateExpression(node.arguments[0]!, env, resolve)
        return target && typeof target === 'object' && known(target) ? Object.entries(target) : NOT_A_LITERAL
      }
      const base = evaluateExpression(callee.expression, env, resolve)
      if (Array.isArray(base) && method === 'slice') return base // the seed inserts in batches; every batch is a default
      if (Array.isArray(base) && method === 'indexOf') return base.indexOf(evaluateExpression(node.arguments[0]!, env, resolve))
    }
    return NOT_A_LITERAL
  }
  return literalValue(node)
}

/**
 * What an identifier in a seed source means: a binding of an enclosing loop
 * (handled by the caller), an imported data constant, one of the initializers that
 * only `vm` can evaluate (`tests/_seed-source.ts`), a database lookup of a role or a
 * page, or a literal constant.
 */
function seedResolver(path: string): (name: string) => unknown {
  const ts = typescript()
  const cache = new Map<string, unknown>()
  const source = readSource(path)
  const roleStubs = Object.fromEntries(Object.keys(DEFAULT_ROLE_PERMISSION_ARRAYS).map(role => [`${role}Role`, { id: `@role:${role}`, name: role }]))
  const vmConstants: Record<string, () => unknown> = {
    smallTalkRows: () => evaluateInitializer(source, 'smallTalkRows', { CHATBOT_SMALL_TALK_SEED, normalizeQuestion }, path),
  }
  for (const variable of Object.values(DEFAULT_ROLE_PERMISSION_ARRAYS)) {
    vmConstants[variable] = () => evaluateInitializer(source, variable, { RESOURCES: seedResources(source), ...roleStubs }, path)
  }
  const imports: Record<string, unknown> = { DEFAULT_TRANSLATIONS_SEED, CHATBOT_SMALL_TALK_SEED }
  return (name: string) => {
    if (cache.has(name)) return cache.get(name)
    let value: unknown = NOT_A_LITERAL
    if (name in imports) value = imports[name]
    else if (vmConstants[name]) value = vmConstants[name]!()
    else {
      const declarations: TS.VariableDeclaration[] = []
      walk(parsed(path), (node) => {
        if (!ts.isVariableDeclaration(node)) return
        if (ts.isIdentifier(node.name) && node.name.text === name) declarations.push(node)
        if (ts.isArrayBindingPattern(node.name) && node.name.elements.some(element => ts.isBindingElement(element) && ts.isIdentifier(element.name) && element.name.text === name)) declarations.push(node)
      })
      const initializer = declarations.length === 1 ? declarations[0]!.initializer : undefined
      const text = initializer?.getText() ?? ''
      const literal = /=== '([^']+)'|eq\(pages\.slug, '([^']+)'\)/.exec(text)
      if (initializer && /allRoles\.find\(/.test(text) && literal?.[1]) value = { id: `@role:${literal[1]}`, name: literal[1] }
      else if (initializer && /\.from\(pages\)/.test(text) && literal?.[2]) value = { id: `@page:${literal[2]}`, slug: literal[2] }
      else if (initializer && ts.isIdentifier(declarations[0]!.name)) value = literalValue(initializer)
    }
    cache.set(name, value)
    return value
  }
}

/** Drizzle property → SQL column, for one table identifier of server/db/schema.ts. */
function columnNames(identifier: string): { table: string, columns: Map<string, string> } {
  const table = (schema as Record<string, unknown>)[identifier] as Table | undefined
  if (!table) throw new Error(`${identifier} is not a table export of server/db/schema.ts`)
  return { table: getTableName(table), columns: new Map(Object.entries(getTableColumns(table)).map(([property, column]) => [property, column.name])) }
}

/** Whether `node` reads one of `bindings` (property names and member names do not count). */
function readsBinding(node: TS.Node, bindings: Set<string>): boolean {
  const ts = typescript()
  let found = false
  walk(node, (child) => {
    if (!ts.isIdentifier(child) || !bindings.has(child.text)) return
    const parent = child.parent
    if (parent && ts.isPropertyAccessExpression(parent) && parent.name === child) return
    if (parent && (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) && parent.name === child) return
    found = true
  })
  return found
}

/**
 * The oracle is the seed's DATA as stored, so an insert must copy it plainly: a
 * literal, `loopVar.field` (optionally `?? literal`), a spread or a binding of the
 * loop, `CONST.indexOf(loopVar)`, or a run-time value that does not touch the
 * default data (a role or page looked up, the hashed password, the environment).
 * Anything else that reads the default data — `\`${value} …\``, `{ ...b.data, … }`,
 * `value.trim()` — transforms the default at insert time, and the suite refuses it
 * by name: whoever adds it decides what the stored default is.
 */
function assertPlainCopy(path: string, table: string, argument: TS.Expression, bindings: Set<string>) {
  const ts = typescript()
  const unwrap = (node: TS.Expression): TS.Expression => (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) ? unwrap(node.expression) : node)
  // Strict: every nested element is itself a literal — no spread, no shorthand, no identifier.
  const isLiteral = (node: TS.Expression): boolean => {
    const inner = unwrap(node)
    if (ts.isArrayLiteralExpression(inner)) return inner.elements.every(element => !ts.isSpreadElement(element) && isLiteral(element))
    if (ts.isObjectLiteralExpression(inner)) return inner.properties.every(property => ts.isPropertyAssignment(property) && isLiteral(property.initializer))
    return literalValue(inner) !== NOT_A_LITERAL
  }
  const isDataField = (node: TS.Expression): boolean => {
    const inner = unwrap(node)
    if (ts.isIdentifier(inner)) return bindings.has(inner.text)
    return ts.isPropertyAccessExpression(inner) && isDataField(inner.expression)
  }
  const plain = (node: TS.Expression): boolean => {
    const inner = unwrap(node)
    if (isLiteral(inner) || isDataField(inner) || !readsBinding(inner, bindings)) return true
    if (ts.isBinaryExpression(inner) && inner.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) return isDataField(inner.left) && isLiteral(inner.right)
    if (ts.isCallExpression(inner) && ts.isPropertyAccessExpression(inner.expression) && inner.expression.name.text === 'indexOf') return !readsBinding(inner.expression.expression, bindings) && inner.arguments.every(isDataField)
    return false
  }
  const inner = unwrap(argument)
  const properties = ts.isObjectLiteralExpression(inner) ? inner.properties : []
  if (!ts.isObjectLiteralExpression(inner) && !plain(inner) && !(ts.isCallExpression(inner) && ts.isPropertyAccessExpression(inner.expression) && inner.expression.name.text === 'slice')) {
    throw new Error(`${path}: insert(${table}).values(${inner.getText()}) — the default data is transformed at insert time; insert it as stored, or teach the upgrade suite what the stored default is`)
  }
  for (const property of properties) {
    const value = ts.isSpreadAssignment(property) ? property.expression : ts.isPropertyAssignment(property) ? property.initializer : ts.isShorthandPropertyAssignment(property) ? property.name : undefined
    if (!value) continue
    if (ts.isSpreadAssignment(property) ? isDataField(value) : plain(value)) continue
    throw new Error(`${path}: insert(${table}) writes ${property.getText()} — the seed's default data is transformed at insert time; insert it as stored, or teach the upgrade suite what the stored default is`)
  }
}

/** Every default row an `insert(T).values(…)` under `root` writes, as SQL column → value. */
function seedInsertRows(path: string, root: TS.Node): Array<{ table: string, values: Record<string, unknown> }> {
  const ts = typescript()
  const resolve = seedResolver(path)
  const rows: Array<{ table: string, values: Record<string, unknown> }> = []
  walk(root, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== 'values' || !node.arguments[0]) return
    const target = node.expression.expression
    if (!ts.isCallExpression(target) || !ts.isPropertyAccessExpression(target.expression) || target.expression.name.text !== 'insert') return
    const tableNode = target.arguments[0]!
    const { table, columns } = columnNames(ts.isPropertyAccessExpression(tableNode) ? tableNode.name.text : tableNode.getText())
    const loops: TS.ForOfStatement[] = []
    for (let parent: TS.Node | undefined = node.parent; parent; parent = parent.parent) if (ts.isForOfStatement(parent)) loops.unshift(parent)
    const bindingNames = new Set(loops.flatMap((loop) => {
      const name = (loop.initializer as TS.VariableDeclarationList).declarations[0]!.name
      return ts.isIdentifier(name) ? [name.text] : ts.isArrayBindingPattern(name)
        ? name.elements.flatMap(element => (ts.isBindingElement(element) && ts.isIdentifier(element.name) ? [element.name.text] : []))
        : []
    }))
    assertPlainCopy(path, table, node.arguments[0] as TS.Expression, bindingNames)
    const expand = (depth: number, env: Bindings) => {
      if (depth === loops.length) {
        const value = evaluateExpression(node.arguments[0] as TS.Expression, env, resolve)
        for (const row of Array.isArray(value) ? value : [value]) {
          if (!row || typeof row !== 'object' || row === NOT_A_LITERAL) continue
          const values: Record<string, unknown> = {}
          for (const [property, item] of Object.entries(row)) if (columns.has(property)) values[columns.get(property)!] = item
          rows.push({ table, values })
        }
        return
      }
      const loop = loops[depth]!
      const iterable = evaluateExpression(loop.expression, env, resolve)
      if (!Array.isArray(iterable)) return // iterates rows read from the database (the home page's sections)
      const binding = (loop.initializer as TS.VariableDeclarationList).declarations[0]!.name
      for (const item of iterable) {
        const next = new Map(env)
        if (ts.isIdentifier(binding)) next.set(binding.text, item)
        else if (ts.isArrayBindingPattern(binding)) {
          binding.elements.forEach((element, i) => {
            if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) next.set(element.name.text, Array.isArray(item) ? item[i] : NO_VALUE)
          })
        }
        expand(depth + 1, next)
      }
    }
    expand(0, new Map())
  })
  return rows
}

/** The natural key of a default row as the seed writes it (references are `@role:`/`@page:`). */
function defaultRowKey(table: string, values: Record<string, unknown>): string | null {
  const ref = (value: unknown) => REF.exec(String(value))?.[2] ?? null
  if (table === 'permissions') return `${ref(values.role_id)}|${values.resource}`
  if (table === 'page_blocks') return `${ref(values.page_id)}|${values.block_type}|${values.display_order}`
  if (table === 'lang_translations') return `${values.lang_code}|${values.group}|${values.key}`
  const column = KEY_COLUMN[table]
  return column && values[column] != null ? String(values[column]) : null
}

type DefaultContents = Map<string, Map<string, Record<string, unknown>>>

function collectDefaults(rows: Array<{ table: string, values: Record<string, unknown> }>, skip: (table: string, values: Record<string, unknown>) => boolean = () => false): DefaultContents {
  const contents: DefaultContents = new Map()
  for (const { table, values } of rows) {
    if (skip(table, values)) continue
    const key = defaultRowKey(table, values)
    if (key === null) throw new Error(`a default row of ${table} has no natural key: ${JSON.stringify(values)}`)
    if (!contents.has(table)) contents.set(table, new Map())
    if (contents.get(table)!.has(key)) throw new Error(`the seed writes the default ${table} [${key}] twice`)
    contents.get(table)!.set(key, values)
  }
  return contents
}

/** The DDL files' default inserts: `INSERT INTO t (cols) VALUES (?, …, literal)` with the loop's tuple as parameters. */
function ddlDefaultRows(path: string): Array<{ table: string, values: Record<string, unknown> }> {
  const ts = typescript()
  const resolve = seedResolver(path)
  const rows: Array<{ table: string, values: Record<string, unknown> }> = []
  walk(parsed(path), (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== 'query' || node.arguments.length < 2) return
    const sqlNode = node.arguments[0]!
    const sqlText = ts.isNoSubstitutionTemplateLiteral(sqlNode) || ts.isStringLiteral(sqlNode) ? sqlNode.text : ''
    const insert = /INSERT INTO `([a-z_]+)` \(([^)]*)\)\s*VALUES \(([^)]*)\)/.exec(sqlText)
    if (!insert) return
    const columns = insert[2]!.split(',').map(column => column.trim().replace(/`/g, ''))
    const placeholders = insert[3]!.split(',').map(value => value.trim())
    let loop: TS.Node | undefined = node.parent
    while (loop && !ts.isForOfStatement(loop)) loop = loop.parent
    if (!loop || !ts.isForOfStatement(loop)) return
    const binding = (loop.initializer as TS.VariableDeclarationList).declarations[0]!.name
    const tuples = evaluateExpression(loop.expression, new Map(), resolve)
    if (!Array.isArray(tuples) || !ts.isArrayBindingPattern(binding)) throw new Error(`${path}: the default INSERT INTO ${insert[1]} is not a loop over a literal tuple list — update ddlDefaultRows()`)
    for (const tuple of tuples) {
      const env: Bindings = new Map()
      binding.elements.forEach((element, i) => { if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) env.set(element.name.text, (tuple as unknown[])[i]) })
      const parameters = evaluateExpression(node.arguments[1] as TS.Expression, env, resolve) as unknown[]
      let next = 0
      const values: Record<string, unknown> = {}
      columns.forEach((column, i) => {
        const placeholder = placeholders[i]!
        values[column] = placeholder === '?' ? parameters[next++] : placeholder.toUpperCase() === 'NULL' ? null : Number(placeholder)
      })
      rows.push({ table: insert[1]!, values })
    }
  })
  return rows
}

type ReferenceOf = (kind: 'role' | 'page', id: string | null) => string | null

/**
 * Same value? `expected` is what the seed writes (JS value, NOT_A_LITERAL when
 * unknown); `cell` is the database text. `referenceOf(kind, id)` names the role or
 * page a foreign key points at, for the seed's `@role:`/`@page:` references.
 */
function sameAsDefault(expected: unknown, cell: string | null, referenceOf: ReferenceOf): boolean | 'unknown' {
  const containsUnknown = (value: unknown): boolean => value === NOT_A_LITERAL || value === NO_VALUE
    || (Array.isArray(value) ? value.some(containsUnknown) : !!value && typeof value === 'object' && Object.values(value).some(containsUnknown))
  if (containsUnknown(expected)) return 'unknown'
  if (expected === undefined || expected === null) return cell === null
  if (typeof expected === 'boolean') return cell === (expected ? '1' : '0')
  if (typeof expected === 'number') return cell !== null && Number(cell) === expected
  if (typeof expected === 'string') {
    const ref = REF.exec(expected)
    if (ref) return referenceOf(ref[1] as 'role' | 'page', cell) === ref[2]
    if (cell === expected) return true
    return cell !== null && /^-?\d+(\.\d+)?$/.test(expected) && /^-?\d+(\.\d+)?$/.test(cell) && Number(cell) === Number(expected)
  }
  if (cell === null) return false
  try {
    const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
      : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])])) : value
    return JSON.stringify(canonical(JSON.parse(cell))) === JSON.stringify(canonical(expected))
  } catch {
    return false
  }
}

/** Columns that identify a default row — they are its key, never "staff-edited". */
const KEY_PARTS: Record<string, string[]> = {
  permissions: ['role_id', 'resource'], page_blocks: ['page_id', 'block_type', 'display_order'], lang_translations: ['lang_code', 'group', 'key'],
}
const keyColumns = (table: string) => KEY_PARTS[table] ?? (KEY_COLUMN[table] ? [KEY_COLUMN[table]!] : [])

// ── Representative rows ───────────────────────────────────────────────────────

type SqlValue = string | number | Buffer | null
type Row = Record<string, SqlValue>
type SeedOverride = { count?: number, why: string, row: (i: number) => Row }

/**
 * Hand-written rows, where a generated value would not be representative or a
 * known one-time conversion should actually fire (so boot 2 can prove it stays
 * done). Every other column of these tables, and every other table, is generated.
 *
 * Every table the seed writes carries at least one row with a DEFAULT key and
 * staff-edited values: the seed upserts on those keys, so an upsert that
 * overwrites a staff value is a visible cell change here, not an invisible insert.
 * The values below only set the scene; `editDefaultRowsLikeStaff` then moves EVERY
 * column the seed writes away from the seed's own value, and the seeding test checks it.
 */
const SEED_OVERRIDES: Record<string, SeedOverride> = {
  chatbot_settings: {
    count: 1,
    why: 'singleton row id 1, as on every deployment; a provider is configured but the mode is "knowledge" — the "ai" upgrade is guarded on the mode column being NEW, so a lost guard flips it',
    row: () => ({ id: 1, enabled: 1, provider_policy: 'openai-compatible', base_url: 'https://api.example.test/v1', model: 'gpt-4o-mini', mode: 'knowledge' }),
  },
  users: {
    why: 'the production admin account exists; the seed must leave its hash alone',
    // A bcrypt-shaped placeholder (60 characters), not the hash of any password.
    row: i => (i === 0 ? { username: 'admin', password_hash: `$2b$12$${'x'.repeat(53)}` } : {}),
  },
  roles: {
    why: 'two of the four default roles exist (superadmin re-described by staff), one custom role; the seed adds the missing defaults only',
    row: i => [{ name: 'superadmin', description: 'Toàn quyền — mô tả cán bộ đã sửa' }, { name: 'editor' }, { name: 'biên tập viên địa phương' }][i]!,
  },
  permissions: {
    why: 'superadmin\'s right to delete news withdrawn by staff (a default (role, resource) pair the seed upserts on); rows 2–3 are the other roles\' custom resources',
    row: i => (i === 0 ? { resource: 'news', can_delete: 0, can_publish: 0 } : {}),
  },
  settings: {
    count: 4,
    why: 'staff-edited values of keys the seed also defaults — the seed is insert-only; r2_public_url is the R2 domain repairLegacyMediaUrls repairs `localhost:3000/<domain>` URLs to (wave2 D-SCAN: configured, no longer hard-coded)',
    row: i => ({
      key: ['site_name', 'hotline', 'sitemap_note', 'r2_public_url'][i]!,
      value: ['Con Đường Hướng Thiện — C11 (đã sửa)', '0912.345.678', null, 'https://cdn1.delify.vn/'][i]!,
      group: ['general', 'contact', 'general', 'media'][i]!,
    }),
  },
  home_sections: {
    why: 'two default section types reordered and hidden by staff, one custom section',
    row: i => [
      { type: 'hero', display_order: 9, is_visible: 0, config: '{"title": "Biểu ngữ cán bộ đã sửa"}' },
      { type: 'stats', display_order: 1, is_visible: 1, config: '{"stats": []}' },
      { type: 'thong_bao_c11', display_order: 5, is_visible: 1, config: '{"title": "Thông báo"}' },
    ][i]!,
  },
  pages: {
    why: 'the system page "about" retitled by staff; the other two are custom pages',
    row: i => (i === 0 ? { slug: 'about', title: 'Giới thiệu (cán bộ đã sửa)' } : {}),
  },
  page_blocks: {
    why: 'the "about" page already has a staff-written block, so the seed must not add its default blocks there',
    row: i => (i === 0 ? { block_type: 'heading', display_order: 1, data: '{"text": "Giới thiệu — cán bộ viết lại"}' } : {}),
  },
  content_types: {
    why: 'the default content type "news" renamed by staff',
    row: i => (i === 0 ? { slug: 'news', name: 'Tin tức C11 (đã sửa)' } : {}),
  },
  categories: {
    why: 'the default category "tin-noi-bat" renamed by staff',
    row: i => (i === 0 ? { slug: 'tin-noi-bat', name: 'Tin nổi bật (đã sửa)', type: 'news' } : {}),
  },
  media_categories: {
    why: 'the default media category "video-huong-dan" renamed by staff',
    row: i => (i === 0 ? { slug: 'video-huong-dan', name: 'Video hướng dẫn (đã sửa)' } : {}),
  },
  chatbot_small_talk: {
    why: 'a default small-talk entry re-answered and switched off by staff',
    row: (i) => {
      if (i !== 0) return {}
      const entry = CHATBOT_SMALL_TALK_SEED[0]!
      return { category: entry.category, question: entry.question, normalized_question: normalizeQuestion(entry.question), answer: 'Câu trả lời cán bộ đã sửa', is_enabled: 0 }
    },
  },
  ai_model_pricing: {
    why: 'the default model priced and labelled by staff',
    row: i => (i === 0 ? { model: loadSeedData().pricingModels[0]!, provider: 'delify', label: 'Giá đã thương lượng', is_active: 0, prompt_cost_per_million: '1.2345', completion_cost_per_million: '6.7890' } : {}),
  },
  ai_service_configs: {
    why: 'the default "chatbot" service re-prompted and switched off by staff',
    row: i => (i === 0 ? { service_key: 'chatbot', service_name: 'Trợ lý (đã sửa)', model: 'mo-hinh-rieng', system_prompt: 'Lời nhắc cán bộ đã sửa', is_active: 0 } : {}),
  },
  ai_budget_settings: {
    count: 1,
    why: 'singleton row id 1 with a budget staff set',
    row: () => ({ id: 1, monthly_budget_vnd: '1234567', warning_threshold_pct: 55 }),
  },
  ai_providers: {
    why: 'the default provider relabelled and repointed by staff',
    row: i => (i === 0 ? { provider: 'delify', label: 'Router (đã sửa)', base_url: 'https://router.example.test/v1', is_active: 1 } : {}),
  },
  ai_moderation_rules: {
    why: 'a default rule softened by staff (flag instead of hide); the other rows are staff rules',
    row: (i) => {
      if (i !== 0) return {}
      const rule = loadSeedData().moderationRules[0]!
      return { category: rule.category, pattern: rule.pattern, rule_type: 'keyword', action: 'flag', severity: 'low', is_enabled: 1 }
    },
  },
  languages: {
    why: 'the default language "vi" renamed by staff, "en" as seeded, one extra language',
    row: i => [{ code: 'vi', name: 'Tiếng Việt (đã sửa)', native_name: 'Tiếng Việt' },{ code: 'en', name: 'English', native_name: 'English' }, { code: 'km', name: 'Khmer', native_name: 'ខ្មែរ' }][i]!,
  },
  social_links: {
    why: 'Facebook edited by staff (the seed must not touch it) plus two custom links',
    row: i => ({ platform: ['Facebook', 'Diễn đàn', 'Báo Công an'][i]!, label: ['Trang C11 (đã sửa)', 'Diễn đàn hướng thiện', 'Báo CAND'][i]!, url: ['https://facebook.com/c11-sua', 'https://dien-dan.example.test', 'https://cand.example.test'][i]! }),
  },
  lang_translations: {
    why: 'the old long hotline label in vi/en (converted once to "Hotline"), and a fr row with the en text that the CASE leaves alone',
    row: i => ({ lang_code: ['vi', 'en', 'fr'][i]!, group: 'nav', key: 'hotline_lbl', value: ['Hotline Tư Vấn 24/7', '24/7 Hotline', '24/7 Hotline'][i]! }),
  },
  media: {
    why: 'a localhost-prefixed CDN URL (repaired once) and two R2 objects the legacy article links resolve to',
    row: i => ([
      { provider: 'local', filename: 'anh-hoi-nghi.jpg', url: 'http://localhost:3000/cdn1.delify.vn/uploads/2025/08/anh-hoi-nghi.jpg' },
      { provider: 'r2', filename: 'tải xuống.jpg', url: 'https://cdn1.delify.vn/uploads/2025/09/tai-xuong.jpg' },
      { provider: 'r2', filename: 'so-tay-phap-luat.png', url: 'https://cdn1.delify.vn/uploads/2025/09/so-tay-phap-luat.png' },
    ][i]!),
  },
  articles: {
    why: 'legacy migrated-media links and localhost double prefixes (repaired once), and a migrated link with no R2 object (left alone)',
    row: i => ({
      content: [
        '<p>Hội nghị</p><img src="/uploads/migrated/media/so-tay-phap-luat.png"><img src="https://conduonghuongthien.com.vn/uploads/migrated/media/t%E1%BA%A3i%20xu%E1%BB%91ng.jpg">',
        '<img src="http://localhost:3000https://cdn1.delify.vn/uploads/a.jpg"><a href="http://localhost:3000/cdn1.delify.vn/uploads/b.pdf">PDF</a>',
        '<p>Ảnh cũ</p><img src="/uploads/migrated/media/khong-ton-tai.jpg">',
      ][i]!,
    }),
  },
}

const DEFAULT_ROW_COUNT = 3

function enumValues(columnType: string): string[] {
  return [...columnType.matchAll(/'((?:[^'\\]|\\.|'')*)'/g)].map(match => match[1]!.replace(/''/g, "'"))
}

/**
 * A type-appropriate value for row `i` that sits near the edge of its type: ints
 * near the type maximum, BIGINT past 2^53, text with Vietnamese, quotes, a
 * backslash, a newline and a 4-byte emoji. A conversion that narrows a type,
 * changes a charset or rounds through a JS number changes these values.
 */
function generatedValue(table: string, column: ColumnInfo, i: number, inPrimaryKey: boolean): SqlValue {
  const { dataType, columnType } = column
  if (/int$/.test(dataType) && (inPrimaryKey || column.extra.includes('auto_increment'))) return i + 1
  switch (dataType) {
    case 'tinyint': return columnType.startsWith('tinyint(1)') ? (i + 1) % 2 : 100 + i
    case 'smallint': return 30000 + i
    case 'mediumint': return 8000000 + i
    case 'int': return 2000000000 + i
    case 'bigint': return (9007199254740993n + BigInt(i)).toString()
    case 'decimal': {
      const scale = column.scale ?? 0
      const intDigits = Math.max(1, Math.min((column.precision ?? 10) - scale, 6))
      return scale > 0 ? `${'7'.repeat(intDigits)}.${String(i + 1).repeat(scale)}` : `${'7'.repeat(intDigits - 1)}${i + 1}`
    }
    case 'float': case 'double': return 1.5 + i
    case 'date': return `2026-0${i + 1}-1${i + 1}`
    case 'datetime': case 'timestamp': {
      const fraction = column.datetimePrecision ? `.${String(i + 1).repeat(column.datetimePrecision)}` : ''
      return `2026-0${i + 1}-1${i + 1} 0${i + 1}:2${i}:3${i}${fraction}`
    }
    case 'time': return `0${i + 1}:1${i}:0${i}`
    case 'year': return 2026 - i
    case 'json': return JSON.stringify({ row: i + 1, nhãn: `giá trị ${i + 1}`, list: [1, 2, 3], emoji: '😀' })
    case 'enum': case 'set': {
      const values = enumValues(columnType)
      return values[i % values.length]!
    }
    case 'char': case 'varchar': case 'tinytext': case 'text': case 'mediumtext': case 'longtext': {
      const text = column.charset === 'utf8mb4'
        ? `${i + 1}·${column.name} — Hướng thiện “${table}” 'nháy' "kép" \\ xuống\ndòng 😀`
        : `${i + 1}-${column.name} ${table} 'q' "dq" \\ end`
      return column.maxLength === null ? text : Array.from(text).slice(0, column.maxLength).join('')
    }
    case 'binary': case 'varbinary': case 'tinyblob': case 'blob': case 'mediumblob': case 'longblob': {
      const bytes = Buffer.from([0x00, 0xff, i, 0x0a, 0x27, 0x5c])
      return column.maxLength === null ? bytes : Buffer.concat([bytes, Buffer.alloc(column.maxLength)]).subarray(0, column.maxLength)
    }
    default:
      throw new Error(`no generator for ${table}.${column.name} (${columnType}) — add an entry for ${table} to SEED_OVERRIDES`)
  }
}

/** The touched tables plus every table their foreign keys point at, transitively. */
function withReferencedTables(tables: string[], schema: SchemaInfo): string[] {
  const all = new Set(tables)
  for (let grew = true; grew;) {
    grew = false
    for (const fk of schema.foreignKeys) {
      if (all.has(fk.table) && !all.has(fk.refTable)) {
        all.add(fk.refTable)
        grew = true
      }
    }
  }
  return [...all].sort()
}

/**
 * Builds every row in memory first, then resolves foreign keys to the generated
 * parent rows: row `i` points at parent row `i mod n`, a nullable reference is
 * NULL in row 1 like every other nullable column (so both shapes are covered), and
 * a self-reference is NULL. Inserted with FK checks off (no ordering problem), then
 * checked: every reference must resolve, as it does in a real database.
 */
function buildRows(tables: string[], schema: SchemaInfo): Map<string, Row[]> {
  const fkByColumn = new Map<string, ForeignKey>()
  for (const fk of schema.foreignKeys) {
    if (!tables.includes(fk.table)) continue
    if (fk.columns.length !== 1) throw new Error(`composite FK ${fk.table}.${fk.name} — add an entry for ${fk.table} to SEED_OVERRIDES`)
    fkByColumn.set(`${fk.table}.${fk.columns[0]}`, fk)
  }
  const rows = new Map<string, Row[]>()
  for (const table of tables) {
    const info = schema.tables.get(table)!
    const override = SEED_OVERRIDES[table]
    const count = override?.count ?? DEFAULT_ROW_COUNT
    const tableRows: Row[] = []
    for (let i = 0; i < count; i += 1) {
      const fixed = override?.row(i) ?? {}
      const row: Row = {}
      for (const column of info.columns) {
        // `DEFAULT_GENERATED` (a `DEFAULT CURRENT_TIMESTAMP` column) is NOT a generated column.
        if (/\b(?:virtual|stored) generated\b/.test(column.extra)) continue
        if (column.name in fixed) row[column.name] = fixed[column.name]!
        else if (fkByColumn.has(`${table}.${column.name}`)) continue // resolved below
        else if (column.nullable && i === 1 && !info.primaryKey.includes(column.name)) row[column.name] = null
        else row[column.name] = generatedValue(table, column, i, info.primaryKey.includes(column.name))
      }
      tableRows.push(row)
    }
    rows.set(table, tableRows)
  }
  for (const [key, fk] of fkByColumn) {
    const column = fk.columns[0]!
    const info = schema.tables.get(fk.table)!
    const nullable = info.columns.find(c => c.name === column)!.nullable
    if (fkByColumn.has(`${fk.refTable}.${fk.refColumns[0]}`)) throw new Error(`${key} references another FK column — add an entry for ${fk.table} to SEED_OVERRIDES`)
    rows.get(fk.table)!.forEach((row, i) => {
      if (column in row) return // set by an override
      if (fk.refTable === fk.table) {
        if (!nullable) throw new Error(`${key} is a NOT NULL self-reference — add an entry for ${fk.table} to SEED_OVERRIDES`)
        row[column] = null
        return
      }
      const parents = rows.get(fk.refTable)!
      row[column] = nullable && i === 1 ? null : parents[i % parents.length]![fk.refColumns[0]!] ?? null
    })
  }
  editDefaultRowsLikeStaff(rows, schema)
  return rows
}

// ── Default-keyed rows carry staff edits in every column the seed writes ──────
//
// A row whose natural key is one of the seed's defaults stands for a default that
// staff later edited. If any column the seed writes still held the seed's value, a
// seed that resets it would change nothing visible. So every such column gets a
// value that differs from the seed's (and the DDL files') default: booleans flipped,
// numbers moved, text marked, JSON extended, a foreign key pointed at another row.

const STAFF_EDIT = 'cán bộ đã sửa'
const cellOf = (value: SqlValue | undefined): string | null =>
  value === null || value === undefined ? null : Buffer.isBuffer(value) ? `0x${value.toString('hex')}` : String(value)

function generatedKey(table: string, row: Row, rows: Map<string, Row[]>): string | null {
  const parent = (parentTable: string, id: SqlValue | undefined, column: string) =>
    cellOf(rows.get(parentTable)?.find(candidate => cellOf(candidate.id) === cellOf(id ?? null))?.[column])
  if (table === 'permissions') return `${parent('roles', row.role_id, 'name')}|${cellOf(row.resource)}`
  if (table === 'page_blocks') return `${parent('pages', row.page_id, 'slug')}|${cellOf(row.block_type)}|${cellOf(row.display_order)}`
  if (table === 'lang_translations') return `${cellOf(row.lang_code)}|${cellOf(row.group)}|${cellOf(row.key)}`
  const column = KEY_COLUMN[table]
  return column ? cellOf(row[column]) : null
}

function buildTimeReferences(rows: Map<string, Row[]>): ReferenceOf {
  return (kind, id) => cellOf((kind === 'role' ? rows.get('roles') : rows.get('pages'))
    ?.find(candidate => cellOf(candidate.id) === id)?.[kind === 'role' ? 'name' : 'slug'])
}

/** For every default-keyed row: the seed-written columns and the default values they must differ from. */
function defaultKeyedColumns(rows: Map<string, Row[]>) {
  const seed = loadSeedData()
  const found: Array<{ table: string, key: string, row: Row, column: string, defaults: unknown[] }> = []
  for (const [table, tableRows] of rows) {
    for (const row of tableRows) {
      const key = generatedKey(table, row, rows)
      if (key === null) continue
      const defaults = [seed.contents.get(table)?.get(key)].filter((d): d is Record<string, unknown> => !!d)
      for (const column of new Set(defaults.flatMap(d => Object.keys(d)))) {
        if (keyColumns(table).includes(column)) continue
        found.push({ table, key, row, column, defaults: defaults.map(d => d[column]).filter(value => value !== undefined) })
      }
    }
  }
  return found
}

function editDefaultRowsLikeStaff(rows: Map<string, Row[]>, schema: SchemaInfo) {
  const referenceOf = buildTimeReferences(rows)
  for (const { table, row, column: name, defaults } of defaultKeyedColumns(rows)) {
    const atDefault = (value: SqlValue | undefined) => defaults.some(d => sameAsDefault(d, cellOf(value), referenceOf) === true)
    if (!atDefault(row[name])) continue
    const column = schema.tables.get(table)?.columns.find(c => c.name === name)
    if (!column) continue
    const fk = schema.foreignKeys.find(candidate => candidate.table === table && candidate.columns[0] === name)
    const first = defaults[0]
    const candidates: SqlValue[] = []
    if (fk) {
      for (const parent of rows.get(fk.refTable) ?? []) if (parent !== row) candidates.push(parent[fk.refColumns[0]!] ?? null)
    } else if (column.columnType.startsWith('tinyint(1)') || typeof first === 'boolean') {
      candidates.push(0, 1)
    } else if (column.dataType === 'enum' || column.dataType === 'set') {
      candidates.push(...enumValues(column.columnType))
    } else if (column.dataType === 'json') {
      candidates.push(JSON.stringify(Array.isArray(first) ? [...first, STAFF_EDIT] : first && typeof first === 'object' ? { ...first, ghi_chu: STAFF_EDIT } : { ghi_chu: STAFF_EDIT }))
    } else if (['tinyint', 'smallint', 'mediumint', 'int', 'bigint', 'decimal', 'float', 'double', 'year'].includes(column.dataType)) {
      const n = Number(first ?? 0)
      for (const delta of [7, 1, -1]) candidates.push(column.dataType === 'decimal' ? (n + delta).toFixed(column.scale ?? 0) : n + delta)
    } else if (['char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext'].includes(column.dataType)) {
      const max = column.maxLength ?? Number.MAX_SAFE_INTEGER
      const base = first == null || typeof first === 'object' ? STAFF_EDIT : `${String(first)} (${STAFF_EDIT})`
      candidates.push(Array.from(base).slice(0, max).join(''), Array.from(STAFF_EDIT).slice(0, max).join(''), 'x'.repeat(Math.min(max, 3)))
    } else {
      candidates.push(generatedValue(table, column, 2, false), generatedValue(table, column, 0, false))
    }
    const edited = candidates.find(candidate => !atDefault(candidate))
    if (edited !== undefined) row[name] = edited
  }
}

/** `table.column [key]` of every seed-written column of a default-keyed row that still holds the seed's value. */
function columnsStillAtSeedValue(rows: Map<string, Row[]>): string[] {
  const referenceOf = buildTimeReferences(rows)
  return defaultKeyedColumns(rows)
    .filter(({ row, column, defaults }) => defaults.some(d => sameAsDefault(d, cellOf(row[column]), referenceOf) === true))
    .map(({ table, key, column }) => `${table}.${column} [${key}]`)
}

async function insertRows(conn: Connection, rows: Map<string, Row[]>) {
  await conn.query('SET FOREIGN_KEY_CHECKS = 0')
  try {
    for (const [table, tableRows] of rows) {
      for (const row of tableRows) {
        const columns = Object.keys(row)
        try {
          await conn.query(
            `INSERT INTO \`${table}\` (${columns.map(c => `\`${c}\``).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
            columns.map(c => row[c]),
          )
        } catch (err) {
          throw new Error(`could not insert a representative row into ${table} (${err instanceof Error ? err.message : String(err)}) — add or fix its entry in SEED_OVERRIDES`)
        }
      }
    }
  } finally {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1')
  }
}

// ── Snapshots and their diff ──────────────────────────────────────────────────

type Cells = Record<string, string | null>
type TableSnapshot = { columns: string[], primaryKey: string[], rows: Map<string, Cells> }
type Snapshot = Map<string, TableSnapshot>

function cellText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (Buffer.isBuffer(value)) return `0x${value.toString('hex')}`
  return String(value)
}

async function snapshot(): Promise<Snapshot> {
  return withConnection(async (conn) => {
    const schema = await readSchema(conn)
    const result: Snapshot = new Map()
    for (const [table, info] of [...schema.tables].sort(([a], [b]) => a.localeCompare(b))) {
      const order = info.primaryKey.length ? info.primaryKey : info.columns.map(c => c.name)
      const [rows] = await conn.query<RowDataPacket[]>(`SELECT * FROM \`${table}\` ORDER BY ${order.map(c => `\`${c}\``).join(', ')}`)
      const byKey = new Map<string, Cells>()
      for (const row of rows) {
        const cells: Cells = {}
        for (const column of info.columns) cells[column.name] = cellText(row[column.name])
        let key = info.primaryKey.length
          ? info.primaryKey.map(c => `${c}=${cells[c]}`).join(',')
          : `row:${JSON.stringify(cells)}`
        for (let n = 2; byKey.has(key); n += 1) key = `${key}#${n}`
        byKey.set(key, cells)
      }
      result.set(table, { columns: info.columns.map(c => c.name), primaryKey: info.primaryKey, rows: byKey })
    }
    return result
  })
}

type Change =
  | { kind: 'cell', table: string, key: string, column: string, before: string | null, after: string | null, beforeRow: Cells, afterRow: Cells }
  | { kind: 'inserted', table: string, key: string, row: Cells, natural?: string | null }
  | { kind: 'deleted', table: string, key: string, row: Cells }
  | { kind: 'table-added', table: string }
  | { kind: 'table-dropped', table: string }
  | { kind: 'column-added', table: string, column: string }
  | { kind: 'column-dropped', table: string, column: string }

function diffSnapshots(before: Snapshot, after: Snapshot): Change[] {
  const changes: Change[] = []
  for (const table of after.keys()) if (!before.has(table)) changes.push({ kind: 'table-added', table })
  for (const [table, old] of before) {
    const now = after.get(table)
    if (!now) {
      changes.push({ kind: 'table-dropped', table })
      continue
    }
    for (const column of now.columns) if (!old.columns.includes(column)) changes.push({ kind: 'column-added', table, column })
    for (const column of old.columns) if (!now.columns.includes(column)) changes.push({ kind: 'column-dropped', table, column })
    const shared = old.columns.filter(column => now.columns.includes(column))
    for (const [key, row] of old.rows) {
      const next = now.rows.get(key)
      if (!next) {
        changes.push({ kind: 'deleted', table, key, row })
        continue
      }
      for (const column of shared) {
        if (row[column] !== next[column]) changes.push({ kind: 'cell', table, key, column, before: row[column] ?? null, after: next[column] ?? null, beforeRow: row, afterRow: next })
      }
    }
    for (const [key, row] of now.rows) if (!old.rows.has(key)) changes.push({ kind: 'inserted', table, key, row, natural: naturalKey(table, row, after) })
  }
  return changes
}

function shown(value: string | null): string {
  if (value === null) return 'NULL'
  return JSON.stringify(value.length > 90 ? `${value.slice(0, 90)}…` : value)
}

function describe(change: Change): string {
  switch (change.kind) {
    case 'cell': return `${change.table}.${change.column} [${change.key}]: ${shown(change.before)} → ${shown(change.after)}`
    case 'inserted': return `${change.table} [${change.key}]${change.natural ? ` (${change.natural})` : ''}: row inserted`
    case 'deleted': return `${change.table} [${change.key}]: row deleted`
    case 'table-added': return `${change.table}: table created`
    case 'table-dropped': return `${change.table}: table dropped`
    case 'column-added': return `${change.table}.${change.column}: column added`
    case 'column-dropped': return `${change.table}.${change.column}: column dropped`
  }
}

const SEVERITY: Record<Change['kind'], number> = { 'table-dropped': 0, 'column-dropped': 1, deleted: 2, cell: 3, 'column-added': 4, 'table-added': 5, inserted: 6 }

/** Destructive changes first, a count per table/column, then the first `limit` in full. */
function report(changes: Change[], limit = 40): string {
  const sorted = [...changes].sort((a, b) => SEVERITY[a.kind] - SEVERITY[b.kind])
  const groups = new Map<string, number>()
  for (const change of sorted) {
    const where = change.kind === 'cell' || change.kind === 'column-added' || change.kind === 'column-dropped' ? `${change.table}.${change.column}` : change.table
    const label = `${change.kind} ${where}`
    groups.set(label, (groups.get(label) ?? 0) + 1)
  }
  const lines = ['  by kind and table/column:', ...[...groups].map(([label, n]) => `    ${label} ×${n}`), `  first ${Math.min(limit, sorted.length)}:`]
  lines.push(...sorted.slice(0, limit).map(change => `    ${describe(change)}`))
  if (sorted.length > limit) lines.push(`    … and ${sorted.length - limit} more`)
  return lines.join('\n')
}

// ── Declared one-time conversions ─────────────────────────────────────────────

type BootContext = {
  before: Snapshot
  after: Snapshot
  foreignKeysBefore: ForeignKey[]
  seed: SeedData
  /** each missing default may be added once */
  claimed: Set<string>
  keyCache: Map<string, Set<string>>
  /** why a seed insert was refused, for the failure message */
  notes: Set<string>
}

type DeclaredConversion = {
  id: string
  /** Where the write lives, re-located by content: the anchor must still match. */
  source: string
  anchor: RegExp
  reason: string
  covers: (change: Change, ctx: BootContext) => boolean
}

type CellChange = Extract<Change, { kind: 'cell' }>
type InsertedRow = Extract<Change, { kind: 'inserted' }>

const isCell = (change: Change, table: string, columns?: string[]): change is CellChange =>
  change.kind === 'cell' && change.table === table && (!columns || columns.includes(change.column))
const isInsert = (change: Change, tables: Iterable<string>): change is InsertedRow =>
  change.kind === 'inserted' && [...tables].includes(change.table)
const hadRows = (snap: Snapshot, table: string) => (snap.get(table)?.rows.size ?? 0) > 0
const rowsOf = (snap: Snapshot, table: string) => [...(snap.get(table)?.rows.values() ?? [])]

/** `{table}.{column}` of every column a boot migration step names — the only columns a boot may add. */
const MIGRATED_COLUMNS = (() => {
  const columns = new Set<string>()
  for (const value of Object.values(migrations) as unknown[]) {
    if (!Array.isArray(value)) continue
    for (const entry of value) {
      if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string') columns.add(`${entry[0]}.${entry[1]}`)
      else if (entry && typeof entry === 'object' && 'table' in entry && 'column' in entry) columns.add(`${String(entry.table)}.${String(entry.column)}`)
    }
  }
  for (const path of MIGRATION_SOURCES) {
    for (const match of readSource(path).matchAll(/\b(?:ensureColumn|modifyColumn)\(\s*db\s*,\s*database\s*,\s*'([a-z0-9_]+)'\s*,\s*'([a-z0-9_]+)'/g)) columns.add(`${match[1]}.${match[2]}`)
  }
  return columns
})()
const TABLES_CREATED_BY_BOOT = new Set(MIGRATION_SOURCES.flatMap(path => [...readSource(path).matchAll(/CREATE TABLE IF NOT EXISTS \\?`([a-z0-9_]+)\\?`/g)].map(match => match[1]!)))

const REQUIRED_BACKFILL = new Set(
  [...migrations.requiredAnalyticsColumnMigrations, ...migrations.realtimeAnalyticsRequiredColumnMigrations, ...migrations.chatbotRequiredColumnMigrations]
    .map(m => `${m.table}.${m.column}`),
)
const CHATBOT_BACKFILL = new Set(migrations.chatbotColumnMigrations.filter(m => m.backfillExpression).map(m => `${m.table}.${m.column}`))
const nullFilled = (change: Change, columns: Set<string>) =>
  change.kind === 'cell' && columns.has(`${change.table}.${change.column}`) && change.before === null && change.after !== null

/**
 * The R2 public domain `repairLegacyMediaUrls` reads from `settings.r2_public_url`
 * (scheme and trailing `/` dropped) — null when none is configured, and then the
 * domain steps do not run (wave2 D-SCAN: no more hard-coded `cdn1.delify.vn`).
 */
function configuredR2Domain(snap: Snapshot): string | null {
  const value = snap.get('settings')?.rows.get('key=r2_public_url')?.value
  if (!value) return null
  const domain = value.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  return domain && !/[\s"'<>\\`]/.test(domain) ? domain : null
}

/** What `repairLegacyMediaUrls` step 1 makes of a `media.url` — each SQL `REPLACE` replaces every occurrence. */
function repairedMediaUrl(url: string, domain: string | null): string {
  let value = url
  if (value.startsWith('http://localhost:3000http')) value = value.replaceAll('http://localhost:3000', '')
  if (value.startsWith('https://localhost:3000http')) value = value.replaceAll('https://localhost:3000', '')
  if (domain) {
    if (value.startsWith(`http://localhost:3000/${domain}`)) value = value.replaceAll('http://localhost:3000/', '')
    if (value.startsWith(`https://localhost:3000/${domain}`)) value = value.replaceAll('https://localhost:3000/', '')
    if (!value.startsWith('http') && value.startsWith(domain)) value = `https://${value}`
  }
  return value
}

/**
 * Steps 2 and 3 for `articles.content`, with the media rows as they stand after
 * step 1. A file name (raw or `encodeURIComponent`) that leads to more than one
 * distinct `media.url`, whatever the providers, is ambiguous and never mapped.
 */
function repairedArticleContent(content: string, media: Cells[], domain: string | null): string {
  let value = content
    .replaceAll('http://localhost:3000https://', 'https://')
    .replaceAll('https://localhost:3000https://', 'https://')
  if (domain) {
    value = value
      .replaceAll(`http://localhost:3000/${domain}`, `https://${domain}`)
      .replaceAll(`https://localhost:3000/${domain}`, `https://${domain}`)
  }
  const owners = new Map<string, Cells[]>()
  for (const row of media) {
    if (!row.filename) continue
    for (const name of new Set([row.filename, encodeURIComponent(row.filename)])) owners.set(name, [...(owners.get(name) ?? []), row])
  }
  const urlByFilename = new Map<string, string>()
  for (const [name, rows] of owners) {
    // Ambiguous = more than one DISTINCT url (two duplicate rows of one object are not).
    const urls = new Set(rows.map(row => row.url))
    if (urls.size === 1 && rows[0]!.url && rows.some(row => row.provider === 'r2')) urlByFilename.set(name, rows[0]!.url)
  }
  if (!value.includes('/uploads/migrated/media/') || urlByFilename.size === 0) return value
  value = value
    .replace(/https?:\/\/[^\s"'<>]*\/uploads\/[^\s"'<>]*migrated\/media\/([^\s"'<>\]?#]+)/g, (match, name: string) => urlByFilename.get(name) ?? match)
    .replace(/\/uploads\/migrated\/media\/([^\s"'<>\]?#]+)/g, (match, name: string) => urlByFilename.get(name) ?? match)
  return value
}

/**
 * The once-per-database seed groups (wave2 D7, `server/db/seed-groups.ts`). A boot
 * may fill one of these tables only while it is EMPTY; once a table has rows, a
 * default missing from it is one staff deleted, and re-inserting it is the bug D7
 * fixed (until then the seed and the DDL files put it back on every boot). No
 * declaration covers such an insert, so a regression fails boot 1 by name.
 */
const D7_SEED_GROUPS = new Set(['ai_moderation_rules', 'social_links', 'media_categories', 'content_types', 'categories'])

/**
 * What the seed writes for a default row: from its data (`loadSeedData`), or — for a
 * home-page block — from the home section the seed copies it from.
 */
function expectedContent(table: string, key: string, ctx: BootContext): Record<string, unknown> | undefined {
  if (table === 'page_blocks' && key.startsWith('home|')) {
    const [, type, order] = key.split('|')
    const section = rowsOf(ctx.after, 'home_sections').find(row => row.type === type && row.display_order === order)
    if (!section) return undefined
    // seed.ts: `data: (s.config ?? {})`, `isVisible: s.isVisible ?? true`
    return { data: section.config === null ? {} : JSON.parse(section.config), is_visible: section.is_visible === null ? true : section.is_visible === '1' }
  }
  return ctx.seed.contents.get(table)?.get(key)
}

/**
 * The natural keys a boot may add to `table`: the seed's own defaults
 * (`loadSeedData`), plus — for `page_blocks` — one block per home section, because
 * the seed copies `home_sections` into an empty home page.
 */
function defaultKeys(table: string, ctx: BootContext): Set<string> {
  const keys = ctx.seed.keys.get(table) ?? new Set<string>()
  if (table !== 'page_blocks') return keys
  const home = rowsOf(ctx.after, 'home_sections').map(section => `home|${section.type}|${section.display_order}`)
  return new Set([...keys, ...home])
}

/**
 * The boot added a default that was MISSING: its full natural key is one of the
 * defaults, no row had that key before the boot, and it is added once. A row for a
 * staff-created role, a second account, or a duplicate of a default that existed
 * is not this — it fails as undeclared.
 */
function addsMissingDefault(change: Change, ctx: BootContext): boolean {
  if (change.kind !== 'inserted') return false
  const key = naturalKey(change.table, change.row, ctx.after)
  if (key === null || !defaultKeys(change.table, ctx).has(key)) return false
  const cacheKey = `before:${change.table}`
  if (!ctx.keyCache.has(cacheKey)) {
    ctx.keyCache.set(cacheKey, new Set(rowsOf(ctx.before, change.table).map(row => naturalKey(change.table, row, ctx.before)).filter((k): k is string => k !== null)))
  }
  if (ctx.keyCache.get(cacheKey)!.has(key)) return false
  const claim = `${change.table}\u0000${key}`
  if (ctx.claimed.has(claim)) return false
  // …and it holds exactly what the seed writes for that default.
  const expected = expectedContent(change.table, key, ctx)
  if (!expected) return false
  const referenceOf: ReferenceOf = (kind, id) => (id === null ? null
    : kind === 'role' ? ctx.after.get('roles')?.rows.get(`id=${id}`)?.name ?? null : ctx.after.get('pages')?.rows.get(`id=${id}`)?.slug ?? null)
  const mismatches = Object.entries(expected).filter(([column, value]) => sameAsDefault(value, change.row[column] ?? null, referenceOf) === false)
  if (mismatches.length) {
    ctx.notes.add(`${change.table} [${key}] was inserted with content the seed does not write: ${mismatches
      .map(([column, value]) => `${column} = ${shown(change.row[column] ?? null)}, seed writes ${JSON.stringify(value)}`).join('; ')}`)
    return false
  }
  ctx.claimed.add(claim)
  return true
}

const DECLARED_CONVERSIONS: DeclaredConversion[] = [
  {
    id: 'ddl.create-table',
    source: 'server/db/migrations-additive.ts',
    anchor: /CREATE TABLE IF NOT EXISTS/,
    reason: 'a table the new release creates: nothing previous to preserve, and its rows are compared from boot 2 on',
    covers: (change, ctx) => (change.kind === 'table-added' && TABLES_CREATED_BY_BOOT.has(change.table))
      || (change.kind === 'inserted' && !ctx.before.has(change.table)),
  },
  {
    id: 'additive.add-column',
    source: 'server/db/migrations-additive.ts',
    anchor: /export async function ensureColumn\(/,
    reason: 'a column a migration step adds has no previous value to keep; its values are compared from boot 2 on',
    covers: change => change.kind === 'column-added' && MIGRATED_COLUMNS.has(`${change.table}.${change.column}`),
  },
  {
    id: 'additive.required-column-backfill',
    source: 'server/db/migrations-additive.ts',
    anchor: /export async function ensureRequiredColumn\([\s\S]*?WHERE \\`\$\{migration\.column\}\\` IS NULL/,
    reason: 'fills NULLs before the column becomes NOT NULL (`WHERE col IS NULL`); a value that exists is never rewritten',
    covers: change => nullFilled(change, REQUIRED_BACKFILL),
  },
  {
    id: 'additive.chatbot-column-backfill',
    source: 'server/db/migrations-additive.ts',
    anchor: /async function ensureChatbotColumn\([\s\S]*?if \(migration\.backfillExpression\) \{\s*await db\.query\(`UPDATE/,
    reason: 'same NULL-only backfill for the chatbot columns that converge to NOT NULL',
    covers: change => nullFilled(change, CHATBOT_BACKFILL),
  },
  {
    id: 'additive.chatbot-mode-ai',
    source: 'server/db/migrations-additive.ts',
    anchor: /if \(!modeColumnExisted\) \{[\s\S]*?SET \\`mode\\` = 'ai'/,
    reason: 'a deployment with a working provider keeps using it — only on the boot that ADDS the mode column; once it exists the stored mode is never touched',
    covers: (change, ctx) => isCell(change, 'chatbot_settings', ['mode']) && change.before === 'knowledge' && change.after === 'ai'
      && !(ctx.before.get('chatbot_settings')?.columns.includes('mode') ?? false),
  },
  {
    id: 'additive.orphan-user-refs-nulled',
    source: 'server/db/migrations-additive.ts',
    anchor: /SET s\.`updated_by` = NULL WHERE s\.`updated_by` IS NOT NULL AND u\.`id` IS NULL/,
    reason: 'a reference to a deleted user is cleared before the FK is built; a reference to an existing user is kept',
    covers: (change, ctx) => {
      if (!(isCell(change, 'chatbot_settings', ['updated_by']) || isCell(change, 'chatbot_knowledge', ['author_id', 'reviewer_id']))) return false
      const users = new Set(rowsOf(ctx.before, 'users').map(row => row.id))
      return change.before !== null && change.after === null && !users.has(change.before)
    },
  },
  {
    id: 'additive.orphan-terms-get-parent',
    source: 'server/db/migrations-additive.ts',
    anchor: /INSERT IGNORE INTO \\`chatbot_knowledge\\`/,
    reason: 'a term whose knowledge row is missing gets a draft "Legacy question N" parent so the FK can be built',
    covers: (change, ctx) => isInsert(change, ['chatbot_knowledge'])
      && change.row.canonical_question === `Legacy question ${change.row.id}`
      && rowsOf(ctx.before, 'chatbot_knowledge_terms').some(term => term.knowledge_id === change.row.id),
  },
  {
    id: 'additive.media-category-legacy-fk',
    source: 'server/db/migrations-additive.ts',
    anchor: /if \(rows\.some\(row => row\.REFERENCED_TABLE_NAME === 'categories'\)\) \{\s*await db\.query\('UPDATE `media_items` SET `category_id` = NULL WHERE `category_id` IS NOT NULL'\)/,
    reason: 'Wave 0: a category id is cleared only while the FK on media_items.category_id still points at the ARTICLE categories table — keyed on the schema, never on values',
    covers: (change, ctx) => isCell(change, 'media_items', ['category_id']) && change.after === null
      && ctx.foreignKeysBefore.some(fk => fk.table === 'media_items' && fk.columns.includes('category_id') && fk.refTable === 'categories'),
  },
  {
    id: 'additive.hotline-label',
    source: 'server/db/migrations-additive.ts',
    anchor: /AND value IN \('Hotline Tư Vấn 24\/7', '24\/7 Hotline'\)/,
    reason: 'shortens the old vi/en hotline label, only while it still holds the old text — a label staff edited is left alone',
    covers: change => isCell(change, 'lang_translations', ['value'])
      && change.beforeRow.group === 'nav' && change.beforeRow.key === 'hotline_lbl' && ['vi', 'en'].includes(String(change.beforeRow.lang_code))
      && ['Hotline Tư Vấn 24/7', '24/7 Hotline'].includes(String(change.before)) && change.after === 'Hotline',
  },
  {
    id: 'additive.repair-legacy-media-urls',
    source: 'server/db/legacy-media-urls.ts',
    anchor: /async function repairLegacyMediaUrls\(/,
    reason: 'strips a localhost prefix from CDN URLs (the configured R2 domain, settings.r2_public_url) and points migrated-media links at their R2 object, skipping a file name more than one media row carries (wave2 D-SCAN); the result must be exactly that rewrite',
    covers: (change, ctx) => {
      const domain = configuredR2Domain(ctx.before)
      if (isCell(change, 'media', ['url'])) return change.before !== null && change.after === repairedMediaUrl(change.before, domain)
      if (isCell(change, 'articles', ['content'])) return change.before !== null && change.after === repairedArticleContent(change.before, rowsOf(ctx.after, 'media'), domain)
      return false
    },
  },
  {
    id: 'additive.short-id-backfill',
    source: 'server/db/migrations-additive.ts',
    anchor: /async function backfillShortIds\(/,
    reason: 'a video without a public short id gets one (11 base64url characters); an existing id is never replaced',
    covers: change => isCell(change, 'media_items', ['short_id']) && change.before === null && /^[A-Za-z0-9_-]{11}$/.test(String(change.after)),
  },
  {
    id: 'seed.group-markers',
    source: 'server/db/seed-groups.ts',
    anchor: /await tx\.insert\(settings\)\.values\(\{ key, value: now\.toISOString\(\), type: 'string', group: SEED_MARKER_SETTINGS_GROUP \}\)/,
    reason: 'wave2 D7: the first boot after the seed markers ship records each default set of each once-per-database group as seeded (`seed.<group>.v<N>.done`, value = ISO time, group internal) — a table that already has rows gets the v1 marker only, nothing inserted; from then on the set never runs again, so a default staff delete stays deleted',
    covers: (change, ctx) => isInsert(change, ['settings'])
      && ctx.seed.markerKeys.has(String(change.row.key))
      && !(ctx.before.get('settings')?.rows.has(`key=${change.row.key}`) ?? false)
      && change.row.group === 'internal'
      && !Number.isNaN(Date.parse(String(change.row.value))),
  },
  {
    id: 'seed.insert-missing-defaults',
    source: 'server/db/seed.ts',
    anchor: /const keepExisting = \(column: string\) => sql\.raw/,
    reason: 'seed.ts is insert-only: it adds the default rows that are missing (a fresh group, a new settings key or translation) — matched by full natural key against the seed\'s own data — and never updates or deletes one. A once-per-database group (wave2 D7) is only filled while its table is empty',
    covers: (change, ctx) => change.kind === 'inserted' && !(D7_SEED_GROUPS.has(change.table) && hadRows(ctx.before, change.table))
      && addsMissingDefault(change, ctx),
  },
  {
    id: 'seed.ai-provider-backfill',
    source: 'server/db/seed.ts',
    anchor: /Backfilling AI provider '\$\{chatbotProvider\}' from chatbot_settings/,
    reason: 'the AI panel provider and chatbot service config inherit the chatbot provider once, while they have no key / prompt of their own',
    covers: (change, ctx) => {
      const chatbot = ctx.before.get('chatbot_settings')?.rows.get('id=1')
      if (!chatbot?.provider_policy || !chatbot.base_url) return false
      if (isCell(change, 'ai_providers', ['base_url', 'api_key_ciphertext', 'api_key_nonce', 'api_key_version', 'api_key_key_id', 'api_key_auth_tag', 'api_key_last_four', 'is_active'])) return change.beforeRow.api_key_ciphertext === null
      if (isCell(change, 'ai_service_configs', ['provider', 'model', 'system_prompt', 'is_active'])) return change.beforeRow.service_key === 'chatbot' && !change.beforeRow.system_prompt
      return false
    },
  },
]

/**
 * Splits boot-1 changes into declared and undeclared. A column MySQL itself
 * refreshes (`ON UPDATE CURRENT_TIMESTAMP`) follows a declared write to the same
 * row and nothing else.
 */
function classify(changes: Change[], ctx: BootContext, autoUpdated: Set<string>) {
  const fired = new Map<string, number>()
  const undeclared: Change[] = []
  const coveredRows = new Set<string>()
  const pendingTimestamps: Change[] = []
  for (const change of changes) {
    if (change.kind === 'cell' && autoUpdated.has(`${change.table}.${change.column}`)) {
      pendingTimestamps.push(change)
      continue
    }
    const conversion = DECLARED_CONVERSIONS.find(candidate => candidate.covers(change, ctx))
    if (!conversion) {
      undeclared.push(change)
      continue
    }
    fired.set(conversion.id, (fired.get(conversion.id) ?? 0) + 1)
    if (change.kind === 'cell') coveredRows.add(`${change.table} ${change.key}`)
  }
  for (const change of pendingTimestamps) {
    if (change.kind === 'cell' && coveredRows.has(`${change.table} ${change.key}`)) {
      fired.set('mysql.on-update-timestamp', (fired.get('mysql.on-update-timestamp') ?? 0) + 1)
    } else {
      undeclared.push(change)
    }
  }
  return { fired, undeclared }
}

// ── The suite ─────────────────────────────────────────────────────────────────

type SuiteState = {
  previousSchema: SchemaInfo
  touched: string[]
  seededRows: Map<string, Row[]>
  afterBoot1?: Snapshot
  ddlAfterBoot1?: Record<string, string>
}
let state: SuiteState | undefined

function requireState(step: string): SuiteState {
  assert.ok(state, `${step}: an earlier test in this file failed, so there is nothing to boot on`)
  return state
}

before(() => {
  if (enabled) assertDisposableDatabase(DB_NAME)
})

after(async () => {
  if (!enabled) return
  const conn = await mysql.createConnection({ host, port, user, password })
  try {
    assertDisposableDatabase(DB_NAME)
    await conn.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``)
  } finally {
    await conn.end()
  }
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]
  Object.assign(process.env, originalEnv)
})

test('the previous-release fixture loads into an empty database', { skip: !enabled, timeout: 120_000 }, async () => {
  const sql = readFileSync(FIXTURE_PATH, 'utf8')
  const header = /^-- commit: ([0-9a-f]{40})$/m.exec(sql)
  assert.ok(header, 'the fixture names no commit — regenerate it with scripts/snapshot-schema.ts')
  assert.doesNotMatch(sql, /^\s*(DROP|INSERT|UPDATE|DELETE)\b/im, 'the fixture must be schema only, with nothing that replaces or writes rows')
  const declaredTables = Number(/^-- tables: (\d+)$/m.exec(sql)?.[1])

  const server = await mysql.createConnection({ host, port, user, password })
  try {
    assertDisposableDatabase(DB_NAME)
    await server.query(`CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  } finally {
    await server.end()
  }
  const conn = await open({ multipleStatements: true })
  try {
    await conn.query(sql)
    const schema = await readSchema(conn)
    assert.equal(schema.tables.size, declaredTables, 'the fixture header and its CREATE TABLE statements disagree')
    state = { previousSchema: schema, touched: [], seededRows: new Map() }
  } finally {
    await conn.end()
  }
})

test('every table a boot migration touches gets representative rows', { skip: !enabled, timeout: 120_000 }, async (t) => {
  const current = requireState('seeding')
  const previousTables = new Set(current.previousSchema.tables.keys())
  const { touched, newTables } = tablesTouchedByBootMigrations(previousTables)
  // Non-vacuity: each derivation path found what it must — the exported arrays, the
  // literal helper calls, the DDL-file helpers and the raw conversions.
  for (const table of ['analytics_live_minute_buckets', 'chatbot_knowledge_terms', 'reader_accounts', 'media_items', 'submissions', 'pages', 'lang_translations', 'media', 'articles']) {
    assert.ok(touched.includes(table), `the migration parser no longer finds ${table}`)
  }
  // The DDL files are DDL only since wave2 D7: the once-per-database groups are
  // written by the seed, and reach the seeded tables through `seedWritten` below.
  for (const table of D7_SEED_GROUPS) {
    assert.ok(loadSeedData().writtenTables.includes(table), `the seed-write scan no longer finds the D7 group table ${table}`)
  }
  for (const table of Object.keys(SEED_OVERRIDES)) assert.ok(previousTables.has(table), `SEED_OVERRIDES names ${table}, which the previous release does not have`)
  // The tables the seed writes get representative rows too, each with a row that
  // carries a default key and staff-edited values (SEED_OVERRIDES): an upsert that
  // overwrites staff data shows up as a changed cell.
  const seedWritten = loadSeedData().writtenTables.filter(table => previousTables.has(table))
  for (const table of seedWritten) assert.ok(SEED_OVERRIDES[table], `the seed writes ${table} but SEED_OVERRIDES gives it no row with a default key and staff-edited values`)

  const seeded = withReferencedTables([...new Set([...touched, ...seedWritten])], current.previousSchema)
  const rows = buildRows(seeded, current.previousSchema)
  // Contract: in every row keyed like a seed default, every column the seed writes
  // differs from the seed's value — so a seed that resets staff data is visible.
  assert.deepEqual(columnsStillAtSeedValue(rows), [], 'a default-keyed representative row still holds the seed\'s value — the seed could reset it unseen')
  const defaultKeyed = defaultKeyedColumns(rows)
  assert.ok(defaultKeyed.length > 50, `only ${defaultKeyed.length} seed-written columns are covered by default-keyed rows`)
  for (const table of seedWritten) {
    assert.ok(defaultKeyed.some(entry => entry.table === table), `the seed writes ${table} but no representative row carries one of its default keys`)
  }
  await withConnection(async (conn) => {
    await insertRows(conn, rows)
    for (const fk of current.previousSchema.foreignKeys.filter(fk => seeded.includes(fk.table))) {
      const [[dangling]] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM \`${fk.table}\` c LEFT JOIN \`${fk.refTable}\` p ON p.\`${fk.refColumns[0]}\` = c.\`${fk.columns[0]}\`
         WHERE c.\`${fk.columns[0]}\` IS NOT NULL AND p.\`${fk.refColumns[0]}\` IS NULL`,
      )
      assert.equal(Number(dangling?.n), 0, `${fk.table}.${fk.columns[0]} has representative rows pointing at no ${fk.refTable} row`)
    }
  })
  const counted = await snapshot()
  for (const table of [...touched, ...seedWritten]) {
    const expected = SEED_OVERRIDES[table]?.count ?? DEFAULT_ROW_COUNT
    assert.equal(counted.get(table)?.rows.size, expected, `${table} is written at boot but holds ${counted.get(table)?.rows.size ?? 0} representative rows`)
  }
  t.diagnostic(`tables touched by boot migrations: ${touched.length} (${touched.join(', ')})`)
  t.diagnostic(`tables the seed writes: ${seedWritten.length} (${seedWritten.join(', ')})`)
  t.diagnostic(`seeded with referenced parents: ${seeded.length} tables, ${[...rows.values()].reduce((n, r) => n + r.length, 0)} rows`)
  if (newTables.length) t.diagnostic(`tables the new release creates (nothing previous to preserve): ${newTables.join(', ')}`)
  current.touched = touched
  current.seededRows = rows
})

test('boot 1 on the previous release keeps every row except the declared one-time conversions', { skip: !enabled, timeout: 300_000 }, async (t) => {
  const current = requireState('boot 1')
  assert.ok(current.touched.length > 0, 'nothing was seeded')
  const beforeBoot = await snapshot()
  // Non-vacuity for D7: every once-per-database group starts with rows (staff data,
  // most defaults missing), so boot 1 takes the bootstrap path — markers only.
  for (const table of D7_SEED_GROUPS) assert.ok(hadRows(beforeBoot, table), `${table} has no representative rows — the D7 bootstrap path is not exercised`)
  assert.deepEqual([...beforeBoot.get('settings')!.rows.keys()].filter(key => key.startsWith('key=seed.')), [], 'the previous release has no seed markers')
  await boot()
  const afterBoot = await snapshot()

  const autoUpdated = new Set<string>()
  for (const [table, info] of current.previousSchema.tables) {
    for (const column of info.columns) if (column.extra.includes('on update current_timestamp')) autoUpdated.add(`${table}.${column.name}`)
  }
  const changes = diffSnapshots(beforeBoot, afterBoot)
  const notes = new Set<string>()
  const { fired, undeclared } = classify(changes, {
    before: beforeBoot, after: afterBoot, foreignKeysBefore: current.previousSchema.foreignKeys,
    seed: loadSeedData(), claimed: new Set(), keyCache: new Map(), notes,
  }, autoUpdated)
  assert.equal(undeclared.length, 0, `${undeclared.length} write(s) on boot 1 that no declared conversion covers:\n${report(undeclared)}${notes.size ? `\n  why seed inserts were refused:\n${[...notes].slice(0, 20).map(note => `    ${note}`).join('\n')}` : ''}`)

  // The trigger rows were really converted, to exactly these values — written out
  // here independently of the predicates above, and proof that boot 1 ran the
  // migrations at all.
  const cellAfter = (table: string, key: string, column: string) => afterBoot.get(table)?.rows.get(key)?.[column]
  assert.equal(cellAfter('lang_translations', 'id=1', 'value'), 'Hotline')
  assert.equal(cellAfter('lang_translations', 'id=2', 'value'), 'Hotline')
  assert.equal(cellAfter('lang_translations', 'id=3', 'value'), '24/7 Hotline', 'the fr label is not the old vi/en text and must stay')
  assert.equal(cellAfter('media', 'id=1', 'url'), 'https://cdn1.delify.vn/uploads/2025/08/anh-hoi-nghi.jpg')
  assert.equal(
    cellAfter('articles', 'id=1', 'content'),
    '<p>Hội nghị</p><img src="https://cdn1.delify.vn/uploads/2025/09/so-tay-phap-luat.png"><img src="https://cdn1.delify.vn/uploads/2025/09/tai-xuong.jpg">',
  )
  assert.equal(cellAfter('articles', 'id=2', 'content'), '<img src="https://cdn1.delify.vn/uploads/a.jpg"><a href="https://cdn1.delify.vn/uploads/b.pdf">PDF</a>')
  assert.equal(cellAfter('articles', 'id=3', 'content'), '<p>Ảnh cũ</p><img src="/uploads/migrated/media/khong-ton-tai.jpg">', 'a migrated link with no R2 object must stay as it was')
  assert.equal(cellAfter('chatbot_settings', 'id=1', 'mode'), 'knowledge', 'the stored chatbot mode was rewritten on a database that already had the column')
  // D7: no default came back into a table staff curate, and every set is marked.
  for (const table of D7_SEED_GROUPS) {
    assert.deepEqual([...afterBoot.get(table)!.rows.keys()], [...beforeBoot.get(table)!.rows.keys()], `${table}: boot 1 re-inserted a default staff deleted`)
  }
  assert.deepEqual(
    [...afterBoot.get('settings')!.rows.keys()].filter(key => key.startsWith('key=seed.')).sort(),
    [...loadSeedData().markerKeys].map(key => `key=${key}`).sort(),
    'every default set of every group is marked on the first boot',
  )
  assert.equal(cellAfter('articles', 'id=1', 'updated_at'), beforeBoot.get('articles')!.rows.get('id=1')!.updated_at, 'repairing a link is not an edit of the article: updated_at is kept')

  t.diagnostic(`declared conversions observed on boot 1: ${[...fired].map(([id, n]) => `${id} ×${n}`).join(', ') || 'none'}`)
  const silent = DECLARED_CONVERSIONS.filter(conversion => !fired.has(conversion.id)).map(conversion => conversion.id)
  t.diagnostic(`declared but not reachable from this fixture: ${silent.join(', ') || 'none'}`)
  current.afterBoot1 = afterBoot
  current.ddlAfterBoot1 = await withConnection(readDdl)
})

test('boot 2 changes nothing at all — no row, no column, no table, no schema', { skip: !enabled, timeout: 300_000 }, async () => {
  const current = requireState('boot 2')
  assert.ok(current.afterBoot1 && current.ddlAfterBoot1, 'boot 1 did not complete')
  await boot()
  const afterBoot2 = await snapshot()
  const changes = diffSnapshots(current.afterBoot1, afterBoot2)
  assert.equal(changes.length, 0, `boot 2 changed ${changes.length} thing(s) — a boot-time write that is not idempotent:\n${report(changes)}`)
  assert.deepEqual(await withConnection(readDdl), current.ddlAfterBoot1, 'boot 2 changed the schema')
})

test('a default staff deleted stays deleted across another reboot (wave2 D7)', { skip: !enabled, timeout: 300_000 }, async () => {
  const current = requireState('reboot after a delete')
  assert.ok(current.afterBoot1, 'boot 1 did not complete')
  // One default of every once-per-database group, deleted the way staff would.
  const deleted: Array<[table: string, column: string, value: string]> = [
    ['ai_moderation_rules', 'pattern', loadSeedData().moderationRules[0]!.pattern],
    ['social_links', 'platform', 'Facebook'],
    ['content_types', 'slug', 'news'],
    ['categories', 'slug', 'tin-noi-bat'],
    ['media_categories', 'slug', 'video-huong-dan'],
  ]
  await withConnection(async (conn) => {
    for (const [table, column, value] of deleted) {
      const [result] = await conn.query(`DELETE FROM \`${table}\` WHERE \`${column}\` = ?`, [value])
      assert.equal((result as { affectedRows: number }).affectedRows, 1, `${table}: the default ${value} was not there to delete`)
    }
  })
  const beforeReboot = await snapshot()
  await boot()
  const changes = diffSnapshots(beforeReboot, await snapshot())
  assert.equal(changes.length, 0, `the reboot after a staff delete changed ${changes.length} thing(s) — a deleted default came back?\n${report(changes)}`)
})

test('the seed declarations accept exactly the seed\'s own missing defaults, by full natural key', { skip: !enabled }, () => {
  const seed = loadSeedData()
  // Read from the seed's data, not guessed: the one account, the four roles, every
  // (role, resource) pair, the tables it writes.
  assert.deepEqual(seed.seededAccounts, ['admin'], 'seed.ts creates an account other than admin — a security change, not a default')
  assert.deepEqual([...seed.keys.get('roles')!].sort(), ['editor', 'moderator', 'superadmin', 'viewer'])
  const resources = (declaredConstant(SEED_SOURCE, 'RESOURCES') as string[])
  assert.ok(resources.length > 10 && resources.includes('news'))
  assert.equal(seed.keys.get('permissions')!.size, 4 * resources.length)
  for (const table of ['users', 'roles', 'permissions', 'settings', 'pages', 'page_blocks', 'ai_model_pricing', 'ai_moderation_rules', 'social_links', 'languages', 'lang_translations']) {
    assert.ok(seed.writtenTables.includes(table), `the seed-write scan no longer finds ${table}`)
  }

  const table = (rows: Array<Record<string, string | null>>, primaryKey = 'id'): TableSnapshot => ({
    columns: Object.keys(rows[0] ?? {}),
    primaryKey: [primaryKey],
    rows: new Map(rows.map(row => [`${primaryKey}=${row[primaryKey]}`, row])),
  })
  const before: Snapshot = new Map([
    ['users', table([{ id: '1', username: 'admin' }])],
    ['roles', table([{ id: '1', name: 'superadmin' }, { id: '3', name: 'biên tập viên địa phương' }])],
    ['permissions', table([{ id: '1', role_id: '1', resource: 'news' }])],
    ['pages', table([{ id: '1', slug: 'about' }, { id: '2', slug: 'trang-rieng' }])],
    ['page_blocks', table([])],
    ['home_sections', table([])],
    ['lang_translations', table([])],
  ])
  const after: Snapshot = new Map([...before, ['roles', table([...before.get('roles')!.rows.values(), { id: '4', name: 'moderator' }])]])
  const ctx = (): BootContext => ({ before, after, foreignKeysBefore: [], seed, claimed: new Set(), keyCache: new Map(), notes: new Set() })
  const declares = (context: BootContext, tableName: string, row: Record<string, string | null>) =>
    DECLARED_CONVERSIONS.find(conversion => conversion.covers({ kind: 'inserted', table: tableName, key: `id=${row.id}`, row }, context))?.id ?? null

  // A row exactly as the seed would insert it (from its data), optionally altered.
  const refIds: Record<string, string> = { '@role:superadmin': '1', '@role:moderator': '4', '@page:about': '1' }
  const asSeeded = (tableName: string, key: string, id: string, change: Record<string, unknown> = {}): Record<string, string | null> => {
    const expected = seed.contents.get(tableName)?.get(key)
    assert.ok(expected, `the seed has no default ${tableName} [${key}]`)
    const row: Record<string, string | null> = { id }
    for (const [column, value] of Object.entries({ ...expected, ...change })) {
      if (value === NOT_A_LITERAL || value === undefined) continue
      row[column] = value === null ? null : typeof value === 'boolean' ? (value ? '1' : '0') : typeof value === 'object' ? JSON.stringify(value) : refIds[String(value)] ?? String(value)
    }
    return row
  }

  const one = ctx()
  assert.equal(declares(one, 'permissions', asSeeded('permissions', 'moderator|news', '9')), 'seed.insert-missing-defaults', 'a default role\'s missing default right')
  assert.equal(declares(one, 'permissions', asSeeded('permissions', 'moderator|news', '10')), null, 'the same default added twice')
  assert.equal(declares(one, 'permissions', { ...asSeeded('permissions', 'moderator|news', '11'), role_id: '3' }), null, 'a right for a staff-created role is not a default (bite F)')
  assert.equal(declares(one, 'permissions', asSeeded('permissions', 'superadmin|news', '12')), null, 'a default that already existed is not missing')
  assert.equal(declares(ctx(), 'permissions', asSeeded('permissions', 'moderator|news', '13', { can_delete: true })), null, 'a missing default inserted with other rights than the seed\'s')
  assert.equal(declares(one, 'users', { id: '2', username: 'editor' }), null, 'a second account is not a default (bite H)')
  assert.equal(declares(one, 'users', { id: '3', username: 'admin' }), null, 'admin already existed, so a second admin row is not a missing default')
  assert.equal(declares(one, 'lang_translations', asSeeded('lang_translations', 'vi|nav|hotline_lbl', '1')), 'seed.insert-missing-defaults')
  assert.equal(declares(one, 'lang_translations', { id: '2', lang_code: 'vi', group: 'nav', key: 'not_a_seeded_key', value: 'x', is_ai_translated: '0' }), null, 'a key the seed does not define')
  assert.equal(declares(one, 'lang_translations', { ...asSeeded('lang_translations', 'en|nav|hotline_lbl', '3'), lang_code: 'xx' }), null, 'a language the seed does not define for that key')
  const altered = ctx()
  assert.equal(declares(altered, 'lang_translations', asSeeded('lang_translations', 'en|nav|hotline_lbl', '4', { value: 'Hotline (sai)' })), null, 'a missing translation inserted with other text (bite N2)')
  assert.match([...altered.notes].join('\n'), /lang_translations \[en\|nav\|hotline_lbl\] was inserted with content the seed does not write: value = "Hotline \(sai\)"/)
  const aboutHeading = seed.contents.get('page_blocks')!.get('about|heading|1')!
  assert.equal(declares(one, 'page_blocks', asSeeded('page_blocks', 'about|heading|1', '1')), 'seed.insert-missing-defaults', 'the default heading block of "about"')
  assert.equal(declares(ctx(), 'page_blocks', asSeeded('page_blocks', 'about|heading|1', '5', { data: { ...(aboutHeading.data as object), text: 'Tiêu đề sai' } })), null, 'a missing default block inserted with other data (bite N3)')
  assert.equal(declares(one, 'page_blocks', { ...asSeeded('page_blocks', 'about|heading|1', '2'), page_id: '2' }), null, 'a block on a page that is not a system page')

  // A default transformed at insert time is refused by name, before any boot (bites N2, N3).
  const transformed: Array<[string, string, RegExp]> = [
    ['n2', 'for (const item of DEFAULT_TRANSLATIONS_SEED) { for (const [langCode, value] of Object.entries(item.values)) { await db.insert(langTranslations).values({ langCode, group: item.group, key: item.key, value: `${value} (sai)` }) } }', /writes value: `\$\{value\} \(sai\)`/],
    ['n3', 'for (const b of aboutBlocks) { await db.insert(pageBlocks).values({ pageId: aboutPage.id, ...b, data: { ...b.data, title: "x" } }) }', /writes data: \{ \.\.\.b\.data, title: "x" \}/],
  ]
  for (const [name, code, message] of transformed) {
    sourceCache.set(`fixture/${name}.ts`, code)
    assert.throws(() => seedInsertRows(`fixture/${name}.ts`, parsed(`fixture/${name}.ts`)), message)
  }

  // The two readings of the seed agree: every default key has its content, and back.
  for (const [tableName, keys] of seed.keys) {
    const contents = seed.contents.get(tableName)
    assert.deepEqual([...(contents?.keys() ?? [])].sort(), [...keys].sort(), `${tableName}: the default keys and the default contents read from the seed differ`)
  }

  // D7 markers: exactly the markers of the seed groups, in the internal group, with an ISO time.
  // The literal keys are pinned here, independent of `seedMarkerKey` (a renamed format
  // would leave every existing database unmarked and re-seed every group once).
  assert.deepEqual([...seed.markerKeys].sort(), [
    'seed.categories.v1.done', 'seed.content_types.v1.done', 'seed.media_categories.v1.done',
    'seed.moderation_rules.v1.done', 'seed.social_links.v1.done',
  ])
  const marker = (key: string, overrides: Record<string, string> = {}) => ({ key, value: '2026-10-24T03:04:05.678Z', type: 'string', group: 'internal', ...overrides })
  const withSettings: Snapshot = new Map([...before, ['settings', table([{ key: 'site_name', value: 'C11', type: 'string', group: 'general' }, marker('seed.categories.v1.done')], 'key')]])
  const settingsCtx = (): BootContext => ({ before: withSettings, after: withSettings, foreignKeysBefore: [], seed, claimed: new Set(), keyCache: new Map(), notes: new Set() })
  assert.equal(declares(settingsCtx(), 'settings', marker('seed.moderation_rules.v1.done')), 'seed.group-markers')
  assert.equal(declares(settingsCtx(), 'settings', marker('seed.categories.v1.done')), null, 'a marker that already existed is not written again')
  assert.equal(declares(settingsCtx(), 'settings', marker('seed.moderation_rules.v9.done')), null, 'a marker for a set the seed does not define')
  assert.equal(declares(settingsCtx(), 'settings', marker('seed.social_links.v1.done', { group: 'general' })), null, 'a marker outside the internal group')
  assert.equal(declares(settingsCtx(), 'settings', marker('seed.social_links.v1.done', { value: 'done' })), null, 'a marker whose value is not a time')
  // A default into a D7 table that already had rows is the resurrection D7 removed: undeclared.
  const curated: Snapshot = new Map([...before, ['social_links', table([{ id: '1', platform: 'Diễn đàn' }])]])
  const resurrect = (): BootContext => ({ before: curated, after: curated, foreignKeysBefore: [], seed, claimed: new Set(), keyCache: new Map(), notes: new Set() })
  assert.equal(declares(resurrect(), 'social_links', asSeeded('social_links', 'Facebook', '2')), null, 'a deleted default re-inserted into a curated table')
  const empty: Snapshot = new Map([...before, ['social_links', table([])]])
  const fresh = (): BootContext => ({ before: empty, after: empty, foreignKeysBefore: [], seed, claimed: new Set(), keyCache: new Map(), notes: new Set() })
  assert.equal(declares(fresh(), 'social_links', asSeeded('social_links', 'Facebook', '1')), 'seed.insert-missing-defaults', 'an empty group table is filled with its defaults')
  assert.equal(declares(fresh(), 'social_links', asSeeded('social_links', 'Facebook', '1', { url: 'https://facebook.com/gia-mao' })), null, 'a group default inserted with other content than the group spec writes')
})

test('every declared conversion still names code that exists', { skip: !enabled }, () => {
  const ids = DECLARED_CONVERSIONS.map(conversion => conversion.id)
  assert.equal(new Set(ids).size, ids.length, 'two declared conversions share an id')
  for (const conversion of DECLARED_CONVERSIONS) {
    assert.match(readSource(conversion.source), conversion.anchor, `declared conversion ${conversion.id}: its code is gone from ${conversion.source} — delete the declaration (or re-anchor it if the write moved)`)
  }
})
