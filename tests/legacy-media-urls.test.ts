/**
 * `repairLegacyMediaUrls` (chạy MỖI lần khởi động, `migrations-additive.ts`) — wave2 D-SCAN.
 *
 *   - Liên kết cũ `…/uploads/migrated/media/<tên>` chỉ được trỏ về URL R2 khi đúng MỘT
 *     hàng `media` mang tên đó. Hai hàng cùng tên (bất kể provider, kể cả trùng qua
 *     dạng `encodeURIComponent`) → mơ hồ: liên kết giữ nguyên, tên tệp được log. Bản cũ
 *     lấy hàng đọc sau cùng — trỏ bài viết vào một ảnh có thể khác.
 *   - Domain R2 lấy từ `settings.r2_public_url`, không viết cứng `cdn1.delify.vn`;
 *     chưa cấu hình → bỏ các bước cần domain (log nếu còn URL đang chờ).
 *   - `UPDATE articles` giữ `updated_at`: vá URL không phải một lần sửa bài.
 *
 * Kết quả trên MySQL thật (đúng phép viết lại, lượt khởi động thứ hai không đổi gì) do
 * `tests/schema-upgrade-integration.test.ts` kiểm.
 */
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

import { buildMigratedMediaMap, legacyMediaDomain, likePrefix, repairLegacyMediaUrls, rewriteMigratedMediaLinks } from '../server/db/legacy-media-urls.ts'

const logged: Array<Record<string, unknown>> = []
mock.method(console, 'error', (line: unknown) => {
  try { logged.push(JSON.parse(String(line)) as Record<string, unknown>) } catch { /* not a log line */ }
})

test('the boot migration step calls this repair (moved out of migrations-additive.ts, wave2 D-SCAN)', async () => {
  const { readFileSync } = await import('node:fs')
  const additive = readFileSync(new URL('../server/db/migrations-additive.ts', import.meta.url), 'utf8')
  assert.match(additive, /import \{ repairLegacyMediaUrls \} from '\.\/legacy-media-urls'/)
  assert.match(additive, /^ {2}await repairLegacyMediaUrls\(db\)$/m)
})

test('hai hàng cùng tên tệp: không ánh xạ, liên kết giữ nguyên, tên được báo', () => {
  const map = buildMigratedMediaMap([
    { filename: 'a.jpg', provider: 'r2', url: 'https://cdn.test/2026/09/a.jpg' },
    { filename: 'a.jpg', provider: 'r2', url: 'https://cdn.test/2026/10/a.jpg' },
    { filename: 'b.jpg', provider: 'r2', url: 'https://cdn.test/2026/10/b.jpg' },
  ])
  const html = '<img src="/uploads/migrated/media/a.jpg"><img src="https://old.site/uploads/migrated/media/b.jpg">'
  const out = rewriteMigratedMediaLinks(html, map)
  assert.equal(out.content, '<img src="/uploads/migrated/media/a.jpg"><img src="https://cdn.test/2026/10/b.jpg">')
  assert.deepEqual([...out.ambiguousSeen], ['a.jpg'])
})

test('hai hàng cùng tên tệp nhưng CÙNG một URL R2 (hàng trùng, một object): không mơ hồ — đếm URL khác nhau, không đếm hàng (S1)', () => {
  const map = buildMigratedMediaMap([
    { filename: 'g.jpg', provider: 'r2', url: 'https://cdn.test/2026/10/g.jpg' },
    { filename: 'g.jpg', provider: 'r2', url: 'https://cdn.test/2026/10/g.jpg' },
  ])
  assert.equal(map.urlByName.get('g.jpg'), 'https://cdn.test/2026/10/g.jpg')
  assert.equal(map.ambiguous.has('g.jpg'), false)
  assert.equal(rewriteMigratedMediaLinks('<img src="/uploads/migrated/media/g.jpg">', map).content, '<img src="https://cdn.test/2026/10/g.jpg">')
})

test('mơ hồ tính cả khi một trong hai hàng là local, và trên dạng mã hoá', () => {
  const localAndR2 = buildMigratedMediaMap([
    { filename: 'c.jpg', provider: 'local', url: '/uploads/2026/09/c.jpg' },
    { filename: 'c.jpg', provider: 'r2', url: 'https://cdn.test/2026/10/c.jpg' },
  ])
  assert.equal(localAndR2.urlByName.has('c.jpg'), false)
  assert.ok(localAndR2.ambiguous.has('c.jpg'))

  // `tải xuống.jpg` và một tệp tên đúng bằng dạng mã hoá của nó.
  const encodedClash = buildMigratedMediaMap([
    { filename: 'tải xuống.jpg', provider: 'r2', url: 'https://cdn.test/1.jpg' },
    { filename: encodeURIComponent('tải xuống.jpg'), provider: 'r2', url: 'https://cdn.test/2.jpg' },
  ])
  assert.equal(encodedClash.urlByName.get('tải xuống.jpg'), 'https://cdn.test/1.jpg', 'tên thô chỉ một hàng mang')
  assert.ok(encodedClash.ambiguous.has(encodeURIComponent('tải xuống.jpg')), 'dạng mã hoá thuộc hai hàng')
  const out = rewriteMigratedMediaLinks(`<img src="/uploads/migrated/media/${encodeURIComponent('tải xuống.jpg')}">`, encodedClash)
  assert.equal(out.content, `<img src="/uploads/migrated/media/${encodeURIComponent('tải xuống.jpg')}">`)
})

