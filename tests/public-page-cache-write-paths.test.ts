/**
 * Mọi đường ghi làm đổi trang công khai đã đệm `swr` xoá bộ đệm — SAU khi lượt ghi đã
 * commit, một lần mỗi request, và không bao giờ làm hỏng lượt ghi.
 *
 * Chạy handler THẬT (bài viết, menu, cài đặt giao diện, media) trên một CSDL giả ghi lại
 * thứ tự: mỗi câu lệnh khi được `await`, `commit` khi callback của `db.transaction` xong.
 * Bộ đệm là unstorage thật, khoá đúng hình dạng Nitro ghi (`nitro:routes:_:<path16>.<hash>.json`,
 * xem tests/public-page-cache-behavior.test.ts), và `purge` được ghi lại lúc nó liệt kê khoá.
 *
 * Gốc lỗi (đo trên bản build 1009c36c): xoá/lưu trữ bài → trang bài thành 404, mà Nitro không
 * bao giờ ghi đè bản 200 đã đệm bằng 404 → bài vẫn công khai tới khi ai đó bấm "Xoá cache";
 * lưu menu → mục mới chỉ hiện sau ≥ 60 giây và thêm một lượt tải.
 */
import assert from 'node:assert/strict'
import test, { beforeEach, mock } from 'node:test'
import { createStorage, prefixStorage, type Storage } from 'unstorage'

// ─── Recorded database ─────────────────────────────────────────────────────────────

const events: string[] = []
let selectRows: Record<string, unknown[]> = {}
const schema = await import('../server/db/schema')
const tableName = (table: unknown) => {
  for (const [name, value] of Object.entries(schema)) if (value === table) return name
  return 'other'
}

function query(kind: string, table?: unknown): unknown {
  const state = { kind, table }
  const chain: unknown = new Proxy(() => {}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => Promise.resolve().then(() => {
          const name = tableName(state.table)
          events.push(`${state.kind} ${name}`)
          if (state.kind === 'select') return selectRows[name] ?? []
          return [{ insertId: 77, affectedRows: 1 }]
        }).then(resolve, reject)
      }
      return (...args: unknown[]) => {
        if (prop === 'from') state.table = args[0]
        return chain
      }
    },
  })
  return chain
}
const client = {
  select: () => query('select'),
  insert: (table: unknown) => query('insert', table),
  update: (table: unknown) => query('update', table),
  delete: (table: unknown) => query('delete', table),
}
const db = {
  ...client,
  transaction: async (callback: (tx: typeof client) => Promise<unknown>) => {
    events.push('begin')
    const result = await callback(client)
    events.push('commit')
    return result
  },
}
mock.module('../server/utils/db', { namedExports: { getDb: () => db } })
mock.module('../server/services/google-oauth-settings', { namedExports: { defaultCommentsEnabled: async () => false } })

// Media services: the transactions live there (and have their own tests); here only the
// order "service returned (committed) → purge" matters.
let mediaDelete: { removed: boolean, fromStatus: string | null } = { removed: true, fromStatus: 'published' }
mock.module('../server/services/media-portal', {
  namedExports: {
    updateMediaItem: async () => { events.push('commit media'); return { ok: true, slug: 'video-a', status: 'archived' } },
    deleteMediaItem: async () => { events.push('commit media'); return mediaDelete },
    MediaValidationError: class MediaValidationError extends Error {},
  },
})

// ─── Nitro globals ─────────────────────────────────────────────────────────────────

let storage: Storage = createStorage()
let storageFails = false
const globals = globalThis as unknown as Record<string, unknown>
globals.useStorage = (base = '') => {
  const scoped = base ? prefixStorage(storage, base) : storage
  return {
    getKeys: async (prefix?: string) => {
      events.push('purge')
      if (storageFails) throw new Error('storage down')
      return scoped.getKeys(prefix)
    },
    removeItem: (key: string) => scoped.removeItem(key),
  }
}
type Event = { body: unknown, params: Record<string, string>, context: { adminUser: unknown, params?: Record<string, string> } }
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: Event) => event.body
globals.getRouterParam = (event: Event, name: string) => event.params[name]
globals.createError = (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input)

