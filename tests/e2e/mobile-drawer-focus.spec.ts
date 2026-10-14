/**
 * Ngăn kéo điều hướng mobile là một hộp thoại modal THẬT trong trình duyệt THẬT.
 *
 * Lỗi đã gặp (bộ kiểm chứng độc lập, Chrome thật, khung 390px): mở ngăn kéo bằng
 * Enter/Space/bấm chuột thì `document.activeElement` vẫn nằm ở nút "Mở menu" suốt
 * 1 giây. Nguyên nhân: lúc `nextTick` ngăn kéo còn `visibility:hidden` (visibility
 * nằm trong `transition-property` cả khi MỞ, nên tới khung hình đầu của hiệu ứng nó
 * vẫn `hidden`), và `focus()` lên một cây đang ẩn bị trình duyệt lặng lẽ bỏ qua.
 * `tests/mobile-drawer-a11y.test.ts` chỉ đọc mã nguồn nên xanh cả khi lỗi còn đó —
 * spec này là bằng chứng hành vi duy nhất.
 *
 * Cùng spec khoá luôn tính modal: Tab/Shift+Tab không rời ngăn kéo, phần còn lại của
 * trang `inert` khi mở và được trả lại NGUYÊN VẸN khi đóng (một `inert` sót lại làm
 * cả trang chết), ô tìm kiếm trong ngăn kéo có tên truy cập.
 */
import { expect, test, type Page } from '@playwright/test'

const LOADING_TEXT = 'Đang tải...'
const TRIGGER = 'button[aria-controls="mobile-drawer"]'

test.use({ viewport: { width: 390, height: 844 } })

async function openNews(page: Page, reducedMotion: 'reduce' | 'no-preference') {
  await page.emulateMedia({ reducedMotion })
  await page.goto(`/news?e2e=drawer${Date.now()}`)
  // Hydrate xong = lớp phủ tải đầu đã bị gỡ (app.vue gỡ trong onMounted).
  await expect(page.getByText(LOADING_TEXT, { exact: true })).toHaveCount(0, { timeout: 20_000 })
  await page.waitForLoadState('networkidle')
  inertBefore = await inertOutsideDrawer(page)
}

/** Focus đang nằm trong ngăn kéo (và không phải <body>). */
const focusInsideDrawer = (page: Page) =>
  page.evaluate(() => {
    const drawer = document.getElementById('mobile-drawer')
    const active = document.activeElement
    return !!drawer && !!active && active !== document.body && drawer.contains(active)
  })

/** Mô tả ngắn của phần tử đang giữ focus — để thông báo lỗi đọc được. */
const activeLabel = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null
    if (!a) return 'null'
    return `${a.tagName.toLowerCase()}[${a.getAttribute('aria-label') || a.textContent?.trim().slice(0, 30) || ''}]`
  })

/**
 * Mọi phần tử mang `inert` KHÔNG thuộc ngăn kéo (ngăn kéo đóng tự inert chính nó).
 * Trang vốn có vài phần tử inert của riêng chúng (vd. hộp thoại chatbot đang đóng),
 * nên khẳng định là "trở về ĐÚNG tập trước khi mở", không phải "rỗng".
 */
const inertOutsideDrawer = (page: Page) =>
  page.evaluate(() => {
    const drawer = document.getElementById('mobile-drawer')
    return [...document.querySelectorAll('[inert]')]
      .filter(el => el !== drawer && !drawer?.contains(el))
      .map(el => el.tagName.toLowerCase() + (el.id ? `#${el.id}` : ''))
  })

/** Tập inert trước lượt mở đầu tiên của mỗi test — ghi trong `openNews`. */
let inertBefore: string[] = []

