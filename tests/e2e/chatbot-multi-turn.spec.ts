/**
 * Chatbot đa lượt — kiểm bằng cách chat, không bằng cách nhìn vào mã.
 *
 * Spec này phủ 5 endpoint công khai vốn chỉ có structure assertion:
 *   POST /api/public/chatbot/session         xin token phiên (HMAC)
 *   POST /api/public/chatbot                 gửi lượt chat (SSE)
 *   GET  /api/public/chatbot/quick-questions  câu hỏi nhanh
 *   GET  /api/public/chatbot/knowledge       kho nghi vấn nghiệp
 *   GET  /api/public/chatbot/sources         nguồn trích dẫn
 *
 * Chatbot chạy ở `mode='knowledge'` (mặc định seed) — matcher kho thuần, không
 * gọi AI provider, không cần network ngoài. Spec dựng một entry kho qua admin
 * API, publish nó, rồi chat đúng câu hỏi đó để matcher trả hit. Đây là đường
 * giao diện widget công khai đang đi.
 *
 * Spec KHÔNG kiểm AI mode: provider ngoài dễ flaky, và matcher kho là tầng
 * kiểm được không cần provider. AI mode đã có `tests/*-integration` cho
 * `providerRequest` mock — tầng behavior欠缺 là matcher + session, không phải AI.
 *
 * Lý do thêm: `admin-write-paths.spec.ts` từng đỏ vì tuyến chatbot trả 503 khi
 * chưa cấu hình nhà cung cấp AI — một lý do không liên quan gì tới điều nó
 * khẳng định. Spec này cố tình không phụ thuộc AI: nếu chatbot không cấu hình
 * provider, matcher kho vẫn trả được câu trả lời đã duyệt.
 *
 * SSE envelope: widget parse `data: {...}\n\n` + `data: [DONE]\n\n`. Spec đọc
 * thân thô, gộp `choices[].delta.content` lại, và đọc `chatbot.kind` ở envelope
 * cuối để biết `curated` (match) hay `not_found` (fallthrough).
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

async function postJson(api: APIRequestContext, url: string, data: unknown) {
  const response = await api.post(url, { data })
  const body = await response.text()
  return { status: response.status(), body, json: () => JSON.parse(body) as Record<string, unknown> }
}

/** Gộp nội dung SSE từ `data:` lines, trả { text, kind }. */
function parseSse(raw: string): { text: string; kind: string | null } {
  const lines = raw.split('\n')
  let text = ''
  let kind: string | null = null
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue
    const payload = line.slice(6)
    if (payload === '[DONE]') continue
    try {
      const obj = JSON.parse(payload) as Record<string, unknown>
      const choices = obj.choices as Array<{ delta?: { content?: string } }> | undefined
      if (Array.isArray(choices)) {
        for (const c of choices) {
          if (typeof c?.delta?.content === 'string') text += c.delta.content
        }
      }
      const chatbot = obj.chatbot as { kind?: string } | undefined
      if (chatbot && typeof chatbot.kind === 'string') kind = chatbot.kind
    } catch {
      // dòng data không phải JSON — bỏ qua
    }
  }
  return { text, kind }
}

// Tuần tự: các spec dùng chung một phiên quản trị và một cơ sở dữ liệu.
test.describe.configure({ mode: 'serial' })

