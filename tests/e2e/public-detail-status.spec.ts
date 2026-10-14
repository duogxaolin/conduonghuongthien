/**
 * Trang chi tiết bài + tuyến hai đoạn `/<thể loại>/<X>` — mã trạng thái và nhánh lỗi.
 *
 * Lỗi đã gặp (đo trên bản build trước bản vá):
 *  1. `/<thể loại>/<X>` (`app/pages/[slug].vue`): lượt kiểm chuyên mục HỎNG (503) bị
 *     hiểu là "không phải chuyên mục" → trang rơi sang ArticleDetail, hiện "Không thể
 *     tải nội dung" như thể bài hỏng (cùng lỗi F6 đã sửa cho `/news/<chuyên mục>`).
 *  2. ArticleDetail: API trả 404 cho bài không có, nhưng trang hiện nhánh "không tải
 *     được" (role="alert", nút thử lại) và HTTP **200** — một đường dẫn chết trông như
 *     sự cố tạm thời, và được đệm như một trang đúng. Nay: 404 + "Không tìm thấy".
 *
 * Phía SSR của nhánh HỎNG (503 + no-store khi CSDL sập) không dựng được ở đây — CSDL
 * dùng chung của cả bộ phải sống; nó được kiểm bằng test thuần
 * (`tests/public-detail-ssr-status.test.ts`) và dò tay trên bản build không CSDL (công
 * thức ở đầu `tests/error-no-store.test.ts`). Ở đây lỗi được dựng DETERMINISTIC bằng
 * chặn mạng phía trình duyệt trên một lượt điều hướng client.
 */
import mysql from 'mysql2/promise'
import { expect, test, type Page, type Route } from '@playwright/test'
import { e2eDbConfig } from './harness'

const stamp = `${Date.now()}`
const tag = `E2EDS${stamp}`
/** `articles.type` là varchar(32) — slug thể loại tự tạo phải ngắn. */
const CT_SLUG = `e2eds${stamp.slice(-8)}`
const CT_CAT = `${tag.toLowerCase()}-chuyenmuc`
const CAT_ARTICLE = `${tag.toLowerCase()}-bai-trong-muc`
const LOOSE_ARTICLE = `${tag.toLowerCase()}-bai-le`
const ROLE_ARTICLE = `${tag.toLowerCase()}-guong`
const MISSING = `khong-co-bai-${stamp}`

let connection: mysql.Connection

test.beforeAll(async () => {
  connection = await mysql.createConnection(e2eDbConfig())
  await connection.execute(
    `INSERT INTO content_types (name, slug, icon, description, display_order) VALUES (?, ?, 'fa-solid fa-folder', NULL, 995)`,
    [`${tag} Thể loại`, CT_SLUG])
  const [cat] = await connection.execute<mysql.ResultSetHeader>(
    `INSERT INTO categories (name, slug, type, display_order) VALUES (?, ?, ?, 995)`, [`${tag} Chuyên mục`, CT_CAT, CT_SLUG])
  const insert = (type: string, slug: string, title: string, categoryId: number | null) => connection.execute(
    `INSERT INTO articles (type, category_id, title, slug, excerpt, content, status, published_at)
     VALUES (?, ?, ?, ?, 'Trích đoạn', '<p>Nội dung</p>', 'published', DATE_SUB(NOW(), INTERVAL 5 MINUTE))`,
    [type, categoryId, title, slug])
  await insert(CT_SLUG, CAT_ARTICLE, `${tag} Bài trong chuyên mục`, cat.insertId)
  await insert(CT_SLUG, LOOSE_ARTICLE, `${tag} Bài lẻ`, null)
  await insert('role_model', ROLE_ARTICLE, `${tag} Tấm gương`, null)
})

test.afterAll(async () => {
  await connection.execute('DELETE FROM articles WHERE title LIKE ?', [`${tag} %`])
  await connection.execute('DELETE FROM categories WHERE slug = ?', [CT_CAT])
  await connection.execute('DELETE FROM content_types WHERE slug = ?', [CT_SLUG])
  await connection.end()
})

const LOADING_TEXT = 'Đang tải...'
async function openHydrated(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByText(LOADING_TEXT, { exact: true })).toHaveCount(0, { timeout: 20_000 })
  await page.waitForLoadState('networkidle')
}

/** ĐÚNG lượt đọc chi tiết bài — không bắt `/related`, `/view` (glob sẽ bắt cả hai). */
const articleDetailRequest = (slug: string) => (url: URL) => url.pathname === `/api/public/articles/${slug}`

const fulfill503 = (route: Route) => route.fulfill({
  status: 503,
  contentType: 'application/json',
  headers: { 'cache-control': 'no-store' },
  body: JSON.stringify({ ok: false, items: [] }),
})

// ─── 1. `/<thể loại>/<X>`: lượt kiểm chuyên mục hỏng ─────────────────────────

