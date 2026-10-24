/**
 * Báo cáo ảnh trùng lặp — `GET /api/admin/media/duplicates` (wave2 D-SCAN).
 *
 * Hàng `media` do lượt quét CŨ nhập lên R2 không có `scanned_source_path` và không
 * suy ngược được chắc chắn, nên lượt quét mới không biết chúng đã được nhập. Báo cáo
 * này cho cán bộ thấy những hàng trùng (cùng tên tệp + kích thước, hoặc cùng chỗ
 * lưu) cùng số nơi đang dùng URL của từng hàng — để quyết định giữ hàng nào. Nó
 * KHÔNG xoá gì.
 *
 * Chạy hàm thật với CSDL giả (bảng `media` + văn bản các cột tham chiếu); quyền thật
 * (`requireResourcePermission`, `media.read`).
 */
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { MySqlDialect } from 'drizzle-orm/mysql-core'

import { media } from '../server/db/schema.ts'

const dialect = new MySqlDialect()

type MediaRow = {
  id: number; filename: string; originalName: string; provider: string; url: string
  storagePath: string; sizeBytes: number; scannedSourcePath: string | null; createdAt: Date
}
const store = {
  media: [] as MediaRow[],
  /** `bảng.cột` → các hàng `{ id, v }` của cột tham chiếu đó. */
  references: {} as Record<string, Array<{ id: number | string; v: string | null }>>,
  writes: 0,
}

const fakeDb = {
  select: (fields: Record<string, unknown>) => ({
    from: (table: unknown) => {
      assert.equal(table, media)
      const rows = store.media.map(row => Object.fromEntries(Object.keys(fields).map(k => [k, (row as unknown as Record<string, unknown>)[k]])))
      return Object.assign(Promise.resolve(rows), { orderBy: async () => rows })
    },
  }),
  // Trang của một cột tham chiếu: SELECT id, CAST(col AS CHAR) AS v FROM t WHERE (1 = 1 | id > ?) AND col IS NOT NULL ORDER BY id LIMIT ?
  execute: async (query: Parameters<typeof dialect.sqlToQuery>[0]) => {
    const { sql, params } = dialect.sqlToQuery(query)
    const match = /^SELECT `(\w+)`\.`\w+` AS id, CAST\(`\w+`\.`(\w+)` AS CHAR\) AS v FROM `\w+` WHERE (1 = 1|`\w+`\.`\w+` > \?) AND/.exec(sql)
    if (!match) throw new Error(`unexpected SQL (the report only reads): ${sql}`)
    const label = `${match[1]}.${match[2]}`
    const after = match[3] === '1 = 1' ? null : params[0] as number | string
    const limit = Number(params[params.length - 1])
    const rows = (store.references[label] ?? [])
      .filter(r => r.v !== null && (after === null || r.id > after))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .slice(0, limit)
    return [rows, []]
  },
  insert: () => { store.writes += 1; throw new Error('the report must not write') },
  update: () => { store.writes += 1; throw new Error('the report must not write') },
  delete: () => { store.writes += 1; throw new Error('the report must not write') },
}

/** Khoá tên MySQL giả: một người giữ một lúc, cộng công tắc "đang chạy ở nơi khác". */
const lock = { busyElsewhere: false, held: false, names: [] as string[] }
const fakePool = {
  getConnection: async () => ({
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('GET_LOCK')) {
        lock.names.push(String(params[0]))
        if (lock.busyElsewhere || lock.held) return [[{ acquired: 0 }]]
        lock.held = true
        return [[{ acquired: 1 }]]
      }
      if (sql.includes('RELEASE_LOCK')) lock.held = false
      return [[]]
    },
    release: () => undefined,
  }),
}

mock.module(new URL('../server/utils/db.ts', import.meta.url), {
  namedExports: { getDb: () => fakeDb, getPool: () => fakePool },
})

const { findMediaDuplicates, runMediaDuplicateReport, MEDIA_DUPLICATES_LOCK_NAME } = await import('../server/services/media-duplicates.ts')

const at = new Date('2026-10-01T00:00:00Z')
const row = (id: number, filename: string, sizeBytes: number, provider: string, url: string, storagePath: string): MediaRow =>
  ({ id, filename, originalName: filename, provider, url, storagePath, sizeBytes, scannedSourcePath: null, createdAt: at })

