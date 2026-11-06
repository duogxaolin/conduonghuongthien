/**
 * Smoke: mỗi TRANG CÔNG KHAI TĨNH (danh sách ở `public-static-pages.ts`, được
 * `tests/ratchets/e2e-static-pages.test.ts` canh khớp cây `app/pages`) phải trên bản build thật:
 *  - trả 200,
 *  - có đúng MỘT `<h1>` ở HTML máy chủ lẫn sau hydrate,
 *  - không có `console.error` và không có `pageerror` (lỗi JS chưa bắt) trong lúc tải + hydrate.
 *
 * Một test mỗi route (báo lỗi chỉ đúng trang hỏng); mỗi test chỉ một lượt `goto`, không dựng dữ
 * liệu — bộ e2e đã sát `globalTimeout`, nên spec này giữ nhẹ.
 *
 * Lỗi mạng của trình duyệt ("Failed to load resource … 401/404") cũng là `console.error`, và
 * cũng tính: một trang công khai gọi API trả 4xx/5xx lúc bình thường là lỗi thật. Ngoại lệ đã biết
 * (nếu có) ghi ở `KNOWN_BENIGN` kèm lý do — không lọc chung chung.
 */
import { expect, test } from '@playwright/test'
import { SMOKE_PAGES } from './public-static-pages'

/** Mẫu thông điệp console được bỏ qua, mỗi mục kèm lý do. Mặc định rỗng. */
const KNOWN_BENIGN: Array<{ pattern: RegExp, route?: string, reason: string }> = []

const stamp = `${Date.now()}`

for (const route of SMOKE_PAGES) {
  test(`${route}: 200, đúng một <h1>, không lỗi console`, async ({ page }) => {
    const problems: string[] = []
    page.on('console', (message) => {
      if (message.type() !== 'error') return
      const text = message.text()
      const location = message.location()
      if (KNOWN_BENIGN.some(item => item.pattern.test(text) && (!item.route || item.route === route))) return
      problems.push(`console.error: ${text}${location?.url ? ` (${location.url})` : ''}`)
    })
    page.on('pageerror', (error) => { problems.push(`pageerror: ${error.message}`) })

    const url = `${route}?e2e=smoke${stamp}`
    const response = await page.goto(url, { waitUntil: 'networkidle' })
    expect(response, `${route}: không có phản hồi`).not.toBeNull()
    expect(response!.status(), `${route}: mã trạng thái`).toBe(200)

    const ssrHtml = await response!.text()
    const ssrH1 = (ssrHtml.match(/<h1[\s>]/g) ?? []).length
    const hydratedH1 = await page.locator('h1').count()
    expect({ ssrH1, hydratedH1 }, `${route}: số <h1> (SSR / sau hydrate)`).toEqual({ ssrH1: 1, hydratedH1: 1 })

    expect(problems, `${route}: lỗi trình duyệt`).toEqual([])
  })
}
