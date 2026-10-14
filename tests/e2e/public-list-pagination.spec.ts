/**
 * Danh sách công khai: bấm trang 2 / tìm kiếm phải NẠP LẠI danh sách.
 *
 * Lỗi đã gặp (/news, /documents, /role-models, /reintegration-models, /media):
 * `useAsyncData('<chuỗi cố định>', …)` không `watch`. Bấm "2" chỉ đổi URL; Nuxt
 * dùng lại component (khoá trang theo path) nên lượt fetch không chạy lại — URL
 * báo trang 2, danh sách vẫn trang 1 (F5 thì đúng). Tìm kiếm hỏng y hệt.
 * `tests/public-article-list.test.ts` chặn ở mức composable với Nuxt giả; spec này
 * là bằng chứng duy nhất trên Nuxt THẬT trong trình duyệt THẬT.
 *
 * Dữ liệu dựng thẳng vào CSDL dùng một lần (`e2eDbConfig`), không qua trang quản
 * trị — một spec về phân trang không nên đỏ vì trình soạn bài viết hỏng.
 * Bài của spec có `published_at` ở tương lai gần nên luôn đứng đầu danh sách
 * (sắp `published_at DESC`) bất kể dữ liệu seed có gì.
 *
 * Mỗi lượt mở trang kèm `?e2e=<stamp>`: các route này có `swr: 60`. Phòng hờ cho
 * trường hợp một spec khác ghé `/news` trước khi spec này chèn dữ liệu — với giả
 * định khoá cache SWR của Nitro tính cả query string (chưa kiểm riêng; hiện không
 * spec nào khác mở các trang này nên giả định đó chưa từng phải gánh gì).
 */
import mysql from 'mysql2/promise'
import { expect, test, type Page, type Request } from '@playwright/test'
import { e2eDbConfig } from './harness'

const stamp = `${Date.now()}`
const tag = `E2E${stamp}`
const pad = (n: number) => String(n).padStart(2, '0')
const title = (kind: string, n: number) => `${tag} ${kind} ${pad(n)}`
const SEARCH_WORD = `kw${stamp}`

let connection: mysql.Connection

async function insertArticles(type: string, kind: string, count: number) {
  for (let n = 1; n <= count; n += 1) {
    await connection.execute(
      `INSERT INTO articles (type, title, slug, excerpt, status, published_at)
       VALUES (?, ?, ?, ?, 'published', DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
      [type, title(kind, n), `${tag.toLowerCase()}-${kind}-${pad(n)}`, `Trích đoạn ${kind} ${pad(n)}`, 60 + n],
    )
  }
}

test.beforeAll(async () => {
  connection = await mysql.createConnection(e2eDbConfig())
  await insertArticles('news', 'tin', 25) // 19/trang → trang 2 có tin 06..01
  await insertArticles('document', 'vanban', 4) // 3/trang → trang 2 có vanban 01
  await insertArticles('role_model', 'guong', 21) // 19/trang → trang 2 có guong 02..01
  await insertArticles('reintegration', 'mohinh', 2)
  await insertArticles('faq', 'hoidap', 6) // 5/trang (lọc phía client)
  // Một bài mỗi loại mang từ khoá tìm kiếm riêng của lượt chạy này.
  for (const [type, kind] of [['news', 'tin'], ['reintegration', 'mohinh'], ['faq', 'hoidap']] as const) {
    await connection.execute(
      `INSERT INTO articles (type, title, slug, excerpt, status, published_at)
       VALUES (?, ?, ?, 'Trích đoạn tìm kiếm', 'published', DATE_ADD(NOW(), INTERVAL 1 MINUTE))`,
      [type, `${tag} ${kind} ${SEARCH_WORD}`, `${tag.toLowerCase()}-${kind}-${SEARCH_WORD}`],
    )
  }
  for (let n = 1; n <= 13; n += 1) {
    await connection.execute(
      `INSERT INTO media_items (slug, short_id, title, source, youtube_video_id, status, processing_status, published_at)
       VALUES (?, ?, ?, 'youtube', 'dQw4w9WgXcQ', 'published', 'ready', DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
      [`${tag.toLowerCase()}-video-${pad(n)}`, `e${stamp.slice(-9)}${pad(n)}`, title('video', n), 60 + n],
    )
  }
  await seedRequestCountData()
})