async function expectClosedCleanly(page: Page) {
  await expect(page.locator(TRIGGER)).toHaveAttribute('aria-expanded', 'false')
  await expect.poll(() => inertOutsideDrawer(page), { message: 'đóng ngăn kéo phải gỡ hết inert đã đặt lên trang (và chỉ những cái đó)' }).toEqual(inertBefore)
  await expect.poll(() => activeLabel(page), { message: 'focus phải trở về nút đã mở ngăn kéo' })
    .toBe(await page.locator(TRIGGER).evaluate(el => `button[${el.getAttribute('aria-label')}]`))
}

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test.describe(`ngăn kéo mobile (reducedMotion=${reducedMotion})`, () => {
    for (const how of ['Enter', 'Space', 'click'] as const) {
      test(`mở bằng ${how} → focus vào trong ngăn kéo; Escape → focus về nút mở`, async ({ page }) => {
        await openNews(page, reducedMotion)
        const trigger = page.locator(TRIGGER)
        await trigger.focus()
        if (how === 'click') await trigger.click()
        else await page.keyboard.press(how === 'Enter' ? 'Enter' : ' ')

        await expect(trigger).toHaveAttribute('aria-expanded', 'true')
        await expect.poll(() => focusInsideDrawer(page), { message: 'focus phải vào trong ngăn kéo khi mở', timeout: 2_000 }).toBe(true)

        await page.keyboard.press('Escape')
        await expectClosedCleanly(page)
      })
    }

    test('hộp thoại modal: có vai trò + tên, Tab/Shift+Tab không rời ngăn kéo, trang phía sau inert', async ({ page }) => {
      await openNews(page, reducedMotion)
      await page.locator(TRIGGER).click()
      const drawer = page.locator('#mobile-drawer')
      await expect(drawer).toHaveAttribute('role', 'dialog')
      await expect(drawer).toHaveAttribute('aria-modal', 'true')
      await expect(page.getByRole('dialog', { name: /.+/ })).toHaveCount(1)
      await expect.poll(() => focusInsideDrawer(page)).toBe(true)

      // Ô tìm kiếm trong ngăn kéo có tên truy cập (không chỉ placeholder).
      const search = drawer.locator('input[type="text"]')
      await expect(search).toHaveAttribute('aria-label', /.+/)

      // Phần còn lại của trang không với tới được: main/footer inert.
      expect(await page.evaluate(() => !!document.getElementById('main-content')?.closest('[inert]'))).toBe(true)

      const focusables = await drawer.evaluate(el =>
        el.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), [tabindex="0"]').length)
      const presses = focusables * 2 + 5
      const escapes: string[] = []
      for (let i = 0; i < presses; i += 1) {
        await page.keyboard.press('Tab')
        if (!(await focusInsideDrawer(page))) escapes.push(`Tab#${i + 1} → ${await activeLabel(page)}`)
      }
      for (let i = 0; i < presses; i += 1) {
        await page.keyboard.press('Shift+Tab')
        if (!(await focusInsideDrawer(page))) escapes.push(`Shift+Tab#${i + 1} → ${await activeLabel(page)}`)
      }
      expect(escapes, 'Tab không được rời ngăn kéo đang mở').toEqual([])

      await drawer.getByRole('button', { name: 'Đóng menu' }).click()
      await expectClosedCleanly(page)
    })

    test('đóng bằng nút ✕ và bằng bấm nền mờ → focus về nút mở, không sót inert', async ({ page }) => {
      await openNews(page, reducedMotion)
      const trigger = page.locator(TRIGGER)

      await trigger.focus()
      await page.keyboard.press('Enter')
      await expect.poll(() => focusInsideDrawer(page)).toBe(true)
      await page.locator('#mobile-drawer').getByRole('button', { name: 'Đóng menu' }).press('Enter')
      await expectClosedCleanly(page)

      await trigger.focus()
      await page.keyboard.press('Enter')
      await expect.poll(() => focusInsideDrawer(page)).toBe(true)
      // Nền mờ không có id: bấm vào vùng dưới header, bên trái ngăn kéo (rộng ≤88vw).
      await page.mouse.click(10, 400)
      await expectClosedCleanly(page)
    })

    test('ngăn kéo đóng không có điểm dừng Tab nào', async ({ page }) => {
      await openNews(page, reducedMotion)
      await page.locator('body').focus()
      const landed: string[] = []
      for (let i = 0; i < 40; i += 1) {
        await page.keyboard.press('Tab')
        if (await focusInsideDrawer(page)) landed.push(`Tab#${i + 1} → ${await activeLabel(page)}`)
      }
      expect(landed).toEqual([])
    })
  })
}
