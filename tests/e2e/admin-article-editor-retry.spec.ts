/**
 * The article editor (`/admin/content/articles/:id`) after a failed load and "Thử lại", with the
 * real TinyMCE (self-hosted, `public/assets/tinymce/`) — what the node suite's stand-in cannot show.
 *
 * KNOWN 5/6 of the editor's split (docs/decisions/refactor-large-files.md), measured on the base
 * build before the fix: "Thử lại" brings the loading placeholder back (`v-if="loading"`), which
 * takes the editor grid off the page and TinyMCE's element with it. Nothing started the editor
 * again: the body was a bare, empty 700px box (no toolbar, nothing to type in) while the orphaned
 * editor still answered `tinymce.get()`. And the unsaved-changes baseline was the empty form of
 * the failed load, so the page warned on leaving with nothing edited.
 *
 * tests/admin-article-editor-findings.test.ts pins the same in the node suite, on a TinyMCE
 * stand-in calibrated to what this browser showed (bound to its element, orphaned when the
 * element goes).
 */
import { expect, test, type Page } from '@playwright/test'
import { E2E_ADMIN_USERNAME, E2E_PASSWORD_ENV } from './harness'

const EDITOR_ID = 'tinymce-content-editor'

async function login(page: Page) {
  const password = process.env[E2E_PASSWORD_ENV]
  if (!password) throw new Error(`${E2E_PASSWORD_ENV} is not set — globalSetup did not run`)
  await page.goto('/admin/login')
  await page.fill('input[autocomplete="username"]', E2E_ADMIN_USERNAME)
  await page.fill('input[autocomplete="current-password"]', password)
  await page.click('button[type="submit"]')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Xin chào', { timeout: 20_000 })
}

/** The editor TinyMCE holds for the page's id: started, and bound to the element now on the page. */
const editorOnPage = (page: Page) => page.evaluate((id) => {
  type Editor = { initialized?: boolean, getElement: () => Element | null, getContainer: () => Element | null }
  const editor = (window as unknown as { tinymce?: { get: (id: string) => Editor | undefined } }).tinymce?.get(id)
  return !!editor?.initialized && editor.getElement() === document.getElementById(id) && !!editor.getContainer()?.isConnected
}, EDITOR_ID)

/** A cancelable `beforeunload`, as the browser raises it on closing the tab: does the page ask to warn? */
const warnsOnClose = (page: Page) => page.evaluate(() => {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
})

test('a failed load, then "Thử lại": the editor is back with the body, nothing is "unsaved", and what is typed is saved', async ({ page }) => {
  await login(page)
  const title = `E2E thử lại trình soạn ${Date.now()}`
  const created = await page.request.post('/api/admin/articles', {
    data: { title, slug: `e2e-thu-lai-${Date.now()}`, type: 'news', content: '<p>Một</p><p>Hai</p>', excerpt: 'tóm tắt', status: 'draft' },
  })
  expect(created.status(), await created.text()).toBe(200)
  const id = ((await created.json()) as { id: number }).id

  // The first read is refused; every later one reaches the server. 403, not 5xx: ofetch retries a
  // GET once on 5xx, which would hide the failure.
  let reads = 0
  await page.route(url => url.pathname === `/api/admin/articles/${id}`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    reads += 1
    if (reads > 1) return route.continue()
    return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ statusCode: 403, statusMessage: 'E2E: không đọc được.', message: 'E2E: không đọc được.' }) })
  })

  await page.goto(`/admin/content/articles/${id}`)
  await expect(page.getByRole('alert')).toContainText('E2E: không đọc được.', { timeout: 20_000 })
  await expect.poll(() => editorOnPage(page), { message: 'the editor comes up over the failed load', timeout: 20_000 }).toBe(true)

  await page.getByRole('button', { name: 'Thử lại' }).click()
  await expect(page.getByPlaceholder('Nhập tiêu đề hấp dẫn...')).toHaveValue(title, { timeout: 20_000 })
  await expect.poll(() => editorOnPage(page), { message: 'after "Thử lại" the body is a bare box: no editor on the element on the page', timeout: 20_000 }).toBe(true)
  await expect(page.locator('.tox-tinymce')).toHaveCount(1)
  const body = page.frameLocator('.tox-edit-area iframe').locator('body')
  await expect(body).toContainText('Hai')
  expect(reads).toBe(2)

  expect(await warnsOnClose(page), 'nothing edited, yet the tab warns about unsaved changes').toBe(false)

  await body.click()
  await page.keyboard.press('Control+End')
  // ASCII: TinyMCE writes Vietnamese letters as named entities (`ã` → `&atilde;`).
  await page.keyboard.type(' E2E edit')
  await page.getByPlaceholder('Nhập tiêu đề hấp dẫn...').focus()
  await expect.poll(() => warnsOnClose(page), { message: 'an edit after "Thử lại" must still warn' }).toBe(true)

  const put = page.waitForRequest(r => r.method() === 'PUT' && new URL(r.url()).pathname === `/api/admin/articles/${id}`)
  await page.getByRole('button', { name: /Cập Nhật Bài Viết/ }).click()
  expect(((await put).postDataJSON() as { content: string }).content).toContain('Hai E2E edit')
})
