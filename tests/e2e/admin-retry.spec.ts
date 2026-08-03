/**
 * The one thing source-text assertions cannot prove: that clicking "thử lại"
 * actually re-issues the failed request, in a browser, without reloading.
 *
 * `tests/admin-error-retry-ui.test.ts` parses every admin SFC and pins the
 * contract's shape — an error ref, a persistent branch carrying `role="alert"`,
 * a retry `@click` bound to a handler declared in the same file, no
 * `location.reload()`. What it cannot see is behaviour. A handler could be
 * declared and bound and still not clear the error, not re-fetch, or throw on
 * the second call. Every one of those passes the text test and leaves an
 * operator stuck on a dead page.
 *
 * So these specs assert the three things only a browser can answer:
 *   1. a failed fetch produces the error branch, announced as an alert;
 *   2. clicking retry issues a *new* request to the same endpoint;
 *   3. the document was never reloaded — proven with a value written into
 *      `window` before the click, which any navigation would destroy.
 *
 * Two pages are covered, not one. A single page passing could be a page that
 * happens to work; two independently-written pages passing is the pattern
 * holding. `data-retention.vue` is the settings-form shape (`load`) and
 * `submissions/index.vue` is the table shape (`fetchSubmissions`).
 */
import { expect, test, type Page, type Route } from '@playwright/test'
import { E2E_ADMIN_USERNAME, E2E_PASSWORD_ENV } from './harness'

const RELOAD_SENTINEL = '__cdkt_no_reload__'

async function login(page: Page) {
  const password = process.env[E2E_PASSWORD_ENV]
  if (!password) throw new Error(`${E2E_PASSWORD_ENV} is not set — globalSetup did not run`)

  await page.goto('/admin/login')
  // The labels have no `for`, so getByLabel cannot reach these. autocomplete is
  // the stable semantic hook and is what a password manager keys off too.
  await page.fill('input[autocomplete="username"]', E2E_ADMIN_USERNAME)
  await page.fill('input[autocomplete="current-password"]', password)
  await page.click('button[type="submit"]')
  // MFA is opt-in and the seeded account has none, so the password step lands
  // straight on the dashboard.
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Xin chào', { timeout: 20_000 })
}

/**
 * Intercepts one endpoint and hands back the controls. `mode` is flipped by the
 * test rather than by unrouting: a single handler that changes behaviour keeps
 * request accounting in one place, and avoids depending on the order Playwright
 * consults overlapping route handlers.
 */
async function interceptEndpoint(page: Page, pathname: string) {
  const state = { mode: 'fail' as 'fail' | 'pass', requests: 0 }

  await page.route(
    (url) => url.pathname === pathname,
    async (route: Route) => {
      state.requests += 1
      if (state.mode === 'fail') {
        // A 500 is the realistic shape of this failure — the database being
        // unreachable, not the route being absent.
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ statusMessage: 'E2E injected failure' }),
        })
        return
      }
      await route.continue()
    },
  )

  return state
}

/**
 * Marks the document. Any full page load — `location.reload()`, a navigation,
 * a form submit — replaces `window`, so the mark vanishing *is* the reload.
 */
async function markDocument(page: Page) {
  await page.evaluate((key) => { (window as unknown as Record<string, boolean>)[key] = true }, RELOAD_SENTINEL)
}

async function documentSurvived(page: Page) {
  return page.evaluate((key) => (window as unknown as Record<string, boolean>)[key] === true, RELOAD_SENTINEL)
}

type Scenario = {
  name: string
  path: string
  endpoint: string
  /**
   * Text the success branch renders and neither the skeleton nor the error does.
   *
   * Must come from *inside* the branch, not from the page header. A page title
   * sits outside the loading/error/content chain and renders in all three
   * states, so asserting on it would pass no matter which branch won — the
   * assertion would be measuring nothing.
   */
  contentText: string
}

const scenarios: Scenario[] = [
  {
    name: 'settings form (data-retention.vue → load)',
    path: '/admin/settings/data-retention',
    endpoint: '/api/admin/settings/retention',
    contentText: 'Điều kiện dọn',
  },
  {
    name: 'table page (submissions/index.vue → fetchSubmissions)',
    path: '/admin/submissions',
    endpoint: '/api/admin/submissions',
    // A column header, not the page title: the title is above the branch chain
    // and survives every state, so it cannot distinguish them.
    contentText: 'Ngày gửi',
  },
]

for (const scenario of scenarios) {
  test.describe(scenario.name, () => {
    test('a failed fetch shows an alert, and retry re-fetches without reloading', async ({ page }) => {
      await login(page)

      const endpoint = await interceptEndpoint(page, scenario.endpoint)
      await page.goto(scenario.path)

      // ── 1. The failure surfaces as an alert ────────────────────────────────
      // getByRole('alert') rather than a CSS class: the assertion is that a
      // screen reader is told, which is the part that silently regresses. A red
      // box with no role reads identically to a page that finished loading and
      // found nothing.
      const alert = page.getByRole('alert')
      await expect(alert).toBeVisible({ timeout: 20_000 })
      await expect(alert).toContainText('thử lại')
      // The skeleton must be gone: loading and error are mutually exclusive.
      await expect(page.getByRole('status')).toHaveCount(0)
      // And the success branch must not be rendered underneath the error.
      await expect(page.getByText(scenario.contentText, { exact: false })).toHaveCount(0)

      const failedRequests = endpoint.requests
      expect(failedRequests).toBeGreaterThan(0)

      // ── 2. Retry issues a new request ──────────────────────────────────────
      await markDocument(page)
      endpoint.mode = 'pass'

      const retry = alert.getByRole('button', { name: 'thử lại' })
      await expect(retry).toBeVisible()
      await retry.click()

      // The content appearing is the proof the second request was made *and*
      // that its result was rendered. Asserting only the request count would
      // pass for a handler that re-fetches and then drops the response.
      await expect(page.getByText(scenario.contentText, { exact: false }).first()).toBeVisible({ timeout: 20_000 })
      await expect(page.getByRole('alert')).toHaveCount(0)
      expect(endpoint.requests).toBeGreaterThan(failedRequests)

      // ── 3. Nothing reloaded ───────────────────────────────────────────────
      expect(await documentSurvived(page)).toBe(true)
    })

    test('retry recovers from a repeated failure rather than latching', async ({ page }) => {
      await login(page)

      const endpoint = await interceptEndpoint(page, scenario.endpoint)
      await page.goto(scenario.path)

      const alert = page.getByRole('alert')
      await expect(alert).toBeVisible({ timeout: 20_000 })
      await markDocument(page)

      // Fail the retry too. A handler that clears the error but never re-sets it
      // would leave a blank page here — no skeleton, no alert, no content —
      // which is the failure this second case exists to catch.
      await alert.getByRole('button', { name: 'thử lại' }).click()
      await expect(page.getByRole('alert')).toBeVisible({ timeout: 20_000 })

      const afterSecondFailure = endpoint.requests
      expect(afterSecondFailure).toBeGreaterThan(1)

      // Third attempt succeeds, so a page that latched into a permanent error
      // state is distinguishable from one that recovers.
      endpoint.mode = 'pass'
      await page.getByRole('alert').getByRole('button', { name: 'thử lại' }).click()
      await expect(page.getByText(scenario.contentText, { exact: false }).first()).toBeVisible({ timeout: 20_000 })
      expect(endpoint.requests).toBeGreaterThan(afterSecondFailure)
      expect(await documentSurvived(page)).toBe(true)
    })
  })
}
