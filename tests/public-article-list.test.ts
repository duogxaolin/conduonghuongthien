/**
 * Danh sách bài viết công khai (`/news`, `/documents`, `/role-models`,
 * `/reintegration-models`): bấm trang 2 hay tìm kiếm phải nạp lại danh sách.
 *
 * Lỗi đã gặp: `useAsyncData('news-articles-list', …)` khoá cố định, không `watch`.
 * `navigateTo('?page=2')` giữ nguyên component (Nuxt khoá trang theo path), nên
 * lượt fetch không bao giờ chạy lại — URL báo trang 2, danh sách vẫn trang 1.
 *
 * Phần 1 kiểm các hàm thuần (đọc URL, dựng query, dựng khoá). Phần 2 chạy THẬT
 * `usePublicArticleList` với bản giả tối thiểu của `useRoute` / `useAsyncData` /
 * `navigateTo` / `$fetch` trên `globalThis` — bản giả `useAsyncData` làm đúng
 * điều Nuxt 4 làm (fetch khi khoá dạng hàm đổi giá trị, fetch khi nguồn `watch`
 * đổi), nên một khoá cố định không `watch` sẽ làm test đỏ như lỗi thật.
 * Kiểm bằng trình duyệt thật: `tests/e2e/public-list-pagination.spec.ts`.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { nextTick, queuePostFlushCb, reactive, ref, watch, type Ref, type WatchSource } from 'vue'
import {
  buildArticleListQuery,
  buildMostReadQuery,
  listDataKey,
  listLocation,
  readListRouteState,
  isPageOutOfRange,
} from '../app/utils/public-article-list'

// ─── Phần 1: hàm thuần ───────────────────────────────────────────────────────

test('readListRouteState đọc trang / từ khoá từ URL, phòng thủ giá trị bừa', () => {
  assert.deepEqual(readListRouteState({}), { page: 1, search: '', category: 'all' })
  assert.deepEqual(readListRouteState({ page: '3', q: '  vay vốn ' }), { page: 3, search: 'vay vốn', category: 'all' })
  assert.deepEqual(readListRouteState({ page: 'abc', q: ['x', 'y'] }), { page: 1, search: 'x', category: 'all' })
})

test('readListRouteState chỉ nhận ?cat= khi trang khai báo có bộ lọc chuyên mục', () => {
  assert.equal(readListRouteState({ cat: 'tin-dia-phuong' }).category, 'all')
  assert.equal(readListRouteState({ cat: 'tin-dia-phuong' }, { withCategory: true }).category, 'tin-dia-phuong')
  assert.equal(readListRouteState({ cat: '' }, { withCategory: true }).category, 'all')
})

test('buildArticleListQuery luôn gửi lang; chỉ gửi search/categorySlug khi có', () => {
  assert.deepEqual(
    buildArticleListQuery({ type: 'news', perPage: 19, page: 2, search: '', category: 'all', lang: 'en' }),
    { type: 'news', limit: 19, page: 2, lang: 'en' },
  )
  assert.deepEqual(
    buildArticleListQuery({ type: 'news', perPage: 19, page: 1, search: 'học nghề', category: 'tin-noi-bat', lang: 'vi' }),
    { type: 'news', limit: 19, page: 1, lang: 'vi', search: 'học nghề', categorySlug: 'tin-noi-bat' },
  )
  assert.deepEqual(buildMostReadQuery('role_model', 'vi'), { type: 'role_model', limit: 6, sort: 'views', lang: 'vi' })
})

test('listDataKey: mỗi tham số đổi → khoá đổi (đây là thứ làm Nuxt fetch lại)', () => {
  const base = { type: 'news', perPage: 19, page: 1, search: '', category: 'all', lang: 'vi' }
  const key = (patch: Partial<typeof base>) => listDataKey('public-articles', buildArticleListQuery({ ...base, ...patch }))
  const keys = [
    key({}),
    key({ page: 2 }),
    key({ search: 'vay' }),
    key({ category: 'tin-noi-bat' }),
    key({ lang: 'en' }),
    key({ type: 'document' }),
    key({ perPage: 3 }),
  ]
  assert.equal(new Set(keys).size, keys.length, keys.join('\n'))
  // Cùng tham số → cùng khoá (cache payload SSR → hydrate khớp nhau).
  assert.equal(key({ page: 2 }), key({ page: 2 }))
})

test('listDataKey không va chạm khi từ khoá chứa ký tự phân cách', () => {
  const base = { type: 'news', perPage: 19, category: 'all', lang: 'vi' }
  const a = listDataKey('p', buildArticleListQuery({ ...base, page: 1, search: '2-all' }))
  const b = listDataKey('p', buildArticleListQuery({ ...base, page: 12, search: 'all' }))
  const c = listDataKey('p', buildArticleListQuery({ ...base, page: 1, search: '2' }))
  assert.equal(new Set([a, b, c]).size, 3)
})

test('listLocation chỉ ghi ?q / ?page khi cần', () => {
  assert.deepEqual(listLocation('/news', { search: '', page: 1 }), { path: '/news', query: {} })
  assert.deepEqual(listLocation('/documents', { search: 'Vay vốn', page: 3 }), { path: '/documents', query: { q: 'Vay vốn', page: 3 } })
})

// ─── Phần 2: composable chạy thật với Nuxt giả tối thiểu ──────────────────────

interface FakeNuxt {
  route: { query: Record<string, unknown> }
  fetches: Array<{ url: string; query: Record<string, unknown> }>
  navigations: unknown[]
  keys: Array<string | (() => string)>
  responder: (query: Record<string, unknown>) => unknown
}

type Handler = () => Promise<unknown>
interface AsyncDataOptions { default?: () => unknown; watch?: WatchSource[] }

/**
 * Bản giả `useAsyncData` theo hành vi Nuxt 4.6 (`node_modules/nuxt/dist/app/composables/asyncData.js`):
 * - fetch lần đầu;
 * - khoá là hàm/ref → `watch(key)`: khoá đổi giá trị thì fetch;
 * - `options.watch` → nguồn đổi thì fetch (trừ khi đúng nhịp đó khoá cũng đổi).
 * Khoá chuỗi cố định + không `watch` = không bao giờ fetch lại — đúng lỗi thật.
 */
