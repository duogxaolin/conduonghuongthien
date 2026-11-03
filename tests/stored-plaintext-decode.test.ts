import assert from 'node:assert/strict'
import test, { beforeEach, mock } from 'node:test'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/mysql2'
import { eq, getTableColumns, getTableName } from 'drizzle-orm'
import * as schema from '../server/db/schema'

/**
 * `npm run db:decode-excerpts` (wave1 D15, spec `plain-text-fields`): an operator
 * repair that rewrites entity-encoded `title`/`excerpt` already stored in
 * `articles` and `article_translations` (`Ng&agrave;y 26/8` from the old CMS) to
 * the plain text the public read path shows, so SQL `LIKE` search matches what
 * readers see. Preview by default, `--apply` to write, keyed batches of 200,
 * `updated_at` untouched, `content` never read or written.
 *
 * The SQL side runs for real: the service's Drizzle MySQL statements go through
 * the real `drizzle-orm/mysql2` driver over a fake pool that executes them on an
 * in-memory SQLite database. SQLite has no `ON UPDATE CURRENT_TIMESTAMP`, so the
 * pool emulates MySQL's rule: an UPDATE of these tables whose SET list does not
 * assign `updated_at` stamps it with "now" — exactly what MySQL does to a changed
 * row. The service must assign `updated_at = updated_at` to keep it.
 */

const sqlite = new DatabaseSync(':memory:')
const TABLES = [schema.articles, schema.articleTranslations]
for (const table of TABLES) {
  const columns = Object.values(getTableColumns(table)).map(column => `\`${column.name}\``).join(', ')
  sqlite.exec(`CREATE TABLE \`${getTableName(table)}\` (${columns})`)
}
const NOW_STAMP = '2099-01-01 00:00:00'
const OLD_STAMP = '2025-03-04 05:06:07'

const statements: Array<{ sql: string, params: unknown[] }> = []
/** Runs between the plan and an UPDATE — the place an editor's concurrent save lands. */
let beforeUpdate: (() => void) | null = null

function execute(arg: unknown, values: unknown) {
  const query = arg && typeof arg === 'object' ? arg as { sql: string, rowsAsArray?: boolean } : { sql: String(arg) }
  const params = (Array.isArray(values) ? values : []) as Array<string | number | null>
  let sql = query.sql
  statements.push({ sql, params })
  if (/^update\b/i.test(sql)) {
    beforeUpdate?.()
    // MySQL `ON UPDATE CURRENT_TIMESTAMP`: a column the UPDATE does not assign is set to now.
    const set = /\bset\b([\s\S]*?)\bwhere\b/i.exec(sql)?.[1] ?? ''
    if (!/`updated_at`\s*=/.test(set)) sql = sql.replace(/\swhere\s/i, `, \`updated_at\` = '${NOW_STAMP}' where `)
    const result = sqlite.prepare(sql).run(...params)
    return [{ affectedRows: Number(result.changes), insertId: 0 }, []]
  }
  const rows = sqlite.prepare(sql).all(...params) as Array<Record<string, unknown>>
  return [query.rowsAsArray ? rows.map(row => Object.values(row)) : rows, []]
}
const pool = {
  query: async (arg: unknown, values?: unknown) => execute(arg, values),
  execute: async (arg: unknown, values?: unknown) => execute(arg, values),
  getConnection: async () => ({ query: async (arg: unknown, values?: unknown) => execute(arg, values), release() {} }),
  end: async () => {},
}
const db = drizzle(pool as never, { schema, mode: 'default' })
mock.module('../server/utils/db', { namedExports: { getDb: () => db, closeDb: async () => {} } })

const { planPlainTextFixes, runPlainTextFix } = await import('../server/services/stored-plaintext-decode')

type Seed = { id: number, title: string | null, excerpt: string | null, content?: string }
function seed(table: 'articles' | 'article_translations', rows: Seed[]) {
  sqlite.exec(`DELETE FROM \`${table}\``)
  const insert = sqlite.prepare(`INSERT INTO \`${table}\` (\`id\`, \`title\`, \`excerpt\`, \`content\`, \`updated_at\`) VALUES (?, ?, ?, ?, ?)`)
  for (const row of rows) insert.run(row.id, row.title, row.excerpt, row.content ?? '<p>Ng&agrave;y</p>', OLD_STAMP)
}
const read = (table: string, id: number) =>
  sqlite.prepare(`SELECT title, excerpt, content, updated_at FROM \`${table}\` WHERE id = ?`).get(id) as { title: string | null, excerpt: string | null, content: string, updated_at: string }