test.afterAll(async () => {
  await connection.execute('DELETE FROM articles WHERE title LIKE ?', [`${tag} %`])
  await connection.execute('DELETE FROM media_items WHERE title LIKE ?', [`${tag} %`])
  await connection.execute('DELETE FROM categories WHERE slug IN (?, ?)', [CAT_A, CAT_B])
  await connection.execute('DELETE FROM content_types WHERE slug = ?', [CT_SLUG])
  await connection.end()
})

// ─── Dữ liệu cho phần "đúng MỘT lượt gọi mỗi thao tác" (cuối tệp) ─────────────
// Bài/video thêm ở đây có `published_at` ở QUÁ KHỨ nên luôn đứng SAU dữ liệu của
// các test phía trên (chúng ở tương lai gần) — các khẳng định cũ không đổi.
const CAT_A = `${tag.toLowerCase()}-cata`
const CAT_B = `${tag.toLowerCase()}-catb`
/** `articles.type` là varchar(32) — slug thể loại tự tạo phải ngắn. */
const CT_SLUG = `e2ect${stamp.slice(-8)}`

async function insertOlder(type: string, kind: string, count: number, categoryId: number | null = null) {
  for (let n = 1; n <= count; n += 1) {
    await connection.execute(
      `INSERT INTO articles (type, category_id, title, slug, excerpt, status, published_at)
       VALUES (?, ?, ?, ?, ?, 'published', DATE_SUB(NOW(), INTERVAL ? MINUTE))`,
      [type, categoryId, title(kind, n), `${tag.toLowerCase()}-${kind}-${pad(n)}`, `Trích đoạn ${kind} ${pad(n)}`, 100 - n],
    )
  }
}

/**
 * Từ khoá riêng cho bài trong chuyên mục news: bài này cũng hiện ở `/news`, và một
 * bài thứ hai mang `SEARCH_WORD` sẽ làm test tìm kiếm `/news` phía trên khớp hai thẻ.
 */
const CAT_WORD = `kc${stamp}`

async function insertKeyword(type: string, kind: string, categoryId: number | null = null, word = SEARCH_WORD) {
  await connection.execute(
    `INSERT INTO articles (type, category_id, title, slug, excerpt, status, published_at)
     VALUES (?, ?, ?, ?, 'Trích đoạn tìm kiếm', 'published', DATE_SUB(NOW(), INTERVAL 200 MINUTE))`,
    [type, categoryId, `${tag} ${kind} ${word}`, `${tag.toLowerCase()}-${kind}-${word}`],
  )
}