function installFakeNuxt(): FakeNuxt {
  const fake: FakeNuxt = {
    route: reactive({ query: {} as Record<string, unknown> }),
    fetches: [],
    navigations: [],
    keys: [],
    responder: () => ({ ok: true, articles: [], pagination: { page: 1, limit: 19, total: 0, totalPages: 1 } }),
  }
  const g = globalThis as Record<string, unknown>
  g.useRoute = () => fake.route
  g.navigateTo = (to: unknown) => { fake.navigations.push(to); return Promise.resolve() }
  g.$fetch = (url: string, options: { query: Record<string, unknown> }) => {
    fake.fetches.push({ url, query: { ...options.query } })
    return Promise.resolve(fake.responder(options.query))
  }
  g.useAsyncData = (key: string | (() => string), handler: Handler, options: AsyncDataOptions = {}) => {
    fake.keys.push(key)
    const data: Ref<unknown> = ref(options.default?.())
    const pending = ref(false)
    const error = ref<unknown>(null)
    const run = async () => {
      pending.value = true
      try { data.value = await handler() } catch (err: unknown) { error.value = err } finally { pending.value = false }
    }
    let keyChanging = false
    if (typeof key === 'function') {
      watch(key, (next, prev) => {
        if (next === prev) return
        keyChanging = true
        void run()
        queuePostFlushCb(() => { keyChanging = false })
      }, { flush: 'sync' })
    }
    if (options.watch) watch(options.watch, () => { if (!keyChanging) void run() })
    void run()
    return { data, pending, error, refresh: run }
  }
  return fake
}

const flush = async () => {
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
}

const listFetches = (fake: FakeNuxt) => fake.fetches.filter(f => f.query.sort !== 'views')

test('đổi ?page trong URL (bấm trang 2, nút Back) → nạp đúng trang mới, đúng một lượt', async () => {
  const fake = installFakeNuxt()
  const { usePublicArticleList } = await import('../app/composables/usePublicArticleList')
  const lang = ref('vi')
  const list = usePublicArticleList({ type: 'news', perPage: 19, lang, pathFor: () => '/news' })
  await flush()

  assert.equal(typeof fake.keys[0], 'function', 'khoá useAsyncData phải dẫn xuất từ query, không phải chuỗi cố định')
  assert.deepEqual(listFetches(fake).map(f => f.query.page), [1])

  // Bấm "2": composable chỉ điều hướng, URL mới mới là thứ kích hoạt lượt nạp.
  fake.responder = () => ({ ok: true, articles: [{ id: 2 }], pagination: { page: 2, limit: 19, total: 40, totalPages: 3 } })
  fake.route.query = { page: '2' }
  await flush()

  assert.deepEqual(listFetches(fake).map(f => f.query.page), [1, 2], 'URL đổi sang trang 2 mà danh sách không nạp lại')
  assert.equal(listFetches(fake)[1]!.query.lang, 'vi')
  assert.equal(list.currentPage.value, 2)
  assert.deepEqual(list.articles.value.map(a => a.id), [2])
  assert.equal(list.featured.value, null, 'trang 2 không có bài tiêu điểm')

  // Nút Back: URL về trang 1 → nạp lại trang 1.
  fake.route.query = {}
  await flush()
  assert.deepEqual(listFetches(fake).map(f => f.query.page), [1, 2, 1])
})