beforeEach(() => {
  statements.length = 0
  beforeUpdate = null
  seed('articles', [])
  seed('article_translations', [])
})

// ─── The plan (pure) ──────────────────────────────────────────────────────────

const ROWS = [
  { id: 1, title: 'LÀO CAI: Tập huấn', excerpt: 'Ng&agrave;y 26/8, tại Hội trường Ủy ban nh&acirc;n d&acirc;n' },
  { id: 2, title: 'Phòng R&D', excerpt: null },
  { id: 3, title: 'C&Ocirc;NG AN', excerpt: 'Ủy ban nh&acirc;n d&acirc;n x&atilde; nh&ac' },
  { id: 4, title: '  Tin thường  ', excerpt: 'Hỏi đáp Q&A' },
  { id: 5, title: 'Chữ &amp;agrave; viết nguyên văn', excerpt: null },
  { id: 6, title: 'C&ocirc;ng ty AT&T', excerpt: '' },
]

test('plan: decodes entity-encoded fields, leaves literal ampersands and whitespace-only differences alone', () => {
  const plan = planPlainTextFixes(ROWS)
  assert.deepEqual(plan.fixes, [
    { id: 1, excerpt: 'Ngày 26/8, tại Hội trường Ủy ban nhân dân' },
    { id: 3, title: 'CÔNG AN', excerpt: 'Ủy ban nhân dân xã nh…' },
    { id: 6, title: 'Công ty AT…' },
  ])
})

test('plan: every result that drops a trailing fragment is listed for review, with table-free id, field and both tails', () => {
  const plan = planPlainTextFixes(ROWS)
  assert.deepEqual(plan.fragments.map(({ id, field }) => ({ id, field })), [{ id: 3, field: 'excerpt' }, { id: 6, field: 'title' }])
  const att = plan.fragments.find(note => note.id === 6)!
  assert.match(att.before, /AT&T$/, 'the operator sees the original tail — here a real "AT&T", not a cut entity')
  assert.match(att.after, /AT…$/)
})

test('plan: a value that would decode AGAIN after the write is listed, not written', () => {
  // `&amp;agrave;` decodes once to the literal text `&agrave;`, which the read path
  // would then decode to `à` — writing it would change what readers see.
  const plan = planPlainTextFixes(ROWS)
  assert.ok(!plan.fixes.some(fix => fix.id === 5))
  assert.deepEqual(plan.unstable.map(({ id, field }) => ({ id, field })), [{ id: 5, field: 'title' }])
})

test('plan: pure and idempotent', () => {
  const snapshot = JSON.stringify(ROWS)
  const first = planPlainTextFixes(ROWS)
  assert.equal(JSON.stringify(ROWS), snapshot, 'rows are not mutated')
  const after = ROWS.map(row => ({ ...row, ...first.fixes.find(fix => fix.id === row.id) }))
  const second = planPlainTextFixes(after)
  assert.deepEqual(second.fixes, [], 'a second run over the written values changes nothing')
  assert.deepEqual(second.fragments, [])
})

// ─── The run (SQL through MySqlDialect → SQLite) ───────────────────────────────

const SEEDED: Seed[] = [
  { id: 1, title: 'LÀO CAI: Tập huấn', excerpt: 'Ng&agrave;y 26/8, tại Hội trường' },
  { id: 2, title: 'Phòng R&D', excerpt: 'Hỏi đáp Q&A' },
  { id: 3, title: 'Tin', excerpt: 'Ủy ban nh&acirc;n d&acirc;n nh&ac' },
]

