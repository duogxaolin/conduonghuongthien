import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { Agent, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import test, { after, before, beforeEach, mock } from 'node:test'

/**
 * `POST /api/csp-report` — điểm nhận báo cáo vi phạm CSP (openspec `wave3-long-term`,
 * task 2.1, spec content-security-policy: "CSP violations are observable").
 *
 * Chạy THẬT: cổng `00.origin-gate.ts` + handler `server/api/csp-report.post.ts` trong
 * một app h3 + router thật trên cổng tạm, gửi bằng `node:http` thô (đường dẫn đi
 * nguyên văn, không bị chuẩn hoá phía client). Kho giới hạn tần suất ở chế độ bộ nhớ
 * (pool null — đúng nhánh lùi khi mất CSDL); một test dùng pool giả để thấy khoá đi
 * vào bảng dùng chung. IP khách đổi bằng `X-Forwarded-For` (peer loopback là proxy
 * tin cậy mặc định, `client-ip.ts` thật) — mỗi test một IP vì bộ đếm bộ nhớ là toàn cục.
 *
 * Hợp đồng: luôn 204 (kể cả thân hỏng, sai Content-Type, quá cỡ, bị giới hạn, lỗi bất
 * ngờ); báo cáo hợp lệ được GỘP (`csp-report-log.ts`): khoá chưa từng thấy → một dòng
 * `security.csp_violation` `kind: "first"` ngay, mang directive + host (hoặc nhãn
 * `inline`/`eval`) + đường dẫn trang không query (trang lạ → `foreign:<host>`) + nhóm đường
 * dẫn + disposition + tiền tố SHA-256 của mẫu; mọi báo cáo khác → chỉ đếm, không log, không
 * CSDL; hết cửa sổ (`flush()` — việc của hẹn giờ) → một dòng `kind: "repeats"`. Không lưu gì
 * vào CSDL ngoài bộ đếm; không bao giờ gửi thư cảnh báo vận hành. Mỗi test bắt đầu từ một bộ
 * gộp trống (`reset()` ở `beforeEach`).
 */

process.env.PUBLIC_BASE_URL = 'https://portal.example.vn'
// Đặt địa chỉ nhận cảnh báo để chứng minh `security.csp_violation` không bao giờ được gửi
// đi: một sự kiện trong ALERT_EVENTS sẽ tới `opsAlerts.dispatch` giả bên dưới.
process.env.OPS_ALERT_EMAIL = 'ops@example.vn'

/** null = CSDL mất (kho lùi về bộ nhớ); một object = pool giả ghi lại SQL. */
let fakePool: { query: (sql: string, params: unknown[]) => Promise<unknown> } | null = null
/** true = `getPool()` ném lỗi — một lỗi lập trình bất ngờ trong `rateLimitDeps()`. */
let poolThrows = false
mock.module('../server/utils/db', {
  namedExports: {
    getDb: () => { throw new Error('the CSP report endpoint must not touch the database') },
    getPool: () => {
      if (poolThrows) throw new Error('unexpected failure inside rateLimitDeps')
      return fakePool
    },
    dbConnectionOptions: () => ({}),
  },
})

const dispatchedAlerts: string[] = []
mock.module('../server/utils/ops-alert', {
  namedExports: { opsAlerts: { dispatch: async (record: { event: string }) => { dispatchedAlerts.push(record.event) } } },
})

const h3 = await import('h3')
const gate = (await import('../server/middleware/00.origin-gate')).default
const handler = (await import('../server/api/csp-report.post')).default
const { isOriginGateExempt } = await import('../server/utils/origin-gate')
const { ALERT_EVENTS, SECURITY_EVENTS, settleOpsAlerts } = await import('../server/utils/logger')
const { CSP_REPORT_PATH } = await import('../shared/csp-policy')
const {
  CSP_REPORT_MAX_BODY_BYTES,
  CSP_REPORT_MAX_PER_REQUEST,
  CSP_REPORTS_LOGGED_PER_WINDOW,
  CSP_REPORT_WINDOW_SECONDS,
} = await import('../server/utils/csp-report')
const {
  CSP_REPORT_MAX_KEYS,
  CSP_REPORT_NEW_KEYS_PER_NETWORK,
  CSP_REPORT_SUMMARY_WINDOW_SECONDS,
  cspViolationLog,
} = await import('../server/utils/csp-report-log')

const hits = new Map<string, number>()
const sentinel = (name: string) => h3.defineEventHandler(() => {
  hits.set(name, (hits.get(name) ?? 0) + 1)
  return { reached: name }
})
const totalSentinelHits = () => [...hits.values()].reduce((sum, value) => sum + value, 0)

let server: Server
let port = 0
const agent = new Agent({ keepAlive: true, maxSockets: 8 })

before(async () => {
  // Same wiring Nitro uses: global middleware via `app.use`, then the router; a
  // `*.post.ts` file is registered for POST only.
  const app = h3.createApp()
  app.use('/', gate)
  const router = h3.createRouter()
  router.post(CSP_REPORT_PATH, handler)
  router.use('/api/admin/users', sentinel('admin-users'))
  router.use('/api/submissions', sentinel('public-submission'))
  router.use('/api/public/comments/**', sentinel('public-comments'))
  // Catch-all so "no sentinel ran" can never be explained by a plain 404.
  router.use('/**', sentinel('catch-all'))
  app.use('/', router.handler)
  server = (await import('node:http')).createServer(h3.toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})

after(async () => {
  agent.destroy()
  await new Promise<void>(resolve => server.close(() => resolve()))
})

/** Every structured line the logger wrote (info → console.log, warn → console.error). */
const lines: Array<Record<string, unknown>> = []
const realLog = console.log
const realError = console.error
const capture = (real: (...args: unknown[]) => void) => (...args: unknown[]) => {
  const text = String(args[0] ?? '')
  try { lines.push(JSON.parse(text)) } catch { real(...args) }
}
beforeEach(() => {
  hits.clear()
  fakePool = null
  poolThrows = false
  console.log = capture(realLog)
  console.error = capture(realError)
  // Each test starts from a fresh aggregator: no window, no seen keys, no budgets.
  // (`flush()` alone would keep the seen keys — the point of first-once logging.)
  cspViolationLog.reset()
  lines.length = 0
})
after(() => {
  cspViolationLog.stop()
  console.log = realLog
  console.error = realError
})

/** Lines written so far for `security.csp_violation` (first sightings, and summaries after a flush). */
const violations = () => lines.filter(line => line.event === 'security.csp_violation')

type Sent = { status: number, body: string, headers: Record<string, string | string[] | undefined> }
function send(path: string, headers: Record<string, string>, body?: Buffer | string, method = 'POST'): Promise<Sent> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers, agent }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { text += chunk })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text, headers: res.headers }))
    })
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

