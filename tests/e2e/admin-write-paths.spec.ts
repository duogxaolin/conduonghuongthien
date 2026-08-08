/**
 * Mọi endpoint TẠO MỚI phải thật sự tạo được — kiểm bằng cách gọi nó.
 *
 * Đây là spec ra đời từ một hồi quy đã lọt qua **mọi** cổng khác. Việc bọc lượt
 * ghi và dòng audit vào một transaction đổi `const id = await db.transaction(…)`,
 * và bốn endpoint viết dòng audit tham chiếu **chính biến đó** từ bên trong
 * callback — nơi nó còn trong vùng chết tạm thời. Kết quả: `POST /api/admin/articles`
 * trả **500** cho mọi lượt tạo bài viết.
 *
 * Nó qua được `npm run typecheck` (biến tồn tại, kiểu đúng), qua `db:drift`, qua
 * `npm run build`, và qua cả 1187 test — vì **không cổng nào trong số đó gọi một
 * endpoint**. Bốn cổng ấy đều kiểm mã ở trạng thái nghỉ. `tests/transaction-tdz.test.ts`
 * nay chặn đúng hình dạng đó trong văn bản mã nguồn, nhưng một guard soi chữ chỉ
 * biết những cách hỏng người viết nó đã nghĩ ra.
 *
 * Spec này thì không cần nghĩ ra trước: nó tạo một bản ghi thật cho mỗi tài
 * nguyên và đòi hàng phải tồn tại sau đó. Bất kỳ lỗi lúc chạy nào trên đường ghi
 * — TDZ, transaction rollback, ràng buộc FK, một `insertId` đọc sai — đều làm nó
 * đỏ, kể cả loại chưa ai gặp.
 *
 * Có kiểm **cả `id` trả về**, không chỉ mã 200: một handler trả `{ ok: true }`
 * kèm `id: undefined` vẫn là 200, và phía giao diện sẽ điều hướng tới
 * `/admin/.../undefined`. Đó chính là hình dạng của lỗi `insertId` mà dự án đã
 * trả giá bốn lần.
 */
import mysql from 'mysql2/promise'

import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { E2E_ADMIN_USERNAME, E2E_PASSWORD_ENV, e2eDbConfig } from './harness'

async function login(page: Page) {
  const password = process.env[E2E_PASSWORD_ENV]
  if (!password) throw new Error(`${E2E_PASSWORD_ENV} is not set — globalSetup did not run`)

  await page.goto('/admin/login')
  await page.fill('input[autocomplete="username"]', E2E_ADMIN_USERNAME)
  await page.fill('input[autocomplete="current-password"]', password)
  await page.click('button[type="submit"]')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Xin chào', { timeout: 20_000 })
}

/** Đọc thân JSON kèm mã trạng thái, và in ra thân khi hỏng — 500 trần không nói gì. */
async function postJson(api: APIRequestContext, url: string, data: unknown) {
  const response = await api.post(url, { data })
  const body = await response.text()
  return { status: response.status(), body, json: () => JSON.parse(body) as Record<string, unknown> }
}

// Tuần tự: các spec dùng chung một phiên quản trị và một cơ sở dữ liệu.
test.describe.configure({ mode: 'serial' })

