/**
 * Hai điều chỉ MySQL thật mới chứng minh được (PR-7):
 *
 * 1. `/api/public/search` — `%` và `_` khách gõ là chữ thường (một CSDL giả
 *    không biết LIKE khớp thế nào), và `total`/`totalPages` là số đếm thật, không
 *    đổi khi bấm sang trang sau; ghép mọi trang ra đúng tập kết quả, không trùng.
 * 2. Analytics chạy trên pool dùng chung (`timezone: '+07:00'`) qua adapter UTC
 *    (`server/utils/utc-query.ts`) ghi và đọc **cùng** giá trị với pool `+00:00`
 *    riêng mà nó thay thế — một DATETIME UTC không lệch 7 giờ, một DATE không lùi
 *    sang hôm trước.
 *
 * Gated và tự dọn, theo tiền lệ *-integration:
 *
 *   PUBLIC_READ_INTEGRATION=1 PUBLIC_READ_PORT=33069 PUBLIC_READ_PASSWORD=... npm test
 */
import assert from 'node:assert/strict'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import test from 'node:test'
import mysql, { type RowDataPacket } from 'mysql2/promise'
import { createEvent, defineEventHandler, getCookie, getQuery, type H3Event } from 'h3'

const enabled = process.env.PUBLIC_READ_INTEGRATION === '1'
const host = process.env.PUBLIC_READ_HOST || '127.0.0.1'
const port = Number(process.env.PUBLIC_READ_PORT || 3306)
const user = process.env.PUBLIC_READ_USER || 'root'
const password = process.env.PUBLIC_READ_PASSWORD || 'rootpassword'
const database = `cdkt_public_read_${Date.now()}_${process.pid}`

/** Never let a typo in the env point this at a real deployment. */
function assertDisposableDatabase(name: string) {
  assert.match(name, /^cdkt_public_read_\d+_\d+$/)
  assert.notEqual(name, 'cdkt_admin')
  assert.notEqual(name, process.env.DB_NAME)
}

const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = defineEventHandler
globals.getQuery = getQuery
globals.getCookie = getCookie

function makeEvent(url: string): H3Event {
  const req = new IncomingMessage(new Socket())
  req.url = url
  req.method = 'GET'
  req.headers = { host: 'localhost' }
  return createEvent(req, new ServerResponse(req))
}

type SearchBody = { ok: boolean; items: Array<{ id: string | number; title: string; kind: string }>; total: number; counts: Record<string, number>; pagination: { page: number; totalPages: number; total: number } }