const LEGACY = 'application/csp-report'
const REPORTING = 'application/reports+json'

/** What a browser sends for a `report-uri` (Chromium 151, observed): same-origin POST. */
function browserHeaders(ip: string, contentType: string, extra: Record<string, string> = {}): Record<string, string> {
  return { host: 'portal.example.vn', 'content-type': contentType, 'x-forwarded-for': ip, ...extra }
}

/** A legacy `report-uri` body with everything a browser puts in it. */
function legacyReport(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    'csp-report': {
      'document-uri': 'https://portal.example.vn/news/tin-tuc/bai-viet?utm_source=mail&token=secret-query#comments',
      referrer: 'https://referrer.example/search?q=private-words',
      'violated-directive': 'script-src-elem',
      'effective-directive': 'script-src-elem',
      'original-policy': "default-src 'self'; script-src 'self' https://www.googletagmanager.com; report-uri /api/csp-report",
      disposition: 'report',
      'blocked-uri': 'https://evil.example.com:8443/payload.js?session=secret-blocked-query',
      'line-number': 12,
      'column-number': 34,
      'source-file': 'https://portal.example.vn/news/tin-tuc/bai-viet?utm_source=mail',
      'status-code': 200,
      'script-sample': 'alert(document.cookie)',
      ...overrides,
    },
  })
}

/** One Reporting API entry (`application/reports+json` is an array of these). */
function reportingEntry(body: Record<string, unknown>, type = 'csp-violation') {
  return {
    type,
    age: 10,
    url: 'https://portal.example.vn/media/abc?x=1',
    user_agent: 'Mozilla/5.0 (secret-agent)',
    body: {
      documentURL: 'https://portal.example.vn/media/abc?x=1#t=30',
      referrer: 'https://referrer.example/?q=private-words',
      effectiveDirective: 'script-src-elem',
      originalPolicy: "default-src 'self'",
      sourceFile: 'https://portal.example.vn/media/abc?x=1',
      sample: 'console.log("sample text")',
      disposition: 'report',
      statusCode: 200,
      lineNumber: 1,
      columnNumber: 1,
      ...body,
    },
  }
}

// ─── The contract: 204, one structured line, nothing else ─────────────────────

const samplePrefix = (sample: string) => createHash('sha256').update(sample, 'utf8').digest('hex').slice(0, 12)

test('legacy application/csp-report: 204 and ONE first-sighting line with directive, blocked host, page path, group, disposition and sample prefix only', async () => {
  const res = await send(CSP_REPORT_PATH, browserHeaders('198.51.100.10', LEGACY, { 'sec-fetch-site': 'same-origin', origin: 'https://portal.example.vn' }), legacyReport())
  assert.equal(res.status, 204)
  assert.equal(res.body, '')
  const logged = violations()
  assert.equal(logged.length, 1)
  const { level, time, ...fields } = logged[0]!
  assert.equal(level, 'info', 'a Report-Only observation is not a warning')
  assert.ok(typeof time === 'string')
  assert.deepEqual(fields, {
    event: 'security.csp_violation',
    kind: 'first',
    directive: 'script-src-elem',
    blocked: 'evil.example.com:8443',
    path: '/news/tin-tuc/bai-viet',
    pathGroup: '/news/*',
    disposition: 'report',
    sampleSha256: samplePrefix('alert(document.cookie)'),
    count: 1,
  })
})

