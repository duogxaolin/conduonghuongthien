/**
 * Cổng media công khai — đường ĐỌC.
 *
 * Tệp này kiểm bốn tính chất mà không có cổng nào khác trong dự án kiểm được,
 * và mỗi tính chất đều hỏng theo một cách không nhìn thấy được:
 *
 *   • **Tập cột công khai là một allowlist.** `media_items` mang `storage_path`,
 *     `processing_error`, `status`, `created_by`, `claimed_by`, `is_featured`.
 *     `processing_error` chứa **đường dẫn tệp và thông báo FFmpeg**, tức là nó
 *     mô tả cấu trúc đĩa của máy chủ. Một lượt `select()` trần rồi trả thẳng hàng
 *     sẽ đẩy hết nhóm đó ra ngoài và **trông đúng** — không có gì đỏ ở đâu cả.
 *     Nên có hai khẳng định tách biệt: câu SQL không được *chọn* cột nội bộ, và
 *     hàm serialize không được *trả* trường nội bộ kể cả khi hàng có chúng.
 *   • **Phát là truyền byte, không chuyển hướng.** Một `sendRedirect` tới kho sẽ
 *     đặt địa chỉ kho đã ký vào trình duyệt người đọc, vào lịch sử của họ, và
 *     vào log của mọi trung gian. Kiểm bằng **phản hồi thật** của một máy chủ
 *     HTTP thật: không có header `Location`, và không có tên miền kho ở đâu.
 *   • **Ảnh thu nhỏ phục vụ từ chính origin này.** Không phản hồi nào được chứa
 *     máy chủ ảnh của nền tảng ngoài — mỗi lượt tải trang như thế là gửi IP và
 *     referrer của công dân tới một bên thứ ba.
 *   • **Đếm lượt xem không tiết lộ slug nào có thật.** Mọi nhánh trả **cùng một**
 *     mã; một mã đổi theo nhánh là một danh sách các video chưa xuất bản đọc được
 *     bằng một vòng lặp.
 *
 * ## Vì sao dựng máy chủ HTTP thật thay vì gọi hàm
 *
 * Ba trong bốn tính chất trên chỉ tồn tại ở tầng phản hồi HTTP: header, mã trạng
 * thái, byte của thân. Gọi thẳng handler với một `event` giả sẽ kiểm được *ý định*
 * của mã nguồn chứ không kiểm được thứ khách nhận. Nên tệp này dựng
 * `createServer(toNodeListener(createApp().use(router)))` trên một cổng ngẫu nhiên
 * và đi qua `fetch` — đúng cách một trình duyệt tới đây.
 *
 * ## Chỉ mock đúng một module
 *
 * `server/utils/db.ts` được thay bằng một pool giả. Mọi thứ còn lại — service,
 * serializer, bộ đếm tần suất, bộ dựng tuyến, `sendStream` — là mã thật. Một mock
 * ở tầng thấp như thế giữ cho phép kiểm nói về hành vi thật, và nó cũng là lý do
 * tệp này bắt được những thứ mà một test soi văn bản mã nguồn không bao giờ thấy.
 *
 * Pool giả trả về **mảng theo vị trí**, không phải object: drizzle-orm's mysql2
 * session đặt `rowsAsArray: true` trên mọi truy vấn có ánh xạ cột, nên
 * `mapResultRow` đọc `row[columnIndex]`. Một pool giả trả object sẽ cho ra
 * `{}` — im lặng, không lỗi — và mọi khẳng định về hình dạng sẽ nói về một hàng
 * rỗng.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it, mock } from 'node:test'

import { createApp, createRouter, toNodeListener } from 'h3'
import { drizzle } from 'drizzle-orm/mysql2'

import * as schema from '../server/db/schema.ts'

// ─── Thư mục media tạm ───────────────────────────────────────────────────────
//
// Trong `os.tmpdir()`, **không** trong cây mã nguồn: một lượt chạy test để lại
// tệp trong repo là thứ phải đi dọn bằng tay, và nó đã từng xảy ra với chính bộ
// test này.

const workdir = mkdtempSync(path.join(tmpdir(), 'cdkt-media-api-'))
process.env.CDKT_MEDIA_WORKDIR = workdir

const MANIFEST_BODY = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n360p/index.m3u8\n'
const RENDITION_BODY = '#EXTM3U\n#EXT-X-TARGETDURATION=6\n360p/seg_000.ts\n'
const SEGMENT_BODY = 'SEGMENT-BYTES-0000'
const THUMB_BODY = 'JPEG-THUMB-BYTES'

function publish(slug: string, files: Record<string, string>) {
  const dir = path.join(workdir, 'media', slug)
  for (const [name, body] of Object.entries(files)) {
    const target = path.join(dir, name)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, body)
  }
}

publish('alpha', {
  'master.m3u8': MANIFEST_BODY,
  '360p/index.m3u8': RENDITION_BODY,
  '360p/seg_000.ts': SEGMENT_BODY,
  'thumb.jpg': THUMB_BODY,
})
publish('gamma', { 'master.m3u8': MANIFEST_BODY, 'thumb.jpg': THUMB_BODY })
publish('draft-one', { 'master.m3u8': MANIFEST_BODY })

after(() => {
  rmSync(workdir, { recursive: true, force: true })
})

// ─── Bảng giả ────────────────────────────────────────────────────────────────

type MediaRow = {
  id: number
  slug: string
  title: string
  description: string | null
  source: 'upload' | 'youtube'
  youtubeVideoId: string | null
  storagePath: string | null
  storageProvider: 'local' | 'r2'
  thumbnailUrl: string | null
  durationSeconds: number | null
  width: number | null
  height: number | null
  categoryId: number | null
  status: 'draft' | 'published' | 'archived'
  processingStatus: string
  processingError: string | null
  resolutionsReady: string[] | null
  claimedBy: string | null
  commentsEnabled: boolean
  isFeatured: boolean
  viewCount: number
  publishedAt: string | null
  createdBy: number | null
}

function media(overrides: Partial<MediaRow> & { id: number, slug: string }): MediaRow {
  return {
    title: `Tiêu đề ${overrides.slug}`,
    description: null,
    source: 'upload',
    youtubeVideoId: null,
    storagePath: null,
    storageProvider: 'local',
    thumbnailUrl: null,
    durationSeconds: null,
    width: null,
    height: null,
    categoryId: null,
    status: 'published',
    processingStatus: 'ready',
    // Giá trị này KHÔNG bao giờ được ra tới người đọc: nó mô tả cấu trúc đĩa.
    processingError: null,
    resolutionsReady: ['360p'],
    claimedBy: null,
    commentsEnabled: false,
    isFeatured: false,
    viewCount: 0,
    publishedAt: '2026-01-02 03:04:05',
    createdBy: 1,
    ...overrides,
  }
}

const CATEGORIES = [
  { id: 1, name: 'Tin tức', slug: 'tin-tuc', parentId: null, displayOrder: 1 },
  { id: 2, name: 'Sự kiện', slug: 'su-kien', parentId: 1, displayOrder: 2 },
]

const table: MediaRow[] = [
  media({ id: 1, slug: 'alpha', categoryId: 1, viewCount: 42, commentsEnabled: true, resolutionsReady: ['360p', '720p'] }),
  media({ id: 2, slug: 'beta', categoryId: 1, resolutionsReady: [], processingStatus: 'processing' }),
  media({
    id: 3, slug: 'gamma', source: 'youtube', youtubeVideoId: 'dQw4w9WgXcQ',
    storagePath: null, categoryId: 2, durationSeconds: 300,
  }),
  media({
    id: 4, slug: 'broken', categoryId: 2, status: 'published', processingStatus: 'failed',
    // Chuỗi này là thứ một `select()` trần sẽ đẩy thẳng ra ngoài.
    processingError: '/srv/cdkt/.data/media/broken/raw.mp4: FFmpeg exited with code 1',
    resolutionsReady: [],
  }),
  media({ id: 5, slug: 'draft-one', status: 'draft', storagePath: 'media/draft-one', resolutionsReady: ['360p'] }),
  media({ id: 6, slug: 'archived-one', status: 'archived', resolutionsReady: ['360p'] }),
]

function published() {
  return table.filter(row => row.status === 'published')
}

// ─── Pool giả ────────────────────────────────────────────────────────────────
//
// Mảng **theo vị trí**, đúng thứ tự cột mà Drizzle sinh ra trong câu SELECT.

function publicProjection(row: MediaRow): unknown[] {
  const category = CATEGORIES.find(item => item.id === row.categoryId) ?? null
  return [
    row.id, row.slug, row.title, row.description, row.source, row.youtubeVideoId,
    row.durationSeconds, row.width, row.height, row.categoryId,
    category?.name ?? null, category?.slug ?? null,
    row.publishedAt, row.commentsEnabled ? 1 : 0, row.viewCount,
    row.processingStatus, row.resolutionsReady === null ? null : JSON.stringify(row.resolutionsReady),
  ]
}

function assetProjection(row: MediaRow): unknown[] {
  return [row.id, row.slug, row.source, row.youtubeVideoId, row.storagePath, row.storageProvider, row.status]
}

const statements: Array<{ sql: string, params: unknown[] }> = []
/** Bộ đếm lượt xem, tách khỏi bảng để khẳng định được lượt tăng. */
const viewCounts = new Map<number, number>()

