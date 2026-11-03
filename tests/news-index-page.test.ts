/**
 * `/news` (app/pages/news/index.vue) — behaviour, written BEFORE the wave3 4.2 split and
 * green on the original file: the page as a reader drives it, through the real list
 * composables, against a fake network that answers like the two public endpoints
 * (tests/_news-page-harness.ts).
 *
 * Pinned: what is requested (and how often), what each state shows — skeletons, the
 * error card and its retry, the two empty states, the featured story, the grid, the
 * pagination — what every control navigates to (the URL is the source of truth;
 * `usePublicArticleList`), the category filter bar (root + sub-topics, legacy `?cat=`),
 * the right rail, SEO, and the language switch.
 *
 * `NEWS_PAGE_FILE=<file>` runs the same suite against another version of the page;
 * `NEWS_PAGE_DOM_LOG=<file>` records the DOM after every step (the split's DOM proof).
 * Defects found while splitting are in tests/news-index-page-findings.test.ts.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { click, fire, findAll, input } from './_sfc-mount.ts'
import {
  GRID_CLASS, HOLD, alerts, articleCards, busy, busyLabels, buttonsWith, byTag, cardTitle, dropped, h1, isCategories, isList, isMostRead,
  links, navByLabel, newsServer, openNews, pills, pressed, queryOf, rail, searchForm, searchInput, words, unavailable, widget, type NetCall,
} from './_news-page-harness.ts'

const lists = (calls: NetCall[]) => calls.filter(isList).map(queryOf)
const mostReads = (calls: NetCall[]) => calls.filter(isMostRead).map(queryOf)
const categoryCalls = (calls: NetCall[]) => calls.filter(isCategories).map(queryOf)

test('first load: the list, "Đọc nhiều" and the categories — one request each, all lazy', async (t) => {
  const ctx = await openNews(t)
  assert.deepEqual(lists(ctx.calls), [{ type: 'news', limit: '19', page: '1', lang: 'vi' }])
  assert.deepEqual(mostReads(ctx.calls), [{ type: 'news', limit: '6', sort: 'views', lang: 'vi' }])
  assert.equal(categoryCalls(ctx.calls).length, 1)
  assert.equal(categoryCalls(ctx.calls)[0]!.type, 'news')
  assert.equal(ctx.calls.length, 3)
  // lazy: a client-side navigation paints the skeleton instead of freezing.
  assert.deepEqual(ctx.registrations.map(r => r.lazy), [true, true, true])
  // …and none of the three opts out of the server render: Nuxt fetches `server !== false`
  // data during SSR and waits for it (`onServerPrefetch`), so the HTML a visitor first gets
  // — and the swr cache of the children `/news/**` — carries the list, "Đọc nhiều" and the
  // category chips. `server: false` would ship the chips as an empty bar until hydration.
  // The chips in the SSR HTML were read off a production build (test-coverage-baseline § R8).
  assert.deepEqual(ctx.registrations.filter(r => r.server === false).map(r => r.key), [])
  assert.equal(ctx.registrations.find(r => r.key.startsWith('news-categories'))?.server, undefined, 'the chips are fetched on the server too')
  assert.deepEqual(ctx.seo(), {
    title: 'Tin Hoạt Động | Con Đường Hướng Thiện',
    description: 'Cập nhật thông tin chỉ đạo điều hành, hoạt động cơ sở và công tác hỗ trợ hoàn lương trên toàn quốc.',
  })
  assert.equal(h1(ctx.page), 'Tin Hoạt Động')
  assert.equal(byTag(ctx.page, 'h1').length, 1, 'exactly one h1 (tests/e2e/public-single-h1.spec.ts)')
  assert.deepEqual(alerts(ctx.page), [])
  assert.deepEqual(busy(ctx.page), [])
})

test('breadcrumb: Trang chủ › Bản tin, no category on the bare list', async (t) => {
  const ctx = await openNews(t)
  const crumb = navByLabel(ctx.page, 'Đường dẫn trang')!
  assert.deepEqual(links(crumb), [{ to: '/', text: 'Trang chủ' }])
  assert.equal(words(crumb), 'Trang chủ › Bản tin')
})

test('page 1 without a search: the first story is featured, the rest fill the grid', async (t) => {
  const ctx = await openNews(t)
  const cards = articleCards(ctx.page)
  assert.equal(cards.length, 19, 'featured + 18 cards')
  const featured = cards[0]!
  assert.equal(cardTitle(featured), 'Bản tin số 1')
  assert.match(words(featured), /^Nổi bật Tin hoạt động 02\/10\/2026 Bản tin số 1 Ngày 1: tóm tắt bài 1 Đọc tiếp$/)
  assert.deepEqual(links(featured).map(l => l.to), ['/news/ban-tin-1', '/news/ban-tin-1', '/news/ban-tin-1'])
  const img = byTag(featured, 'SafeImg')[0]!
  assert.equal(img.props.src, '/uploads/2026/10/tin-1.webp')
  assert.equal(img.props.alt, 'Bản tin số 1')
  assert.equal(img.props.sizes, '384px sm:512px lg:768px')
  assert.equal(img.props.loading, 'lazy')

  // The grid, in order: 2…19.
  assert.deepEqual(cards.slice(1).map(cardTitle), Array.from({ length: 18 }, (_, i) => `Bản tin số ${i + 2}`))
  const grid = cards[1]!.parent!
  assert.equal(grid.props.class, GRID_CLASS, 'the configured grid class (useLayoutConfig)')
})

test('a grid card: category badge only when known, date (published, else created), excerpt only when present', async (t) => {
  const ctx = await openNews(t)
  const card = (n: number) => articleCards(ctx.page).find(c => cardTitle(c) === `Bản tin số ${n}`)!
  // n=2: category, date, excerpt (entities decoded, tags stripped).
  assert.equal(words(card(2)), 'Tin địa phương 03/10/2026 Bản tin số 2 Ngày 2: tóm tắt bài 2 Chi tiết Bản tin C11')
  // n=3: no category name; n=4: no excerpt; n=5: no publishedAt → createdAt (UTC date).
  assert.equal(words(card(3)), '04/10/2026 Bản tin số 3 Ngày 3: tóm tắt bài 3 Chi tiết Bản tin C11')
  assert.equal(words(card(4)), 'Tin địa phương 05/10/2026 Bản tin số 4 Chi tiết Bản tin C11')
  assert.equal(words(card(5)), 'Tin hoạt động 30/09/2026 Bản tin số 5 Ngày 5: tóm tắt bài 5 Chi tiết Bản tin C11')
  // No thumbnail → the hero banner.
  assert.equal(byTag(card(2), 'SafeImg')[0]!.props.src, '/assets/hero_banner.jpg')
  assert.equal(byTag(card(2), 'SafeImg')[0]!.props.sizes, '256px sm:384px lg:512px')
  assert.deepEqual(links(card(2)).map(l => l.to), ['/news/ban-tin-2', '/news/ban-tin-2', '/news/ban-tin-2'])
})

test('the list header counts the whole list and says which page this is', async (t) => {
  const ctx = await openNews(t)
  const heading = byTag(ctx.page, 'h2').find(h => words(h) === 'Danh sách bản tin')!
  assert.equal(words(heading.parent!.parent!), 'Danh sách bản tin 45 tin Trang 1 / 3')
})

test('pagination: prev disabled on page 1, the current page marked, a number navigates', async (t) => {
  const ctx = await openNews(t)
  const nav = navByLabel(ctx.page, 'Phân trang bản tin')!
  assert.match(words(nav), /^Hiển thị trang 1 trên tổng số 3 trang 1 2 3$/)
  const [prev, ...rest] = byTag(nav, 'button')
  const next = rest.at(-1)!
  assert.equal(prev!.props['aria-label'], 'Trước')
  assert.equal(prev!.props.disabled, true)
  assert.equal(next.props['aria-label'], 'Sau')
  assert.equal(next.props.disabled, false)
  const numbers = byTag(nav, 'button').filter(b => /^\d+$/.test(words(b)))
  assert.deepEqual(numbers.map(b => [words(b), b.props['aria-current'] ?? null]), [['1', 'page'], ['2', null], ['3', null]])

  await click(numbers[1]!)
  await ctx.settle()
  assert.deepEqual(ctx.navigations, [{ path: '/news', query: { page: 2 } }])
  assert.deepEqual(lists(ctx.calls).at(-1), { type: 'news', limit: '19', page: '2', lang: 'vi' })
  // Page 2: no featured story, the 19 articles are all grid cards.
  assert.equal(articleCards(ctx.page).length, 19)
  assert.equal(cardTitle(articleCards(ctx.page)[0]!), 'Bản tin số 20')
  assert.equal(words(articleCards(ctx.page)[0]!).startsWith('Nổi bật'), false)
  const nav2 = navByLabel(ctx.page, 'Phân trang bản tin')!
  assert.equal(byTag(nav2, 'button').find(b => words(b) === '2')!.props['aria-current'], 'page')
})

test('pagination: "Sau" and "Trước" step one page; "Sau" is disabled on the last page', async (t) => {
  const ctx = await openNews(t, newsServer(), { query: { page: '3' } })
  const nav = navByLabel(ctx.page, 'Phân trang bản tin')!
  const buttons = byTag(nav, 'button')
  assert.equal(buttons.at(-1)!.props.disabled, true)
  await click(buttons[0]!)
  await ctx.settle()
  assert.deepEqual(ctx.navigations, [{ path: '/news', query: { page: 2 } }])
  await click(byTag(navByLabel(ctx.page, 'Phân trang bản tin')!, 'button').at(-1)!)
  await ctx.settle()
  assert.deepEqual(ctx.navigations.at(-1), { path: '/news', query: { page: 3 } })
})

test('pagination: gaps in a long range show an ellipsis', async (t) => {
  const server = newsServer()
  server.state.total = 190
  const ctx = await openNews(t, server, { query: { page: '5' } })
  const nav = navByLabel(ctx.page, 'Phân trang bản tin')!
  assert.match(words(nav), /1 … 4 5 6 … 10$/)
  const dots = findAll(nav, el => el.tag === 'span' && words(el) === '…')
  assert.equal(dots.length, 2)
  assert.ok(dots.every(d => d.props['aria-hidden'] === 'true'))
})

test('one page only: no pagination, no page label', async (t) => {
  const server = newsServer()
  server.state.total = 7
  const ctx = await openNews(t, server)
  assert.equal(navByLabel(ctx.page, 'Phân trang bản tin'), null)
  const heading = byTag(ctx.page, 'h2').find(h => words(h) === 'Danh sách bản tin')!
  assert.equal(words(heading.parent!.parent!), 'Danh sách bản tin 7 tin')
})

test('a single article: featured only, no list header and no grid', async (t) => {
  const server = newsServer()
  server.state.total = 1
  const ctx = await openNews(t, server)
  assert.equal(articleCards(ctx.page).length, 1)
  assert.equal(byTag(ctx.page, 'h2').some(h => words(h) === 'Danh sách bản tin'), false)
})

test('search: the draft goes to the URL on submit; the banner names it and counts the results', async (t) => {
  const ctx = await openNews(t)
  assert.equal(buttonsWith(searchForm(ctx.page), '✕').length, 0, 'no clear button while the box is empty')
  await input(searchInput(ctx.page), '  hoàn lương  ')
  await ctx.settle()
  assert.equal(buttonsWith(searchForm(ctx.page), '✕').length, 1)
  await fire(searchForm(ctx.page), 'submit')
  await ctx.settle()
  assert.deepEqual(ctx.navigations, [{ path: '/news', query: { q: 'hoàn lương' } }])
  assert.deepEqual(lists(ctx.calls).at(-1), { type: 'news', limit: '19', page: '1', lang: 'vi', search: 'hoàn lương' })
  assert.equal(searchInput(ctx.page).model!.value, 'hoàn lương', 'the box follows the URL')
  const banner = buttonsWith(ctx.page, 'Xóa bộ lọc')[0]!.parent!
  assert.equal(words(banner), 'Kết quả tìm kiếm cho: «hoàn lương» (4 bài viết) Xóa bộ lọc')
  // A search shows no featured story.
  assert.equal(articleCards(ctx.page).length, 4)
  assert.ok(articleCards(ctx.page).every(c => !words(c).startsWith('Nổi bật')))

  await click(buttonsWith(ctx.page, 'Xóa bộ lọc')[0]!)
  await ctx.settle()
  assert.deepEqual(ctx.navigations.at(-1), { path: '/news', query: {} })
  assert.equal(searchInput(ctx.page).model!.value, '')
  assert.equal(buttonsWith(ctx.page, 'Xóa bộ lọc').length, 0)
})

test('search submit stays in the page: the browser\'s own form submission is prevented', async (t) => {
  // The form has no `action`/`name`d field: let the browser submit it and it reloads
  // `/news?` (a full GET, the draft lost, nothing searched) instead of navigating.
  const ctx = await openNews(t)
  await input(searchInput(ctx.page), 'hoàn lương')
  await ctx.settle()
  const form = searchForm(ctx.page)
  let prevented = 0
  const event = { type: 'submit', target: form, currentTarget: form, preventDefault() { prevented += 1 }, stopPropagation() {} }
  await fire(form, 'submit', event)
  await ctx.settle()
  assert.equal(prevented, 1, 'submit.preventDefault() called once')
  assert.deepEqual(ctx.navigations, [{ path: '/news', query: { q: 'hoàn lương' } }])
  assert.equal(form.props.action, undefined)
})

test('search banner: no count while the results are loading', async (t) => {
  const server = newsServer()
  server.state.override = call => (isList(call) ? HOLD : undefined)
  const ctx = await openNews(t, server, { query: { q: 'abc' } })
  const banner = buttonsWith(ctx.page, 'Xóa bộ lọc')[0]!.parent!
  assert.equal(words(banner), 'Kết quả tìm kiếm cho: «abc» Xóa bộ lọc')
})

test('the ✕ in the box: clears the draft; navigates only when a search is active', async (t) => {
  const ctx = await openNews(t)
  await input(searchInput(ctx.page), 'nháp')
  await ctx.settle()
  await click(buttonsWith(searchForm(ctx.page), '✕')[0]!)
  await ctx.settle()
  assert.equal(searchInput(ctx.page).model!.value, '')
  assert.deepEqual(ctx.navigations, [])

  const active = await openNews(t, newsServer(), { query: { q: 'tái hoà nhập', page: '2' } })
  assert.equal(searchInput(active.page).model!.value, 'tái hoà nhập')
  const clear = buttonsWith(searchForm(active.page), '✕')[0]!
  assert.equal(clear.props['aria-label'], 'Xóa từ khóa tìm kiếm')
  await click(clear)
  await active.settle()
  assert.deepEqual(active.navigations, [{ path: '/news', query: {} }])
})

test('category pills: "Tất cả" pressed on the bare list; a root category goes to its own path', async (t) => {
  const ctx = await openNews(t)
  assert.deepEqual(pills(ctx.page).map(words), ['Tất cả bản tin', 'Tin nổi bật', 'Tin hoạt động', 'Tin địa phương'])
  assert.deepEqual(pressed(ctx.page), ['Tất cả bản tin'])
  // Icon by slug: "nổi bật" → star; others → newspaper.
  assert.match(String(byTag(pills(ctx.page)[1]!, 'i')[0]!.props.class), /fa-star/)
  assert.match(String(byTag(pills(ctx.page)[2]!, 'i')[0]!.props.class), /fa-newspaper/)
  await click(pills(ctx.page)[3]!)
  await ctx.settle()
  assert.deepEqual(ctx.navigations, [{ path: '/news/tin-dia-phuong', query: {} }])
  await click(pills(ctx.page)[0]!)
  assert.deepEqual(ctx.navigations.at(-1), { path: '/news', query: {} })
})

test('legacy ?cat=<child>: the crumb and the h1 name it, sub-topics of its root show, the list filters by it', async (t) => {
  const ctx = await openNews(t, newsServer(), { query: { cat: 'dia-phuong-mien-bac' } })
  assert.equal(lists(ctx.calls)[0]!.categorySlug, 'dia-phuong-mien-bac')
  assert.equal(h1(ctx.page), 'Miền Bắc')
  assert.equal(words(navByLabel(ctx.page, 'Đường dẫn trang')!), 'Trang chủ › Bản tin › Miền Bắc')
  assert.deepEqual(pressed(ctx.page), ['Miền Bắc'])
  const subtopics = buttonsWith(ctx.page, 'Miền')
  assert.deepEqual(subtopics.filter(b => b.props['aria-pressed'] !== undefined).map(words), ['Miền Bắc', 'Miền Nam'])
  const sub = pills(ctx.page).find(b => words(b) === 'Miền Nam')!
  await click(sub)
  assert.deepEqual(ctx.navigations, [{ path: '/news/dia-phuong-mien-nam', query: {} }])
})

test('legacy ?cat=<root with children>: its sub-topics show; a root without children shows none', async (t) => {
  const ctx = await openNews(t, newsServer(), { query: { cat: 'tin-dia-phuong' } })
  assert.equal(h1(ctx.page), 'Tin địa phương')
  assert.match(words(navByLabel(ctx.page, 'Lọc bản tin theo chuyên mục')!), /Chuyên đề: Miền Bắc Miền Nam$/)
  const plain = await openNews(t, newsServer(), { query: { cat: 'tin-hoat-dong' } })
  assert.doesNotMatch(words(navByLabel(plain.page, 'Lọc bản tin theo chuyên mục')!), /Chuyên đề/)
})

test('legacy ?cat=<unknown>: generic heading, no category in the crumb, nothing pressed', async (t) => {
  const ctx = await openNews(t, newsServer(), { query: { cat: 'khong-co' } })
  assert.equal(h1(ctx.page), 'Tin Hoạt Động')
  assert.equal(words(navByLabel(ctx.page, 'Đường dẫn trang')!), 'Trang chủ › Bản tin')
  assert.deepEqual(pressed(ctx.page), [])
})

test('categories loading: five grey chips announced as busy; the pills replace them', async (t) => {
  const server = newsServer()
  const held: NetCall[] = []
  server.state.override = (call) => {
    if (!isCategories(call)) return undefined
    held.push(call)
    return HOLD
  }
  const ctx = await openNews(t, server)
  const filter = navByLabel(ctx.page, 'Lọc bản tin theo chuyên mục')!
  const chips = findAll(filter, el => el.props.role === 'status' && el.props['aria-busy'] === 'true')
  assert.equal(chips.length, 1)
  assert.equal(words(chips[0]!), 'Đang tải danh mục bản tin')
  assert.equal(findAll(chips[0]!, el => el.props['aria-hidden'] === 'true' && String(el.props.class).includes('animate-pulse')).length, 5)
  assert.equal(byTag(filter, 'button').length, 0)
  // The rail's category widget waits for the data too.
  assert.equal(widget(ctx.page, 'Chuyên mục'), null)
  server.answer(held[0]!)
  await ctx.settle()
  assert.equal(pills(ctx.page).length, 4)
  assert.notEqual(widget(ctx.page, 'Chuyên mục'), null)
})

test('list loading: one skeleton (hero + six cards) announced as busy, no cards, no empty state', async (t) => {
  const server = newsServer()
  server.state.override = call => (isList(call) ? HOLD : undefined)
  const ctx = await openNews(t, server)
  assert.deepEqual(busyLabels(ctx.page), ['Đang tải danh sách bản tin'])
  assert.equal(articleCards(ctx.page).length, 0)
  assert.equal(buttonsWith(ctx.page, 'Xem tất cả bản tin').length, 0)
  const skeleton = busy(ctx.page)[0]!
  const pulses = findAll(skeleton, el => String(el.props.class ?? '').includes('animate-pulse'))
  assert.equal(pulses.length, 7)
  assert.ok(pulses.every(el => String(el.props.class).includes('motion-reduce:animate-none')))
  assert.equal(navByLabel(ctx.page, 'Phân trang bản tin'), null)
})

test('list failure (503): the error card is an alert; "Thử lại ngay" re-runs the same request', async (t) => {
  const server = newsServer()
  server.state.override = call => (isList(call) ? unavailable({ ok: false, articles: [], pagination: { page: 1, limit: 19, total: 0, totalPages: 1 } }) : undefined)
  const ctx = await openNews(t, server)
  assert.deepEqual(alerts(ctx.page).map(words), ['Không thể tải danh sách bản tin Đã xảy ra lỗi khi kết nối dữ liệu máy chủ. Thử lại ngay'])
  assert.equal(articleCards(ctx.page).length, 0)
  assert.equal(buttonsWith(ctx.page, 'Xem tất cả bản tin').length, 0, 'a failure is not "no news"')
  assert.equal(navByLabel(ctx.page, 'Phân trang bản tin'), null)

  // (ofetch itself retries a GET once on a 503 — as in the browser.)
  const before = lists(ctx.calls).length
  server.state.override = () => undefined
  await click(buttonsWith(ctx.page, 'Thử lại ngay')[0]!)
  await ctx.settle()
  assert.equal(lists(ctx.calls).length, before + 1)
  assert.deepEqual(lists(ctx.calls).at(-1), lists(ctx.calls)[0], 'the same request again')
  assert.deepEqual(alerts(ctx.page), [])
  assert.equal(articleCards(ctx.page).length, 19)
})

test('list failure (connection dropped) shows the same card', async (t) => {
  const server = newsServer()
  server.state.override = call => (isList(call) ? dropped() : undefined)
  const ctx = await openNews(t, server)
  assert.equal(alerts(ctx.page).length, 1)
  assert.equal(buttonsWith(ctx.page, 'Thử lại ngay').length, 1)
})

test('empty list: says so, and offers the whole list (search and category cleared)', async (t) => {
  const server = newsServer()
  server.state.searchTotal = 0
  const ctx = await openNews(t, server, { query: { q: 'không có', cat: 'tin-hoat-dong' } })
  const empty = byTag(ctx.page, 'h3').find(h => words(h) === 'Chưa có bản tin phù hợp')!.parent!
  assert.match(words(empty), /^Chưa có bản tin phù hợp Không tìm thấy bài viết nào theo tiêu chí lựa chọn hiện tại\..* Xem tất cả bản tin$/)
  assert.equal(alerts(ctx.page).length, 0)
  await click(buttonsWith(ctx.page, 'Xem tất cả bản tin')[0]!)
  await ctx.settle()
  assert.deepEqual(ctx.navigations, [{ path: '/news', query: {} }])
  assert.equal(searchInput(ctx.page).model!.value, '')
})

test('?page past the last page: not "no news" — a way back to page 1 that keeps the search', async (t) => {
  const ctx = await openNews(t, newsServer(), { query: { q: 'x', page: '9' } })
  const empty = buttonsWith(ctx.page, 'Về trang đầu')[0]!.parent!
  assert.equal(words(empty), 'Trang này không có nội dung — danh sách chỉ có 1 trang. Về trang đầu')
  assert.equal(byTag(ctx.page, 'h3').some(h => words(h) === 'Chưa có bản tin phù hợp'), false)
  await click(buttonsWith(ctx.page, 'Về trang đầu')[0]!)
  await ctx.settle()
  assert.deepEqual(ctx.navigations, [{ path: '/news', query: { q: 'x' } }])
})

test('"Đọc nhiều": skeleton while loading, then six ranked links (top three highlighted)', async (t) => {
  const server = newsServer()
  const held: NetCall[] = []
  server.state.override = (call) => {
    if (!isMostRead(call)) return undefined
    held.push(call)
    return HOLD
  }
  const ctx = await openNews(t, server)
  const box = widget(ctx.page, 'Đọc nhiều')!
  assert.deepEqual(findAll(box, el => el.props.role === 'status').map(words), ['Đang tải tin đọc nhiều'])
  server.answer(held[0]!)
  await ctx.settle()
  const items = byTag(widget(ctx.page, 'Đọc nhiều')!, 'li')
  assert.deepEqual(items.map(words), ['1 Đọc nhiều 1', '2 Đọc nhiều 2', '3 Đọc nhiều 3', '4 Đọc nhiều 4', '5 Đọc nhiều 5', '6 Đọc nhiều 6'])
  assert.deepEqual(items.map(li => byTag(li, 'span')[0]!.props.class).map(c => String(c).includes('text-accent')), [true, true, true, false, false, false])
  assert.deepEqual(links(widget(ctx.page, 'Đọc nhiều')!).map(l => l.to), [100, 101, 102, 103, 104, 105].map(n => `/news/ban-tin-${n}`))
})

test('"Đọc nhiều" with no data says so', async (t) => {
  const server = newsServer()
  server.state.mostRead = []
  const ctx = await openNews(t, server)
  assert.equal(words(widget(ctx.page, 'Đọc nhiều')!), 'Đọc nhiều Chưa có dữ liệu lượt xem.')
})

test('rail "Chuyên mục": every root category, the active one marked, a click filters', async (t) => {
  const ctx = await openNews(t, newsServer(), { query: { cat: 'tin-noi-bat' } })
  const box = widget(ctx.page, 'Chuyên mục')!
  const buttons = byTag(box, 'button')
  assert.deepEqual(buttons.map(words), ['Tất cả bản tin', 'Tin nổi bật', 'Tin hoạt động', 'Tin địa phương'])
  assert.deepEqual(buttons.map(b => String(b.props.class).split(/\s+/).includes('text-brand-800')), [false, true, false, false])
  await click(buttons[2]!)
  assert.deepEqual(ctx.navigations, [{ path: '/news/tin-hoat-dong', query: {} }])
  await click(buttons[0]!)
  assert.deepEqual(ctx.navigations.at(-1), { path: '/news', query: {} })
})

test('rail "Chuyên mục" is absent when there are no categories', async (t) => {
  const server = newsServer()
  server.state.categories = []
  const ctx = await openNews(t, server)
  assert.equal(widget(ctx.page, 'Chuyên mục'), null)
  assert.deepEqual(pills(ctx.page).map(words), ['Tất cả bản tin'])
})

test('rail: hotline and quick links', async (t) => {
  const ctx = await openNews(t)
  const hotline = widget(ctx.page, 'Đường Dây Nóng Tư Vấn')!
  const tel = byTag(hotline, 'a')[0]!
  assert.equal(tel.props.href, 'tel:0903480985')
  assert.equal(words(tel), '0903.480.985')
  assert.deepEqual(links(hotline), [{ to: '/assistant', text: 'Hỏi Trợ Lý AI 24/7' }])
  assert.deepEqual(links(widget(ctx.page, 'Tiện ích tra cứu')!), [
    { to: '/documents', text: 'Văn bản quy phạm pháp luật' },
    { to: '/legal-qa', text: 'Hỏi đáp pháp luật' },
    { to: '/role-models', text: 'Tấm gương tiêu biểu' },
    { to: '/reintegration-models', text: 'Mô hình tái hòa nhập' },
  ])
  assert.deepEqual(byTag(rail(ctx.page), 'h2').map(words), ['Đọc nhiều', 'Chuyên mục', 'Tiện ích tra cứu'])
})

test('switching the language reloads the list and "Đọc nhiều" with the new lang, and relabels the page', async (t) => {
  const ctx = await openNews(t)
  ctx.currentLang.value = 'en'
  await ctx.settle()
  assert.deepEqual(lists(ctx.calls).at(-1), { type: 'news', limit: '19', page: '1', lang: 'en' })
  assert.deepEqual(mostReads(ctx.calls).at(-1), { type: 'news', limit: '6', sort: 'views', lang: 'en' })
  assert.equal(lists(ctx.calls).length, 2, 'one reload, not two')
  assert.equal(mostReads(ctx.calls).length, 2)
  assert.equal(cardTitle(articleCards(ctx.page)[0]!), 'News item 1')
  assert.equal(words(byTag(widget(ctx.page, 'Most read')!, 'li')[0]!), '1 Đọc nhiều 1 (en)')
  assert.equal(h1(ctx.page), ctx.seo().title.split(' | ')[0])
  assert.equal(pills(ctx.page)[0] && words(pills(ctx.page)[0]!), 'All news')
})

test('no HTML is rendered from data: no v-html on the page', async (t) => {
  const ctx = await openNews(t)
  assert.doesNotMatch(ctx.page.html(), /innerHTML=/)
})

test('the scroll anchor the pager scrolls to is above the list', async (t) => {
  const ctx = await openNews(t)
  const anchor = findAll(ctx.page.root, el => el.props.id === 'news-list-top')
  assert.equal(anchor.length, 1)
  assert.equal(anchor[0]!.props.class, 'scroll-mt-[100px]')
})