function seed() {
  store.media = [
    // Cùng tên + kích thước: lượt quét cũ nhập a.jpg lên R2 hai lần, hai tháng khác nhau.
    row(1, 'a.jpg', 1000, 'r2', 'https://cdn.test/2026/09/a.jpg', '2026/09/a.jpg'),
    row(2, 'a.jpg', 1000, 'r2', 'https://cdn.test/2026/10/a.jpg', '2026/10/a.jpg'),
    // Cùng tên, khác kích thước: ảnh KHÁC — không phải trùng.
    row(3, 'a.jpg', 2000, 'local', '/uploads/2026/08/a.jpg', '/app/public/uploads/2026/08/a.jpg'),
    // Cùng chỗ lưu R2 (hai hàng một object — tên khác nhau vì đổi tên sau).
    row(4, 'b.png', 10, 'r2', 'https://cdn.test/2026/10/b.png', '2026/10/b.png'),
    row(5, 'b-copy.png', 11, 'r2', 'https://cdn.test/2026/10/b.png', '2026/10/b.png'),
    // Một mình.
    row(6, 'c.png', 5, 'r2', 'https://cdn.test/2026/10/c.png', '2026/10/c.png'),
  ]
  store.references = {
    'articles.content': [
      { id: 1, v: '<img src="https://cdn.test/2026/09/a.jpg"><img src="https://cdn.test/2026/09/a.jpg">' },
      { id: 2, v: '<img src="https://cdn.test/2026/10/b.png">' },
      // Ranh giới: tệp khác (a.jpg.webp) không tính cho a.jpg.
      { id: 3, v: '<img src="https://cdn.test/2026/10/a.jpg.webp">' },
      { id: 4, v: null },
    ],
    'articles.thumbnail_url': [{ id: 1, v: 'https://cdn.test/2026/09/a.jpg' }],
    'page_blocks.data': [{ id: 7, v: '{"imageUrl": "https:\\/\\/cdn.test\\/2026\\/10\\/b.png"}' }],
    'settings.value': [{ id: 'main_logo_url', v: 'https://cdn.test/2026/10/a.jpg' }],
  }
  store.writes = 0
}

test('nhóm theo tên tệp + kích thước và theo chỗ lưu, kèm số nơi đang dùng URL của từng hàng', async () => {
  seed()
  const report = await findMediaDuplicates(fakeDb as never)
  assert.equal(report.truncated, false)
  assert.equal(report.usageTruncated, false, 'every reference column was read to its end')
  assert.equal(store.writes, 0, 'báo cáo không ghi gì')

  const byFilename = report.groups.filter(g => g.kind === 'filename_size')
  assert.deepEqual(byFilename.map(g => [g.key, g.rows.map(r => r.id)]), [[{ filename: 'a.jpg', sizeBytes: 1000 }, [1, 2]]])
  const byPath = report.groups.filter(g => g.kind === 'storage_path')
  assert.deepEqual(byPath.map(g => [g.key, g.rows.map(r => r.id)]), [[{ provider: 'r2', storagePath: '2026/10/b.png' }, [4, 5]]])

  const usage = (id: number) => report.groups.flatMap(g => g.rows).find(r => r.id === id)!.usage
  // a.jpg (2026/09): một bài viết (hai thẻ img vẫn là MỘT hàng) + ảnh đại diện của bài đó.
  assert.deepEqual(usage(1), { total: 2, byTarget: { 'articles.content': 1, 'articles.thumbnail_url': 1 } })
  // a.jpg (2026/10): logo trong settings; `a.jpg.webp` không tính.
  assert.deepEqual(usage(2), { total: 1, byTarget: { 'settings.value': 1 } })
  // Hai hàng chung một URL: cùng số nơi dùng, kể cả dạng JSON thoát `\/`.
  assert.deepEqual(usage(4), { total: 2, byTarget: { 'articles.content': 1, 'page_blocks.data': 1 } })
  assert.deepEqual(usage(5), usage(4))
  const listed = report.groups.flatMap(g => g.rows).find(r => r.id === 1)!
  assert.deepEqual(
    { filename: listed.filename, provider: listed.provider, url: listed.url, storagePath: listed.storagePath, sizeBytes: listed.sizeBytes },
    { filename: 'a.jpg', provider: 'r2', url: 'https://cdn.test/2026/09/a.jpg', storagePath: '2026/09/a.jpg', sizeBytes: 1000 },
  )
})

test('trần số nhóm: cắt bớt và báo truncated', async () => {
  seed()
  store.media = Array.from({ length: 10 }, (_, i) => [
    row(i * 2 + 1, `d${i}.png`, 1, 'r2', `https://cdn.test/x/d${i}.png`, `x/d${i}.png`),
    row(i * 2 + 2, `d${i}.png`, 1, 'r2', `https://cdn.test/y/d${i}.png`, `y/d${i}.png`),
  ]).flat()
  const report = await findMediaDuplicates(fakeDb as never, { maxGroups: 4 })
  assert.equal(report.groups.length, 4)
  assert.equal(report.truncated, true)
})

