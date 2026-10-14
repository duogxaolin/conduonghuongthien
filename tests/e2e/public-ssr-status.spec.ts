/**
 * Mặt còn lại của "lượt SSR hỏng → 503 + no-store" (`app/utils/ssr-failure-response.ts`):
 * khi CSDL KHOẺ, các trang dựng bằng khối vẫn trả 200 và vẫn được đệm SWR như cũ.
 *
 * Nhánh hỏng (CSDL sập → 503) không dựng được trong bộ e2e này — CSDL dùng chung
 * của cả bộ phải sống. Nó được kiểm bằng test thuần của hàm quyết định
 * (`tests/ssr-failure-response.test.ts`) và một lượt dò tay trên bản build không
 * có CSDL (ghi trong báo cáo). Spec này chặn hồi quy ngược: một điều kiện 503 viết
 * sai (vd. đọc `error` trước khi lượt fetch xong) sẽ biến MỌI lượt mở trang thành
 * 503 và tắt bộ đệm — ở đây nó đỏ ngay.
 */
import { expect, test } from '@playwright/test'

for (const path of ['/', '/about', '/contact', '/media']) {
  test(`${path}: CSDL khoẻ → 200, vẫn đệm SWR, không có nhánh lỗi`, async ({ request }) => {
    const response = await request.get(`${path}?e2e=ssr${Date.now()}`)
    expect(response.status()).toBe(200)
    expect(response.headers()['cache-control'] ?? '').toMatch(/s-maxage=60/)
    expect(await response.text()).not.toContain('role="alert"')
  })
}

// Danh sách bài dùng `usePublicArticleList` (cũng đánh 503 khi lượt đọc hỏng).
for (const path of ['/news', '/documents', '/role-models', '/reintegration-models']) {
  test(`${path}: CSDL khoẻ → 200, không có nhánh lỗi`, async ({ request }) => {
    const response = await request.get(`${path}?e2e=ssr${Date.now()}`)
    expect(response.status()).toBe(200)
    expect(await response.text()).not.toContain('role="alert"')
  })
}

test('slug không tồn tại vẫn là 404 (không bị lượt kiểm lỗi biến thành 503)', async ({ request }) => {
  const response = await request.get(`/khong-ton-tai-${Date.now()}`)
  expect(response.status()).toBe(404)
})