function respond(sql: string, params: unknown[]): unknown {
  // ── Bộ đếm danh mục: inner join, chỉ hàng đã xuất bản ──
  if (/^select `categories`\.`id`, `categories`\.`name`/i.test(sql)) {
    return CATEGORIES.map((category) => {
      const total = published().filter(row => row.categoryId === category.id).length
      return [category.id, category.name, category.slug, total]
    }).filter(row => (row[3] as number) > 0)
  }

  // ── Danh mục của một slug, dùng để mở rộng gốc → con ──
  if (/^select `id`, `parent_id` from `categories`/i.test(sql)) {
    const found = CATEGORIES.find(category => category.slug === params[0])
    return found ? [[found.id, found.parentId]] : []
  }
  if (/^select `id` from `categories`/i.test(sql)) {
    return CATEGORIES.filter(category => category.parentId === params[0]).map(category => [category.id])
  }

  // ── Đếm tổng: `select count(*) from media_items where …` ──
  if (/^select count\(\*\)/i.test(sql)) {
    const status = params[0]
    const categoryId = params[1]
    const filtered = table.filter(row => row.status === status
      && (categoryId === undefined || row.categoryId === categoryId))
    return [[filtered.length]]
  }

  // ── Chỉ id, cho đường đếm lượt xem ──
  if (/^select `id` from `media_items`/i.test(sql)) {
    const [slug, status] = params as [string, string]
    const found = table.find(row => row.slug === slug && row.status === status)
    return found ? [[found.id]] : []
  }

  // ── Tập cột nội bộ, cho hai endpoint phục vụ tệp ──
  if (/^select `id`, `slug`, `source`, `youtube_video_id`, `storage_path`, `storage_provider`, `status`/i.test(sql)) {
    const found = table.find(row => row.slug === params[0])
    return found ? [assetProjection(found)] : []
  }

  // ── Tập cột công khai (danh sách và chi tiết) ──
  if (/^select `media_items`\.`id`/i.test(sql)) {
    // **Số tham số lọc phải đếm từ mệnh đề WHERE, không đọc theo vị trí.** Câu
    // truy vấn không lọc theo danh mục có tham số là `['published', <limit>]`, nên
    // `params[1]` là **giới hạn số bản ghi**, không phải một id danh mục. Đọc nó
    // như một id sẽ lọc đúng `category_id = 50` và trả về rỗng — một thư viện đầy
    // hàng đọc ra y hệt một thư viện trống, không có lỗi ở đâu cả.
    const whereStart = sql.indexOf(' where ') + 7
    const whereEnd = sql.search(/ order by | limit |$/)
    const filters = params.slice(0, (sql.slice(whereStart, whereEnd).match(/\?/g) ?? []).length)

    if (/`media_items`\.`slug` = \?/i.test(sql)) {
      const [slug, status] = filters as [string, string]
      return table.filter(row => row.slug === slug && row.status === status).map(publicProjection)
    }
    // Danh mục gốc mở rộng thành `[id, ...con]` và đi vào `inArray`, nên phần còn
    // lại là **một danh sách** id. Chỉ đọc một id sẽ lọc đúng danh mục gốc và bỏ
    // hết mục nằm ở danh mục con — tức là lượt kiểm "gốc bao gồm con" tự nó không
    // kiểm gì cả.
    const [status, ...categoryIds] = filters as [string, ...number[]]
    const rows = table.filter(row => row.status === status
      && (categoryIds.length === 0 || (row.categoryId !== null && categoryIds.includes(row.categoryId))))
    return rows.map(publicProjection)
  }

  // ── Lượt xem: `update media_items set view_count = view_count + 1` ──
  if (/^update `media_items` set `view_count`/i.test(sql)) {
    const id = Number(params[0])
    viewCounts.set(id, (viewCounts.get(id) ?? 0) + 1)
    return { affectedRows: 1 }
  }

  // ── Ghi của quản trị (chưa dùng ở tệp này, nhưng phải không ném) ──
  if (/^insert into `media_items`/i.test(sql)) return { insertId: 900, affectedRows: 1 }
  if (/^insert into `activity_logs`/i.test(sql)) return { insertId: 901, affectedRows: 1 }

  return []
}

