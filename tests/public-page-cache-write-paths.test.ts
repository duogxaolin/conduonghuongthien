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
    createMediaItem: async () => { events.push('commit media'); return { mediaItemId: 9, slug: 'video-b', shortId: 'abc' } },
    MediaValidationError: class MediaValidationError extends Error {},
  },
})
// The same for the services that own their transactions: "the service returned" = committed.
const committed = (what: string, value: unknown = undefined) => async () => { events.push(`commit ${what}`); return value }
mock.module('../server/services/pages', { namedExports: { deletePageById: committed('pages') } })
mock.module('../server/services/content-types', { namedExports: { deleteContentTypeById: committed('content_types') } })
mock.module('../server/services/i18n-auto-translate', {
  namedExports: {
    autoTranslateContentType: async () => {}, autoTranslateContentTypeUpdate: async () => {},
    autoTranslateCategory: async () => {}, autoTranslateCategoryUpdate: async () => {},
  },
})
// Categories: create/update run the REAL services/category-writes.ts on the recorded DB (its
// transaction is the `commit` event); delete goes through services/categories.ts.
mock.module('../server/services/categories', { namedExports: { deleteCategoryById: committed('categories') } })
mock.module('../server/services/social-links', {
  namedExports: {
    createSocialLink: committed('social_links', { id: 4 }),
    updateSocialLink: committed('social_links'),
    deleteSocialLink: committed('social_links'),
    reorderSocialLinks: committed('social_links'),
  },
})
mock.module('../server/services/languages', {
  namedExports: {
    createLanguage: committed('languages', { id: 6 }),
    updateLanguage: committed('languages'),
    deleteLanguage: committed('languages'),
    reorderLanguages: committed('languages'),
    upsertTranslations: committed('languages'),
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
  mediaExternal: await load('../server/api/admin/media-portal/external.post.ts'),
  pageUpdate: await load('../server/api/admin/pages/[id].put.ts'),
  pagePublish: await load('../server/api/admin/pages/[id]/publish.post.ts'),
  pageDelete: await load('../server/api/admin/pages/[id].delete.ts'),
  pageBulkDelete: await load('../server/api/admin/pages/bulk-delete.post.ts'),
  typeCreate: await load('../server/api/admin/content-types/index.post.ts'),
  typeUpdate: await load('../server/api/admin/content-types/[id].put.ts'),
  typeDelete: await load('../server/api/admin/content-types/[id].delete.ts'),
  typeBulkDelete: await load('../server/api/admin/content-types/bulk-delete.post.ts'),
  socialCreate: await load('../server/api/admin/social-links/index.post.ts'),
  socialUpdate: await load('../server/api/admin/social-links/[id].put.ts'),
  socialDelete: await load('../server/api/admin/social-links/[id].delete.ts'),
  socialReorder: await load('../server/api/admin/social-links/reorder.post.ts'),
  languageCreate: await load('../server/api/admin/languages/index.post.ts'),
  languageUpdate: await load('../server/api/admin/languages/[code].put.ts'),
  languageDelete: await load('../server/api/admin/languages/[code].delete.ts'),
  languageReorder: await load('../server/api/admin/languages/reorder.post.ts'),
  translations: await load('../server/api/admin/languages/[code]/translations/index.put.ts'),
  categoryCreate: await load('../server/api/admin/categories/index.post.ts'),
  categoryUpdate: await load('../server/api/admin/categories/[id].put.ts'),
  categoryDelete: await load('../server/api/admin/categories/[id].delete.ts'),
  categoryBulkDelete: await load('../server/api/admin/categories/bulk-delete.post.ts'),
}
const { DEFAULT_LAYOUT_CONFIG } = await import('../server/services/layout-settings.ts')

const SUPERADMIN = { id: 1, isSuperAdmin: true, permissions: [] }
const ARTICLE = { id: 31, type: 'news', title: 'Bài thử', status: 'published', publishedAt: new Date(), commentsEnabled: false }
const CONTENT_TYPE = { id: 3, name: 'Tin tức', slug: 'news', description: null, isSystem: true }
const CATEGORY = { id: 8, name: 'Tin nổi bật', slug: 'tin-noi-bat', type: 'news', parentId: null, description: null, displayOrder: 0 }
// `body` for the auto-imported `readBody` stand-in above; `method` + `node.req` for the media
// handlers, which import h3's own `readBody` (it reads `node.req.body` when one is there).
const call = (handler: Handler, body: unknown = {}, id = '31') => handler({
  body,
  params: { id, code: 'vi' },
  context: { adminUser: SUPERADMIN, params: { id } },
  method: 'PUT',
  node: { req: { method: 'PUT', headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(body)) }, res: {} },
} as Event)

/** Real-shaped route entries: a public article page, its payload, the home page. */
const CACHED = ['nitro:routes:_:newsbaithu.Ab12Cd34Ef.json', 'nitro:routes:_:newsbaithu_payloadjson.Zz9.json', 'nitro:routes:_:index.Qq1.json']
beforeEach(async () => {
  events.length = 0
  storage = createStorage()
  storageFails = false
  for (const key of CACHED) await storage.setItem(`cache:${key}`, { value: { code: 200, body: 'cũ' } })
  await storage.setItem('cache:favicon:current', 'f')
  selectRows = {
    articles: [ARTICLE], settings: [], pageBlocks: [], contentTypes: [CONTENT_TYPE], categories: [CATEGORY],
    pages: [{ id: 5, slug: 'home', title: 'Trang chủ', isSystem: true, draftBlocks: [], publishedBlocks: null }],
  }
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

test('media created from a YouTube link: purge after the service committed', async () => {
  await call(handlers.mediaExternal, { title: 'Video', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' })
  await assertPurgedAfter('commit media')
})

// ─── Page Builder, content types, social links, languages ──────────────────────────
// (`/`, `/about`, `/contact` are Page Builder pages; types, footer links, the language
// switcher and the `vi` strings are in the HTML of every cached page.)

test('page: update (title/SEO) and publish purge after commit', async () => {
  await call(handlers.pageUpdate, { title: 'Trang chủ mới' }, '5')
  await assertPurgedAfter('commit')
  events.length = 0
  for (const key of CACHED) await storage.setItem(`cache:${key}`, { value: 1 })
  await call(handlers.pagePublish, { blocks: [] }, '5')
  await assertPurgedAfter('commit')
})

test('page: delete and bulk delete purge after the service committed', async () => {
  await call(handlers.pageDelete, {}, '5')
  await assertPurgedAfter('commit pages')
  events.length = 0
  for (const key of CACHED) await storage.setItem(`cache:${key}`, { value: 1 })
  await call(handlers.pageBulkDelete, { ids: [5, 6] })
  assert.equal(events.filter(e => e === 'commit pages').length, 2)
  await assertPurgedAfter('commit pages')
})

test('content type: create, update, delete, bulk delete purge after their writes', async () => {
  const cases: Array<[Handler, unknown, string]> = [
    [handlers.typeCreate, { name: 'Thể loại mới' }, 'insert contentTypes'],
    [handlers.typeUpdate, { name: 'Tin tức (sửa)' }, 'update contentTypes'],
    [handlers.typeDelete, {}, 'commit content_types'],
    [handlers.typeBulkDelete, { ids: [3] }, 'commit content_types'],
  ]
  for (const [handler, body, lastWrite] of cases) {
    events.length = 0
    for (const key of CACHED) await storage.setItem(`cache:${key}`, { value: 1 })
    await call(handler, body, '3')
    await assertPurgedAfter(lastWrite)
  }
})

test('social links: create, update, delete, reorder purge after the service committed', async () => {
  const cases: Array<[Handler, unknown]> = [
    [handlers.socialCreate, { platform: 'facebook', url: 'https://facebook.com/c11' }],
    [handlers.socialUpdate, { url: 'https://facebook.com/c11-moi' }],
    [handlers.socialDelete, {}],
    [handlers.socialReorder, { orderedIds: [2, 1] }],
  ]
  for (const [handler, body] of cases) {
    events.length = 0
    for (const key of CACHED) await storage.setItem(`cache:${key}`, { value: 1 })
    await call(handler, body, '2')
    await assertPurgedAfter('commit social_links')
  }
})

test('categories: create, update, delete, bulk delete purge after the commit (an update that writes nothing does not)', async () => {
  const cases: Array<[Handler, unknown, string, string]> = [
    [handlers.categoryCreate, { name: 'Chuyên mục mới', type: 'news' }, 'insert categories', 'commit'],
    [handlers.categoryUpdate, { description: 'Mô tả mới' }, 'update categories', 'commit'],
    [handlers.categoryDelete, {}, 'commit categories', 'commit categories'],
    [handlers.categoryBulkDelete, { ids: [8] }, 'commit categories', 'commit categories'],
  ]
  for (const [handler, body, write, lastWrite] of cases) {
    events.length = 0
    for (const key of CACHED) await storage.setItem(`cache:${key}`, { value: 1 })
    await call(handler, body, '8')
    assert.ok(events.includes(write), `no "${write}" — ${events.join(' → ')}`)
    await assertPurgedAfter(lastWrite)
  }
  events.length = 0
  await call(handlers.categoryUpdate, {}, '8')
  assert.ok(!events.includes('purge'), `nothing written, nothing purged — ${events.join(' → ')}`)
})

test('languages and translations: every write purges after the service committed', async () => {
  const cases: Array<[Handler, unknown]> = [
    [handlers.languageCreate, { code: 'ko', name: 'Korean', nativeName: '한국어' }],
    [handlers.languageUpdate, { isActive: false }],
    [handlers.languageDelete, {}],
    [handlers.languageReorder, { orders: [{ code: 'vi', displayOrder: 0 }] }],
    [handlers.translations, { items: [{ group: 'general', key: 'home', value: 'Trang chủ' }] }],
  ]
  for (const [handler, body] of cases) {
    events.length = 0
    for (const key of CACHED) await storage.setItem(`cache:${key}`, { value: 1 })
    await call(handler, body)
    await assertPurgedAfter('commit languages')
  }
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
