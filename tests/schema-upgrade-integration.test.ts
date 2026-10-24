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
 *   2. inserts representative rows into every table a boot migration touches. The
 *      table list is DERIVED from the migration code (the exported migration arrays,
 *      helper calls and raw DML in `migrations-additive.ts` and `schema-tables/*.ts`),
 *      plus the tables those rows reference — so a new migration is covered without
 *      editing this file, and a table the generator cannot fill fails here by name.
 *      A few rows are hand-written to trip the known one-time conversions;
 *   3. boots twice, exactly like the container (`initDb()`, then `seed.ts` as its own
 *      process) and compares every table, row by row and column by column:
 *        - boot 1: nothing may change except a write a DECLARED CONVERSION below
 *          covers — each one names its code (re-located by content, not line number)
 *          and why it may rewrite data;
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
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise'
import * as migrations from '../server/db/migrations-additive.ts'

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

/** The `init.ts` half of a container start, in process — what `npm run db:init` runs. */
async function bootInit() {
  const { initDb } = await import('../server/db/init.ts')
  assertDisposableDatabase(DB_NAME)
  Object.assign(process.env, { DB_HOST: host, DB_PORT: String(port), DB_USER: user, DB_PASSWORD: password, DB_NAME })
  await initDb()
}

/**
 * The `seed.ts` half. It runs itself on import and ends with `process.exit`, so —
 * like the Dockerfile CMD — it runs as its own process. The admin password is
 * generated per run, checked with the policy the seed enforces, and never printed.
 */
async function bootSeed() {
  assertDisposableDatabase(DB_NAME)
  const { passwordRejectionMessage } = await import('../server/utils/password-policy.ts')
  let adminPassword = ''
  for (let attempt = 0; attempt < 5 && !adminPassword; attempt += 1) {
    const candidate = `Qx7#${randomBytes(12).toString('base64url')}`
    if (!passwordRejectionMessage(candidate, { username: 'admin' })) adminPassword = candidate
  }
  assert.ok(adminPassword, 'could not generate a password satisfying the policy')
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--import', './scripts/ts-resolver.mjs', 'server/db/seed.ts'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        ...originalEnv,
        DB_HOST: host, DB_PORT: String(port), DB_USER: user, DB_PASSWORD: password, DB_NAME,
        ADMIN_PASSWORD: adminPassword,
        ADMIN_EMAIL: 'upgrade@example.test',
        ...BOOT_SECRETS,
      },
    },
  )
  assert.equal(result.status, 0, `seed.ts failed (exit ${result.status})\n${result.stdout}\n${result.stderr}`)
}

