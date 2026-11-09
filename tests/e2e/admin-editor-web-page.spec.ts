/**
 * The article editor as a web-page sheet with a zoom control (CHANGELOG § 108), on the real build with the real TinyMCE
 * under the real admin layout: the sheet is the public text column wide and set in the public page's type (compared with
 * the public page itself); the zoom control sits in the editor's status bar — so it is there in full screen — and
 * scales the page, the toolbar bubbles still land on the text, "Vừa khít" fits the sheet to the frame, Ctrl + wheel
 * zooms, and the level is remembered. The helpers' own behaviour is tests/tinymce-web-page.test.ts.
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

const TEXT = 'Đoạn thử nghiệm của trang soạn, đủ dài để xuống dòng trên khung hẹp và để bôi đen một cụm chữ bất kỳ trong đó. '.repeat(3)

async function article(page: Page, status: 'draft' | 'published' = 'draft') {
  const stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`
  const created = await page.request.post('/api/admin/articles', {
    data: { title: `E2E trang soạn ${stamp}`, slug: `e2e-trang-soan-${stamp}`, type: 'news', content: `<p>${TEXT}</p><p>Đoạn hai.</p>`, excerpt: 'tóm tắt', status },
  })
  expect(created.status(), await created.text()).toBe(200)
  const body = (await created.json()) as { id: number, slug: string }
  return body
}

async function open(page: Page, id: number) {
  await page.goto(`/admin/content/articles/${id}`)
  await expect(page.locator('.tox-tinymce')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.tox-tinymce [data-cdkt-zoom]')).toBeVisible()
}

const control = (page: Page) => page.locator('.tox-tinymce [data-cdkt-zoom]')
const slider = (page: Page) => control(page).locator('input[type="range"]')
const percent = (page: Page) => control(page).getByRole('button', { name: 'Về mức 100%' })
const sheet = (page: Page) => page.frameLocator('iframe.tox-edit-area__iframe').locator('body')

/** The sheet as the browser lays it out: its box on screen, and the iframe document's own words about it. */
const sheetBox = async (page: Page) => (await sheet(page).boundingBox())!

test('the sheet is as wide as the public text column and set in the public page\'s type', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 })
  await login(page)
  const { id, slug } = await article(page, 'published')
  await open(page, id)

  const editor = await page.evaluate(() => {
    const ed = (window as unknown as { tinymce: { get: (id: string) => { getDoc: () => Document, getBody: () => HTMLElement } } }).tinymce.get('tinymce-content-editor')
    const doc = ed.getDoc(); const body = ed.getBody(); const p = body.querySelector('p')!
    const bodyStyle = getComputedStyle(body); const pStyle = getComputedStyle(p)
    return {
      sheet: body.getBoundingClientRect().width, text: body.clientWidth - parseFloat(bodyStyle.paddingLeft) - parseFloat(bodyStyle.paddingRight),
      family: pStyle.fontFamily, size: pStyle.fontSize, color: pStyle.color, lineHeight: pStyle.lineHeight, background: bodyStyle.backgroundColor,
      desk: getComputedStyle(doc.documentElement).backgroundColor,
      fontCss: [...doc.styleSheets].some(sheet => (sheet.href ?? '').endsWith('/assets/fonts/inter.css')),
    }
  })
  console.log('MEASURED editor', JSON.stringify(editor))
  expect(editor.sheet, 'the sheet: 808 px of text plus 48 px padding either side').toBe(904)
  expect(editor.text).toBe(808)
  expect(editor.fontCss, 'the portal font stylesheet is in the editor').toBe(true)
  expect(editor.family).toMatch(/^Inter/)
  expect(editor.size).toBe('18px')
  expect(editor.color).toBe('rgb(30, 37, 28)')
  expect(editor.lineHeight).toBe('31.5px')
  expect(editor.background).toBe('rgb(255, 255, 255)')
  expect(editor.desk, 'a grey-green desk around the sheet').not.toBe('rgb(255, 255, 255)')

  // The public page itself, at a width where its grid gives the text column its full width.
  await page.goto(`/news/${slug}`)
  const publicText = await page.locator('.article-body').first().evaluate(el => ({
    width: el.getBoundingClientRect().width, family: getComputedStyle(el.querySelector('p')!).fontFamily, size: getComputedStyle(el.querySelector('p')!).fontSize,
    color: getComputedStyle(el.querySelector('p')!).color, lineHeight: getComputedStyle(el.querySelector('p')!).lineHeight,
  }))
  expect(publicText.width, 'the public text column is what the sheet\'s text width is').toBe(editor.text)
  expect(publicText.family).toBe(editor.family)
  expect([publicText.size, publicText.color, publicText.lineHeight]).toEqual([editor.size, editor.color, editor.lineHeight])
})

