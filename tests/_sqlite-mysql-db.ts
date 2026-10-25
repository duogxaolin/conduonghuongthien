/**
 * Real Drizzle MySQL queries, executed on an in-memory SQLite database.
 *
 * The behaviour suites that need "the query is what is being tested" used to hand
 * build a fake for each `select().from().where()` chain (`mfa-concurrency`,
 * `article-id-oracle`). This helper goes one step further: it is Drizzle's own
 * `mysql-proxy` driver, so the code under test builds its statements with the real
 * MySQL query builder and dialect — columns, joins, `WHERE`, `ORDER BY`, `LIMIT`,
 * `SET token_version = token_version + 1` — and only the execution is SQLite. A
 * condition dropped from a `WHERE` reaches rows it should not, exactly as it would
 * on MySQL.
 *
 * What it models, and what it does not:
 *  - Tables are created from the Drizzle definitions, one column per field, with
 *    literal defaults and `DEFAULT CURRENT_TIMESTAMP` for `defaultNow()`. No
 *    NOT NULL, unique or foreign-key constraints: they are not what these suites
 *    pin, and leaving them out keeps fixtures short.
 *  - `db.transaction()` is a real SQLite transaction: a throw inside the callback
 *    rolls every write in it back. While it is open, a write issued on the POOL
 *    object (`db.insert` instead of `tx.insert`) throws — on MySQL that write would
 *    run on another connection and commit on its own, which is the bug the
 *    "audit in the same transaction" rule exists to stop.
 *  - `failNext(pattern)` makes the next statement whose SQL matches throw, so a
 *    suite can break the audit insert and watch what survives.
 *  - JSON columns are decoded on read, as mysql2 does. Statements outside the
 *    dialect subset SQLite shares with MySQL (`ON DUPLICATE KEY`, `now()`) throw
 *    rather than being approximated.
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { getTableColumns, getTableName, SQL } from 'drizzle-orm'
import type { MySqlTable } from 'drizzle-orm/mysql-core'
import { drizzle } from 'drizzle-orm/mysql-proxy'

type Method = 'all' | 'execute'
type ProxyResult = { rows: unknown[] }

function sqliteLiteral(value: unknown): string {
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number') return String(value)
  return `'${String(value).replace(/'/g, "''")}'`
}

function toSqliteParam(value: unknown): SQLInputValue {
  if (value === undefined || value === null) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value instanceof Date) return value.toISOString().slice(0, -1).replace('T', ' ')
  if (typeof value === 'object' && !(value instanceof Uint8Array)) return JSON.stringify(value)
  return value as SQLInputValue
}

/** Split `a, b, (c, d)` at top-level commas. */
function splitTopLevel(list: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of list) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === ',' && depth === 0) { parts.push(current.trim()); current = ''; continue }
    current += char
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

export type SqliteMysqlDb = ReturnType<typeof createSqliteMysqlDb>

