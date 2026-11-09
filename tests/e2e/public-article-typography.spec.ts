/**
 * The public article body on the real build (CHANGELOG § 107). Old articles are pasted-in HTML: plain `<img>` at their own
 * size and text wrapped in `<span style="font-family: arial; font-size: 14px">`, which beat every class rule and made the
 * whole article small grey Arial with the pictures pushed to the left. The portal now shows ONE font (Inter) at ONE size
 * in the dark `ink` colour, whatever the stored `style` says, and puts a picture narrower than the column in the middle.
 * Colour, bold, italic and alignment of the stored HTML are kept.
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

test('an old article: one font, one size, dark text, a small picture in the middle of the column — authored colour and alignment kept', async ({ page }) => {
  await login(page)
  const uploaded = await page.request.post('/api/admin/media/upload', {
    multipart: { file: { name: `e2e-typo-${Date.now()}.png`, mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') } },
  })
  expect(uploaded.status(), await uploaded.text()).toBe(200)
  const url = ((await uploaded.json()) as { media: { url: string } }).media.url
  const stamp = Date.now()
  const content = `<p><img alt src="${url}" width="300" height="200" style="width: 300px; height: 200px;"></p>`
    + '<p style="text-align: justify;"><span style="font-size:14px;"><span style="font-family:arial,helvetica,sans-serif;">Đoạn cũ kiểu Word.</span></span></p>'
    + '<p><span style="font-family: arial, helvetica, sans-serif; font-size: 14px; color: #c0392b;"><strong>Đoạn đỏ đậm.</strong></span></p>'
  const created = await page.request.post('/api/admin/articles', {
    data: { title: `E2E kiểu chữ ${stamp}`, slug: `e2e-kieu-chu-${stamp}`, type: 'news', content, excerpt: 'tóm tắt', status: 'published' },
  })
  expect(created.status(), await created.text()).toBe(200)
  const { slug } = (await created.json()) as { slug: string }

  await page.goto(`/news/${slug}`)
  const body = page.locator('.article-body').first()
  await expect(body.locator('p', { hasText: 'Đoạn cũ kiểu Word.' })).toBeVisible()
  const read = (text: string) => body.locator('p', { hasText: text }).evaluate((paragraph) => {
    const inner = paragraph.querySelector('span span') ?? paragraph.querySelector('span') ?? paragraph
    const style = getComputedStyle(inner)
    return { family: style.fontFamily, size: style.fontSize, color: style.color, align: getComputedStyle(paragraph).textAlign }
  })
  const old = await read('Đoạn cũ kiểu Word.')
  expect(old.family, 'the portal font, not the pasted Arial').toMatch(/^Inter/)
  expect(old.size).toBe('18px')
  expect(old.color, 'dark ink, not the old grey').toBe('rgb(30, 37, 28)')
  expect(old.align, 'the authored alignment is kept').toBe('justify')
  const red = await read('Đoạn đỏ đậm.')
  expect(red.family).toMatch(/^Inter/)
  expect(red.size).toBe('18px')
  expect(red.color, 'an authored colour is kept').toBe('rgb(192, 57, 43)')

  const box = await body.evaluate((el) => {
    const column = el.getBoundingClientRect()
    const image = el.querySelector('img')!.getBoundingClientRect()
    return { column: [column.x, column.width], image: [image.x, image.width] }
  })
  expect(box.column[1], 'the column is wider than the picture').toBeGreaterThan(400)
  const left = box.image[0]! - box.column[0]!
  const right = box.column[0]! + box.column[1]! - (box.image[0]! + box.image[1]!)
  expect(Math.abs(left - right), `centred: ${left}px left, ${right}px right`).toBeLessThanOrEqual(2)
})
