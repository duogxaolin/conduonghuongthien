/**
 * Bộ đệm `swr` của trang công khai, chạy trên bộ bọc đệm THẬT của Nitro.
 *
 * `nitropack/runtime/internal/cache.mjs` (bộ bọc mà `routeRules: { swr: 60 }` đặt quanh
 * trang) và `renderer.mjs` (`defineRenderHandler` của trình dựng Nuxt, nơi hook
 * `render:response` được gọi) được nạp nguyên văn; chỉ ba module nối vào runtime đã build
 * (`app.mjs` → `useNitroApp`, `storage.mjs` → `useStorage`, `config.mjs`) được thay bằng
 * bản tối thiểu: hookable thật, unstorage (bộ nhớ) thật. Phục vụ qua h3 + `node:http` thật.
 *
 * Điều được chứng minh:
 *  1. GỐC LỖI (không plugin): một tuyến đã đệm 200 mà lượt dựng lại ra 404 thì Nitro phát
 *     bản 200 cũ MÃI MÃI — đúng điều đo được trên bản build 1009c36c (bài đã xoá vẫn hiện).
 *  2. `server/plugins/public-cache-gone.ts`: 404/410 (đặt mã hoặc ném) → lượt kế tiếp 404;
 *     503 → bản cũ vẫn được phát; chỉ khoá của chính tuyến đó bị bỏ.
 *  3. `routeCacheStorageKey` khớp khoá Nitro thật sự ghi (Nitro đổi hình dạng → đỏ).
 *  4. `purgePublicPageCache` xoá đúng nhóm `nitro/routes` trên khoá THẬT, chừa nhóm khác;
 *     `purgePublicPageCacheAfterWrite` không bao giờ ném, và ghi log khi hỏng.
 */
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import test, { after, before, beforeEach, mock } from 'node:test'
import { createHooks } from 'hookable'
import { createStorage, prefixStorage, type Storage } from 'unstorage'
import { createApp, createError, createRouter, toNodeListener, type H3Event } from 'h3'

let storage: Storage = createStorage()
const useStorage = (base = '') => (base ? prefixStorage(storage, base) : storage)

type Hooks = ReturnType<typeof createHooks>
const bareHooks: Hooks = createHooks()
const pluginHooks: Hooks = createHooks()
let activeHooks: Hooks = pluginHooks
// Same shape as nitropack's own `captureError` (app.mjs): fire the `error` hook, never throw.
const nitroApp = {
  get hooks() { return activeHooks },
  captureError: (error: unknown, context: Record<string, unknown> = {}) => {
    void activeHooks.callHookParallel('error', error, context).catch(() => {})
  },
}

const internal = new URL('../node_modules/nitropack/dist/runtime/internal/', import.meta.url)
mock.module(new URL('app.mjs', internal).href, { namedExports: { useNitroApp: () => nitroApp } })
mock.module(new URL('storage.mjs', internal).href, { namedExports: { useStorage } })
mock.module(new URL('config.mjs', internal).href, { namedExports: { useRuntimeConfig: () => ({ app: { baseURL: '/' } }) } })
type CachedOptions = { group: string, swr: boolean, maxAge: number }
const { defineCachedEventHandler } = await import(new URL('cache.mjs', internal).href) as {
  defineCachedEventHandler: (handler: unknown, options: CachedOptions) => unknown
}
const { defineRenderHandler } = await import(new URL('renderer.mjs', internal).href) as {
  defineRenderHandler: (render: (event: H3Event) => Promise<unknown>) => unknown
}

const globals = globalThis as unknown as Record<string, unknown>
globals.useStorage = useStorage
globals.defineNitroPlugin = (plugin: unknown) => plugin
const plugin = (await import('../server/plugins/public-cache-gone.ts')).default as unknown as (app: { hooks: Hooks }) => void
plugin({ hooks: pluginHooks })
const { purgePublicPageCache, purgePublicPageCacheAfterWrite, routeCacheStorageKey } = await import('../server/utils/public-page-cache.ts')

// ─── A cached "page" served exactly the way Nitro wraps a `swr: 60` route ─────────

