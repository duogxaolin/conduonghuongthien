import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

/**
 * CSDL sập → MỌI lượt ghi bộ đếm hạn mức hỏng, và mỗi lượt từng ghi một dòng
 * `rate_limit.database_write_failed`: một trang đăng nhập/biểu mẫu bị dò liên tục
 * thành một trận lụt log đúng lúc người trực cần đọc log nhất. Dòng log này nay chỉ
 * ghi tối đa một lần mỗi phút mỗi tiến trình (dòng kế tiếp mang số lượt đã nén),
 * còn đường lùi về bộ đếm trong bộ nhớ thì giữ nguyên — vẫn chặn đúng ở hạn mức.
 *
 * Đồng hồ là `deps.now` (cùng đồng hồ của bộ đếm), nên kiểm được không cần chờ thật.
 */

const warnings: Array<Record<string, unknown>> = []
mock.module('../server/utils/logger', {
  namedExports: {
    logWarn: (fields: Record<string, unknown>) => { warnings.push(fields) },
  },
})

const { peekRateLimit, recordRateLimitHit, RATE_LIMIT_FAILURE_LOG_INTERVAL_MS } = await import('../server/utils/rate-limit-store')

const RULE = { limit: 3, windowSeconds: 900 }
const brokenDatabase = async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:3306') }
const writeFailures = () => warnings.filter(entry => entry.event === 'rate_limit.database_write_failed')
const readFailures = () => warnings.filter(entry => entry.event === 'rate_limit.database_read_failed')

test('khoảng nén là một phút', () => {
  assert.equal(RATE_LIMIT_FAILURE_LOG_INTERVAL_MS, 60_000)
})

test('CSDL sập: 200 lượt trong 59 giây chỉ ghi MỘT dòng log; tới phút sau ghi dòng thứ hai kèm số lượt đã nén', async () => {
  warnings.length = 0
  const memory = new Map<string, { count: number; expiresAt: number }>()
  const start = 1_900_000_000_000
  for (let i = 0; i < 200; i += 1) {
    const now = start + Math.floor((i * 59_000) / 199)
    const state = await recordRateLimitHit(`ip:${i % 7}`, RULE, { execute: brokenDatabase, now: () => now, memory })
    assert.equal(state.backend, 'memory', 'vẫn lùi về bộ đếm trong bộ nhớ ở mọi lượt')
  }
  assert.equal(writeFailures().length, 1)
  assert.equal(writeFailures()[0]!.suppressed, undefined, 'dòng đầu không có lượt nào bị nén trước nó')

  await recordRateLimitHit('ip:x', RULE, { execute: brokenDatabase, now: () => start + 60_000, memory })
  assert.equal(writeFailures().length, 2)
  assert.equal(writeFailures()[1]!.suppressed, 199, 'dòng kế tiếp nói rõ đã bỏ qua bao nhiêu lượt')
  assert.ok(writeFailures()[1]!.error instanceof Error, 'vẫn mang lỗi gốc')
})

test('đường lùi bộ nhớ vẫn chặn đúng ở hạn mức khi log đang bị nén', async () => {
  warnings.length = 0
  const memory = new Map<string, { count: number; expiresAt: number }>()
  const now = 2_000_000_000_000
  const states = []
  for (let i = 0; i < 4; i += 1) {
    states.push(await recordRateLimitHit('login:admin', RULE, { execute: brokenDatabase, now: () => now + i, memory }))
  }
  assert.deepEqual(states.map(s => s.count), [1, 2, 3, 4])
  assert.deepEqual(states.map(s => s.blocked), [false, false, true, true])
  assert.ok(writeFailures().length <= 1)
})

test('đồng hồ lùi (lượt trước dùng đồng hồ ở tương lai) không làm câm log mãi mãi', async () => {
  warnings.length = 0
  const memory = new Map<string, { count: number; expiresAt: number }>()
  await recordRateLimitHit('a', RULE, { execute: brokenDatabase, now: () => 5_000_000_000_000, memory })
  await recordRateLimitHit('a', RULE, { execute: brokenDatabase, now: () => 1_000, memory })
  assert.equal(writeFailures().length, 2)
})

test('CSDL sập: 200 lượt ĐỌC (peekRateLimit) cũng chỉ ghi MỘT dòng `database_read_failed` mỗi phút, kèm số lượt đã nén', async () => {
  // Trước đây mỗi lượt đọc hỏng ghi một dòng (kèm stack) — đọc trước khi ghi ở đăng nhập,
  // mã MFA, đổi mật khẩu, captcha: cùng trận lụt log như nhánh ghi, chỉ là nhánh kia.
  warnings.length = 0
  const memory = new Map<string, { count: number; expiresAt: number }>()
  const start = 7_000_000_000_000
  for (let i = 0; i < 200; i += 1) {
    const now = start + Math.floor((i * 59_000) / 199)
    const state = await peekRateLimit(`ip:${i % 7}`, RULE, { execute: brokenDatabase, now: () => now, memory })
    assert.equal(state.backend, 'memory', 'vẫn lùi về bộ đếm trong bộ nhớ ở mọi lượt đọc')
  }
  assert.equal(readFailures().length, 1)
  await peekRateLimit('ip:x', RULE, { execute: brokenDatabase, now: () => start + 60_000, memory })
  assert.equal(readFailures().length, 2)
  assert.equal(readFailures()[1]!.suppressed, 199)
  assert.ok(readFailures()[1]!.error instanceof Error, 'vẫn mang lỗi gốc')
})

test('nhánh đọc và nhánh ghi nén riêng: một lỗi đọc vừa ghi không làm câm lỗi ghi', async () => {
  warnings.length = 0
  const memory = new Map<string, { count: number; expiresAt: number }>()
  const now = 8_000_000_000_000
  await peekRateLimit('c', RULE, { execute: brokenDatabase, now: () => now, memory })
  await recordRateLimitHit('c', RULE, { execute: brokenDatabase, now: () => now + 1, memory })
  assert.equal(readFailures().length, 1)
  assert.equal(writeFailures().length, 1)
})

test('CSDL khoẻ lại: không ghi gì thêm', async () => {
  warnings.length = 0
  const ok = async (sql: string) => (sql.startsWith('SELECT') ? [[{ hit_count: 1, window_expires_at: new Date(9_000_000_000_000) }]] : [{ affectedRows: 1 }])
  await recordRateLimitHit('b', RULE, { execute: ok, now: () => 6_000_000_000_000 })
  assert.equal(warnings.length, 0)
})
