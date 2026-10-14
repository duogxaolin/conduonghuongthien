import assert from 'node:assert/strict'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import test, { mock } from 'node:test'
import { createEvent, defineEventHandler, getCookie, getQuery, getRouterParam, type H3Event } from 'h3'
import { DrizzleQueryError } from 'drizzle-orm/errors'

/**
 * Một lượt đọc công khai mà CSDL hỏng phải đi ra là **lỗi** — log `error` với tên
 * sự kiện ổn định + HTTP 503 + `no-store` — chứ không phải `200 { ok: false }` im
 * lặng mà các khối trang chủ đọc thành "chưa có bài nào" và bộ đệm SWR giữ 60
 * giây. Các test chạy handler THẬT với một CSDL giả: chế độ `fail` ném ở mọi truy
 * vấn, chế độ `empty` trả mảng rỗng (đường thành công không đổi: 200 + `ok: true`).
 */

let mode: 'fail' | 'empty' | 'drizzle' = 'fail'

/** Chuỗi tìm kiếm của khách — KHÔNG được xuất hiện trong log. */
const SECRET_SEARCH = 'bí mật của khách 0912345678'

/** Lỗi truy vấn đúng lớp của drizzle: `message`/`params` mang tham số của khách. */
function drizzleFailure(): Error {
  const cause = Object.assign(new Error("Table 'cdkt.articles' doesn't exist"), { code: 'ER_NO_SUCH_TABLE', errno: 1146, sqlState: '42S02' })
  return new DrizzleQueryError('select `id` from `articles` where `title` like ?', [`%${SECRET_SEARCH}%`], cause)
}

/**
 * Chuỗi builder của drizzle giả: mọi thuộc tính/lời gọi trả về chính nó, và
 * `await` trên nó (đọc `then`) mới quyết định kết quả — nên handler nào xây truy
 * vấn kiểu gì cũng được, chỉ lượt thực thi là hỏng hoặc rỗng.
 */
