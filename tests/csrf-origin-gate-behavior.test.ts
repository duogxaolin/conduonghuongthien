import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import test, { after, before, beforeEach, mock } from 'node:test'

/**
 * Cổng chặn yêu cầu GHI từ trang khác (spec csrf-protection, design D-CSRF).
 *
 * Trước cổng này, thứ duy nhất đứng giữa một trang trên `*.delify.vn` (cùng tên
 * miền đăng ký với cổng thông tin) và mọi endpoint ghi là cookie `SameSite=Lax` —
 * mà "same-site" thì một tên miền con anh em LÀ cùng site: trình duyệt gửi kèm
 * cookie phiên của cán bộ. Một `<form method=post action=…/api/admin/users>` trên
 * trang anh em tạo được tài khoản.
 *
 * Tệp này chạy middleware THẬT (`server/middleware/00.origin-gate.ts`) trong một
 * app h3 + router THẬT trên cổng tạm, gửi header bằng `node:http` thô (fetch của
 * Node tự thêm `sec-fetch-*`/`origin` theo ngữ cảnh — ở đây cần kiểm từng tổ hợp).
 * Mỗi route là một sentinel đếm số lần chạy: điều cần khẳng định là "handler
 * KHÔNG chạy" khi bị chặn, không chỉ mã 403.
 *
 * Lớp tin cậy proxy (`client-ip.ts`) được thay bằng một công tắc để kiểm cả hai
 * phía: peer là proxy đã khai (đọc `X-Forwarded-Host`) và peer lạ (header đó bị bỏ
 * qua). Luật tin cậy thật có test riêng (`google-oauth-forwarded-proto.test.ts`).
 */

process.env.PUBLIC_BASE_URL = 'https://portal.example.vn'
process.env.PUBLIC_HOST_ALLOWLIST = 'www.portal.example.vn'

let peerTrusted = true
mock.module('../server/utils/client-ip', {
  namedExports: {
    isTrustedProxy: () => peerTrusted,
    peerIsTrustedProxy: () => peerTrusted,
    trustedProxies: () => ['127.0.0.1'],
  },
})

const h3 = await import('h3')
const middleware = (await import('../server/middleware/00.origin-gate')).default

/** Each sentinel records that it ran and echoes the body size it could still read. */
const hits = new Map<string, number>()
const sentinel = (name: string) => h3.defineEventHandler(async (event) => {
  hits.set(name, (hits.get(name) ?? 0) + 1)
  const method = event.method
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return { reached: name }
  const contentType = String(h3.getRequestHeader(event, 'content-type') ?? '')
  if (contentType.startsWith('multipart/form-data')) {
    const parts = await h3.readMultipartFormData(event)
    return { reached: name, parts: (parts ?? []).map(part => ({ name: part.name, bytes: part.data.length })) }
  }
  const raw = await h3.readRawBody(event)
  return { reached: name, bytes: raw ? raw.length : 0 }
})

let server: Server
let port = 0

before(async () => {
  // Same wiring Nitro uses: global middleware via `app.use`, then the router.
  const app = h3.createApp()
  app.use('/', middleware)
  const router = h3.createRouter()
  router.use('/api/admin/users', sentinel('admin-users'))
  router.use('/api/admin/settings', sentinel('admin-settings'))
  router.use('/api/admin/media/upload', sentinel('admin-upload'))
  router.use('/api/submissions', sentinel('public-submission'))
  router.use('/api/public/comments', sentinel('public-comment'))
  router.use('/api/analytics/page-view', sentinel('page-view'))
  router.use('/**', sentinel('catch-all'))
  app.use('/', router.handler)
  server = (await import('node:http')).createServer(h3.toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})

after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
})

const logged: Array<Record<string, unknown>> = []
const realConsoleError = console.error
beforeEach(() => {
  hits.clear()
  logged.length = 0
  peerTrusted = true
  console.error = (...args: unknown[]) => {
    const line = String(args[0] ?? '')
    try { logged.push(JSON.parse(line)) } catch { realConsoleError(...args) }
  }
})
after(() => { console.error = realConsoleError })

