/**
 * The role-models carousel's pause/play control works on touch and with a mouse
 * (spec public-accessibility, design D23).
 *
 * Found by independent verification of 9cf1bb8 on a 390 px touch screen: tapping
 * "Tạm dừng" did NOT pause. The carousel root's `touchstart` ran first and set
 * the visitor's wish to "paused", then the button's click toggled it straight
 * back to "playing" — label unchanged, slides kept moving. Source guards and
 * unit tests of the gate alone could not see the order of DOM events; this does.
 */
import mysql from 'mysql2/promise'
import { expect, test, type Page } from '@playwright/test'
import { e2eDbConfig } from './harness'

const stamp = `${Date.now()}`
const tag = `E2ECR${stamp}`
const SLUG_PREFIX = `${tag.toLowerCase()}-guong`
const PAUSE = 'Tạm dừng tự chuyển slide'
const PLAY = 'Tiếp tục tự chuyển slide'
const LOADING_TEXT = 'Đang tải...'

let connection: mysql.Connection

test.beforeAll(async () => {
  connection = await mysql.createConnection(e2eDbConfig())
  // Enough slides that the track scrolls at phone and desktop widths.
  for (let i = 0; i < 8; i += 1) {
    await connection.execute(
      `INSERT INTO articles (type, title, slug, excerpt, content, status, published_at)
       VALUES ('role_model', ?, ?, 'Trích đoạn', '<p>Nội dung</p>', 'published', DATE_SUB(NOW(), INTERVAL ? MINUTE))`,
      [`${tag} Tấm gương ${i}`, `${SLUG_PREFIX}-${i}`, i + 1])
  }
})

test.afterAll(async () => {
  await connection.execute('DELETE FROM articles WHERE slug LIKE ?', [`${SLUG_PREFIX}-%`])
  await connection.end()
})

async function openHome(page: Page) {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto(`/?e2e=carousel${Date.now()}`)
  await expect(page.getByText(LOADING_TEXT, { exact: true })).toHaveCount(0, { timeout: 20_000 })
  await page.waitForLoadState('networkidle')
}

/** scrollLeft of the track that belongs to the carousel holding the pause/play control. */
const trackLeft = (page: Page) => page.evaluate(([pause, play]) => {
  const control = document.querySelector(`button[aria-label="${pause}"], button[aria-label="${play}"]`)
  const track = control?.closest('.relative')?.querySelector<HTMLElement>('.overflow-x-auto')
  return track ? track.scrollLeft : -1
}, [PAUSE, PLAY])

/** Longer than one 3.5 s autoplay step, so a running carousel must have moved. */
const QUIET_MS = 4_500

/** Is keyboard focus anywhere inside the carousel (its root holds the control)? */
const focusInsideCarousel = (page: Page) => page.evaluate(([pause, play]) => {
  const control = document.querySelector(`button[aria-label="${pause}"], button[aria-label="${play}"]`)
  const root = control?.closest('.relative')
  return !!root && !!document.activeElement && root.contains(document.activeElement)
}, [PAUSE, PLAY])

/**
 * The section heading above the carousel: inside the block, outside the carousel
 * root, and not focusable — pressing it moves focus out of the carousel. Without
 * this the "stays still" check would also pass through the focus pause (focus
 * stays on the control after pressing it), proving nothing about the control.
 */
const sectionHeading = (page: Page) => page.locator('section')
  .filter({ has: page.locator(`button[aria-label="${PAUSE}"], button[aria-label="${PLAY}"]`) })
  .locator('h2').first()

test.describe('touch screen', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('tapping pause pauses it; tapping play resumes it', async ({ page }) => {
    await openHome(page)
    const pause = page.getByRole('button', { name: PAUSE })
    await pause.scrollIntoViewIfNeeded()
    await pause.tap()
    await expect(page.getByRole('button', { name: PLAY }), 'after tapping pause the control must offer play').toBeVisible()

    // Tap outside the carousel so only the pause itself can be holding it still.
    await sectionHeading(page).tap()
    expect(await focusInsideCarousel(page), 'focus is still inside the carousel').toBe(false)
    const before = await trackLeft(page)
    expect(before).toBeGreaterThanOrEqual(0)
    await page.waitForTimeout(QUIET_MS)
    expect(await trackLeft(page), 'the carousel moved after the visitor tapped pause').toBe(before)

    await page.getByRole('button', { name: PLAY }).tap()
    await expect(page.getByRole('button', { name: PAUSE })).toBeVisible()
    await expect.poll(() => trackLeft(page), { timeout: 8_000, message: 'tapping play did not resume it' }).not.toBe(before)
  })
})

test.describe('mouse', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('pause holds after the pointer leaves; play pressed while still hovering resumes', async ({ page }) => {
    await openHome(page)
    const pause = page.getByRole('button', { name: PAUSE })
    await pause.scrollIntoViewIfNeeded()
    await pause.click()
    await expect(page.getByRole('button', { name: PLAY })).toBeVisible()

    // Leave the carousel with the pointer AND move focus out (click the heading):
    // neither may restart what the visitor paused, and neither can be what holds it.
    await sectionHeading(page).click()
    expect(await focusInsideCarousel(page), 'focus is still inside the carousel').toBe(false)
    const before = await trackLeft(page)
    await page.waitForTimeout(QUIET_MS)
    expect(await trackLeft(page), 'leaving the carousel restarted it').toBe(before)

    // The pointer stays over the carousel after this click: the explicit play wins.
    await page.getByRole('button', { name: PLAY }).click()
    await expect(page.getByRole('button', { name: PAUSE })).toBeVisible()
    await expect.poll(() => trackLeft(page), { timeout: 8_000, message: 'play pressed while hovering did not resume it' }).not.toBe(before)
  })
})