test('tên duy nhất trên R2: liên kết thô lẫn mã hoá đều trỏ về URL R2; hàng local duy nhất thì không', () => {
  const map = buildMigratedMediaMap([
    { filename: 'tải xuống.jpg', provider: 'r2', url: 'https://cdn.test/t.jpg' },
    { filename: 'local.jpg', provider: 'local', url: '/uploads/2026/09/local.jpg' },
  ])
  const html = `<img src="/uploads/migrated/media/${encodeURIComponent('tải xuống.jpg')}"><img src="/uploads/migrated/media/local.jpg">`
  assert.equal(rewriteMigratedMediaLinks(html, map).content, '<img src="https://cdn.test/t.jpg"><img src="/uploads/migrated/media/local.jpg">')
})

test('domain R2 lấy từ cấu hình', () => {
  assert.equal(legacyMediaDomain('https://cdn1.delify.vn/'), 'cdn1.delify.vn')
  assert.equal(legacyMediaDomain('cdn.example.vn/media'), 'cdn.example.vn/media')
  assert.equal(legacyMediaDomain(''), null)
  assert.equal(legacyMediaDomain(null), null)
  assert.equal(legacyMediaDomain('https://bad host'), null)
  assert.equal(likePrefix('cdn_1%.vn'), 'cdn\\_1\\%.vn%', 'ký tự đại diện của LIKE trong domain là chữ')
})

// ── repairLegacyMediaUrls trên một kết nối giả ─────────────────────────────────

type Call = { sql: string, params: unknown[] }

function fakeConnection(state: { domain: string | null, media: Array<Record<string, unknown>>, articles: Array<{ id: number, content: string }>, waitingLocalhost?: boolean }) {
  const writes: Call[] = []
  const answer = (sql: string): unknown[] => {
    if (sql.includes("FROM `settings` WHERE `key` = 'r2_public_url'")) return state.domain === null ? [] : [{ value: state.domain }]
    if (sql.startsWith('SELECT 1 FROM `media`') && sql.includes("NOT LIKE '%://localhost:3000/uploads/%'")) return state.waitingLocalhost ? [{ 1: 1 }] : []
    if (sql.startsWith('SELECT 1 FROM `media`')) return [{ 1: 1 }]
    if (sql.startsWith('SELECT 1 FROM `articles`')) return [{ 1: 1 }]
    if (sql.startsWith('SELECT `filename`, `url`, `provider` FROM `media`')) return state.media
    if (sql.startsWith('SELECT `id`, `content` FROM `articles`')) return state.articles
    throw new Error(`unexpected read: ${sql}`)
  }
  const conn = {
    execute: async (sql: string) => [answer(sql.trim()), []],
    query: async (sql: string, params: unknown[] = []) => {
      writes.push({ sql: sql.trim(), params })
      return [{ affectedRows: 0 }, []]
    },
  }
  return { conn, writes }
}

test('repairLegacyMediaUrls: tên mơ hồ → không UPDATE bài đó, log tên tệp', async () => {
  const { conn, writes } = fakeConnection({
    domain: 'https://cdn.test',
    media: [
      { filename: 'a.jpg', provider: 'r2', url: 'https://cdn.test/2026/09/a.jpg' },
      { filename: 'a.jpg', provider: 'r2', url: 'https://cdn.test/2026/10/a.jpg' },
      { filename: 'b.jpg', provider: 'r2', url: 'https://cdn.test/2026/10/b.jpg' },
    ],
    articles: [
      { id: 1, content: '<img src="/uploads/migrated/media/a.jpg">' },
      { id: 2, content: '<img src="/uploads/migrated/media/b.jpg">' },
    ],
  })
  logged.length = 0
  await repairLegacyMediaUrls(conn as never)
  const articleUpdates = writes.filter(w => w.sql === 'UPDATE `articles` SET `content` = ?, `updated_at` = `updated_at` WHERE `id` = ?')
  assert.deepEqual(articleUpdates.map(w => w.params), [['<img src="https://cdn.test/2026/10/b.jpg">', 2]], 'chỉ bài có tên duy nhất được vá')
  const ambiguous = logged.filter(l => l.event === 'db.migration.legacy_media_ambiguous')
  assert.equal(ambiguous.length, 1)
  assert.deepEqual(ambiguous[0]!.filenames, ['a.jpg'])
  assert.equal(ambiguous[0]!.articles, 1)
})

test('repairLegacyMediaUrls: domain từ cấu hình, không còn cdn1.delify.vn viết cứng; mọi UPDATE articles giữ updated_at', async () => {
  const { conn, writes } = fakeConnection({ domain: 'https://cdn.example.vn/', media: [], articles: [] })
  await repairLegacyMediaUrls(conn as never)
  assert.ok(writes.length > 0)
  assert.ok(writes.every(w => !w.sql.includes('cdn1.delify.vn') && !w.params.some(p => String(p).includes('cdn1.delify.vn'))), 'không còn domain viết cứng')
  const domainWrites = writes.filter(w => w.params.some(p => String(p).includes('cdn.example.vn')))
  assert.equal(domainWrites.length, 5, '3 lượt vá media.url + 2 lượt vá articles.content dùng domain cấu hình')
  assert.ok(writes.filter(w => w.sql.startsWith('UPDATE `articles`')).every(w => w.sql.includes('`updated_at` = `updated_at`')))
})

test('repairLegacyMediaUrls: chưa cấu hình domain → bỏ các bước cần domain, log khi còn URL chờ vá', async () => {
  const { conn, writes } = fakeConnection({ domain: null, media: [], articles: [], waitingLocalhost: true })
  logged.length = 0
  await repairLegacyMediaUrls(conn as never)
  assert.ok(writes.every(w => w.params.length === 0), 'không lượt ghi nào dùng domain')
  assert.ok(writes.every(w => !/localhost:3000\/'/.test(w.sql)), 'không bóc tiền tố `localhost:3000/` khi không biết domain đích')
  assert.equal(logged.filter(l => l.event === 'db.migration.legacy_media_domain_unknown').length, 1)
})
