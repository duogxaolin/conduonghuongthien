/**
 * The article editor's image entries, on the real build with the real TinyMCE: every "insert an image" entry
 * (Insert menu, the bar that floats in an empty paragraph) opens the media library at once — not TinyMCE's image
 * dialog asking for a URL, not the OS file chooser — and the image goes in as a full-width picture WITH ITS CAPTION
 * BOX, the caret in it; what the officer types there is also the picture's alt. A selected image (a captioned one is
 * selected as its figure) shows a labelled "Sửa ảnh" that opens the image dialog. The behaviour of the buttons
 * themselves is tests/tinymce-image-library-buttons.test.ts; this is what only a browser can show (menu, quick bars,
 * the library above the editor, typing, the unsaved-changes guard, the public page).
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

test('image entries open the library, insert a full-width captioned image (caret in the caption, alt follows it), and "Sửa ảnh" edits the selected one', async ({ page }) => {
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
  // The library's list carries the file's width, and the picture is capped at it (never enlarged — CHANGELOG § 106).
  expect(html).toMatch(/<figure class="image" style="width: 100%; max-width: \d+px;"><img [^>]*style="width: 100%; max-width: \d+px; height: auto;"/)

  // The caret is in the new caption, which shows a hint while empty; typing goes straight in.
  const caption = frame.locator('body > figure.image figcaption')
  expect(await page.evaluate<string>(`${tiny}.selection.getNode().nodeName`)).toBe('FIGCAPTION')
  expect(await caption.evaluate(el => getComputedStyle(el, '::before').content)).toContain('Nhập chú thích ảnh')
  await page.keyboard.type('Cán bộ trao quà cho hộ dân')
  const saved = await page.evaluate<{ alt: string | null, caption: string }>(`(() => {
    const doc = new DOMParser().parseFromString(${tiny}.getContent(), 'text/html')
    return { alt: doc.querySelector('img').getAttribute('alt'), caption: doc.querySelector('figcaption').textContent }
  })()`)
  expect(saved).toEqual({ alt: 'Cán bộ trao quà cho hộ dân', caption: 'Cán bộ trao quà cho hộ dân' })
  // Raw characters, not named entities: the sanitizer re-escapes the `&` of `&aacute;` inside an attribute, so a caption
  // saved as `C&aacute;n` would reach the public page as that literal text. And the hint's mark is not part of the HTML.
  const typedHtml = await page.evaluate<string>(`${tiny}.getContent()`)
  expect(typedHtml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|nbsp;|#)[a-z]+;/i)
  expect(typedHtml).not.toContain('data-mce-empty')
  // …and that HTML, saved as it is and read on the public page, keeps the caption as the picture's alt (the sanitizer is
  // in between: it double-escapes a named entity in an attribute, which `raw` is there to avoid).
  const published = await createArticle(page, typedHtml, 'published')
  const visitor = await page.context().newPage()
  await visitor.goto(`/news/${published.slug}`)
  await expect(visitor.locator('.article-body figure img').first()).toHaveAttribute('alt', 'Cán bộ trao quà cho hộ dân')
  await expect(visitor.locator('.article-body figcaption').first()).toHaveText('Cán bộ trao quà cho hộ dân')
  await visitor.close()
  expect(await page.evaluate<string>(`${tiny}.getBody().querySelector('img').getAttribute('alt')`), 'the live alt follows too').toBe('Cán bộ trao quà cho hộ dân')

  // Clicking the picture selects its figure: the bar over it says "Sửa ảnh", the toolbar button is on, the dialog opens
  // on that image with the caption's words as its alt, 100% wide, and "Show caption" ticked.
  await frame.locator('body > figure.image img').click()
  const imageBar = page.locator('.tox-pop')
  const edit = imageBar.getByRole('button', { name: /Sửa ảnh/ })
  await expect(edit).toBeVisible()
  await expect(edit).toContainText('Sửa ảnh')
  await expect.poll(() => page.evaluate(() => document.querySelector('button[aria-label^="Sửa ảnh"]')?.getAttribute('aria-disabled'))).not.toBe('true')
  await edit.click()
  await expect(tinyDialog).toBeVisible()
  const fields = tinyDialog.locator('input.tox-textfield')
  await expect(fields.nth(1)).toHaveValue('Cán bộ trao quà cho hộ dân')
  await expect(fields.nth(2)).toHaveValue('100%')
  await expect(tinyDialog.getByRole('checkbox', { name: 'Show caption' })).toBeChecked()
  await tinyDialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(tinyDialog).toBeHidden()

  // With the caret in text (the caption's own words) the toolbar's "Sửa ảnh" is greyed (the toolbar may be folded at this width: read the DOM).
  await caption.click()
  await expect.poll(() => page.evaluate(() => document.querySelector('button[aria-label^="Sửa ảnh"]')?.getAttribute('aria-disabled'))).toBe('true')
})

const figure = (url: string, alt: string, caption: string) =>
  `<figure class="image" style="width: 100%;"><img src="${url}" alt="${alt}" style="width: 100%; height: auto;"><figcaption>${caption}</figcaption></figure>`

let uploads = 0
async function uploadMedia(page: Page) {
  const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const uploaded = await page.request.post('/api/admin/media/upload', {
    multipart: { file: { name: `e2e-caption-${Date.now()}-${uploads++}.png`, mimeType: 'image/png', buffer: onePixelPng } },
  })
  expect(uploaded.status(), await uploaded.text()).toBe(200)
  return ((await uploaded.json()) as { media: { url: string, originalName: string } }).media
}
const uploadPng = async (page: Page) => (await uploadMedia(page)).url

async function createArticle(page: Page, content: string, status: 'draft' | 'published') {
  const stamp = Date.now()
  const created = await page.request.post('/api/admin/articles', {
    data: { title: `E2E chú thích ảnh ${stamp}`, slug: `e2e-chu-thich-anh-${stamp}`, type: 'news', content, excerpt: 'tóm tắt', status },
  })
  expect(created.status(), await created.text()).toBe(200)
  // The server makes the slug unique (a random suffix): the public page is at the slug it answers with.
  const body = (await created.json()) as { id: number, slug: string }
  return { id: body.id, slug: body.slug }
}

/** Client-side navigation away from the editor, as a click on an admin link does (the route-leave guard runs). */
// Not awaited in the page: while the guard's confirm box is open the navigation promise stays pending.
const leaveEditor = (page: Page) => page.evaluate(`void document.querySelector('#__nuxt').__vue_app__.config.globalProperties.$router.push('/admin')`)