type Page = { status: number, body: string, throws?: boolean }
const pages = new Map<string, Page>()
const renders: string[] = []
const seenKeys: string[] = []
let gate: Promise<void> | null = null
const render = defineRenderHandler(async (event) => {
  renders.push(event.path)
  const options = (event.context as { cache?: { options?: { getKey: (e: H3Event) => Promise<string> } & Record<string, unknown> } }).cache?.options
  if (options) seenKeys.push(routeCacheStorageKey(options, await options.getKey(event)))
  const page = pages.get(event.path.split('?')[0]!)
  // A render that has read its data and is still running (the race test holds it here).
  if (gate) await gate
  if (!page) throw createError({ statusCode: 404, statusMessage: 'Page not found' })
  if (page.throws) throw createError({ statusCode: page.status, statusMessage: 'thrown' })
  return { body: page.body, statusCode: page.status, headers: { 'content-type': 'text/html;charset=utf-8' } }
})
// app.mjs: `cachedEventHandler(handler, { group: "nitro/routes", ...routeRules.cache })`, and
// `swr: 60` becomes `cache: { swr: true, maxAge: 60 }` (nuxt.config.ts → nitro core).
const cached = defineCachedEventHandler(render, { group: 'nitro/routes', swr: true, maxAge: 60 })
// A hand-written `defineCachedEventHandler` (its default group `nitro/handlers`), as an API
// route would use: not the public page cache, so the plugin leaves it alone.
const handlerCache = defineCachedEventHandler(render, { swr: true, maxAge: 60 } as CachedOptions)
const app = createApp()
const router = createRouter()
router.use('/news/**', cached as never)
router.use('/api-cached/**', handlerCache as never)
app.use(router)

