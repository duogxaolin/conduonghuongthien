/**
 * Hộp thoại admin (`AdminModal.vue`, spec `admin-dialogs`) trong trình duyệt THẬT.
 *
 * `tests/admin-modal-dialog.test.ts` chứng minh cấu trúc (mọi lớp phủ là hộp thoại),
 * markup SSR (vai trò, tên, bận) và các hàm quyết định thuần — không chứng minh được
 * focus, bẫy Tab, `inert` hay Escape thật. Spec này lái Chromium qua ba trang mà
 * tasks.md 6.2 nêu tên: người dùng (tạo + sửa), danh mục, cấu hình trang.
 *
 * Kịch bản spec:
 *   - mở hộp tạo người dùng → được công bố là hộp thoại có tên, focus vào trong,
 *     Tab/Shift+Tab chỉ quay vòng trong hộp, phần còn lại của trang `inert`;
 *   - Escape khi không lưu → hộp đóng, focus về đúng nút đã mở, không sót `inert`;
 *   - đang lưu → Escape không đóng; lưu hỏng (nút "Lưu" bị disabled đẩy focus về
 *     `<body>`) → Escape vẫn đóng được.
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
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

/** Focus đang ở trong hộp thoại (và không phải `<body>`). */
const focusInside = (dialog: Locator) =>
  dialog.evaluate(el => {
    const active = document.activeElement
    return !!active && active !== document.body && el.contains(active)
  })

/** Mô tả phần tử đang giữ focus — để thông báo lỗi đọc được. */
const activeLabel = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null
    if (!a) return 'null'
    return `${a.tagName.toLowerCase()}[${a.getAttribute('aria-label') || a.getAttribute('placeholder') || a.textContent?.trim().slice(0, 30) || ''}]`
  })

/** Mọi phần tử mang `inert` — so trước/sau để chắc đóng hộp gỡ đúng những gì đã đặt. */
const inertElements = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll('[inert]')].map(el => el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '')))

/** Tab rồi Shift+Tab nhiều hơn số điều khiển trong hộp: focus không được rời hộp lần nào. */
async function expectTabTrapped(page: Page, dialog: Locator) {
  const focusables = await dialog.evaluate(el =>
    el.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])').length)
  expect(focusables, 'hộp thoại phải có điều khiển để Tab tới').toBeGreaterThan(1)
  const presses = focusables * 2 + 3
  const escapes: string[] = []
  for (let i = 0; i < presses; i += 1) {
    await page.keyboard.press('Tab')
    if (!(await focusInside(dialog))) escapes.push(`Tab#${i + 1} → ${await activeLabel(page)}`)
  }
  for (let i = 0; i < presses; i += 1) {
    await page.keyboard.press('Shift+Tab')
    if (!(await focusInside(dialog))) escapes.push(`Shift+Tab#${i + 1} → ${await activeLabel(page)}`)
  }
  expect(escapes, 'Tab/Shift+Tab không được rời hộp thoại đang mở').toEqual([])
}

/** Mở bằng bàn phím từ `opener`, kiểm hộp là hộp thoại modal có tên và giữ focus. */
async function openWithKeyboard(page: Page, opener: Locator, name: string | RegExp) {
  await opener.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name })
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  await expect.poll(() => focusInside(dialog), { message: 'mở hộp thoại phải đưa focus vào trong' }).toBe(true)
  // Trang phía sau không với tới được (Tab lẫn trình đọc màn hình).
  expect(await page.evaluate(() => !!document.getElementById('main-content')?.closest('[inert]') || !!document.querySelector('main')?.closest('[inert]'))).toBe(true)
  return dialog
}

/**
 * Mở bằng Enter GIỮ như người thật (~100 ms): nhấn → hộp mở và nhận focus → MỚI thả.
 * `keyboard.press()` thả ngay trong cùng nhịp nên không bao giờ thấy lỗi: phím thả
 * (`keyup`) rơi vào ô nhập vừa nhận focus và chạy `@keyup.enter` của nó.
 */