test('an article opened from the database does not look edited; typing in a caption does', async ({ page }) => {
  await login(page)
  const url = await uploadPng(page)
  // A saved figure whose alt is NOT its caption (an old article, or typed in the image dialog): the editor reads it
  // through the serializer, so its baseline already has the caption as the alt.
  const { id } = await createArticle(page, `<p>Đầu</p>${figure(url, 'tên-file.png', 'Chú thích đã có')}`, 'draft')
  const unsaved = page.getByText('Bài viết có thay đổi chưa lưu')

  await page.goto(`/admin/content/articles/${id}`)
  await expect(page.locator('.tox-tinymce')).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => page.evaluate<string>(`${tiny}.getContent()`)).toContain('<figcaption>')
  // The serializer's filter is live on the real editor (it can only be added from `PreInit`): the alt that came from the
  // database is read back as the caption — the baseline and every later `getContent()` agree, so nothing looks edited.
  const loadedAlt = (js: string) => page.evaluate<string | null>(`(() => { const doc = new DOMParser().parseFromString(${js}, 'text/html'); return doc.querySelector('img').getAttribute('alt') })()`)
  expect(await loadedAlt(`${tiny}.getContent()`)).toBe('Chú thích đã có')
  await leaveEditor(page)
  await expect(page).toHaveURL(/\/admin\/?$/, { timeout: 10_000 })
  await expect(unsaved).toHaveCount(0)

  // The same article, with one letter typed in the caption: the guard asks.
  await page.goto(`/admin/content/articles/${id}`)
  await expect(page.locator('.tox-tinymce')).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => page.evaluate<string>(`${tiny}.getContent()`)).toContain('<figcaption>')
  await page.frameLocator('iframe.tox-edit-area__iframe').locator('body > figure.image figcaption').click()
  await page.keyboard.type('!')
  await leaveEditor(page)
  await expect(unsaved).toBeVisible()
})

test('the public page shows a filled caption under its picture, with the caption as alt, and nothing for an empty one', async ({ page }) => {
  await login(page)
  const url = await uploadPng(page)
  const { slug } = await createArticle(page, `<p>Đầu</p>${figure(url, 'Cán bộ trao quà', 'Cán bộ trao quà')}${figure(url, '', '')}`, 'published')

  await page.goto(`/news/${slug}`)
  const body = page.locator('.article-body')
  await expect(body.locator('figure')).toHaveCount(2)
  await expect(body.locator('figcaption').first()).toBeVisible()
  await expect(body.locator('figcaption').first()).toHaveText('Cán bộ trao quà')
  await expect(body.locator('figure').first().locator('img')).toHaveAttribute('alt', 'Cán bộ trao quà')
  await expect(body.locator('figcaption').nth(1), 'an unfilled caption shows nothing').toBeHidden()
})

