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
 *   - this static scan of every transaction callback under `server/` — written inline in any
 *     function form, or passed by name and found in the same file; on the code only (comments and
 *     string text blanked): no `getDb()` / `getPool()` / `pool.query|execute(`, no use of a name
 *     the file bound to `getDb`/`getPool` (the outer `db` handle, an alias of the getter), and the
 *     helpers that fall back to the pool (`POOL_FALLBACK_HELPERS`) always given a real executor;
 *     a transaction argument of a form it cannot read is reported, not skipped;
 *   - the SQLite harness (`_sqlite-mysql-db.ts`) throws on a pool `select` or `execute` while
 *     a transaction is open — which catches a call through any depth of helpers in every suite
 *     that runs the code (the reader suite went red on the base for ban and purge); the last
 *     test below pins that the harness does.
 * Text, not behaviour: the scan proves the shape, the harness and the MySQL replay
 * (docs/test-coverage-baseline-2026-10.md, "Lát R6") prove the rest. Verifier round 4 (L-1)
 * listed the forms the previous scan missed; each is an injected case below.
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

/**
 * The source with comments, string text, template text and regex literals blanked to spaces —
 * newlines and offsets kept, `${…}` inside a template kept as code. A `)` in a string or a comma
 * in a comment then no longer moves a parenthesis count or an argument split (verifier L-1).
 */
function codeOnly(source: string): string {
  const out = source.split('')
  const blank = (at: number) => { if (out[at] !== '\n') out[at] = ' ' }
  type Mode = 'code' | 'line' | 'block' | 'single' | 'double' | 'template' | 'regex'
  let mode: Mode = 'code'
  let braces = 0
  const templateExpressions: number[] = [] // brace depth at each open `${`
  let inClass = false
  let lastCode = '' // the last non-space code character, to tell a regex from a division
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i]!
    const n = source[i + 1]
    if (mode === 'code') {
      if (c === '/' && n === '/') { mode = 'line'; blank(i); blank(i + 1); i += 1; continue }
      if (c === '/' && n === '*') { mode = 'block'; blank(i); blank(i + 1); i += 1; continue }
      if (c === '/' && (lastCode === '' || '(,=:[!&|?{};+-*%<>~^'.includes(lastCode) || /\b(?:return|typeof|case|in|of)$/.test(source.slice(Math.max(0, i - 8), i).trimEnd()))) {
        mode = 'regex'; inClass = false; continue
      }
      if (c === '\'') { mode = 'single'; continue }
      if (c === '"') { mode = 'double'; continue }
      if (c === '`') { mode = 'template'; continue }
      if (c === '{') braces += 1
      if (c === '}') {
        if (templateExpressions.at(-1) === braces) { templateExpressions.pop(); mode = 'template'; continue }
        braces -= 1
      }
      if (!/\s/.test(c)) lastCode = c
      continue
    }
    if (mode === 'line') { if (c === '\n') mode = 'code'; else blank(i); continue }
    if (mode === 'block') {
      if (c === '*' && n === '/') { blank(i); blank(i + 1); i += 1; mode = 'code' } else blank(i)
      continue
    }
    if (mode === 'regex') {
      if (c === '\\') { blank(i); blank(i + 1); i += 1; continue }
      if (c === '[') inClass = true
      else if (c === ']') inClass = false
      else if (c === '/' && !inClass) { mode = 'code'; lastCode = 'x'; continue }
      blank(i)
      continue
    }
    if (c === '\\') { blank(i); blank(i + 1); i += 1; continue }
    if (mode === 'single' || mode === 'double') {
      if (c === (mode === 'single' ? '\'' : '"')) { mode = 'code'; lastCode = 'x'; continue }
      blank(i)
      continue
    }
    // template text
    if (c === '`') { mode = 'code'; lastCode = 'x'; continue }
    if (c === '$' && n === '{') { templateExpressions.push(braces); i += 1; mode = 'code'; lastCode = '{'; continue }
    blank(i)
  }
  return out.join('')
}

/** Index of the bracket closing the one at `open` (same kind), by counting. */
function closing(code: string, open: number): number {
  const [o, c] = code[open] === '{' ? ['{', '}'] : ['(', ')']
  let depth = 0
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === o) depth += 1
    else if (code[i] === c && --depth === 0) return i
  }
  return code.length
}

/** The arguments between the `(` at `open` and its `)`, split at top-level commas. */
function callArguments(code: string, open: number): string[] {
  const inner = code.slice(open + 1, closing(code, open))
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

/** Every `.transaction(` call, including `.transaction<T>(` (verifier L-1). */
const TRANSACTION_CALL = /\.transaction\s*(?:<[^<>()]*>)?\s*\(/g

/** Helpers whose last parameter is an executor and whose default is the pool. */
const POOL_FALLBACK_HELPERS = ['countReaderCommentImpact', 'deleteReaderComments']

/** A function written in place: `async (tx) =>`, `tx =>`, `(tx) =>`, `async function (tx) {`, `function named(tx) {`. */
const FUNCTION_START = /^(?:async\s+)?(?:function\b\s*[\w$]*\s*\(([^)]*)\)|\(([^)]*)\)\s*(?::[^=]*)?=>|([\w$]+)\s*=>)/