type Handler = (event: Event) => Promise<unknown>
const load = async (path: string) => (await import(path)).default as unknown as Handler
const handlers = {
  create: await load('../server/api/admin/articles/index.post.ts'),
  update: await load('../server/api/admin/articles/[id].put.ts'),
  remove: await load('../server/api/admin/articles/[id].delete.ts'),
  bulkDelete: await load('../server/api/admin/articles/bulk-delete.post.ts'),
  bulkStatus: await load('../server/api/admin/articles/bulk-status.post.ts'),
  bulkComments: await load('../server/api/admin/articles/bulk-comments.post.ts'),
  navbar: await load('../server/api/admin/settings/navigation/navbar.put.ts'),
  mobile: await load('../server/api/admin/settings/navigation/mobile.put.ts'),
  settings: await load('../server/api/admin/settings/index.put.ts'),
  layout: await load('../server/api/admin/settings/layout.put.ts'),
  mediaUpdate: await load('../server/api/admin/media-portal/[id].put.ts'),
  mediaDelete: await load('../server/api/admin/media-portal/[id].delete.ts'),
}
const { DEFAULT_LAYOUT_CONFIG } = await import('../server/services/layout-settings.ts')

const SUPERADMIN = { id: 1, isSuperAdmin: true, permissions: [] }
const ARTICLE = { id: 31, type: 'news', title: 'Bài thử', status: 'published', publishedAt: new Date(), commentsEnabled: false }
// `body` for the auto-imported `readBody` stand-in above; `method` + `node.req` for the media
// handlers, which import h3's own `readBody` (it reads `node.req.body` when one is there).
const call = (handler: Handler, body: unknown = {}, id = '31') => handler({
  body,
  params: { id },
  context: { adminUser: SUPERADMIN, params: { id } },
  method: 'PUT',
  node: { req: { method: 'PUT', headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(body)) } },
} as Event)

/** Real-shaped route entries: a public article page, its payload, the home page. */
const CACHED = ['nitro:routes:_:newsbaithu.Ab12Cd34Ef.json', 'nitro:routes:_:newsbaithu_payloadjson.Zz9.json', 'nitro:routes:_:index.Qq1.json']
beforeEach(async () => {
  events.length = 0
  storage = createStorage()
  storageFails = false
  for (const key of CACHED) await storage.setItem(`cache:${key}`, { value: { code: 200, body: 'cũ' } })
  await storage.setItem('cache:favicon:current', 'f')
  selectRows = { articles: [ARTICLE], settings: [] }
  mediaDelete = { removed: true, fromStatus: 'published' }
})
const routeKeys = () => storage.getKeys('cache:nitro:routes')

/** The purge ran, exactly once, after the last commit/write, and emptied the route cache. */
async function assertPurgedAfter(lastWrite: string) {
  assert.equal(events.filter(e => e === 'purge').length, 1, `one purge per request — ${events.join(' → ')}`)
  const purgeAt = events.indexOf('purge')
  assert.ok(events.lastIndexOf(lastWrite) >= 0, `no "${lastWrite}" — ${events.join(' → ')}`)
  assert.ok(purgeAt > events.lastIndexOf(lastWrite), `purge must follow "${lastWrite}" — ${events.join(' → ')}`)
  assert.deepEqual(await routeKeys(), [], 'route entries left behind')
  assert.deepEqual(await storage.getKeys('cache:favicon'), ['cache:favicon:current'], 'another cache group was swept')
}

// ─── Articles ──────────────────────────────────────────────────────────────────────

test('create article: purge after the insert + audit commit', async () => {
  await call(handlers.create, { title: 'Một bài mới', type: 'news', status: 'published', content: '<p>x</p>' })
  await assertPurgedAfter('commit')
})

test('update article (archive / status / type / content): purge after commit, never inside the transaction', async () => {
  await call(handlers.update, { status: 'archived' })
  await assertPurgedAfter('commit')
  assert.ok(events.indexOf('purge') > events.indexOf('insert activityLogs'))
})

test('update article that does not exist: 404 and nothing purged', async () => {
  selectRows.articles = []
  await assert.rejects(call(handlers.update, { status: 'archived' }), (e: { statusCode?: number }) => e.statusCode === 404)
  assert.ok(!events.includes('purge'))
  assert.equal((await routeKeys()).length, CACHED.length)
})

test('delete article: purge after the delete and its audit row', async () => {
  await call(handlers.remove)
  assert.ok(events.indexOf('delete articles') < events.indexOf('insert activityLogs'))
  await assertPurgedAfter('insert activityLogs')
})

test('delete article that does not exist: 404 and nothing purged', async () => {
  selectRows.articles = []
  await assert.rejects(call(handlers.remove), (e: { statusCode?: number }) => e.statusCode === 404)
  assert.ok(!events.includes('purge'))
})

