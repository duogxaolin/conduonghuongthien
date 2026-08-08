/**
 * Schema drift checker.
 *
 * The project describes its database in two places that must agree:
 *   • server/db/schema.ts  — Drizzle definitions (types + drizzle-kit source)
 *   • server/db/init.ts    — the DDL that actually runs at startup
 *
 * They drifted apart historically (a missing FK, a TIMESTAMP/DATETIME mismatch),
 * which is invisible until something breaks at runtime. This script compares the
 * table and column names declared on both sides and fails loudly on a mismatch.
 *
 * Run with: npm run db:drift
 *
 * It compares three things per column: presence, SQL TYPE, and NULLability.
 *
 * Name-level comparison alone was not enough, and that gap was not theoretical.
 * When type checking was added, it immediately found three real mismatches that
 * had passed this gate for as long as it had existed: `categories.display_order`,
 * `content_types.display_order` and `content_types.is_system` were `NOT NULL` in
 * the DDL that actually runs but nullable in the Drizzle definitions. Drizzle
 * hands its column types to TypeScript, so `T | null` was being threaded through
 * the application for three columns that can never be null — every read of them
 * carried a null branch that is dead code, and any write relying on the schema
 * saying "nullable" would have been rejected by the database at runtime.
 *
 * A gate that reports success while three columns disagree is worse than no gate:
 * it converts "nobody checked" into "somebody checked and it was fine".
 *
 * Deliberately NOT re-implementing a full MySQL parser. It normalises to a coarse
 * type family (VARCHAR(64) and VARCHAR(255) are both `varchar`) because the drift
 * that bites is int-vs-bigint and TIMESTAMP-vs-DATETIME, not a length change —
 * and a checker too clever to be trusted gets switched off.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import * as schema from '../server/db/schema'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** One column's comparable shape: coarse SQL type family + nullability. */
type ColumnShape = { type: string; nullable: boolean }
type TableShape = { table: string; columns: Map<string, ColumnShape> }

/**
 * Drizzle column class → the MySQL type family it produces.
 *
 * An unmapped class is reported rather than skipped: silently ignoring a type
 * this table does not know about is how a checker starts passing for the wrong
 * reason.
 */
const DRIZZLE_TO_SQL: Record<string, string> = {
  MySqlInt: 'int', MySqlSerial: 'bigint', MySqlBigInt53: 'bigint', MySqlBigInt64: 'bigint',
  MySqlSmallInt: 'smallint', MySqlMediumInt: 'mediumint', MySqlTinyInt: 'tinyint',
  MySqlBoolean: 'tinyint', MySqlVarChar: 'varchar', MySqlChar: 'char',
  MySqlText: 'text', MySqlJson: 'json', MySqlDecimal: 'decimal',
  MySqlDouble: 'double', MySqlFloat: 'float', MySqlTimestamp: 'timestamp',
  MySqlDateTime: 'datetime', MySqlDate: 'date', MySqlDateString: 'date',
  MySqlTime: 'time', MySqlYear: 'year', MySqlEnumColumn: 'enum',
  MySqlBinary: 'binary', MySqlVarBinary: 'varbinary',
}

/**
 * Collapse a DDL type to its family: `VARCHAR(255)` → `varchar`, `TINYINT(1)` →
 * `tinyint`. TEXT variants collapse together because Drizzle models them all as
 * `text()` — flagging LONGTEXT against `text` would be noise with no fix.
 */
