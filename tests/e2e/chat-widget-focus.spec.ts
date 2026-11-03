/**
 * Chat dialog focus on a phone (spec public-accessibility, design D24).
 *
 * Before: opening focused the desktop close button (`hidden md:flex`), so on a
 * 375 px screen focus stayed on the page behind the full-screen dialog; the page
 * behind stayed reachable; Escape only worked with focus inside; focus "returned"
 * to the desktop launcher, which is not shown on phones. Source guards in
 * `tests/chat-widget-dialog-a11y.test.ts` show the wiring; this shows the result.
 */
import { expect, test, type Page } from '@playwright/test'

const LOADING_TEXT = 'Đang tải...'
const DIALOG = '#public-chatbot-dialog'

/** Focus is on a shown control inside the dialog. */
const focusInsideDialogVisible = (page: Page) =>
  page.evaluate((selector) => {
    const dialog = document.querySelector(selector)
    const active = document.activeElement as HTMLElement | null
    return !!dialog && !!active && active !== document.body && dialog.contains(active) && active.getClientRects().length > 0
  }, DIALOG)

/** Elements marked inert outside the dialog. */
const inertOutsideDialog = (page: Page) =>
  page.evaluate((selector) => {
    const dialog = document.querySelector(selector)
    return [...document.querySelectorAll('[inert]')].filter(el => el !== dialog && !dialog?.contains(el)).length
  }, DIALOG)

async function openNews(page: Page) {
  await page.goto(`/news?e2e=chatfocus${Date.now()}`)
  await expect(page.getByText(LOADING_TEXT, { exact: true })).toHaveCount(0, { timeout: 20_000 })
  await page.waitForLoadState('networkidle')
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('launcher: open focuses inside; Tab from outside lands inside; Escape returns focus to the launcher', async ({ page }) => {
    await openNews(page)
    const launcher = page.locator('button.chatbot-toggle-btn')
    await launcher.click()
    await expect(page.locator(DIALOG)).toHaveAttribute('aria-hidden', 'false')
    await expect.poll(() => focusInsideDialogVisible(page), { message: 'desktop open did not focus a control inside the dialog' }).toBe(true)

    // Focus outside the dialog (the launcher itself is inert while open, so it
    // drops to <body>): Tab must land inside the dialog, not on the page behind.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Tab')
    expect(await focusInsideDialogVisible(page), 'Tab from outside reached the page behind the dialog').toBe(true)
    await page.keyboard.press('Shift+Tab')
    expect(await focusInsideDialogVisible(page)).toBe(true)

    await page.keyboard.press('Escape')
    await expect(page.locator(DIALOG)).toHaveAttribute('aria-hidden', 'true')
    await expect(launcher).toBeFocused()
  })
})

test.describe('phone', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('open focuses a visible control inside, the page behind is inert, Escape from anywhere returns focus to the opener', async ({ page }) => {
    await openNews(page)
    const inertBefore = await inertOutsideDialog(page)

    // The phone's opener: the chatbot button of the bottom navigation (its label
    // comes from the translations table, so match its start, not the whole text).
    const opener = page.getByRole('navigation', { name: 'Điều hướng nhanh' }).getByRole('button', { name: /^Hỏi trợ lý/ })
    await opener.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator(DIALOG)).toHaveAttribute('aria-hidden', 'false')
    await expect.poll(() => focusInsideDialogVisible(page), { message: 'focus did not move to a visible control inside the dialog' }).toBe(true)

    // The page behind is inert: the main landmark cannot be reached.
    expect(await page.evaluate(() => !!document.getElementById('main-content')?.closest('[inert]'))).toBe(true)

    // Tab and Shift+Tab never leave the dialog.
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab')
      expect(await focusInsideDialogVisible(page), `Tab #${i + 1} left the dialog`).toBe(true)
    }

    // Escape with focus nowhere in particular still closes (window-level listener).
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Escape')
    await expect(page.locator(DIALOG)).toHaveAttribute('aria-hidden', 'true')
    await expect.poll(() => inertOutsideDialog(page), { message: 'closing must remove every inert it set' }).toBe(inertBefore)
    await expect(opener).toBeFocused()
  })
})