/** The text of the function starting at `at` in `code` (to the end of its body), and its first parameter. */
function functionAt(code: string, at: number): { body: string, param: string | null } | null {
  const head = FUNCTION_START.exec(code.slice(at))
  if (!head) return null
  const param = (head[1] ?? head[2] ?? head[3] ?? '').split(',')[0]!.replace(/[:=].*$/s, '').trim() || null
  let i = at + head[0].length
  // `function f(tx): Promise<void> {` — the body is the next block.
  if (/function\b/.test(head[0])) i = code.indexOf('{', i)
  while (/\s/.test(code[i] ?? '')) i += 1
  if (i >= 0 && code[i] === '{') return { body: code.slice(at, closing(code, i) + 1), param }
  // An expression body: to the first top-level `,` `)` `;` or blank line.
  let depth = 0
  let end = i
  for (; end < code.length; end += 1) {
    const char = code[end]!
    if ('([{'.includes(char)) depth += 1
    else if (')]}'.includes(char)) { if (depth === 0) break; depth -= 1 } else if ((char === ',' || char === ';') && depth === 0) break
  }
  return { body: code.slice(at, end), param }
}

/** The callback a transaction is given: written in place, or a name defined in the same file. */
function transactionCallback(code: string, argument: string, argumentAt: number): { body: string, param: string | null } | null {
  const trimmed = argument.trim()
  const offset = argumentAt + argument.indexOf(trimmed)
  const inline = functionAt(code, offset)
  if (inline) return inline
  if (!/^[A-Za-z_$][\w$]*$/.test(trimmed)) return null
  // A named callback (verifier L-1: `.transaction(work)`): `const work = async (…) => …` or `function work(…)`.
  const asConst = new RegExp(`\\b(?:const|let|var)\\s+${trimmed}\\s*(?::[^=]+)?=\\s*`).exec(code)
  if (asConst) return functionAt(code, asConst.index + asConst[0].length)
  const asFunction = new RegExp(`(?:async\\s+)?function\\s+${trimmed}\\s*\\(`).exec(code)
  if (asFunction) return functionAt(code, asFunction.index)
  return null
}