function normaliseSqlType(raw: string): string {
  const base = raw.trim().toLowerCase().replace(/\(.*$/, '').split(/\s+/)[0]
  if (base === 'tinytext' || base === 'mediumtext' || base === 'longtext') return 'text'
  return base
}

/** Columns declared in schema.ts, read through Drizzle's runtime metadata. */
function fromSchemaTs(unmapped: Set<string>): Map<string, TableShape> {
  const out = new Map<string, TableShape>()
  for (const value of Object.values(schema as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const symbols = Object.getOwnPropertySymbols(value)
    const nameSymbol = symbols.find(s => s.description === 'drizzle:Name')
    const columnsSymbol = symbols.find(s => s.description === 'drizzle:Columns')
    if (!nameSymbol || !columnsSymbol) continue
    /**
     * Drizzle giữ tên bảng và bản đồ cột dưới **symbol nội bộ**, không phải khoá
     * chuỗi — nên không có kiểu công khai nào để đọc chúng. Khai đúng hình dạng
     * cần dùng (thay cho `as any`) để một lần đổi cấu trúc cột của Drizzle làm
     * cổng này đỏ, chứ không âm thầm đọc `undefined` rồi báo "không lệch gì".
     */
    const internals = value as unknown as Record<symbol, unknown>
    const table = internals[nameSymbol] as string
    const columns = new Map<string, ColumnShape>()
    const columnMap = internals[columnsSymbol] as Record<string, DrizzleColumnInternals>
    for (const column of Object.values(columnMap)) {
      const mapped = DRIZZLE_TO_SQL[column.constructor.name]
      if (!mapped) unmapped.add(column.constructor.name)
      columns.set(column.name, {
        type: mapped ?? '?',
        // A primary key is NOT NULL in MySQL whether or not it says so.
        nullable: !column.notNull && !column.primary,
      })
    }
    out.set(table, { table, columns })
  }
  return out
}

/**
 * Cột do DDL khởi động tạo ra: thân `CREATE TABLE` + các lượt di trú bổ sung.
 *
 * Đọc **hai** tệp, và đó là điều kiện tiên quyết chứ không phải sự tiện lợi:
 * `init.ts` giữ các câu `CREATE TABLE` còn `migrations-additive.ts` giữ các lượt
 * `ensureColumn`. Đọc mỗi `init.ts` là bỏ qua đúng nhóm cột **mới nhất** — những
 * cột chỉ tồn tại dưới dạng một lượt `ALTER` vì bảng đã có dữ liệu của cơ quan
 * trên đó (`articles.comments_enabled`, `chat_sessions.reader_id` là hai ví dụ).
 * Và đó là nhóm dễ lệch nhất, nên miễn trừ chúng là làm cổng này vô nghĩa ở đúng
 * chỗ nó cần chặt nhất. Ghép nối chuỗi trước khi phân tích: hai tệp là một nguồn
 * DDL, và một biểu thức chính quy chạy trên chuỗi ghép không cần biết ranh giới.
 */
function fromInitTs(): Map<string, TableShape> {
  const source = [
    readFileSync(path.join(root, 'server/db/init.ts'), 'utf8'),
    readFileSync(path.join(root, 'server/db/migrations-additive.ts'), 'utf8'),
  ].join('\n')
  const out = new Map<string, TableShape>()

  /** `\`col\` TYPE ...rest` → the shape, or null if the line is not a column. */
  function parseColumn(line: string): [string, ColumnShape] | null {
    const match = /^\s*\\`([a-z_]+)\\`\s+([A-Za-z]+(?:\([^)]*\))?)\s*(.*)$/.exec(line)
    if (!match) return null
    const rest = match[3].toUpperCase()
    return [match[1], {
      type: normaliseSqlType(match[2]),
      // AUTO_INCREMENT implies a key, and PRIMARY KEY columns are never nullable.
      nullable: !/\bNOT NULL\b/.test(rest) && !/\bPRIMARY KEY\b/.test(rest) && !/\bAUTO_INCREMENT\b/.test(rest),
    }]
  }

  const createRe = /CREATE TABLE IF NOT EXISTS \\`([a-z_]+)\\`\s*\(([\s\S]*?)\n\s*\) ENGINE/g
  let match: RegExpExecArray | null
  while ((match = createRe.exec(source))) {
    const columns = new Map<string, ColumnShape>()
    for (const line of match[2].split('\n')) {
      const parsed = parseColumn(line)
      if (parsed) columns.set(parsed[0], parsed[1])
    }
    out.set(match[1], { table: match[1], columns })
  }

  /**
   * Additive columns applied to databases that already exist. Their definition
   * string is parsed with the same rules as a CREATE TABLE line, so a column
   * added by migration is held to the same standard as one declared up front —
   * otherwise the newest columns, which are the likeliest to drift, would be the
   * only ones exempt.
   */
  function addMigrated(table: string, column: string, definition: string | undefined) {
    const entry = out.get(table)
    if (!entry) return
    const shape = definition
      ? parseColumn('  \\`' + column + '\\` ' + definition)?.[1]
      : undefined
    entry.columns.set(column, shape ?? { type: '?', nullable: entry.columns.get(column)?.nullable ?? true })
  }

  // Định nghĩa nhận CẢ HAI kiểu nháy. Phần `"([^"]*)"` không phải để cho đủ bộ:
  // một định nghĩa chứa giá trị mặc định dạng chuỗi — `VARCHAR(24) NOT NULL DEFAULT
  // 'new'` — **buộc** phải viết trong nháy kép ở TypeScript, nên bản chỉ đọc nháy
  // đơn bỏ qua đúng nhóm cột đó. Đo được trên chính repo này: bốn cột dùng nháy kép
  // (`submissions.status`, `chatbot_settings.mode`, `.out_of_scope_behavior`,
  // `.lead_capture_enabled`) và **không cột nào** được biểu thức này nhìn thấy.
  // Ba cột chatbot chỉ thoát báo động nhờ có mặt trong `chatbotColumnMigrations`,
  // tức là một đường đăng ký khác — không phải nhờ cổng này làm việc.
  const ensureRe = /ensureColumn\(\s*db,\s*database,\s*'([a-z_]+)',\s*'([a-z_]+)',\s*(?:'([^']*)'|"([^"]*)")/g
  while ((match = ensureRe.exec(source))) addMigrated(match[1], match[2], match[3] ?? match[4])
  // ensureColumn calls that pass the definition some other way still register the column.
  const ensureBareRe = /ensureColumn\(\s*db,\s*database,\s*'([a-z_]+)',\s*'([a-z_]+)'\s*\)/g
  while ((match = ensureBareRe.exec(source))) addMigrated(match[1], match[2], undefined)

  const migrationRe = /\{\s*table:\s*'([a-z_]+)',\s*column:\s*'([a-z_]+)',\s*definition:\s*'([^']*)'/g
  while ((match = migrationRe.exec(source))) addMigrated(match[1], match[2], match[3])
  const migrationBareRe = /\{\s*table:\s*'([a-z_]+)',\s*column:\s*'([a-z_]+)'(?![^}]*definition)/g
  while ((match = migrationBareRe.exec(source))) addMigrated(match[1], match[2], undefined)

  // Tuple-driven optional columns: ['table', 'column', 'DEFINITION']. The same
  // tuple shape is used for indexes, so only a SQL column type is accepted.
  const COLUMN_TYPE = /^\s*(VARCHAR|CHAR|TINYINT|SMALLINT|MEDIUMINT|INT|BIGINT|DECIMAL|FLOAT|DOUBLE|BOOLEAN|TEXT|TINYTEXT|MEDIUMTEXT|LONGTEXT|BLOB|JSON|DATE|DATETIME|TIMESTAMP|TIME|YEAR|ENUM|SET)\b/i
  const tupleRe = /\[\s*'([a-z_]+)',\s*'([a-z_]+)',\s*'([^']*)'\s*\]/g
  while ((match = tupleRe.exec(source))) {
    if (!COLUMN_TYPE.test(match[3])) continue
    addMigrated(match[1], match[2], match[3])
  }
  return out
}