async function seedRequestCountData() {
  // /reintegration-models cần ≥ 2 trang; /documents, /role-models cần bài khớp từ khoá.
  await insertOlder('reintegration', 'mohinhcu', 20)
  await insertKeyword('document', 'vanban')
  await insertKeyword('role_model', 'guong')
  await connection.execute(
    `INSERT INTO media_items (slug, short_id, title, source, youtube_video_id, status, processing_status, published_at)
     VALUES (?, ?, ?, 'youtube', 'dQw4w9WgXcQ', 'published', 'ready', DATE_SUB(NOW(), INTERVAL 200 MINUTE))`,
    [`${tag.toLowerCase()}-video-${SEARCH_WORD}`, `k${stamp.slice(-9)}01`, `${tag} video ${SEARCH_WORD}`],
  )

  // /news/<chuyên mục>: hai chuyên mục loại news, A đủ 2 trang.
  const [a] = await connection.execute<mysql.ResultSetHeader>(
    `INSERT INTO categories (name, slug, type, display_order) VALUES (?, ?, 'news', 990)`, [`${tag} Chuyên mục A`, CAT_A])
  const [b] = await connection.execute<mysql.ResultSetHeader>(
    `INSERT INTO categories (name, slug, type, display_order) VALUES (?, ?, 'news', 991)`, [`${tag} Chuyên mục B`, CAT_B])
  await insertOlder('news', 'cata', 21, a.insertId)
  await insertKeyword('news', 'cata', a.insertId, CAT_WORD)
  await insertOlder('news', 'catb', 2, b.insertId)

  // Thể loại tự tạo (không route tĩnh) — hiển thị qua `[slug].vue` → ContentTypeListSection.
  await connection.execute(
    `INSERT INTO content_types (name, slug, icon, description, display_order) VALUES (?, ?, 'fa-solid fa-folder', NULL, 990)`,
    [`${tag} Thể loại`, CT_SLUG])
  await insertOlder(CT_SLUG, 'ct', 21)
  await insertKeyword(CT_SLUG, 'ct')
}

/** Lượt gọi API danh sách chính (không phải khối "Đọc nhiều" sort=views). */
const listRequest = (path: string, check: (params: URLSearchParams) => boolean) => (request: Request) => {
  const url = new URL(request.url())
  return url.pathname === path && url.searchParams.get('sort') !== 'views' && check(url.searchParams)
}

/** Thẻ bài trong cột danh sách chính — cột phải "Đọc nhiều" dùng `<li>`, không lẫn vào. */
const card = (page: Page, text: string) => page.locator('article', { hasText: text })

async function clickPage(page: Page, n: number) {
  await page.getByRole('button', { name: String(n), exact: true }).click()
}

/**
 * Khoá `useAsyncData` giờ dẫn xuất từ query + ngôn ngữ. Nếu khoá phía máy chủ và
 * phía trình duyệt lệch nhau (vd. `lang` khác), trang vẫn "đúng" trong mắt người
 * xem — máy chủ dựng danh sách rỗng/sai rồi trình duyệt tự nạp lại — nhưng mỗi
 * lượt mở trang đầu tiên tốn thêm một lượt gọi và HTML trong cache SWR là HTML hỏng.
 * Nên khẳng định cả hai: HTML thô đã chứa bài, và lúc hydrate không có lượt gọi nào.
 */
for (const [path, kind, newest] of [['/news', 'tin', 25], ['/role-models', 'guong', 21]] as const) {
  test(`${path}: HTML máy chủ đã chứa danh sách, hydrate không nạp lại`, async ({ page }) => {
    const html = await (await page.request.get(`${path}?e2e=ssr${stamp}`)).text()
    expect(html).toContain(title(kind, newest))

    const listCalls: string[] = []
    page.on('request', (request) => {
      if (listRequest('/api/public/articles', () => true)(request)) listCalls.push(request.url())
    })
    await page.goto(`${path}?e2e=hydrate${stamp}`)
    await expect(card(page, title(kind, newest))).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(listCalls).toEqual([])
  })
}

test('/news: bấm trang 2 → gọi API page=2 và danh sách đổi; Back → trang 1 trở lại', async ({ page }) => {
  await page.goto(`/news?e2e=${stamp}`)
  await expect(card(page, title('tin', 25))).toBeVisible()
  await expect(card(page, title('tin', 1))).toHaveCount(0)

  const pageTwo = page.waitForRequest(listRequest('/api/public/articles', p => p.get('type') === 'news' && p.get('page') === '2' && !!p.get('lang')))
  await clickPage(page, 2)
  await pageTwo
  await expect(page).toHaveURL(/[?&]page=2/)
  await expect(card(page, title('tin', 1))).toBeVisible()
  await expect(card(page, title('tin', 25))).toHaveCount(0)

  await page.goBack()
  await expect(card(page, title('tin', 25))).toBeVisible()
  await expect(card(page, title('tin', 1))).toHaveCount(0)
})

