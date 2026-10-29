import assert from 'node:assert/strict'
import test, { after, afterEach, beforeEach, mock } from 'node:test'
import { inflateRawSync } from 'node:zlib'

/**
 * The article exports of the admin list (`app/pages/admin/content/articles/index.vue`):
 *   GET  /api/admin/articles/:id/export?format=html|md  ([id]/export.get.ts)
 *   GET  /api/admin/articles/export-batch?ids=…         (export-batch.get.ts — a ZIP)
 *   POST /api/admin/articles/export-google { ids }       (export-google.post.ts)
 *   GET  /api/admin/articles/export-csv                  (export-csv.get.ts — dates only)
 * all on `read` of each article's type.
 *
 * The invariants:
 *   - one article: an id of a type the caller may not read is the same 404 as a
 *     missing one (FINDING-R6-16 — it was 403, an oracle for which ids exist); title and
 *     excerpt escaped into the HTML template, the stored (sanitised-at-write) body as is;
 *   - several: articles the caller may not read are left out, none readable → 403;
 *     at most 50; a POST without a body is a 400, not a 500 (FINDING-R6-18);
 *   - every "Ngày" and every file-name stamp is the Vietnamese calendar day, whatever
 *     the process time zone — they followed `TZ` (dates) or UTC (stamps), so a process
 *     on UTC (the PM2 path) printed an article published at 03:00 on the 29th (Hà Nội)
 *     as the 28th (FINDING-R6-17). Each date test runs under TZ=UTC and
 *     TZ=Asia/Ho_Chi_Minh.
 *
 * Real h3 app + `admin-auth`, SQL on SQLite (`_ai-route-harness.ts`). The Google side
 * (Drive link, OAuth client, the export itself) is replaced by recorders — the export
 * service has its own suites (`article-export-google`, `…-ssrf-behavior`).
 */

const drive = {
  link: { ok: true, refreshToken: 'refresh-token' } as Record<string, unknown>,
  config: { ok: true, clientId: 'client-id', clientSecret: 'client-secret' } as Record<string, unknown>,
  calls: [] as unknown[][],
}
mock.module('../server/services/backup-drive-oauth', { namedExports: { getUsableDriveLink: async () => drive.link } })
mock.module('../server/services/backup-drive-oauth-config', { namedExports: { getUsableDriveOauthConfig: async () => drive.config } })
mock.module('../server/services/article-export-google', {
  namedExports: {
    EXPORT_GOOGLE_MAX: 50,
    exportArticlesToGoogle: async (...args: unknown[]) => { drive.calls.push(args); return { sheetUrl: 'https://docs.google.com/spreadsheets/d/x', folderUrl: 'https://drive.google.com/drive/folders/y', count: (args[3] as unknown[]).length } },
  },
})

const { startAiRouteHarness } = await import('./_ai-route-harness')
const h = await startAiRouteHarness({
  extraTables: s => [s.articles, s.categories],
  routes: async load => [
    { method: 'get', path: '/api/admin/articles/export-batch', handler: await load('../server/api/admin/articles/export-batch.get') },
    { method: 'get', path: '/api/admin/articles/export-csv', handler: await load('../server/api/admin/articles/export-csv.get') },
    { method: 'post', path: '/api/admin/articles/export-google', handler: await load('../server/api/admin/articles/export-google.post') },
    { method: 'get', path: '/api/admin/articles/:id/export', handler: await load('../server/api/admin/articles/[id]/export.get') },
  ],
})
after(() => h.server.close())
const { articles, categories } = h.schema

type Json = Record<string, unknown>
type Account = Awaited<ReturnType<typeof h.account>>
let newsReader: Account
const PUBLISHED = new Date(Date.UTC(2026, 9, 28, 20, 0, 0)) // 03:00 on 29 October in Hà Nội
const NOW = Date.UTC(2026, 10, 30, 18, 30, 0) // 01:30 on 1 December in Hà Nội

beforeEach(async () => {
  h.reset()
  drive.link = { ok: true, refreshToken: 'refresh-token' }
  drive.config = { ok: true, clientId: 'client-id', clientSecret: 'client-secret' }
  drive.calls.length = 0
  newsReader = await h.account([{ resource: 'news', canRead: true }], 'tintuc')
})
afterEach(() => mock.timers.reset())

let seq = 0
async function article(fields: Json = {}) {
  seq += 1
  const [row] = await h.harness.db.insert(articles).values({
    type: 'news', title: `Bài ${seq}`, slug: `bai-${seq}`, status: 'published', content: '<p>Nội dung</p>',
    authorId: newsReader.id, publishedAt: PUBLISHED, ...fields,
  } as typeof articles.$inferInsert)
  return Number(row.insertId)
}