function violations(files: Array<{ path: string, source: string }>): string[] {
  const out: string[] = []
  for (const { path, source } of files) {
    const code = codeOnly(source)
    const lineOf = (index: number) => source.slice(0, index).split('\n').length
    // Names this file bound to the pool: `const db = getDb()` (a handle) or `const get = getDb` (a getter).
    const handles: string[] = []
    const getters: string[] = []
    for (const bound of code.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*(?::[^=]+)?=\s*(?:await\s+)?(?:getDb|getPool)\b(\s*\()?/g)) {
      (bound[2] ? handles : getters).push(bound[1]!)
    }
    for (const call of code.matchAll(TRANSACTION_CALL)) {
      const open = call.index! + call[0].length - 1
      const [argument] = callArguments(code, open)
      const callback = argument === undefined ? null : transactionCallback(code, argument, open + 1)
      if (!callback) {
        out.push(`${path}:${lineOf(call.index!)} a transaction argument this scan cannot read — write the callback in place or name a function in this file`)
        continue
      }
      const at = code.indexOf(callback.body)
      const report = (index: number, what: string) => out.push(`${path}:${lineOf(at + index)} ${what} inside a transaction`)
      for (const hit of callback.body.matchAll(/\bgetDb\s*\(|\bgetPool\s*\(|\bpool\s*\.\s*(?:query|execute)\s*\(/g)) report(hit.index!, hit[0])
      for (const name of handles.filter(name => name !== callback.param)) {
        for (const hit of callback.body.matchAll(new RegExp(`(?<![\\w$.])${name}\\s*\\.\\s*(?:select|insert|update|delete|execute|query|transaction)\\b`, 'g'))) {
          report(hit.index!, `${hit[0]} (the pool handle, not the transaction)`)
        }
      }
      for (const name of getters.filter(name => name !== callback.param)) {
        for (const hit of callback.body.matchAll(new RegExp(`(?<![\\w$.])${name}\\s*\\(`, 'g'))) report(hit.index!, `${hit[0]} (an alias of the pool getter)`)
      }
      for (const name of POOL_FALLBACK_HELPERS) {
        for (const hit of callback.body.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))) {
          const args = callArguments(callback.body, hit.index! + hit[0].length - 1).map(arg => arg.trim())
          if (args.length < 2 || /^(?:undefined|null|void\s+0)$/.test(args.at(-1)!)) {
            report(hit.index!, `${name}(${args.join(', ')}) without the transaction — it reads on the pool`)
          }
        }
      }
    }
  }
  return out
}

const SERVER = walk('server').map(path => ({ path, source: readFileSync(path, 'utf8') }))

test('no transaction callback under server/ reaches for the pool, directly or through a pool-default helper', () => {
  const calls = SERVER.reduce((sum, { source }) => sum + [...codeOnly(source).matchAll(TRANSACTION_CALL)].length, 0)
  assert.ok(calls > 50, `the scan found ${calls} transaction calls`)
  // The reader moderation transactions, under their deadlock retry, are among those scanned —
  // and so are the two the previous scan skipped (verifier L-1): a callback passed by name, a
  // non-async arrow.
  assert.ok(SERVER.some(({ path, source }) => path.endsWith('services/readers.ts') && /withDeadlockRetry\(\(\) => db\.transaction\(async/.test(source)))
  assert.ok(SERVER.some(({ path, source }) => path.endsWith('services/article-views.ts') && /\.transaction\(write\)/.test(source)))
  assert.ok(SERVER.some(({ path, source }) => path.endsWith('services/backup-restore-recovery.ts') && /\.transaction\(tx => /.test(source)))
  assert.deepEqual(violations(SERVER), [])
})

test('the scan bites: each injected shape is reported', () => {
  const v = (source: string) => violations([{ path: 'x.ts', source }]).length
  const inject = (body: string, opening = 'await db.transaction(async (tx) => {') => v(`${opening}\n  ${body}\n})`)
  assert.equal(inject('const [row] = await getDb().select().from(t)'), 1)
  assert.equal(inject('await getPool().query("select 1")'), 1)
  assert.equal(inject('await pool.execute(sql)'), 1)
  assert.equal(inject('const impact = await countReaderCommentImpact(params.readerId)'), 1)
  assert.equal(inject('const impact = await deleteReaderComments(id)'), 1)
  assert.equal(inject('const impact = await countReaderCommentImpact(params.readerId, tx)'), 0)
  assert.equal(inject('const [row] = await tx.select().from(t)'), 0)
  // V3-23: an arrow without parentheses; a transaction under the deadlock retry.
  assert.equal(inject('const [row] = await getDb().select().from(t)', 'await db.transaction(async tx => {'), 1)
  assert.equal(inject('await countReaderCommentImpact(id)', 'await withDeadlockRetry(() => db.transaction(async (tx) => {'), 1)
  // V3-24: a nested parenthesis in the arguments, with and without the transaction.
  assert.equal(inject('const impact = await countReaderCommentImpact(Number(id))'), 1)
  assert.equal(inject('const impact = await countReaderCommentImpact(Number(id), tx)'), 0)
  // An expression-bodied callback.
  assert.equal(v('await db.transaction(async tx => countReaderCommentImpact(Number(id)))'), 1)
  // Verifier round 4, L-1 — every form its probe found missed:
  assert.equal(inject('const [r] = await getDb().select().from(t)', 'await db.transaction(async function (tx) {'), 1)
  assert.equal(v('await db.transaction((tx) => {\n return getDb().select().from(t)\n})'), 1)
  assert.equal(v('await db.transaction(tx => countReaderCommentImpact(id))'), 1)
  assert.equal(inject('const [r] = await getDb().select().from(t)', 'await db.transaction<number>(async (tx) => {'), 1)
  assert.equal(v('const work = async (tx) => { await getDb().select().from(t) }\nawait db.transaction(work)'), 1)
  assert.equal(v('async function work(tx) { await getDb().select().from(t) }\nawait db.transaction(work)'), 1)
  assert.equal(inject("log(')')\n  const [r] = await getDb().select().from(t)"), 1)
  assert.equal(v('const db = getDb()\nawait db.transaction(async (tx) => {\n const [r] = await db.select().from(t)\n})'), 1)
  assert.equal(inject('await countReaderCommentImpact(id /* , tx */)'), 1)
  assert.equal(inject('await deleteReaderComments(id, undefined)'), 1)
  assert.equal(v('const pool2 = getDb\nawait db.transaction(async (tx) => {\n await pool2().select().from(t)\n})'), 1)
  // A form it cannot read is reported, not skipped.
  assert.equal(v('await db.transaction(makeCallback(id))'), 1)
  assert.equal(v('await db.transaction(undefinedName)'), 1)
  // Not violations: prose in comments and strings, the parameter shadowing the outer name.
  assert.equal(v('const db = getDb()\nawait db.transaction(async (tx) => {\n // `db.insert()` resolves to an array\n await tx.insert(t).values(v)\n})'), 0)
  assert.equal(v('await db.transaction(async (tx) => {\n log("getDb() is the pool")\n await tx.insert(t).values(v)\n})'), 0)
  assert.equal(v('const db = getDb()\nawait db.transaction(async (db) => {\n await db.insert(t).values(v)\n})'), 0)
  assert.equal(v('const re = /[\'"`(]/\nawait db.transaction(async (tx) => {\n await tx.select().from(t)\n})'), 0)
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