test('query strings, fragments, samples, referrers, the policy text and the client IP never reach the log', async () => {
  await send(CSP_REPORT_PATH, browserHeaders('198.51.100.11', LEGACY), legacyReport())
  await send(CSP_REPORT_PATH, browserHeaders('198.51.100.11', REPORTING), JSON.stringify([reportingEntry({ blockedURL: 'https://cdn.example.net/x.js?key=secret-blocked-query' })]))
  const text = JSON.stringify(violations())
  assert.equal(violations().length, 2)
  for (const leak of ['secret-query', 'utm_source', 'comments', 'secret-blocked-query', 'payload.js', 'x.js', 'private-words', 'referrer.example', 'alert(', 'sample text', "default-src", 'secret-agent', '198.51.100.11', 't=30']) {
    assert.ok(!text.includes(leak), `"${leak}" reached the log: ${text}`)
  }
})

test('legacy inline violation (CSP2 style, no effective-directive): directive name only, blocked tag `inline`', async () => {
  await send(CSP_REPORT_PATH, browserHeaders('198.51.100.12', LEGACY), legacyReport({
    'effective-directive': undefined,
    'violated-directive': "script-src 'self' https://www.googletagmanager.com",
    'blocked-uri': 'inline',
  }))
  const [line] = violations()
  assert.equal(line?.directive, 'script-src', 'only the directive NAME, never the policy that follows it')
  assert.equal(line?.blocked, 'inline')
})

test('application/reports+json: every csp-violation entry is logged, other report types are ignored', async () => {
  const body = JSON.stringify([
    reportingEntry({ blockedURL: 'inline', effectiveDirective: 'script-src-elem' }),
    reportingEntry({ blockedURL: 'https://www.googletagmanager.com/gtm.js?id=GTM-SECRET', effectiveDirective: 'script-src-elem', disposition: 'enforce' }),
    reportingEntry({ blockedURL: 'eval', effectiveDirective: 'script-src' }),
    { type: 'deprecation', age: 1, url: 'https://portal.example.vn/', body: { id: 'x', message: 'deprecated thing' } },
    { type: 'csp-violation' },
    'not an object',
  ])
  const res = await send(CSP_REPORT_PATH, browserHeaders('198.51.100.13', `${REPORTING}; charset=utf-8`), body)
  assert.equal(res.status, 204)
  const logged = violations().map(({ level, kind, directive, blocked, path, pathGroup, disposition }) => ({ level, kind, directive, blocked, path, pathGroup, disposition }))
  assert.deepEqual(logged, [
    { level: 'info', kind: 'first', directive: 'script-src-elem', blocked: 'inline', path: '/media/abc', pathGroup: '/media/*', disposition: 'report' },
    // A script the browser actually refused is a warning; a report-only observation is not.
    { level: 'warn', kind: 'first', directive: 'script-src-elem', blocked: 'www.googletagmanager.com', path: '/media/abc', pathGroup: '/media/*', disposition: 'enforce' },
    { level: 'info', kind: 'first', directive: 'script-src', blocked: 'eval', path: '/media/abc', pathGroup: '/media/*', disposition: 'report' },
  ])
})

test('a report from a page on another site is logged as foreign:<host>, never as a portal path (W4)', async () => {
  await send(CSP_REPORT_PATH, browserHeaders('198.51.100.17', LEGACY), legacyReport({ 'document-uri': 'https://evil.example/news/fake-portal-page?x=1' }))
  await send(CSP_REPORT_PATH, browserHeaders('198.51.100.17', LEGACY), legacyReport({ 'document-uri': 'https://www.portal.example.vn.attacker.example/news/a' }))
  // The portal's own hosts: PUBLIC_BASE_URL, and the request host behind the trusted proxy.
  await send(CSP_REPORT_PATH, browserHeaders('198.51.100.17', LEGACY), legacyReport({ 'document-uri': 'https://PORTAL.example.vn/news/that/bai' }))
  assert.deepEqual(violations().map(line => [line.path, line.pathGroup]), [
    ['foreign:evil.example', 'foreign:evil.example'],
    ['foreign:www.portal.example.vn.attacker.example', 'foreign:www.portal.example.vn.attacker.example'],
    ['/news/that/bai', '/news/*'],
  ])
  assert.ok(!JSON.stringify(violations()).includes('fake-portal-page'))
})

test('a blocked data:/blob: URL is logged as its scheme only — its payload never', async () => {
  await send(CSP_REPORT_PATH, browserHeaders('198.51.100.14', LEGACY), legacyReport({ 'blocked-uri': 'data:text/javascript,alert(document.cookie)' }))
  await send(CSP_REPORT_PATH, browserHeaders('198.51.100.14', LEGACY), legacyReport({ 'blocked-uri': 'blob:https://portal.example.vn/0b5d-uuid' }))
  assert.deepEqual(violations().map(line => line.blocked), ['data', 'blob'])
})