/** `fetch` for a binary answer (the harness reads every body as text). */
async function raw(path: string, who: Account) {
  const response = await fetch(`${h.server.origin}${path}`, { headers: { cookie: h.cookieFor(who) } })
  return { status: response.status, headers: response.headers, bytes: Buffer.from(await response.arrayBuffer()) }
}
/** The entries of a ZIP, read from its central directory. */
function unzip(zip: Buffer): Map<string, string> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const entries = new Map<string, string>()
  let at = zip.readUInt32LE(end + 16)
  for (let n = zip.readUInt16LE(end + 10); n > 0; n -= 1) {
    const method = zip.readUInt16LE(at + 10)
    const size = zip.readUInt32LE(at + 20)
    const nameLength = zip.readUInt16LE(at + 28)
    const skip = nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32)
    const local = zip.readUInt32LE(at + 42)
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const data = zip.subarray(start, start + size)
    entries.set(zip.subarray(at + 46, at + 46 + nameLength).toString('utf8'), (method === 8 ? inflateRawSync(data) : data).toString('utf8'))
    at += 46 + skip
  }
  return entries
}
function inZone<T>(zone: string, run: () => Promise<T>): Promise<T> {
  const before = process.env.TZ
  process.env.TZ = zone
  return run().finally(() => { process.env.TZ = before })
}

// ─── One article ─────────────────────────────────────────────────────────────

test('FINDING-R6-16: one article — a type the caller may not read is the same 404 as a missing id', async () => {
  const documentId = await article({ type: 'document', title: 'Văn bản mật' })
  for (const id of [documentId, 9999]) {
    const response = await h.request('GET', `/api/admin/articles/${id}/export`, newsReader)
    // Before: 403 for the document (it exists), 404 for the missing id.
    assert.deepEqual([response.status, response.body.statusMessage], [404, 'Bài viết không tồn tại.'], String(id))
  }
  assert.equal((await h.request('GET', `/api/admin/articles/${documentId}/export`, null)).status, 401)
  assert.equal((await h.request('GET', '/api/admin/articles/abc/export', newsReader)).status, 400)
})

