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
 *    "audit in the same transaction" rule exists to stop. A pool READ while it is open
 *    throws too: on MySQL it takes a second connection, and with every connection of
 *    the pool held by an open transaction each waits for one more forever (verifier H2).
 *    What SQLite cannot show — one connection, no row locks, no pool — is lock ORDER and
 *    contention; `txStatements` pins the order, MySQL replays show the rest.
 *  - `failNext(pattern)` makes the next statement whose SQL matches throw, so a
 *    suite can break the audit insert and watch what survives. `beforeNext(pattern,
 *    fn)` runs `fn` just before the next matching statement — another writer landing
 *    between a read and the write that relies on it. `txStatements` lists what ran
 *    while a transaction was open; `transactionsBegun` counts BEGINs (a deadlock retry
 *    must begin a new transaction per attempt).
 *  - `like ?` gets `escape '\'`, MySQL's default escape character (SQLite has none),
 *    so a pattern escaped for MySQL matches the same rows here.
 *  - JSON columns are decoded on read, as mysql2 does. Statements outside the
 *    dialect subset SQLite shares with MySQL (`now()`, `IF()`) throw rather than
 *    being approximated.
 *  - One form of `ON DUPLICATE KEY UPDATE` is supported, because it has an exact
 *    SQLite twin: a single-row insert whose update list is only `` `col` = ? ``
 *    becomes `ON CONFLICT DO UPDATE SET` with the same assignments. With no unique
 *    index besides the primary key (see above), both fire on the same conflict.
 *    `` `col` = `table`.`col` + ? `` is accepted too: in both dialects the column names
 *    the row already stored. Anything else (`values(col)`, `IF(...)`) throws.
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
  // A JSON column's default (`.default([])`) is stored as its JSON text, as Drizzle sends it.
  const text = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)
  return `'${text.replace(/'/g, "''")}'`
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

  const failures: Array<{ pattern: RegExp, fields?: Record<string, unknown> }> = []
  const hooks: Array<{ pattern: RegExp, run: () => void }> = []
  const statements: string[] = []
  const txStatements: string[] = []
  const txParams: unknown[][] = []

  function maybeFail(sql: string) {
    const hook = hooks.findIndex(each => each.pattern.test(sql))
    if (hook >= 0) hooks.splice(hook, 1)[0]!.run()
    const index = failures.findIndex(each => each.pattern.test(sql))
    if (index >= 0) {
      const [{ fields }] = failures.splice(index, 1) as [{ fields?: Record<string, unknown> }]
      throw Object.assign(new Error(`injected failure: ${sql}`), fields)
    }
  }

  /**
   * `… on duplicate key update `a` = ?, `b` = ?` → the insert part and SQLite's
   * `ON CONFLICT DO UPDATE SET` clause; null when the statement is a plain insert.
   */
  function splitUpsert(sql: string): { insert: string, conflictClause: string } | null {
    const marker = ' on duplicate key update '
    const at = sql.indexOf(marker)
    if (at === -1) return null
    const assignments = splitTopLevel(sql.slice(at + marker.length))
    if (!assignments.length || !assignments.every(assignment => /^`([^`]+)` = (?:\?|`[^`]+`\.`\1` \+ \?)$/.test(assignment))) {
      throw new Error(`unsupported statement for the SQLite harness: ${sql}`)
    }
    return { insert: sql.slice(0, at), conflictClause: ` ON CONFLICT DO UPDATE SET ${assignments.join(', ')}` }
  }

  /** MySQL `insert … values (default, ?, …)` → one SQLite insert per row, defaults omitted. */
  function runInsert(fullSql: string, params: unknown[]): ProxyResult {
    const upsert = splitUpsert(fullSql)
    const sql = upsert ? upsert.insert : fullSql
    const match = /^insert(?: ignore)? into (`[^`]+`) \((.*?)\) values (.*)$/s.exec(sql)
    if (!match) throw new Error(`unsupported insert for the SQLite harness: ${fullSql}`)
    const [, tableName, columnList, valuesList] = match
    const columns = splitTopLevel(columnList!)
    const rows = splitTopLevel(valuesList!).map((tuple) => {
      if (!tuple.startsWith('(') || !tuple.endsWith(')')) throw new Error(`unsupported insert values: ${sql}`)
      return splitTopLevel(tuple.slice(1, -1))
    })
    if (upsert && rows.length !== 1) throw new Error(`unsupported multi-row upsert for the SQLite harness: ${fullSql}`)
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
      if (upsert && !names.length) throw new Error(`unsupported upsert of default values: ${fullSql}`)
      // `insert ignore` skips a row that breaks a unique key, as MySQL's does (a suite that
      // needs the key creates it: this harness leaves unique constraints out).
      const insert = /^insert ignore /.test(sql) ? 'INSERT OR IGNORE' : 'INSERT'
      const statement = names.length
        ? `${insert} INTO ${tableName} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})${upsert?.conflictClause ?? ''}`
        : `${insert} INTO ${tableName} DEFAULT VALUES`
      // The update list's parameters follow the values' in MySQL's order too.
      if (upsert) values.push(...params.slice(cursor).map(toSqliteParam))
      const result = sqlite.prepare(statement).run(...values)
      affectedRows += Number(result.changes)
      // An ignored row has no id (MySQL answers insertId 0); SQLite would repeat the last one.
      if (Number(result.changes) > 0) insertId = insertId || Number(result.lastInsertRowid)
    }
    return { rows: [{ insertId, affectedRows }] }
  }

  async function execute(sql: string, params: unknown[], method: Method): Promise<ProxyResult> {
    statements.push(sql)
    if (transactionOpen) { txStatements.push(sql); txParams.push(params) }
    maybeFail(sql)
    if (/^insert/i.test(sql)) return runInsert(sql, params)
    if (/on duplicate key/i.test(sql)) throw new Error(`unsupported statement for the SQLite harness: ${sql}`)

    // MySQL's LIKE escapes with `\` by default; SQLite's has no escape character unless
    // told. Without this an escaped `\_` would mean "a backslash, then any character".
    const statement = sqlite.prepare(sql.replace(/ for (?:update|share)$/, '').replace(/ like \?/g, " like ? escape '\\'"))
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

  let transactionsBegun = 0
  async function transaction<T>(callback: (handle: typeof tx) => Promise<T>): Promise<T> {
    if (transactionOpen) throw new Error('nested transaction in the SQLite harness')
    transactionsBegun += 1
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
      // A read on the pool while a transaction is open takes a SECOND connection: with the pool's
      // 10 all held by open transactions, each waits for an eleventh forever (verifier H2 — ten
      // bans at once hung the whole app). Reads inside a transaction go through `tx`.
      if (transactionOpen && (property === 'select' || property === 'execute')) {
        return () => {
          throw new Error(`db.${String(property)}() on the pool while a transaction is open — on MySQL a second connection per transaction exhausts the pool`)
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
    /** The raw SQL of every statement run while a transaction was open, and (same index) its parameters. */
    txStatements,
    txParams,
    /** The next statement whose SQL matches `pattern` throws — with `fields` (e.g. `{ errno: 1213 }`) on the error. */
    failNext(pattern: RegExp, fields?: Record<string, unknown>) { failures.push({ pattern, fields }) },
    /** `run` executes (on the same database) just before the next statement whose SQL matches `pattern`. */
    beforeNext(pattern: RegExp, run: () => void) { hooks.push({ pattern, run }) },
    /**
     * How many transactions were begun so far. A deadlock retry has to begin a NEW one per attempt:
     * InnoDB has rolled the victim's back whole, so running the statements again inside the same
     * callback would run them outside any transaction (verifier V4-10).
     */
    get transactionsBegun() { return transactionsBegun },
    reset() {
      transactionsBegun = 0
      failures.length = 0
      hooks.length = 0
      statements.length = 0
      txStatements.length = 0
      txParams.length = 0
      for (const table of tables) sqlite.exec(`DELETE FROM \`${getTableName(table)}\``)
    },
  }
}