test('the zoom control scales the page, is remembered, and "Vừa khít" fits the sheet to a narrow frame', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 })
  await login(page)
  const { id } = await article(page)
  await open(page, id)
  await expect(percent(page)).toHaveText('100%')
  const full = await sheetBox(page)
  expect(Math.round(full.width)).toBe(904)

  await slider(page).fill('50')
  await expect(percent(page)).toHaveText('50%')
  await expect.poll(async () => Math.round((await sheetBox(page)).width)).toBe(452)

  await control(page).getByRole('button', { name: 'Tăng mức xem' }).click()
  await expect(percent(page)).toHaveText('60%')
  await control(page).getByRole('button', { name: 'Giảm mức xem' }).click()
  await control(page).getByRole('button', { name: 'Giảm mức xem' }).click()
  await expect(percent(page)).toHaveText('50%')
  await control(page).getByRole('button', { name: 'Giảm mức xem' }).click()
  await expect(percent(page), 'never below 50%').toHaveText('50%')

  await slider(page).fill('150')
  await expect(percent(page)).toHaveText('150%')
  await page.reload()
  await expect(page.locator('.tox-tinymce [data-cdkt-zoom]')).toBeVisible({ timeout: 30_000 })
  await expect(percent(page), 'the level is remembered in this browser').toHaveText('150%')
  await percent(page).click()
  await expect(percent(page)).toHaveText('100%')

  // A narrow window: the sheet is wider than the frame until "Vừa khít".
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect.poll(async () => (await sheetBox(page)).width).toBeLessThan(904)
  await control(page).getByRole('button', { name: 'Vừa với bề rộng khung soạn' }).click()
  const label = await percent(page).innerText()
  const level = Number.parseInt(label, 10)
  console.log('MEASURED 1280px fit level:', label)
  expect(level).toBeLessThan(100)
  expect(level).toBeGreaterThanOrEqual(50)
  const fits = await page.evaluate(() => {
    const ed = (window as unknown as { tinymce: { get: (id: string) => { getDoc: () => Document } } }).tinymce.get('tinymce-content-editor')
    const root = ed.getDoc().documentElement
    return { scroll: root.scrollWidth, client: root.clientWidth }
  })
  expect(fits.scroll, 'no horizontal scrolling once fitted').toBeLessThanOrEqual(fits.client + 1)
})

test('a selection toolbar bubble lands on the selected text at 70% and 150%', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 })
  await login(page)
  const { id } = await article(page)
  await open(page, id)
  for (const level of ['70', '150']) {
    await slider(page).fill(level)
    await expect(percent(page)).toHaveText(`${level}%`)
    const p = sheet(page).locator('p').first()
    await page.locator('.tox-tinymce').scrollIntoViewIfNeeded()
    await page.evaluate((top) => window.scrollBy(0, top), Math.round((await p.boundingBox())!.y - 300)) // the toolbar and the first lines on screen together
    const box = (await p.boundingBox())!
    await page.mouse.click(box.x + 4, box.y + 6) // inside the FIRST line at both levels
    await page.keyboard.press('Home')
    await page.keyboard.down('Shift')
    for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight')
    await page.keyboard.up('Shift')
    const bubble = page.locator('.tox-pop').first()
    await expect(bubble).toBeVisible()
    await page.waitForTimeout(300)
    const bubbleBox = (await bubble.boundingBox())!
    const text = (await p.boundingBox())!
    console.log(`MEASURED ${level}%: bubble`, JSON.stringify(bubbleBox), 'text top', Math.round(text.y), 'left', Math.round(text.x))
    // TinyMCE puts the bubble above the selected line, or below it when there is no room above inside the editing area
    // (the sheet's top gap is only 50 px at 70%): either way it is right against the line, never somewhere else.
    const lineHeight = 31.5 * Number(level) / 100
    const above = Math.abs(bubbleBox.y + bubbleBox.height - text.y)
    const below = Math.abs(bubbleBox.y - (text.y + lineHeight))
    expect(Math.min(above, below), `the bubble touches the selected line at ${level}% (above ${above}px, below ${below}px)`).toBeLessThanOrEqual(14)
    expect(bubbleBox.x, 'horizontally near the selection').toBeLessThan(text.x + 200)
    expect(bubbleBox.x + bubbleBox.width, 'and not left of it').toBeGreaterThan(text.x)
  }
})

test('Ctrl + wheel over the page zooms, and the control works in full screen', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await login(page)
  const { id } = await article(page)
  await open(page, id)
  const prevented = await page.evaluate(() => {
    const ed = (window as unknown as { tinymce: { get: (id: string) => { getDoc: () => Document } } }).tinymce.get('tinymce-content-editor')
    const event = new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, cancelable: true, bubbles: true })
    ed.getDoc().body.dispatchEvent(event)
    return event.defaultPrevented
  })
  expect(prevented, 'the browser\'s own page zoom does not also happen').toBe(true)
  await expect(percent(page)).toHaveText('110%')
  const plain = await page.evaluate(() => {
    const ed = (window as unknown as { tinymce: { get: (id: string) => { getDoc: () => Document } } }).tinymce.get('tinymce-content-editor')
    const event = new WheelEvent('wheel', { deltaY: -100, cancelable: true, bubbles: true })
    ed.getDoc().body.dispatchEvent(event)
    return event.defaultPrevented
  })
  expect(plain, 'a plain wheel still scrolls').toBe(false)
  await expect(percent(page)).toHaveText('110%')

  await page.locator('.tox-toolbar__primary button[aria-label^="Phóng to"]').click()
  await expect(page.locator('.tox-tinymce.tox-fullscreen')).toBeVisible()
  await expect(control(page)).toBeVisible()
  await control(page).getByRole('button', { name: 'Tăng mức xem' }).click()
  await expect(percent(page)).toHaveText('120%')
  await page.locator('.tox-toolbar__primary button[aria-label^="Phóng to"]').click()
  await expect(percent(page), 'the level is the editor\'s, in or out of full screen').toHaveText('120%')
  await percent(page).click()
})