function main() {
  const unmapped = new Set<string>()
  const declared = fromSchemaTs(unmapped)
  const created = fromInitTs()
  const problems: string[] = []
  let comparedColumns = 0

  for (const [table, shape] of declared) {
    const other = created.get(table)
    if (!other) { problems.push(`Bảng "${table}" có trong schema.ts nhưng KHÔNG được tạo trong init.ts`); continue }
    for (const [column, want] of shape.columns) {
      const got = other.columns.get(column)
      if (!got) { problems.push(`Cột "${table}.${column}" có trong schema.ts nhưng thiếu trong init.ts`); continue }
      comparedColumns++
      // '?' means one side could not be parsed; comparing against it would
      // manufacture a mismatch out of the checker's own blind spot.
      if (want.type !== '?' && got.type !== '?' && want.type !== got.type) {
        problems.push(`Cột "${table}.${column}" LỆCH KIỂU: schema.ts=${want.type} ↔ init.ts=${got.type}`)
      }
      if (want.nullable !== got.nullable) {
        problems.push(
          `Cột "${table}.${column}" LỆCH NULL: schema.ts=${want.nullable ? 'nullable' : 'NOT NULL'}`
          + ` ↔ init.ts=${got.nullable ? 'nullable' : 'NOT NULL'}`
          + ` — Drizzle đẩy kiểu này sang TypeScript, nên hai bên lệch nghĩa là mã ứng dụng đang tin một hình dạng mà CSDL từ chối`,
        )
      }
    }
  }
  for (const [table, shape] of created) {
    const other = declared.get(table)
    if (!other) { problems.push(`Bảng "${table}" được tạo trong init.ts nhưng KHÔNG khai trong schema.ts`); continue }
    for (const column of shape.columns.keys()) {
      if (!other.columns.has(column)) problems.push(`Cột "${table}.${column}" được tạo trong init.ts nhưng thiếu trong schema.ts`)
    }
  }

  console.log(`Đã đối chiếu ${declared.size} bảng (schema.ts) với ${created.size} bảng (init.ts).`)
  console.log(`Đã so kiểu và tính NULL của ${comparedColumns} cột.`)
  if (unmapped.size > 0) {
    // Not a failure — but it must be visible, or the checker quietly stops
    // checking whichever column types it has never met.
    console.log(`⚠️  Kiểu Drizzle chưa map (bỏ qua phần so kiểu): ${[...unmapped].join(', ')}`)
  }
  if (problems.length === 0) {
    console.log('✅ Không phát hiện lệch schema.')
    process.exit(0)
  }
  console.error(`\n❌ Phát hiện ${problems.length} điểm lệch:`)
  for (const problem of problems) console.error('  • ' + problem)
  process.exit(1)
}

main()
