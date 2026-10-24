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

  test('hộp xác nhận mở đè lên ngăn kéo "Phiên bản": Escape chỉ đóng hộp xác nhận, ngăn kéo giữ bàn phím lại', async ({ page }) => {
    const list = await page.request.get('/api/admin/pages')
    expect(list.status()).toBe(200)
    const { items } = (await list.json()) as { items: Array<{ id: number }> }
    expect(items.length).toBeGreaterThan(0)

    await page.goto(`/admin/content/pages/${items[0]!.id}`)
    const opener = page.getByRole('button', { name: 'Phiên bản', exact: true })
    await expect(opener).toBeVisible({ timeout: 20_000 })
    await page.waitForLoadState('networkidle')
    const inertBefore = await inertElements(page)
    const drawer = await openWithKeyboard(page, opener, /^Phiên bản$/)
    // Bộ chọn CSS (không theo vai trò): lúc bị `inert`, ngăn kéo rời cây truy cập.
    const drawerRoot = page.locator(`[role="dialog"][aria-labelledby="${await drawer.getAttribute('aria-labelledby')}"]`)

    // Tạo một bản sao lưu để có nút xoá (mở ConfirmModal).
    const label = `E2E chồng hộp ${Date.now()}`
    await drawer.getByPlaceholder('Tên bản sao lưu…').fill(label)
    await drawer.getByRole('button', { name: /^Lưu \(\d\/4\)$/ }).click()
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

  test('cấu hình trang: hộp "Cấu hình trang" của trình dựng trang, Escape đóng + trả focus', async ({ page }) => {
    const list = await page.request.get('/api/admin/pages')
    expect(list.status()).toBe(200)
    const { items } = (await list.json()) as { items: Array<{ id: number }> }
    expect(items.length, 'cần ít nhất một trang (trang hệ thống được seed)').toBeGreaterThan(0)

    await page.goto(`/admin/content/pages/${items[0]!.id}`)
    const opener = page.getByRole('button', { name: 'Cấu hình', exact: true })
    await expect(opener).toBeVisible({ timeout: 20_000 })
    await page.waitForLoadState('networkidle')
    const inertBefore = await inertElements(page)
    const dialog = await openWithKeyboard(page, opener, 'Cấu hình trang')
    await expectTabTrapped(page, dialog)
    await page.keyboard.press('Escape')
    await expectClosedCleanly(page, dialog, opener, inertBefore)
  })
})
