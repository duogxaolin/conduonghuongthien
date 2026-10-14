import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

/**
 * `analytics-noc` và `analytics-reporting` từng mở-rồi-đóng một pool MySQL riêng
 * (`timezone: '+00:00'`) cho MỖI lượt gọi. Nay chúng chạy trên pool dùng chung
 * (`+07:00`) qua adapter UTC. Các test này khoá hai điều làm adapter đúng:
 * tham số `Date` được đổi sang chuỗi UTC trước khi tới mysql2 (vì mysql2 định
 * dạng tham số theo múi giờ của KẾT NỐI), và mỗi truy vấn mang `timezone:
 * '+00:00'` để phần đọc DATE/DATETIME cũng theo UTC. Bằng chứng với MySQL thật:
 * tests/public-read-integration.test.ts.
 */

type Call = { options: Record<string, unknown>, values: unknown }
const calls: Call[] = []
const sharedPool = {
  query: async (options: Record<string, unknown>, values: unknown) => {
    calls.push({ options, values })
    return [[], []]
  },
}
let createdPools = 0
mock.module('../server/utils/db', { namedExports: { getPool: () => sharedPool, getDb: () => { throw new Error('unused') } } })
mock.module('mysql2/promise', {
  defaultExport: { createPool: () => { createdPools += 1; return sharedPool } },
  namedExports: { createPool: () => { createdPools += 1; return sharedPool } },
})

const { utcDateTimeParam, utcQueryConnection, utcQueryValues, UTC_QUERY_TIMEZONE } = await import('../server/utils/utc-query')
const { recordAnalyticsNoc } = await import('../server/services/analytics-noc')
const { getAnalyticsNocReport } = await import('../server/services/analytics-reporting')

test('Date → chuỗi DATETIME UTC, không phụ thuộc múi giờ của tiến trình', () => {
  assert.equal(utcDateTimeParam(new Date('2026-07-22T12:00:59.007Z')), '2026-07-22 12:00:59.007')
  assert.equal(utcDateTimeParam(new Date('2026-01-01T00:00:00.000+07:00')), '2025-12-31 17:00:00.000')
  assert.throws(() => utcDateTimeParam(new Date('nope')), /invalid date/)
})

test('mọi Date trong danh sách tham số (kể cả mảng lồng cho IN (?)) đều được đổi; giá trị khác giữ nguyên', () => {
  const at = new Date('2026-07-22T00:00:00.000Z')
  assert.deepEqual(utcQueryValues([at, 'total', 5, null, [at, 'x']]), ['2026-07-22 00:00:00.000', 'total', 5, null, ['2026-07-22 00:00:00.000', 'x']])
})

test('adapter gửi sql kèm timezone +00:00 theo từng truy vấn và từ chối dạng gọi khác', async () => {
  calls.length = 0
  const db = utcQueryConnection(sharedPool as never)
  await db.query('SELECT 1 WHERE t >= ?', [new Date('2026-07-22T01:02:03.000Z')])
  assert.deepEqual(calls[0], { options: { sql: 'SELECT 1 WHERE t >= ?', timezone: UTC_QUERY_TIMEZONE }, values: ['2026-07-22 01:02:03.000'] })
  assert.throws(() => (db.query as unknown as (o: unknown) => unknown)({ sql: 'SELECT 1' }), TypeError)
})

test('recordAnalyticsNoc không có kết nối tiêm vào: dùng pool dùng chung, không mở pool mới, mốc phút theo UTC', async () => {
  calls.length = 0
  createdPools = 0
  await recordAnalyticsNoc({
    eventType: 'reporting_success', severity: 'info', component: 'reporting', status: 'success', errorCode: 'none',
    details: { windowMinutes: 60, rowCount: 1 }, occurredAt: new Date('2026-07-22T12:00:59Z'),
  })
  assert.equal(createdPools, 0, 'không được mở một pool MySQL mới cho mỗi lượt ghi')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].options.timezone, '+00:00')
  assert.equal((calls[0].values as unknown[])[0], '2026-07-22 12:00:00.000')
})

test('báo cáo NOC không có kết nối tiêm vào: đọc trên pool dùng chung theo UTC', async () => {
  calls.length = 0
  createdPools = 0
  await getAnalyticsNocReport({ now: new Date('2026-07-22T12:00:00Z') })
  assert.equal(createdPools, 0)
  assert.ok(calls.length >= 1)
  assert.match(String(calls[0].options.sql), /FROM analytics_noc_minute_aggregates/)
  assert.equal(calls[0].options.timezone, '+00:00')
  assert.match(String((calls[0].values as unknown[])[0]), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/, 'mốc cắt là chuỗi UTC, không phải Date để mysql2 định dạng theo +07:00')
})