const figures = (page: Page) => page.evaluate<{ count: number, nested: number, srcs: string[] }>(`(() => {
  const doc = new DOMParser().parseFromString(${tiny}.getContent(), 'text/html')
  return { count: doc.querySelectorAll('figure').length, nested: doc.querySelectorAll('figure figure').length, srcs: [...doc.querySelectorAll('figure > img')].map(i => i.getAttribute('src').replace(/^https?:\\/\\/[^/]+/, '')) }
})()`)

test('emptying a caption leaves no stray alt behind', async ({ page }) => {
  await login(page)
  const url = await uploadPng(page)
  const { id } = await createArticle(page, `<p>Đầu</p>${figure(url, '', '')}`, 'draft')
  await page.goto(`/admin/content/articles/${id}`)
  await expect(page.locator('.tox-tinymce')).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => page.evaluate<string>(`${tiny}.getContent()`)).toContain('<figcaption>')
  const caption = page.frameLocator('iframe.tox-edit-area__iframe').locator('body > figure.image figcaption')
  await caption.click()
  await page.keyboard.type('Ông')
  expect(await page.evaluate<string>(`${tiny}.getBody().querySelector('img').getAttribute('alt')`)).toBe('Ông')
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Backspace')
  expect(await page.evaluate<string>(`${tiny}.getBody().querySelector('img').getAttribute('alt')`), 'typed then deleted: no stray "Ô"').toBe('')
  expect(await page.evaluate<string>(`${tiny}.getContent()`)).toMatch(/alt=""/)
})

test('an old picture\'s own alt survives typing in its empty caption and deleting again', async ({ page }) => {
  await login(page)
  const url = await uploadPng(page)
  const { id } = await createArticle(page, `<p>Đầu</p>${figure(url, 'Mô tả có sẵn', '')}`, 'draft')
  await page.goto(`/admin/content/articles/${id}`)
  await expect(page.locator('.tox-tinymce')).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => page.evaluate<string>(`${tiny}.getContent()`)).toContain('<figcaption>')
  await page.frameLocator('iframe.tox-edit-area__iframe').locator('body > figure.image figcaption').click()
  await page.keyboard.type('x')
  await page.keyboard.press('Backspace')
  expect(await page.evaluate<string>(`${tiny}.getBody().querySelector('img').getAttribute('alt')`)).toBe('Mô tả có sẵn')
  expect(await page.evaluate<string>(`${tiny}.getContent()`)).toContain('alt="Mô tả có sẵn"')
})

test('a second insertion never goes inside the first one\'s caption, and several chosen at once all stay', async ({ page }) => {
  await login(page)
  const [first, second, third, fourth] = [await uploadMedia(page), await uploadMedia(page), await uploadMedia(page), await uploadMedia(page)]
  const { id } = await createArticle(page, '<p>Đầu</p>', 'draft')
  await page.goto(`/admin/content/articles/${id}`)
  await expect(page.locator('.tox-tinymce')).toBeVisible({ timeout: 30_000 })
  const library = page.getByRole('dialog', { name: 'Thư viện ảnh' })

  // Two insertions in a row: after the first, the caret is IN its caption. The second goes after that figure.
  const insertViaMenu = async (media: { originalName: string }) => {
    await page.getByRole('menuitem', { name: 'Insert' }).click()
    await page.getByRole('menuitem', { name: /Chèn ảnh từ thư viện/ }).click()
    await expect(library).toBeVisible()
    const tile = library.getByRole('button', { name: media.originalName, exact: true })
    await tile.focus()
    await page.keyboard.press('Enter')
    await expect(library).toBeHidden()
  }
  await insertViaMenu(first)
  expect(await page.evaluate<string>(`${tiny}.selection.getNode().nodeName`)).toBe('FIGCAPTION')
  await insertViaMenu(second)
  const afterTwo = await figures(page)
  expect(afterTwo.count).toBe(2)
  expect(afterTwo.nested, 'the second figure is not inside the first one\'s caption').toBe(0)
  expect(afterTwo.srcs).toEqual([first.url, second.url])

  // Several at once, from the side panel: one insertion, none replaces another.
  await page.getByRole('button', { name: /Chèn Ảnh Từ Thư Viện/ }).click()
  await expect(library).toBeVisible()
  await library.getByRole('button', { name: third.originalName, exact: true }).click()
  await library.getByRole('button', { name: fourth.originalName, exact: true }).click()
  await library.getByRole('button', { name: /Thêm 2 ảnh/ }).click()
  await expect(library).toBeHidden()
  const afterFour = await figures(page)
  expect(afterFour.count).toBe(4)
  expect(afterFour.nested).toBe(0)
  expect(afterFour.srcs).toEqual([first.url, second.url, third.url, fourth.url])
})
