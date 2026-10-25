import assert from 'node:assert/strict'
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
 * Hợp đồng: luôn 204 (kể cả thân hỏng, sai Content-Type, quá cỡ, bị giới hạn); chỉ
 * một dòng log `security.csp_violation` mỗi báo cáo hợp lệ, mang directive + host
 * (hoặc nhãn `inline`/`eval`) + đường dẫn trang không query + disposition; không
 * lưu gì vào CSDL; không bao giờ gửi thư cảnh báo vận hành.
 */

process.env.PUBLIC_BASE_URL = 'https://portal.example.vn'
// Đặt địa chỉ nhận cảnh báo để chứng minh `security.csp_violation` không bao giờ được gửi
// đi: một sự kiện trong ALERT_EVENTS sẽ tới `opsAlerts.dispatch` giả bên dưới.
process.env.OPS_ALERT_EMAIL = 'ops@example.vn'

/** null = CSDL mất (kho lùi về bộ nhớ); một object = pool giả ghi lại SQL. */
let fakePool: { query: (sql: string, params: unknown[]) => Promise<unknown> } | null = null
mock.module('../server/utils/db', {
  namedExports: {
    getDb: () => { throw new Error('the CSP report endpoint must not touch the database') },
    getPool: () => fakePool,
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
const { isOriginGateExemptPath } = await import('../server/utils/origin-gate')
const { ALERT_EVENTS, SECURITY_EVENTS, settleOpsAlerts } = await import('../server/utils/logger')
const { CSP_REPORT_PATH } = await import('../shared/csp-policy')
const {
  CSP_REPORT_MAX_BODY_BYTES,
  CSP_REPORT_MAX_PER_REQUEST,
  CSP_REPORTS_LOGGED_PER_WINDOW,
  CSP_REPORT_WINDOW_SECONDS,
} = await import('../server/utils/csp-report')

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
  lines.length = 0
  hits.clear()
  fakePool = null
  console.log = capture(realLog)
  console.error = capture(realError)
})
after(() => {
  console.log = realLog
  console.error = realError
})

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

test('legacy application/csp-report: 204 and ONE line with directive, blocked host, page path and disposition only', async () => {
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
    directive: 'script-src-elem',
    blocked: 'evil.example.com:8443',
    path: '/news/tin-tuc/bai-viet',
    disposition: 'report',
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
  const logged = violations().map(({ level, time: _time, ...fields }) => ({ level, ...fields }))
  assert.deepEqual(logged, [
    { level: 'info', event: 'security.csp_violation', directive: 'script-src-elem', blocked: 'inline', path: '/media/abc', disposition: 'report' },
    // A script the browser actually refused is a warning; a report-only observation is not.
    { level: 'warn', event: 'security.csp_violation', directive: 'script-src-elem', blocked: 'www.googletagmanager.com', path: '/media/abc', disposition: 'enforce' },
    { level: 'info', event: 'security.csp_violation', directive: 'script-src', blocked: 'eval', path: '/media/abc', disposition: 'report' },
  ])
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

test('the stated limit: 60 logged reports per IP per 60-second window', () => {
  assert.equal(CSP_REPORTS_LOGGED_PER_WINDOW, 60)
  assert.equal(CSP_REPORT_WINDOW_SECONDS, 60)
  assert.equal(CSP_REPORT_MAX_PER_REQUEST, 20)
  assert.equal(CSP_REPORT_MAX_BODY_BYTES, 64 * 1024)
})

test('spec: one IP sends 1 000 reports in a minute → at most the limit is logged and every response is 204', async () => {
  const statuses = new Map<number, number>()
  for (let index = 0; index < 1000; index += 1) {
    const res = await send(CSP_REPORT_PATH, browserHeaders('203.0.113.50', LEGACY), legacyReport({ 'blocked-uri': `https://h${index}.example/x.js` }))
    statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1)
  }
  assert.deepEqual([...statuses], [[204, 1000]], 'every response must be 204')
  assert.equal(violations().length, CSP_REPORTS_LOGGED_PER_WINDOW, 'exactly the first <limit> reports are logged, none after')
  assert.deepEqual(violations().map(line => line.blocked), Array.from({ length: CSP_REPORTS_LOGGED_PER_WINDOW }, (_, index) => `h${index}.example`))

  // The limit is per source: another IP is still heard.
  lines.length = 0
  await send(CSP_REPORT_PATH, browserHeaders('203.0.113.51', LEGACY), legacyReport())
  assert.equal(violations().length, 1)
})

test('the limit counts reports, not requests: 1 000 reports batched 20 per request still log at most the limit', async () => {
  const batch = JSON.stringify(Array.from({ length: 20 }, () => reportingEntry({ blockedURL: 'inline' })))
  for (let index = 0; index < 50; index += 1) {
    const res = await send(CSP_REPORT_PATH, browserHeaders('203.0.113.60', REPORTING), batch)
    assert.equal(res.status, 204)
  }
  assert.equal(violations().length, CSP_REPORTS_LOGGED_PER_WINDOW)
})

test('an IPv6 flooder cannot rotate addresses inside its /64 to get a fresh budget', async () => {
  for (let index = 0; index < CSP_REPORTS_LOGGED_PER_WINDOW + 10; index += 1) {
    await send(CSP_REPORT_PATH, browserHeaders(`2001:db8:1:2::${(index + 1).toString(16)}`, LEGACY), legacyReport())
  }
  assert.equal(violations().length, CSP_REPORTS_LOGGED_PER_WINDOW)
  lines.length = 0
  await send(CSP_REPORT_PATH, browserHeaders('2001:db8:1:3::1', LEGACY), legacyReport())
  assert.equal(violations().length, 1, 'another /64 is another source')
})

test('the counter lives in the shared rate_limit_counters table under its own key prefix', async () => {
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
  await send(CSP_REPORT_PATH, browserHeaders('192.0.2.77', LEGACY), legacyReport())
  assert.equal(violations().length, 1)
  const insert = statements.find(statement => /INSERT INTO rate_limit_counters/.test(statement.sql))
  assert.ok(insert, 'the report was not counted in the shared table')
  assert.equal(insert.params[0], 'csp-report:192.0.2.77')
  assert.ok(statements.every(statement => /rate_limit_counters/.test(statement.sql)), 'nothing but the counter is written')

  // Once the shared counter is over the limit, the body is not even read.
  rows.set('csp-report:192.0.2.77', CSP_REPORTS_LOGGED_PER_WINDOW + 1)
  lines.length = 0
  statements.length = 0
  assert.equal((await send(CSP_REPORT_PATH, browserHeaders('192.0.2.77', LEGACY), legacyReport())).status, 204)
  assert.deepEqual(violations(), [])
  assert.equal(statements.filter(statement => /INSERT/.test(statement.sql)).length, 0, 'a source over the limit costs one read, no write')
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
  for (const extra of variants) {
    const res = await send(CSP_REPORT_PATH, browserHeaders('198.51.100.40', LEGACY, extra), legacyReport())
    assert.equal(res.status, 204, JSON.stringify(extra))
  }
  assert.equal(violations().length, variants.length)
  assert.equal(lines.filter(line => line.event === 'security.cross_site_refused').length, 0)
})

test('the exemption also covers spellings the router decodes to the same path (same rule as admin-auth)', async () => {
  for (const path of [`${CSP_REPORT_PATH}?from=browser`, '/api/csp%2Dreport', '/api/%63sp-report']) {
    const res = await send(path, browserHeaders('198.51.100.41', LEGACY, { 'sec-fetch-site': 'cross-site', origin: 'null' }), legacyReport())
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

test('the exemption predicate: every decoded form must be exactly the report path, and no form may carry #', () => {
  assert.equal(isOriginGateExemptPath('/api/csp-report', '/api/csp-report'), true)
  assert.equal(isOriginGateExemptPath('/api/csp-report?x=1', '/api/csp-report?x=1'), true)
  assert.equal(isOriginGateExemptPath('/api/csp-report', '/api/csp%2Dreport'), true)
  // The routed form and the raw request-target disagree → not exempt (fail closed).
  assert.equal(isOriginGateExemptPath('/api/submissions', '/api/csp-report'), false)
  assert.equal(isOriginGateExemptPath('/api/csp-report', '/api/submissions'), false)
  assert.equal(isOriginGateExemptPath('/api/submissions/../csp-report', '/api/submissions/../csp-report'), false)
  assert.equal(isOriginGateExemptPath('/api/csp-report#x', '/api/csp-report#x'), false)
  assert.equal(isOriginGateExemptPath('/api/csp-report', '/api/csp-report%23'), false)
  assert.equal(isOriginGateExemptPath('/api/csp-report%zz', '/api/csp-report%zz'), false)
  assert.equal(isOriginGateExemptPath('/api/csp-report/', '/api/csp-report/'), false)
  assert.equal(isOriginGateExemptPath('', ''), false)
})
