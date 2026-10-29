/**
 * Inside a `db.transaction(...)` callback, nothing reaches for the POOL.
 *
 * The pool has `connectionLimit: 10` and waits for a free connection without a limit. A
 * transaction holds one connection; a read on `getDb()` inside it asks for a SECOND. Ten such
 * transactions at once hold all ten and each waits for an eleventh forever — with their row
 * locks held, and every unrelated request of the app queued behind them. That is what ten
 * bans of ten different readers did on MySQL 8 (verifier H2: 0/10 finished, an unrelated
 * SELECT unanswered after 19 s), because `banReader` counted the comments with
 * `countReaderCommentImpact` (pool) inside its transaction; the comment purge had done the
 * same through `deleteReaderComments` since the base.
 *
 * Two layers, because the bug was an INDIRECT call:
 *   - this static scan: no `getDb()` / `getPool()` / `pool.query|execute(` written in a
 *     transaction body, and the helpers that fall back to the pool when no executor is given
 *     (`POOL_FALLBACK_HELPERS`) are always given one there;
 *   - the SQLite harness (`_sqlite-mysql-db.ts`) throws on a pool `select` or `execute` while
 *     a transaction is open — which catches a call through any depth of helpers in every suite
 *     that runs the code (the reader suite went red on the base for ban and purge); the last
 *     test below pins that the harness does.
 * Text, not behaviour: the scan proves the shape, the harness and the MySQL replay
 * (docs/test-coverage-baseline-2026-10.md, "Lát R6") prove the rest.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : []
  })
}

/** Index of the `)` closing the `(` at `open`, by parenthesis counting. */
function closingParen(source: string, open: number): number {
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1
    else if (source[i] === ')' && --depth === 0) return i
  }
  return source.length
}

/** The arguments between the `(` at `open` and its `)`, split at top-level commas. */
function callArguments(source: string, open: number): string[] {
  const inner = source.slice(open + 1, closingParen(source, open))
  const args: string[] = []
  let depth = 0
  let current = ''
  for (const char of inner) {
    if ('([{'.includes(char)) depth += 1
    if (')]}'.includes(char)) depth -= 1
    if (char === ',' && depth === 0) { args.push(current); current = '' } else current += char
  }
  if (current.trim()) args.push(current)
  return args
}

/**
 * Where a transaction callback starts: `.transaction(` with any arrow form — `async (tx) =>`,
 * `async tx =>` (verifier V3-23: the parenthesised form alone let the other through), a block or
 * an expression body. The whole call argument is scanned, by parenthesis counting.
 */
const TRANSACTION_ENTRY = /\.transaction\((?=\s*async\s*(?:\(|\w+\s*=>))/
const transactionEntries = (source: string) => source.matchAll(new RegExp(TRANSACTION_ENTRY.source, 'g'))

/** Helpers whose last parameter is an executor and whose default is the pool. */
const POOL_FALLBACK_HELPERS = ['countReaderCommentImpact', 'deleteReaderComments']

function violations(files: Array<{ path: string, source: string }>): string[] {
  const out: string[] = []
  for (const { path, source } of files) {
    for (const match of transactionEntries(source)) {
      const open = match.index! + match[0].length - 1
      const offset = open + 1
      const body = source.slice(offset, closingParen(source, open))
      const lineOf = (index: number) => source.slice(0, offset + index).split('\n').length
      for (const hit of body.matchAll(/\bgetDb\(\)|\bgetPool\(\)|\bpool\.(?:query|execute)\(/g)) {
        out.push(`${path}:${lineOf(hit.index!)} ${hit[0]} inside a transaction`)
      }
      for (const name of POOL_FALLBACK_HELPERS) {
        // Arguments by parenthesis counting: `countReaderCommentImpact(Number(id))` has one
        // (verifier V3-24 — a `[^()]*` pattern skipped every call with a nested parenthesis).
        for (const call of body.matchAll(new RegExp(`\\b${name}\\(`, 'g'))) {
          const args = callArguments(body, call.index! + call[0].length - 1)
          if (args.length < 2) out.push(`${path}:${lineOf(call.index!)} ${name}(${args.join(',')}) without the transaction — it reads on the pool`)
        }
      }
    }
  }
  return out
}

const SERVER = walk('server').map(path => ({ path, source: readFileSync(path, 'utf8') }))

test('no transaction callback under server/ reaches for the pool, directly or through a pool-default helper', () => {
  assert.ok(SERVER.some(({ source }) => TRANSACTION_ENTRY.test(source)), 'the scan found no transaction at all')
  // The reader moderation transactions, under their deadlock retry, are among those scanned.
  assert.ok(SERVER.some(({ path, source }) => path.endsWith('services/readers.ts') && /withDeadlockRetry\(\(\) => db\.transaction\(async/.test(source)))
  assert.deepEqual(violations(SERVER), [])
})

test('the scan bites: each injected shape is reported', () => {
  const inject = (body: string, opening = 'await db.transaction(async (tx) => {') => violations([{ path: 'x.ts', source: `${opening}\n  ${body}\n})` }])
  assert.equal(inject('const [row] = await getDb().select().from(t)').length, 1)
  assert.equal(inject('await getPool().query("select 1")').length, 1)
  assert.equal(inject('await pool.execute(sql)').length, 1)
  assert.equal(inject('const impact = await countReaderCommentImpact(params.readerId)').length, 1)
  assert.equal(inject('const impact = await deleteReaderComments(id)').length, 1)
  assert.deepEqual(inject('const impact = await countReaderCommentImpact(params.readerId, tx)'), [])
  assert.deepEqual(inject('const [row] = await tx.select().from(t)'), [])
  // V3-23: an arrow without parentheses; a transaction under the deadlock retry.
  assert.equal(inject('const [row] = await getDb().select().from(t)', 'await db.transaction(async tx => {').length, 1)
  assert.equal(inject('await countReaderCommentImpact(id)', 'await withDeadlockRetry(() => db.transaction(async (tx) => {').length, 1)
  // V3-24: a nested parenthesis in the arguments, with and without the transaction.
  assert.equal(inject('const impact = await countReaderCommentImpact(Number(id))').length, 1)
  assert.deepEqual(inject('const impact = await countReaderCommentImpact(Number(id), tx)'), [])
  // An expression-bodied callback.
  assert.equal(violations([{ path: 'x.ts', source: 'await db.transaction(async tx => countReaderCommentImpact(Number(id)))' }]).length, 1)
})

test('the SQLite harness refuses a pool read — select or raw execute — while a transaction is open', async () => {
  const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
  const { sql } = await import('drizzle-orm')
  const { readerAccounts } = await import('../server/db/schema')
  const harness = createSqliteMysqlDb([readerAccounts])
  const { db } = harness
  const counted = await db.transaction(async (tx) => {
    assert.throws(() => db.select({ id: readerAccounts.id }).from(readerAccounts), /exhausts the pool/)
    assert.throws(() => db.execute(sql`select 1`), /exhausts the pool/)
    assert.throws(() => db.insert(readerAccounts), /commit on its own connection/)
    // On the transaction itself, reads run.
    return (await tx.select({ id: readerAccounts.id }).from(readerAccounts)).length
  })
  assert.equal(counted, 0)
  // Once it has closed, the pool reads again.
  assert.deepEqual(await db.select({ id: readerAccounts.id }).from(readerAccounts), [])
  await db.execute(sql`select 1`)
})
