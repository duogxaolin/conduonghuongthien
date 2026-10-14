/**
 * Phản hồi lỗi máy chủ (≥ 500) phải mang `Cache-Control: no-store`, kể cả ở tuyến
 * `swr` nơi bộ bọc đệm của Nitro ghi đè `cache-control` bằng `s-maxage=60,
 * stale-while-revalidate` (đo trên bản build không có CSDL: `/`, `/about`, `/contact`,
 * `/media` trả 503 + s-maxage). Hai lớp kiểm:
 *  1. hàm quyết định thuần `errorResponseCacheControl(status, path)`;
 *  2. plugin THẬT (`server/plugins/error-no-store.ts`) nạp qua `defineNitroPlugin`
 *     giả trên `globalThis` (cùng mẹo với `tests/livestream-plugins.test.ts`), gọi
 *     hook nó đăng ký với một phản hồi giống hệt thứ bộ bọc swr để lại.
 *
 * Lượt dò đầu-cuối (thủ công — CSDL của bộ e2e phải sống nên không tự động hoá được):
 *   NODE_ENV=development npm run build
 *   env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production PORT=3217 HOST=127.0.0.1 \
 *     DB_HOST=127.0.0.1 DB_PORT=1 DB_USER=x DB_PASSWORD=x DB_NAME=cdkt_probe_none \
 *     JWT_SECRET=$(openssl rand -hex 32) CHATBOT_ENCRYPTION_SECRET=$(openssl rand -base64 32) \
 *     ANALYTICS_HMAC_SECRET=$(openssl rand -hex 32) NUXT_ANALYTICS_HMAC_SECRET=$(openssl rand -hex 32) \
 *     RETENTION_SCHEDULER=0 ANALYTICS_SCHEDULER=0 VIEW_BOOST_SCHEDULER=0 BACKUP_SCHEDULER=0 \
 *     node .output/server/index.mjs &  PID=$!
 *   for p in / /about /contact /media /news/tin-tuc; do curl -s -D - -o /dev/null "http://127.0.0.1:3217$p" | grep -iE '^HTTP|^cache-control'; done
 *   kill $PID
 * Kỳ vọng: mọi đường dẫn `503` + `cache-control: no-store` (trước bản vá: `/`, `/about`,
 * `/contact`, `/media` là 503 + `s-maxage=60, stale-while-revalidate`). Mặt khoẻ (200 +
 * `s-maxage=60`) do `tests/e2e/public-ssr-status.spec.ts` canh.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { errorResponseCacheControl } from '../server/utils/error-cache-control.ts'

test('5xx ở trang/API → no-store; < 500 → giữ nguyên', () => {
  for (const status of [500, 502, 503, 504]) {
    for (const path of ['/', '/about', '/contact', '/media', '/news/tin-tuc', '/api/public/social-links']) {
      assert.equal(errorResponseCacheControl(status, path), 'no-store', `${status} ${path}`)
    }
  }
  for (const status of [200, 204, 301, 304, 400, 404, 429, 499]) {
    assert.equal(errorResponseCacheControl(status, '/'), null, String(status))
  }
})

test('query string không lọt vào việc so tiền tố; /_nuxt/ và /_ipx/ được miễn', () => {
  assert.equal(errorResponseCacheControl(503, '/?e2e=1'), 'no-store')
  assert.equal(errorResponseCacheControl(503, '/about?x=/_ipx/'), 'no-store')
  assert.equal(errorResponseCacheControl(500, '/_nuxt/entry.abc.js'), null)
  assert.equal(errorResponseCacheControl(500, '/_ipx/w_640/uploads/a.jpg?x=1'), null)
  // Chỉ đúng tiền tố có gạch chéo — một slug trùng chữ đầu không được miễn.
  assert.equal(errorResponseCacheControl(503, '/_nuxtish'), 'no-store')
  assert.equal(errorResponseCacheControl(503, '/_ipx'), 'no-store')
})

test('mã trạng thái không hợp lệ → không đoán', () => {
  assert.equal(errorResponseCacheControl(Number.NaN, '/'), null)
  assert.equal(errorResponseCacheControl(503.5, '/'), null)
})

// ─── Plugin thật ───────────────────────────────────────────────────────────────
type Hook = (event: FakeEvent, response?: unknown) => unknown
type FakeEvent = { path: string, node: { res: FakeRes } }
type FakeRes = { statusCode: number, headersSent: boolean, headers: Record<string, string>, setHeader: (n: string, v: string) => void, getHeader: (n: string) => string | undefined }

const hooks = new Map<string, Hook[]>()
;(globalThis as { defineNitroPlugin?: (fn: (app: unknown) => void) => void }).defineNitroPlugin = (fn) => {
  fn({ hooks: { hook: (name: string, handler: Hook) => hooks.set(name, [...(hooks.get(name) ?? []), handler]) } })
}
await import('../server/plugins/error-no-store.ts')

/** Phản hồi y như bộ bọc swr để lại: mã của trang + `cache-control` của routeRule. */
function swrResponse(statusCode: number, path: string, headersSent = false): FakeEvent {
  const headers: Record<string, string> = { 'cache-control': 's-maxage=60, stale-while-revalidate' }
  return {
    path,
    node: {
      res: {
        statusCode,
        headersSent,
        headers,
        setHeader: (n, v) => { headers[n.toLowerCase()] = v },
        getHeader: n => headers[n.toLowerCase()],
      },
    },
  }
}

const run = async (event: FakeEvent) => { for (const hook of hooks.get('beforeResponse') ?? []) await hook(event, { body: '<html>' }) }

test('plugin đăng ký ĐÚNG hook beforeResponse (afterResponse là quá muộn — thân đã ghi)', () => {
  assert.equal(hooks.get('beforeResponse')?.length, 1)
  assert.equal(hooks.has('afterResponse'), false)
  assert.equal(hooks.has('render:response'), false, 'render:response chạy trong bộ bọc swr — bị ghi đè sau đó')
})

test('503 ở tuyến swr: s-maxage của bộ bọc bị thay bằng no-store', async () => {
  for (const path of ['/', '/about', '/contact', '/media', '/news/tin-tuc?page=2']) {
    const event = swrResponse(503, path)
    await run(event)
    assert.equal(event.node.res.headers['cache-control'], 'no-store', path)
  }
})

test('200 ở tuyến swr: giữ nguyên s-maxage (bộ đệm vẫn chạy khi CSDL khoẻ)', async () => {
  const event = swrResponse(200, '/')
  await run(event)
  assert.equal(event.node.res.headers['cache-control'], 's-maxage=60, stale-while-revalidate')
})

test('404 giữ nguyên; tài nguyên /_nuxt/ giữ nguyên; tiêu đề đã gửi (stream) thì không chạm', async () => {
  const notFound = swrResponse(404, '/khong-co')
  await run(notFound)
  assert.equal(notFound.node.res.headers['cache-control'], 's-maxage=60, stale-while-revalidate')
  const asset = swrResponse(500, '/_nuxt/x.js')
  await run(asset)
  assert.equal(asset.node.res.headers['cache-control'], 's-maxage=60, stale-while-revalidate')
  const sent = swrResponse(503, '/', true)
  await run(sent)
  assert.equal(sent.node.res.headers['cache-control'], 's-maxage=60, stale-while-revalidate')
})
