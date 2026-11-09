/**
 * "Lưu" inside full screen, and the same toolbar in the other two rich-text hosts (CHANGELOG § 106), on the real build
 * with the real TinyMCE under the real admin layout:
 *  - the shortened "Phóng to" label: at ~1280 and ~1366 px with the sidebar open, what the first toolbar row still shows;
 *  - the article editor: "Lưu" exists only in full screen, saves from there (PUT / POST) and stays in full screen; a new
 *    article's save leaves the page, and must not leave `tox-fullscreen` on `html`/`body` (no admin page would scroll);
 *  - the translation panel's editor: full screen covers the viewport, "Lưu" saves the translation, the drawer closes
 *    while full screen and the lock is gone;
 *  - the Page Builder's rich-text field, narrow and "Mở rộng": full screen covers the viewport; it has no "Lưu"
 *    (it autosaves its draft).
 * The helpers' own behaviour is tests/tinymce-fullscreen-button.test.ts, tests/tinymce-compact-toolbar.test.ts.
 */
import { expect, test, type Page } from '@playwright/test'
import mysql from 'mysql2/promise'
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

const lock = (page: Page) => page.evaluate(() => ({
  html: document.documentElement.classList.contains('tox-fullscreen'),
  body: document.body.classList.contains('tox-fullscreen'),
}))

/** The editor box is the viewport, and at the corners and the centre the editor — not the admin header/sidebar — is on top. */
async function expectCovers(page: Page, editor = page.locator('.tox-tinymce.tox-fullscreen')) {
  const viewport = page.viewportSize()!
  const box = (await editor.boundingBox())!
  expect([Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)], 'the editor box is the viewport').toEqual([0, 0, viewport.width, viewport.height])
  const onTop = await page.evaluate(({ w, h }) => [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3], [Math.floor(w / 2), Math.floor(h / 2)]]
    .map(([x, y]) => !!document.elementFromPoint(x!, y!)?.closest('.tox-tinymce')), { w: viewport.width, h: viewport.height })
  expect(onTop).toEqual([true, true, true, true, true])
}

const toolbarButtons = (page: Page) => page.locator('.tox-toolbar__primary .tox-tbtn')
const visibleLabels = async (page: Page) => (await toolbarButtons(page).evaluateAll(buttons => buttons
  .filter(button => (button as HTMLElement).getBoundingClientRect().width > 0)
  .map(button => button.getAttribute('aria-label') ?? ''))) as string[]