test('tìm kiếm qua URL → nạp lại với search, về trang 1; ô nhập đồng bộ theo URL', async () => {
  const fake = installFakeNuxt()
  const { usePublicArticleList } = await import('../app/composables/usePublicArticleList')
  const list = usePublicArticleList({ type: 'document', perPage: 3, lang: ref('vi'), pathFor: () => '/documents' })
  await flush()

  list.searchInput.value = '  Vay vốn  '
  list.applySearch()
  assert.deepEqual(fake.navigations.at(-1), { path: '/documents', query: { q: 'Vay vốn' } })

  fake.route.query = { q: 'Vay vốn' }
  await flush()
  const last = listFetches(fake).at(-1)!
  assert.equal(last.query.search, 'Vay vốn')
  assert.equal(last.query.page, 1)
  assert.equal(list.searchQuery.value, 'Vay vốn')

  // Back về không lọc: ô nhập phải rỗng lại, không giữ từ khoá cũ.
  fake.route.query = {}
  await flush()
  assert.equal(list.searchInput.value, '')
  assert.equal(listFetches(fake).at(-1)!.query.search, undefined)
})

test('đổi ngôn ngữ → nạp lại danh sách và "Đọc nhiều" với lang mới', async () => {
  const fake = installFakeNuxt()
  const { usePublicArticleList, usePublicMostRead } = await import('../app/composables/usePublicArticleList')
  const lang = ref('vi')
  usePublicArticleList({ type: 'role_model', perPage: 19, lang, pathFor: () => '/role-models' })
  usePublicMostRead('role_model', lang)
  await flush()
  assert.deepEqual(fake.fetches.map(f => f.query.lang), ['vi', 'vi'])

  lang.value = 'en'
  await flush()
  const after = fake.fetches.slice(2)
  assert.equal(after.length, 2, 'mỗi khối nạp lại đúng một lần')
  assert.ok(after.every(f => f.query.lang === 'en'))
  assert.ok(after.some(f => f.query.sort === 'views'))
})

test('setPage điều hướng kèm từ khoá hiện tại; ngoài biên thì không làm gì', async () => {
  const fake = installFakeNuxt()
  fake.route.query = { q: 'học nghề' }
  fake.responder = () => ({ ok: true, articles: [], pagination: { page: 1, limit: 19, total: 50, totalPages: 3 } })
  const { usePublicArticleList } = await import('../app/composables/usePublicArticleList')
  const list = usePublicArticleList({ type: 'reintegration', perPage: 19, lang: ref('vi'), pathFor: () => '/reintegration-models' })
  await flush()

  list.setPage(2)
  assert.deepEqual(fake.navigations.at(-1), { path: '/reintegration-models', query: { q: 'học nghề', page: 2 } })
  const before = fake.navigations.length
  list.setPage(0)
  list.setPage(4)
  assert.equal(fake.navigations.length, before)
})

test('/news: chọn chuyên mục chuyển sang /news/<slug>, về trang 1; ?cat= cũ lọc theo chuyên mục', async () => {
  const fake = installFakeNuxt()
  fake.route.query = { cat: 'tin-dia-phuong', page: '2' }
  const { usePublicArticleList } = await import('../app/composables/usePublicArticleList')
  const list = usePublicArticleList({
    type: 'news',
    perPage: 19,
    lang: ref('vi'),
    withCategory: true,
    pathFor: (category) => (category === 'all' ? '/news' : `/news/${category}`),
  })
  await flush()
  assert.equal(listFetches(fake)[0]!.query.categorySlug, 'tin-dia-phuong')

  list.setCategory('tin-noi-bat')
  assert.deepEqual(fake.navigations.at(-1), { path: '/news/tin-noi-bat', query: {} })
  list.resetFilter()
  assert.deepEqual(fake.navigations.at(-1), { path: '/news', query: {} })
})

// ─── Phần 3: đúng MỘT lượt gọi cho mỗi lượt điều hướng ───────────────────────
//
// Bản giả `useAsyncData` theo dõi khoá với `flush: 'sync'` như Nuxt thật. Khi khoá
// đọc thẳng nhiều nguồn đổi trong cùng một nhịp (URL + chuyên mục theo đường dẫn
// do trang cha truyền xuống), mỗi nguồn là một lần đổi khoá → một lượt gọi với tổ
// hợp TRUNG GIAN. Đó là lỗi `/news/<chuyên mục>` và `/media` từng có (bộ kiểm chứng
// đếm được `page=2&search=x` rồi `page=1&search=x`). Bằng chứng trình duyệt thật:
// tests/e2e/public-list-pagination.spec.ts.

