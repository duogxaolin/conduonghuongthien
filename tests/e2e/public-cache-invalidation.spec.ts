/**
 * Trang công khai đệm `swr: 60` không phát lại nội dung đã gỡ, menu mới hiện ngay, ngày
 * đăng không lệch hydrate — trên bản build thật.
 *
 * Đo trên bản build 1009c36c (trước bản vá, `cdht-wave3-fix-public-cache-proof/evidence/`):
 *  1. xoá / lưu trữ bài qua admin → `/news/<slug>` vẫn 200 đủ nội dung sau 65, 68, 71 giây
 *     (Nitro không ghi đè bản 200 đã đệm bằng 404); chỉ nút "Xoá cache" mới làm nó 404;
 *  2. lưu menu chính → `/` vẫn menu cũ ngay sau đó và ở lượt đầu sau 62 giây;
 *  3. trình duyệt khác múi giờ máy chủ → ngày đăng trong HTML ≠ sau hydrate +
 *     "Hydration completed but contains mismatches.".
 * Test 4 (sửa thẳng CSDL, không qua admin) chờ hết cửa sổ 60 giây: nó canh plugin
 * `public-cache-gone.ts`, lớp duy nhất phủ đường làm trang biến mất mà không gọi purge.
 */
import mysql from 'mysql2/promise'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { E2E_ADMIN_USERNAME, E2E_PASSWORD_ENV, e2eDbConfig } from './harness'

test.describe.configure({ mode: 'serial' })

const stamp = `${Date.now()}`
let connection: mysql.Connection
test.beforeAll(async () => { connection = await mysql.createConnection(e2eDbConfig()) })
test.afterAll(async () => {
  await connection.execute('DELETE FROM articles WHERE title LIKE ?', [`E2EPC${stamp}%`])
  await connection.end()
})

async function login(page: Page) {
  const password = process.env[E2E_PASSWORD_ENV]
  if (!password) throw new Error(`${E2E_PASSWORD_ENV} is not set — globalSetup did not run`)
  await page.goto('/admin/login')
  await page.fill('input[autocomplete="username"]', E2E_ADMIN_USERNAME)
  await page.fill('input[autocomplete="current-password"]', password)
  await page.click('button[type="submit"]')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Xin chào', { timeout: 20_000 })
}

async function createPublished(api: APIRequestContext, label: string) {
  const title = `E2EPC${stamp} ${label}`
  const response = await api.post('/api/admin/articles', { data: { title, type: 'news', content: `<p>${title}</p>`, excerpt: 'tóm tắt', status: 'published' } })
  expect(response.status(), await response.text()).toBe(200)
  const { id, slug } = await response.json() as { id: number, slug: string }
  return { id, slug, title }
}

/** GET the page twice so it is cached (the second answer comes from the cache). */
async function primed(request: APIRequestContext, path: string, needle: string) {
  for (let i = 0; i < 2; i += 1) {
    const response = await request.get(path)
    expect(response.status(), path).toBe(200)
    expect(await response.text()).toContain(needle)
  }
}

test('xoá / lưu trữ / ẩn hàng loạt qua admin → trang bài 404 ngay, không đợi, không cần "Xoá cache"', async ({ page, request }) => {
  await login(page)
  const api = page.request
  const deleted = await createPublished(api, 'bai xoa')
  const archived = await createPublished(api, 'bai luu tru')
  const hidden = await createPublished(api, 'bai an hang loat')
  for (const article of [deleted, archived, hidden]) await primed(request, `/news/${article.slug}`, article.title)

  expect((await api.delete(`/api/admin/articles/${deleted.id}`)).status()).toBe(200)
  expect((await api.put(`/api/admin/articles/${archived.id}`, { data: { status: 'archived' } })).status()).toBe(200)
  const bulk = await api.post('/api/admin/articles/bulk-status', { data: { ids: [hidden.id], status: 'archived' } })
  expect(bulk.status()).toBe(200)

  for (const article of [deleted, archived, hidden]) {
    const response = await request.get(`/news/${article.slug}`)
    expect(response.status(), `${article.title}: còn công khai từ bộ đệm`).toBe(404)
    expect(await response.text()).not.toContain(`<p>${article.title}</p>`)
  }
})

