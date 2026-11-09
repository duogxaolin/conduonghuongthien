/**
 * The article editor's labelled "Toàn màn hình" toggle, on the real build with the real TinyMCE under the real admin
 * layout (`position: fixed` is broken by any ancestor with a transform, and only a browser shows that): it is the first
 * thing on the toolbar and visible without opening "…"; full screen covers the whole viewport (nothing of the admin
 * header or sidebar on top); the media library opens ABOVE it and a real click on a picture works; the toggle follows
 * every way in and out (button, View menu, Ctrl+Shift+F); and leaving the page while full screen does not leave
 * `tox-fullscreen` on `html`/`body` — that would make every admin page unscrollable. The button's own behaviour is
 * tests/tinymce-fullscreen-button.test.ts.
 */
import { expect, test, type Page } from '@playwright/test'
import { E2E_ADMIN_USERNAME, E2E_PASSWORD_ENV } from './harness'

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

/** Is full screen on, as the page itself says: the classes TinyMCE puts on `html` and `body`. */
const fullscreenClasses = (page: Page) => page.evaluate(() => ({
  html: document.documentElement.classList.contains('tox-fullscreen'),
  body: document.body.classList.contains('tox-fullscreen'),
  scrollLock: getComputedStyle(document.documentElement).overflow + '/' + getComputedStyle(document.body).overflow,
}))

test('the labelled toggle is first and always visible; full screen covers the viewport, the library opens above it, every route in and out is followed, and leaving the page cleans up', async ({ page }) => {
  await login(page)
  const created = await page.request.post('/api/admin/articles', {
    data: { title: `E2E toàn màn hình ${Date.now()}`, slug: `e2e-toan-man-hinh-${Date.now()}`, type: 'news', content: '<p>Nội dung</p>', excerpt: 'tóm tắt', status: 'draft' },
  })
  expect(created.status(), await created.text()).toBe(200)
  const id = ((await created.json()) as { id: number }).id
  const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const uploaded = await page.request.post('/api/admin/media/upload', {
    multipart: { file: { name: `e2e-fullscreen-${Date.now()}.png`, mimeType: 'image/png', buffer: onePixelPng } },
  })
  expect(uploaded.status(), await uploaded.text()).toBe(200)
  const media = ((await uploaded.json()) as { media: { url: string, originalName: string } }).media

  await page.goto(`/admin/content/articles/${id}`)
  await expect(page.locator('.tox-tinymce')).toBeVisible({ timeout: 30_000 })

  // 1. First on the toolbar, labelled, visible without opening "…".
  const toggle = page.locator('.tox-toolbar__primary button[aria-label^="Toàn màn hình"]')
  await expect(toggle).toBeVisible()
  await expect(toggle).toContainText('Toàn màn hình')
  await expect(page.locator('.tox-toolbar__primary button').first()).toHaveAttribute('aria-label', /^Toàn màn hình/)
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  const normal = await fullscreenClasses(page)
  expect(normal).toMatchObject({ html: false, body: false })

  // 2. The button: the editor covers the whole viewport, and nothing of the admin layout is on top of it.
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  const covers = async () => {
    const viewport = page.viewportSize()!
    const box = (await page.locator('.tox-tinymce').boundingBox())!
    expect([Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)], 'the editor box is the viewport').toEqual([0, 0, viewport.width, viewport.height])
    const onTop = await page.evaluate(({ w, h }) => [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3], [Math.floor(w / 2), Math.floor(h / 2)]]
      .map(([x, y]) => !!document.elementFromPoint(x!, y!)?.closest('.tox-tinymce')), { w: viewport.width, h: viewport.height })
    expect(onTop, 'at the four corners and the centre the editor, not the admin header or sidebar, is on top').toEqual([true, true, true, true, true])
  }
  await covers()
  const inFullscreen = await fullscreenClasses(page)
  expect(inFullscreen).toMatchObject({ html: true, body: true })

  // 3. The media library opens ABOVE the full-screen editor and a real click (not focus + Enter) reaches a picture.
  const library = page.getByRole('dialog', { name: 'Thư viện ảnh' })
  await page.getByRole('menuitem', { name: 'Insert' }).click()
  await page.getByRole('menuitem', { name: /Chèn ảnh từ thư viện/ }).click()
  await expect(library).toBeVisible()
  await library.getByRole('button', { name: media.originalName, exact: true }).click()
  await expect(library).toBeHidden()
  expect(await page.evaluate<string>(`${tiny}.getContent()`)).toContain('<figure')
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await covers()
  expect((await fullscreenClasses(page)).scrollLock, 'closing the library did not undo the page scroll lock').toBe(inFullscreen.scrollLock)

  // 4. Out through the View menu; the toggle follows. In again with the keyboard; out with the button.
  await page.getByRole('menuitem', { name: 'View' }).click()
  await page.getByRole('menuitemcheckbox', { name: /Fullscreen/ }).or(page.getByRole('menuitem', { name: /Fullscreen/ })).first().click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  expect(await fullscreenClasses(page)).toMatchObject({ html: false, body: false, scrollLock: normal.scrollLock })
  await page.frameLocator('iframe.tox-edit-area__iframe').locator('body').click()
  await page.keyboard.press('Control+Shift+F')
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await covers()
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  expect(await fullscreenClasses(page)).toMatchObject({ html: false, body: false, scrollLock: normal.scrollLock })

  // 5. Leaving the page while full screen must not leave the lock on `html`/`body`.
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  // The editor holds an unsaved image: the route-leave guard asks first; leave anyway.
  await page.evaluate(`void document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$router.push('/admin')`)
  // The guard asks (the inserted picture is unsaved): that it asks is part of the check, then leave anyway.
  await expect(page.getByText('Bài viết có thay đổi chưa lưu')).toBeVisible()
  await page.getByRole('button', { name: 'Rời trang', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/?$/, { timeout: 10_000 })
  await expect(page.locator('.tox-tinymce')).toHaveCount(0)
  expect(await fullscreenClasses(page), 'no full-screen lock left behind on the next admin page').toMatchObject({ html: false, body: false, scrollLock: normal.scrollLock })
})
