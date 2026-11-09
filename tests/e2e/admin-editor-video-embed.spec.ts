/**
 * Putting a video of the video library into an article, on the real build with the real TinyMCE:
 *
 *  1. the toolbar's "video from the library" button opens the video library (above the editor), a
 *     choice inserts the portal's own player frame — a RELATIVE `src` TinyMCE leaves alone — and saving
 *     keeps it (the HTML filter allows exactly that path);
 *  2. the public API hands the saved frame back (the read path filters too);
 *  3. the frame's page, `/media/embed/<short_id>`, is a bare player page: one `<h1>`, the player of the
 *     item, `noindex`; an unknown id says "not found" instead of breaking.
 *
 * An uploaded item cannot be made for real here (no transcode), so a published YouTube item is turned
 * into a processed upload with a parameterised UPDATE — the library and the filter only read its row.
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

/** A published external video; `asUpload` makes it a processed upload of the portal. */
async function publishedVideo(page: Page, title: string, asUpload: boolean) {
  const created = await page.request.post('/api/admin/media-portal/external', {
    data: { title, youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
  })
  expect(created.status(), await created.text()).toBe(201)
  const { id, shortId } = (await created.json()) as { id: number, shortId: string }
  const published = await page.request.put(`/api/admin/media-portal/${id}`, { data: { status: 'published' } })
  expect(published.status(), await published.text()).toBe(200)
  if (asUpload) {
    const connection = await mysql.createConnection(e2eDbConfig())
    try {
      await connection.execute(
        `UPDATE media_items SET source = 'upload', youtube_video_id = NULL, processing_status = 'ready' WHERE id = ?`, [id],
      )
    } finally {
      await connection.end()
    }
  }
  return { id, shortId }
}

test('toolbar button → video library → choose: the player frame is inserted, saved, and read back', async ({ page }) => {
  await login(page)
  const title = `E2E video từ kho ${Date.now()}`
  const { shortId } = await publishedVideo(page, title, true)
  const stamp = Date.now()
  const created = await page.request.post('/api/admin/articles', {
    data: { title: `E2E chèn video ${stamp}`, slug: `e2e-chen-video-${stamp}`, type: 'news', content: '<p>Mở đầu</p>', excerpt: 'tóm tắt', status: 'published' },
  })
  expect(created.status(), await created.text()).toBe(200)
  const id = ((await created.json()) as { id: number }).id

  await page.goto(`/admin/content/articles/${id}`)
  await expect(page.locator('.tox-tinymce')).toBeVisible({ timeout: 30_000 })

  const button = page.locator('.tox-tinymce').getByRole('button', { name: 'Chèn video từ kho video' })
  if (!(await button.isVisible())) await page.getByRole('button', { name: /reveal or hide additional toolbar items/i }).click()
  await button.click()

  const library = page.getByRole('dialog', { name: 'Chèn video từ kho video' })
  await expect(library).toBeVisible()
  await library.getByRole('button', { name: new RegExp(title) }).click()
  await expect(library).toBeHidden()

  // In the editor the frame is the column wide and 16:9 like the public page — not the browser's 150-px default (CHANGELOG § 106).
  const frame = await page.evaluate(() => {
    const ed = (window as unknown as { tinymce: { get: (id: string) => { getBody: () => HTMLElement } } }).tinymce.get('tinymce-content-editor')
    const body = ed.getBody()
    const iframe = body.querySelector('iframe')!.getBoundingClientRect()
    const style = getComputedStyle(body)
    return { width: iframe.width, height: iframe.height, inner: body.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) }
  })
  expect(Math.abs(frame.width - frame.inner), `the frame fills the column: ${frame.width} of ${frame.inner}`).toBeLessThanOrEqual(4)
  expect(Math.abs(frame.height - frame.width * 9 / 16), `16:9: ${frame.width} x ${frame.height}`).toBeLessThanOrEqual(3)

  const html = await page.evaluate(() => (window as unknown as { tinymce: { get: (id: string) => { getContent: () => string } } }).tinymce.get('tinymce-content-editor').getContent())
  // TinyMCE makes the frame's `src` absolute on insertion (`http://<host>/media/embed/…`); the HTML filter
  // writes it back as the bare path, so the stored and the public HTML carry the relative one.
  expect(html).toMatch(new RegExp(`<iframe[^>]* src="[^"]*/media/embed/${shortId}"`))
  expect(html).toContain(`title="${title}"`)
  const bareFrame = new RegExp(`<iframe[^>]* src="/media/embed/${shortId}"`)

  await page.getByRole('button', { name: /Cập Nhật Bài Viết/ }).click()
  await expect.poll(async () => {
    const stored = (await (await page.request.get(`/api/admin/articles/${id}`)).json()) as { article?: { content?: string }, content?: string }
    return stored.article?.content ?? stored.content ?? ''
  }, { timeout: 15_000 }).toMatch(bareFrame)

  // The server appends a suffix to the slug it was given; read the real one back.
  const slug = ((await (await page.request.get(`/api/admin/articles/${id}`)).json()) as { article: { slug: string } }).article.slug
  const publicRead = (await (await page.request.get(`/api/public/articles/${slug}`)).json()) as { article?: { content?: string }, content?: string }
  expect(publicRead.article?.content ?? publicRead.content ?? '').toMatch(bareFrame)
})

test('the player page: one <h1>, the item\'s player, noindex; an unknown id says "not found"', async ({ page }) => {
  await login(page)
  const { shortId } = await publishedVideo(page, `E2E khung phát ${Date.now()}`, false)

  const response = await page.goto(`/media/embed/${shortId}`, { waitUntil: 'networkidle' })
  expect(response!.status()).toBe(200)
  await expect(page.locator('h1')).toHaveCount(1)
  await expect(page.locator('iframe[src*="youtube-nocookie.com/embed/dQw4w9WgXcQ"]')).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex')
  // A bare page: no site header, no footer.
  await expect(page.locator('header, footer')).toHaveCount(0)

  await page.goto('/media/embed/zzzzzzzzzzz', { waitUntil: 'networkidle' })
  await expect(page.locator('h1')).toHaveCount(1)
  await expect(page.getByText('Video không tồn tại hoặc chưa được đăng.')).toBeVisible()
})