test('lưu menu chính → mục mới có ngay trong trang chủ (HTML và sau hydrate)', async ({ page, request, browser }) => {
  await login(page)
  const api = page.request
  const label = `Mục E2E ${stamp.slice(-6)}`
  await primed(request, '/', 'Điều hướng chính')
  try {
    const saved = await api.put('/api/admin/settings/navigation/navbar', {
      data: { menu: [{ id: 'home', label: 'Trang chủ', url: '/' }, { id: 'about', label: 'Giới thiệu', url: '/about' }, { id: `e2e-${stamp}`, label, url: '/contact' }] },
    })
    expect(saved.status(), await saved.text()).toBe(200)

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const visitor = await context.newPage()
    const response = await visitor.goto('/')
    expect(await response!.text(), 'HTML đầu tiên sau khi lưu vẫn là menu cũ').toContain(label)
    await visitor.waitForLoadState('networkidle')
    await expect(visitor.locator('.desktop-nav').getByText(label)).toBeVisible()
    await context.close()
  } finally {
    // Back to the default menu for the specs that follow (a fresh DB has no row).
    await connection.execute("DELETE FROM settings WHERE `key` = 'nav_menu_navbar'")
    await api.post('/api/admin/cache-clear', { data: { confirm: true } })
  }
})

test('ngày đăng: trình duyệt khác múi giờ máy chủ — HTML và sau hydrate cùng một ngày giờ Việt Nam', async ({ browser }) => {
  const slug = `e2epc-tz-${stamp}`
  // 03:05 UTC = 10:05 02/11 ở Việt Nam = 19:05 01/11 ở Los Angeles. `published_at` là TIMESTAMP
  // và Drizzle đọc nó như UTC, nên chuỗi này là UTC (kiểm ngay dưới đây).
  await connection.execute(
    `INSERT INTO articles (type, title, slug, excerpt, content, status, published_at) VALUES ('news', ?, ?, 'tóm tắt', '<p>x</p>', 'published', '2026-11-02 03:05:00')`,
    [`E2EPC${stamp} mui gio`, slug])
  const context = await browser.newContext({ timezoneId: 'America/Los_Angeles' })
  const visitor = await context.newPage()
  const api = await visitor.request.get(`/api/public/articles/${slug}`)
  expect((await api.json() as { article: { publishedAt: string } }).article.publishedAt).toBe('2026-11-02T03:05:00.000Z')

  const hydration: string[] = []
  visitor.on('console', message => { if (/hydrat/i.test(message.text())) hydration.push(message.text()) })
  const response = await visitor.goto(`/news/${slug}`)
  const ssrDate = /fa-calendar[^<]*<\/i>([^<]*)/.exec(await response!.text())?.[1]?.trim()
  await visitor.waitForLoadState('networkidle')
  const domDate = (await visitor.locator('.fa-calendar').first().locator('xpath=..').innerText()).trim()
  expect(ssrDate).toBe('Ngày đăng: 02/11/2026')
  expect(domDate).toBe('Ngày đăng: 02/11/2026')
  expect(hydration).toEqual([])
  await context.close()
})

test('bài gỡ thẳng trong CSDL (không qua admin): sau cửa sổ 60 giây, lượt dựng lại 404 bỏ bản cũ', async ({ request }) => {
  test.setTimeout(150_000)
  const slug = `e2epc-db-${stamp}`
  const title = `E2EPC${stamp} go trong csdl`
  await connection.execute(
    `INSERT INTO articles (type, title, slug, excerpt, content, status, published_at) VALUES ('news', ?, ?, 'tóm tắt', ?, 'published', DATE_SUB(NOW(), INTERVAL 5 MINUTE))`,
    [title, slug, `<p>${title}</p>`])
  await primed(request, `/news/${slug}`, title)
  await connection.execute('DELETE FROM articles WHERE slug = ?', [slug])

  await new Promise(resolve => setTimeout(resolve, 62_000))
  // First visit after the window: swr answers with the stale copy and re-renders behind it
  // (a 404 now). Before the plugin, that 404 was dropped and the stale 200 stayed forever.
  await request.get(`/news/${slug}`)
  await expect.poll(async () => (await request.get(`/news/${slug}`)).status(), { timeout: 10_000 }).toBe(404)
})
