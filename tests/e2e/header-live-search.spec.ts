/**
 * Gợi ý tìm kiếm ở header: lượt gọi HỎNG hiện thông báo lỗi + "Thử lại", không phải
 * "Không tìm thấy kết quả phù hợp".
 *
 * Lỗi đã gặp: `useLiveSearch` nuốt lỗi của `/api/public/search` (503 khi CSDL hỏng)
 * thành danh sách rỗng. Máy trạng thái có test thuần (`tests/live-search.test.ts`);
 * spec này chứng minh dây nối thật: layout → header → khung gợi ý trong trình duyệt.
 * Lượt gọi API bị chặn ở trình duyệt (`page.route`) để dựng 503 mà không phải làm
 * hỏng CSDL dùng chung của cả bộ.
 */
import { expect, test } from '@playwright/test'

const LOADING_TEXT = 'Đang tải...'

test('503 → role="alert" + Thử lại; thử lại thành công → hiện gợi ý', async ({ page }) => {
  let failing = true
  const calls: string[] = []
  await page.route('**/api/public/search?**', async (route) => {
    calls.push(route.request().url())
    if (failing) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, items: [] }) })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        items: [{ id: 1, kind: 'article', type: 'news', typeLabel: 'Bản tin', typeIcon: 'fa-solid fa-newspaper', typeBadgeClass: '', title: 'Bài gợi ý E2E', excerpt: '', url: '/news/bai-goi-y-e2e', thumbnailUrl: null, categoryName: null }],
      }),
    })
  })

  await page.goto(`/contact?e2e=livesearch${Date.now()}`)
  await expect(page.getByText(LOADING_TEXT, { exact: true })).toHaveCount(0, { timeout: 20_000 })
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: 'Mở ô tìm kiếm' }).click()
  const input = page.getByRole('textbox', { name: 'Tìm kiếm trên cổng thông tin' }).first()
  await input.fill('vay vốn')

  const alert = page.getByRole('alert').filter({ hasText: 'Không tải được gợi ý tìm kiếm.' })
  await expect(alert).toBeVisible()
  await expect(page.getByText(/Không tìm thấy kết quả phù hợp/)).toHaveCount(0)

  failing = false
  await alert.getByRole('button', { name: 'Thử lại' }).click()
  await expect(page.getByRole('link', { name: /Bài gợi ý E2E/ })).toBeVisible()
  await expect(alert).toHaveCount(0)
  expect(calls.length).toBe(2)
})