test('every field is bounded: an oversized path or host is truncated, an unknown disposition dropped', async () => {
  const longPath = `/news/${'a'.repeat(1000)}`
  await send(CSP_REPORT_PATH, browserHeaders('198.51.100.15', LEGACY), legacyReport({
    'document-uri': `https://portal.example.vn${longPath}?q=1`,
    'blocked-uri': `https://${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.example.com/x.js`,
    disposition: 'something-else',
  }))
  const [line] = violations()
  assert.ok(line, 'the report was not logged')
  assert.ok(String(line.path).length <= 200, `path not truncated: ${String(line.path).length}`)
  assert.ok(String(line.path).startsWith('/news/aaa'))
  assert.ok(String(line.blocked).length <= 128, `blocked not truncated: ${String(line.blocked).length}`)
  assert.equal('disposition' in line, false)
})

test('the response is a bare 204: no body, no cookie, and the database is never written', async () => {
  const res = await send(CSP_REPORT_PATH, browserHeaders('198.51.100.16', LEGACY), legacyReport())
  assert.equal(res.status, 204)
  assert.equal(res.body, '')
  assert.equal(res.headers['set-cookie'], undefined)
})

// ─── Always 204: malformed, wrong type, oversized ─────────────────────────────

test('a malformed body is answered 204 and logs nothing', async () => {
  const bodies: Array<[string, string]> = [
    [LEGACY, 'not json at all'],
    [LEGACY, '{"csp-report": {"document-uri": "https://portal.example.vn/"'],
    [LEGACY, ''],
    [LEGACY, 'null'],
    [LEGACY, '[]'],
    [LEGACY, '{}'],
    [LEGACY, '{"csp-report": "a string"}'],
    [LEGACY, '{"csp-report": {}}'],
    [LEGACY, '{"csp-report": {"effective-directive": "not a directive name!", "blocked-uri": "inline"}}'],
    [LEGACY, '{"csp-report": {"effective-directive": 42}}'],
    [REPORTING, '{"type": "csp-violation", "body": {"effectiveDirective": "script-src"}}'],
    [REPORTING, '[{"type": "csp-violation", "body": "nope"}]'],
    [REPORTING, '[1, 2, 3]'],
  ]
  for (const [contentType, body] of bodies) {
    const res = await send(CSP_REPORT_PATH, browserHeaders('198.51.100.20', contentType), body)
    assert.equal(res.status, 204, `${contentType} ${body}`)
  }
  assert.deepEqual(violations(), [])
  assert.deepEqual(lines.filter(line => line.level === 'error'), [], 'a malformed report is not an error')
})

test('a wrong or missing Content-Type is answered 204 and the body is not parsed', async () => {
  for (const contentType of ['application/json', 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', '']) {
    const headers = browserHeaders('198.51.100.21', contentType)
    if (!contentType) delete headers['content-type']
    const res = await send(CSP_REPORT_PATH, headers, legacyReport())
    assert.equal(res.status, 204, `content-type "${contentType}"`)
  }
  assert.deepEqual(violations(), [])
})

test('an oversized body is answered 204 and logs nothing — declared or streamed', async () => {
  const padding = 'x'.repeat(CSP_REPORT_MAX_BODY_BYTES)
  const big = legacyReport({ 'script-sample': padding })
  assert.ok(Buffer.byteLength(big) > CSP_REPORT_MAX_BODY_BYTES)
  const declared = await send(CSP_REPORT_PATH, { ...browserHeaders('198.51.100.22', LEGACY), 'content-length': String(Buffer.byteLength(big)) }, big)
  assert.equal(declared.status, 204)
  // No Content-Length: the cap is on the bytes actually read, not on a header.
  const half = Math.ceil(big.length / 2)
  const streamed = await new Promise<number>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: 'POST', path: CSP_REPORT_PATH, headers: { ...browserHeaders('198.51.100.22', LEGACY), 'transfer-encoding': 'chunked' } }, (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode ?? 0))
    })
    req.on('error', reject)
    req.write(big.slice(0, half))
    req.write(big.slice(half))
    req.end()
  })
  assert.equal(streamed, 204)
  assert.deepEqual(violations(), [])
  // Just under the cap is still read and logged.
  const fits = legacyReport({ 'script-sample': 'y'.repeat(CSP_REPORT_MAX_BODY_BYTES - 2048) })
  assert.ok(Buffer.byteLength(fits) <= CSP_REPORT_MAX_BODY_BYTES)
  assert.equal((await send(CSP_REPORT_PATH, browserHeaders('198.51.100.23', LEGACY), fits)).status, 204)
  assert.equal(violations().length, 1)
})

test('at most CSP_REPORT_MAX_PER_REQUEST reports of one request are read', async () => {
  const many = Array.from({ length: CSP_REPORT_MAX_PER_REQUEST + 15 }, (_, index) => reportingEntry({ blockedURL: `https://host${index}.example/x.js` }))
  assert.equal((await send(CSP_REPORT_PATH, browserHeaders('198.51.100.24', REPORTING), JSON.stringify(many))).status, 204)
  assert.equal(violations().length, CSP_REPORT_MAX_PER_REQUEST)
  assert.deepEqual(violations().map(line => line.blocked), many.slice(0, CSP_REPORT_MAX_PER_REQUEST).map((_, index) => `host${index}.example`))
})