export function createSqliteMysqlDb(tables: MySqlTable[]) {
  const sqlite = new DatabaseSync(':memory:')

  for (const table of tables) {
    const definitions = Object.values(getTableColumns(table)).map((column) => {
      const sqlType = column.getSQLType().split('(')[0]!.toUpperCase()
      if (column.primary && column.autoIncrement) return `\`${column.name}\` INTEGER PRIMARY KEY`
      let definition = `\`${column.name}\` ${sqlType}`
      if (column.primary) definition += ' PRIMARY KEY'
      if (column.hasDefault && column.default !== undefined) {
        if (column.default instanceof SQL) {
          if (sqlType === 'TIMESTAMP' || sqlType === 'DATETIME') definition += ' DEFAULT CURRENT_TIMESTAMP'
        } else {
          definition += ` DEFAULT ${sqliteLiteral(column.default)}`
        }
      }
      return definition
    })
    sqlite.exec(`CREATE TABLE \`${getTableName(table)}\` (${definitions.join(', ')})`)
  }

  const failures: RegExp[] = []
  const statements: string[] = []

  function maybeFail(sql: string) {
    const index = failures.findIndex(pattern => pattern.test(sql))
    if (index >= 0) {
      failures.splice(index, 1)
      throw new Error(`injected failure: ${sql}`)
    }
  }

  /** MySQL `insert … values (default, ?, …)` → one SQLite insert per row, defaults omitted. */
  function runInsert(sql: string, params: unknown[]): ProxyResult {
    const match = /^insert(?: ignore)? into (`[^`]+`) \((.*?)\) values (.*)$/s.exec(sql)
    if (!match) throw new Error(`unsupported insert for the SQLite harness: ${sql}`)
    const [, tableName, columnList, valuesList] = match
    const columns = splitTopLevel(columnList!)
    const rows = splitTopLevel(valuesList!).map((tuple) => {
      if (!tuple.startsWith('(') || !tuple.endsWith(')')) throw new Error(`unsupported insert values: ${sql}`)
      return splitTopLevel(tuple.slice(1, -1))
    })
    let cursor = 0
    let affectedRows = 0
    let insertId = 0
    for (const row of rows) {
      const names: string[] = []
      const values: SQLInputValue[] = []
      row.forEach((token, index) => {
        if (token === 'default') return
        if (token !== '?') throw new Error(`unsupported insert value "${token}": ${sql}`)
        names.push(columns[index]!)
        values.push(toSqliteParam(params[cursor]))
        cursor += 1
      })
      const statement = names.length
        ? `INSERT INTO ${tableName} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`
        : `INSERT INTO ${tableName} DEFAULT VALUES`
      const result = sqlite.prepare(statement).run(...values)
      affectedRows += Number(result.changes)
      insertId = insertId || Number(result.lastInsertRowid)
    }
    return { rows: [{ insertId, affectedRows }] }
  }

  async function execute(sql: string, params: unknown[], method: Method): Promise<ProxyResult> {
    statements.push(sql)
    maybeFail(sql)
    if (/on duplicate key/i.test(sql)) throw new Error(`unsupported statement for the SQLite harness: ${sql}`)
    if (/^insert/i.test(sql)) return runInsert(sql, params)

    const statement = sqlite.prepare(sql.replace(/ for update$/, ''))
    const bound = params.map(toSqliteParam)
    if (method === 'all') {
      const columns = statement.columns()
      statement.setReturnArrays(true)
      const rows = (statement.all(...bound) as unknown as unknown[][]).map(row => row.map((value, index) => (
        columns[index]?.type === 'JSON' && typeof value === 'string' ? JSON.parse(value) : value
      )))
      return { rows }
    }
    const result = statement.run(...bound)
    return { rows: [{ insertId: Number(result.lastInsertRowid), affectedRows: Number(result.changes) }] }
  }

  const base = drizzle(execute)
  const tx = drizzle(execute)
  let transactionOpen = false

  async function transaction<T>(callback: (handle: typeof tx) => Promise<T>): Promise<T> {
    if (transactionOpen) throw new Error('nested transaction in the SQLite harness')
    sqlite.exec('BEGIN')
    transactionOpen = true
    try {
      const result = await callback(tx)
      sqlite.exec('COMMIT')
      return result
    } catch (error) {
      sqlite.exec('ROLLBACK')
      throw error
    } finally {
      transactionOpen = false
    }
  }

  const db = new Proxy(base, {
    get(target, property) {
      if (property === 'transaction') return transaction
      if (transactionOpen && (property === 'insert' || property === 'update' || property === 'delete')) {
        return () => {
          throw new Error(`db.${String(property)}() on the pool while a transaction is open — on MySQL it would commit on its own connection`)
        }
      }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })

  /** Every row of a table, keyed by Drizzle field name, decoded as the app would read it. */
  function rows<T extends MySqlTable>(table: T): Array<Record<string, unknown>> {
    const columns = getTableColumns(table)
    const raw = sqlite.prepare(`SELECT * FROM \`${getTableName(table)}\``).all() as Array<Record<string, unknown>>
    return raw.map(row => Object.fromEntries(Object.entries(columns).map(([key, column]) => {
      const value = row[column.name]
      if (value === null || value === undefined) return [key, null]
      if (column.getSQLType() === 'json' && typeof value === 'string') return [key, JSON.parse(value)]
      return [key, column.mapFromDriverValue(value)]
    })))
  }

  return {
    sqlite,
    /** What `getDb()` returns. */
    db,
    rows,
    /** The raw SQL of every statement run so far. */
    statements,
    /** The next statement whose SQL matches `pattern` throws. */
    failNext(pattern: RegExp) { failures.push(pattern) },
    reset() {
      failures.length = 0
      statements.length = 0
      for (const table of tables) sqlite.exec(`DELETE FROM \`${getTableName(table)}\``)
    },
  }
}
