/**
 * `/admin/chatbot/answer-cache` — XEM toàn văn và SỬA một câu trả lời đã lưu, trên trình duyệt thật.
 *
 * Trang từng chỉ liệt kê câu HỎI: người quản trị không thấy câu mà cổng đang phát lại, và muốn
 * sửa một câu sai chỉ còn cách xoá (2026-11-06). Test hành vi của handler
 * (`tests/chatbot-answer-cache-view-edit-behavior.test.ts`) chứng minh quyền, kiểm tra đầu vào và
 * audit; spec này chứng minh phần chỉ trình duyệt thấy được: nút bấm được, hộp mở đúng nội dung,
 * sửa xong danh sách đổi theo và bản lưu là bản người dùng sẽ nhận.
 */
import mysql from 'mysql2/promise'

import { expect, test, type Page } from '@playwright/test'
import { E2E_ADMIN_USERNAME, E2E_PASSWORD_ENV, e2eDbConfig } from './harness'
import { answerCacheKey } from '../../server/utils/chatbot/answer-cache-key'

async function login(page: Page) {
  const password = process.env[E2E_PASSWORD_ENV]
  if (!password) throw new Error(`${E2E_PASSWORD_ENV} is not set — globalSetup did not run`)
  await page.goto('/admin/login')
  await page.fill('input[autocomplete="username"]', E2E_ADMIN_USERNAME)
  await page.fill('input[autocomplete="current-password"]', password)
  await page.click('button[type="submit"]')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Xin chào', { timeout: 20_000 })
}

test.describe.configure({ mode: 'serial' })

const stamp = Date.now()
const QUESTION = `Câu hỏi E2E ${stamp}`
/**
 * Khoá THẬT mà một lượt hỏi tính ra với cấu hình đang chạy (đọc ở `beforeAll`): cổng sửa tay từ chối
 * (409) hàng không lượt hỏi nào còn tới được — một khoá bịa sẽ là đúng loại hàng đó.
 */
let KEY = ''
// Dài hơn đoạn xem trước (240 ký tự) để chứng minh danh sách chỉ cho thấy phần đầu.
const FULL_ANSWER = `Phần đầu của câu trả lời. ${'Nội dung kéo dài để vượt đoạn xem trước. '.repeat(10)}CUỐI-CÙNG-CHỈ-HIỆN-Ở-HỘP`
const NEW_ANSWER = `Bản đã sửa tay ${stamp}.\nDòng thứ hai.`

async function withDb<T>(fn: (conn: mysql.Connection) => Promise<T>): Promise<T> {
  const conn = await mysql.createConnection(e2eDbConfig())
  try { return await fn(conn) } finally { await conn.end() }
}

test.beforeAll(async () => {
  const [rows] = await withDb(conn => conn.execute(
    'SELECT mode, out_of_scope_behavior, model, base_url, system_prompt, answer_cache_version FROM chatbot_settings WHERE id = 1',
  ))
  const current = (rows as Array<Record<string, string | number | null>>)[0]
  if (!current) throw new Error('chatbot_settings row 1 is missing — db:seed did not run')
  KEY = answerCacheKey({
    question: QUESTION,
    settings: {
      mode: String(current.mode),
      outOfScopeBehavior: String(current.out_of_scope_behavior),
      model: current.model === null ? null : String(current.model),
      baseUrl: current.base_url === null ? null : String(current.base_url),
      systemPrompt: current.system_prompt === null ? null : String(current.system_prompt),
    },
    version: Number(current.answer_cache_version),
    historyLength: 1,
  })!
  await withDb(conn => conn.execute(
    `INSERT INTO chatbot_answer_cache (cache_key, question, answer, kind, sources, follow_ups, hits, created_at, last_used_at, expires_at)
     VALUES (?, ?, ?, 'provider', ?, ?, 3, UTC_TIMESTAMP(), UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 DAY))`,
    [KEY, QUESTION, FULL_ANSWER, JSON.stringify([{ id: 1, kind: 'knowledge', source: { label: 'Điều 70', reference: 'BLHS 2015', url: null } }]), JSON.stringify(['Gợi ý thứ nhất?'])],
  ))
})

test.afterAll(async () => {
  await withDb(conn => conn.execute('DELETE FROM chatbot_answer_cache WHERE cache_key = ?', [KEY]))
})

