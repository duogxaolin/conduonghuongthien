/**
 * Guard cho IPX cache-control trên error response.
 *
 * Bối cảnh (prod cdht.delify.vn 2026-10-07): IPX `/_ipx/...` trả 500 tạm lúc
 * deploy/cold-start (R2 fetch chậm). Trước đây routeRules `'/_ipx/**'` set
 * `cache-control: public, max-age=31536000, immutable` — áp dụng cho MỌI status.
 * IPX 200 tự set `max-age=300` (srvx API, ghi đè routeRules), NHƯNG error 404/500
 * qua Nitro errorHandler kế thừa routeRules → `immutable` → Cloudflare cache
 * error đúng 1 năm → ảnh vỡ vĩnh viễn (`cf-cache-status: HIT`, `age: 1100`
 * trên response 500 immutable).
 *
 * Fix: routeRules `/_ipx/**` đổi sang `no-store`. IPX 200 vẫn cache 300s do IPX
 * tự set header (routeRules không ghi đè IPX 200 qua srvx). Error 404/500 nhận
 * `no-store` từ routeRules → CF không cache error → request lại IPX thử lại.
 *
 * Tại sao KHÔNG dùng plugin hook:
 * - `beforeResponse` hook KHÔNG chạy cho error path (`event.handled=true` sau
 *   `send()` → h3 skip `onBeforeResponse` cho error).
 * - `error` hook (`captureError` → `callHookParallel("error")`) KHÔNG fire cho
 *   IPX error vì IPX dùng `toNodeHandler` (srvx) catch/convert error thành
 *   response nội bộ, không bubble lên h3 `onError`/`captureError`.
 * - routeRules áp dụng qua middleware `createRouteRulesHandler` chạy trước handler,
 *   set header qua `event.node.res.setHeader` (Node API) → Nitro errorHandler
 *   kế thừa →靠谱 hơn hook.
 *
 * Test guard cấu trúc — không thể mock Nitro runtime trong Node runner thuần.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const nuxtConfig = read('nuxt.config.ts')

describe('routeRules IPX — no-store cho error (IPX 200 tự set max-age=300)', () => {
  it('routeRules /_ipx/** set cache-control no-store (KHÔNG immutable)', () => {
    // IPX 200 tự set `max-age=300, s-maxage=300` qua srvx API — routeRules không
    // ghi đè. routeRules chỉ áp dụng error path → no-store để CF không cache 500.
    assert.match(
      nuxtConfig,
      /['"]\/_ipx\/\*\*['"]:\s*\{\s*headers:\s*\{\s*['"]cache-control['"]:\s*['"]no-store['"]\s*\}\s*\}/,
      "routeRules /_ipx/** phải set 'cache-control: no-store' — IPX 200 tự set max-age=300 (routeRules không ghi đè), error path nhận no-store để CF không cache 500 vĩnh viễn",
    )
    assert.doesNotMatch(
      nuxtConfig,
      /['"]\/_ipx\/\*\*['"][^}]*immutable/,
      'routeRules /_ipx/** KHÔNG được set immutable — CF cache error 500 immutable 1 năm → ảnh vỡ vĩnh viễn (đã trả giá 2026-10-07)',
    )
  })
})