function queryChain(): unknown {
  const target = function chain() {}
  const proxy: unknown = new Proxy(target, {
    get(_t, prop) {
      if (prop === 'then') {
        return (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => {
          if (mode === 'fail') reject(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3306'), { code: 'ECONNREFUSED' }))
          else if (mode === 'drizzle') reject(drizzleFailure())
          else resolve([])
        }
      }
      return proxy
    },
    apply() {
      return proxy
    },
  })
  return proxy
}

mock.module('../server/utils/db', {
  namedExports: {
    getDb: () => queryChain(),
    getPool: () => null,
  },
})

const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = defineEventHandler
globals.getQuery = getQuery
globals.getCookie = getCookie
globals.getRouterParam = getRouterParam

function makeEvent(url: string, params: Record<string, string> = {}): H3Event {
  const req = new IncomingMessage(new Socket())
  req.url = url
  req.method = 'GET'
  req.headers = { host: 'localhost' }
  const res = new ServerResponse(req)
  const event = createEvent(req, res)
  event.context.params = params
  return event
}

type Handler = (event: H3Event) => Promise<Record<string, unknown>>
const load = async (path: string) => (await import(path)).default as unknown as Handler

const CASES: Array<{ path: string, url: string, params?: Record<string, string>, logEvent: string }> = [
  { path: '../server/api/public/articles.get.ts', url: '/api/public/articles?type=news', logEvent: 'public.articles_list_failed' },
  { path: '../server/api/public/articles/[slug]/related.get.ts', url: '/api/public/articles/bai-1/related', params: { slug: 'bai-1' }, logEvent: 'public.article_related_failed' },
  { path: '../server/api/public/categories.get.ts', url: '/api/public/categories?type=news', logEvent: 'public.categories_failed' },
  { path: '../server/api/public/chatbot/knowledge.get.ts', url: '/api/public/chatbot/knowledge', logEvent: 'public.knowledge_list_failed' },
  { path: '../server/api/public/chatbot/quick-questions.get.ts', url: '/api/public/chatbot/quick-questions', logEvent: 'public.chatbot_quick_questions_failed' },
  { path: '../server/api/public/content-types.get.ts', url: '/api/public/content-types', logEvent: 'public.content_types_failed' },
  { path: '../server/api/public/home-sections.get.ts', url: '/api/public/home-sections', logEvent: 'public.home_sections_failed' },
  { path: '../server/api/public/languages.get.ts', url: '/api/public/languages', logEvent: 'public.languages_failed' },
  { path: '../server/api/public/settings.get.ts', url: '/api/public/settings', logEvent: 'public.settings_failed' },
  { path: '../server/api/public/search.get.ts', url: '/api/public/search?q=tai%20hoa%20nhap', logEvent: 'public.search_failed' },
  { path: '../server/api/public/pages/[slug].get.ts', url: '/api/public/pages/home', params: { slug: 'home' }, logEvent: 'public.page_render_failed' },
  // Ba endpoint từng còn trả `200 { ok: false }` (kiểm chứng 2026-10).
  { path: '../server/api/public/media/index.get.ts', url: '/api/public/media?search=b%C3%AD%20m%E1%BA%ADt', logEvent: 'public.media_list_failed' },
  { path: '../server/api/public/livestream/active.get.ts', url: '/api/public/livestream/active', logEvent: 'public.livestream_active_failed' },
  { path: '../server/api/public/livestream/chat/history.get.ts', url: '/api/public/livestream/chat/history?limit=50', logEvent: 'public.livestream_history_failed' },
]

/** Bắt các dòng log JSON mà `logger` ghi ra stderr (`console.error`). */
function captureErrorLog() {
  const lines: Array<Record<string, unknown>> = []
  const spy = mock.method(console, 'error', (line: unknown) => {
    try { lines.push(JSON.parse(String(line))) } catch { /* không phải dòng log của logger */ }
  })
  return { lines, restore: () => spy.mock.restore() }
}

for (const entry of CASES) {
  test(`${entry.url}: CSDL hỏng → 503 + no-store + log "${entry.logEvent}", không phải 200 rỗng`, async () => {
    mode = 'fail'
    const handler = await load(entry.path)
    const event = makeEvent(entry.url, entry.params)
    const log = captureErrorLog()
    let body: Record<string, unknown>
    try {
      body = await handler(event)
    } finally {
      log.restore()
    }
    assert.equal(event.node.res.statusCode, 503, 'một lượt đọc hỏng không được mang mã 200')
    assert.equal(event.node.res.getHeader('cache-control'), 'no-store')
    // Hình dạng thất bại cũ được giữ — nơi gọi và các test hợp đồng dựa vào nó.
    assert.equal(body.ok, false)
    const record = log.lines.find((line) => line.event === entry.logEvent)
    assert.ok(record, `phải có đúng một dòng log "${entry.logEvent}" — có: ${JSON.stringify(log.lines.map((l) => l.event))}`)
    assert.equal(record.level, 'error')
    assert.match(String((record.error as { message?: unknown } | undefined)?.message), /ECONNREFUSED/, 'log mang nguyên nhân để chẩn đoán')
  })

  test(`${entry.url}: CSDL trả rỗng → vẫn 200, không log lỗi`, async () => {
    mode = 'empty'
    const handler = await load(entry.path)
    const event = makeEvent(entry.url, entry.params)
    const log = captureErrorLog()
    try {
      await handler(event)
    } finally {
      log.restore()
    }
    assert.equal(event.node.res.statusCode, 200)
    assert.equal(log.lines.length, 0)
  })
}

test('trang không tồn tại vẫn là 200 { ok: false } — chỉ lượt đọc HỎNG mới là 503', async () => {
  mode = 'empty'
  const handler = await load('../server/api/public/pages/[slug].get.ts')
  const event = makeEvent('/api/public/pages/khong-co', { slug: 'khong-co' })
  const body = await handler(event)
  assert.equal(event.node.res.statusCode, 200)
  assert.deepEqual(body, { ok: false, page: null, blocks: [] })
})

test('tìm kiếm rỗng thành công vẫn trả ok: true và tổng 0', async () => {
  mode = 'empty'
  const handler = await load('../server/api/public/search.get.ts')
  const body = await handler(makeEvent('/api/public/search?q=abc&page=3'))
  assert.equal(body.ok, true)
  assert.equal(body.total, 0)
  assert.deepEqual(body.items, [])
})

test('lỗi truy vấn drizzle: log giữ lớp/mã lỗi + câu SQL đã tham số hoá, KHÔNG giữ tham số (chuỗi tìm kiếm)', async () => {
  mode = 'drizzle'
  for (const entry of [
    { path: '../server/api/public/search.get.ts', url: `/api/public/search?q=${encodeURIComponent(SECRET_SEARCH)}`, logEvent: 'public.search_failed' },
    { path: '../server/api/public/media/index.get.ts', url: `/api/public/media?search=${encodeURIComponent(SECRET_SEARCH)}`, logEvent: 'public.media_list_failed' },
  ]) {
    const handler = await load(entry.path)
    const event = makeEvent(entry.url)
    const raw: string[] = []
    const spy = mock.method(console, 'error', (line: unknown) => { raw.push(String(line)) })
    try {
      await handler(event)
    } finally {
      spy.mock.restore()
    }
    assert.equal(event.node.res.statusCode, 503)
    const line = raw.find(l => l.includes(entry.logEvent))
    assert.ok(line, `thiếu log ${entry.logEvent}`)
    assert.ok(!raw.join('\n').includes(SECRET_SEARCH), `log lộ chuỗi tìm kiếm: ${line}`)
    assert.ok(!/params:/.test(line), 'đuôi `params:` của drizzle phải bị bỏ')
    const record = JSON.parse(line) as { error: Record<string, unknown> }
    assert.equal(record.error.name, 'DrizzleQueryError')
    assert.equal(record.error.code, 'ER_NO_SUCH_TABLE')
    assert.match(String(record.error.message), /doesn't exist/)
    assert.match(String(record.error.query), /like \?/)
  }
  mode = 'fail'
})