test('one article as HTML: a standalone page, title and excerpt escaped, the stored body as is; as Markdown on request', async () => {
  await h.harness.db.insert(categories).values({ id: 3, name: 'Tin hoạt động', slug: 'tin-hoat-dong' } as typeof categories.$inferInsert)
  const id = await article({ title: 'Tin "nóng" <b>', slug: 'tin-nong', excerpt: 'Tóm tắt & ý', categoryId: 3, content: '<h2>Mục</h2><p>Đoạn <strong>đậm</strong></p>' })
  const page = await h.request('GET', `/api/admin/articles/${id}/export`, newsReader)
  assert.equal(page.status, 200)
  assert.deepEqual([page.headers.get('content-type'), page.headers.get('content-disposition'), page.headers.get('cache-control')],
    ['text/html; charset=utf-8', 'attachment; filename="tin-nong.html"', 'no-store'])
  const html = String(page.body.text)
  assert.match(html, /<title>Tin &quot;nóng&quot; &lt;b&gt;<\/title>/)
  assert.match(html, /<p class="excerpt">Tóm tắt &amp; ý<\/p>\n<h2>Mục<\/h2><p>Đoạn <strong>đậm<\/strong><\/p>/)
  assert.match(html, new RegExp(`Danh mục: Tin hoạt động · Tác giả: ${newsReader.username} · Trạng thái: published`))

  const md = await h.request('GET', `/api/admin/articles/${id}/export?format=MD`, newsReader)
  assert.deepEqual([md.headers.get('content-type'), md.headers.get('content-disposition')], ['text/markdown; charset=utf-8', 'attachment; filename="tin-nong.md"'])
  assert.match(String(md.body.text), /^# Tin "nóng" <b>\n\nTiêu đề: .*\nDanh mục: Tin hoạt động\n/)
})

// ─── Several articles (ZIP) ──────────────────────────────────────────────────

test('ZIP: the readable articles, one standalone page each; the others left out, none readable → 403; ids checked first', async () => {
  const news = await article({ slug: 'tin-a', title: 'Tin A' })
  const doc = await article({ type: 'document', slug: 'van-ban-b', title: 'Văn bản B' })
  const response = await raw(`/api/admin/articles/export-batch?ids=${news},${doc}`, newsReader)
  assert.equal(response.status, 200)
  assert.deepEqual([response.headers.get('content-type'), response.headers.get('cache-control')], ['application/zip', 'no-store'])
  const entries = unzip(response.bytes)
  assert.deepEqual([...entries.keys()], ['tin-a.html'])
  assert.match(entries.get('tin-a.html')!, /<h1>Tin A<\/h1>[\s\S]*<p>Nội dung<\/p>/)

  const onlyDoc = await h.request('GET', `/api/admin/articles/export-batch?ids=${doc}`, newsReader)
  assert.deepEqual([onlyDoc.status, onlyDoc.body.statusMessage], [403, 'Bạn không có quyền đọc bài nào trong danh sách đã chọn.'])
  const checks: Array<[string, string]> = [
    ['', 'Thiếu tham số ids.'], ['?ids=abc,-1', 'Tham số ids không hợp lệ.'],
    [`?ids=${Array.from({ length: 51 }, (_, n) => n + 1).join(',')}`, 'Tối đa 50 bài mỗi lần tải.'],
  ]
  for (const [query, message] of checks) {
    const refused = await h.request('GET', `/api/admin/articles/export-batch${query}`, newsReader)
    assert.deepEqual([refused.status, refused.body.statusMessage], [400, message], query)
  }
})

// ─── Google ──────────────────────────────────────────────────────────────────

test('FINDING-R6-18: Google export — no body is a 400, not a 500; ids checked; only readable articles reach the export', async () => {
  // Before: `readBody` gives undefined for an empty body and `body.ids` threw — a 500.
  const empty = await h.request('POST', '/api/admin/articles/export-google', newsReader)
  assert.deepEqual([empty.status, empty.body.statusMessage], [400, 'Thiếu danh sách bài viết.'])
  for (const body of [{ ids: [] }, { ids: ['1', -2, 0] }, { ids: 'x' }]) {
    assert.equal((await h.request('POST', '/api/admin/articles/export-google', newsReader, body)).status, 400, JSON.stringify(body))
  }
  assert.equal((await h.request('POST', '/api/admin/articles/export-google', newsReader, { ids: Array.from({ length: 51 }, (_, n) => n + 1) })).status, 400)

  const news = await article({ title: 'Tin A', thumbnailUrl: '/uploads/2026/10/a.jpg' })
  const doc = await article({ type: 'document' })
  const response = await h.request('POST', '/api/admin/articles/export-google', newsReader, { ids: [news, doc] })
  assert.deepEqual([response.status, response.body.count], [200, 1])
  const [refreshToken, clientId, clientSecret, input] = drive.calls[0] as [string, string, string, Json[]]
  assert.deepEqual([refreshToken, clientId, clientSecret], ['refresh-token', 'client-id', 'client-secret'])
  assert.deepEqual(input.map(item => [item.id, item.title, item.thumbnailUrl, item.authorName]), [[news, 'Tin A', '/uploads/2026/10/a.jpg', newsReader.username]])

  assert.equal((await h.request('POST', '/api/admin/articles/export-google', newsReader, { ids: [doc] })).status, 403)
  assert.equal(drive.calls.length, 1)
})

test('Google export: an unlinked Drive or an unusable OAuth client is a 400 that says what to do, before any export', async () => {
  const id = await article()
  const cases: Array<[Json, Json, string]> = [
    [{ ok: false, reason: 'not_linked' }, drive.config, 'Chưa liên kết Google Drive. Vào /admin/settings → backup Drive để liên kết.'],
    [{ ok: false, reason: 'secret_unreadable' }, drive.config, 'Khoá mã hoá Google Drive không đọc được — xoay CHATBOT_ENCRYPTION_SECRET rồi re-link.'],
    [drive.link, { ok: false, reason: 'disabled' }, 'Chưa cấu hình Google Drive OAuth Client. Vào /admin/settings → backup Drive.'],
    [drive.link, { ok: false, reason: 'secret_unreadable' }, 'Client secret Google Drive không đọc được — re-link OAuth.'],
  ]
  for (const [link, config, message] of cases) {
    drive.link = link
    drive.config = config
    const response = await h.request('POST', '/api/admin/articles/export-google', newsReader, { ids: [id] })
    assert.deepEqual([response.status, response.body.statusMessage], [400, message])
  }
  assert.deepEqual(drive.calls, [])
})

// ─── Dates: the Vietnamese calendar day, in any process time zone ────────────

for (const zone of ['UTC', 'Asia/Ho_Chi_Minh']) {
  test(`FINDING-R6-17 (TZ=${zone}): every export prints the Vietnamese day, and stamps its file with today's Vietnamese date`, () => inZone(zone, async () => {
    const id = await article({ slug: 'tin-ngay', createdAt: PUBLISHED })
    mock.timers.enable({ apis: ['Date'], now: NOW })

    const html = await h.request('GET', `/api/admin/articles/${id}/export`, newsReader)
    assert.match(String(html.body.text), /Ngày: 2026-10-29/)
    const md = await h.request('GET', `/api/admin/articles/${id}/export?format=md`, newsReader)
    assert.match(String(md.body.text), /\nNgày: 2026-10-29\n/)

    const zip = await raw(`/api/admin/articles/export-batch?ids=${id}`, newsReader)
    assert.equal(zip.headers.get('content-disposition'), 'attachment; filename="bai-viet-20261201.zip"')
    assert.match(unzip(zip.bytes).get('tin-ngay.html')!, /Ngày: 2026-10-29/)

    const csv = await h.request('GET', '/api/admin/articles/export-csv', newsReader)
    assert.match(String(csv.headers.get('content-disposition')), /20261201/)
    assert.match(String(csv.body.text), /,2026-10-29,2026-10-29$/m)

    await h.request('POST', '/api/admin/articles/export-google', newsReader, { ids: [id] })
    assert.equal(drive.calls[0]![4], '20261201')
  }))
}