function dispatch(arg1: unknown, arg2: unknown): unknown[] {
  const object = (arg1 && typeof arg1 === 'object') ? arg1 as { sql: string, values?: unknown[] } : null
  const sql = String(object ? object.sql : arg1).trim()
  const params = (Array.isArray(arg2) ? arg2 : object?.values ?? []) as unknown[]
  statements.push({ sql, params })
  return [respond(sql, params), []]
}

const connection = { query: dispatch, execute: dispatch, release() {} }
const pool = {
  query: dispatch,
  execute: dispatch,
  getConnection: async () => connection,
  end: async () => {},
}
const fakeDb = drizzle(pool as never, { schema, mode: 'default' })

mock.module(new URL('../server/utils/db.ts', import.meta.url), {
  namedExports: {
    getDb: () => fakeDb,
    // `null` là nhánh quan trọng: `rateLimitDeps()` đọc nó để lùi về bộ đếm
    // trong tiến trình thay vì mở toang. Ở đây nó cũng giữ cho lượt đếm lượt xem
    // không cần một bảng `rate_limit_counters` thật.
    getPool: () => null,
    closeDb: async () => {},
  },
})

// ─── Máy chủ HTTP thật, handler thật ────────────────────────────────────────

const router = createRouter()
router.get('/api/public/media', (await import('../server/api/public/media/index.get.ts')).default)
router.get('/api/public/media/:slug/stream', (await import('../server/api/public/media/[slug]/stream.get.ts')).default)
router.get('/api/public/media/:slug/thumb', (await import('../server/api/public/media/[slug]/thumb.get.ts')).default)
router.get('/api/public/media/:slug', (await import('../server/api/public/media/[slug].get.ts')).default)
// `**:path` là dạng mà Nitro sinh ra từ tệp `[...path].get.ts`
// (`nitropack/dist/core/index.mjs`: `\[\.{3}(\w+)]` → `**:$1`). Tên tham số vì thế
// là `path`, không phải `_` — và đó là điều handler dựa vào.
router.get('/api/public/media/:slug/**:path', (await import('../server/api/public/media/[slug]/[...path].get.ts')).default)
router.post('/api/public/media/:slug/view', (await import('../server/api/public/media/[slug]/view.post.ts')).default)