test('chatbot knowledge mode: matcher trả câu đã duyệt, session giữ phiên', async ({ page, request }) => {
  await login(page)
  const adminApi = page.request
  const stamp = Date.now()
  const question = `E2E câu hỏi ${stamp}`
  const answer = `E2E câu trả lời đã duyệt ${stamp}`

  // ── 1. Dựng knowledge entry (draft mặc định) ───────────────────────────────
  // Publish yêu cầu source metadata (sourceLabel + sourceReference) — một entry
  // không ghi nguồn sẽ không bao giờ publish được, và đó là ràng buộc thật.
  const create = await postJson(adminApi, '/api/admin/chatbot/knowledge', {
    canonicalQuestion: question,
    approvedAnswer: answer,
    topic: 'e2e',
    sourceLabel: 'E2E Nguồn',
    sourceReference: 'E2E tài liệu tham chiếu',
    aliases: ['e2e-test'],
    keywords: ['e2e'],
  })
  expect(create.status, `tạo knowledge hỏng: ${create.body}`).toBe(200)
  const item = create.json().item as { id: number }
  expect(item.id, 'tạo knowledge không trả id').toBeTruthy()

  // ── 2. Publish — chỉ entry đã publish mới đến matcher ─────────────────────
  const publish = await postJson(adminApi, `/api/admin/chatbot/knowledge/${item.id}/publish`, {})
  expect(publish.status, `publish hỏng: ${publish.body}`).toBe(200)

  // ── 3. Xin session token — widget không tự ký được ──────────────────────────
  const session = await request.post('/api/public/chatbot/session')
  expect(session.status(), 'session endpoint trả trạng thái lạ').toBe(200)
  const { token } = (await session.json()) as { token: string }
  expect(token, 'session không trả token — HMAC secret chưa cấu hình').toBeTruthy()
  expect(token.includes('.'), 'token không có dấu chấm — shape "<uuid>.<hmac>" bị sai').toBe(true)

  // ── 4. Lượt 1: hỏi đúng câu đã duyệt → matcher trả 'curated' ────────────────
  const chat1 = await request.post('/api/public/chatbot', {
    headers: { 'X-Chat-Session': token },
    data: { messages: [{ role: 'user', content: question }] },
  })
  expect(chat1.status(), `lượt chat 1 hỏng: ${await chat1.text()}`).toBe(200)
  const parsed1 = parseSse(await chat1.text())
  expect(parsed1.kind, `lượt 1 không trả kind 'curated' — matcher không hit entry vừa publish`).toBe('curated')
  expect(parsed1.text, 'lượt 1 không chứa câu trả lời đã duyệt').toContain(answer)

  // ── 5. Lượt 2: hỏi không khớp kho → 'not_found' (không gọi AI provider) ────
  // Cùng session token → kiểm session giữ phiên không bị reset giữa lượt.
  // Câu về thời tiết hoàn toàn ngoài phạm vi kho C11 — không khớp alias/keyword.
  const chat2 = await request.post('/api/public/chatbot', {
    headers: { 'X-Chat-Session': token },
    data: { messages: [{ role: 'user', content: 'thời tiết hôm nay ở Hà Nội thế nào' }] },
  })
  expect(chat2.status(), `lượt chat 2 hỏng: ${await chat2.text()}`).toBe(200)
  const parsed2 = parseSse(await chat2.text())
  expect(parsed2.kind, 'lượt 2 trả kind lạ — mode knowledge không nên gọi provider').toBe('not_found')

  // ── 6. Quick-questions endpoint ────────────────────────────────────────────
  // Entry có isQuickQuestion=false mặc định → không lọt. Nhưng endpoint vẫn 200.
  const qq = await request.get('/api/public/chatbot/quick-questions')
  expect(qq.status(), 'quick-questions hỏng').toBe(200)
  const qqBody = (await qq.json()) as { available: boolean; items: Array<{ id: number }> }
  expect(Array.isArray(qqBody.items), 'quick-questions items không phải mảng').toBe(true)

  // ── 7. Knowledge + sources công khai ───────────────────────────────────────
  const kget = await request.get('/api/public/chatbot/knowledge')
  expect(kget.status(), 'knowledge endpoint công khai hỏng').toBe(200)
  // Sources cần ?id= — endpoint trả 400 nếu thiếu, đúng contract.
  const sget = await request.get(`/api/public/chatbot/sources?id=${item.id}`)
  expect(sget.status(), 'sources endpoint công khai hỏng').toBe(200)

  // ── 8. Honeypot `_h` không bị từ chối 400 — trả not_found bình thường ──────
  // 400 cho honeypot sẽ tiết lộ cho bot biết field nào tố nó. Phải là 200.
  const trap = await request.post('/api/public/chatbot', {
    data: { _h: 'bot-stuff', messages: [{ role: 'user', content: question }] },
  })
  expect(trap.status(), 'honeypot trả lỗi — lộ field phát hiện bot cho bên gửi').toBe(200)

  // ── Dọn: xoá entry để không trôi vào spec sau ──────────────────────────────
  const del = await adminApi.delete(`/api/admin/chatbot/knowledge/${item.id}`)
  expect(del.status(), `dọn knowledge hỏng: ${await del.text()}`).toBe(200)
})

test('session token sai định dạng bị từ chối yên lặng — không phải 500', async ({ request }) => {
  // Token rác: server không verify được → coi như không có session, nhưng vẫn
  // trả câu trả lời (không lưu transcript). 500 ở đây là bug lộ through error.
  const chat = await request.post('/api/public/chatbot', {
    headers: { 'X-Chat-Session': 'khong-phai-token' },
    data: { messages: [{ role: 'user', content: 'test' }] },
  })
  // Chấp nhận 200 (xử lý như không có session) — không 500.
  expect(chat.status(), `token rác trả ${chat.status()} — nên 200, không 500`).not.toBe(500)
})