test('/news: tìm kiếm → gọi API với search, chỉ còn bài khớp', async ({ page }) => {
  await page.goto(`/news?e2e=${stamp}`)
  await expect(card(page, title('tin', 25))).toBeVisible()

  const searched = page.waitForRequest(listRequest('/api/public/articles', p => p.get('type') === 'news' && p.get('search') === SEARCH_WORD && p.get('page') === '1'))
  const input = page.getByRole('textbox', { name: 'Tìm kiếm bản tin...' })
  await input.fill(SEARCH_WORD)
  await input.press('Enter')
  await searched
  await expect(page).toHaveURL(new RegExp(`[?&]q=${SEARCH_WORD}`))
  await expect(card(page, SEARCH_WORD)).toBeVisible()
  await expect(card(page, title('tin', 25))).toHaveCount(0)
})

test('/documents: bấm trang 2 → gọi API page=2 và danh sách đổi', async ({ page }) => {
  await page.goto(`/documents?e2e=${stamp}`)
  await expect(card(page, title('vanban', 4))).toBeVisible()

  const pageTwo = page.waitForRequest(listRequest('/api/public/articles', p => p.get('type') === 'document' && p.get('page') === '2'))
  await clickPage(page, 2)
  await pageTwo
  await expect(card(page, title('vanban', 1))).toBeVisible()
  await expect(card(page, title('vanban', 4))).toHaveCount(0)
})

test('/role-models: bấm trang 2 → gọi API page=2 có lang và danh sách đổi', async ({ page }) => {
  await page.goto(`/role-models?e2e=${stamp}`)
  await expect(card(page, title('guong', 21))).toBeVisible()

  const pageTwo = page.waitForRequest(listRequest('/api/public/articles', p => p.get('type') === 'role_model' && p.get('page') === '2' && !!p.get('lang')))
  await clickPage(page, 2)
  await pageTwo
  await expect(card(page, title('guong', 1))).toBeVisible()
  await expect(card(page, title('guong', 21))).toHaveCount(0)
})

test('/reintegration-models: tìm kiếm → gọi API với search và danh sách lọc', async ({ page }) => {
  await page.goto(`/reintegration-models?e2e=${stamp}`)
  await expect(card(page, title('mohinh', 2))).toBeVisible()

  const searched = page.waitForRequest(listRequest('/api/public/articles', p => p.get('type') === 'reintegration' && p.get('search') === SEARCH_WORD))
  const input = page.getByRole('textbox', { name: 'Tìm kiếm mô hình' })
  await input.fill(SEARCH_WORD)
  await input.press('Enter')
  await searched
  await expect(card(page, SEARCH_WORD)).toBeVisible()
  await expect(card(page, title('mohinh', 2))).toHaveCount(0)
})

test('/media: bấm trang 2 → gọi API page=2 và danh sách đổi', async ({ page }) => {
  await page.goto(`/media?e2e=${stamp}`)
  // Thẻ video là `<li>`; mục nổi bật của seed (nếu có) xếp trước, nên chỉ khẳng
  // định tập tiêu đề ĐỔI chứ không đoán chính xác trang nào chứa video nào.
  const videos = page.locator('li', { hasText: tag })
  await expect(videos.first()).toBeVisible()
  const before = (await videos.allInnerTexts()).join('|')

  const pageTwo = page.waitForRequest(listRequest('/api/public/media', p => p.get('page') === '2'))
  await page.getByRole('button', { name: 'Trang 2', exact: true }).click()
  await pageTwo
  await expect(page).toHaveURL(/[?&]page=2/)
  await expect.poll(async () => (await videos.allInnerTexts()).join('|')).not.toBe(before)
})

