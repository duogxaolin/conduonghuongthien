import assert from 'node:assert/strict'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import test, { mock } from 'node:test'
import { createEvent, type H3Event } from 'h3'

/**
 * `/api/public/analytics/page-view` giới hạn mỗi IP 120 lượt nhận / 60 giây. Bộ
 * đếm từng là một `Map` riêng trong handler (mất khi khởi động lại, nhân đôi khi
 * có hai bản sao); nay nó đi qua kho dùng chung `rate-limit-store`. Các test
 * chạy handler THẬT: kho ở chế độ bộ nhớ (pool null — đúng nhánh lùi khi mất
 * CSDL), phần ghi analytics được thay bằng bộ đếm để thấy lượt nào lọt qua.
 */

const ingested: unknown[] = []
mock.module('../server/services/analytics-ingestion', {
  namedExports: {
    ingestAnalyticsPageView: async ({ payload }: { payload: unknown }) => {
      ingested.push(payload)
      return 'accepted'
    },
  },
})
/** null = CSDL mất (kho lùi về bộ nhớ); một object = pool giả ghi lại SQL. */
let fakePool: { query: (sql: string, params: unknown[]) => Promise<unknown> } | null = null
mock.module('../server/utils/db', { namedExports: { getDb: () => { throw new Error('no db in this test') }, getPool: () => fakePool } })

const globals = globalThis as unknown as Record<string, unknown>
globals.useRuntimeConfig = () => ({ analytics: { collectionEnabled: true } })

const handler = (await import('../server/api/public/analytics/page-view.post')).default as unknown as (event: H3Event) => Promise<{ accepted: boolean }>

let peer = 0
function makeEvent(ip: string, body: string): H3Event {
  const socket = new Socket()
  Object.defineProperty(socket, 'remoteAddress', { value: ip })
  const req = new IncomingMessage(socket)
  req.url = '/api/public/analytics/page-view'
  req.method = 'POST'
  req.headers = { host: 'localhost', 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) }
  ;(req as unknown as { body: string }).body = body
  return createEvent(req, new ServerResponse(req))
}

async function send(ip: string) {
  const event = makeEvent(ip, JSON.stringify({ path: '/news', n: ++peer }))
  const result = await handler(event)
  return { status: event.node.res.statusCode, accepted: result.accepted }
}

test('một IP được nhận đúng 120 lượt trong cửa sổ, lượt 121 bị chặn im lặng bằng 202', async () => {
  ingested.length = 0
  const ip = '198.51.100.7'
  for (let i = 1; i <= 120; i++) {
    const res = await send(ip)
    assert.deepEqual(res, { status: 202, accepted: true }, `lượt ${i} phải được nhận`)
  }
  const blocked = await send(ip)
  assert.deepEqual(blocked, { status: 202, accepted: false }, 'lượt 121: 202 { accepted: false } — analytics không bao giờ phá lượt duyệt web')
  assert.equal(ingested.length, 120, 'lượt bị chặn không được đi tới phần ghi')
})

test('trần tính theo từng IP — IP khác vẫn được nhận', async () => {
  ingested.length = 0
  const res = await send('203.0.113.9')
  assert.deepEqual(res, { status: 202, accepted: true })
  assert.equal(ingested.length, 1)
})

test('lượt bị chặn không đọc thân yêu cầu (chặn trước khi phân tích body)', async () => {
  ingested.length = 0
  const ip = '198.51.100.7' // đã chạm trần ở test đầu, cùng cửa sổ 60 giây
  const event = makeEvent(ip, 'đây không phải JSON')
  const result = await handler(event)
  assert.equal(event.node.res.statusCode, 202)
  assert.equal(result.accepted, false, 'thân hỏng mà vẫn 202 nghĩa là handler đã dừng trước khi đọc nó')
  assert.equal(ingested.length, 0)
})

test('bộ đếm đi vào bảng dùng chung rate_limit_counters (sống qua khởi động lại, đúng trần khi nhiều bản sao)', async () => {
  const statements: Array<{ sql: string, params: unknown[] }> = []
  const rows = new Map<string, number>()
  fakePool = {
    query: async (sql: string, params: unknown[]) => {
      statements.push({ sql, params })
      const key = String(params[0])
      if (/^\s*INSERT INTO rate_limit_counters/.test(sql)) {
        rows.set(key, (rows.get(key) ?? 0) + 1)
        return [{ affectedRows: 1 }, []]
      }
      return [[{ hit_count: rows.get(key) ?? 0, window_expires_at: new Date(Date.now() + 60_000).toISOString() }], []]
    },
  }
  try {
    ingested.length = 0
    const res = await send('192.0.2.44')
    assert.deepEqual(res, { status: 202, accepted: true })
    const insert = statements.find((s) => /INSERT INTO rate_limit_counters/.test(s.sql))
    assert.ok(insert, 'lượt xem phải ghi vào kho dùng chung, không phải một Map trong handler')
    assert.equal(insert.params[0], 'analytics-page-view:192.0.2.44', 'khoá có tiền tố riêng, không đụng khoá của bộ giới hạn khác')
    // Kho đã ở 120 thì lượt kế tiếp (121) bị chặn — trần đọc từ CSDL, không từ bộ nhớ tiến trình.
    rows.set('analytics-page-view:192.0.2.44', 120)
    const blocked = await send('192.0.2.44')
    assert.deepEqual(blocked, { status: 202, accepted: false })
    assert.equal(ingested.length, 1)
  } finally {
    fakePool = null
  }
})