test('/<thể loại>/<chuyên mục>: lượt kiểm chuyên mục hỏng → báo lỗi + Thử lại (không rơi sang trang bài)', async ({ page }) => {
  await openHydrated(page, `/${CT_SLUG}?e2e=catfail${stamp}`)
  const categories = '**/api/public/categories**'
  await page.route(categories, fulfill503)
  await page.getByRole('button', { name: `${tag} Chuyên mục` }).first().click()
  await expect(page).toHaveURL(new RegExp(`/${CT_SLUG}/${CT_CAT}$`))

  const alert = page.locator('#main-content [role="alert"]', { hasText: 'Không thể tải trang' })
  await expect(alert).toBeVisible()
  // Không có nhánh ArticleDetail ("Không thể tải nội dung" / "Không tìm thấy").
  await expect(page.locator('#main-content [role="alert"]', { hasText: 'Không thể tải nội dung' })).toHaveCount(0)
  await expect(page.locator('#main-content article', { hasText: `${tag} Bài trong chuyên mục` })).toHaveCount(0)

  await page.unroute(categories)
  await alert.getByRole('button', { name: /thử lại/i }).click()
  await expect(page.locator('#main-content article', { hasText: `${tag} Bài trong chuyên mục` }).first()).toBeVisible()
  await expect(alert).toHaveCount(0)
})

test('/<thể loại>/<X> khi CSDL khoẻ: chuyên mục thật và bài thật vẫn 200, không có nhánh lỗi', async ({ request }) => {
  const category = await request.get(`/${CT_SLUG}/${CT_CAT}?e2e=ok${stamp}`)
  expect(category.status()).toBe(200)
  const categoryHtml = await category.text()
  expect(categoryHtml).toContain(`${tag} Bài trong chuyên mục`)
  expect(categoryHtml).not.toContain('role="alert"')

  const article = await request.get(`/${CT_SLUG}/${LOOSE_ARTICLE}?e2e=ok${stamp}`)
  expect(article.status()).toBe(200)
  const articleHtml = await article.text()
  expect(articleHtml).toContain(`${tag} Bài lẻ`)
  expect(articleHtml).not.toContain('role="alert"')
})

// ─── 2. ArticleDetail: 404 thật là 404; hỏng thì báo lỗi + thử lại ───────────

test('bài không tồn tại → HTTP 404 + "Không tìm thấy", không phải nhánh lỗi tải', async ({ request }) => {
  for (const path of [`/role-models/${MISSING}`, `/reintegration-models/${MISSING}`, `/news/${MISSING}`, `/${CT_SLUG}/${MISSING}`]) {
    const response = await request.get(`${path}?e2e=miss${stamp}`)
    expect(response.status(), path).toBe(404)
    const html = await response.text()
    expect(html, path).not.toContain('role="alert"')
    expect(html, path).toMatch(/Không tìm thấy (tin tức|câu chuyện|mô hình) yêu cầu/)
  }
  const real = await request.get(`/role-models/${ROLE_ARTICLE}?e2e=ok${stamp}`)
  expect(real.status()).toBe(200)
  expect(await real.text()).toContain(`${tag} Tấm gương`)
})

test('ArticleDetail: lượt đọc bài hỏng (503) → báo lỗi + Thử lại đọc lại đúng bài', async ({ page }) => {
  await openHydrated(page, `/${CT_SLUG}?e2e=artfail${stamp}`)
  const isDetail = articleDetailRequest(LOOSE_ARTICLE)
  await page.route(isDetail, fulfill503)
  await page.locator(`#main-content a[href="/${CT_SLUG}/${LOOSE_ARTICLE}"]`).first().click()
  await expect(page).toHaveURL(new RegExp(`/${CT_SLUG}/${LOOSE_ARTICLE}$`))

  const alert = page.locator('#main-content [role="alert"]', { hasText: 'Không thể tải nội dung' })
  await expect(alert).toBeVisible()
  await expect(page.getByText('Không tìm thấy tin tức yêu cầu')).toHaveCount(0)

  await page.unroute(isDetail)
  await alert.getByRole('button', { name: /thử lại/i }).click()
  await expect(page.getByRole('heading', { level: 1, name: `${tag} Bài lẻ` })).toBeVisible()
  await expect(alert).toHaveCount(0)
})

test('ArticleDetail: API trả 404 khi điều hướng client → "Không tìm thấy", không có nút thử lại', async ({ page }) => {
  await openHydrated(page, `/${CT_SLUG}?e2e=art404${stamp}`)
  const isDetail = articleDetailRequest(LOOSE_ARTICLE)
  await page.route(isDetail, route => route.fulfill({
    status: 404,
    contentType: 'application/json',
    body: JSON.stringify({ statusCode: 404, message: 'Bài viết không tồn tại hoặc chưa xuất bản.' }),
  }))
  await page.locator(`#main-content a[href="/${CT_SLUG}/${LOOSE_ARTICLE}"]`).first().click()
  await expect(page).toHaveURL(new RegExp(`/${CT_SLUG}/${LOOSE_ARTICLE}$`))
  await expect(page.getByText('Không tìm thấy tin tức yêu cầu')).toBeVisible()
  await expect(page.locator('#main-content [role="alert"]', { hasText: 'Không thể tải nội dung' })).toHaveCount(0)
  await page.unroute(isDetail)
})