test('/legal-qa: đổi từ khoá khi đang ở trang 2 → về trang 1 và thấy kết quả', async ({ page }) => {
  await page.goto(`/legal-qa?e2e=${stamp}`)
  await expect(page.getByRole('button', { name: title('hoidap', 6) })).toBeVisible()

  await clickPage(page, 2)
  await expect(page.getByText(/Trang\s+2\s+trên tổng số/)).toBeVisible()

  await page.getByRole('searchbox', { name: 'Tìm kiếm câu hỏi pháp luật' }).fill(SEARCH_WORD)
  await expect(page.getByText(/Trang\s+1\s+trên tổng số\s+1\s+trang/)).toBeVisible()
  await expect(page.getByRole('button', { name: new RegExp(SEARCH_WORD) })).toBeVisible()
})

// ─── Đúng MỘT lượt gọi danh sách cho mỗi thao tác (kể cả Back/Forward) ─────────
//
// Lỗi đã gặp (bộ kiểm chứng độc lập): `/media` và `/news/<chuyên mục>` giữ trang /
// từ khoá / chuyên mục trong các `ref` rồi ghi lần lượt từng cái. Khoá
// `useAsyncData` của Nuxt được theo dõi với `flush: 'sync'`, nên MỖI lần ghi đổi
// khoá một lần → một lượt gọi: tìm kiếm từ trang 2 bắn `page=2&search=x` (trạng
// thái trung gian, thừa) rồi mới `page=1&search=x`; nút Back bắn `page=2&search=x`
// rồi `page=2`. Danh sách cuối cùng đúng nên mắt thường không thấy — chỉ đếm từng
// lượt gọi mới thấy. Khẳng định ở đây: mỗi thao tác đúng một lượt, đúng tham số.

/** Mọi lượt gọi API danh sách (cả bài viết lẫn video) — ghi hết, lọc sau. */
function recordListCalls(page: Page) {
  const calls: URL[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/api/public/articles' || url.pathname === '/api/public/media') calls.push(url)
  })
  return calls
}

const LOADING_TEXT = 'Đang tải...'
async function openHydrated(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByText(LOADING_TEXT, { exact: true })).toHaveCount(0, { timeout: 20_000 })
  await page.waitForLoadState('networkidle')
}

interface ListSpec {
  label: string
  path: string
  /** Lượt gọi này có phải lượt nạp danh sách CHÍNH của trang không. */
  isList: (url: URL) => boolean
  /** Bấm sang trang 2. */
  goPage2: (page: Page) => Promise<void>
  /** Từ khoá có bài khớp trong danh sách này (mặc định `SEARCH_WORD`). */
  searchWord?: string
}

const articleList = (type: string, categorySlug?: string) => (url: URL) =>
  url.pathname === '/api/public/articles'
  && url.searchParams.get('sort') !== 'views'
  && url.searchParams.get('type') === type
  && (categorySlug === undefined ? !url.searchParams.get('categorySlug') : url.searchParams.get('categorySlug') === categorySlug)

const numberButton = (page: Page) => page.getByRole('button', { name: '2', exact: true }).click()
const nextLink = (page: Page) => page.locator('#main-content nav a').filter({ hasText: /^\s*Sau\s*$/ }).first().click()

const LIST_SPECS: ListSpec[] = [
  { label: '/news', path: '/news', isList: articleList('news'), goPage2: numberButton },
  { label: '/documents', path: '/documents', isList: articleList('document'), goPage2: numberButton },
  { label: '/role-models', path: '/role-models', isList: articleList('role_model'), goPage2: numberButton },
  { label: '/reintegration-models', path: '/reintegration-models', isList: articleList('reintegration'), goPage2: numberButton },
  {
    label: '/media',
    path: '/media',
    isList: url => url.pathname === '/api/public/media',
    goPage2: page => page.getByRole('button', { name: 'Trang 2', exact: true }).click(),
  },
  { label: '/news/<chuyên mục>', path: `/news/${CAT_A}`, isList: articleList('news', CAT_A), goPage2: nextLink, searchWord: CAT_WORD },
  { label: '/<thể loại tự tạo>', path: `/${CT_SLUG}`, isList: articleList(CT_SLUG), goPage2: nextLink },
]