test('danh sách có đoạn đầu câu trả lời; hộp "Xem" hiện toàn văn, gợi ý và nguồn', async ({ page }) => {
  await login(page)
  await page.goto('/admin/chatbot/answer-cache')
  const row = page.getByRole('row').filter({ hasText: QUESTION })
  await expect(row).toBeVisible({ timeout: 20_000 })
  await expect(row).toContainText('Phần đầu của câu trả lời.')
  await expect(row).not.toContainText('CUỐI-CÙNG-CHỈ-HIỆN-Ở-HỘP')

  await row.getByRole('button', { name: /^Xem câu trả lời cho/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Câu trả lời đã lưu' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByTestId('answer-cache-answer')).toContainText('CUỐI-CÙNG-CHỈ-HIỆN-Ở-HỘP')
  await expect(dialog).toContainText(QUESTION)
  await expect(dialog).toContainText('Gợi ý thứ nhất?')
  await expect(dialog).toContainText('Điều 70')

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('sửa: lưu đổi cả hộp, danh sách và bản trong CSDL; "Huỷ sửa" không đổi gì', async ({ page }) => {
  await login(page)
  await page.goto('/admin/chatbot/answer-cache')
  const row = page.getByRole('row').filter({ hasText: QUESTION })
  await row.getByRole('button', { name: /^Sửa câu trả lời cho/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Câu trả lời đã lưu' })
  const answerBox = dialog.getByLabel('Câu trả lời', { exact: true })
  await expect(answerBox).toBeVisible()
  await expect(answerBox).toHaveValue(FULL_ANSWER)

  // Huỷ sửa: chữ gõ dở bị bỏ, bản lưu giữ nguyên.
  await answerBox.fill('Chữ gõ dở sẽ bị bỏ')
  await dialog.getByRole('button', { name: 'Huỷ sửa' }).click()
  await expect(dialog.getByTestId('answer-cache-answer')).toContainText('CUỐI-CÙNG-CHỈ-HIỆN-Ở-HỘP')
  const untouched = await withDb(async conn => (await conn.execute('SELECT answer FROM chatbot_answer_cache WHERE cache_key = ?', [KEY]))[0] as Array<{ answer: string }>)
  expect(untouched[0]!.answer).toBe(FULL_ANSWER)

  // Sửa thật: câu trả lời trống bị chặn ngay ở nút Lưu, rồi lưu bản mới.
  await dialog.getByRole('button', { name: 'Sửa' }).click()
  await answerBox.fill('   ')
  await expect(dialog.getByRole('button', { name: 'Lưu câu trả lời' })).toBeDisabled()
  await expect(dialog.getByRole('alert')).toContainText('không được để trống')
  await answerBox.fill(NEW_ANSWER)
  await dialog.getByLabel(/^Câu hỏi gợi ý/).fill('Gợi ý mới A?\nGợi ý mới B?')
  await dialog.getByRole('button', { name: 'Lưu câu trả lời' }).click()

  await expect(page.getByText('Đã lưu câu trả lời.')).toBeVisible()
  await expect(dialog.getByTestId('answer-cache-answer')).toContainText(`Bản đã sửa tay ${stamp}.`)
  await expect(dialog).toContainText('Gợi ý mới B?')
  // Hộp có hai nút "Đóng" (X ở đầu, nút ở chân hộp): bấm nút ở chân.
  await dialog.getByRole('contentinfo').getByRole('button', { name: 'Đóng' }).click()

  // Danh sách tải lại và cho thấy bản mới; CSDL giữ đúng bản mới (đã chuẩn hoá) cùng khoá/loại cũ.
  await expect(page.getByRole('row').filter({ hasText: QUESTION })).toContainText(`Bản đã sửa tay ${stamp}.`)
  const rows = await withDb(async conn => (await conn.execute(
    'SELECT answer, kind, hits, follow_ups FROM chatbot_answer_cache WHERE cache_key = ?', [KEY],
  ))[0] as Array<{ answer: string, kind: string, hits: number, follow_ups: unknown }>)
  expect(rows[0]!.answer).toBe(NEW_ANSWER)
  expect(rows[0]!.kind).toBe('provider')
  expect(rows[0]!.hits).toBe(3)
  const followUps = typeof rows[0]!.follow_ups === 'string' ? JSON.parse(rows[0]!.follow_ups) : rows[0]!.follow_ups
  expect(followUps).toEqual(['Gợi ý mới A?', 'Gợi ý mới B?'])
})