async function boot() {
  await bootInit()
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

// ── Representative rows ───────────────────────────────────────────────────────

type SqlValue = string | number | Buffer | null
type Row = Record<string, SqlValue>
type SeedOverride = { count?: number, why: string, row: (i: number) => Row }

/**
 * Hand-written rows, where a generated value would not be representative or a
 * known one-time conversion should actually fire (so boot 2 can prove it stays
 * done). Every other column of these tables, and every other table, is generated.
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
    why: 'two of the four default roles exist, one custom role; the seed adds the missing defaults only',
    row: i => ({ name: ['superadmin', 'editor', 'biên tập viên địa phương'][i]! }),
  },
  settings: {
    why: 'staff-edited values of keys the seed also defaults — the seed is insert-only',
    row: i => ({ key: ['site_name', 'hotline', 'sitemap_note'][i]!, value: ['Con Đường Hướng Thiện — C11 (đã sửa)', '0912.345.678', null][i]!, group: ['general', 'contact', 'general'][i]! }),
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
  return rows
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
  | { kind: 'inserted', table: string, key: string, row: Cells }
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
    for (const [key, row] of now.rows) if (!old.rows.has(key)) changes.push({ kind: 'inserted', table, key, row })
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
    case 'inserted': return `${change.table} [${change.key}]: row inserted`
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

type BootContext = { before: Snapshot, after: Snapshot, foreignKeysBefore: ForeignKey[] }

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

/** What `repairLegacyMediaUrls` step 1 makes of a `media.url` — each SQL `REPLACE` replaces every occurrence. */
function repairedMediaUrl(url: string): string {
  let value = url
  if (value.startsWith('http://localhost:3000/cdn1')) value = value.replaceAll('http://localhost:3000/', '')
  if (value.startsWith('https://localhost:3000/cdn1')) value = value.replaceAll('https://localhost:3000/', '')
  if (value.startsWith('http://localhost:3000http')) value = value.replaceAll('http://localhost:3000', '')
  if (value.startsWith('https://localhost:3000http')) value = value.replaceAll('https://localhost:3000', '')
  if (!value.startsWith('http') && value.startsWith('cdn1.delify.vn')) value = `https://${value}`
  return value
}

/** Steps 2 and 3 for `articles.content`, with the R2 objects as they stand after step 1. */
function repairedArticleContent(content: string, media: Cells[]): string {
  let value = content
    .replaceAll('http://localhost:3000https://', 'https://')
    .replaceAll('https://localhost:3000https://', 'https://')
    .replaceAll('http://localhost:3000/cdn1.delify.vn', 'https://cdn1.delify.vn')
    .replaceAll('https://localhost:3000/cdn1.delify.vn', 'https://cdn1.delify.vn')
  const urlByFilename = new Map<string, string>()
  for (const row of media) {
    if (row.provider !== 'r2' || !row.filename || !row.url) continue
    urlByFilename.set(row.filename, row.url)
    urlByFilename.set(encodeURIComponent(row.filename), row.url)
  }
  if (!value.includes('/uploads/migrated/media/') || urlByFilename.size === 0) return value
  value = value
    .replace(/https?:\/\/[^\s"'<>]*\/uploads\/[^\s"'<>]*migrated\/media\/([^\s"'<>\]?#]+)/g, (match, name: string) => urlByFilename.get(name) ?? match)
    .replace(/\/uploads\/migrated\/media\/([^\s"'<>\]?#]+)/g, (match, name: string) => urlByFilename.get(name) ?? match)
  return value
}

/**
 * Seed groups whose re-insertion of a deleted default is the bug wave2 D7 fixes.
 * Until then the seed puts a default back into a table staff already curate.
 */
const D7_SEED_GROUPS = new Set(['ai_moderation_rules', 'social_links', 'media_categories', 'content_types', 'categories'])

/**
 * How to recognise a default row: its natural key appears as a quoted literal in
 * the code that seeds it (or it is the singleton row id 1). A boot that inserts
 * anything else into these tables is not "adding a missing default".
 */
const SEED_DEFAULTS: Record<string, { column: string, sources: string[] } | 'singleton'> = {
  roles: { column: 'name', sources: ['server/db/seed.ts'] },
  permissions: { column: 'resource', sources: ['server/db/seed.ts'] },
  users: { column: 'username', sources: ['server/db/seed.ts'] },
  home_sections: { column: 'type', sources: ['server/db/seed.ts'] },
  settings: { column: 'key', sources: ['server/db/seed.ts'] },
  content_types: { column: 'slug', sources: ['server/db/schema-tables/core.ts', 'server/db/seed.ts'] },
  categories: { column: 'slug', sources: ['server/db/schema-tables/content.ts', 'server/db/seed.ts'] },
  media_categories: { column: 'slug', sources: ['server/db/seed.ts'] },
  pages: { column: 'slug', sources: ['server/db/seed.ts'] },
  page_blocks: { column: 'block_type', sources: ['server/db/seed.ts'] },
  chatbot_settings: 'singleton',
  chatbot_small_talk: { column: 'question', sources: ['server/data/chatbot-small-talk-seed.ts'] },
  ai_model_pricing: { column: 'model', sources: ['server/db/seed.ts'] },
  ai_service_configs: { column: 'service_key', sources: ['server/db/seed.ts'] },
  ai_budget_settings: 'singleton',
  ai_providers: { column: 'provider', sources: ['server/db/seed.ts'] },
  ai_moderation_rules: { column: 'pattern', sources: ['server/db/seed.ts'] },
  social_links: { column: 'platform', sources: ['server/db/seed.ts'] },
  languages: { column: 'code', sources: ['server/services/languages.ts'] },
  lang_translations: { column: 'key', sources: ['server/data/default-translations-seed.ts'] },
}

function isSeedDefault(table: string, row: Cells): boolean {
  const rule = SEED_DEFAULTS[table]
  if (!rule) return false
  if (rule === 'singleton') return row.id === '1'
  const value = row[rule.column]
  if (value === null || value === undefined) return false
  return rule.sources.some(path => {
    const source = readSource(path)
    return [`'${value}'`, `"${value}"`, `\`${value}\``].some(literal => source.includes(literal))
  })
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
    source: 'server/db/migrations-additive.ts',
    anchor: /async function repairLegacyMediaUrls\(/,
    reason: 'strips a localhost prefix from CDN URLs and points migrated-media links at their R2 object; the result must be exactly that rewrite (ambiguity handling is wave2 D-SCAN)',
    covers: (change, ctx) => {
      if (isCell(change, 'media', ['url'])) return change.before !== null && change.after === repairedMediaUrl(change.before)
      if (isCell(change, 'articles', ['content'])) return change.before !== null && change.after === repairedArticleContent(change.before, rowsOf(ctx.after, 'media'))
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
    id: 'ddl.default-content-types',
    source: 'server/db/schema-tables/core.ts',
    anchor: /INSERT INTO \\`content_types\\`[\s\S]*?ON DUPLICATE KEY UPDATE \\`slug\\` = \\`slug\\`/,
    reason: 'initDb() inserts the system content types missing by slug — into a table staff curate, that re-adds a deleted one on every boot; fixed by wave2 D7 (moved into seed.ts behind a marker)',
    covers: change => isInsert(change, ['content_types']) && isSeedDefault('content_types', change.row),
  },
  {
    id: 'ddl.default-categories',
    source: 'server/db/schema-tables/content.ts',
    anchor: /INSERT INTO \\`categories\\`[\s\S]*?ON DUPLICATE KEY UPDATE \\`slug\\` = \\`slug\\`/,
    reason: 'initDb() inserts the default article categories missing by slug — same re-adding of a deleted default; fixed by wave2 D7',
    covers: change => isInsert(change, ['categories']) && isSeedDefault('categories', change.row),
  },
  {
    id: 'seed.resurrects-deleted-defaults',
    source: 'server/db/seed.ts',
    anchor: /if \(!existing\) \{\s*await db\.insert\(socialLinks\)/,
    reason: 'seed.ts adds every default missing from a table that already has rows, so a default staff deleted comes back on every boot — fixed by wave2 D7 (seed markers)',
    covers: (change, ctx) => isInsert(change, D7_SEED_GROUPS) && hadRows(ctx.before, change.table) && isSeedDefault(change.table, change.row),
  },
  {
    id: 'seed.insert-missing-defaults',
    source: 'server/db/seed.ts',
    anchor: /const keepExisting = \(column: string\) => sql\.raw/,
    reason: 'seed.ts is insert-only: it adds the default rows that are missing (a fresh group, a new settings key or translation) and never updates or deletes one',
    covers: (change, ctx) => change.kind === 'inserted' && change.table in SEED_DEFAULTS
      && !(D7_SEED_GROUPS.has(change.table) && hadRows(ctx.before, change.table)) && isSeedDefault(change.table, change.row),
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
  for (const table of ['analytics_live_minute_buckets', 'chatbot_knowledge_terms', 'reader_accounts', 'media_items', 'submissions', 'pages', 'lang_translations', 'media', 'articles', 'categories', 'content_types']) {
    assert.ok(touched.includes(table), `the migration parser no longer finds ${table}`)
  }
  for (const table of Object.keys(SEED_OVERRIDES)) assert.ok(previousTables.has(table), `SEED_OVERRIDES names ${table}, which the previous release does not have`)

  const seeded = withReferencedTables(touched, current.previousSchema)
  const rows = buildRows(seeded, current.previousSchema)
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
  for (const table of touched) {
    const expected = SEED_OVERRIDES[table]?.count ?? DEFAULT_ROW_COUNT
    assert.equal(counted.get(table)?.rows.size, expected, `${table} is touched by a boot migration but holds ${counted.get(table)?.rows.size ?? 0} representative rows`)
  }
  t.diagnostic(`tables touched by boot migrations: ${touched.length} (${touched.join(', ')})`)
  t.diagnostic(`seeded with referenced parents: ${seeded.length} tables, ${[...rows.values()].reduce((n, r) => n + r.length, 0)} rows`)
  if (newTables.length) t.diagnostic(`tables the new release creates (nothing previous to preserve): ${newTables.join(', ')}`)
  current.touched = touched
  current.seededRows = rows
})

test('boot 1 on the previous release keeps every row except the declared one-time conversions', { skip: !enabled, timeout: 300_000 }, async (t) => {
  const current = requireState('boot 1')
  assert.ok(current.touched.length > 0, 'nothing was seeded')
  const beforeBoot = await snapshot()
  await boot()
  const afterBoot = await snapshot()

  const autoUpdated = new Set<string>()
  for (const [table, info] of current.previousSchema.tables) {
    for (const column of info.columns) if (column.extra.includes('on update current_timestamp')) autoUpdated.add(`${table}.${column.name}`)
  }
  const changes = diffSnapshots(beforeBoot, afterBoot)
  const { fired, undeclared } = classify(changes, { before: beforeBoot, after: afterBoot, foreignKeysBefore: current.previousSchema.foreignKeys }, autoUpdated)
  assert.equal(undeclared.length, 0, `${undeclared.length} write(s) on boot 1 that no declared conversion covers:\n${report(undeclared)}`)

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

test('every declared conversion still names code that exists', { skip: !enabled }, () => {
  const ids = DECLARED_CONVERSIONS.map(conversion => conversion.id)
  assert.equal(new Set(ids).size, ids.length, 'two declared conversions share an id')
  for (const conversion of DECLARED_CONVERSIONS) {
    assert.match(readSource(conversion.source), conversion.anchor, `declared conversion ${conversion.id}: its code is gone from ${conversion.source} — delete the declaration (or re-anchor it if the write moved)`)
  }
})