/**
 * Chạy một thao tác, chờ URL đích + mạng lặng, rồi trả các lượt gọi danh sách mà
 * thao tác đó gây ra. Chờ thêm một nhịp sau networkidle để một lượt gọi thừa bắn
 * muộn (sau khi danh sách đúng đã hiện) vẫn bị đếm.
 */
async function callsDuring(page: Page, calls: URL[], spec: ListSpec, urlPattern: RegExp, action: () => Promise<unknown>) {
  const from = calls.length
  await action()
  await expect(page).toHaveURL(urlPattern)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(400)
  await page.waitForLoadState('networkidle')
  return calls.slice(from).filter(spec.isList)
}

const describeCalls = (urls: URL[]) => urls.map(u => u.search).join(' | ') || '(không có)'

for (const spec of LIST_SPECS) {
  test(`${spec.label}: mỗi thao tác (trang 2, tìm kiếm từ trang 2, Back, Back, Forward) gửi ĐÚNG MỘT lượt gọi`, async ({ page }) => {
    const calls = recordListCalls(page)
    await openHydrated(page, `${spec.path}?e2e=count${stamp}`)

    const expectOne = (urls: URL[], step: string, check: (p: URLSearchParams) => boolean) => {
      expect(urls.length, `${step}: ${describeCalls(urls)}`).toBe(1)
      expect(check(urls[0]!.searchParams), `${step}: tham số sai ${describeCalls(urls)}`).toBe(true)
    }

    const p2 = await callsDuring(page, calls, spec, /[?&]page=2/, () => spec.goPage2(page))
    expectOne(p2, 'trang 2', p => p.get('page') === '2' && !p.get('search'))

    const word = spec.searchWord ?? SEARCH_WORD
    const input = page.locator('#main-content form input').first()
    const searched = await callsDuring(page, calls, spec, new RegExp(`[?&]q=${word}`), async () => {
      await input.fill(word)
      await input.press('Enter')
    })
    expectOne(searched, 'tìm kiếm từ trang 2', p => p.get('page') === '1' && p.get('search') === word)
    await expect(page.locator(`#main-content ${spec.path === '/media' ? 'li' : 'article'}`, { hasText: word }).first()).toBeVisible()
    await expect(page).not.toHaveURL(/[?&]page=/)

    const back1 = await callsDuring(page, calls, spec, /[?&]page=2/, () => page.goBack())
    expectOne(back1, 'Back về trang 2', p => p.get('page') === '2' && !p.get('search'))
    await expect(page).not.toHaveURL(/[?&]q=/)

    const back2 = await callsDuring(page, calls, spec, new RegExp(`${spec.path.replace(/\//g, '\\/')}\\?e2e=count`), () => page.goBack())
    expectOne(back2, 'Back về trang 1', p => p.get('page') === '1' && !p.get('search'))

    const forward = await callsDuring(page, calls, spec, /[?&]page=2/, () => page.goForward())
    expectOne(forward, 'Forward sang trang 2', p => p.get('page') === '2' && !p.get('search'))
  })
}