async function openWithHeldEnter(page: Page, opener: Locator, name: string | RegExp, repeats = 3) {
  // Ghi `event.repeat` của mọi keydown Enter TRƯỚC mọi handler khác (capture, đăng ký
  // trước) — chứng minh trang thật sự nhận được keydown lặp, kể cả khi hộp nuốt chúng.
  await page.evaluate(() => {
    const w = window as unknown as { __enterKeydowns?: boolean[] }
    w.__enterKeydowns = []
    document.addEventListener('keydown', e => { if (e.key === 'Enter') w.__enterKeydowns!.push(e.repeat) }, true)
  })
  await opener.focus()
  await page.keyboard.down('Enter')
  const dialog = page.getByRole('dialog', { name })
  await expect(dialog).toBeVisible()
  await expect.poll(() => focusInside(dialog), { message: 'hộp phải nhận focus trước khi phím được thả' }).toBe(true)
  // Vẫn giữ: hệ điều hành lặp phím (autorepeat) vào điều khiển VỪA nhận focus.
  for (let i = 0; i < repeats; i += 1) await page.keyboard.down('Enter')
  await page.keyboard.up('Enter')
  expect(
    await page.evaluate(() => (window as unknown as { __enterKeydowns?: boolean[] }).__enterKeydowns),
    'trang phải nhận một keydown thường rồi các keydown lặp',
  ).toEqual([false, ...Array.from({ length: repeats }, () => true)])
  return dialog
}

/**
 * Rào mạng: một request đi SAU mọi thứ phím thả có thể đã kích hoạt (handler chạy
 * đồng bộ lúc `keyup`, `$fetch` phát request trong cùng nhịp). Sự kiện mạng tới theo
 * thứ tự, nên khi request rào xong thì request lỡ tay (nếu có) đã được ghi lại —
 * không cần chờ một khoảng thời gian đoán mò.
 */
async function networkBarrier(page: Page) {
  await page.evaluate(() => fetch('/api/admin/pages', { credentials: 'same-origin' }).then(r => r.status))
}

async function firstPageId(page: Page): Promise<number> {
  const list = await page.request.get('/api/admin/pages')
  expect(list.status()).toBe(200)
  const { items } = (await list.json()) as { items: Array<{ id: number }> }
  expect(items.length, 'cần ít nhất một trang (trang hệ thống được seed)').toBeGreaterThan(0)
  return items[0]!.id
}

const isVersionsPath = (url: string) => /^\/api\/admin\/pages\/\d+\/versions$/.test(new URL(url).pathname)

/** Focus KHÔNG nằm ở `<body>` (người dùng bàn phím không phải Tab lại từ đầu trang). */
const focusIsNotBody = (page: Page) => page.evaluate(() => !!document.activeElement && document.activeElement !== document.body)

/**
 * Trang ngôn ngữ với một ngôn ngữ (khác `vi`) còn thiếu 25 key và lượt dịch AI bị GIỮ
 * lại tới khi gọi `release()` — để hộp "Tiến trình Dịch AI" ở trạng thái đang chạy.
 */
async function languagesWithHeldTranslation(page: Page) {
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  let target = ''
  await page.route(url => url.pathname === '/api/admin/languages', async route => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    const json = (await response.json()) as { ok: boolean; items: Array<{ code: string; stats?: { missingKeys: number; percent: number } }> }
    const lang = json.items.find(item => item.code !== 'vi')
    if (!lang) throw new Error('cần một ngôn ngữ khác tiếng Việt (seed)')
    target = lang.code
    lang.stats = { ...(lang.stats ?? { percent: 0 }), missingKeys: 25, percent: 50 }
    await route.fulfill({ response, json })
  })
  await page.route(url => /^\/api\/admin\/languages\/[a-z-]+\/translations$/.test(url.pathname) && !url.pathname.startsWith('/api/admin/languages/vi/'), route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, items: Array.from({ length: 25 }, (_, i) => ({ id: i + 1, group: 'e2e', key: `e2e.key${i}`, value: '', isAiTranslated: false })) }),
    }))
  await page.route(url => url.pathname === '/api/admin/languages/ai-translate-chunk', async route => {
    await gate
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, translated: [] }) })
  })
  await page.goto('/admin/languages')
  await page.waitForLoadState('networkidle')
  const opener = page.locator(`[data-admin-modal-opener="translate-${target}"]`)
  await expect(opener).toBeVisible({ timeout: 20_000 })
  return { opener, release, code: () => target }
}

async function expectClosedCleanly(page: Page, dialog: Locator, opener: Locator, inertBefore: string[]) {
  await expect(dialog).toHaveCount(0)
  await expect(opener, 'đóng hộp phải trả focus về nút đã mở').toBeFocused()
  await expect.poll(() => inertElements(page), { message: 'đóng hộp phải gỡ hết inert đã đặt (và chỉ những cái đó)' }).toEqual(inertBefore)
}

