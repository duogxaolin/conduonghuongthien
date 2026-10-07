/**
 * Guard cho `server/plugins/ipx-cache-control.ts`.
 *
 * Bối cảnh: routeRules `nuxt.config.ts` `'/_ipx/**'` set
 * `cache-control: public, max-age=31536000, immutable` cho mọi response IPX —
 * Nitro `route-rules.mjs` set header TRƯỚC handler, không phân biệt status code
 * → IPX 500 (R2 fetch tạm lỗi lúc cold-start) inherits `immutable` → Cloudflare
 * cache 500 đúng 1 năm → ảnh vỡ vĩnh viễn trên prod (cdht.delify.vn 2026-10-07).
 *
 * Plugin hook `beforeResponse` (`nitropack/.../app.mjs`) chạy SAU handler,
 * TRƯỚC khi gửi response, cho cả success path (h3 index.mjs:2021) lẫn error
 * path (h3 index.mjs:2332 — `event.handled` vẫn `false` sau `send()` nên hook
 * KHÔNG bị skip). Plugin override `cache-control` → `no-store` khi status >= 400.
 *
 * Test guard cấu trúc — không thể mock Nitro runtime trong Node runner thuần.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const plugin = read('server/plugins/ipx-cache-control.ts')
const nuxtConfig = read('nuxt.config.ts')

describe('plugin ipx-cache-control', () => {
  it('tồn tại và đăng ký hook beforeResponse', () => {
    assert.match(
      plugin,
      /hooks\.hook\(\s*['"]beforeResponse['"]/,
      'plugin phải đăng ký nitroApp.hooks.hook("beforeResponse", …) — đây là hook duy nhất chạy sau handler và cho cả error path',
    )
  })

  it('chỉ áp dụng cho tuyến /_ipx/', () => {
    assert.match(
      plugin,
      /startsWith\(\s*['"]\/_ipx\/['"]\)/,
      'phải early-return cho path không phải /_ipx/ — tránh chạm vào response khác',
    )
  })

  it('override cache-control sang no-store khi status >= 400', () => {
    assert.match(
      plugin,
      /status\s*>=\s*400/,
      'phải check status >= 400 — 200 giữ immutable, 4xx/5xx chuyển no-store',
    )
    assert.match(
      plugin,
      /setResponseHeader\(\s*event,\s*['"]cache-control['"],\s*['"]no-store,\s*max-age=0['"]/,
      'phải setResponseHeader(event, "cache-control", "no-store, max-age=0") — không cache error trên CF/Nginx',
    )
  })

  it('đọc status từ event.node.res.statusCode — không phải từ response hook arg', () => {
    // Hook `beforeResponse` arg chỉ có { body } (không có status) — phải đọc
    // từ event.node.res.statusCode. Nếu ai copy-paste `response.status` sẽ
    // TS2339 (đã trả giá khi viết plugin).
    assert.match(
      plugin,
      /event\.node\.res\.statusCode/,
      'status phải đọc từ event.node.res.statusCode — hook arg chỉ có { body }',
    )
    assert.doesNotMatch(
      plugin,
      /response\.status\b/,
      'KHÔNG dùng response.status — hook beforeResponse arg không có field này (TS2339)',
    )
  })
})

describe('routeRules IPX — chưa bị xóa immutable cho 200', () => {
  it("routeRules /_ipx/** vẫn set cache-control immutable (plugin xử lý error, routeRules giữ 200)", () => {
    // Cùng config vẫn giữ cache 1 năm cho 200 — plugin chỉ override khi >= 400.
    // Nếu ai xóa dòng này, ảnh IPX 200 sẽ re-fetch mỗi lần → tăng tải origin.
    assert.match(
      nuxtConfig,
      /['"]\/_ipx\/\*\*['"]:\s*\{\s*headers:\s*\{\s*['"]cache-control['"]:\s*['"]public,\s*max-age=31536000,\s*immutable['"]/,
      "routeRules /_ipx/** phải giữ cache-control immutable 1 năm cho 200 — plugin chỉ can thiệp status >= 400",
    )
  })
})