test('không có trùng lặp: không nhóm nào, không quét cột tham chiếu', async () => {
  seed()
  store.media = [row(1, 'a.jpg', 1, 'r2', 'https://cdn.test/a.jpg', 'a.jpg')]
  store.references = { 'articles.content': [{ id: 1, v: 'https://cdn.test/a.jpg' }] }
  let executed = 0
  const original = fakeDb.execute
  fakeDb.execute = async (q) => { executed += 1; return original(q) }
  try {
    assert.deepEqual(await findMediaDuplicates(fakeDb as never), { groups: [], truncated: false, usageTruncated: false })
    assert.equal(executed, 0)
  } finally {
    fakeDb.execute = original
  }
})

test('báo cáo có trần: quá số hàng tham chiếu hoặc quá thời gian thì dừng đọc và báo usageTruncated (W5)', async () => {
  seed()
  const full = await findMediaDuplicates(fakeDb as never)
  const usageOf = (report: typeof full, id: number) => report.groups.flatMap(g => g.rows).find(r => r.id === id)!.usage

  // Trần hàng: dừng sau trang đầu của cột đầu tiên (`articles.content`).
  const capped = await findMediaDuplicates(fakeDb as never, { maxReferenceRows: 1 })
  assert.equal(capped.usageTruncated, true)
  assert.deepEqual(capped.groups.map(g => g.rows.map(r => r.id)), full.groups.map(g => g.rows.map(r => r.id)), 'the groups are complete; only the usage counts are partial')
  assert.deepEqual(usageOf(capped, 1), { total: 1, byTarget: { 'articles.content': 1 } }, 'a lower bound: the thumbnail column was never read')

  // Hạn giờ: đồng hồ giả, mỗi lần hỏi trôi 1 giây; hạn 1,5 giây → đọc đúng một trang.
  let now = 0
  const timed = await findMediaDuplicates(fakeDb as never, { maxDurationMs: 1500, clock: () => (now += 1000) })
  assert.equal(timed.usageTruncated, true)
  assert.deepEqual(usageOf(timed, 1), { total: 1, byTarget: { 'articles.content': 1 } })
})

test('một báo cáo một lúc: lượt thứ hai (cùng tiến trình hay bản sao khác) bị từ chối, không đọc gì (W5)', async () => {
  seed()
  let executed = 0
  const original = fakeDb.execute
  fakeDb.execute = async (q) => { executed += 1; return original(q) }
  try {
    lock.busyElsewhere = true
    await assert.rejects(() => runMediaDuplicateReport(fakeDb as never, fakePool as never), (err: unknown) => (err as Error).name === 'DuplicateReportBusyError')
    assert.equal(executed, 0)
    lock.busyElsewhere = false
    const report = await runMediaDuplicateReport(fakeDb as never, fakePool as never)
    assert.equal(report.groups.length, 2)
    assert.equal(lock.held, false, 'the lock is released afterwards')
    assert.equal(lock.names.at(-1), MEDIA_DUPLICATES_LOCK_NAME)
  } finally {
    fakeDb.execute = original
    lock.busyElsewhere = false
  }
})

// ── Endpoint ─────────────────────────────────────────────────────────────────

const h3 = await import('h3')
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.createError = h3.createError
const handler = (await import('../server/api/admin/media/duplicates.get.ts')).default as unknown as (event: unknown) => Promise<{ ok: boolean, groups: unknown[], truncated: boolean }>

test('endpoint: cần quyền media.read; trả nhóm trùng', async () => {
  seed()
  const editorWithoutMedia = { id: 2, isSuperAdmin: false, permissions: [{ resource: 'news', canRead: true }] }
  await assert.rejects(() => handler({ context: { adminUser: editorWithoutMedia } }), (err: unknown) => (err as { statusCode?: number }).statusCode === 403)

  const mediaReader = { id: 3, isSuperAdmin: false, permissions: [{ resource: 'media', canRead: true }] }
  const res = await handler({ context: { adminUser: mediaReader } })
  assert.equal(res.ok, true)
  assert.equal(res.groups.length, 2)
  assert.equal(res.truncated, false)
  assert.equal((res as unknown as { usageTruncated: boolean }).usageTruncated, false)

  lock.busyElsewhere = true
  await assert.rejects(() => handler({ context: { adminUser: mediaReader } }), (err: unknown) => (err as { statusCode?: number }).statusCode === 409)
  lock.busyElsewhere = false
})
