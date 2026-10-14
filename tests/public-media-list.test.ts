/**
 * Thư viện Video công khai (`/media`): mỗi lượt điều hướng ĐÚNG MỘT lượt gọi API.
 *
 * Lỗi đã gặp (bộ kiểm chứng độc lập, Chrome thật): trang giữ trang / từ khoá /
 * chuyên mục trong ba `ref` và ghi lần lượt từng cái rồi mới `navigateTo`; một
 * watcher trên `route.query` ghi ngược chúng khi bấm Back. Khoá `useAsyncData` được
 * Nuxt theo dõi với `flush: 'sync'`, nên mỗi lần ghi là một lượt gọi: tìm kiếm từ
 * trang 2 gửi `page=2&search=x` rồi `page=1&search=x`; Back gửi `page=2&search=x`
 * rồi `page=2`.
 *
 * Chạy THẬT `usePublicMediaList` với bản giả tối thiểu của Nuxt trên `globalThis`;
 * bản giả `useAsyncData` theo dõi khoá với `flush: 'sync'` như Nuxt 4.6 nên một
 * lần ghi trung gian sẽ hiện ra thành một lượt gọi thừa ở đây. Bằng chứng trình
 * duyệt thật: tests/e2e/public-list-pagination.spec.ts.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { nextTick, queuePostFlushCb, reactive, ref, watch, type Ref, type WatchSource } from 'vue'
import { buildMediaListQuery, mediaListLocation, readMediaRouteState } from '../app/utils/public-media-list'

// ─── Phần 1: hàm thuần ───────────────────────────────────────────────────────

test('readMediaRouteState phòng thủ giá trị bừa trong URL', () => {
  assert.deepEqual(readMediaRouteState({}), { page: 1, search: '', category: '' })
  assert.deepEqual(readMediaRouteState({ page: 'abc', q: ['  a ', 'b'], category: ' tin ' }), { page: 1, search: 'a', category: 'tin' })
  assert.deepEqual(readMediaRouteState({ page: '-3' }).page, 1)
  assert.deepEqual(readMediaRouteState({ page: '2.9' }).page, 2)
})

test('buildMediaListQuery / mediaListLocation chỉ ghi tham số khi cần', () => {
  assert.deepEqual(buildMediaListQuery({ page: 1, search: '', category: '' }, 12), { page: 1, limit: 12 })
  assert.deepEqual(buildMediaListQuery({ page: 3, search: 'x', category: 'c' }, 12), { page: 3, limit: 12, search: 'x', category: 'c' })
  assert.deepEqual(mediaListLocation({ page: 1, search: '', category: '' }), { path: '/media', query: {} })
  assert.deepEqual(mediaListLocation({ page: 2, search: 'x', category: 'c' }), { path: '/media', query: { q: 'x', category: 'c', page: 2 } })
})

// ─── Phần 2: composable chạy thật với Nuxt giả ───────────────────────────────

interface Fake {
  route: { query: Record<string, unknown> }
  fetches: Array<Record<string, unknown>>
  navigations: unknown[]
  responder: () => unknown
}

function installFakeNuxt(): Fake {
  const fake: Fake = {
    route: reactive({ query: {} as Record<string, unknown> }),
    fetches: [],
    navigations: [],
    responder: () => ({ ok: true, items: [], categories: [], pagination: { page: 1, limit: 12, total: 30, totalPages: 3 } }),
  }
  const g = globalThis as Record<string, unknown>
  g.useRoute = () => fake.route
  g.navigateTo = (to: unknown) => { fake.navigations.push(to); return Promise.resolve() }
  g.$fetch = (_url: string, options: { query: Record<string, unknown> }) => {
    fake.fetches.push({ ...options.query })
    return Promise.resolve(fake.responder())
  }
  // Như Nuxt 4.6: khoá dạng hàm theo dõi `flush: 'sync'`; nguồn `watch` bị bỏ qua
  // trong đúng nhịp khoá đổi.
  g.useAsyncData = (key: () => string, handler: () => Promise<unknown>, options: { default?: () => unknown; watch?: WatchSource[] } = {}) => {
    const data: Ref<unknown> = ref(options.default?.())
    const pending = ref(false)
    const error = ref<unknown>(null)
    const run = async () => {
      pending.value = true
      try { data.value = await handler() } catch (err: unknown) { error.value = err } finally { pending.value = false }
    }
    let keyChanging = false
    watch(key, (next, prev) => {
      if (next === prev) return
      keyChanging = true
      void run()
      queuePostFlushCb(() => { keyChanging = false })
    }, { flush: 'sync' })
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

test('tìm kiếm từ trang 2 → đúng một lượt gọi (page=1&search=x), không có page=2&search=x', async () => {
  const fake = installFakeNuxt()
  fake.route.query = { page: '2' }
  const { usePublicMediaList } = await import('../app/composables/usePublicMediaList')
  const list = usePublicMediaList({ perPage: 12 })
  await flush()
  assert.deepEqual(fake.fetches, [{ page: 2, limit: 12 }])

  list.searchInput.value = '  học nghề '
  list.applySearch()
  assert.equal(fake.fetches.length, 1, 'hành động chỉ điều hướng — không tự bắn lượt gọi nào')
  assert.deepEqual(fake.navigations.at(-1), { path: '/media', query: { q: 'học nghề' } })

  fake.route.query = { q: 'học nghề' }
  await flush()
  assert.deepEqual(fake.fetches.slice(1), [{ page: 1, limit: 12, search: 'học nghề' }])
})

test('Back từ kết quả tìm kiếm về trang 2 → đúng một lượt gọi (page=2), ô nhập rỗng lại', async () => {
  const fake = installFakeNuxt()
  fake.route.query = { q: 'x' }
  const { usePublicMediaList } = await import('../app/composables/usePublicMediaList')
  const list = usePublicMediaList({ perPage: 12 })
  await flush()
  fake.route.query = { page: '2' }
  await flush()
  assert.deepEqual(fake.fetches.slice(1), [{ page: 2, limit: 12 }])
  assert.equal(list.searchInput.value, '')
})

test('đổi chuyên mục từ trang 3 → một lượt gọi về trang 1 của chuyên mục mới', async () => {
  const fake = installFakeNuxt()
  fake.route.query = { page: '3' }
  const { usePublicMediaList } = await import('../app/composables/usePublicMediaList')
  const list = usePublicMediaList({ perPage: 12 })
  await flush()
  list.applyCategory('phong-su')
  assert.deepEqual(fake.navigations.at(-1), { path: '/media', query: { category: 'phong-su' } })
  fake.route.query = { category: 'phong-su' }
  await flush()
  assert.deepEqual(fake.fetches.slice(1), [{ page: 1, limit: 12, category: 'phong-su' }])
})

test('setPage giữ bộ lọc, ngoài biên không làm gì; xoá lọc về /media trần', async () => {
  const fake = installFakeNuxt()
  fake.route.query = { q: 'x', category: 'c' }
  const { usePublicMediaList } = await import('../app/composables/usePublicMediaList')
  const list = usePublicMediaList({ perPage: 12 })
  await flush()
  list.setPage(2)
  assert.deepEqual(fake.navigations.at(-1), { path: '/media', query: { q: 'x', category: 'c', page: 2 } })
  const count = fake.navigations.length
  list.setPage(0)
  list.setPage(4)
  assert.equal(fake.navigations.length, count)
  list.clearSearch()
  assert.deepEqual(fake.navigations.at(-1), { path: '/media', query: {} })
})

test('phản hồi ok:false (vd. 503 khi CSDL hỏng) là LỖI, không phải "chưa có video"', async () => {
  const fake = installFakeNuxt()
  fake.responder = () => ({ ok: false, items: [], categories: [], pagination: { page: 1, limit: 12, total: 0, totalPages: 0 } })
  const { usePublicMediaList } = await import('../app/composables/usePublicMediaList')
  const list = usePublicMediaList({ perPage: 12 })
  await flush()
  assert.equal(list.loadError.value, true)
  assert.equal(list.pageOutOfRange.value, false)
})

test('?page vượt trang cuối → pageOutOfRange; goFirstPage giữ bộ lọc, bỏ ?page', async () => {
  const fake = installFakeNuxt()
  fake.route.query = { page: '999', category: 'c' }
  const { usePublicMediaList } = await import('../app/composables/usePublicMediaList')
  const list = usePublicMediaList({ perPage: 12 })
  await flush()
  assert.equal(list.pageOutOfRange.value, true)
  list.goFirstPage()
  assert.deepEqual(fake.navigations.at(-1), { path: '/media', query: { category: 'c' } })
})
