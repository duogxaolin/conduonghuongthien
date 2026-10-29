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
 *   - the SQLite harness (`_sqlite-mysql-db.ts`) throws on a pool `select` while a
 *     transaction is open — which catches a call through any depth of helpers in every suite
 *     that runs the code (the reader suite went red on the base for ban and purge).
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

/** Body of the callback that follows `.transaction(async (` at `start`, by brace counting. */
function callbackBody(source: string, start: number): { body: string, offset: number } {
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}' && --depth === 0) return { body: source.slice(open + 1, i), offset: open + 1 }
  }
  return { body: '', offset: open }
}

/** Helpers whose last parameter is an executor and whose default is the pool. */
const POOL_FALLBACK_HELPERS = ['countReaderCommentImpact', 'deleteReaderComments']

function violations(files: Array<{ path: string, source: string }>): string[] {
  const out: string[] = []
  for (const { path, source } of files) {
    for (const match of source.matchAll(/\.transaction\(\s*async\s*\(/g)) {
      const { body, offset } = callbackBody(source, match.index!)
      const lineOf = (index: number) => source.slice(0, offset + index).split('\n').length
      for (const hit of body.matchAll(/\bgetDb\(\)|\bgetPool\(\)|\bpool\.(?:query|execute)\(/g)) {
        out.push(`${path}:${lineOf(hit.index!)} ${hit[0]} inside a transaction`)
      }
      for (const name of POOL_FALLBACK_HELPERS) {
        for (const call of body.matchAll(new RegExp(`\\b${name}\\(([^()]*)\\)`, 'g'))) {
          if (call[1]!.split(',').length < 2) out.push(`${path}:${lineOf(call.index!)} ${name}(${call[1]}) without the transaction — it reads on the pool`)
        }
      }
    }
  }
  return out
}

const SERVER = walk('server').map(path => ({ path, source: readFileSync(path, 'utf8') }))

test('no transaction callback under server/ reaches for the pool, directly or through a pool-default helper', () => {
  assert.ok(SERVER.some(({ source }) => /\.transaction\(\s*async\s*\(/.test(source)), 'the scan found no transaction at all')
  assert.deepEqual(violations(SERVER), [])
})

test('the scan bites: each injected shape is reported', () => {
  const inject = (body: string) => violations([{ path: 'x.ts', source: `await db.transaction(async (tx) => {\n  ${body}\n})` }])
  assert.equal(inject('const [row] = await getDb().select().from(t)').length, 1)
  assert.equal(inject('await getPool().query("select 1")').length, 1)
  assert.equal(inject('await pool.execute(sql)').length, 1)
  assert.equal(inject('const impact = await countReaderCommentImpact(params.readerId)').length, 1)
  assert.equal(inject('const impact = await deleteReaderComments(id)').length, 1)
  assert.deepEqual(inject('const impact = await countReaderCommentImpact(params.readerId, tx)'), [])
  assert.deepEqual(inject('const [row] = await tx.select().from(t)'), [])
})
