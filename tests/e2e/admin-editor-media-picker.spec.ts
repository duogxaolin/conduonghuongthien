/**
 * The article editor's TinyMCE image dialog has a browse button that opens the media library
 * (the admin layout's modal, `AdminMediaLibraryModal`) — on the real build, with the real TinyMCE.
 *
 * What only a browser can show: the library opens ABOVE TinyMCE's own modal dialog and can be
 * used (TinyMCE traps focus in its dialog, and the library's `AdminModal` makes the rest of the
 * page `inert`), the choice lands in the dialog's source field, and TinyMCE's dialog is usable
 * again afterwards — inserting puts the image in the body.
 */
import { expect, test, type Page } from '@playwright/test'
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

test('image dialog → browse → library → choose: the source is filled and the image is inserted', async ({ page }) => {
  await login(page)
  // The library lists the uploaded images (its "default images" group only shows when there is at least one).
  const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const uploaded = await page.request.post('/api/admin/media/upload', {
    multipart: { file: { name: `e2e-picker-${Date.now()}.png`, mimeType: 'image/png', buffer: onePixelPng } },
  })
  expect(uploaded.status(), await uploaded.text()).toBe(200)
  const media = ((await uploaded.json()) as { media: { url: string, originalName: string } }).media
  const created = await page.request.post('/api/admin/articles', {
    data: { title: `E2E chọn ảnh từ thư viện ${Date.now()}`, slug: `e2e-chon-anh-${Date.now()}`, type: 'news', content: '<p>Nội dung</p>', excerpt: 'tóm tắt', status: 'draft' },
  })
  expect(created.status(), await created.text()).toBe(200)
  const id = ((await created.json()) as { id: number }).id

  await page.goto(`/admin/content/articles/${id}`)
  await expect(page.locator('.tox-tinymce')).toBeVisible({ timeout: 30_000 })

  // The toolbar slides (the image button sits behind "reveal more" at this width), so open the dialog
  // by the command its button runs.
  await page.evaluate(() => (window as unknown as { tinymce: { get: (id: string) => { execCommand: (name: string) => void } } })
    .tinymce.get('tinymce-content-editor').execCommand('mceImage'))
  const imageDialog = page.locator('.tox-dialog')
  await expect(imageDialog).toBeVisible()
  await imageDialog.locator('.tox-browse-url').click()

  const library = page.getByRole('dialog', { name: 'Thư viện ảnh' })
  await expect(library).toBeVisible()
  // Each tile is a button named by its image: reach it from the keyboard and choose it with Enter.
  const tile = library.getByRole('button', { name: media.originalName, exact: true })
  await tile.focus()
  await page.keyboard.press('Enter')
  await expect(library).toBeHidden()

  // TinyMCE's dialog is still there, usable, and carries the choice.
  await expect(imageDialog).toBeVisible()
  await expect(imageDialog.locator('input.tox-textfield').first()).toHaveValue(media.url)
  await imageDialog.getByRole('button', { name: 'Save' }).click()
  await expect(imageDialog).toBeHidden()

  const html = await page.evaluate(() => (window as unknown as { tinymce: { get: (id: string) => { getContent: () => string } } }).tinymce.get('tinymce-content-editor').getContent())
  expect(html).toContain(media.url)
})