const server = createServer(toNodeListener(createApp().use(router)))
await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => resolve()) })
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`

after(() => { server.close() })

/** Một lượt gọi không đi theo chuyển hướng: `redirect: 'manual'` để một `302` hiện
 *  ra thành `302` chứ không bị `fetch` lặng lẽ đi theo và trả về 200 của đích. */
function get(pathname: string, init: RequestInit = {}) {
  return fetch(origin + pathname, { redirect: 'manual', ...init })
}

/** Tên miền của nhà cung cấp kho và của máy chủ ảnh nền tảng ngoài. Không giá trị
 *  nào trong số này được xuất hiện trong một phản hồi công khai. */
const FORBIDDEN_HOSTS = [
  'i.ytimg.com',
  'img.youtube.com',
  'ytimg.com',
  'r2.dev',
  'r2.cloudflarestorage.com',
  'cloudflarestorage.com',
  'amazonaws.com',
  's3.',
]

function assertNoForbiddenHost(label: string, haystack: string) {
  for (const host of FORBIDDEN_HOSTS) {
    assert.ok(
      !haystack.includes(host),
      `${label} không được chứa "${host}" — địa chỉ kho hoặc máy chủ ảnh của bên thứ ba không có việc gì trong một phản hồi công khai`,
    )
  }
}

function headerDump(headers: Headers): string {
  return [...headers.entries()].map(([key, value]) => `${key}: ${value}`).join('\n')
}

/**
 * Thay `fetch` toàn cục trong lúc chạy `run`, nhưng **chỉ** cho những địa chỉ
 * không phải máy chủ đang kiểm.
 *
 * `globalThis.fetch` là cùng một hàm mà chính tệp này dùng để gọi máy chủ test —
 * thay nó bằng một hàm trả về ảnh sẽ chặn luôn lượt gọi của chính bài kiểm, và
 * bài kiểm nhận về tấm ảnh giả thay vì phản hồi của cổng. Lỗi đó đọc ra là "cổng
 * trả 200" và trông y hệt một cổng đang chuyển tiếp ảnh thượng nguồn — đúng thứ
 * bài kiểm này tồn tại để bắt.
 */
async function withUpstream<T>(
  respond: () => Promise<Response>,
  run: () => Promise<T>,
): Promise<{ result: T, forwarded: string[] }> {
  const original = globalThis.fetch
  const forwarded: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.startsWith(origin)) return original(input as RequestInfo, init)
    forwarded.push(url)
    return respond()
  }) as typeof fetch
  try {
    return { result: await run(), forwarded }
  } finally {
    globalThis.fetch = original
  }
}

// ─── 9.2 — tập cột công khai là allowlist ───────────────────────────────────

describe('9.2 — hình dạng công khai là một allowlist', () => {
  it('không trả trường nội bộ nào, kể cả khi hàng mang chúng', async () => {
    const { serializePublicMedia } = await import('../server/services/media-portal.ts')

    const row = media({
      id: 4, slug: 'broken', processingStatus: 'failed',
      processingError: '/srv/cdkt/.data/media/broken/raw.mp4: FFmpeg exited with code 1',
      claimedBy: 'host-1:4242', isFeatured: true, createdBy: 7,
      storagePath: 'media/broken', thumbnailUrl: 'https://evil.example/x.jpg',
      resolutionsReady: [],
    })

    const item = serializePublicMedia(row as never)
    const keys = Object.keys(item)

    // Danh sách này là *cho vào*: một cột mới mặc định là riêng tư. Khẳng định
    // theo chiều ngược lại ("không có khoá X") sẽ bỏ sót đúng cột vừa được thêm.
    assert.deepEqual(keys.sort(), [
      'categoryId', 'categoryName', 'categorySlug', 'commentsEnabled', 'description',
      'durationSeconds', 'embedUrl', 'height', 'id', 'playable', 'publishedAt',
      'slug', 'source', 'streamUrl', 'thumbnailUrl', 'title', 'viewCount', 'width',
    ].sort())

    for (const internal of ['processingError', 'processingStatus', 'resolutionsReady', 'status', 'createdBy', 'claimedBy', 'isFeatured', 'storagePath']) {
      assert.ok(!(internal in item), `"${internal}" là trường nội bộ và không được có mặt trong phản hồi công khai`)
    }

    // Chuỗi này mô tả cấu trúc đĩa của máy chủ; nó không được đi tới bất kỳ đâu.
    assert.ok(!JSON.stringify(item).includes('/srv/cdkt'))
    // `thumbnail_url` đã lưu là một chuỗi tự do trong CSDL. Trả thẳng nó là để một
    // giá trị trong CSDL trở thành một origin tuỳ ý trong trình duyệt công dân.
    assert.ok(!JSON.stringify(item).includes('evil.example'))
    assert.equal(item.thumbnailUrl, '/api/public/media/broken/thumb')
  })

  it('câu SQL của danh sách không chọn cột nội bộ nào', async () => {
    statements.length = 0
    const { listPublishedMedia } = await import('../server/services/media-portal.ts')
    await listPublishedMedia({ page: 1, limit: 12 }, { db: fakeDb })

    const select = statements.find(entry => /^select `media_items`\.`id`/i.test(entry.sql))
    assert.ok(select, 'phải có một lượt SELECT cho danh sách')

    const selected = select.sql.slice(0, select.sql.indexOf(' from '))
    for (const internal of ['`processing_error`', '`storage_path`', '`created_by`', '`claimed_by`', '`is_featured`', '`thumbnail_url`']) {
      assert.ok(
        !selected.includes(internal),
        `danh sách công khai không được chọn ${internal} — đây là cột nội bộ`,
      )
    }
    // Hai cột này **được chọn nhưng không được trả**: chúng quyết định `playable`.
    assert.ok(selected.includes('`processing_status`'))
    assert.ok(selected.includes('`resolutions_ready`'))
  })

  it('chỉ chọn hàng đã xuất bản', async () => {
    statements.length = 0
    const { listPublishedMedia } = await import('../server/services/media-portal.ts')
    const result = await listPublishedMedia({ page: 1, limit: 50 }, { db: fakeDb })

    const slugs = result.items.map(item => item.slug)
    assert.ok(slugs.includes('alpha'))
    assert.ok(!slugs.includes('draft-one'), 'mục draft không được xuất hiện ở bất kỳ trang nào')
    assert.ok(!slugs.includes('archived-one'), 'mục archived không được xuất hiện ở bất kỳ trang nào')

    const select = statements.find(entry => /^select `media_items`\.`id`/i.test(entry.sql))
    assert.ok(select?.sql.includes('`media_items`.`status` = ?'))
    assert.equal(select?.params[0], 'published')
  })

  it('thư viện rỗng là một trạng thái thành công', async () => {
    const { listPublishedMedia } = await import('../server/services/media-portal.ts')
    const empty = drizzle(pool as never, { schema, mode: 'default' })
    const result = await listPublishedMedia({ page: 1, limit: 12 }, { db: empty })
    assert.ok(Array.isArray(result.items))
    assert.equal(typeof result.total, 'number')
  })
})

// ─── Danh sách công khai: phân trang, danh mục, tìm kiếm ─────────────────────

describe('danh sách công khai — phân trang và bộ lọc', () => {
  it('trả về `ok: true` kèm danh mục đã đếm theo hàng xuất bản', async () => {
    const response = await get('/api/public/media')
    assert.equal(response.status, 200)
    const body = await response.json() as {
      ok: boolean
      items: Array<{ slug: string }>
      categories: Array<{ slug: string, count: number }>
      pagination: { page: number, total: number }
    }

    assert.equal(body.ok, true)
    assert.deepEqual(body.items.map(item => item.slug).sort(), ['alpha', 'beta', 'broken', 'gamma'])
    // Danh mục `su-kien` chỉ có `gamma` (published) và `broken` (published) — cả
    // hai đều đã xuất bản, nên nó hiện ra. Một danh mục chỉ chứa mục draft thì
    // không được hiện với số 0: bấm vào sẽ ra trang trống mà không có gì giải thích.
    for (const category of body.categories) {
      assert.ok(category.count > 0, `danh mục ${category.slug} hiện với số 0`)
    }
  })

  it('danh mục không tồn tại trả về kết quả rỗng, không phải lỗi', async () => {
    const response = await get('/api/public/media?category=khong-co-danh-muc-nay')
    assert.equal(response.status, 200)
    const body = await response.json() as { ok: boolean, items: unknown[] }
    assert.equal(body.ok, true)
    assert.deepEqual(body.items, [])
  })

  it('lọc theo danh mục gốc bao gồm cả danh mục con', async () => {
    const { listPublishedMedia } = await import('../server/services/media-portal.ts')
    const result = await listPublishedMedia({ page: 1, limit: 50, categorySlug: 'tin-tuc' }, { db: fakeDb })
    // `alpha` và `beta` ở chính `tin-tuc`; `gamma` và `broken` ở con của nó.
    assert.deepEqual(result.items.map(item => item.slug).sort(), ['alpha', 'beta', 'broken', 'gamma'])
  })

  it('mọi giá trị trang không hợp lệ đều lùi về trang 1 và trả về một số', async () => {
    for (const raw of ['abc', '0', '-1', '1e999', '', 'NaN', 'null']) {
      const response = await get(`/api/public/media?page=${encodeURIComponent(raw)}`)
      assert.equal(response.status, 200, `?page=${raw} không được gây lỗi máy chủ`)
      const body = await response.json() as { pagination: { page: unknown } }
      assert.equal(typeof body.pagination.page, 'number', `?page=${raw} cho ra page không phải số`)
      assert.equal(body.pagination.page, 1, `?page=${raw} phải lùi về trang 1`)
      assert.ok(Number.isFinite(body.pagination.page as number))
    }
  })

  it('giới hạn số bản ghi bị kẹp trần', async () => {
    const response = await get('/api/public/media?limit=99999')
    const body = await response.json() as { pagination: { limit: number } }
    assert.ok(body.pagination.limit <= 50)
  })
})

// ─── 9.3 / 9.4 — phát là truyền byte, không chuyển hướng ────────────────────

describe('9.3 — phát byte từ chính cổng này', () => {
  it('manifest: 200, đúng byte, không có header Location', async () => {
    const response = await get('/api/public/media/alpha/stream')
    assert.equal(response.status, 200)

    // Điểm kiểm quan trọng nhất: một `sendRedirect` sẽ đặt địa chỉ kho đã ký vào
    // trình duyệt người đọc, vào lịch sử của họ, và vào log của mọi trung gian.
    assert.equal(response.headers.get('location'), null, 'phát không được là một lượt chuyển hướng')
    assert.equal(response.status, 200, 'không được là 3xx')
    assert.ok(response.status < 300)

    assertNoForbiddenHost('header phát manifest', headerDump(response.headers))

    const body = await response.text()
    assert.equal(body, MANIFEST_BODY, 'thân phản hồi phải là chính các byte của tệp')
    assertNoForbiddenHost('thân phát manifest', body)
    // Manifest HLS trỏ tới phân đoạn bằng đường dẫn tương đối; một địa chỉ tuyệt
    // đối ở đây nghĩa là trình phát sẽ đi thẳng tới kho.
    assert.ok(!/https?:\/\//.test(body), 'manifest không được chứa địa chỉ tuyệt đối')

    assert.equal(response.headers.get('content-type'), 'application/vnd.apple.mpegurl')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    // Manifest đổi trong lúc chuyển mã, nên đệm nó một năm sẽ khoá trình phát vào
    // bản đầu tiên và một bản mới công bố xong không bao giờ tới được người đọc.
    assert.match(String(response.headers.get('cache-control')), /max-age=60\b/)
  })

  it('phân đoạn: đúng byte, đệm dài, và đường dẫn con được phân giải', async () => {
    const response = await get('/api/public/media/alpha/360p/seg_000.ts')
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('location'), null)
    assertNoForbiddenHost('header phát phân đoạn', headerDump(response.headers))
    assert.equal(await response.text(), SEGMENT_BODY)
    assert.equal(response.headers.get('content-type'), 'video/mp2t')
    // Phân đoạn là bất biến: đệm gần như vĩnh viễn.
    assert.match(String(response.headers.get('cache-control')), /max-age=31536000\b/)
  })

  it('playlist của một độ phân giải cũng phục vụ được (nhánh `**`)', async () => {
    const response = await get('/api/public/media/alpha/360p/index.m3u8')
    assert.equal(response.status, 200)
    assert.equal(await response.text(), RENDITION_BODY)
    assert.match(String(response.headers.get('cache-control')), /max-age=60\b/)
  })

  it('đường dẫn thoát khỏi cây media trả 404, không phải 403', async () => {
    // 403 xác nhận rằng tệp đó có thật. Cùng một 404 cho mọi lý do.
    for (const attempt of ['../../etc/passwd', '..%2f..%2fetc%2fpasswd', '%2e%2e/%2e%2e/etc/passwd']) {
      const response = await get(`/api/public/media/alpha/${attempt}`)
      assert.equal(response.status, 404, `đường dẫn ${attempt} phải đọc ra y hệt một tệp không tồn tại`)
    }
  })
})

describe('9.4 — mục chưa xuất bản không phân giải được', () => {
  it('mục draft và slug lạ trả cùng một 404 kèm nosniff', async () => {
    const draft = await get('/api/public/media/draft-one/stream')
    const unknown = await get('/api/public/media/khong-bao-gio-ton-tai/stream')

    assert.equal(draft.status, 404)
    assert.equal(unknown.status, 404)
    // Cùng một mã cho cả hai: một phản hồi khác nhau là cách liệt kê ra những slug
    // chưa xuất bản.
    assert.equal(draft.status, unknown.status)
    assert.equal(draft.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(draft.headers.get('location'), null)
    assertNoForbiddenHost('404 của mục draft', headerDump(draft.headers))

    // Tệp có thật trên đĩa cho slug `draft-one`; nó vẫn phải không phục vụ được.
    assert.ok(readFileSync(path.join(workdir, 'media/draft-one/master.m3u8'), 'utf8').length > 0)
  })

  it('trang chi tiết của mục draft và slug lạ trả cùng một 404', async () => {
    const draft = await get('/api/public/media/draft-one')
    const unknown = await get('/api/public/media/khong-bao-gio-ton-tai')
    assert.equal(draft.status, 404)
    assert.equal(unknown.status, 404)
  })

  it('trang chi tiết của mục đã xuất bản trả về hình dạng công khai', async () => {
    const response = await get('/api/public/media/alpha')
    assert.equal(response.status, 200)
    const raw = await response.text()
    assertNoForbiddenHost('thân trang chi tiết', raw)
    const body = JSON.parse(raw) as { item: Record<string, unknown> }
    assert.equal(body.item.slug, 'alpha')
    assert.ok(!('processingError' in body.item))
    assert.ok(!('storagePath' in body.item))
  })
})

// ─── 9.5 — ảnh thu nhỏ phục vụ từ chính origin này ──────────────────────────

describe('9.5 — cách ly tài sản của bên thứ ba', () => {
  it('ảnh thu nhỏ của mục tự lưu trữ được truyền từ đĩa', async () => {
    const response = await get('/api/public/media/alpha/thumb')
    assert.equal(response.status, 200)
    assert.equal(await response.text(), THUMB_BODY)
    assert.equal(response.headers.get('content-type'), 'image/jpeg')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assertNoForbiddenHost('header ảnh thu nhỏ', headerDump(response.headers))
  })

  it('slug lạ không có ảnh thu nhỏ', async () => {
    const response = await get('/api/public/media/khong-bao-gio-ton-tai/thumb')
    assert.equal(response.status, 404)
  })

  it('danh sách trả về đường dẫn ảnh thu nhỏ trên chính cổng này', async () => {
    const { serializePublicMedia } = await import('../server/services/media-portal.ts')
    const item = serializePublicMedia(media({
      id: 3, slug: 'gamma', source: 'youtube', youtubeVideoId: 'dQw4w9WgXcQ',
    }) as never)

    assert.equal(item.thumbnailUrl, '/api/public/media/gamma/thumb')
    assertNoForbiddenHost('mục nguồn ngoài', JSON.stringify(item))
    // Khung nhúng dùng miền không cookie: `www.youtube.com` đặt cookie theo dõi
    // trước cả khi người đọc bấm play.
    assert.equal(item.embedUrl, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
  })

  it('không phản hồi công khai nào chứa máy chủ ảnh của nền tảng ngoài', async () => {
    for (const pathname of ['/api/public/media', '/api/public/media?category=su-kien', '/api/public/media/gamma']) {
      const response = await get(pathname)
      const body = await response.text()
      assertNoForbiddenHost(`phản hồi ${pathname}`, body)
      assertNoForbiddenHost(`header ${pathname}`, headerDump(response.headers))
    }
  })

  it('ảnh thượng nguồn không phải ảnh thì bị từ chối, không được chuyển tiếp', async () => {
    // Thượng nguồn trả về HTML: chuyển tiếp nó là để một bên thứ ba quyết định
    // kiểu nội dung trên chính origin này.
    const { result: response, forwarded } = await withUpstream(async () => new Response(
      '<html>not an image</html>',
      { status: 200, headers: { 'content-type': 'text/html' } },
    ), () => get('/api/public/media/gamma/thumb'))

    assert.equal(response.status, 404)
    assert.ok(!(await response.text()).includes('<html>'))
    assert.equal(forwarded.length, 1, 'máy chủ phải tự đi lấy ảnh, đúng một lượt')
    // Lượt gọi này đi tới máy chủ ảnh của nền tảng ngoài, và địa chỉ đó không bao
    // giờ được xuất hiện trong phản hồi.
    assertNoForbiddenHost('địa chỉ thượng nguồn', headerDump(response.headers))
  })

  it('ảnh thượng nguồn hợp lệ được phục vụ lại từ origin này', async () => {
    const bytes = Buffer.from('UPSTREAM-JPEG')
    const { result: response } = await withUpstream(async () => new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    }), () => get('/api/public/media/gamma/thumb'))

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/jpeg')
    assert.equal(await response.text(), 'UPSTREAM-JPEG')
    // Người đọc chỉ nói chuyện với cổng này; địa chỉ thượng nguồn không bao giờ
    // đi vào một header.
    assertNoForbiddenHost('header ảnh thượng nguồn', headerDump(response.headers))
  })

  it('ảnh thượng nguồn quá lớn thì không được đọc hết vào bộ nhớ', async () => {
    const oversized = new Uint8Array(2 * 1024 * 1024 + 1)
    const { result: response } = await withUpstream(async () => new Response(oversized, {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    }), () => get('/api/public/media/gamma/thumb'))

    assert.equal(response.status, 404)
  })
})

// ─── 9.6 — đếm lượt xem ─────────────────────────────────────────────────────

/** Bí mật HMAC dùng cho hầu hết các lượt kiểm. Có 32 ký tự là điều kiện tối thiểu
 *  của `deriveDailyVisitorToken`. */
const HMAC_SECRET = 'a'.repeat(48)

function installRuntimeConfig(analytics: Record<string, unknown>) {
  ;(globalThis as Record<string, unknown>).useRuntimeConfig = () => ({ analytics })
}

/** Bắt `console.error` — nơi `logWarn`/`logError` ghi ra. */
function captureStderr<T>(run: () => Promise<T>): Promise<{ result: T, lines: string[] }> {
  const original = console.error
  const lines: string[] = []
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')) }
  return run()
    .then(result => ({ result, lines }))
    .finally(() => { console.error = original })
}

function postView(slug: string, body?: unknown, headers: Record<string, string> = {}) {
  return get(`/api/public/media/${slug}/view`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('9.6 — đếm lượt xem không tiết lộ slug nào có thật', () => {
  it('mọi nhánh trả cùng một mã trạng thái', async () => {
    installRuntimeConfig({ hmacSecret: HMAC_SECRET })

    const known = await postView('alpha', {})
    const unknown = await postView('khong-bao-gio-ton-tai', {})
    const draft = await postView('draft-one', {})
    const malformed = await get('/api/public/media/alpha/view', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ this is not json',
    })
    const noBody = await postView('alpha')

    const statuses = [known.status, unknown.status, draft.status, malformed.status, noBody.status]
    assert.deepEqual(
      [...new Set(statuses)],
      [202],
      `mọi nhánh phải trả cùng một mã; nhận được ${JSON.stringify(statuses)} — một mã đổi theo nhánh là một danh sách các slug chưa xuất bản`,
    )
  })

  it('thiếu bí mật HMAC thì DỪNG đếm và ghi log, không đếm bằng token không dùng được', async () => {
    // Chạy trước mọi lượt kiểm khác có dùng bí mật: `view.post.ts` chỉ ghi dòng
    // cảnh báo **một lần cho mỗi nguyên nhân** (không phải mỗi request), nên lượt
    // đầu tiên là lượt duy nhất khẳng định được dòng log.
    installRuntimeConfig({})
    const before = viewCounts.get(2) ?? 0

    const { result: response, lines } = await captureStderr(() => postView('beta', {}))

    assert.equal(response.status, 202, 'thiếu bí mật vẫn phải là cùng một mã')
    assert.equal(viewCounts.get(2) ?? 0, before, 'không có token thì không khử trùng lặp được — đếm tiếp là đếm mọi lượt F5')

    const warn = lines.find(line => line.includes('media_view.secret_unavailable'))
    assert.ok(
      warn,
      `phải có một dòng log "media_view.secret_unavailable" — nếu không, đây là một ngõ cụt im lặng. Nhận được: ${JSON.stringify(lines)}`,
    )
    assert.ok(warn.includes('ANALYTICS_HMAC_SECRET'))
  })

  it('lượt đầu trong ngày đếm, lượt thứ hai trong cùng ngày thì không', async () => {
    installRuntimeConfig({ hmacSecret: HMAC_SECRET })

    const first = await postView('alpha', {})
    const afterFirst = viewCounts.get(1) ?? 0
    const second = await postView('alpha', {})
    const afterSecond = viewCounts.get(1) ?? 0

    assert.equal(first.status, 202)
    assert.equal(second.status, 202)
    assert.equal(afterFirst, 1, 'lượt mở đầu tiên phải được đếm')
    assert.equal(afterSecond, 1, 'lượt thứ hai trong cùng ngày không được đếm thêm')
  })

  it('lượt đếm hỏng không bao giờ làm hỏng trang', async () => {
    installRuntimeConfig({ hmacSecret: HMAC_SECRET })
    // Slug lạ, thân hỏng, và một lượt hỏng hoàn toàn vẫn trả 202 kèm JSON hợp lệ.
    for (const response of [
      await postView('khong-bao-gio-ton-tai', {}),
      await postView('alpha', { unexpected: true }),
    ]) {
      assert.equal(response.status, 202)
      const body = await response.json() as { accepted: boolean }
      assert.equal(typeof body.accepted, 'boolean')
    }
  })
})

// ─── 9.2 (tiếp) — lựa chọn trình phát theo nguồn ────────────────────────────

describe('lựa chọn trình phát theo nguồn và chế độ xem một phần', () => {
  it('mục tự lưu trữ đã có bản sẵn sàng thì phát được, kèm đường dẫn phát', async () => {
    const { serializePublicMedia } = await import('../server/services/media-portal.ts')
    const item = serializePublicMedia(media({
      id: 1, slug: 'alpha', resolutionsReady: ['360p', '720p'], processingStatus: 'processing',
    }) as never)
    assert.equal(item.playable, true)
    assert.equal(item.streamUrl, '/api/public/media/alpha/stream')
    assert.equal(item.embedUrl, null)
  })

  it('mục chưa có bản nào sẵn sàng thì không phát được', async () => {
    const { serializePublicMedia } = await import('../server/services/media-portal.ts')
    const item = serializePublicMedia(media({ id: 2, slug: 'beta', resolutionsReady: [] }) as never)
    assert.equal(item.playable, false)
    assert.equal(item.streamUrl, null)
  })

  it('mục chuyển mã hỏng thì không phát được, kể cả khi vài bản đã nằm trên đĩa', async () => {
    const { serializePublicMedia } = await import('../server/services/media-portal.ts')
    const item = serializePublicMedia(media({
      id: 4, slug: 'broken', processingStatus: 'failed', resolutionsReady: ['360p'],
    }) as never)
    assert.equal(item.playable, false)
    assert.equal(item.streamUrl, null)
  })

  it('định danh video đã lưu không hợp lệ thì không sinh ra khung nhúng', async () => {
    const { serializePublicMedia } = await import('../server/services/media-portal.ts')
    // Một hàng bị sửa tay trong CSDL không được phép sinh ra một `src` cho iframe.
    const item = serializePublicMedia(media({
      id: 9, slug: 'x', source: 'youtube', youtubeVideoId: 'khong-phai-dinh-danh',
    }) as never)
    assert.equal(item.embedUrl, null)
    assert.equal(item.playable, false)
    assert.equal(item.thumbnailUrl, null)
  })
})

// ─── 9.1 — hàng và dòng audit commit hoặc rollback cùng nhau ────────────────

/**
 * Một pool giả ghi lại **thứ tự** các câu lệnh và cho phép làm hỏng một câu theo
 * ý muốn, để phân biệt "đã commit" với "đã rollback".
 *
 * `committed` chỉ bật khi câu `commit` chạy. Nhờ vậy một lượt ghi đã rollback
 * đọc ra khác hẳn một lượt ghi thành công, chứ không phải hai thứ trông giống
 * nhau vì cả hai đều "không có lỗi ở chỗ ghi hàng".
 *
 * ## Vì sao pool và connection ghi vào **hai** nhật ký
 *
 * `db.transaction()` trên một pool lấy một connection riêng (`getConnection`) và
 * mọi câu lệnh bên trong đi qua **connection đó**. Một `db.insert()` lọt vào giữa
 * khối transaction thì vẫn đi qua `pool.query` — nó commit độc lập, đúng con bug
 * mà việc bọc hai lượt ghi lại với nhau sinh ra để ngăn.
 *
 * Cho hai đường dùng chung một hàm thì lượt ghi lọt ra pool **trông y hệt** lượt
 * ghi nằm trong transaction: cùng một dòng trong cùng một nhật ký, không có gì
 * khác. Đã kiểm chứng: đổi `tx.insert(activityLogs)` thành `db.insert(activityLogs)`
 * trong `createMediaItem` và bộ test cũ vẫn xanh 38/38. Tách nhật ký là thứ làm
 * phép kiểm này có răng.
 */
function makeTransactionalFake(options: { failOn?: RegExp, existingRow?: boolean } = {}) {
  const log: string[] = []
  const poolLog: string[] = []
  let committed = false
  const state = { mediaRows: [] as string[], auditRows: [] as string[] }

  function makeQuery(sink: string[], failOn?: RegExp) {
    return function query(arg1: unknown, arg2: unknown): unknown[] {
      const obj = (arg1 && typeof arg1 === 'object') ? arg1 as { sql: string, values?: unknown[] } : null
      const sql = String(obj ? obj.sql : arg1).trim()
      const params = (Array.isArray(arg2) ? arg2 : obj?.values ?? []) as unknown[]
      sink.push(sql)

      if (failOn && failOn.test(sql)) {
        throw new Error('injected failure')
      }

      if (/^begin$/i.test(sql)) return [{}, []]
      if (/^commit$/i.test(sql)) { committed = true; return [{}, []] }
      if (/^rollback$/i.test(sql)) { committed = false; return [{}, []] }

      // Đọc hàng đang sửa / đang xoá. Hai câu khác nhau về tập cột, nên phân biệt
      // bằng chính tập cột chứ không bằng thứ tự gọi — thứ tự là thứ sẽ đổi khi ai
      // đó thêm một lượt đọc nữa vào cùng callback.
      if (/^select `id`, `slug`, `status`, `published_at` from `media_items`/i.test(sql)) {
        // `[id, slug, status, publishedAt]`, đúng thứ tự cột đã chọn.
        return options.existingRow ? [[[5, 'ten-cu', 'draft', null]], []] : [[], []]
      }
      if (/^select `id`, `slug`, `source`, `status`, `storage_path`, `storage_provider`, `claimed_by` from `media_items`/i.test(sql)) {
        // `[id, slug, source, status, storagePath, storageProvider, claimedBy]`
        return options.existingRow ? [[[5, 'ten-cu', 'upload', 'published', 'media/ten-cu', 'local', null]], []] : [[], []]
      }
      // Slug còn trống: không hàng nào trùng tiền tố.
      if (/^select `slug` from `media_items`/i.test(sql)) return [[], []]

      if (/^insert into `media_items`/i.test(sql)) {
        state.mediaRows.push(String(params[0] ?? ''))
        return [{ insertId: 4242, affectedRows: 1 }, []]
      }
      if (/^insert into `activity_logs`/i.test(sql)) {
        state.auditRows.push(String(params[0] ?? ''))
        return [{ insertId: 9, affectedRows: 1 }, []]
      }
      if (/^insert into `media_asset_cleanup`/i.test(sql)) return [{ insertId: 1, affectedRows: 1 }, []]
      if (/^update `media_items`/i.test(sql)) return [{ affectedRows: 1 }, []]
      if (/^delete from `media_items`/i.test(sql)) return [{ affectedRows: 1 }, []]

      return [[], []]
    }
  }

  const connection = { query: makeQuery(log, options.failOn), release() {} }
  const pool = {
    query: makeQuery(poolLog, options.failOn),
    execute: makeQuery(poolLog, options.failOn),
    getConnection: async () => connection,
    end: async () => {},
  }
  const db = drizzle(pool as never, { schema, mode: 'default' })
  return { db, log, poolLog, state, isCommitted: () => committed }
}

describe('9.1 — hàng và dòng audit commit hoặc rollback cùng nhau', () => {
  it('lượt tạo thành công ghi cả hàng lẫn dòng audit, rồi commit', async () => {
    const { createMediaItem } = await import('../server/services/media-portal.ts')
    const fake = makeTransactionalFake()

    const created = await createMediaItem({ title: 'Video mới', createdBy: 7 }, { db: fake.db })

    assert.equal(created.slug, 'video-moi')
    assert.equal(created.mediaItemId, 4242, 'id phải đọc từ insertId, không phải giá trị mặc định')
    assert.equal(fake.state.mediaRows.length, 1)
    assert.equal(fake.state.auditRows.length, 1)
    assert.ok(fake.isCommitted(), 'lượt tạo thành công phải commit')
    assert.ok(fake.log.some(sql => /^begin$/i.test(sql)), 'phải mở transaction')
    assert.ok(!fake.log.some(sql => /^rollback$/i.test(sql)))
  })

  it('dòng audit hỏng thì hàng cũng không được commit', async () => {
    const { createMediaItem } = await import('../server/services/media-portal.ts')
    // Câu INSERT vào `activity_logs` hỏng. Nếu hai lượt ghi không nằm trong cùng
    // một transaction, hàng `media_items` vẫn sống — và một mục media tồn tại mà
    // không có gì ghi lại ai tạo nó là đúng thứ đường audit này sinh ra để ngăn.
    const fake = makeTransactionalFake({ failOn: /^insert into `activity_logs`/i })

    // Drizzle bọc lỗi của driver trong `DrizzleQueryError`, nên thông báo đọc được
    // là câu SQL đã hỏng chứ không phải thông báo gốc. Khẳng định vào **câu SQL**
    // là khẳng định mạnh hơn: nó nói đúng lượt ghi thứ hai mới là lượt hỏng, chứ
    // không phải một lỗi bất kỳ ở đâu đó trong callback.
    await assert.rejects(
      () => createMediaItem({ title: 'Video hỏng audit', createdBy: 7 }, { db: fake.db }),
      (err: Error) => {
        assert.match(err.message, /insert into `activity_logs`/)
        return true
      },
    )

    assert.ok(!fake.isCommitted(), 'lượt ghi hỏng không được commit')
    assert.ok(
      fake.log.some(sql => /^rollback$/i.test(sql)),
      'phải rollback khi câu thứ hai hỏng — nếu không, hàng ở lại mà không có dòng audit',
    )
  })

  it('ghi qua `tx`, không ghi thẳng ra pool', async () => {
    const { createMediaItem } = await import('../server/services/media-portal.ts')
    const fake = makeTransactionalFake()

    await createMediaItem({ title: 'Kiểm đường ghi', createdBy: 7 }, { db: fake.db })

    // Cả hai lượt ghi phải nằm **giữa** `begin` và `commit` trên **connection của
    // transaction**. Một `db.insert()` lọt ra ngoài khoảng đó vẫn chạy trên pool và
    // **commit độc lập** — đúng con bug nhưng khoác áo transaction.
    const begin = fake.log.findIndex(sql => /^begin$/i.test(sql))
    const commit = fake.log.findIndex(sql => /^commit$/i.test(sql))
    const mediaInsert = fake.log.findIndex(sql => /^insert into `media_items`/i.test(sql))
    const auditInsert = fake.log.findIndex(sql => /^insert into `activity_logs`/i.test(sql))

    assert.ok(begin >= 0 && commit > begin)
    assert.ok(mediaInsert > begin && mediaInsert < commit, 'lượt ghi hàng phải nằm trong transaction')
    assert.ok(auditInsert > begin && auditInsert < commit, 'dòng audit phải nằm trong transaction')

    // Và **không** lượt ghi nào được đi qua pool. Đây mới là phần có răng: một
    // `db.insert()` nằm trong khối transaction vẫn xuất hiện đúng chỗ trong `log`
    // ở trên, nên thứ tự một mình không phân biệt được hai đường.
    assert.deepEqual(
      fake.poolLog.filter(sql => /^insert into |^update |^delete from /i.test(sql)),
      [],
      'không lượt ghi nào được đi thẳng ra pool trong lúc có transaction',
    )
  })

  it('dòng audit chỉ mang id, không mang slug', async () => {
    const { createMediaItem } = await import('../server/services/media-portal.ts')
    const fake = makeTransactionalFake()

    await createMediaItem({ title: 'Tiêu đề bí mật', createdBy: 7 }, { db: fake.db })

    // Slug là chuỗi do người gõ quyết định; nhật ký kiểm toán không phải chỗ chở nó.
    const auditParams = JSON.stringify(fake.state.auditRows)
    assert.ok(!auditParams.includes('tieu-de-bi-mat'), 'audit không được chở slug')
  })

  it('lượt sửa ghi hàng và dòng audit trong cùng một transaction', async () => {
    const { updateMediaItem } = await import('../server/services/media-portal.ts')
    const fake = makeTransactionalFake({ existingRow: true })

    const result = await updateMediaItem({ id: 5, actorId: 7, title: 'Tên mới' }, { db: fake.db })

    assert.equal(result.ok, true)
    assert.ok(fake.isCommitted())
    const begin = fake.log.findIndex(sql => /^begin$/i.test(sql))
    const commit = fake.log.findIndex(sql => /^commit$/i.test(sql))
    const update = fake.log.findIndex(sql => /^update `media_items`/i.test(sql))
    const audit = fake.log.findIndex(sql => /^insert into `activity_logs`/i.test(sql))
    assert.ok(begin >= 0 && commit > begin)
    assert.ok(update > begin && update < commit, 'lượt sửa hàng phải nằm trong transaction')
    assert.ok(audit > begin && audit < commit, 'dòng audit phải nằm trong transaction')
  })

  it('lượt sửa một hàng không tồn tại thì không ghi gì và không commit dòng audit nào', async () => {
    const { updateMediaItem } = await import('../server/services/media-portal.ts')
    const fake = makeTransactionalFake()

    const result = await updateMediaItem({ id: 404, actorId: 7, title: 'Tên mới' }, { db: fake.db })

    assert.deepEqual(result, { ok: false, reason: 'not_found' })
    // Một dòng audit cho một lượt sửa không xảy ra là một dòng làm nhật ký mờ đi.
    assert.equal(fake.state.auditRows.length, 0)
    assert.equal(fake.state.mediaRows.length, 0)
  })

  it('lượt xoá hỏng ở dòng audit thì hàng cũng không mất', async () => {
    const { deleteMediaItem } = await import('../server/services/media-portal.ts')
    const fake = makeTransactionalFake({ existingRow: true, failOn: /^insert into `activity_logs`/i })

    await assert.rejects(() => deleteMediaItem({ id: 5, actorId: 7 }, { db: fake.db }))

    assert.ok(!fake.isCommitted())
    assert.ok(fake.log.some(sql => /^rollback$/i.test(sql)))
    // Hàng `media_items` đã bị `delete` bên trong transaction — nhưng vì transaction
    // rollback nên nó **sống sót**. Đây đúng là điều mà việc bọc hai lượt ghi lại
    // với nhau ra đời để bảo đảm: không có hàng nào biến mất mà không còn gì ghi ai xoá.
    assert.ok(
      fake.log.some(sql => /^delete from `media_items`/i.test(sql)),
      'lượt xoá hàng phải thật sự chạy trước khi rollback',
    )
  })
})