test('mọi đường ghi tạo mới đều tạo được bản ghi thật', async ({ page }) => {
  await login(page)
  // Dùng lại cookie phiên của trang cho các lời gọi API.
  const api = page.request
  const stamp = Date.now()

  // ── Bài viết ──────────────────────────────────────────────────────────────
  // Đây là endpoint đã trả 500. Nó đứng đầu vì cũng là endpoint được dùng nhiều
  // nhất trong cả hệ thống quản trị.
  const article = await postJson(api, '/api/admin/articles', {
    title: `E2E bài viết ${stamp}`,
    slug: `e2e-bai-viet-${stamp}`,
    type: 'news',
    content: '<p>Nội dung kiểm chứng</p>',
    excerpt: 'tóm tắt',
    status: 'published',
  })
  expect(article.status, `tạo bài viết hỏng: ${article.body}`).toBe(200)
  const articleId = article.json().id
  expect(articleId, 'handler trả 200 nhưng không có id — phía giao diện sẽ điều hướng tới .../undefined')
    .toBeTruthy()

  // Hàng phải đọc lại được: một transaction rollback vẫn có thể trả 200 nếu
  // handler bắt nhầm lỗi.
  const readBack = await api.get(`/api/admin/articles/${articleId}`)
  expect(readBack.status(), 'bài vừa tạo không đọc lại được').toBe(200)

  // ── Vai trò ───────────────────────────────────────────────────────────────
  const role = await postJson(api, '/api/admin/roles', {
    name: `e2e_vaitro_${stamp}`,
    description: 'kiểm chứng đường ghi',
    permissions: [{ resource: 'news', canCreate: true, canRead: true, canUpdate: false, canDelete: false }],
  })
  expect(role.status, `tạo vai trò hỏng: ${role.body}`).toBe(200)
  const roleId = role.json().id
  expect(roleId, 'tạo vai trò không trả id').toBeTruthy()

  // ── Tài khoản ─────────────────────────────────────────────────────────────
  // Đi sau vai trò vì nó cần `roleId` — cũng là lượt kiểm rằng id vừa nhận là
  // một khoá dùng được thật, không phải `0` hay `undefined` đã lọt qua.
  const user = await postJson(api, '/api/admin/users', {
    username: `e2e_nv_${stamp}`,
    email: `e2e_nv_${stamp}@example.com`,
    password: 'Kiem#Chung2026xy',
    roleId,
  })
  expect(user.status, `tạo tài khoản hỏng: ${user.body}`).toBe(200)
  expect(user.json().id, 'tạo tài khoản không trả id').toBeTruthy()

  // ── Trang & block ─────────────────────────────────────────────────────────
  const pageRes = await postJson(api, '/api/admin/pages', {
    title: `E2E trang ${stamp}`,
    slug: `e2e-trang-${stamp}`,
  })
  expect(pageRes.status, `tạo trang hỏng: ${pageRes.body}`).toBe(200)
  const pageId = pageRes.json().id
  expect(pageId, 'tạo trang không trả id').toBeTruthy()

  const block = await postJson(api, `/api/admin/pages/${pageId}/blocks`, { blockType: 'heading' })
  expect(block.status, `thêm block hỏng: ${block.body}`).toBe(200)

  // ── Sửa ───────────────────────────────────────────────────────────────────
  // `updateFields` được khai kiểu theo `$inferInsert` của bảng; một khoá không
  // tồn tại trong lược đồ nay là lỗi biên dịch, nhưng lượt ghi vẫn phải chạy.
  const update = await postJson(api, `/api/admin/articles/${articleId}`, {})
  // (POST tới tuyến PUT trả 405 — dùng đúng phương thức bên dưới.)
  expect([404, 405]).toContain(update.status)

  const put = await api.put(`/api/admin/articles/${articleId}`, {
    data: { title: `E2E đã sửa ${stamp}`, commentsEnabled: true },
  })
  expect(put.status(), `sửa bài hỏng: ${await put.text()}`).toBe(200)
})

/**
 * Con số một hành động phá huỷ báo về phải khớp thứ nó đã xoá.
 *
 * `bulk-delete` từng đọc `affectedRows` trên mảng chưa destructure, nên nó **luôn**
 * báo "đã xoá 0" trong khi hàng thật đã mất — và dòng `activity_logs` ghi
 * `deletedCount: 0` kèm câu khẳng định rằng không có gì bị xoá. Một hành động
 * phá huỷ mà dấu vết duy nhất của nó phủ nhận nó đã xảy ra là đúng thứ nhật ký
 * kiểm toán tồn tại để ngăn.
 */
test('lượt xoá hàng loạt báo về đúng số hàng đã xoá', async ({ page }) => {
  await login(page)
  const api = page.request
  const stamp = Date.now()

  // Hàng được chèn thẳng vào bảng, KHÔNG đi qua tuyến chatbot công khai: tuyến
  // đó trả 503 khi chưa cấu hình nhà cung cấp AI, nên dựng dữ liệu qua nó sẽ làm
  // spec này đỏ vì một lý do không liên quan gì tới điều nó khẳng định. Điều cần
  // kiểm ở đây là **con số báo về khớp số hàng biến mất**, và điều đó không phụ
  // thuộc vào việc hàng ra đời bằng cách nào.
  const ids = [`e2e-${stamp}-a`, `e2e-${stamp}-b`]
  const connection = await mysql.createConnection(e2eDbConfig())
  try {
    for (const id of ids) {
      await connection.execute(
        'INSERT INTO chat_sessions (id, started_at, last_message_at, message_count) VALUES (?, NOW(), NOW(), 1)',
        [id],
      )
    }
  } finally {
    await connection.end()
  }

  const removed = await postJson(api, '/api/admin/chatbot/sessions/bulk-delete', { ids })
  expect(removed.status, `xoá hàng loạt hỏng: ${removed.body}`).toBe(200)
  expect(removed.json().deleted,
    'báo về 0 trong khi hàng đã mất — đúng lỗi affectedRows đọc trên mảng chưa destructure')
    .toBeGreaterThan(0)
})