async function newArticle(page: Page, content = '<p>Nội dung</p>') {
  const stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`
  const created = await page.request.post('/api/admin/articles', {
    data: { title: `E2E lưu toàn màn hình ${stamp}`, slug: `e2e-luu-tmh-${stamp}`, type: 'news', content, excerpt: 'tóm tắt', status: 'draft' },
  })
  expect(created.status(), await created.text()).toBe(200)
  return { id: ((await created.json()) as { id: number }).id, title: `E2E lưu toàn màn hình ${stamp}` }
}

for (const width of [1280, 1366]) {
  test(`the first toolbar row at ${width}px with the sidebar open: the short label leaves the toggle first and "Lưu" out of the way`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await login(page)
    const { id } = await newArticle(page)
    await page.goto(`/admin/content/articles/${id}`)
    await expect(page.locator('.tox-tinymce')).toBeVisible({ timeout: 30_000 })
    const labels = await visibleLabels(page)
    console.log(`MEASURED ${width}px first row:`, JSON.stringify(labels))
    expect(labels[0]).toMatch(/^Phóng to/)
    expect(labels.some(label => label.startsWith('Lưu ngay')), '"Lưu" takes no room outside full screen').toBe(false)
    const toggle = (await toolbarButtons(page).first().boundingBox())!
    console.log(`MEASURED ${width}px toggle width:`, Math.round(toggle.width))
    for (const name of ['Bold', 'Italic', 'Underline', 'Strikethrough']) expect(labels, `${name} is on the first row at ${width}px`).toContain(name)
  })
}

test('article editor: "Lưu" shows only in full screen, saves from there with PUT, and stays in full screen', async ({ page }) => {
  await login(page)
  const { id } = await newArticle(page)
  await page.goto(`/admin/content/articles/${id}`)
  await expect(page.locator('.tox-tinymce')).toBeVisible({ timeout: 30_000 })
  const save = page.locator('.tox-toolbar__primary button[aria-label^="Lưu ngay"]')
  await expect(save).toBeHidden()
  const toggle = page.locator('.tox-toolbar__primary button[aria-label^="Phóng to"]')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(save).toBeVisible()
  await expectCovers(page)
  await page.frameLocator('iframe.tox-edit-area__iframe').locator('body').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' thêm từ toàn màn hình')
  const put = page.waitForResponse(r => r.request().method() === 'PUT' && new URL(r.url()).pathname === `/api/admin/articles/${id}`)
  await save.click()
  const response = await put
  expect(response.status()).toBe(200)
  expect(response.request().postDataJSON().content, 'the text typed a moment ago is in the saved body').toContain('thêm từ toàn màn hình')
  await expect(page.getByText('Đã cập nhật bài viết thành công!')).toBeVisible()
  // The body changed, so the save asks about re-translating: that box (z 9000) opens ABOVE the full-screen editor.
  const prompt = page.getByRole('dialog', { name: 'Phát hiện nội dung Tiếng Việt vừa thay đổi!' })
  await expect(prompt).toBeVisible({ timeout: 15_000 })
  await page.keyboard.press('Escape')
  await expect(prompt).toHaveCount(0)
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  expect(await lock(page), 'a save does not leave full screen').toEqual({ html: true, body: true })

  // Two clicks in the same instant are ONE write: the page's save is not re-entered while it runs.
  let writes = 0
  page.on('request', request => { if (request.method() === 'PUT' && new URL(request.url()).pathname === `/api/admin/articles/${id}`) writes++ })
  await save.evaluate((button) => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click() })
  await expect.poll(() => writes).toBeGreaterThan(0)
  await page.waitForTimeout(500)
  expect(writes, 'a double click is one PUT').toBe(1)
  await page.keyboard.press('Escape')
  await toggle.click()
  await expect(save).toBeHidden()
  expect(await lock(page)).toEqual({ html: false, body: false })
})

test('article editor, new article: "Lưu" in full screen creates it, leaves the page, and leaves no full-screen lock behind', async ({ page }) => {
  await login(page)
  await page.goto('/admin/content/articles/new')
  await expect(page.locator('.tox-tinymce')).toBeVisible({ timeout: 30_000 })
  const title = `E2E bài mới tmh ${Date.now()}`
  await page.getByPlaceholder('Nhập tiêu đề hấp dẫn...').fill(title)
  await page.locator('.tox-toolbar__primary button[aria-label^="Phóng to"]').click()
  const post = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/admin/articles')
  await page.locator('.tox-toolbar__primary button[aria-label^="Lưu ngay"]').click()
  expect((await post).status()).toBe(200)
  await expect(page).toHaveURL(/\/admin\/content\/articles\/\d+$/, { timeout: 15_000 })
  await expect(page.locator('.tox-tinymce')).toBeVisible({ timeout: 30_000 })
  expect(await lock(page), 'the old editor was destroyed in full screen: its lock must be gone').toEqual({ html: false, body: false })
  await expect(page.locator('.tox-tinymce.tox-fullscreen')).toHaveCount(0)
})

test('translation panel: full screen covers the viewport, "Lưu" saves the translation, the drawer closes, nothing stays locked', async ({ page }) => {
  await login(page)
  const { id } = await newArticle(page)
  const connection = await mysql.createConnection(e2eDbConfig())
  try {
    await connection.query(
      "INSERT INTO article_translations (article_id, lang_code, title, excerpt, content, status, translated_by) VALUES (?, 'en', 'E2E EN title', 'E2E', '<p>E2E body</p>', 'reviewed', 'ai')", [id])
  } finally {
    await connection.end()
  }
  await page.goto(`/admin/content/articles/${id}`)
  await expect(page.locator('.tox-tinymce')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: /Sửa$/ }).first().click()
  await expect(page.locator('.tox-tinymce')).toHaveCount(2, { timeout: 15_000 })
  const editor = page.locator('.tox-tinymce').nth(1)
  const toggle = editor.locator('button[aria-label^="Phóng to"]')
  const save = editor.locator('button[aria-label^="Lưu ngay"]')
  await expect(save).toBeHidden()
  await toggle.click()
  await expect(save).toBeVisible()
  await expectCovers(page, page.locator('.tox-tinymce.tox-fullscreen'))
  await page.frameLocator('.tox-tinymce.tox-fullscreen iframe.tox-edit-area__iframe').locator('body').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' dịch sửa trong toàn màn hình')
  const put = page.waitForResponse(r => r.request().method() === 'PUT' && new URL(r.url()).pathname === `/api/admin/articles/${id}/translations/en`)
  await save.click()
  const response = await put
  expect(response.status()).toBe(200)
  expect(response.request().postDataJSON().content).toContain('dịch sửa trong toàn màn hình')
  await expect(page.getByText('Đã lưu bản dịch.')).toBeVisible()
  await expect(page.locator('.tox-tinymce')).toHaveCount(1)
  expect(await lock(page), 'the drawer\'s editor was removed in full screen: no lock left').toEqual({ html: false, body: false })
})

test('Page Builder rich-text field: full screen covers the viewport narrow and expanded; there is no "Lưu" (it autosaves)', async ({ page }) => {
  await login(page)
  const stamp = Date.now()
  const created = await page.request.post('/api/admin/pages', { data: { title: `E2E builder tmh ${stamp}`, slug: `e2e-builder-tmh-${stamp}` } })
  expect(created.status(), await created.text()).toBe(200)
  const pageId = ((await created.json()) as { id: number }).id
  const draft = await page.request.put(`/api/admin/pages/${pageId}/draft`, { data: { blocks: [{ blockType: 'richtext', data: { html: '<p>Khối E2E</p>' } }] } })
  expect(draft.status(), await draft.text()).toBe(200)
  await page.goto(`/admin/content/pages/${pageId}`)
  await expect(page.locator('.tox-tinymce')).toBeVisible({ timeout: 30_000 })
  const toggle = () => page.locator('.tox-toolbar__primary button[aria-label^="Phóng to"]')
  await expect(page.locator('.tox-toolbar__primary button[aria-label^="Lưu ngay"]')).toHaveCount(0)

  for (const mode of ['narrow', 'expanded']) {
    if (mode === 'expanded') {
      await page.getByTitle('Mở rộng để dễ sửa').click()
      await expect(page.locator('.tox-tinymce')).toBeVisible({ timeout: 15_000 })
    }
    await toggle().click()
    await expect(toggle()).toHaveAttribute('aria-pressed', 'true')
    await expectCovers(page)
    await toggle().click()
    await expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    expect(await lock(page), `${mode}: out of full screen the lock is gone`).toEqual({ html: false, body: false })
  }
})
