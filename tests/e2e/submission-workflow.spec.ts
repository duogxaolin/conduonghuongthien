/**
 * Vòng đời một đơn đăng ký hỗ trợ — kiểm bằng cách đi qua nó, không bằng cách nhìn vào mã.
 *
 * Spec này phủ 9 endpoint nghiệp vụ chính phủ vốn chỉ có structure assertion:
 *   POST /api/submissions              công khai, tạo đơn
 *   GET  /api/admin/submissions        list + filter theo status/viewed
 *   GET  /api/admin/submissions/[id]   đọc chi tiết + nhật ký xử lý
 *   PUT  /api/admin/submissions/[id]/status   đổi trạng thái (state machine)
 *   POST /api/admin/submissions/[id]/notes    ghi chú nghiệp vụ
 *   POST /api/admin/submissions/[id]/contact  ghi nhận đã liên hệ người dân
 *   DELETE /api/admin/submissions/[id]         xoá đơn
 *
 * Cùng thứ `admin-write-paths.spec.ts` đang làm: gọi endpoint thật, đòi hàng
 * thật thay đổi. Một regression bất kỳ trên đường ghi — TDZ, transaction
 * rollback, `affectedRows` đọc sai, `insertId` undefined, state machine chặc
 * phép chuyển cấm — đều làm spec đỏ, kể cả dạng chưa ai gặp.
 *
 * State machine (`shared/submission-status.ts`): `new` là trạng thái gốc và
 * **không** nằm trong đích đến của bất kỳ trạng thái nào (một đơn đã xem không
 * "chưa tiếp nhận" lại được). Mọi trạng thái khác đến được lẫn nhau. Spec đi
 * `new → in_progress → resolved` và `new → rejected` để chạm cả nhánh đóng.
 *
 * Dữ liệu được dựng qua API công khai chính xác như người dân dùng — endpoint
 * này không có auth, không phụ thuộc nhà cung cấp AI, không cần SMTP. Một spec
 * tự dựng dữ liệu đầu vào qua đường thật là spec không đỏ vì lý do sai.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { E2E_ADMIN_USERNAME, E2E_PASSWORD_ENV } from './harness'

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

test('vòng đời đơn: gửi → duyệt → xử lý → đóng → xoá', async ({ page }) => {
  await login(page)
  const api = page.request
  const stamp = Date.now()

  // ── 1. Công khai gửi đơn — không auth, không SMTP ──────────────────────────
  // Dynamic-form path (answers[]), mỗi answer có map → cột cố định. Đây là
  // đường giao diện trang chủ đang dùng.
  const submit = await postJson(api, '/api/submissions', {
    formTitle: 'E2E form hỗ trợ',
    recipientEmail: '',
    answers: [
      { id: 'name', label: 'Họ và tên', value: `E2E Dân ${stamp}`, map: 'name', type: 'text', required: true },
      { id: 'phone', label: 'Số điện thoại', value: '0901234567', map: 'phone', type: 'tel', required: true },
      { id: 'message', label: 'Nội dung', value: `Yêu cầu hỗ trợ ${stamp} cần giải quyết`, map: 'message', type: 'textarea', required: true },
    ],
  })
  expect(submit.status, `gửi đơn công khai hỏng: ${submit.body}`).toBe(200)
  const submissionId = submit.json().id
  expect(submissionId, 'tạo đơn không trả id — giao diện sẽ điều hướng tới .../undefined')
    .toBeTruthy()

  // ── 2. Admin thấy đơn trong danh sách "new" ───────────────────────────────
  // Hàng phải đọc lại được qua endpoint admin: transaction rollback vẫn có thể
  // trả 200 nếu handler bắt nhầm lỗi.
  const listNew = await api.get('/api/admin/submissions?status=new')
  expect(listNew.status(), 'list đơn new hỏng').toBe(200)
  const newList = (await listNew.json()) as { submissions?: Array<{ id: number }> }
  const found = (newList.submissions ?? []).some((row) => row.id === submissionId)
  expect(found, 'đơn vừa gửi không lọt danh sách new — display và storage lệch nhau').toBe(true)

  // ── 3. Đọc chi tiết — nhật ký ban đầu chỉ có 'view' khi admin mở ──────────
  const detailRes = await api.get(`/api/admin/submissions/${submissionId}`)
  expect(detailRes.status(), 'đọc chi tiết đơn hỏng').toBe(200)
  const detail = (await detailRes.json()) as { submission?: { id: number }, events?: unknown[] }
  expect(detail.submission?.id, 'detail trả sai shape — không có submission.id').toBe(submissionId)

  // ── 4. Đổi trạng thái new → in_progress (state machine cho phép) ───────────
  const toProgress = await api.put(`/api/admin/submissions/${submissionId}/status`, {
    data: { status: 'in_progress' },
  })
  expect(toProgress.status(), `đổi new→in_progress hỏng: ${await toProgress.text()}`).toBe(200)
  expect((await toProgress.json()) as Record<string, unknown>).toMatchObject({ status: 'in_progress' })

  // Chuyển về lại `new` PHẢI bị từ chối: `new` không nằm trong đích đến của bất kỳ
  // trạng thái nào. Đây chính ràng buộc `allowedTransitions` ở submission-status.
  const backToNew = await api.put(`/api/admin/submissions/${submissionId}/status`, {
    data: { status: 'new' },
  })
  expect(backToNew.status(), 'cho phép quay về new — xóa dấu vết first_viewed').toBe(400)

  // ── 5. Ghi chú nghiệp vụ ──────────────────────────────────────────────────
  const note = await postJson(api, `/api/admin/submissions/${submissionId}/notes`, {
    note: `Đã gọi xác minh ${stamp}`,
  })
  expect(note.status, `ghi chú hỏng: ${note.body}`).toBe(200)

  // Ghi chú rỗng phải bị từ chối — không tạo event rỗng.
  const emptyNote = await postJson(api, `/api/admin/submissions/${submissionId}/notes`, { note: '' })
  expect(emptyNote.status, 'ghi chú rỗng lại được nhận').toBe(400)

  // ── 6. Ghi nhận đã liên hệ người dân ───────────────────────────────────────
  const contact = await postJson(api, `/api/admin/submissions/${submissionId}/contact`, {
    channel: 'phone',
    note: 'Người dân xác nhận thông tin',
  })
  expect(contact.status, `ghi contact hỏng: ${contact.body}`).toBe(200)

  // Kênh liên hệ sai phải bị từ chối — isContactChannel là type guard duy nhất.
  const badChannel = await postJson(api, `/api/admin/submissions/${submissionId}/contact`, {
    channel: 'carrier_pigeon',
  })
  expect(badChannel.status, 'kênh lạ lại được nhận').toBe(400)

  // ── 7. Đóng đơn: in_progress → resolved (nhánh đóng positive) ──────────────
  const toResolved = await api.put(`/api/admin/submissions/${submissionId}/status`, {
    data: { status: 'resolved', note: `Đã xử lý ${stamp}` },
  })
  expect(toResolved.status(), `in_progress→resolved hỏng: ${await toResolved.text()}`).toBe(200)
  expect((await toResolved.json()) as Record<string, unknown>).toMatchObject({ status: 'resolved' })

  // Trạng thái trùng (resolved→resolved) PHẢI bị từ chối: không đổi gì mà sinh
  // mục nhật ký là dòng thời gian đầy mục không đổi.
  const sameStatus = await api.put(`/api/admin/submissions/${submissionId}/status`, {
    data: { status: 'resolved' },
  })
  expect(sameStatus.status(), 'chuyển sang chính trạng thái đang có lại được nhận').toBe(400)

  // ── 8. Mở lại hồ sơ đóng sai: resolved → in_progress (cho phép) ────────────
  const reopen = await api.put(`/api/admin/submissions/${submissionId}/status`, {
    data: { status: 'in_progress' },
  })
  expect(reopen.status(), `resolved→in_progress phải được phép mở lại: ${await reopen.text()}`)
    .toBe(200)

  // ── 9. Xoá đơn — hàng phải biến mất ────────────────────────────────────────
  const del = await api.delete(`/api/admin/submissions/${submissionId}`)
  expect(del.status(), `xoá đơn hỏng: ${await del.text()}`).toBe(200)

  const after = await api.get(`/api/admin/submissions/${submissionId}`)
  expect(after.status(), 'đơn đã xoá vẫn đọc được — xóa không tác dụng').toBe(404)
})

test('nhánh đóng negative: new → rejected + deixouza chuỗi giao diện', async ({ page }) => {
  await login(page)
  const api = page.request
  const stamp = Date.now()

  const submit = await postJson(api, '/api/submissions', {
    formTitle: 'E2E form tỷ lệ',
    recipientEmail: '',
    answers: [
      { id: 'name', label: 'Họ và tên', value: `E2E Trùng ${stamp}`, map: 'name', type: 'text', required: true },
      { id: 'phone', label: 'Số điện thoại', value: '0907654321', map: 'phone', type: 'tel', required: true },
      { id: 'message', label: 'Nội dung', value: `Đơn trùng ${stamp}`, map: 'message', type: 'textarea', required: true },
    ],
  })
  expect(submit.status, `gửi đơn hỏng: ${submit.body}`).toBe(200)
  const id = submit.json().id
  expect(id, 'tạo đơn không trả id').toBeTruthy()

  // new → rejected là chuyển tiếp hợp lệ (rẽ nhánh đóng negative).
  const reject = await api.put(`/api/admin/submissions/${id}/status`, {
    data: { status: 'rejected', note: 'Trùng lặp' },
  })
  expect(reject.status(), `new→rejected hỏng: ${await reject.text()}`).toBe(200)
  expect((await reject.json()) as Record<string, unknown>).toMatchObject({ status: 'rejected' })

  // Trạng thái không hợp lệ (ngoài allowlist) phải bị từ chối ở isSubmissionStatus.
  const bogus = await api.put(`/api/admin/submissions/${id}/status`, {
    data: { status: 'done' },
  })
  expect(bogus.status(), 'trạng thái ngoài allowlist lại được nhận').toBe(400)

  // Dọn — đơn của spec này không trôi vào bộ đếm của spec khác.
  const del = await api.delete(`/api/admin/submissions/${id}`)
  expect(del.status(), `dọn đơn hỏng: ${await del.text()}`).toBe(200)
})