type Sent = { status: number, body: string }
function send(method: string, path: string, headers: Record<string, string>, body?: Buffer | string): Promise<Sent> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { text += chunk })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }))
    })
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

const totalHits = () => [...hits.values()].reduce((sum, value) => sum + value, 0)
const PORTAL = 'portal.example.vn'
const json = (value: unknown) => JSON.stringify(value)

// ─── The four spec scenarios ──────────────────────────────────────────────────

test('spec: a form post from a sibling subdomain (Sec-Fetch-Site: same-site) is refused and no user is created', async () => {
  const res = await send('POST', '/api/admin/users', {
    host: PORTAL,
    'sec-fetch-site': 'same-site',
    origin: 'https://other.delify.vn',
    cookie: 'cdkt_admin=session-of-the-admin',
    'content-type': 'application/x-www-form-urlencoded',
  }, 'username=attacker&roleId=1')
  assert.equal(res.status, 403)
  assert.equal(totalHits(), 0, 'the handler ran for a cross-site request')
})

test('spec: the admin UI on the production host (Sec-Fetch-Site: same-origin) reaches the handler', async () => {
  const res = await send('PUT', '/api/admin/settings', {
    host: PORTAL,
    'sec-fetch-site': 'same-origin',
    origin: `https://${PORTAL}`,
    'content-type': 'application/json',
  }, json({ settings: { site_name: 'x' } }))
  assert.equal(res.status, 200)
  assert.equal(hits.get('admin-settings'), 1)
})

test('spec: a scripted client with neither Sec-Fetch-Site nor Origin reaches the handler (decision D-CSRF)', async () => {
  const res = await send('POST', '/api/admin/users', { host: PORTAL, 'content-type': 'application/json' }, json({ username: 'cron' }))
  assert.equal(res.status, 200)
  assert.equal(hits.get('admin-users'), 1)
})

test('spec: Origin: null without Sec-Fetch-Site is refused', async () => {
  const res = await send('POST', '/api/admin/users', { host: PORTAL, origin: 'null' }, '')
  assert.equal(res.status, 403)
  assert.equal(totalHits(), 0)
})

// ─── Sec-Fetch-Site decides first ─────────────────────────────────────────────

for (const value of ['cross-site', 'same-site', 'CROSS-SITE', 'something-new']) {
  test(`Sec-Fetch-Site: ${value} is refused even when Origin names the portal`, async () => {
    const res = await send('DELETE', '/api/admin/users', { host: PORTAL, 'sec-fetch-site': value, origin: `https://${PORTAL}` })
    assert.equal(res.status, 403)
    assert.equal(totalHits(), 0)
  })
}

test('Sec-Fetch-Site: none (typed URL, bookmark) is allowed', async () => {
  const res = await send('POST', '/api/submissions', { host: PORTAL, 'sec-fetch-site': 'none' }, '')
  assert.equal(res.status, 200)
  assert.equal(hits.get('public-submission'), 1)
})

test('Sec-Fetch-Site: same-origin wins over a foreign Origin (the browser computed it, not the page)', async () => {
  const res = await send('PATCH', '/api/admin/settings', { host: PORTAL, 'sec-fetch-site': 'same-origin', origin: 'https://other.example' }, '')
  assert.equal(res.status, 200)
})

// ─── Origin, when there is no Sec-Fetch-Site (older browsers) ─────────────────

test('Origin of another host is refused', async () => {
  const res = await send('POST', '/api/public/comments', { host: PORTAL, origin: 'https://other.delify.vn' }, '')
  assert.equal(res.status, 403)
  assert.equal(totalHits(), 0)
})