test('tìm kiếm công khai và analytics trên MySQL thật', { skip: !enabled, timeout: 180_000 }, async (t) => {
  assertDisposableDatabase(database)
  const previous = { ...process.env }
  Object.assign(process.env, { DB_HOST: host, DB_PORT: String(port), DB_USER: user, DB_PASSWORD: password, DB_NAME: database })
  const admin = await mysql.createConnection({ host, port, user, password })
  let raw: mysql.Connection | null = null
  try {
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    const { initDb } = await import('../server/db/init')
    await initDb()
    raw = await mysql.createConnection({ host, port, user, password, database, timezone: '+00:00' })

    const [[mode]] = await raw.query<RowDataPacket[]>('SELECT @@sql_mode AS mode')
    assert.doesNotMatch(String(mode?.mode), /NO_BACKSLASH_ESCAPES/, 'escape `\\` của containsPattern cần sql_mode mặc định')

    // ── Dữ liệu: token "zqx" để không đụng hàng nào initDb có thể đã gieo ──────
    const article = (slug: string, title: string, type = 'news', status = 'published', minutesAgo = 0) => raw!.query(
      'INSERT INTO articles (type, title, slug, excerpt, status, published_at) VALUES (?, ?, ?, ?, ?, DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE))',
      [type, title, slug, null, status, minutesAgo],
    )
    await article('zqx-pct', 'zqx giảm 50% án phí')
    await article('zqx-under', 'zqx mã_số hồ sơ')
    await article('zqx-plain', 'zqx mãxsố hồ sơ')
    await article('zqx-draft', 'zqx bản nháp 50% chưa đăng', 'news', 'draft')
    // 23 bài khớp "zqxpage" — 20 tin + 3 tấm gương, thời điểm đăng khác nhau
    for (let i = 0; i < 23; i++) {
      await article(`zqxpage-${i}`, `zqxpage bài số ${i}`, i < 20 ? 'news' : 'role_model', 'published', i)
    }
    for (let i = 0; i < 3; i++) {
      await raw.query(
        'INSERT INTO chatbot_knowledge (canonical_question, normalized_question, approved_answer, topic, status) VALUES (?, ?, ?, ?, ?)',
        [`zqxpage câu hỏi ${i}`, `zqxpage cau hoi ${i}`, 'Trả lời đã duyệt.', 'chung', 'published'],
      )
    }
    await raw.query("INSERT INTO pages (slug, title) VALUES ('zqxpage-trang', 'Trang zqxpage')")

    const search = (await import('../server/api/public/search.get.ts')).default as unknown as (event: H3Event) => Promise<SearchBody>
    const run = async (qs: string) => {
      const event = makeEvent(`/api/public/search?${qs}`)
      const body = await search(event)
      assert.equal(event.node.res.statusCode, 200)
      assert.equal(body.ok, true)
      return body
    }

    await t.test('`%` và `_` khách gõ là chữ thường, không phải ký tự đại diện', async () => {
      const percent = await run(`q=${encodeURIComponent('50%')}&type=news`)
      assert.deepEqual(percent.items.map((i) => i.title), ['zqx giảm 50% án phí'], 'chỉ bài thật sự chứa "50%" (bản nháp không lộ)')

      const underscore = await run(`q=${encodeURIComponent('mã_số')}`)
      assert.deepEqual(underscore.items.map((i) => i.title), ['zqx mã_số hồ sơ'], '`_` không được khớp "x" trong "mãxsố"')

      const lonePercent = await run(`q=${encodeURIComponent('%')}`)
      assert.ok(lonePercent.items.every((i) => i.title.includes('%')), '`%` đơn lẻ không được khớp mọi hàng')
      assert.equal(lonePercent.total, 1)
    })

    await t.test('tổng thật, không đổi theo trang; ghép các trang ra đúng tập kết quả', async () => {
      const seen = new Set<string>()
      const totals = new Set<number>()
      const totalPages = new Set<number>()
      for (let page = 1; page <= 3; page++) {
        const body = await run(`q=zqxpage&limit=10&page=${page}`)
        totals.add(body.total)
        totalPages.add(body.pagination.totalPages)
        for (const item of body.items) {
          const key = `${item.kind}:${item.id}`
          assert.ok(!seen.has(key), `trùng ${key} giữa các trang`)
          seen.add(key)
        }
        if (page < 3) assert.equal(body.items.length, 10)
      }
      assert.deepEqual([...totals], [27], '23 bài + 3 Hỏi–Đáp + 1 trang, giống nhau ở mọi trang')
      assert.deepEqual([...totalPages], [3])
      assert.equal(seen.size, 27)

      const beyond = await run('q=zqxpage&limit=10&page=9')
      assert.deepEqual(beyond.items, [])
      assert.equal(beyond.total, 27)
    })

    await t.test('bộ đếm tab đếm mọi nguồn dù đang lọc một tab', async () => {
      const body = await run('q=zqxpage&type=role_model&limit=2')
      assert.equal(body.total, 3)
      assert.equal(body.pagination.totalPages, 2)
      assert.deepEqual(
        { all: body.counts.all, news: body.counts.news, role_model: body.counts.role_model, qa: body.counts.qa, page: body.counts.page },
        { all: 27, news: 20, role_model: 3, qa: 3, page: 1 },
      )
      assert.ok(body.items.every((i) => i.kind === 'article'))
    })

    await t.test('analytics trên pool dùng chung (+07:00) qua adapter UTC = pool +00:00 cũ', async () => {
      const { recordAnalyticsNoc } = await import('../server/services/analytics-noc')
      const { getAnalyticsNocReport, getAnalyticsSummary } = await import('../server/services/analytics-reporting')
      const instant = new Date('2026-07-22T12:00:59.000Z')

      // Đường CŨ: pool riêng `+00:00` (đúng cấu hình createAnalyticsNocPool đã xoá).
      const legacy = mysql.createPool({ host, port, user, password, database, connectionLimit: 1, timezone: '+00:00' })
      try {
        await recordAnalyticsNoc({ eventType: 'reporting_success', severity: 'info', component: 'reporting', status: 'success', errorCode: 'none', details: { windowMinutes: 60, rowCount: 1 }, occurredAt: instant }, legacy)
      } finally {
        await legacy.end()
      }
      // Đường MỚI: không tiêm kết nối → pool dùng chung `+07:00` + adapter.
      await recordAnalyticsNoc({ eventType: 'reporting_failure', severity: 'error', component: 'reporting', status: 'failure', errorCode: 'query_failed', details: { windowMinutes: 60, reasonCode: 'query_failed' }, occurredAt: instant })

      const [stored] = await raw!.query<RowDataPacket[]>(
        "SELECT event_type, CAST(bucket_start AS CHAR) AS bucket FROM analytics_noc_minute_aggregates WHERE event_type IN ('reporting_success', 'reporting_failure') AND bucket_start < '2026-08-01' ORDER BY event_type",
      )
      assert.deepEqual(stored.map((r) => [r.event_type, r.bucket]), [
        ['reporting_failure', '2026-07-22 12:00:00'],
        ['reporting_success', '2026-07-22 12:00:00'],
      ], 'cả hai đường ghi cùng một mốc phút UTC')

      const report = await getAnalyticsNocReport({ now: new Date('2026-07-22T12:05:00.000Z') })
      const buckets = report.rows.filter((r) => r.bucketStart < '2026-08').map((r) => [r.eventType, r.bucketStart]).sort()
      assert.deepEqual(buckets, [
        ['reporting_failure', '2026-07-22T12:00:00.000Z'],
        ['reporting_success', '2026-07-22T12:00:00.000Z'],
      ], 'đọc qua pool dùng chung ra đúng ISO UTC, không lệch 7 giờ')

      await raw!.query("INSERT INTO analytics_daily_traffic (day, page_views, daily_unique_visitors) VALUES ('2026-07-22', 42, 7)")
      const summary = await getAnalyticsSummary({ start: '2026-07-21', end: '2026-07-23', days: 3 }, { now: new Date('2026-07-23T00:00:00Z') })
      const day = summary.traffic.find((row) => row.pageViews === 42)
      assert.equal(day?.day, '2026-07-22', 'cột DATE đọc qua pool dùng chung không lùi sang hôm trước')
    })
  } finally {
    if (raw) await raw.end().catch(() => {})
    try {
      const { closeDb } = await import('../server/utils/db')
      await closeDb()
    } catch { /* pool chưa mở */ }
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``).catch(() => {})
    await admin.end()
    for (const key of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
  }
})