test('/news/<chuyên mục>: chuyển chuyên mục từ trang 2 → đúng một lượt gọi cho chuyên mục mới, không lượt nào cho chuyên mục cũ', async ({ page }) => {
  const calls = recordListCalls(page)
  const detailCalls: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/public/articles/')) detailCalls.push(url.pathname)
  })
  await openHydrated(page, `/news/${CAT_A}?page=2&e2e=pill${stamp}`)
  const from = calls.length
  await page.getByRole('button', { name: `${tag} Chuyên mục B` }).first().click()
  await expect(page).toHaveURL(new RegExp(`/news/${CAT_B}$`))
  await expect(page.locator('article', { hasText: title('catb', 1) })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(400)
  const after = calls.slice(from)
  expect(after.filter(articleList('news', CAT_A)).map(u => u.search), 'lượt gọi thừa cho chuyên mục cũ').toEqual([])
  expect(after.filter(articleList('news', CAT_B)).map(u => u.search)).toHaveLength(1)
  // Ghi chú, không khẳng định: `news/[category]/index.vue` (không thuộc phạm vi spec
  // này) có thể dựng tạm ArticleDetail trong lúc kiểm lại chuyên mục.
  test.info().annotations.push({ type: 'detail-calls', description: detailCalls.join(', ') || '(không có)' })
})

for (const [label, path, stale] of [
  ['/media', '/media?page=2', (url: URL) => url.pathname === '/api/public/media'],
  ['/news/<chuyên mục>', `/news/${CAT_A}?page=2`, articleList('news', CAT_A)],
] as const) {
  test(`${label}: rời trang bằng một liên kết → không bắn lượt gọi danh sách nào cho trang vừa rời`, async ({ page }) => {
    const calls = recordListCalls(page)
    await openHydrated(page, `${path}&e2e=leave${stamp}`)
    const from = calls.length
    await page.locator('header a[href="/contact"]').first().click()
    await expect(page).toHaveURL(/\/contact$/)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(400)
    expect(calls.slice(from).filter(stale).map(u => u.pathname + u.search)).toEqual([])
  })
}

/**
 * Ba danh sách vừa chuyển sang trạng thái dẫn xuất từ URL (`usePublicArticleList` /
 * `usePublicMediaList`): khoá `useAsyncData` của chúng đổi định dạng, nên phải chứng
 * minh lại rằng khoá phía máy chủ và phía trình duyệt khớp nhau — HTML thô đã chứa
 * danh sách, và lúc hydrate KHÔNG có lượt gọi nào (lệch khoá = một lượt nạp lại thừa
 * mỗi lần mở trang, và HTML trong bộ đệm SWR là HTML rỗng). Các test đếm ở trên lấy
 * mốc SAU khi hydrate xong nên không thấy được lượt thừa này.
 */
for (const [label, path, newest, isList, item] of [
  ['/news/<chuyên mục>', `/news/${CAT_A}`, () => title('cata', 21), articleList('news', CAT_A), 'article'],
  ['/<thể loại tự tạo>', `/${CT_SLUG}`, () => title('ct', 21), articleList(CT_SLUG), 'article'],
  ['/media', '/media', () => title('video', 13), (url: URL) => url.pathname === '/api/public/media', 'li'],
] as const) {
  test(`${label}: HTML máy chủ đã chứa danh sách, hydrate không nạp lại`, async ({ page }) => {
    const html = await (await page.request.get(`${path}?e2e=ssr${stamp}`)).text()
    expect(html).toContain(newest())

    const calls = recordListCalls(page)
    await openHydrated(page, `${path}?e2e=hydrate${stamp}`)
    await expect(page.locator(`#main-content ${item}`, { hasText: newest() }).first()).toBeVisible()
    await page.waitForTimeout(400)
    expect(calls.filter(isList).map(u => u.search)).toEqual([])
  })
}

test('/legal-qa: lọc phía trình duyệt — đổi trang và tìm kiếm KHÔNG gọi lại API', async ({ page }) => {
  const calls = recordListCalls(page)
  await openHydrated(page, `/legal-qa?e2e=count${stamp}`)
  const from = calls.length
  await clickPage(page, 2)
  await expect(page.getByText(/Trang\s+2\s+trên tổng số/)).toBeVisible()
  await page.getByRole('searchbox', { name: 'Tìm kiếm câu hỏi pháp luật' }).fill(SEARCH_WORD)
  await expect(page.getByRole('button', { name: new RegExp(SEARCH_WORD) })).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(calls.slice(from).filter(articleList('faq')).map(u => u.search)).toEqual([])
})