test('an unparsable Origin is refused', async () => {
  for (const origin of ['not a url', 'https://', '://portal.example.vn']) {
    const res = await send('POST', '/api/public/comments', { host: PORTAL, origin }, '')
    assert.equal(res.status, 403, `origin ${origin} was not refused`)
  }
  assert.equal(totalHits(), 0)
})

test('Origin equal to the request host is allowed (case and default port do not matter)', async () => {
  for (const origin of [`https://${PORTAL}`, 'https://PORTAL.Example.VN', `https://${PORTAL}:443`]) {
    const res = await send('POST', '/api/public/comments', { host: PORTAL, origin }, '')
    assert.equal(res.status, 200, `origin ${origin} was refused`)
  }
})

test('the host of PUBLIC_BASE_URL is allowed even when the proxy forwards an internal Host', async () => {
  const res = await send('POST', '/api/submissions', { host: '127.0.0.1:3000', origin: `https://${PORTAL}` }, '')
  assert.equal(res.status, 200)
})

test('a host listed in PUBLIC_HOST_ALLOWLIST is allowed', async () => {
  const res = await send('POST', '/api/submissions', { host: '127.0.0.1:3000', origin: 'https://www.portal.example.vn' }, '')
  assert.equal(res.status, 200)
})

// ─── Request host comes from the trusted-proxy rules, never a forged header ───

test('the real host behind a trusted proxy (X-Forwarded-Host) is allowed — public form post from the real host', async () => {
  peerTrusted = true
  const res = await send('POST', '/api/submissions', {
    host: '127.0.0.1:3000',
    'x-forwarded-host': 'mirror.example.org',
    origin: 'https://mirror.example.org',
    'content-type': 'application/json',
  }, json({ fullName: 'Nguyễn Văn A', phone: '0900000000' }))
  assert.equal(res.status, 200)
  assert.equal(hits.get('public-submission'), 1)
  assert.match(res.body, /"bytes":\d+/)
})

test('a raw Host from an untrusted peer never joins the allowed set (design D-CSRF)', async () => {
  peerTrusted = false
  // Host and Origin agree, but neither is a configured host and the peer is not a
  // proxy we listed: the request host is not trusted, so the Origin is foreign.
  const res = await send('POST', '/api/submissions', { host: 'raw.example', origin: 'https://raw.example' }, '')
  assert.equal(res.status, 403)
  assert.equal(totalHits(), 0)
  // The configured hosts still are, whoever the peer is.
  assert.equal((await send('POST', '/api/submissions', { host: 'raw.example', origin: `https://${PORTAL}` }, '')).status, 200)
  assert.equal((await send('POST', '/api/submissions', { host: 'raw.example', origin: 'https://www.portal.example.vn' }, '')).status, 200)
})

test('X-Forwarded-Host from an untrusted peer is ignored: a page cannot vouch for its own origin', async () => {
  peerTrusted = false
  const res = await send('POST', '/api/admin/users', {
    host: PORTAL,
    'x-forwarded-host': 'evil.example',
    origin: 'https://evil.example',
  }, '')
  assert.equal(res.status, 403)
  assert.equal(totalHits(), 0)
})

// ─── Public posts and uploads from the portal keep working ────────────────────

test('public form posts from the portal itself still work (comment, chat-style JSON, page-view beacon)', async () => {
  const headers = { host: PORTAL, 'sec-fetch-site': 'same-origin', origin: `https://${PORTAL}`, 'content-type': 'application/json' }
  assert.equal((await send('POST', '/api/public/comments', headers, json({ body: 'Xin chào' }))).status, 200)
  // `navigator.sendBeacon` from the same page: same-origin, text/plain body.
  assert.equal((await send('POST', '/api/analytics/page-view', { ...headers, 'content-type': 'text/plain;charset=UTF-8' }, json({ path: '/' }))).status, 200)
  assert.equal(hits.get('public-comment'), 1)
  assert.equal(hits.get('page-view'), 1)
})