// ─── The flood (spec scenario "Report flood") ─────────────────────────────────

test('the stated limits: 20 new keys per network per hour, 60 per /64 per minute as the shared backstop, 1-hour summary window, 500 keys', () => {
  assert.equal(CSP_REPORT_NEW_KEYS_PER_NETWORK, 20)
  assert.equal(CSP_REPORTS_LOGGED_PER_WINDOW, 60)
  assert.equal(CSP_REPORT_WINDOW_SECONDS, 60)
  assert.equal(CSP_REPORT_MAX_PER_REQUEST, 20)
  assert.equal(CSP_REPORT_MAX_BODY_BYTES, 64 * 1024)
  assert.equal(CSP_REPORT_SUMMARY_WINDOW_SECONDS, 3600)
  assert.equal(CSP_REPORT_MAX_KEYS, 500)
})

test('spec: one IP sends 1 000 distinct reports → at most its network’s new-key budget (20) is logged, and every response is 204', async () => {
  const statuses = new Map<number, number>()
  for (let index = 0; index < 1000; index += 1) {
    const res = await send(CSP_REPORT_PATH, browserHeaders('203.0.113.50', LEGACY), legacyReport({ 'blocked-uri': `https://h${index}.example/x.js` }))
    statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1)
  }
  assert.deepEqual([...statuses], [[204, 1000]], 'every response must be 204')
  assert.equal(violations().length, 20, 'exactly the first 20 new keys are logged, none after')
  assert.deepEqual(violations().map(line => line.blocked), Array.from({ length: 20 }, (_, index) => `h${index}.example`))

  // The budget is per network: another network is still heard.
  lines.length = 0
  await send(CSP_REPORT_PATH, browserHeaders('198.51.99.1', LEGACY), legacyReport({ 'blocked-uri': 'https://other-network.example/x.js' }))
  assert.equal(violations().length, 1)
  cspViolationLog.flush()
  assert.equal(lines.find(line => line.event === 'csp_report.dropped')?.budget, 980, 'every report over budget is counted')
})

test('the budget counts reports, not requests: 15 single new keys then a batch of 20 → exactly 5 of the batch are logged', async () => {
  for (let index = 0; index < 15; index += 1) {
    await send(CSP_REPORT_PATH, browserHeaders('203.0.114.60', LEGACY), legacyReport({ 'blocked-uri': `https://single${index}.example/x.js` }))
  }
  assert.equal(violations().length, 15)
  const batch = JSON.stringify(Array.from({ length: 20 }, (_, index) => reportingEntry({ blockedURL: `https://batch${index}.example/x.js` })))
  assert.equal((await send(CSP_REPORT_PATH, browserHeaders('203.0.114.60', REPORTING), batch)).status, 204)
  assert.equal(violations().length, 20)
  assert.deepEqual(violations().slice(15).map(line => line.blocked), ['batch0.example', 'batch1.example', 'batch2.example', 'batch3.example', 'batch4.example'])
})

test('the shared per-/64 counter is the backstop across restarts: a source already at 55 gets exactly 5 of a batch of 20 logged', async () => {
  const { pool, rows } = countingPool()
  fakePool = pool
  rows.set('csp-report:203.0.115.61', 55) // counted before this process started
  const batch = JSON.stringify(Array.from({ length: 20 }, (_, index) => reportingEntry({ blockedURL: `https://backstop${index}.example/x.js` })))
  assert.equal((await send(CSP_REPORT_PATH, browserHeaders('203.0.115.61', REPORTING), batch)).status, 204)
  assert.deepEqual(violations().map(line => line.blocked), ['backstop0.example', 'backstop1.example', 'backstop2.example', 'backstop3.example', 'backstop4.example'])
})

test('W6: one network cannot multiply its budget — 30 /64s inside one IPv6 /48 share 20 new keys', async () => {
  for (let index = 0; index < 30; index += 1) {
    await send(CSP_REPORT_PATH, browserHeaders(`2001:db8:5:${(index + 1).toString(16)}::1`, LEGACY), legacyReport({ 'blocked-uri': `https://v48-${index}.example/x.js` }))
  }
  assert.equal(violations().length, 20)
  lines.length = 0
  await send(CSP_REPORT_PATH, browserHeaders('2001:db8:6::1', LEGACY), legacyReport({ 'blocked-uri': 'https://v48-other.example/x.js' }))
  assert.equal(violations().length, 1, 'another /48 is another network')
})