test('chuyển chuyên mục (đường dẫn) + về trang 1 (URL) trong CÙNG nhịp → một lượt gọi, đúng tổ hợp cuối', async () => {
  const fake = installFakeNuxt()
  fake.route.query = { page: '2' }
  const { usePublicArticleList } = await import('../app/composables/usePublicArticleList')
  const category = ref('tin-a')
  usePublicArticleList({
    type: 'news',
    perPage: 19,
    lang: ref('vi'),
    withCategory: true,
    pathCategory: () => category.value,
    pathFor: (c) => (c === 'all' ? '/news' : `/news/${c}`),
  })
  await flush()
  assert.deepEqual(listFetches(fake).map(f => [f.query.categorySlug, f.query.page]), [['tin-a', 2]])

  // Điều hướng /news/tin-a?page=2 → /news/tin-b: URL đổi trước, prop của trang cha đổi sau.
  fake.route.query = {}
  category.value = 'tin-b'
  await flush()
  assert.deepEqual(
    listFetches(fake).slice(1).map(f => [f.query.categorySlug, f.query.page]),
    [['tin-b', 1]],
    'không được có lượt gọi trung gian (tin-a, trang 1) hay (tin-b, trang 2)',
  )
})

test('tìm kiếm từ trang 2 (một lượt điều hướng đổi cả page lẫn q) → đúng một lượt gọi', async () => {
  const fake = installFakeNuxt()
  fake.route.query = { page: '2' }
  const { usePublicArticleList } = await import('../app/composables/usePublicArticleList')
  usePublicArticleList({ type: 'news', perPage: 19, lang: ref('vi'), pathFor: () => '/news' })
  await flush()
  fake.route.query = { q: 'vay vốn' }
  await flush()
  assert.deepEqual(listFetches(fake).slice(1).map(f => [f.query.page, f.query.search]), [[1, 'vay vốn']])
})

test('type là getter (thể loại tự tạo đổi khi điều hướng giữa hai thể loại) → nạp lại một lần với type mới', async () => {
  const fake = installFakeNuxt()
  const { usePublicArticleList, usePublicMostRead } = await import('../app/composables/usePublicArticleList')
  const type = ref('video_a')
  const lang = ref('vi')
  usePublicArticleList({ type: () => type.value, perPage: 19, lang, pathFor: () => `/${type.value}` })
  usePublicMostRead(() => type.value, lang)
  await flush()
  type.value = 'video_b'
  await flush()
  const after = fake.fetches.slice(2)
  assert.equal(after.length, 2, 'danh sách + "Đọc nhiều" mỗi khối đúng một lượt')
  assert.ok(after.every(f => f.query.type === 'video_b'))
})

test('?page vượt trang cuối của danh sách có dữ liệu → pageOutOfRange, goFirstPage về trang 1 giữ từ khoá', async () => {
  const fake = installFakeNuxt()
  fake.route.query = { page: '999', q: 'nghề' }
  fake.responder = () => ({ ok: true, articles: [], pagination: { page: 999, limit: 19, total: 25, totalPages: 2 } })
  const { usePublicArticleList } = await import('../app/composables/usePublicArticleList')
  const list = usePublicArticleList({ type: 'news', perPage: 19, lang: ref('vi'), pathFor: () => '/news' })
  await flush()
  assert.equal(list.pageOutOfRange.value, true)
  list.goFirstPage()
  assert.deepEqual(fake.navigations.at(-1), { path: '/news', query: { q: 'nghề' } })
  assert.deepEqual(list.pageLocation(2), { path: '/news', query: { q: 'nghề', page: 2 } })
})

test('danh sách thật sự rỗng (total = 0) không phải "vượt trang"', async () => {
  const fake = installFakeNuxt()
  fake.route.query = { page: '3' }
  fake.responder = () => ({ ok: true, articles: [], pagination: { page: 3, limit: 19, total: 0, totalPages: 0 } })
  const { usePublicArticleList } = await import('../app/composables/usePublicArticleList')
  const list = usePublicArticleList({ type: 'news', perPage: 19, lang: ref('vi'), pathFor: () => '/news' })
  await flush()
  assert.equal(list.pageOutOfRange.value, false)
})

test('isPageOutOfRange: chỉ đúng khi có dữ liệu và trang vượt trang cuối', () => {
  assert.equal(isPageOutOfRange(3, { total: 25, totalPages: 2 }), true)
  assert.equal(isPageOutOfRange(2, { total: 25, totalPages: 2 }), false)
  assert.equal(isPageOutOfRange(5, { total: 0, totalPages: 0 }), false)
  assert.equal(isPageOutOfRange(1, { total: 3, totalPages: 0 }), false)
})
