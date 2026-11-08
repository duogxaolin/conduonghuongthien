/**
 * The article editor's image entries, on the real build with the real TinyMCE: every "insert an image" entry
 * (Insert menu, the bar that floats in an empty paragraph) opens the media library at once — not TinyMCE's image
 * dialog asking for a URL, not the OS file chooser — and the image goes in as a full-width picture. A selected image
 * shows a labelled "Sửa ảnh" that opens the image dialog. The behaviour of the buttons themselves is
 * tests/tinymce-image-library-buttons.test.ts; this is what only a browser can show (menu, quick bars, the library
 * above the editor).
 */
import { expect, test, type Page } from '@playwright/test'
import { E2E_ADMIN_USERNAME, E2E_PASSWORD_ENV } from './harness'

/** The editor, as an expression evaluated in the page (no TypeScript syntax: it runs in the browser as written). */
const tiny = 'window.tinymce.get("tinymce-content-editor")'

async function login(page: Page) {
  const password = process.env[E2E_PASSWORD_ENV]
  if (!password) throw new Error(`${E2E_PASSWORD_ENV} is not set — globalSetup did not run`)
  await page.goto('/admin/login')
  await page.fill('input[autocomplete="username"]', E2E_ADMIN_USERNAME)
  await page.fill('input[autocomplete="current-password"]', password)
  await page.click('button[type="submit"]')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Xin chào', { timeout: 20_000 })
}

test('image entries open the library, insert a full-width image, and "Sửa ảnh" edits the selected one', async ({ page }) => {
  await login(page)
  const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const uploaded = await page.request.post('/api/admin/media/upload', {
    multipart: { file: { name: `e2e-image-buttons-${Date.now()}.png`, mimeType: 'image/png', buffer: onePixelPng } },
  })
  expect(uploaded.status(), await uploaded.text()).toBe(200)
  const media = ((await uploaded.json()) as { media: { url: string, originalName: string } }).media
  const created = await page.request.post('/api/admin/articles', {
    data: { title: `E2E nút ảnh ${Date.now()}`, slug: `e2e-nut-anh-${Date.now()}`, type: 'news', content: '<p>Nội dung</p>', excerpt: 'tóm tắt', status: 'draft' },
  })
  expect(created.status(), await created.text()).toBe(200)
  const id = ((await created.json()) as { id: number }).id

  await page.goto(`/admin/content/articles/${id}`)
  await expect(page.locator('.tox-tinymce')).toBeVisible({ timeout: 30_000 })
  const library = page.getByRole('dialog', { name: 'Thư viện ảnh' })
  const tinyDialog = page.locator('.tox-dialog')
  const frame = page.frameLocator('iframe.tox-edit-area__iframe')

  // An empty paragraph: its floating bar offers the library, not TinyMCE's own "image" (an OS file chooser).
  await page.evaluate(`${tiny}.setContent('<p><br></p>')`)
  await page.evaluate(`${tiny}.focus()`)
  await frame.locator('body p').first().click()
  const insertBar = page.locator('.tox-pop')
  await expect(insertBar.getByRole('button', { name: 'Chèn ảnh từ thư viện' })).toBeVisible()
  await expect(insertBar.getByRole('button', { name: /^(Insert image|Image)/ })).toHaveCount(0)

  // The Insert menu: the library opens at once, TinyMCE's image dialog does not.
  await page.getByRole('menuitem', { name: 'Insert' }).click()
  await page.getByRole('menuitem', { name: /Chèn ảnh từ thư viện/ }).click()
  await expect(library).toBeVisible()
  await expect(tinyDialog).toHaveCount(0)
  const tile = library.getByRole('button', { name: media.originalName, exact: true })
  await tile.focus()
  await page.keyboard.press('Enter')
  await expect(library).toBeHidden()

  const html = await page.evaluate<string>(`${tiny}.getContent()`)
  expect(html).toContain(media.url)
  expect(html).toMatch(/<img [^>]*style="width: 100%; height: auto;"/)

  // A selected image: the bar over it says what to click, and it opens the image dialog on that image.
  await page.evaluate(`(() => { const ed = ${tiny}; ed.selection.select(ed.getBody().querySelector('img')); ed.nodeChanged() })()`)
  const imageBar = page.locator('.tox-pop')
  const edit = imageBar.getByRole('button', { name: /Sửa ảnh/ })
  await expect(edit).toBeVisible()
  await expect(edit).toContainText('Sửa ảnh')
  await edit.click()
  await expect(tinyDialog).toBeVisible()
  await expect(tinyDialog.locator('input.tox-textfield').nth(2)).toHaveValue('100%')
  await tinyDialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(tinyDialog).toBeHidden()

  // With the caret in text the toolbar's "Sửa ảnh" is greyed (the toolbar may be folded at this width: read the DOM).
  await page.evaluate(`(() => { const ed = ${tiny}; ed.selection.select(ed.getBody().querySelector('p')); ed.nodeChanged() })()`)
  await expect.poll(() => page.evaluate(() => document.querySelector('button[aria-label^="Sửa ảnh"]')?.getAttribute('aria-disabled'))).toBe('true')
})