test('W6: 9 sources × 60 junk keys cannot blind the window — a new violation from a fresh source is still logged', async () => {
  for (let source = 0; source < 9; source += 1) {
    for (let key = 0; key < 60; key += 1) {
      await send(CSP_REPORT_PATH, browserHeaders(`10.${source}.0.1`, LEGACY), legacyReport({ 'blocked-uri': `https://junk-${source}-${key}.example/x.js` }))
    }
  }
  lines.length = 0
  await send(CSP_REPORT_PATH, browserHeaders('10.200.0.1', LEGACY), legacyReport({ 'blocked-uri': 'https://fresh-violation.example/x.js' }))
  const fresh = violations().find(line => line.blocked === 'fresh-violation.example')
  assert.ok(fresh, 'the new violation was only counted, its identity lost')
  assert.equal(fresh.kind, 'first')
})

test('W6: junk keys minted in an earlier window cannot refill the map and hide a new violation', async () => {
  const sendJunk = async () => {
    for (let network = 0; network < 25; network += 1) {
      for (let key = 0; key < 20; key += 1) {
        await send(CSP_REPORT_PATH, browserHeaders(`10.${50 + network}.0.1`, LEGACY), legacyReport({ 'blocked-uri': `https://refill-${network}-${key}.example/x.js` }))
      }
    }
  }
  await sendJunk()
  cspViolationLog.flush() // the hour is over
  await sendJunk() // the same 500 keys, now all known, in a new window
  lines.length = 0
  await send(CSP_REPORT_PATH, browserHeaders('10.250.0.1', LEGACY), legacyReport({ 'blocked-uri': 'https://fresh-after-refill.example/x.js' }))
  const fresh = violations().find(line => line.blocked === 'fresh-after-refill.example')
  assert.ok(fresh, 'known junk filled every slot and the new violation was only counted')
  assert.equal(fresh.kind, 'first')
  assert.equal(fresh.pathGroup, '/news/*', 'the slots kept for never-seen keys give it its full identity, not just a coarse one')
})

test('W7: a known key across 3 windows → exactly one first line in total, then one repeats line per window', async () => {
  const report = legacyReport({ 'blocked-uri': 'inline', 'script-sample': 'three-windows' })
  const perWindow = [3, 4, 4]
  for (const reports of perWindow) {
    for (let index = 0; index < reports; index += 1) await send(CSP_REPORT_PATH, browserHeaders(`198.20.0.${index + 1}`, LEGACY), report)
    cspViolationLog.flush()
  }
  const lines3 = violations()
  assert.deepEqual(lines3.map(line => [line.kind, line.count]), [['first', 1], ['repeats', 2], ['repeats', 4], ['repeats', 4]])
  assert.equal(lines3.reduce((sum, line) => sum + Number(line.count), 0), 11, 'every report is accounted for')
})

test('W6: a page that is not an app section collapses into one group — 404s and page-builder slugs do not mint keys', async () => {
  const pages: Array<[string, string]> = [
    ['/gioi-thieu-chung', '/:page'],
    ['/trang-go-sai-404', '/:page'],
    ['/mot-trang/123', '/:page/*'],
    ['/search', '/search'],
    ['/about', '/about'],
    ['/news/tin-a/bai-b', '/news/*'],
  ]
  for (const [index, [path]] of pages.entries()) {
    await send(CSP_REPORT_PATH, browserHeaders('198.21.0.1', LEGACY), legacyReport({ 'document-uri': `https://portal.example.vn${path}`, 'blocked-uri': `https://page${index}.example/x.js` }))
  }
  assert.deepEqual(violations().map(line => line.pathGroup), pages.map(([, group]) => group))
  assert.deepEqual(violations().map(line => line.path), pages.map(([path]) => path), 'the first line still names the real page')
})