for (const [label, path, item, far] of [
  ['/media', '/media', 'li', 999],
  ['/<thể loại tự tạo>', `/${CT_SLUG}`, 'article', 999],
  // Bốn danh sách dùng `usePublicArticleList` trong trang riêng (không qua
  // ContentTypeListSection) — trước đây hiện "chưa có bài" và kẹt ở trang trắng.
  ['/news', '/news', 'article', 999999],
  ['/documents', '/documents', 'article', 999999],
  ['/role-models', '/role-models', 'article', 999999],
  ['/reintegration-models', '/reintegration-models', 'article', 999999],
] as const) {
  test(`${label}: ?page vượt quá số trang → có nút "Về trang đầu" đưa về danh sách`, async ({ page }) => {
    await openHydrated(page, `${path}?page=${far}&e2e=far${stamp}`)
    const back = page.getByRole('button', { name: 'Về trang đầu' })
    await expect(back).toBeVisible()
    await back.click()
    await expect(page).not.toHaveURL(/[?&]page=/)
    await expect(page.locator(`#main-content ${item}`, { hasText: tag }).first()).toBeVisible()
  })
}

/**
 * `/news/<chuyên mục>` khi lượt kiểm chuyên mục HỎNG (`/api/public/categories` 503):
 * trước đây trang hiểu "hỏng" là "không phải chuyên mục" và rơi sang ArticleDetail
 * (SSR còn trả 200 — đo trên bản build không CSDL). Nay: nhánh lỗi `role="alert"` +
 * "Thử lại" đọc lại đúng lượt kiểm, rồi hiện danh sách chuyên mục.
 * Phía SSR (503 + no-store) không dựng được ở đây — CSDL của cả bộ phải sống; nó được
 * dò thủ công trên bản build không CSDL (công thức ở đầu `tests/error-no-store.test.ts`). Ở đây lỗi được dựng
 * DETERMINISTIC bằng chặn mạng phía trình duyệt trên một lượt điều hướng client.
 */
test('/news/<chuyên mục>: lượt kiểm chuyên mục hỏng → báo lỗi + Thử lại (không rơi sang trang bài)', async ({ page }) => {
  await openHydrated(page, `/news?e2e=catfail${stamp}`)
  const categories = '**/api/public/categories**'
  await page.route(categories, route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    headers: { 'cache-control': 'no-store' },
    body: JSON.stringify({ ok: false, items: [] }),
  }))
  await page.getByRole('button', { name: `${tag} Chuyên mục A` }).first().click()
  await expect(page).toHaveURL(new RegExp(`/news/${CAT_A}$`))
  const alert = page.locator('#main-content [role="alert"]', { hasText: 'Không thể tải danh sách bản tin' })
  await expect(alert).toBeVisible()
  // Không có danh sách chuyên mục nào (chưa biết đây là chuyên mục).
  await expect(page.locator('#main-content article', { hasText: title('cata', 21) })).toHaveCount(0)

  await page.unroute(categories)
  await alert.getByRole('button', { name: /thử lại/i }).click()
  await expect(page.locator('#main-content article', { hasText: title('cata', 21) }).first()).toBeVisible()
  await expect(alert).toHaveCount(0)
})

test('/news/<X> khi CSDL khoẻ: chuyên mục thật và bài thật vẫn 200 (lượt kiểm hỏng không lan sang đường đúng)', async ({ request }) => {
  const category = await request.get(`/news/${CAT_A}?e2e=ok${stamp}`)
  expect(category.status()).toBe(200)
  expect(await category.text()).toContain(title('cata', 21))
  const article = await request.get(`/news/${tag.toLowerCase()}-tin-25?e2e=ok${stamp}`)
  expect(article.status()).toBe(200)
  expect(await article.text()).toContain(title('tin', 25))
})