test('a multipart upload from the portal reaches the handler with its body intact', async () => {
  const boundary = '----cdktOriginGate'
  const file = Buffer.alloc(4096, 7)
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`),
    file,
    Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="folder"\r\n\r\nnews\r\n--${boundary}--\r\n`),
  ])
  const res = await send('POST', '/api/admin/media/upload', {
    host: PORTAL,
    'sec-fetch-site': 'same-origin',
    origin: `https://${PORTAL}`,
    'content-type': `multipart/form-data; boundary=${boundary}`,
    'content-length': String(body.length),
  }, body)
  assert.equal(res.status, 200)
  assert.deepEqual(JSON.parse(res.body).parts, [{ name: 'file', bytes: 4096 }, { name: 'folder', bytes: 4 }])
})

test('a cross-site multipart upload is refused before its body is read', async () => {
  const res = await send('POST', '/api/admin/media/upload', {
    host: PORTAL,
    'sec-fetch-site': 'cross-site',
    'content-type': 'multipart/form-data; boundary=x',
  }, '--x--\r\n')
  assert.equal(res.status, 403)
  assert.equal(totalHits(), 0)
})

// ─── Safe methods are never refused ───────────────────────────────────────────

for (const method of ['GET', 'HEAD', 'OPTIONS']) {
  test(`${method} is never refused, even cross-site with a foreign Origin`, async () => {
    const res = await send(method, '/api/admin/users', { host: PORTAL, 'sec-fetch-site': 'cross-site', origin: 'null' })
    assert.notEqual(res.status, 403)
    assert.equal(hits.get('admin-users'), 1)
  })
}

// ─── Every path spelling is covered ───────────────────────────────────────────

test('state-changing requests are gated whatever the path spelling (no classifier to fall out of step with the router)', async () => {
  for (const path of ['/api/%61dmin/users', '//api/admin/users', '/api/admin/users?x=1', '/API/admin/users']) {
    const res = await send('POST', path, { host: PORTAL, 'sec-fetch-site': 'cross-site' }, '')
    assert.equal(res.status, 403, `${path} was not gated`)
  }
  assert.equal(totalHits(), 0)
})

// ─── Logging ──────────────────────────────────────────────────────────────────

test('a refusal logs security.cross_site_refused with the path (no query) and the origin host only', async () => {
  await send('POST', '/api/admin/users?token=abc', {
    host: PORTAL,
    'sec-fetch-site': 'same-site',
    origin: 'https://other.delify.vn/some/page?x=1',
    cookie: 'cdkt_admin=secret-session',
  }, '')
  const entry = logged.find(line => line.event === 'security.cross_site_refused')
  assert.ok(entry, 'no security.cross_site_refused line was written')
  assert.equal(entry.path, '/api/admin/users')
  assert.equal(entry.originHost, 'other.delify.vn')
  const text = JSON.stringify(entry)
  assert.ok(!text.includes('token=abc') && !text.includes('secret-session') && !text.includes('/some/page'), text)
})

test('an allowed request logs nothing', async () => {
  await send('POST', '/api/admin/users', { host: PORTAL, 'sec-fetch-site': 'same-origin' }, '')
  assert.equal(logged.filter(line => line.event === 'security.cross_site_refused').length, 0)
})

// ─── Ordering: the gate runs before admin-auth ────────────────────────────────

test('Nitro registers the gate before admin-auth (scanDir sorts server/middleware by localeCompare)', () => {
  // nitropack/dist/core: `scanDir` → `.sort((a, b) => a.path.localeCompare(b.path))`,
  // and the runtime mounts middleware in that order. A cross-site request must be
  // refused before admin-auth reads the session or the router reads a body.
  const files = readdirSync(new URL('../server/middleware/', import.meta.url)).filter(name => name.endsWith('.ts'))
  const sorted = [...files].sort((a, b) => a.localeCompare(b))
  assert.equal(sorted[0], '00.origin-gate.ts')
  assert.ok(sorted.indexOf('00.origin-gate.ts') < sorted.indexOf('admin-auth.ts'))
})