/** A fake pool that records every statement and keeps the shared counters. */
function countingPool(rows = new Map<string, number>()) {
  const statements: Array<{ sql: string, params: unknown[] }> = []
  const pool = {
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
  return { pool, statements, rows }
}

test('W1: 1 000 identical reports from 100 IPs → one first-sighting line, no database work for the repeats, one summary of 999 after the window', async () => {
  const { pool, statements } = countingPool()
  fakePool = pool
  const report = legacyReport({ 'blocked-uri': 'inline', 'script-sample': 'window.__NUXT__={};window.__NUXT__.con' })
  for (let index = 0; index < 1000; index += 1) {
    const res = await send(CSP_REPORT_PATH, browserHeaders(`198.18.${Math.floor(index / 10)}.${(index % 10) + 1}`, LEGACY), report)
    assert.equal(res.status, 204)
  }
  assert.equal(violations().length, 1, 'repeats are counted, not logged')
  assert.equal(violations()[0]!.kind, 'first')
  assert.equal(statements.filter(statement => /INSERT/.test(statement.sql)).length, 1, 'only the first sighting reaches the limiter')
  assert.equal(statements.length, 2, 'the repeats cost no database call at all')

  cspViolationLog.flush() // the window timer, an hour later
  const summary = violations()[1]!
  assert.equal(summary.kind, 'repeats')
  assert.equal(summary.count, 999)
  assert.equal(summary.sources, 50, 'distinct sources, capped at 50 ("50" reads as 50 or more)')
  assert.equal(summary.blocked, 'inline')
  assert.equal(summary.pathGroup, '/news/*')
  assert.equal(violations().reduce((sum, line) => sum + Number(line.count), 0), 1000, 'every report is accounted for')
})

test('W1: a new key in the middle of a flood is logged at once', async () => {
  const flood = legacyReport({ 'blocked-uri': 'inline' })
  for (let index = 0; index < 300; index += 1) await send(CSP_REPORT_PATH, browserHeaders(`198.19.${Math.floor(index / 10)}.${(index % 10) + 1}`, LEGACY), flood)
  assert.equal(violations().length, 1)
  await send(CSP_REPORT_PATH, browserHeaders('198.19.200.1', LEGACY), legacyReport({ 'blocked-uri': 'https://new-tracker.example/t.js' }))
  assert.equal(violations().length, 2, 'the new violation did not wait for the window')
  assert.equal(violations()[1]!.blocked, 'new-tracker.example')
})

test('the counter lives in the shared rate_limit_counters table under its own key prefix', async () => {
  const { pool, statements, rows } = countingPool()
  fakePool = pool
  await send(CSP_REPORT_PATH, browserHeaders('192.0.2.77', LEGACY), legacyReport())
  assert.equal(violations().length, 1)
  const insert = statements.find(statement => /INSERT INTO rate_limit_counters/.test(statement.sql))
  assert.ok(insert, 'the report was not counted in the shared table')
  assert.equal(insert.params[0], 'csp-report:192.0.2.77')
  assert.ok(statements.every(statement => /rate_limit_counters/.test(statement.sql)), 'nothing but the counter is written')

  // Over the shared limit: the next new key is refused (one hit that says so), and the
  // process remembers it — later new keys from that source cost no database call.
  rows.set('csp-report:192.0.2.77', CSP_REPORTS_LOGGED_PER_WINDOW + 1)
  lines.length = 0
  statements.length = 0
  assert.equal((await send(CSP_REPORT_PATH, browserHeaders('192.0.2.77', LEGACY), legacyReport({ 'blocked-uri': 'https://k1.example/x.js' }))).status, 204)
  assert.deepEqual(violations(), [])
  const afterRefusal = statements.length
  assert.ok(afterRefusal > 0, 'the refusal came from the shared counter')
  assert.equal((await send(CSP_REPORT_PATH, browserHeaders('192.0.2.77', LEGACY), legacyReport({ 'blocked-uri': 'https://k2.example/x.js' }))).status, 204)
  assert.equal(statements.length, afterRefusal, 'a source known to be over the limit costs no further database call')
  // A repeat of a key already seen is still counted, for free.
  await send(CSP_REPORT_PATH, browserHeaders('192.0.2.77', LEGACY), legacyReport())
  assert.equal(statements.length, afterRefusal)
  cspViolationLog.flush()
  const dropped = lines.find(line => line.event === 'csp_report.dropped')
  assert.equal(dropped?.limited, 2, 'refused first sightings are counted in the window summary')
  assert.equal(violations().find(line => line.kind === 'repeats')?.count, 1)
})

test('W5: an unexpected failure inside the handler is logged, still answered 204, and the unprocessed reports are counted as failed', async () => {
  poolThrows = true
  const batch = JSON.stringify(Array.from({ length: 3 }, (_, index) => reportingEntry({ blockedURL: `https://w5-${index}.example/x.js` })))
  const res = await send(CSP_REPORT_PATH, browserHeaders('198.51.100.31', REPORTING), batch)
  assert.equal(res.status, 204)
  assert.equal(res.body, '')
  assert.ok(lines.some(line => line.event === 'csp_report.failed'), 'the failure is not silent')
  assert.deepEqual(violations(), [])
  poolThrows = false
  cspViolationLog.flush()
  assert.equal(lines.find(line => line.event === 'csp_report.dropped')?.failed, 3, 'the totals stay honest: the report in flight and the rest of the batch')
})

// ─── Never an ops alert ───────────────────────────────────────────────────────

test('security.csp_violation is a named security event that never pages the operator', async () => {
  assert.equal(SECURITY_EVENTS.cspViolation, 'security.csp_violation')
  assert.ok(!ALERT_EVENTS.includes(SECURITY_EVENTS.cspViolation), 'a report flood would become an e-mail flood')
  dispatchedAlerts.length = 0
  await send(CSP_REPORT_PATH, browserHeaders('198.51.100.30', LEGACY), legacyReport({ disposition: 'enforce' }))
  await settleOpsAlerts()
  assert.equal(violations().length, 1)
  assert.deepEqual(dispatchedAlerts, [])
})

// ─── The origin gate lets reports through on this exact path only ─────────────

test('a cross-site, Origin: null or foreign-Origin report still reaches the endpoint (browsers differ)', async () => {
  const variants: Array<Record<string, string>> = [
    { 'sec-fetch-site': 'cross-site', origin: 'null' },
    { 'sec-fetch-site': 'same-site', origin: 'https://other.delify.vn' },
    { origin: 'null' },
    { origin: 'https://mirror.example.org' },
    {},
  ]
  for (const [index, extra] of variants.entries()) {
    const res = await send(CSP_REPORT_PATH, browserHeaders('198.51.100.40', LEGACY, extra), legacyReport({ 'blocked-uri': `https://variant${index}.example/x.js` }))
    assert.equal(res.status, 204, JSON.stringify(extra))
  }
  assert.equal(violations().length, variants.length)
  assert.equal(lines.filter(line => line.event === 'security.cross_site_refused').length, 0)
})

test('the exemption also covers spellings the router decodes to the same path (same rule as admin-auth)', async () => {
  for (const [index, path] of [`${CSP_REPORT_PATH}?from=browser`, '/api/csp%2Dreport', '/api/%63sp-report'].entries()) {
    const res = await send(path, browserHeaders('198.51.100.41', LEGACY, { 'sec-fetch-site': 'cross-site', origin: 'null' }), legacyReport({ 'blocked-uri': `https://spelling${index}.example/x.js` }))
    assert.equal(res.status, 204, path)
  }
  assert.equal(violations().length, 3)
})

const NOT_EXEMPT = [
  '/api/csp-report/',
  '/api/csp-report#x',
  '/api/csp-report%23x',
  '//api/csp-report',
  '/API/csp-report',
  '/api/csp-reportx',
  '/api/csp-report/../admin/users',
  '/api/csp-report/%2e%2e/admin/users',
  '/api/submissions/../csp-report',
  '/api/public/comments/%2e%2e/%2e%2e/csp-report',
  '/api%2Fcsp-report',
  '/api/csp-report%2F..%2F..%2Fapi%2Fadmin%2Fusers',
  '/api/admin/users?/api/csp-report',
  '/api/admin/users#/api/csp-report',
  '/api/admin/users',
  '/api/submissions',
]

for (const path of NOT_EXEMPT) {
  test(`origin gate: a cross-site POST to ${path} is still refused and no handler runs`, async () => {
    const res = await send(path, browserHeaders('198.51.100.42', LEGACY, { 'sec-fetch-site': 'cross-site', origin: 'null' }), legacyReport())
    assert.equal(res.status, 403, `${path} slipped through the gate (status ${res.status})`)
    assert.equal(totalSentinelHits(), 0, `a handler ran for ${path}: ${JSON.stringify([...hits])}`)
    assert.deepEqual(violations(), [], `the CSP handler ran for ${path}`)
  })
}

// W2: browsers only ever POST a report. Any other state-changing method on the exact path
// is gated like everywhere else — the catch-all sentinel would run if the gate let it by.
for (const method of ['PUT', 'PATCH', 'DELETE']) {
  test(`origin gate: a cross-site ${method} to /api/csp-report is refused — the exemption is for POST only`, async () => {
    const body = legacyReport()
    // Explicit length: Node's client does not chunk-encode a DELETE body on its own.
    const headers = browserHeaders('198.51.100.43', LEGACY, { 'sec-fetch-site': 'cross-site', origin: 'null', 'content-length': String(Buffer.byteLength(body)) })
    const res = await send(CSP_REPORT_PATH, headers, body, method)
    assert.equal(res.status, 403, `${method} slipped through the gate (status ${res.status})`)
    assert.equal(totalSentinelHits(), 0, `a handler ran for ${method}: ${JSON.stringify([...hits])}`)
  })
}

test('the exemption predicate: POST only, every decoded form must be exactly the report path, and no form may carry #', () => {
  assert.equal(isOriginGateExempt('POST', '/api/csp-report', '/api/csp-report'), true)
  assert.equal(isOriginGateExempt('post', '/api/csp-report', '/api/csp-report'), true)
  assert.equal(isOriginGateExempt('POST', '/api/csp-report?x=1', '/api/csp-report?x=1'), true)
  assert.equal(isOriginGateExempt('POST', '/api/csp-report', '/api/csp%2Dreport'), true)
  for (const method of ['PUT', 'PATCH', 'DELETE', 'GET', '']) {
    assert.equal(isOriginGateExempt(method, '/api/csp-report', '/api/csp-report'), false, method)
  }
  // The routed form and the raw request-target disagree → not exempt (fail closed).
  assert.equal(isOriginGateExempt('POST', '/api/submissions', '/api/csp-report'), false)
  assert.equal(isOriginGateExempt('POST', '/api/csp-report', '/api/submissions'), false)
  assert.equal(isOriginGateExempt('POST', '/api/submissions/../csp-report', '/api/submissions/../csp-report'), false)
  assert.equal(isOriginGateExempt('POST', '/api/csp-report#x', '/api/csp-report#x'), false)
  assert.equal(isOriginGateExempt('POST', '/api/csp-report', '/api/csp-report%23'), false)
  assert.equal(isOriginGateExempt('POST', '/api/csp-report%zz', '/api/csp-report%zz'), false)
  assert.equal(isOriginGateExempt('POST', '/api/csp-report/', '/api/csp-report/'), false)
  assert.equal(isOriginGateExempt('POST', '', ''), false)
})
