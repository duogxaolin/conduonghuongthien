/**
 * Gọi THẬT các endpoint đọc runtimeConfig qua `tryRuntimeConfig()` — lớp kiểm
 * duy nhất bắt được hồi quy ba tuần của analytics.
 *
 * Bối cảnh: `tryRuntimeConfig()` dò `globalThis.useRuntimeConfig`, mà auto-import
 * của Nitro chỉ chèn cho identifier trần, và không gì trong nuxt@4.5.2 /
 * nitropack@2.13.4 gắn global đó. Kết quả là mọi lượt `POST
 * /api/public/analytics/page-view` trả `202 {accepted: false}` **vĩnh viễn** dù
 * `NUXT_ANALYTICS_COLLECTION_ENABLED=true` đã đúng trong container, và
 * `POST /api/public/chatbot/session` trả 503 — ba tuần, không một lỗi nào ở đâu.
 * Toàn bộ 1400+ test đều xanh vì chúng stub chính `globalThis.useRuntimeConfig`
 * (giả định "the same shape Nitro provides" mà stack hiện tại không từng cung
 * cấp), và không cổng tĩnh nào gọi một endpoint.
 *
 * Spec này gọi endpoint sau khi build thật. Nếu global không được gắn (hoặc bị
 * gỡ), hai khẳng định dưới đây đỏ ngay: `accepted: false` trả mã 202 trông y
 * hệt thành công, nên phải khẳng định **giá trị** chứ không chỉ mã trạng thái.
 *
 * Yêu cầu env: global-setup đã đặt `NUXT_ANALYTICS_HMAC_SECRET` và
 * `NUXT_ANALYTICS_COLLECTION_ENABLED=true` (đặt tường minh ở dưới cho chắc —
 * phải đúng hình dạng deployment thật, nơi biến này nằm trong container).
 */
import { expect, test } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

test('analytics page-view được chấp nhận thật và vé phiên chat được phát', async ({ request }) => {
  // Đặt tường minh để spec tự nói rõ tiền đề của nó: nếu ai xoá dòng này trong
  // global-setup, test đỏ với thông điệp đúng thay vì lặng lẽ kiểm điều khác.
  expect(process.env.NUXT_ANALYTICS_HMAC_SECRET, 'global-setup phải cấp NUXT_ANALYTICS_HMAC_SECRET').toBeTruthy()

  // ── 1. Page-view: phải là accepted:true, không chỉ 202 ────────────────────
  // Body đúng hình dạng `validateAnalyticsPayload` chấp nhận. Đường dẫn công khai
  // có thật trên cổng, không phải /admin hay /api.
  const pageView = await request.post('/api/public/analytics/page-view', {
    data: {
      path: '/',
      sourceCategory: 'direct',
      deviceClass: 'desktop',
    },
    headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Firefox/126.0' },
  })
  const pvBody = await pageView.text()
  expect(pageView.status(), `page-view hỏng: ${pvBody}`).toBe(202)
  // Giá trị quyết định: đây là điểm mà bản lỗi trả {accepted:false} với mã 202
  // trông y hệt thành công.
  expect(JSON.parse(pvBody).accepted, `202 nhưng không chấp nhận: ${pvBody}`).toBe(true)

  // ── 2. Chat session token: secret rỗng là 503; secret đúng phải phát vé ───
  const session = await request.post('/api/public/chatbot/session')
  const sessionBody = await session.text()
  expect(session.status(), `chat session hỏng: ${sessionBody}`).toBe(200)
  const token = JSON.parse(sessionBody).token
  expect(token).toMatch(/^[0-9a-f-]{36}\.[0-9a-f]{32}$/)

  // Vé được phát phải XÁC MINH được bằng chính secret đó — một token không ký
  // đúng secret của deployment này là token rác.
  const { createHmac } = await import('node:crypto')
  const secret = process.env.NUXT_ANALYTICS_HMAC_SECRET!
  const [sessionId, signature] = (token as string).split('.')
  const expected = createHmac('sha256', secret).update(sessionId).digest('hex').slice(0, 32)
  expect(signature, 'vé phiên không ký bằng secret của deployment').toBe(expected)
})