test('preview counts the rows that would change and writes nothing', async () => {
  seed('articles', SEEDED)
  seed('article_translations', [{ id: 1, title: 'B&agrave;i dịch', excerpt: null }])
  const report = await runPlainTextFix()

  assert.equal(report.applied, false)
  assert.deepEqual({ scanned: report.articles.scanned, changed: report.articles.changed }, { scanned: 3, changed: 2 })
  assert.deepEqual({ scanned: report.translations.scanned, changed: report.translations.changed }, { scanned: 1, changed: 1 })
  assert.deepEqual(report.articles.fragments.map(({ id, field }) => ({ id, field })), [{ id: 3, field: 'excerpt' }])
  assert.equal(read('articles', 1).excerpt, 'Ng&agrave;y 26/8, tại Hội trường')
  assert.ok(!statements.some(s => /^update\b/i.test(s.sql)), 'preview issued an UPDATE')
})

test('apply rewrites the values, keeps updated_at, never touches content, and LIKE now finds the article', async () => {
  seed('articles', SEEDED)
  seed('article_translations', [{ id: 1, title: 'B&agrave;i dịch', excerpt: null }])
  const report = await runPlainTextFix({ apply: true })

  assert.equal(report.applied, true)
  assert.equal(report.articles.written, 2)
  assert.equal(read('articles', 1).excerpt, 'Ngày 26/8, tại Hội trường')
  assert.equal(read('articles', 3).excerpt, 'Ủy ban nhân dân nh…')
  assert.equal(read('articles', 2).title, 'Phòng R&D', 'literal & untouched')
  assert.equal(read('article_translations', 1).title, 'Bài dịch')
  for (const [table, id] of [['articles', 1], ['articles', 3], ['article_translations', 1]] as const) {
    assert.equal(read(table, id).updated_at, OLD_STAMP, `${table}#${id}: updated_at changed — the UPDATE must assign updated_at = updated_at`)
    assert.equal(read(table, id).content, '<p>Ng&agrave;y</p>', `${table}#${id}: content changed`)
  }
  const found = sqlite.prepare("SELECT id FROM articles WHERE excerpt LIKE '%Ngày%'").all() as Array<{ id: number }>
  assert.deepEqual(found.map(row => row.id), [1])
  assert.ok(statements.every(s => !/`content`/.test(s.sql)), 'a statement read or wrote `content`')

  const again = await runPlainTextFix({ apply: true })
  assert.equal(again.articles.changed + again.translations.changed, 0, 'second run changes nothing')
})

test('harness self-check: an UPDATE that does not assign updated_at DOES bump it here, as on MySQL', async () => {
  seed('articles', SEEDED)
  await db.update(schema.articles).set({ title: 'x' }).where(eq(schema.articles.id, 2))
  assert.equal(read('articles', 2).updated_at, NOW_STAMP)
})

test('rows are read in keyed batches of 200 by id', async () => {
  seed('articles', Array.from({ length: 450 }, (_, i) => ({ id: i + 1, title: `Tin ${i + 1}`, excerpt: null })))
  await runPlainTextFix()
  const selects = statements.filter(s => /^select\b/i.test(s.sql) && /from `articles`/.test(s.sql))
  assert.ok(selects.every(s => /where `articles`\.`id` > \? order by `articles`\.`id` asc limit \?$/.test(s.sql)), selects[0]?.sql)
  assert.deepEqual(selects.map(s => s.params), [[0, 200], [200, 200], [400, 200], [450, 200]])
})

test('a value an editor changed after the plan is not overwritten', async () => {
  seed('articles', SEEDED)
  beforeUpdate = () => { sqlite.prepare("UPDATE articles SET excerpt = 'Biên tập viên vừa sửa' WHERE id = 1").run() }
  const report = await runPlainTextFix({ apply: true })
  assert.equal(read('articles', 1).excerpt, 'Biên tập viên vừa sửa')
  assert.ok(report.articles.skipped >= 1)
})

test('operator wiring: npm run db:decode-excerpts runs the script, preview unless --apply', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> }
  assert.equal(pkg.scripts['db:decode-excerpts'], 'node --experimental-strip-types --import ./scripts/ts-resolver.mjs scripts/decode-stored-excerpts.ts')
  const script = readFileSync(new URL('../scripts/decode-stored-excerpts.ts', import.meta.url), 'utf8')
  assert.match(script, /process\.argv\.includes\('--apply'\)/)
  const service = readFileSync(new URL('../server/services/stored-plaintext-decode.ts', import.meta.url), 'utf8')
  assert.match(service, /const apply = options\.apply === true/)
})