test.describe('hộp thoại admin (AdminModal)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('tạo người dùng: có tên, focus vào ô đầu, Tab bị bẫy, Escape đóng + trả focus', async ({ page }) => {
    await page.goto('/admin/users')
    await expect(page.getByRole('heading', { level: 1, name: 'Quản lý Người dùng Admin' })).toBeVisible()
    await page.waitForLoadState('networkidle')
    const inertBefore = await inertElements(page)
    const opener = page.getByRole('button', { name: 'Thêm Người dùng Mới' })

    const dialog = await openWithKeyboard(page, opener, 'Thêm Tài khoản Admin Mới')
    await expect(dialog.getByPlaceholder('eg: nv_editor'), 'focus vào ô nhập đầu tiên của biểu mẫu').toBeFocused()
    await expectTabTrapped(page, dialog)

    await page.keyboard.press('Escape')
    await expectClosedCleanly(page, dialog, opener, inertBefore)

    // Bấm nền mờ (ngoài khung) cũng đóng và trả focus.
    await openWithKeyboard(page, opener, 'Thêm Tài khoản Admin Mới')
    await page.mouse.click(8, 8)
    await expectClosedCleanly(page, page.getByRole('dialog'), opener, inertBefore)
  })

  test('đang lưu: Escape không đóng; lưu hỏng (focus rơi về body) thì Escape vẫn đóng', async ({ page }) => {
    let release: (() => void) | null = null
    await page.route(url => url.pathname === '/api/admin/users', async route => {
      if (route.request().method() !== 'POST') return route.continue()
      await new Promise<void>(resolve => { release = resolve })
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ statusMessage: 'E2E: tên đăng nhập đã tồn tại' }),
      })
    })

    await page.goto('/admin/users')
    await page.waitForLoadState('networkidle')
    const inertBefore = await inertElements(page)
    const opener = page.getByRole('button', { name: 'Thêm Người dùng Mới' })
    const dialog = await openWithKeyboard(page, opener, 'Thêm Tài khoản Admin Mới')

    await dialog.getByPlaceholder('eg: nv_editor').fill(`e2e_modal_${Date.now()}`)
    await dialog.locator('input[type="password"]').fill('Xk9!mPq2#vLr7')
    await dialog.locator('select').selectOption({ index: 0 })
    await dialog.getByRole('button', { name: 'Tạo Tài Khoản' }).click()
    await expect(dialog).toHaveAttribute('aria-busy', 'true')
    await expect(dialog.getByRole('button', { name: 'Đóng' })).toBeDisabled()

    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    await expect(dialog, 'Escape không được đóng hộp giữa lúc lưu').toBeVisible()

    await expect.poll(() => release !== null).toBe(true)
    release!()
    await expect(dialog.getByText('E2E: tên đăng nhập đã tồn tại')).toBeVisible()
    await expect(dialog).not.toHaveAttribute('aria-busy', 'true')

    // Nút submit bị disabled lúc lưu làm trình duyệt đẩy focus về <body>. Dựng đúng
    // trạng thái đó một cách xác định (không phụ thuộc trình duyệt có blur hay không),
    // rồi Escape vẫn phải đóng hộp — một handler chỉ gắn trên hộp sẽ trượt ở đây.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true)
    await page.keyboard.press('Escape')
    await expectClosedCleanly(page, dialog, opener, inertBefore)
  })

  test('nút mở bị gỡ (đổi trạng thái tải lại bảng): Escape trả focus về nút vẽ lại của đúng hàng, không về <body>', async ({ page }) => {
    const stamp = Date.now()
    const submit = await page.request.post('/api/submissions', {
      data: {
        formTitle: 'E2E hộp thoại',
        recipientEmail: '',
        answers: [
          { id: 'name', label: 'Họ và tên', value: `E2E Focus ${stamp}`, map: 'name', type: 'text', required: true },
          { id: 'phone', label: 'Số điện thoại', value: '0901234567', map: 'phone', type: 'tel', required: true },
          { id: 'message', label: 'Nội dung', value: `Kiểm tra trả focus ${stamp}`, map: 'message', type: 'textarea', required: true },
        ],
      },
    })
    expect(submit.status(), await submit.text()).toBe(200)
    const id = ((await submit.json()) as { id: number }).id

    await page.goto('/admin/submissions')
    const opener = page.locator(`[data-admin-modal-opener="submission-${id}"]`)
    await expect(opener).toBeVisible({ timeout: 20_000 })
    await page.waitForLoadState('networkidle')
    // Đánh dấu ĐÚNG phần tử này để chứng minh nó bị gỡ và vẽ lại.
    await opener.evaluate(el => el.setAttribute('data-e2e-original', ''))
    const dialog = await openWithKeyboard(page, opener, `Chi tiết Đơn đăng ký #${id}`)

    const reloaded = page.waitForResponse(r => r.request().method() === 'GET' && new URL(r.url()).pathname === '/api/admin/submissions')
    await dialog.getByRole('button', { name: 'Đang xử lý', exact: true }).click()
    expect((await reloaded).status()).toBe(200)
    await expect(opener, 'bảng tải lại phải vẽ lại nút (phần tử mới, không còn dấu)').not.toHaveAttribute('data-e2e-original', '')
    await expect(dialog).not.toHaveAttribute('aria-busy', 'true')

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(opener, 'focus về nút "Xem & xử lý" của đúng hàng sau khi vẽ lại').toBeFocused()
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false)
  })

  test('sửa người dùng: tên hộp gồm tên đăng nhập, Escape trả focus về nút Sửa của hàng', async ({ page }) => {
    await page.goto('/admin/users')
    await page.waitForLoadState('networkidle')
    const inertBefore = await inertElements(page)
    const opener = page.getByTitle('Chỉnh sửa tài khoản').first()
    await expect(opener).toBeVisible()
    const dialog = await openWithKeyboard(page, opener, /^Chỉnh sửa Tài khoản: .+/)
    await expectTabTrapped(page, dialog)
    await page.keyboard.press('Escape')
    await expectClosedCleanly(page, dialog, opener, inertBefore)
  })

  test('danh mục: hộp tạo danh mục là hộp thoại modal, Escape đóng + trả focus', async ({ page }) => {
    await page.goto('/admin/content/categories')
    await expect(page.getByRole('heading', { level: 1, name: 'Quản lý Danh mục' })).toBeVisible()
    await page.waitForLoadState('networkidle')
    const inertBefore = await inertElements(page)
    const opener = page.getByRole('button', { name: 'Tạo Danh Mục Mới' })
    const dialog = await openWithKeyboard(page, opener, 'Tạo Danh Mục Mới')
    await expect(dialog.getByPlaceholder('Vd: Tin hoạt động C11')).toBeFocused()
    await expectTabTrapped(page, dialog)
    await page.keyboard.press('Escape')
    await expectClosedCleanly(page, dialog, opener, inertBefore)
  })

  test('giữ Enter để mở ngăn kéo "Phiên bản": phím thả trong ô nhập không lưu bản sao lưu nào', async ({ page }) => {
    await page.goto(`/admin/content/pages/${await firstPageId(page)}`)
    const opener = page.getByRole('button', { name: 'Phiên bản', exact: true })
    await expect(opener).toBeVisible({ timeout: 20_000 })
    await page.waitForLoadState('networkidle')

    const posts: string[] = []
    page.on('request', r => { if (r.method() === 'POST' && isVersionsPath(r.url())) posts.push(r.url()) })
    const drawer = await openWithHeldEnter(page, opener, /^Phiên bản$/)
    // Điều kiện để lỗi xảy ra: focus đầu tiên là ô tên bản sao lưu.
    await expect(drawer.getByPlaceholder('Tên bản sao lưu…')).toBeFocused()
    await networkBarrier(page)
    expect(posts, 'mở ngăn kéo không được tự lưu một bản sao lưu (mất 1/4 chỗ)').toEqual([])

    // Enter do người dùng gõ TRONG ô vẫn lưu như trước.
    const saved = page.waitForResponse(r => r.request().method() === 'POST' && isVersionsPath(r.url()))
    await drawer.getByPlaceholder('Tên bản sao lưu…').fill(`E2E giữ phím ${Date.now()}`)
    await page.keyboard.press('Enter')
    expect((await saved).status()).toBe(200)
    expect(posts).toHaveLength(1)
  })

  test('giữ Enter để mở hộp "Bật …" ở hồ sơ: không báo lỗi "chưa nhập mật khẩu" khi chưa gõ gì', async ({ page }) => {
    await page.goto('/admin/profile')
    const opener = page.locator('button:not([disabled])', { hasText: /^\s*Bật\s*$/ }).first()
    await expect(opener).toBeVisible({ timeout: 20_000 })
    await page.waitForLoadState('networkidle')
    const dialog = await openWithHeldEnter(page, opener, /^Bật /)
    await expect(dialog.locator('input[type="password"]').first()).toBeFocused()
    await networkBarrier(page)
    await expect(dialog.getByRole('alert'), 'phím thả lúc mở hộp không được gửi biểu mẫu trống').toHaveCount(0)
  })

  test('giữ Enter trên nút "Khôi phục": hộp xác nhận (focus ở nút đồng ý) không tự đồng ý', async ({ page }) => {
    await page.goto(`/admin/content/pages/${await firstPageId(page)}`)
    const opener = page.getByRole('button', { name: 'Phiên bản', exact: true })
    await expect(opener).toBeVisible({ timeout: 20_000 })
    await page.waitForLoadState('networkidle')
    const initialList = page.waitForResponse(r => r.request().method() === 'GET' && isVersionsPath(r.url()))
    await opener.click()
    const drawer = page.getByRole('dialog', { name: /^Phiên bản$/ })
    expect((await initialList).status()).toBe(200)

    const label = `E2E khôi phục ${Date.now()}`
    await drawer.getByPlaceholder('Tên bản sao lưu…').fill(label)
    const reloaded = page.waitForResponse(r => r.request().method() === 'GET' && isVersionsPath(r.url()))
    await drawer.getByRole('button', { name: /^Lưu \(\d\/4\)$/ }).click()
    expect((await reloaded).status()).toBe(200)
    const restoreButton = drawer.getByRole('button', { name: `Xóa phiên bản ${label}` }).locator('xpath=preceding-sibling::button')
    await expect(restoreButton).toHaveText(/Khôi phục/)

    const restores: string[] = []
    page.on('request', r => { if (r.method() === 'POST' && /\/versions\/\d+\/restore$/.test(new URL(r.url()).pathname)) restores.push(r.url()) })
    const confirmDialog = await openWithHeldEnter(page, restoreButton, 'Khôi phục phiên bản')
    // Hộp xác nhận không nguy hiểm mở ra ở nút đồng ý — đúng chỗ phím lặp rơi vào.
    await expect(confirmDialog.getByRole('button', { name: 'Khôi phục', exact: true })).toBeFocused()
    await networkBarrier(page)
    expect(restores, 'phím giữ từ nút "Khôi phục" không được tự đồng ý nạp phiên bản').toEqual([])
    await expect(confirmDialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(confirmDialog).toHaveCount(0)
    await expect(drawer).toBeVisible()
  })

  test('hộp xác nhận mở đè lên ngăn kéo "Phiên bản": Escape chỉ đóng hộp xác nhận, ngăn kéo giữ bàn phím lại', async ({ page }) => {
    await page.goto(`/admin/content/pages/${await firstPageId(page)}`)
    const opener = page.getByRole('button', { name: 'Phiên bản', exact: true })
    await expect(opener).toBeVisible({ timeout: 20_000 })
    await page.waitForLoadState('networkidle')
    const inertBefore = await inertElements(page)
    // Danh sách phiên bản tải sau khi mở: chờ nó xong TRƯỚC khi lưu, để lượt tải đầu
    // không đè lên danh sách mới (không phụ thuộc thứ tự phản hồi).
    const initialList = page.waitForResponse(r => r.request().method() === 'GET' && isVersionsPath(r.url()))
    const drawer = await openWithKeyboard(page, opener, /^Phiên bản$/)
    expect((await initialList).status()).toBe(200)
    // Bộ chọn CSS (không theo vai trò): lúc bị `inert`, ngăn kéo rời cây truy cập.
    const drawerRoot = page.locator(`[role="dialog"][aria-labelledby="${await drawer.getAttribute('aria-labelledby')}"]`)

    // Tạo một bản sao lưu để có nút xoá (mở ConfirmModal).
    const label = `E2E chồng hộp ${Date.now()}`
    await drawer.getByPlaceholder('Tên bản sao lưu…').fill(label)
    const saved = page.waitForResponse(r => r.request().method() === 'POST' && isVersionsPath(r.url()))
    const reloaded = page.waitForResponse(r => r.request().method() === 'GET' && isVersionsPath(r.url()))
    await drawer.getByRole('button', { name: /^Lưu \(\d\/4\)$/ }).click()
    expect((await saved).status()).toBe(200)
    expect((await reloaded).status()).toBe(200)
    const deleteButton = drawer.getByRole('button', { name: `Xóa phiên bản ${label}` })
    await expect(deleteButton).toBeVisible()

    await deleteButton.click()
    const confirmDialog = page.getByRole('dialog', { name: 'Xóa phiên bản', exact: true })
    await expect(confirmDialog).toBeVisible()
    await expect.poll(() => focusInside(confirmDialog), { message: 'hộp xác nhận phải giữ focus' }).toBe(true)
    // Ngăn kéo bên dưới nhường bàn phím: bị `inert` trong lúc hộp xác nhận mở.
    expect(await drawerRoot.evaluate(el => el.hasAttribute('inert'))).toBe(true)

    await page.keyboard.press('Escape')
    await expect(confirmDialog).toHaveCount(0)
    await expect(drawer, 'Escape trên hộp xác nhận không được đóng luôn ngăn kéo').toBeVisible()
    expect(await drawerRoot.evaluate(el => el.hasAttribute('inert')), 'đóng hộp xác nhận phải gỡ inert khỏi ngăn kéo').toBe(false)
    await expect(deleteButton, 'focus về nút đã mở hộp xác nhận (trong ngăn kéo)').toBeFocused()
    await expect(deleteButton, 'Hủy xác nhận thì không xoá').toBeVisible()
    await expectTabTrapped(page, drawer)

    await page.keyboard.press('Escape')
    await expectClosedCleanly(page, drawer, opener, inertBefore)
  })

  test('thư viện ảnh (mount sẵn trong layout): có tên, focus vào ô tìm kiếm được chỉ định, Enter tìm, Escape đóng + trả focus', async ({ page }) => {
    await page.goto('/admin/content/articles/new')
    const opener = page.getByRole('button', { name: 'Chọn từ thư viện' })
    await expect(opener).toBeVisible({ timeout: 20_000 })
    await page.waitForLoadState('networkidle')
    const inertBefore = await inertElements(page)

    // Đếm TỪ TRƯỚC khi mở: phím giữ (lặp + thả) rơi vào ô tìm kiếm ngay khi hộp mở.
    let mediaRequests = 0
    page.on('request', r => { if (new URL(r.url()).pathname === '/api/admin/media') mediaRequests += 1 })
    const firstLoad = page.waitForResponse(r => new URL(r.url()).pathname === '/api/admin/media')
    const dialog = await openWithHeldEnter(page, opener, 'Thư viện ảnh')
    expect((await firstLoad).status()).toBe(200)
    // `data-autofocus` thắng thứ tự: ô tìm kiếm nhận focus đầu tiên.
    const search = dialog.getByRole('textbox', { name: 'Tìm ảnh theo tên file' })
    await expect(search).toBeFocused()
    await networkBarrier(page)
    expect(mediaRequests, 'chỉ một lượt tải lúc mở; phím Enter giữ từ nút mở không được chạy tìm kiếm').toBe(1)
    // Enter do người dùng gõ trong ô vẫn tìm.
    const searched = page.waitForResponse(r => new URL(r.url()).pathname === '/api/admin/media' && new URL(r.url()).searchParams.get('search') === 'khong-co-anh-nay')
    await search.fill('khong-co-anh-nay')
    await page.keyboard.press('Enter')
    expect((await searched).status()).toBe(200)

    await expectTabTrapped(page, dialog)
    await page.keyboard.press('Escape')
    await expectClosedCleanly(page, dialog, opener, inertBefore)
  })

  test('cấu hình trang: hộp "Cấu hình trang" của trình dựng trang, Escape đóng + trả focus', async ({ page }) => {
    await page.goto(`/admin/content/pages/${await firstPageId(page)}`)
    const opener = page.getByRole('button', { name: 'Cấu hình', exact: true })
    await expect(opener).toBeVisible({ timeout: 20_000 })
    await page.waitForLoadState('networkidle')
    const inertBefore = await inertElements(page)
    const dialog = await openWithKeyboard(page, opener, 'Cấu hình trang')
    await expectTabTrapped(page, dialog)
    await page.keyboard.press('Escape')
    await expectClosedCleanly(page, dialog, opener, inertBefore)
  })

  test('ngôn ngữ: hộp "chuyển đến vị trí nào?" — có tên, focus trong hộp, Tab bị bẫy, Escape đóng + trả focus', async ({ page }) => {
    await page.goto('/admin/languages')
    await page.waitForLoadState('networkidle')
    const mover = page.locator('button[title="Bấm để chuyển đổi vị trí thứ tự"]').first()
    await expect(mover).toBeVisible({ timeout: 20_000 })
    const inertBefore = await inertElements(page)
    const dialog = await openWithKeyboard(page, mover, /chuyển đến vị trí nào\?$/)
    await expectTabTrapped(page, dialog)
    await page.keyboard.press('Escape')
    await expectClosedCleanly(page, dialog, mover, inertBefore)
  })

  test('dịch toàn bộ bài viết: có tên, focus trong hộp, Tab bị bẫy, Escape đóng + trả focus', async ({ page }) => {
    await page.goto('/admin/content/articles')
    await page.waitForLoadState('networkidle')
    const opener = page.getByRole('button', { name: 'Dịch toàn bộ bài viết' }).first()
    await expect(opener).toBeVisible({ timeout: 20_000 })
    const inertBefore = await inertElements(page)
    const stats = page.waitForResponse(r => r.request().method() === 'GET' && new URL(r.url()).pathname === '/api/admin/articles/translation-stats')
    const dialog = await openWithKeyboard(page, opener, 'Dịch toàn bộ bài viết bằng AI')
    // Thống kê tải xong mới đếm điều khiển (danh sách ngôn ngữ hiện ra trong thân).
    expect((await stats).status()).toBe(200)
    await expectTabTrapped(page, dialog)
    await page.keyboard.press('Escape')
    await expectClosedCleanly(page, dialog, opener, inertBefore)
  })

  test('xoá phiên bản qua hộp xác nhận trong ngăn kéo: hàng bị gỡ thì focus vẫn ở trong ngăn kéo', async ({ page }) => {
    await page.goto(`/admin/content/pages/${await firstPageId(page)}`)
    const opener = page.getByRole('button', { name: 'Phiên bản', exact: true })
    await expect(opener).toBeVisible({ timeout: 20_000 })
    await page.waitForLoadState('networkidle')
    const initialList = page.waitForResponse(r => r.request().method() === 'GET' && isVersionsPath(r.url()))
    await opener.click()
    const drawer = page.getByRole('dialog', { name: /^Phiên bản$/ })
    expect((await initialList).status()).toBe(200)
    const label = `E2E xoá ${Date.now()}`
    await drawer.getByPlaceholder('Tên bản sao lưu…').fill(label)
    const saved = page.waitForResponse(r => r.request().method() === 'GET' && isVersionsPath(r.url()))
    await drawer.getByRole('button', { name: /^Lưu \(\d\/4\)$/ }).click()
    expect((await saved).status()).toBe(200)

    const del = drawer.getByRole('button', { name: `Xóa phiên bản ${label}` })
    await del.focus()
    await page.keyboard.press('Enter')
    const confirmDialog = page.getByRole('dialog', { name: 'Xóa phiên bản', exact: true })
    // Thao tác nguy hiểm mở ra ở "Hủy"; Tab sang "Xóa" rồi Enter.
    await expect(confirmDialog.getByRole('button', { name: 'Hủy' })).toBeFocused()
    await page.keyboard.press('Tab')
    const deleted = page.waitForResponse(r => r.request().method() === 'DELETE')
    const reloaded = page.waitForResponse(r => r.request().method() === 'GET' && isVersionsPath(r.url()))
    await page.keyboard.press('Enter')
    expect((await deleted).status()).toBe(200)
    expect((await reloaded).status()).toBe(200)
    await expect(del, 'hàng phiên bản đã xoá').toHaveCount(0)
    // Nút xoá đang giữ focus bị gỡ khỏi DOM: focus không được rơi về <body>.
    await expect.poll(() => focusInside(drawer), { message: 'ngăn kéo còn mở thì focus phải ở trong nó' }).toBe(true)
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
    await expect(opener).toBeFocused()
  })

  test('sửa người dùng rồi lưu: bảng tải lại, focus về đúng nút "Sửa" của hàng vừa vẽ lại', async ({ page }) => {
    const stamp = Date.now()
    const role = await page.request.post('/api/admin/roles', { data: { name: `e2e_focus_role_${stamp}`, permissions: [{ resource: 'media_portal', canRead: true }] } })
    expect(role.status(), await role.text()).toBe(200)
    const account = await page.request.post('/api/admin/users', {
      data: { username: `e2e_focus_${stamp}`, password: 'OnlyRead#72Media!', roleId: ((await role.json()) as { id: number }).id },
    })
    expect(account.status(), await account.text()).toBe(200)
    const list = (await (await page.request.get('/api/admin/users')).json()) as { users: Array<{ id: number; username: string }> }
    const userId = list.users.find(u => u.username === `e2e_focus_${stamp}`)!.id

    await page.goto('/admin/users')
    await page.waitForLoadState('networkidle')
    const opener = page.locator(`[data-admin-modal-opener="user-${userId}"]:visible`)
    await expect(opener).toBeVisible({ timeout: 20_000 })
    await opener.evaluate(el => el.setAttribute('data-e2e-original', ''))
    const dialog = await openWithKeyboard(page, opener, /^Chỉnh sửa Tài khoản: /)

    const reloaded = page.waitForResponse(r => r.request().method() === 'GET' && new URL(r.url()).pathname === '/api/admin/users')
    await dialog.getByRole('button', { name: 'Cập Nhật Tài Khoản' }).click()
    expect((await reloaded).status()).toBe(200)
    await expect(dialog).toHaveCount(0)
    await expect(opener, 'bảng tải lại phải vẽ lại nút (phần tử mới)').not.toHaveAttribute('data-e2e-original', '')
    await expect(opener, 'focus về nút "Sửa" của đúng hàng sau khi vẽ lại').toBeFocused()
  })

  test('tiến trình dịch AI: dịch xong khi hộp đang mở (nút "Dừng lại" biến mất) → focus vẫn trong hộp', async ({ page }) => {
    const { opener, release } = await languagesWithHeldTranslation(page)
    await opener.click()
    const progress = page.getByRole('dialog', { name: /^Tiến trình Dịch AI/ })
    await expect(progress).toHaveAttribute('aria-busy', 'true')
    const stop = progress.getByRole('button', { name: 'Dừng lại' })
    await expect(stop, 'đang dịch: focus ở nút đầu tiên của chân hộp').toBeFocused()
    // Đang bận: Escape không đóng.
    await page.keyboard.press('Escape')
    await expect(progress).toBeVisible()
    release()
    await expect(progress.getByRole('button', { name: 'Hoàn tất & Đóng' })).toBeVisible({ timeout: 15_000 })
    await expect(stop).toHaveCount(0)
    await expect.poll(() => focusInside(progress), { message: 'nút đang giữ focus biến mất: focus phải ở lại trong hộp' }).toBe(true)
    await progress.getByRole('button', { name: 'Hoàn tất & Đóng' }).click()
    await expect(progress).toHaveCount(0)
    await expect.poll(() => focusIsNotBody(page)).toBe(true)
  })

  test('tiến trình dịch AI: đóng bằng "Đóng cửa sổ" lúc đang dịch (nút mở đang disabled) → focus không về <body>', async ({ page }) => {
    const { opener, release } = await languagesWithHeldTranslation(page)
    await opener.click()
    const progress = page.getByRole('dialog', { name: /^Tiến trình Dịch AI/ })
    await expect(progress).toHaveAttribute('aria-busy', 'true')
    await expect(opener, 'nút mở bị khoá trong lúc dịch').toBeDisabled()
    await progress.getByRole('button', { name: 'Đóng cửa sổ' }).click()
    await expect(progress).toHaveCount(0)
    await expect.poll(() => focusIsNotBody(page), { message: 'nút mở disabled không nhận focus — phải lùi về <main>' }).toBe(true)
    release()
    // Dịch xong, nút mở bật lại (trong cửa sổ chờ): focus đang đỗ thì chuyển về nút.
    await expect(opener).toBeEnabled({ timeout: 15_000 })
    await expect(opener).toBeFocused()
  })

  test('xem nhanh bản dịch (mở từ chip không nhận focus) và nhắc dịch lại: đóng xong focus không về <body>', async ({ page }) => {
    const stamp = Date.now()
    const created = await page.request.post('/api/admin/articles', {
      data: { title: `E2E hộp thoại ${stamp}`, slug: `e2e-hop-thoai-${stamp}`, type: 'news', content: '<p>Nội dung E2E</p>', excerpt: 'tóm tắt', status: 'published' },
    })
    expect(created.status(), await created.text()).toBe(200)
    const articleId = ((await created.json()) as { id: number }).id
    const connection = await mysql.createConnection(e2eDbConfig())
    try {
      await connection.query(
        "INSERT INTO article_translations (article_id, lang_code, title, excerpt, content, status, translated_by) VALUES (?, 'en', 'E2E EN title', 'E2E', '<p>E2E body</p>', 'reviewed', 'ai')",
        [articleId],
      )
    } finally {
      await connection.end()
    }

    await page.goto('/admin/content/articles')
    await page.waitForLoadState('networkidle')
    const chip = page.locator('tr', { hasText: `E2E hộp thoại ${stamp}` }).locator('span[title^="EN:"]')
    await expect(chip).toBeVisible({ timeout: 20_000 })
    await chip.click()
    const quickView = page.getByRole('dialog', { name: /^Bản dịch / })
    await expect(quickView).toBeVisible()
    await expect.poll(() => focusInside(quickView)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(quickView).toHaveCount(0)
    await expect.poll(() => focusIsNotBody(page), { message: 'chip <span> không nhận focus — phải lùi về <main>' }).toBe(true)
    // Mở lại ngay trong lúc focus đang đỗ ở <main>: <main> không được nhớ làm nút mở.
    await chip.click()
    await expect(quickView).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(quickView).toHaveCount(0)
    await expect.poll(() => focusIsNotBody(page), { message: 'nơi đỗ tạm bị nhớ làm nút mở → focus rơi về <body>' }).toBe(true)

    // Nhắc dịch lại: mở sau khi lưu bài đổi nội dung tiếng Việt.
    await page.goto(`/admin/content/articles/${articleId}`)
    const title = page.getByPlaceholder('Nhập tiêu đề hấp dẫn...')
    await expect(title).toBeVisible({ timeout: 20_000 })
    await page.waitForLoadState('networkidle')
    await title.fill(`E2E hộp thoại ${stamp} sửa`)
    await page.getByRole('button', { name: /Cập Nhật Bài Viết/ }).click()
    const prompt = page.getByRole('dialog', { name: 'Phát hiện nội dung Tiếng Việt vừa thay đổi!' })
    await expect(prompt).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => focusInside(prompt)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(prompt).toHaveCount(0)
    await expect.poll(() => focusIsNotBody(page)).toBe(true)
  })
})
