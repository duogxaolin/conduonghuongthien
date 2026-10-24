/**
 * The three admin list pages moved to `useAdminList` + `adminFetch` (design.md
 * D-FETCH, wave2 task 6.4), driven in a real browser.
 *
 * tests/admin-list.test.ts proves the composable's behaviour against real ofetch
 * over a fake network; tests/admin-list-pilot-pages.test.ts proves the pages'
 * source shape. Neither mounts a page. What only a browser can answer:
 *   1. each migrated page still goes skeleton → alert (`role="alert"`) on a
 *      failure → "Thử lại" re-fetches without reloading the document → rows,
 *      total and pager rendered from the answer;
 *   2. the race the composable exists for, end to end: an older request still
 *      in flight when the officer applies a new filter is cancelled on the wire,
 *      and when its answer lands anyway it does not replace the newer rows.
 *
 * Every answer is synthetic (`route.fulfill`), so the rows on screen are known
 * and the screenshot attached to each page's test is deterministic — it is the
 * review artefact for "no visual regression" on the migrated pages.
 */
import { expect, test, type Page, type Request, type Route } from '@playwright/test'
import { E2E_ADMIN_USERNAME, E2E_PASSWORD_ENV } from './harness'

const RELOAD_SENTINEL = '__cdkt_no_reload__'