test('bulk delete: ONE purge after every row is written', async () => {
  const outcome = await call(handlers.bulkDelete, { ids: [31, 32, 33] }) as { succeeded: number }
  assert.equal(outcome.succeeded, 3)
  assert.equal(events.filter(e => e === 'delete articles').length, 3)
  await assertPurgedAfter('insert activityLogs')
})

test('bulk status (archive = hide): ONE purge after every row is written', async () => {
  const outcome = await call(handlers.bulkStatus, { ids: [31, 32], status: 'archived' }) as { succeeded: number }
  assert.equal(outcome.succeeded, 2)
  assert.equal(events.filter(e => e === 'update articles').length, 2)
  await assertPurgedAfter('insert activityLogs')
})

test('bulk comments: ONE purge after every row commits (the comment section is in the cached page)', async () => {
  const outcome = await call(handlers.bulkComments, { ids: [31, 32], enabled: true }) as { succeeded: number }
  assert.equal(outcome.succeeded, 2)
  await assertPurgedAfter('commit')
})

test('bulk action where no row went through: nothing changed, nothing purged', async () => {
  selectRows.articles = []
  for (const [handler, body] of [[handlers.bulkDelete, { ids: [31] }], [handlers.bulkStatus, { ids: [31], status: 'archived' }], [handlers.bulkComments, { ids: [31], enabled: true }]] as const) {
    const outcome = await call(handler, body) as { succeeded: number }
    assert.equal(outcome.succeeded, 0)
  }
  assert.ok(!events.includes('purge'), events.join(' → '))
  assert.equal((await routeKeys()).length, CACHED.length)
})

// ─── Menu and layout-level settings (in the HTML of every cached page) ─────────────

test('navbar menu save: purge after commit', async () => {
  await call(handlers.navbar, { menu: [{ id: 'home', label: 'Trang chủ', url: '/' }, { id: 'moi', label: 'Mục mới', url: '/about' }] })
  await assertPurgedAfter('commit')
})

test('mobile bottom-nav save: purge after commit', async () => {
  await call(handlers.mobile, { menu: [{ id: 'home', label: 'Trang chủ', icon: 'fa-solid fa-house', type: 'link', url: '/' }] })
  await assertPurgedAfter('commit')
})

test('general settings save: purge after commit', async () => {
  await call(handlers.settings, { settings: { site_name: 'Cổng mới', hotline: '0900' } })
  await assertPurgedAfter('commit')
})

test('layout settings save: purge after the service commits', async () => {
  await call(handlers.layout, { ...DEFAULT_LAYOUT_CONFIG })
  await assertPurgedAfter('commit')
})

test('a rejected save (400 before any write) purges nothing', async () => {
  await assert.rejects(call(handlers.navbar, { menu: 'not-an-array' }), (e: { statusCode?: number }) => e.statusCode === 400)
  await assert.rejects(call(handlers.settings, { settings: { not_allowed: 'x' } }), (e: { statusCode?: number }) => e.statusCode === 400)
  assert.ok(!events.includes('purge'), events.join(' → '))
})

// ─── Media portal ──────────────────────────────────────────────────────────────────

test('media update (incl. un-publishing): purge after the service committed', async () => {
  await call(handlers.mediaUpdate, { status: 'archived' }, '5')
  await assertPurgedAfter('commit media')
})

test('media delete: purge when the item was public, not when it was a draft', async () => {
  await call(handlers.mediaDelete, {}, '5')
  await assertPurgedAfter('commit media')
  events.length = 0
  for (const key of CACHED) await storage.setItem(`cache:${key}`, { value: 1 })
  mediaDelete = { removed: true, fromStatus: 'draft' }
  await call(handlers.mediaDelete, {}, '6')
  assert.ok(!events.includes('purge'))
})

// ─── A purge that fails never fails the write ──────────────────────────────────────

test('storage down: the delete still answers ok, and the failure is logged with its reason', async () => {
  storageFails = true
  const lines: string[] = []
  const capture = mock.method(console, 'error', (line: unknown) => { lines.push(String(line)) })
  try {
    assert.deepEqual(await call(handlers.remove), { ok: true })
    assert.deepEqual(await call(handlers.update, { status: 'archived' }), { ok: true })
  } finally {
    capture.mock.restore()
  }
  const reasons = lines
    .map(line => { try { return JSON.parse(line) as Record<string, unknown> } catch { return null } })
    .filter(r => r?.event === 'public_cache.purge_failed')
    .map(r => r!.reason)
  assert.deepEqual(reasons, ['articles.delete', 'articles.update'])
})
