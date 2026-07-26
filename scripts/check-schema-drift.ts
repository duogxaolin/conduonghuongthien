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
 * It is intentionally a *name-level* comparison: it catches added/removed tables
 * and columns (the drift that actually bites) without trying to re-implement a
 * full MySQL type parser.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import * as schema from '../server/db/schema'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

type TableShape = { table: string; columns: Set<string> }

/** Columns declared in schema.ts, read through Drizzle's runtime metadata. */
function fromSchemaTs(): Map<string, TableShape> {
  const out = new Map<string, TableShape>()
  for (const value of Object.values(schema as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const symbols = Object.getOwnPropertySymbols(value)
    const nameSymbol = symbols.find(s => s.description === 'drizzle:Name')
    const columnsSymbol = symbols.find(s => s.description === 'drizzle:Columns')
    if (!nameSymbol || !columnsSymbol) continue
    const table = (value as any)[nameSymbol] as string
    const columns = new Set<string>(
      Object.values((value as any)[columnsSymbol] as Record<string, any>).map((c: any) => c.name),
    )
    out.set(table, { table, columns })
  }
  return out
}

/** Columns created by init.ts: CREATE TABLE bodies + ensureColumn() calls. */
function fromInitTs(): Map<string, TableShape> {
  const source = readFileSync(path.join(root, 'server/db/init.ts'), 'utf8')
  const out = new Map<string, TableShape>()

  const createRe = /CREATE TABLE IF NOT EXISTS \\`([a-z_]+)\\`\s*\(([\s\S]*?)\n\s*\) ENGINE/g
  let match: RegExpExecArray | null
  while ((match = createRe.exec(source))) {
    const table = match[1]
    const columns = new Set<string>()
    for (const line of match[2].split('\n')) {
      const col = /^\s*\\`([a-z_]+)\\`\s+[A-Za-z]/.exec(line)
      if (col) columns.add(col[1])
    }
    out.set(table, { table, columns })
  }

  // Additive columns applied to existing databases.
  const ensureRe = /ensureColumn\(\s*db,\s*database,\s*'([a-z_]+)',\s*'([a-z_]+)'/g
  while ((match = ensureRe.exec(source))) {
    const entry = out.get(match[1])
    if (entry) entry.columns.add(match[2])
  }
  // Table-driven column migrations: { table: 'x', column: 'y', ... }
  const migrationRe = /\{\s*table:\s*'([a-z_]+)',\s*column:\s*'([a-z_]+)'/g
  while ((match = migrationRe.exec(source))) {
    const entry = out.get(match[1])
    if (entry) entry.columns.add(match[2])
  }
  // Tuple-driven optional columns: ['table', 'column', 'DEFINITION'].
  // The same tuple shape is also used for index definitions, so only accept a
  // definition that begins with a SQL column type — otherwise an index name
  // would be mistaken for a column.
  const COLUMN_TYPE = /^\s*(VARCHAR|CHAR|TINYINT|SMALLINT|MEDIUMINT|INT|BIGINT|DECIMAL|FLOAT|DOUBLE|BOOLEAN|TEXT|TINYTEXT|MEDIUMTEXT|LONGTEXT|BLOB|JSON|DATE|DATETIME|TIMESTAMP|TIME|YEAR|ENUM|SET)\b/i
  const tupleRe = /\[\s*'([a-z_]+)',\s*'([a-z_]+)',\s*'([^']*)'\s*\]/g
  while ((match = tupleRe.exec(source))) {
    if (!COLUMN_TYPE.test(match[3])) continue
    const entry = out.get(match[1])
    if (entry) entry.columns.add(match[2])
  }
  return out
}

function main() {
  const declared = fromSchemaTs()
  const created = fromInitTs()
  const problems: string[] = []

  for (const [table, shape] of declared) {
    const other = created.get(table)
    if (!other) { problems.push(`Bảng "${table}" có trong schema.ts nhưng KHÔNG được tạo trong init.ts`); continue }
    for (const column of shape.columns) {
      if (!other.columns.has(column)) problems.push(`Cột "${table}.${column}" có trong schema.ts nhưng thiếu trong init.ts`)
    }
  }
  for (const [table, shape] of created) {
    const other = declared.get(table)
    if (!other) { problems.push(`Bảng "${table}" được tạo trong init.ts nhưng KHÔNG khai trong schema.ts`); continue }
    for (const column of shape.columns) {
      if (!other.columns.has(column)) problems.push(`Cột "${table}.${column}" được tạo trong init.ts nhưng thiếu trong schema.ts`)
    }
  }

  console.log(`Đã đối chiếu ${declared.size} bảng (schema.ts) với ${created.size} bảng (init.ts).`)
  if (problems.length === 0) {
    console.log('✅ Không phát hiện lệch schema.')
    process.exit(0)
  }
  console.error(`\n❌ Phát hiện ${problems.length} điểm lệch:`)
  for (const problem of problems) console.error('  • ' + problem)
  process.exit(1)
}

main()
