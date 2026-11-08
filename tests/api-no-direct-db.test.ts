/**
 * No file under `server/api/**` touches the database itself: every statement lives in
 * `server/services/**` (chủ dự án quyết 2026-11-08; CHANGELOG § 100). A handler keeps the
 * permission check, input reading, cookies, response shaping and the after-commit calls
 * (cache purge, answer-cache bump), and calls a service for every read or write.
 *
 * Before: 160 of 326 endpoints called `getDb()` directly (CLAUDE.md listed it as a deliberate
 * limitation). Moving them back is what this test stops: a handler that imports the database
 * module, calls `getDb()`/`getPool()`, runs `pool.query`/`.execute`, or opens a transaction.
 *
 * `EXCEPTIONS` names a file that must keep one of these, with its reason — empty today. Adding
 * an entry is the owner's decision, like any other named exception in CLAUDE.md.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const API = path.join(ROOT, 'server', 'api')

const EXCEPTIONS: Record<string, string> = {}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : /\.ts$/.test(name) ? [full] : []
  })
}

/** Source without comments, so a comment that mentions `getDb()` is not a finding. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

const RULES: Array<[string, RegExp]> = [
  ['imports the database module (`utils/db`)', /from\s+['"][./]*utils\/db['"]/],
  ['calls getDb()', /\bgetDb\s*\(/],
  ['calls getPool()', /\bgetPool\s*\(/],
  ['runs pool.query / pool.execute', /\bpool\s*\.\s*(?:query|execute)\s*\(/],
  ['opens a transaction', /\.transaction\s*\(/],
]

describe('server/api never touches the database directly', () => {
  const files = walk(API).map(file => path.relative(ROOT, file).split(path.sep).join('/'))

  it('finds the endpoints (the walk is not empty)', () => {
    assert.ok(files.length > 300, `only ${files.length} files under server/api`)
  })

  it('every handler reaches the database only through server/services', () => {
    const findings: string[] = []
    for (const file of files) {
      if (file in EXCEPTIONS) continue
      const source = code(readFileSync(path.join(ROOT, file), 'utf8'))
      for (const [what, pattern] of RULES) if (pattern.test(source)) findings.push(`${file}: ${what}`)
    }
    assert.deepEqual(findings, [], 'move the statement into a server/services/** function and call it from the handler')
  })

  it('every named exception still exists and still needs its exception', () => {
    for (const [file, why] of Object.entries(EXCEPTIONS)) {
      assert.ok(why.trim().length > 20, `${file}: give the reason`)
      const source = code(readFileSync(path.join(ROOT, file), 'utf8'))
      assert.ok(RULES.some(([, pattern]) => pattern.test(source)), `${file} no longer touches the database — remove its exception`)
    }
  })

  it('the rules catch what they are meant to catch', () => {
    const probes = [
      "import { getDb } from '../../utils/db'",
      'const db = getDb()',
      'await getPool().query(sql)',
      'await pool.query(sql)',
      'await db.transaction(async (tx) => {})',
    ]
    for (const probe of probes) assert.ok(RULES.some(([, pattern]) => pattern.test(code(probe))), probe)
    assert.ok(!RULES.some(([, pattern]) => pattern.test(code('// getDb() was here\nconst x = 1'))), 'a comment is not code')
  })
})
