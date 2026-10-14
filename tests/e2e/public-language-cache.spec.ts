/**
 * Ngôn ngữ người đọc vs bộ nhớ đệm SWR, và lớp phủ "Đang tải..." của lượt tải đầu.
 *
 * Vì sao phải là trình duyệt + bản build thật: lỗi nằm ở chỗ Nitro render các
 * tuyến `swr: 60` (`/`, `/about`, …) với một request ĐÃ BỊ BỎ header `cookie`,
 * rồi phát lại nguyên bộ header đã lưu — kể cả `set-cookie` — cho mọi khách.
 * Khi `useI18n` còn ghi cookie lúc SSR (`useCookie` có `default: 'vi'`), mỗi
 * phản hồi từ cache đặt lại `cdkt_lang=vi` cho TẤT CẢ người đọc: ai chỉ có cookie
 * `en` mất hẳn lựa chọn; ai có localStorage `en` thì trang lật vi→en sau khi tải
 * và lật lại ở trang cache kế tiếp. Không test nguồn nào nhìn thấy được điều đó.
 *
 * Năm khẳng định, mỗi cái đã đỏ trên mã cũ (trừ phần so HTML, ghi chú bên dưới):
 *   1. không phản hồi SSR nào (cache hay không) mang `set-cookie: cdkt_lang`;
 *   2. khách chỉ có cookie `en` giữ được `en` qua hai trang cache liên tiếp;
 *   3. khách có localStorage `en` chuyển sang `en` SAU hydrate, không lỗi hydration;
 *   4. khách mặc định (vi) không lỗi hydration và không bị ghi cookie nào;
 *   5. lớp phủ tải đầu không bao giờ kẹt: tắt JS → ẩn; JS hỏng → ẩn sau ~4 s.
 */
import { expect, request, test, type APIResponse, type Browser, type ConsoleMessage, type Page } from '@playwright/test'
import { E2E_BASE_URL } from './harness'

/** `use.baseURL` của project đang chạy (mặc định `E2E_BASE_URL` từ playwright.config.ts). */
function baseURL(): string {
  return test.info().project.use.baseURL ?? E2E_BASE_URL
}

/** Hai tuyến `swr: 60` (xem `routeRules` trong nuxt.config.ts). */
const CACHED_ROUTES = ['/', '/about'] as const
/** Không có `routeRules` — Nitro render với cookie thật của khách. */
const UNCACHED_ROUTE = '/assistant'

const LOADING_TEXT = 'Đang tải...'

function langSetCookies(response: APIResponse): string[] {
  return response.headersArray()
    .filter(header => header.name.toLowerCase() === 'set-cookie')
    .map(header => header.value)
    .filter(value => value.trim().startsWith('cdkt_lang='))
}

function htmlLang(body: string): string | null {
  return /<html[^>]*\blang="([^"]*)"/.exec(body)?.[1] ?? null
}

/**
 * Mỗi lượt gọi một APIRequestContext MỚI: context dùng chung của fixture
 * `request` tự lưu `set-cookie` vào hũ của nó và gửi lại ở lượt sau — đúng thứ
 * test này không được phép tự gây ra.
 */
async function fetchPage(route: string, cookie?: string) {
  const ctx = await request.newContext({ baseURL: baseURL() })
  try {
    const response = await ctx.get(route, { headers: cookie ? { cookie } : {} })
    expect(response.status(), `${route} phải trả 200`).toBe(200)
    return { response, body: await response.text() }
  } finally {
    await ctx.dispose()
  }
}

function collectHydrationMessages(page: Page): string[] {
  const messages: string[] = []
  page.on('console', (msg: ConsoleMessage) => {
    if (/hydrat/i.test(msg.text())) messages.push(`[${msg.type()}] ${msg.text()}`)
  })
  page.on('pageerror', (error) => {
    messages.push(`[pageerror] ${error.message}`)
  })
  return messages
}

async function langCookie(page: Page): Promise<string | undefined> {
  const cookies = await page.context().cookies(baseURL())
  return cookies.find(cookie => cookie.name === 'cdkt_lang')?.value
}

/**
 * Hydrate xong = lớp phủ tải đầu đã bị gỡ khỏi DOM (app.vue gỡ trong onMounted).
 * Chờ thêm networkidle để lời gọi bản dịch kịp về — nếu nó gây lệch hydration
 * thì thông báo đã kịp in ra trước khi test đọc.
 */
async function waitForHydrated(page: Page) {
  await expect(page.getByText(LOADING_TEXT, { exact: true })).toHaveCount(0, { timeout: 20_000 })
  await page.waitForLoadState('networkidle')
}

async function newPage(browser: Browser, options: Parameters<Browser['newContext']>[0] = {}) {
  const context = await browser.newContext({ baseURL: baseURL(), ...options })
  return { context, page: await context.newPage() }
}