let server: Server
let base = ''
before(async () => {
  server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => new Promise<void>(resolve => server.close(() => resolve())))
beforeEach(() => {
  storage = createStorage()
  pages.clear()
  renders.length = 0
  seenKeys.length = 0
  gate = null
  activeHooks = pluginHooks
})

async function get(path: string) {
  const response = await fetch(base + path)
  return { status: response.status, body: await response.text() }
}
const routeKeys = () => storage.getKeys('cache:nitro:routes')
/** "60 seconds passed": push every cached entry's mtime back past `maxAge`. */
async function expireAll() {
  for (const key of await routeKeys()) {
    const entry = await storage.getItem<{ mtime: number }>(key)
    if (entry) await storage.setItem(key, { ...entry, mtime: entry.mtime - 61_000 })
  }
}
/** Let the background (stale-while-revalidate) render finish. */
async function settle(rendersBefore: number) {
  for (let i = 0; i < 50 && renders.length === rendersBefore; i += 1) await new Promise(r => setTimeout(r, 5))
  for (let i = 0; i < 5; i += 1) await new Promise(r => setTimeout(r, 5))
}
/** cache 200 → page changes → expire → one request (served stale, revalidates) → settle. */
async function staleThenRevalidate(path: string, next: Page) {
  pages.set(path, { status: 200, body: 'bài viết v1' })
  assert.deepEqual(await get(path), { status: 200, body: 'bài viết v1' })
  pages.set(path, next)
  await expireAll()
  const count = renders.length
  const stale = await get(path)
  assert.deepEqual(stale, { status: 200, body: 'bài viết v1' }, 'swr serves the stale copy while it revalidates')
  await settle(count)
}

// ─── 1. Root cause, on the real Nitro wrapper ──────────────────────────────────────

test('Nitro alone: once a cached page renders 404, the stale 200 is served forever', async () => {
  activeHooks = bareHooks
  await staleThenRevalidate('/news/bai-xoa', { status: 404, body: 'Không tìm thấy' })
  for (let round = 0; round < 3; round += 1) {
    await expireAll()
    const count = renders.length
    assert.deepEqual(await get('/news/bai-xoa'), { status: 200, body: 'bài viết v1' }, `round ${round}: stale copy still public`)
    await settle(count)
  }
  assert.equal((await routeKeys()).length, 1, 'the stale entry is never replaced')
})

// ─── 2. The plugin ─────────────────────────────────────────────────────────────────

test('plugin: a page that now renders 404 (status set, body rendered) drops its stale copy', async () => {
  await staleThenRevalidate('/news/bai-xoa', { status: 404, body: 'Không tìm thấy' })
  assert.deepEqual(await routeKeys(), [], 'the stale entry is gone')
  assert.deepEqual(await get('/news/bai-xoa'), { status: 404, body: 'Không tìm thấy' })
})

test('plugin: 410 is "gone" too', async () => {
  await staleThenRevalidate('/news/bai-go', { status: 410, body: 'Đã gỡ' })
  assert.deepEqual(await get('/news/bai-go'), { status: 410, body: 'Đã gỡ' })
})

test('plugin: a page that THROWS 404 during the background render drops its stale copy (error hook, tag cache)', async () => {
  const quiet = mock.method(console, 'error', () => {})
  try {
    await staleThenRevalidate('/news/bai-nem', { status: 404, body: '', throws: true })
  } finally {
    quiet.mock.restore()
  }
  assert.deepEqual(await routeKeys(), [])
})

test('plugin: 503 keeps serving the stale copy — riding out a database blip is what swr is for', async () => {
  await staleThenRevalidate('/news/bai-song', { status: 503, body: 'Hỏng tạm thời' })
  assert.equal((await routeKeys()).length, 1)
  assert.deepEqual(await get('/news/bai-song'), { status: 200, body: 'bài viết v1' })
})

test('plugin: only the gone page is evicted; other cached pages stay cached', async () => {
  pages.set('/news/bai-con', { status: 200, body: 'còn' })
  await get('/news/bai-con')
  const [keptKey] = await routeKeys()
  await staleThenRevalidate('/news/bai-xoa', { status: 404, body: 'Không tìm thấy' })
  assert.deepEqual(await routeKeys(), [keptKey], 'exactly the other page\'s entry is left')
  assert.deepEqual(await get('/news/bai-con'), { status: 200, body: 'còn' })
})

test('plugin: only "gone" — a 403 render keeps the stale copy', async () => {
  await staleThenRevalidate('/news/bai-cam', { status: 403, body: 'Cấm' })
  assert.equal((await routeKeys()).length, 1)
  assert.deepEqual(await get('/news/bai-cam'), { status: 200, body: 'bài viết v1' })
})

test('plugin: a THROWN 500 during the background render keeps the stale copy (error hook looks at the status)', async () => {
  const quiet = mock.method(console, 'error', () => {})
  try {
    await staleThenRevalidate('/news/bai-nem-500', { status: 500, body: '', throws: true })
  } finally {
    quiet.mock.restore()
  }
  assert.equal((await routeKeys()).length, 1, 'a thrown 5xx is a blip, not "gone"')
  assert.deepEqual(await get('/news/bai-nem-500'), { status: 200, body: 'bài viết v1' })
})

test('plugin: a storage failure while evicting never turns the visitor\'s 404 into a 500, and is logged', async () => {
  pages.set('/news/bai-loi-kho', { status: 404, body: 'Không tìm thấy' })
  const realRemove = storage.removeItem
  storage.removeItem = (async () => { throw new Error('storage down') }) as typeof storage.removeItem
  const lines: string[] = []
  const capture = mock.method(console, 'error', (line: unknown) => { lines.push(String(line)) })
  try {
    // A cold render: the visitor waits for this very render, hook included.
    assert.deepEqual(await get('/news/bai-loi-kho'), { status: 404, body: 'Không tìm thấy' })
  } finally {
    storage.removeItem = realRemove
    capture.mock.restore()
  }
  const record = lines.map(line => { try { return JSON.parse(line) as Record<string, unknown> } catch { return null } }).find(r => r?.event === 'public_cache.evict_failed')
  assert.ok(record, `no public_cache.evict_failed line in ${JSON.stringify(lines)}`)
  assert.equal(record.source, 'render')
})

test('the bound, not a closure: a render that read the data BEFORE the commit stores a 200 AFTER the purge — public until maxAge + one visit, then the plugin drops it', async () => {
  const path = '/news/bai-dua'
  pages.set(path, { status: 200, body: 'bài viết v1' })
  let release!: () => void
  gate = new Promise<void>(resolve => { release = resolve })
  const inFlight = get(path) // cold render: reads v1, then held
  await new Promise(r => setTimeout(r, 20))
  pages.set(path, { status: 404, body: 'Không tìm thấy' }) // the delete commits…
  await purgePublicPageCache() // …and the write path purges (nothing stored yet)
  release()
  gate = null
  assert.deepEqual(await inFlight, { status: 200, body: 'bài viết v1' })
  await new Promise(r => setTimeout(r, 20))
  assert.equal((await routeKeys()).length, 1, 'the held render stored its 200 after the purge')
  const count = renders.length
  assert.deepEqual(await get(path), { status: 200, body: 'bài viết v1' }, 'fresh entry: no render, the plugin cannot fire')
  assert.equal(renders.length, count)
  await expireAll()
  const before = renders.length
  assert.deepEqual(await get(path), { status: 200, body: 'bài viết v1' }, 'after 60 s: one more stale answer while it re-renders')
  await settle(before)
  assert.deepEqual(await get(path), { status: 404, body: 'Không tìm thấy' })
})

test('plugin: a 404 on a page that was never cached removes nothing', async () => {
  pages.set('/news/bai-con', { status: 200, body: 'còn' })
  await get('/news/bai-con')
  assert.equal((await get('/news/khong-co')).status, 404)
  assert.equal((await routeKeys()).length, 1)
})

test('plugin: only the route cache (nitro/routes) — a hand-written cached handler keeps its entry', async () => {
  const path = '/api-cached/x'
  pages.set(path, { status: 200, body: 'v1' })
  await get(path)
  pages.set(path, { status: 404, body: 'gone' })
  const handlerKeys = () => storage.getKeys('cache:nitro:handlers')
  for (const key of await handlerKeys()) {
    const entry = await storage.getItem<{ mtime: number }>(key)
    if (entry) await storage.setItem(key, { ...entry, mtime: entry.mtime - 61_000 })
  }
  const count = renders.length
  await get(path)
  await settle(count)
  assert.equal((await handlerKeys()).length, 1, 'outside the public page cache: not the plugin\'s to drop')
})

// ─── 3. The key formula is Nitro's ─────────────────────────────────────────────────

test('routeCacheStorageKey is the key the real wrapper stored (path, query variant, _payload.json)', async () => {
  for (const path of ['/news/bai-viet-co-ten-rat-dai-hon-muoi-sau-ky-tu', '/news/x?utm=1', '/news/x/_payload.json']) {
    pages.set(path.split('?')[0]!, { status: 200, body: path })
    await get(path)
  }
  const stored = (await routeKeys()).sort()
  const computed = seenKeys.map(key => key.replace(/\//g, ':').replace(/^:+/, '')).sort()
  assert.deepEqual(computed, stored)
  assert.equal(stored.length, 3)
})

// ─── 4. Purge ──────────────────────────────────────────────────────────────────────

test('purgePublicPageCache removes every route entry (real keys) and leaves other cache groups alone', async () => {
  for (const path of ['/news/a', '/news/b', '/news/a/_payload.json']) {
    pages.set(path, { status: 200, body: path })
    await get(path)
  }
  await storage.setItem('cache:nitro:functions:_:x.json', { value: 1 })
  await storage.setItem('cache:favicon:current', 'f')
  await storage.setItem('other:thing', 't')
  assert.equal((await routeKeys()).length, 3)

  assert.equal(await purgePublicPageCache(), 3)
  assert.deepEqual(await routeKeys(), [])
  assert.deepEqual((await storage.getKeys()).sort(), ['cache:favicon:current', 'cache:nitro:functions:_:x.json', 'other:thing'])
  const count = renders.length
  await get('/news/a')
  assert.equal(renders.length, count + 1, 'the next visit renders afresh')
})

test('purgePublicPageCacheAfterWrite never throws, and says so in the log when the storage fails', async () => {
  const lines: string[] = []
  const capture = mock.method(console, 'error', (line: unknown) => { lines.push(String(line)) })
  const realGetKeys = storage.getKeys
  storage.getKeys = (async () => { throw new Error('storage down') }) as typeof storage.getKeys
  try {
    await assert.doesNotReject(purgePublicPageCacheAfterWrite('articles.delete'))
  } finally {
    storage.getKeys = realGetKeys
    capture.mock.restore()
  }
  const record = lines.map(line => { try { return JSON.parse(line) as Record<string, unknown> } catch { return null } }).find(r => r?.event === 'public_cache.purge_failed')
  assert.ok(record, `no public_cache.purge_failed line in ${JSON.stringify(lines)}`)
  assert.equal(record.reason, 'articles.delete')
  assert.equal(record.error, 'storage down')
})

test('purgePublicPageCache (the "Xoá cache" button) does surface a storage failure', async () => {
  const realGetKeys = storage.getKeys
  storage.getKeys = (async () => { throw new Error('storage down') }) as typeof storage.getKeys
  try {
    await assert.rejects(purgePublicPageCache(), /storage down/)
  } finally {
    storage.getKeys = realGetKeys
  }
})