async function login(page: Page) {
  const password = process.env[E2E_PASSWORD_ENV]
  if (!password) throw new Error(`${E2E_PASSWORD_ENV} is not set — globalSetup did not run`)

  await page.goto('/admin/login')
  await page.fill('input[autocomplete="username"]', E2E_ADMIN_USERNAME)
  await page.fill('input[autocomplete="current-password"]', password)
  await page.click('button[type="submit"]')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Xin chào', { timeout: 20_000 })
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

async function markDocument(page: Page) {
  await page.evaluate((key) => { (window as unknown as Record<string, boolean>)[key] = true }, RELOAD_SENTINEL)
}

async function documentSurvived(page: Page) {
  return page.evaluate((key) => (window as unknown as Record<string, boolean>)[key] === true, RELOAD_SENTINEL)
}

type PilotScenario = {
  name: string
  path: string
  endpoint: string
  /** The page's answer for one request, keyed off its query. */
  answer: (url: URL) => unknown
  /** Text only the success branch renders (inside the table, not the page title). */
  rowText: string
  /** The pager's total label, proving `total` reached the template. */
  totalText: string
  /** Page-specific extras rendered from the same answer. */
  alsoRendered?: (page: Page) => Promise<void>
}

const at = (iso: string) => new Date(iso).toISOString()

const scenarios: PilotScenario[] = [
  {
    name: 'readers/index.vue',
    path: '/admin/readers',
    endpoint: '/api/admin/readers',
    answer: () => ({
      ok: true,
      total: 42,
      totalPages: 2,
      page: 1,
      readers: [
        { id: 1, displayName: 'Nguyễn Văn An', email: 'an@example.test', isBanned: false, banReason: null, bannedAt: null, createdAt: at('2026-10-01T02:00:00Z'), lastSeenAt: at('2026-10-20T02:00:00Z'), lastIp: '203.0.113.10', commentCount: 4 },
        { id: 2, displayName: 'Trần Thị Bình', email: 'binh@example.test', isBanned: true, banReason: 'Spam', bannedAt: at('2026-10-18T02:00:00Z'), createdAt: at('2026-09-12T02:00:00Z'), lastSeenAt: at('2026-10-17T02:00:00Z'), lastIp: null, commentCount: 12 },
      ],
    }),
    rowText: 'Nguyễn Văn An',
    totalText: '42 tài khoản',
  },
  {
    name: 'comments/index.vue',
    path: '/admin/comments',
    endpoint: '/api/admin/comments',
    // Two requests per load: the list, and the "Đã ẩn" badge count (perPage=1).
    answer: (url) => url.searchParams.get('perPage') === '1'
      ? { ok: true, comments: [], total: 3, totalPages: 3, page: 1 }
      : {
          ok: true,
          total: 30,
          totalPages: 2,
          page: 1,
          comments: [
            { id: 11, body: 'Cảm ơn Ban quản trị đã giải đáp rất rõ ràng.', createdAt: at('2026-10-20T03:00:00Z'), parentId: null, articleId: 5, articleTitle: 'Hướng dẫn thủ tục vay vốn', articleSlug: 'huong-dan', mediaItemId: null, mediaItemTitle: null, mediaItemSlug: null, readerId: 1, readerName: 'Nguyễn Văn An', readerEmail: 'an@example.test', adminUserId: null, adminName: null, ip: '203.0.113.10', isHidden: false, flagReason: null },
            { id: 12, body: 'Ban quản trị sẽ liên hệ lại anh trong tuần này.', createdAt: at('2026-10-20T04:00:00Z'), parentId: 11, articleId: 5, articleTitle: 'Hướng dẫn thủ tục vay vốn', articleSlug: 'huong-dan', mediaItemId: null, mediaItemTitle: null, mediaItemSlug: null, readerId: null, readerName: null, readerEmail: null, adminUserId: 1, adminName: 'Quản trị viên', ip: null, isHidden: false, flagReason: null },
          ],
        },
    rowText: 'Cảm ơn Ban quản trị đã giải đáp rất rõ ràng.',
    totalText: '30 bình luận',
    // The badge comes from `result.hiddenCount` of the same load.
    alsoRendered: async (page) => {
      await expect(page.getByRole('tab', { name: /Đã ẩn/ })).toContainText('3')
    },
  },
  {
    name: 'chatbot/sessions/index.vue',
    path: '/admin/chatbot/sessions',
    endpoint: '/api/admin/chatbot/sessions',
    answer: () => ({
      ok: true,
      page: 1,
      pageSize: 25,
      total: 26,
      totalPages: 2,
      items: [
        { id: 'sess-1', ip: '203.0.113.21', browser: 'Chrome trên Windows', detectedPhone: '0901234567', detectedName: 'Lê Văn Cường', messageCount: 6, startedAt: at('2026-10-20T01:00:00Z'), lastMessageAt: at('2026-10-20T01:12:00Z') },
        { id: 'sess-2', ip: '203.0.113.22', browser: 'Safari trên iPhone', detectedPhone: null, detectedName: null, messageCount: 2, startedAt: at('2026-10-19T08:00:00Z'), lastMessageAt: at('2026-10-19T08:03:00Z') },
      ],
    }),
    rowText: 'Lê Văn Cường',
    totalText: '26 phiên',
  },
]

for (const scenario of scenarios) {
  test(`${scenario.name}: failure → alert → retry re-fetches without reloading → rows and pager`, async ({ page }, testInfo) => {
    await login(page)

    const state = { mode: 'fail' as 'fail' | 'pass', requests: 0 }
    await page.route((url) => url.pathname === scenario.endpoint, async (route) => {
      state.requests += 1
      if (state.mode === 'fail') {
        await json(route, { statusCode: 500, statusMessage: 'E2E injected failure' }, 500)
        return
      }
      await json(route, scenario.answer(new URL(route.request().url())))
    })

    await page.goto(scenario.path)

    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible({ timeout: 20_000 })
    await expect(alert).toContainText('Thử lại')
    await expect(page.getByRole('status')).toHaveCount(0)
    await expect(page.getByText(scenario.rowText)).toHaveCount(0)
    const failed = state.requests
    expect(failed).toBeGreaterThan(0)

    await markDocument(page)
    state.mode = 'pass'
    await alert.getByRole('button', { name: 'Thử lại' }).click()

    // Desktop viewport: the table is the visible rendering (the cards are md:hidden).
    await expect(page.locator('table, ul').getByText(scenario.rowText).first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(scenario.totalText)).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Phân trang' })).toBeVisible()
    await scenario.alsoRendered?.(page)
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(state.requests).toBeGreaterThan(failed)
    expect(await documentSurvived(page)).toBe(true)

    // Written to the test's output directory (test-results/, git-ignored) so the
    // file outlives the run with any reporter; attached for the HTML report too.
    const shot = testInfo.outputPath(`${scenario.name.replace(/[/.]/g, '-')}.png`)
    await page.screenshot({ path: shot, fullPage: true })
    await testInfo.attach('screenshot', { path: shot, contentType: 'image/png' })
  })
}

test('chatbot/sessions/index.vue: an older answer landing after a newer filter does not replace its rows', async ({ page }) => {
  await login(page)

  const endpoint = '/api/admin/chatbot/sessions'
  const row = (id: string, name: string) => ({
    id, ip: '203.0.113.30', browser: 'Chrome trên Windows', detectedPhone: null, detectedName: name, messageCount: 1,
    startedAt: at('2026-10-20T01:00:00Z'), lastMessageAt: at('2026-10-20T01:01:00Z'),
  })

  // The unfiltered load is held until the newer one has been answered.
  const older: { release?: () => Promise<void> } = {}
  let markHeld!: () => void
  const olderHeld = new Promise<void>((resolve) => { markHeld = resolve })
  await page.route((url) => url.pathname === endpoint, async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('hasContact') === 'yes') {
      await json(route, { ok: true, page: 1, pageSize: 25, total: 1, totalPages: 1, items: [row('sess-new', 'Khách mới B')] })
      return
    }
    older.release = async () => {
      // The page has already aborted this request; fulfilling it is the late
      // answer arriving anyway. Playwright may refuse a cancelled route.
      await json(route, { ok: true, page: 1, pageSize: 25, total: 1, totalPages: 1, items: [row('sess-old', 'Khách cũ A')] }).catch(() => {})
    }
    markHeld()
  })

  const aborted: Request[] = []
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).pathname === endpoint) aborted.push(request)
  })

  await page.goto('/admin/chatbot/sessions')
  await olderHeld
  await expect(page.getByRole('status')).toBeVisible()

  // The filter controls sit outside the loading branch: the officer can change
  // the filter while the first load is still out.
  await page.getByLabel('Thông tin liên hệ').selectOption('yes')
  await page.getByRole('button', { name: 'Lọc', exact: true }).click()

  const table = page.locator('table')
  await expect(table.getByText('Khách mới B')).toBeVisible({ timeout: 20_000 })

  // The user-visible failure first: the older answer arrives late anyway.
  expect(older.release, 'the unfiltered load was intercepted and held').toBeDefined()
  await older.release?.()
  // Give a late answer every chance to land before asserting it did not.
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 300)))
  await expect(table.getByText('Khách cũ A'), "the older filter's rows must not replace the newer ones").toHaveCount(0)
  await expect(table.getByText('Khách mới B')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)

  // And the superseded request was cancelled on the wire, not merely ignored.
  await expect.poll(() => aborted.length, { message: 'the superseded request is cancelled on the wire' }).toBeGreaterThan(0)
})