test.describe('ngôn ngữ người đọc không bị bộ nhớ đệm SWR ghi đè', () => {
  test('không phản hồi SSR nào ghi cookie cdkt_lang', async () => {
    for (const route of [...CACHED_ROUTES, UNCACHED_ROUTE]) {
      for (const cookie of [undefined, 'cdkt_lang=en']) {
        const { response } = await fetchPage(route, cookie)
        expect(langSetCookies(response), `${route} (cookie: ${cookie ?? 'không'}) không được ghi cdkt_lang`).toEqual([])
      }
    }
  })

  test('tuyến cache luôn render tiếng Việt, tuyến không cache theo cookie của khách', async () => {
    for (const route of CACHED_ROUTES) {
      // Hợp đồng "HTML cache dùng chung là tiếng Việt" (đánh đổi có chủ đích,
      // xem useI18n): khách có cookie `en` vẫn nhận bản tiếng Việt, rồi trang
      // chuyển sau hydrate. Ghi chú, KHÔNG phải bằng chứng: Nitro bỏ header
      // cookie trước khi render tuyến cache nên điều này đúng cả trên mã cũ.
      // Không so nguyên văn hai bản HTML: với swr, hai lượt gọi có thể rơi vào
      // hai lượt render khác nhau (bản cũ + làm mới nền) khi cache đã quá 60 s.
      const plain = await fetchPage(route)
      const english = await fetchPage(route, 'cdkt_lang=en')
      expect(htmlLang(plain.body)).toBe('vi')
      expect(htmlLang(english.body)).toBe('vi')
    }

    const plain = await fetchPage(UNCACHED_ROUTE)
    const english = await fetchPage(UNCACHED_ROUTE, 'cdkt_lang=en')
    expect(htmlLang(plain.body)).toBe('vi')
    expect(htmlLang(english.body), 'tuyến không cache vẫn phải đọc cookie lúc SSR').toBe('en')
  })

  test('khách chỉ có cookie en giữ được tiếng Anh qua hai trang cache', async ({ browser }) => {
    const { context, page } = await newPage(browser)
    await context.addCookies([{ name: 'cdkt_lang', value: 'en', url: baseURL() }])
    const hydration = collectHydrationMessages(page)

    for (const route of CACHED_ROUTES) {
      await page.goto(route)
      await waitForHydrated(page)
      await expect(page.locator('html')).toHaveAttribute('lang', 'en')
      expect(await langCookie(page), `cookie sau ${route}`).toBe('en')
    }
    expect(hydration).toEqual([])
    await context.close()
  })

  test('khách có localStorage en chuyển sang tiếng Anh sau hydrate, không lệch hydration', async ({ browser }) => {
    const { context, page } = await newPage(browser)
    await context.addInitScript(() => {
      window.localStorage.setItem('cdkt_lang', 'en')
    })
    const hydration = collectHydrationMessages(page)

    for (const route of CACHED_ROUTES) {
      await page.goto(route)
      await waitForHydrated(page)
      await expect(page.locator('html')).toHaveAttribute('lang', 'en')
      expect(await langCookie(page), `cookie sau ${route}`).toBe('en')
    }
    expect(hydration).toEqual([])
    await context.close()
  })

  test('khách mặc định ở tiếng Việt, không lệch hydration, không bị ghi cookie', async ({ browser }) => {
    const { context, page } = await newPage(browser)
    const hydration = collectHydrationMessages(page)

    for (const route of CACHED_ROUTES) {
      await page.goto(route)
      await waitForHydrated(page)
      await expect(page.locator('html')).toHaveAttribute('lang', 'vi')
    }
    expect(hydration).toEqual([])
    expect(await langCookie(page), 'chưa chọn ngôn ngữ thì không có lý do ghi cookie').toBeUndefined()
    await context.close()
  })
})

test.describe('lớp phủ tải đầu luôn có lối thoát', () => {
  test('HTML máy chủ mang đúng một script failsafe và một <noscript> CSS, không bị escape', async () => {
    const { body } = await fetchPage('/')
    const count = (needle: string) => body.split(needle).length - 1
    expect(count('id="cdkt-boot-overlay"'), 'lớp phủ có id để hai lối thoát tìm thấy').toBe(1)
    expect(count('getElementById("cdkt-boot-overlay")'), 'script failsafe nhúng đúng một lần, nguyên văn').toBe(1)
    const noscript = body.match(/<noscript[^>]*><style>#cdkt-boot-overlay\{display:none!important\}<\/style><\/noscript>/g) ?? []
    expect(noscript.length, '<noscript> chứa thẻ <style> thật, không phải chữ đã escape').toBe(1)
  })

  test('tắt JavaScript: lớp phủ bị ẩn, nội dung SSR đọc được', async ({ browser }) => {
    const { context, page } = await newPage(browser, { javaScriptEnabled: false })
    await page.goto('/')
    await expect(page.getByText(LOADING_TEXT, { exact: true })).toBeHidden()
    await expect(page.locator('#main-content')).toBeVisible()
    await context.close()
  })

  test('JavaScript ứng dụng không tải được: lớp phủ tự ẩn sau thời hạn', async ({ browser }) => {
    const { context, page } = await newPage(browser)
    // Chặn mọi bundle JS: hydrate không bao giờ chạy — tương đương một lỗi ném
    // ra trước mount. CSS vẫn tải để lớp phủ phủ kín trang như thật.
    await page.route('**/_nuxt/**', (route) => {
      if (route.request().resourceType() === 'script') return route.abort()
      return route.continue()
    })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    // Không trống: lúc đầu lớp phủ THẬT SỰ đang che trang.
    await expect(page.getByText(LOADING_TEXT, { exact: true })).toBeVisible()
    await expect(page.getByText(LOADING_TEXT, { exact: true })).toBeHidden({ timeout: 6_000 })
    await expect(page.locator('#main-content')).toBeVisible()
    await context.close()
  })

  test('tải bình thường: lớp phủ được gỡ khi hydrate xong', async ({ browser }) => {
    const { context, page } = await newPage(browser)
    await page.goto('/')
    await waitForHydrated(page)
    await expect(page.locator('#main-content')).toBeVisible()
    await context.close()
  })
})
