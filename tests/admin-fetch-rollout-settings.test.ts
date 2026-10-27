/**
 * Wave 3 D-FETCH, batch A: the admin settings, Media Portal and chatbot-settings pages call
 * `adminFetch<T>()` with response types derived from the handlers
 * (app/types/admin-{settings,media-portal}-api.ts) instead of 38 `$fetch` casts:
 * pages/admin/settings/{social-links,general,backup,media-portal}.vue,
 * pages/admin/media-portal/{[id],categories}.vue, pages/admin/chatbot/settings.vue.
 * (The ninth file, composables/useBackupSettings.ts, has its own suite:
 * tests/use-backup-settings-behavior.test.ts.)
 *
 * Each page's REAL `<script setup>` runs (compiled with @vue/compiler-sfc, Nuxt
 * auto-imports stubbed, as in tests/admin-fetch-rollout.test.ts) against REAL ofetch over
 * a fake network, with the real `adminFetch` and `errorMessage`. What is checked is what
 * the officer gets, not the source text:
 *   1. every action sends exactly the requests it sent before — method, path, query, body,
 *      and the reloads after it. Green on the base too: the conversion is a no-op on the
 *      wire, including backup.vue's list, whose `params:` became `query:` (ofetch aliases);
 *   2. a failed load or action shows the sentence the SERVER wrote, a dropped connection
 *      the page's own fallback — never ofetch's `[GET] "…"` line;
 *   3. FINDINGS fixed in this batch, each RED on the base (597af6a):
 *      - settings/media-portal.vue showed `err.message` on a failed load — for a failed
 *        `$fetch` that is ofetch's `[GET] "/api/…": 403 Forbidden` line (CLAUDE.md "Xử lý lỗi
 *        tầng giao diện" forbids it);
 *      - settings/media-portal.vue (save, "Dọn ngay") and media-portal/[id].vue ("Xử lý lại",
 *        "Chuyển mã") showed `err.statusMessage` — on a FetchError that is the HTTP status
 *        line: h3 strips every non-ASCII character from it (`Video đang xử lý` →
 *        `Video ang x l`) and HTTP/2 sends none, so the officer read mangled text or the
 *        generic fallback instead of the server's sentence;
 *      - a backup row with no `created_at` (a nullable column) read "1/1/1970".
 *   (`MediaConfig.processingMaxJobs`/`processingMaxAttempts` were declared optional, so the
 *   page guarded against an answer without them; the server always fills both, and since
 *   batch B the type says so — the guard and its test are gone, the mount test below reads
 *   the server's values.)
 *
 * The fetch-cast count itself is the ratchet's job (tests/ratchets/fetch-casts.test.ts);
 * the error/retry and skeleton gates still find every page as "fetching"
 * (tests/_admin-fetch-call.ts).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { describe, it } from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createFetch } from 'ofetch'
import * as Vue from 'vue'

import { adminFetch } from '../app/composables/adminFetch.ts'
import * as layoutConfigModule from '../app/composables/useLayoutConfig.ts'
import { formatWhen } from '../app/utils/backup-format.ts'
import { errorMessage } from '../app/utils/errorMessage.ts'
import { ADMIN_FETCH_CALL } from './_admin-fetch-call.ts'

// ─── Fake network under real ofetch ──────────────────────────────────────────

type NetCall = { method: string, url: URL, body: unknown, signal: AbortSignal | undefined }
type Responder = (call: NetCall) => Response | Error | undefined

function installNetwork(responder: Responder) {
  const calls: NetCall[] = []
  const fetchImpl = (input: RequestInfo | URL, init: RequestInit = {}) => new Promise<Response>((resolve, reject) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const call: NetCall = {
      method: (init.method ?? 'GET').toUpperCase(),
      url: new URL(raw, 'http://admin.test'),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
      signal: init.signal ?? undefined,
    }
    calls.push(call)
    const answer = responder(call)
    if (answer instanceof Error) reject(answer)
    else resolve(answer ?? json({ statusCode: 404, statusMessage: 'Not Found' }, 404))
  })
  ;(globalThis as Record<string, unknown>).$fetch = createFetch({ fetch: fetchImpl as typeof fetch })
  return calls
}

const STATUS_TEXT: Record<number, string> = { 200: 'OK', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 409: 'Conflict' }
const json = (body: unknown, status = 200, statusText = STATUS_TEXT[status] ?? '') =>
  new Response(JSON.stringify(body), { status, statusText, headers: { 'content-type': 'application/json' } })
/**
 * What `throw createError({ statusCode, statusMessage })` sends from a Nitro handler: the
 * sentence in the JSON body, and on the HTTP status line the same sentence with every
 * character outside \t and \x20-\x7E removed (h3 `sanitizeStatusMessage`).
 */
const h3Error = (statusCode: number, statusMessage: string) =>
  json({ statusCode, statusMessage, message: statusMessage }, statusCode, statusMessage.replace(/[^\t\x20-\x7E]/g, ''))
const dropped = () => new TypeError('fetch failed')
const wire = (call: NetCall) => `${call.method} ${call.url.pathname}${call.url.search}`

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await Vue.nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

// ─── Run a page's real <script setup> ────────────────────────────────────────

type Toast = { type: string, message: string }

interface RunOptions {
  route?: { params?: Record<string, string>, query?: Record<string, unknown> }
  confirm?: boolean
}

const IMPORT_FROM = /import\s+[^'"]*?\s+from\s+['"]([^'"]+)['"]/g

async function resolveModule(from: string, page: URL): Promise<Record<string, unknown>> {
  if (from.endsWith('.vue')) return { default: {} }
  if (from.startsWith('~~/')) return import(new URL(`../${from.slice(3)}.ts`, import.meta.url).href)
  if (from.startsWith('~/')) return import(new URL(`../app/${from.slice(2)}.ts`, import.meta.url).href)
  if (from.startsWith('.')) return import(new URL(`${from}.ts`, page).href)
  throw new Error(`unexpected import in ${page.pathname}: ${from}`)
}

async function runPage<T extends object>(relative: string, options: RunOptions = {}) {
  const pageUrl = new URL(`../app/${relative}`, import.meta.url)
  const { descriptor } = parse(readFileSync(pageUrl, 'utf8'), { filename: relative })
  const compiled = compileScript(descriptor, { id: 'admin-fetch-rollout-settings' })

  const toasts: Toast[] = []
  const mounted: Array<() => unknown> = []
  const unmounted: Array<() => unknown> = []
  const layoutSaved: unknown[] = []
  const toast = Object.fromEntries(['success', 'error', 'warning', 'info'].map(type =>
    [type, (message: string) => { toasts.push({ type, message }) }]))
  const onMounted = (hook: () => unknown) => { mounted.push(hook) }
  const onUnmount = (hook: () => unknown) => { unmounted.push(hook) }
  const useLayoutConfig = () => ({ setConfig: (config: unknown) => { layoutSaved.push(config) } })

  const modules: Record<string, Record<string, unknown>> = {
    vue: { ...Vue, onMounted, onBeforeUnmount: onUnmount, onUnmounted: onUnmount },
    '~/composables/useLayoutConfig': { ...layoutConfigModule, useLayoutConfig },
  }
  for (const [, from] of compiled.content.matchAll(IMPORT_FROM)) {
    modules[from!] ??= await resolveModule(from!, pageUrl)
  }
  const code = stripTypeScriptTypes(compiled.content)
    .replace(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?/g, (_m, names: string, from: string) =>
      `const {${names.replace(/\s+as\s+/g, ': ')}} = __modules[${JSON.stringify(from)}];`)
    .replace(/import\s+(\w+)\s+from\s*['"]([^'"]+)['"];?/g, (_m, name: string, from: string) =>
      `const ${name} = __modules[${JSON.stringify(from)}].default;`)
    .replace(/export default/, 'return')

  const auto: Record<string, unknown> = {
    definePageMeta: () => {},
    useToast: () => toast,
    useConfirm: () => ({ confirm: async () => options.confirm ?? true }),
    useAdminAuth: () => ({ hasPermission: () => true, user: Vue.ref({ isSuperAdmin: true }) }),
    useRoute: () => ({ params: options.route?.params ?? {}, query: options.route?.query ?? {} }),
    useImagePicker: () => ({ openPicker: () => {} }),
    useUpload: () => ({ uploading: Vue.ref(false), uploadFile: async () => null }),
    useLayoutConfig,
    DEFAULT_LAYOUT_CONFIG: layoutConfigModule.DEFAULT_LAYOUT_CONFIG,
    onBeforeRouteLeave: () => {},
    // social-links.vue scrolls its form into view after `startEdit`; there is no DOM here.
    document: { getElementById: () => null },
    ref: Vue.ref, reactive: Vue.reactive, computed: Vue.computed, watch: Vue.watch, nextTick: Vue.nextTick,
    onMounted, onBeforeUnmount: onUnmount, onUnmounted: onUnmount,
    errorMessage,
    // The real one: it calls the `$fetch` global installed by installNetwork().
    adminFetch,
  }
  // A name the file imports itself is not an auto-import (and would clash as a parameter).
  for (const [, names] of compiled.content.matchAll(/import\s*\{([^}]*)\}/g)) {
    for (const name of names!.split(',')) delete auto[name.split(/\s+as\s+/).at(-1)!.trim()]
  }

  const component = new Function('__modules', ...Object.keys(auto), code)(modules, ...Object.values(auto)) as {
    setup: (props: object, ctx: object) => Record<string, unknown>
  }
  const bindings = component.setup({}, { expose: () => {}, emit: () => {}, attrs: {}, slots: {} })
  const page = Vue.proxyRefs(bindings) as unknown as T
  const mount = async () => {
    for (const hook of mounted) await hook()
    await settle()
  }
  const unmount = () => { for (const hook of unmounted) hook() }
  const lastToast = (type: string) => toasts.filter(t => t.type === type).at(-1)?.message
  return { page, toasts, layoutSaved, mount, unmount, lastToast }
}

/** Install the network, run the page, run its `onMounted` hooks. */
async function open<T extends object>(relative: string, server: Responder, options?: RunOptions) {
  const calls = installNetwork(server)
  const run = await runPage<T>(relative, options)
  await run.mount()
  return { ...run, calls }
}

/** A server that answers `routes` (`'GET /api/x'` → answer) and lets `override` win. */
function server(routes: Record<string, (call: NetCall) => Response>, override: Responder = () => undefined): Responder {
  return (call) => override(call) ?? routes[`${call.method} ${call.url.pathname}`]?.(call)
}

const LAYOUT = { containerWidth: 'wide', containerCustom: 1240, articleGrid: 'grid', articleGridCols: 3, socialDisplayMode: 'popup', socialAutoOpen: false }

// ─── pages/admin/settings/social-links.vue ───────────────────────────────────

type SocialLinkRow = { id: number, platform: string, label: string, url: string, icon: string, iconType: string, color: string, sortOrder: number, isVisible: boolean }
type SocialLinksPage = {
  items: SocialLinkRow[]
  loadError: string
  formError: string
  editingId: number | null
  form: { platform: string, label: string, url: string, iconType: string, icon: string, color: string, isVisible: boolean }
  layoutDraft: typeof LAYOUT
  load: () => Promise<void>
  save: () => Promise<void>
  startEdit: (item: SocialLinkRow) => void
  toggleVisible: (item: SocialLinkRow) => Promise<void>
  remove: (item: SocialLinkRow) => Promise<void>
  move: (item: SocialLinkRow, dir: -1 | 1) => Promise<void>
  saveLayout: () => Promise<void>
}

const LINKS = (): SocialLinkRow[] => [
  { id: 1, platform: 'Facebook', label: 'Fanpage C11', url: 'https://facebook.com/c11', icon: 'fa-brands fa-facebook-f', iconType: 'fontawesome', color: '#1877f2', sortOrder: 0, isVisible: true },
  { id: 2, platform: 'Zalo', label: 'Zalo OA', url: 'https://zalo.me/c11', icon: '/assets/social/zalo.svg', iconType: 'svg', color: '#0068ff', sortOrder: 1, isVisible: false },
]

const socialServer = (override?: Responder) => server({
  'GET /api/admin/social-links': () => json({ ok: true, items: LINKS().map(l => ({ ...l, createdAt: null, updatedAt: null })) }),
  'GET /api/admin/settings/layout': () => json({ ok: true, config: LAYOUT }),
  'PUT /api/admin/settings/layout': call => json({ ok: true, config: call.body }),
  'POST /api/admin/social-links': () => json({ ok: true, id: 9 }),
  'PUT /api/admin/social-links/1': () => json({ ok: true }),
  'PUT /api/admin/social-links/2': () => json({ ok: true }),
  'DELETE /api/admin/social-links/2': () => json({ ok: true }),
  'POST /api/admin/social-links/reorder': () => json({ ok: true }),
}, override)

describe('pages/admin/settings/social-links.vue', () => {
  const PAGE = 'pages/admin/settings/social-links.vue'

  it('mount reads the links and the layout config', async () => {
    const { page, calls } = await open<SocialLinksPage>(PAGE, socialServer())
    assert.deepEqual(calls.map(wire), ['GET /api/admin/social-links', 'GET /api/admin/settings/layout'])
    assert.deepEqual(page.items.map(i => i.id), [1, 2])
    assert.deepEqual(page.layoutDraft, LAYOUT)
    assert.equal(page.loadError, '')
  })

  it('a failed load shows the server\'s sentence; a dropped one the page\'s own', async () => {
    let answer: () => Response | Error = () => h3Error(403, 'Forbidden: Insufficient permissions')
    const { page } = await open<SocialLinksPage>(PAGE, socialServer(call => call.url.pathname === '/api/admin/social-links' ? answer() : undefined))
    assert.equal(page.loadError, 'Forbidden: Insufficient permissions')
    answer = dropped
    await page.load()
    assert.equal(page.loadError, 'Không tải được danh sách mạng xã hội.')
  })

  it('adding a link posts the form with its position, then reloads; editing puts the form', async () => {
    const { page, calls, lastToast } = await open<SocialLinksPage>(PAGE, socialServer())
    Object.assign(page.form, { platform: 'TikTok', label: 'TikTok C11', url: 'https://tiktok.com/@c11', iconType: 'fontawesome', icon: 'fa-brands fa-tiktok', color: '#000000', isVisible: true })
    const before = calls.length
    await page.save()
    assert.deepEqual(calls.slice(before).map(wire), ['POST /api/admin/social-links', 'GET /api/admin/social-links'])
    assert.deepEqual(calls[before]!.body, { platform: 'TikTok', label: 'TikTok C11', url: 'https://tiktok.com/@c11', iconType: 'fontawesome', icon: 'fa-brands fa-tiktok', color: '#000000', isVisible: true, sortOrder: 2 })
    assert.equal(page.editingId, 9)
    assert.equal(lastToast('success'), 'Đã thêm "TikTok C11".')

    page.startEdit(page.items[1]!)
    assert.equal(page.form.iconType, 'svg')
    await page.save()
    assert.equal(wire(calls.at(-2)!), 'PUT /api/admin/social-links/2')
    assert.deepEqual(calls.at(-2)!.body, { platform: 'Zalo', label: 'Zalo OA', url: 'https://zalo.me/c11', iconType: 'svg', icon: '/assets/social/zalo.svg', color: '#0068ff', isVisible: false })
  })

  it('a refused save shows the server\'s sentence in the form', async () => {
    const { page } = await open<SocialLinksPage>(PAGE, socialServer(call => call.method === 'POST' ? h3Error(400, 'Đường dẫn không hợp lệ.') : undefined))
    Object.assign(page.form, { platform: 'X', label: 'X C11', url: 'https://x.com/c11', icon: 'fa-brands fa-x-twitter' })
    await page.save()
    assert.equal(page.formError, 'Đường dẫn không hợp lệ.')
  })

  it('show/hide, delete and reorder send what they sent before', async () => {
    const { page, calls } = await open<SocialLinksPage>(PAGE, socialServer())
    const zalo = page.items[1]!
    await page.toggleVisible(zalo)
    assert.equal(wire(calls.at(-1)!), 'PUT /api/admin/social-links/2')
    assert.deepEqual(calls.at(-1)!.body, { isVisible: true })
    assert.equal(zalo.isVisible, true)

    await page.move(page.items[1]!, -1)
    assert.equal(wire(calls.at(-1)!), 'POST /api/admin/social-links/reorder')
    assert.deepEqual(calls.at(-1)!.body, { orderedIds: [2, 1] })

    const before = calls.length
    await page.remove(page.items.find(i => i.id === 2)!)
    assert.deepEqual(calls.slice(before).map(wire), ['DELETE /api/admin/social-links/2', 'GET /api/admin/social-links'])
  })

  it('a refused reorder shows the server\'s sentence and reloads the true order', async () => {
    const { page, calls, lastToast } = await open<SocialLinksPage>(PAGE, socialServer(call => call.url.pathname.endsWith('/reorder') ? h3Error(403, 'Forbidden: Insufficient permissions') : undefined))
    const before = calls.length
    await page.move(page.items[0]!, 1)
    assert.deepEqual(calls.slice(before).map(wire), ['POST /api/admin/social-links/reorder', 'GET /api/admin/social-links'])
    assert.equal(lastToast('error'), 'Forbidden: Insufficient permissions')
    assert.deepEqual(page.items.map(i => i.id), [1, 2])
  })

  it('saving the display config puts the draft and hands the answer to the shared state', async () => {
    const { page, calls, layoutSaved } = await open<SocialLinksPage>(PAGE, socialServer())
    page.layoutDraft.socialAutoOpen = true
    await page.saveLayout()
    assert.equal(wire(calls.at(-1)!), 'PUT /api/admin/settings/layout')
    assert.deepEqual(calls.at(-1)!.body, { ...LAYOUT, socialAutoOpen: true })
    assert.deepEqual(layoutSaved, [{ ...LAYOUT, socialAutoOpen: true }])
  })
})

// ─── pages/admin/settings/general.vue ────────────────────────────────────────

type GeneralPage = {
  settings: Record<string, string>
  error: string
  draft: typeof LAYOUT
  fetchSettings: () => Promise<void>
  handleSave: () => Promise<void>
  uploadFavicon: (event: Event) => Promise<void>
  resetFavicon: () => Promise<void>
  saveLayout: () => Promise<void>
}

const SITE = { site_name: 'Cổng C11', hotline: '1900 0000', logo_url: null, favicon_url: '/uploads/2026/10/favicon-32.png' }
const generalServer = (override?: Responder) => server({
  'GET /api/admin/settings': () => json({ ok: true, settings: SITE, needsReentry: [] }),
  'PUT /api/admin/settings': () => json({ ok: true }),
  'POST /api/admin/settings/favicon': () => json({ ok: true, faviconUrl: '/uploads/favicon/new-32.png', icoUrl: '/uploads/favicon/new.ico', sourceBytes: 9, iconBytes: 3, convertedToPng: true }),
  'DELETE /api/admin/settings/favicon': () => json({ ok: true }),
  'GET /api/admin/settings/layout': () => json({ ok: true, config: LAYOUT }),
  'PUT /api/admin/settings/layout': call => json({ ok: true, config: call.body }),
}, override)

describe('pages/admin/settings/general.vue', () => {
  const PAGE = 'pages/admin/settings/general.vue'

  it('mount reads the site settings and the layout; only stored, non-null values replace the defaults', async () => {
    const { page, calls } = await open<GeneralPage>(PAGE, generalServer())
    assert.deepEqual(calls.map(wire), ['GET /api/admin/settings', 'GET /api/admin/settings/layout'])
    assert.equal(page.settings.site_name, 'Cổng C11')
    assert.equal(page.settings.favicon_url, '/uploads/2026/10/favicon-32.png')
    assert.equal(page.settings.logo_url, '/Logo.png', 'a NULL keeps the default')
    assert.deepEqual(page.draft, LAYOUT)
  })

  it('a failed load shows the server\'s sentence; a dropped one the page\'s own', async () => {
    let answer: () => Response | Error = () => h3Error(403, 'Forbidden: Insufficient permissions')
    const { page } = await open<GeneralPage>(PAGE, generalServer(call => wire(call) === 'GET /api/admin/settings' ? answer() : undefined))
    assert.equal(page.error, 'Forbidden: Insufficient permissions')
    answer = dropped
    await page.fetchSettings()
    assert.equal(page.error, 'Không tải được cài đặt website.')
  })

  it('saving puts the eleven general keys under `settings`', async () => {
    const { page, calls, lastToast } = await open<GeneralPage>(PAGE, generalServer())
    await page.handleSave()
    const put = calls.at(-1)!
    assert.equal(wire(put), 'PUT /api/admin/settings')
    assert.deepEqual(Object.keys((put.body as { settings: object }).settings), [
      'site_name', 'site_description', 'hotline', 'email', 'address', 'facebook_url',
      'main_logo_url', 'logo_url', 'hero_banner_url', 'favicon_url', 'og_image_url',
    ])
    assert.equal((put.body as { settings: Record<string, string> }).settings.site_name, 'Cổng C11')
    assert.equal(lastToast('success'), 'Đã lưu cài đặt website thành công!')
  })

  it('a refused save toasts the server\'s sentence', async () => {
    const { page, lastToast } = await open<GeneralPage>(PAGE, generalServer(call => call.method === 'PUT' ? h3Error(400, 'Email không hợp lệ.') : undefined))
    await page.handleSave()
    assert.equal(lastToast('error'), 'Email không hợp lệ.')
  })

  it('the favicon upload posts the file and applies the answer; reset deletes', async () => {
    const { page, calls, lastToast } = await open<GeneralPage>(PAGE, generalServer())
    const input = { files: [new File(['png'], 'logo.jpg', { type: 'image/jpeg' })], value: 'C:\\fakepath\\logo.jpg' }
    await page.uploadFavicon({ target: input } as unknown as Event)
    assert.equal(wire(calls.at(-1)!), 'POST /api/admin/settings/favicon')
    assert.ok(calls.at(-1)!.body instanceof FormData)
    assert.equal(page.settings.favicon_url, '/uploads/favicon/new-32.png')
    assert.equal(lastToast('success'), 'Đã đặt favicon mới và áp dụng ngay (đã chuyển sang PNG để giữ nền trong suốt).')
    assert.equal(input.value, '')

    await page.resetFavicon()
    assert.equal(wire(calls.at(-1)!), 'DELETE /api/admin/settings/favicon')
    assert.equal(page.settings.favicon_url, '')
  })

  it('a refused favicon upload toasts the server\'s sentence', async () => {
    const { page, lastToast } = await open<GeneralPage>(PAGE, generalServer(call => call.method === 'POST' ? h3Error(400, 'Tệp không phải ảnh PNG, JPG hoặc ICO.') : undefined))
    await page.uploadFavicon({ target: { files: [new File(['x'], 'x.gif')], value: 'x' } } as unknown as Event)
    assert.equal(lastToast('error'), 'Tệp không phải ảnh PNG, JPG hoặc ICO.')
  })

  it('saving the layout puts the draft and hands the answer to the shared state', async () => {
    const { page, calls, layoutSaved } = await open<GeneralPage>(PAGE, generalServer())
    page.draft.articleGridCols = 4
    await page.saveLayout()
    assert.deepEqual(calls.at(-1)!.body, { ...LAYOUT, articleGridCols: 4 })
    assert.deepEqual(layoutSaved, [{ ...LAYOUT, articleGridCols: 4 }])
  })
})

// ─── pages/admin/settings/backup.vue ─────────────────────────────────────────

type BackupRow = { id: number, filename: string, type: string, bytes: number, stamp: string, status: string, driveUploaded: boolean | null, offsiteStatus: string | null, createdAt: string | null }
type BackupPage = {
  items: BackupRow[]
  total: number
  totalPages: number
  error: string
  filterType: string
  running: boolean
  loadBackups: () => Promise<void>
  runBackup: (type: 'sql' | 'files' | 'all') => Promise<void>
  restoreBackup: (filename: string) => Promise<void>
  deleteBackup: (item: BackupRow) => Promise<void>
}

const BACKUP_ROW: BackupRow = { id: 7, filename: 'cdkt-20261020T020000Z.sql.gz', type: 'sql', bytes: 2048, stamp: '20261020T020000Z', status: 'done', driveUploaded: null, offsiteStatus: 'none', createdAt: null }
const IDLE = { running: false, phase: '', message: '', startedAt: null }
const backupServer = (override?: Responder) => server({
  'GET /api/admin/backup': () => json({ ok: true, items: [BACKUP_ROW], total: 1, page: 1, pageSize: 20, totalPages: 1 }),
  'GET /api/admin/backup/status': () => json({ ok: true, pid: 1, uptime: 9, backup: IDLE, restore: IDLE }),
  'POST /api/admin/backup/run': () => json({ ok: true, stamp: '20261020T020000Z', files: [{ name: 'a.sql.gz', type: 'sql', bytes: 1 }], driveUploaded: true }),
  'POST /api/admin/backup/restore': () => json({ ok: true, warning: 'Đã khôi phục; cần đăng nhập lại.' }),
  [`DELETE /api/admin/backup/${BACKUP_ROW.filename}`]: () => json({ ok: true }),
}, override)

describe('pages/admin/settings/backup.vue', () => {
  const PAGE = 'pages/admin/settings/backup.vue'

  it('the list asks for the same page as before (`params:` became `query:` — ofetch aliases them)', async () => {
    const { page, calls, unmount } = await open<BackupPage>(PAGE, backupServer())
    assert.deepEqual(calls.map(wire), ['GET /api/admin/backup?page=1&pageSize=20', 'GET /api/admin/backup/status'])
    assert.deepEqual(page.items, [BACKUP_ROW])
    assert.equal(page.total, 1)

    page.filterType = 'sql'
    await page.loadBackups()
    assert.equal(wire(calls.at(-1)!), 'GET /api/admin/backup?page=1&pageSize=20&type=sql')
    unmount()
  })

  it('a failed list shows the server\'s sentence and no rows; a dropped one the page\'s own', async () => {
    let answer: () => Response | Error = () => h3Error(403, 'Forbidden: Insufficient permissions')
    const { page, unmount } = await open<BackupPage>(PAGE, backupServer(call => wire(call).startsWith('GET /api/admin/backup?') ? answer() : undefined))
    assert.equal(page.error, 'Forbidden: Insufficient permissions')
    assert.deepEqual(page.items, [])
    answer = dropped
    await page.loadBackups()
    assert.equal(page.error, 'Không tải được danh sách backup.')
    unmount()
  })

  it('a manual backup posts its type, says what it made, then reloads the list and the status', async () => {
    const { page, calls, lastToast, unmount } = await open<BackupPage>(PAGE, backupServer())
    const before = calls.length
    await page.runBackup('sql')
    await settle()
    assert.deepEqual(calls.slice(before).map(wire), ['POST /api/admin/backup/run', 'GET /api/admin/backup?page=1&pageSize=20', 'GET /api/admin/backup/status'])
    assert.deepEqual(calls[before]!.body, { type: 'sql' })
    assert.equal(lastToast('success'), 'Đã tạo 1 file backup + upload Drive.')
    assert.equal(page.running, false)
    unmount()
  })

  it('a refused backup toasts the server\'s sentence', async () => {
    const { page, lastToast, unmount } = await open<BackupPage>(PAGE, backupServer(call => call.url.pathname.endsWith('/run') ? h3Error(409, 'Một lượt backup khác đang chạy.') : undefined))
    await page.runBackup('all')
    assert.equal(lastToast('error'), 'Một lượt backup khác đang chạy.')
    unmount()
  })

  it('restore posts the file name and shows the server\'s warning; delete names the row', async () => {
    const { page, calls, toasts, unmount } = await open<BackupPage>(PAGE, backupServer())
    await page.restoreBackup(BACKUP_ROW.filename)
    const restore = calls.find(c => c.url.pathname === '/api/admin/backup/restore')!
    assert.equal(restore.method, 'POST')
    assert.deepEqual(restore.body, { filename: BACKUP_ROW.filename })
    assert.ok(toasts.some(t => t.type === 'warning' && t.message === 'Đã khôi phục; cần đăng nhập lại.'))

    await page.deleteBackup(BACKUP_ROW)
    assert.ok(calls.some(c => wire(c) === `DELETE /api/admin/backup/${BACKUP_ROW.filename}?id=7`))
    unmount()
  })

  it('FINDING: a backup row without created_at shows a dash, not "1/1/1970" (the column is nullable)', () => {
    assert.equal(formatWhen(null), '—')
    assert.equal(formatWhen('not a date'), 'not a date')
    assert.notEqual(formatWhen('2026-10-20T02:00:00.000Z'), '—')
  })
})

// ─── pages/admin/settings/media-portal.vue ───────────────────────────────────

type MediaPortalSettingsPage = {
  error: string
  data: { config: { processingMaxJobs: number } } | null
  form: Record<string, unknown>
  usingSharedMediaStorageR2: boolean
  load: () => Promise<void>
  save: () => Promise<void>
  cleanNow: () => Promise<void>
  useMediaStorageR2: () => Promise<void>
}

const SOURCES = (value: string) => Object.fromEntries(['uploadEnabled', 'maxUploadSize', 'chunkSize', 'diskFloorBytes', 'sessionInactivityHours',
  'processingHeartbeatSeconds', 'processingStaleMinutes', 'processingMaxJobs', 'processingMaxAttempts'].map(k => [k, value]))
const PORTAL = {
  ok: true,
  config: {
    uploadEnabled: true, maxUploadSize: 2 * 1024 ** 3, chunkSize: 8 * 1024 ** 2, diskFloorBytes: 5 * 1024 ** 3, sessionInactivityHours: 12,
    processingHeartbeatSeconds: 30, processingStaleMinutes: 10, processingMaxJobs: 2, processingMaxAttempts: 4,
    videoStorage: { provider: 'r2', r2AccountId: '0123456789abcdef0123456789abcdef', r2AccessKey: 'AK', r2Bucket: 'cdkt-video', r2PublicUrl: 'https://cdn.example.vn' },
  },
  sources: SOURCES('database'),
  videoStorageSources: { provider: 'database', r2AccountId: 'database', r2AccessKey: 'database', r2SecretKey: 'database', r2Bucket: 'database', r2PublicUrl: 'database' },
  videoStorage: { provider: 'r2', r2Configured: true, secretMasked: '********', secretUnreadable: false, secretStored: true, localCount: 3, r2Count: 4 },
  workdir: '/app/media-work', workdirIsDefault: true, ffmpegInstalled: true, ffmpegPath: '/usr/bin/ffmpeg', diskFreeBytes: 10 * 1024 ** 3, diskFloorBytes: 5 * 1024 ** 3,
}
const portalServer = (override?: Responder) => server({
  'GET /api/admin/settings/media-portal': () => json(PORTAL),
  'GET /api/admin/settings': () => json({ ok: true, settings: { media_provider: 'r2', r2_account_id: '0123456789abcdef0123456789abcdef', r2_access_key: 'AK', r2_secret_key: '********', r2_bucket: 'cdkt-video', r2_public_url: 'https://img.example.vn' }, needsReentry: [] }),
  'PUT /api/admin/settings/media-portal': () => json({ ok: true }),
  'POST /api/admin/media-portal/upload/housekeep': () => json({ ok: true, sessions: 2, orphans: 1 }),
}, override)

describe('pages/admin/settings/media-portal.vue', () => {
  const PAGE = 'pages/admin/settings/media-portal.vue'

  it('mount reads the Media Portal settings, then the image R2 settings to tell a shared bucket', async () => {
    const { page, calls } = await open<MediaPortalSettingsPage>(PAGE, portalServer())
    assert.deepEqual(calls.map(wire), ['GET /api/admin/settings/media-portal', 'GET /api/admin/settings'])
    assert.equal(page.form.maxUploadSizeGb, 2)
    assert.equal(page.form.chunkSizeMb, 8)
    assert.equal(page.form.processingMaxJobs, 2)
    assert.equal(page.form.processingMaxAttempts, 4)
    assert.equal(page.form.videoR2Bucket, 'cdkt-video')
    assert.equal(page.form.videoR2SecretKey, '')
    assert.equal(page.usingSharedMediaStorageR2, true)
    assert.equal(page.error, '')
  })

  it('FINDING: a failed load shows the server\'s sentence, not ofetch\'s "[GET] …: 403 Forbidden" line (RED on base: err.message)', async () => {
    const { page } = await open<MediaPortalSettingsPage>(PAGE, portalServer(call => call.url.pathname === '/api/admin/settings/media-portal' ? h3Error(403, 'Forbidden: Insufficient permissions') : undefined))
    assert.equal(page.error, 'Forbidden: Insufficient permissions')
  })

  it('FINDING: a dropped load shows the page\'s own sentence, not "[GET] …: <no response> fetch failed" (RED on base)', async () => {
    const { page } = await open<MediaPortalSettingsPage>(PAGE, portalServer(call => call.url.pathname === '/api/admin/settings/media-portal' ? dropped() : undefined))
    assert.equal(page.error, 'Không tải được cấu hình Media Portal.')
  })

  it('saving puts every field as a string, then reloads', async () => {
    const { page, calls, lastToast } = await open<MediaPortalSettingsPage>(PAGE, portalServer())
    const before = calls.length
    await page.save()
    assert.deepEqual(calls.slice(before).map(wire), ['PUT /api/admin/settings/media-portal', 'GET /api/admin/settings/media-portal', 'GET /api/admin/settings'])
    assert.deepEqual(calls[before]!.body, {
      fields: {
        uploadEnabled: 'true', maxUploadSize: String(2 * 1024 ** 3), chunkSize: String(8 * 1024 ** 2), diskFloorBytes: String(5 * 1024 ** 3),
        sessionInactivityHours: '12', processingHeartbeatSeconds: '30', processingStaleMinutes: '10', processingMaxJobs: '2', processingMaxAttempts: '4',
        videoStorageProvider: 'r2', videoR2AccountId: '0123456789abcdef0123456789abcdef', videoR2AccessKey: 'AK', videoR2SecretKey: '',
        videoR2Bucket: 'cdkt-video', videoR2PublicUrl: 'https://cdn.example.vn',
      },
    })
    assert.equal(lastToast('success'), 'Đã lưu cài đặt Media Portal.')
  })

  it('FINDING: a refused save toasts the server\'s sentence, not the diacritic-stripped status line (RED on base)', async () => {
    const { page, lastToast } = await open<MediaPortalSettingsPage>(PAGE, portalServer(call => call.method === 'PUT' ? h3Error(400, 'Ngưỡng đĩa trống phải từ 0 đến 1024 GB.') : undefined))
    await page.save()
    assert.equal(lastToast('error'), 'Ngưỡng đĩa trống phải từ 0 đến 1024 GB.')
  })

  it('"Dọn ngay" posts the confirmation and says what was removed', async () => {
    const { page, calls, lastToast } = await open<MediaPortalSettingsPage>(PAGE, portalServer())
    await page.cleanNow()
    assert.equal(wire(calls.at(-1)!), 'POST /api/admin/media-portal/upload/housekeep')
    assert.deepEqual(calls.at(-1)!.body, { confirm: true })
    assert.equal(lastToast('success'), 'Đã dọn 2 phiên, 1 thư mục mồ côi.')
  })

  it('FINDING: a refused "Dọn ngay" toasts the server\'s sentence (RED on base: 409 "Mt lt dn khc ang chy…")', async () => {
    const { page, lastToast } = await open<MediaPortalSettingsPage>(PAGE, portalServer(call => call.url.pathname.endsWith('/housekeep') ? h3Error(409, 'Một lượt dọn khác đang chạy. Thử lại sau.') : undefined))
    await page.cleanNow()
    assert.equal(lastToast('error'), 'Một lượt dọn khác đang chạy. Thử lại sau.')
  })

  it('"Dùng R2 của Media Storage" copies the four public fields, never the masked secret', async () => {
    const { page, calls } = await open<MediaPortalSettingsPage>(PAGE, portalServer())
    page.form.videoR2PublicUrl = ''
    await page.useMediaStorageR2()
    assert.equal(wire(calls.at(-1)!), 'GET /api/admin/settings')
    assert.equal(page.form.videoR2PublicUrl, 'https://img.example.vn')
    assert.equal(page.form.videoR2SecretKey, '')
  })
})

// ─── pages/admin/media-portal/[id].vue ───────────────────────────────────────

type MediaDetailPage = {
  item: Record<string, unknown> | null
  config: Record<string, unknown> | null
  loadError: string
  actionError: string
  transcodeRenditions: Set<string>
  save: (fields: Record<string, unknown>) => Promise<void>
  reprocess: () => Promise<void>
  openTranscode: () => void
  submitTranscode: () => Promise<void>
  setThumbnail: (id: number) => Promise<void>
  clearThumbnail: () => Promise<void>
}

const MEDIA = (status = 'failed') => ({
  id: 5, shortId: 'v5', title: 'Video', source: 'upload', processingStatus: status, processingError: null,
  resolutionsReady: ['360p'], storageProvider: 'local', height: 720, thumbnailUrl: null,
})
const mediaServer = (override?: Responder) => server({
  'GET /api/admin/media-portal/5': () => json({ ok: true, item: MEDIA() }),
  'GET /api/admin/media-portal/config': () => json({ ok: true, uploadEnabled: true }),
  'PUT /api/admin/media-portal/5': () => json({ ok: true, slug: 'video', status: 'published' }),
  'POST /api/admin/media-portal/5/process': () => json({ ok: true, message: 'Đã đưa mục vào hàng chờ chuyển mã.' }),
  'POST /api/admin/media-portal/5/thumbnail': () => json({ ok: true }),
  'DELETE /api/admin/media-portal/5/thumbnail': () => json({ ok: true }),
}, override)
const VIDEO = { route: { params: { id: '5' } } }

describe('pages/admin/media-portal/[id].vue', () => {
  const PAGE = 'pages/admin/media-portal/[id].vue'

  it('mount reads the video and the upload config, both cancellable', async () => {
    const { page, calls, unmount } = await open<MediaDetailPage>(PAGE, mediaServer(), VIDEO)
    assert.deepEqual(calls.map(wire), ['GET /api/admin/media-portal/5', 'GET /api/admin/media-portal/config'])
    assert.ok(calls.every(c => c.signal instanceof AbortSignal))
    assert.equal(page.item?.id, 5)
    assert.equal(page.config?.uploadEnabled, true)
    assert.equal(page.loadError, '')
    unmount()
  })

  it('saving puts the fields once (no retry) and re-reads the video', async () => {
    const { page, calls, lastToast, unmount } = await open<MediaDetailPage>(PAGE, mediaServer(), VIDEO)
    const before = calls.length
    await page.save({ title: 'Video mới' })
    assert.deepEqual(calls.slice(before).map(wire), ['PUT /api/admin/media-portal/5', 'GET /api/admin/media-portal/5'])
    assert.deepEqual(calls[before]!.body, { title: 'Video mới' })
    assert.equal(lastToast('success'), 'Đã lưu thay đổi.')
    unmount()
  })

  it('a refused save shows the server\'s sentence', async () => {
    const { page, unmount } = await open<MediaDetailPage>(PAGE, mediaServer(call => call.method === 'PUT' ? h3Error(400, 'Tiêu đề quá dài.') : undefined), VIDEO)
    await page.save({ title: 'x' })
    assert.equal(page.actionError, 'Tiêu đề quá dài.')
    unmount()
  })

  it('"Xử lý lại" posts with no body; "Chuyển mã" posts the ticked renditions', async () => {
    const { page, calls, unmount } = await open<MediaDetailPage>(PAGE, mediaServer(), VIDEO)
    await page.reprocess()
    assert.equal(wire(calls.at(-1)!), 'POST /api/admin/media-portal/5/process')
    assert.equal(calls.at(-1)!.body, undefined)
    assert.equal(page.item?.processingStatus, 'pending')

    page.openTranscode()
    await page.submitTranscode()
    assert.equal(wire(calls.at(-1)!), 'POST /api/admin/media-portal/5/process')
    assert.deepEqual(calls.at(-1)!.body, { renditions: ['360p', '720p'] })
    unmount()
  })

  it('FINDING: a refused "Xử lý lại" shows the server\'s sentence, not the status line h3 stripped of diacritics (RED on base)', async () => {
    const { page, unmount } = await open<MediaDetailPage>(PAGE, mediaServer(call => call.url.pathname.endsWith('/process') ? h3Error(409, 'Video đang được xử lý, chờ lượt hiện tại xong.') : undefined), VIDEO)
    await page.reprocess()
    assert.equal(page.actionError, 'Video đang được xử lý, chờ lượt hiện tại xong.')
    unmount()
  })

  it('FINDING: a refused "Chuyển mã" shows the server\'s sentence (RED on base)', async () => {
    const { page, unmount } = await open<MediaDetailPage>(PAGE, mediaServer(call => call.url.pathname.endsWith('/process') ? h3Error(400, 'Bản nén không hợp lệ: 4k.') : undefined), VIDEO)
    page.openTranscode()
    await page.submitTranscode()
    assert.equal(page.actionError, 'Bản nén không hợp lệ: 4k.')
    unmount()
  })

  it('setting a thumbnail posts the library image; clearing asks once, then deletes', async () => {
    const { page, calls, unmount } = await open<MediaDetailPage>(PAGE, mediaServer(), VIDEO)
    await page.setThumbnail(42)
    assert.equal(wire(calls.at(-2)!), 'POST /api/admin/media-portal/5/thumbnail')
    assert.deepEqual(calls.at(-2)!.body, { mediaId: 42 })
    const before = calls.length
    await page.clearThumbnail()
    assert.equal(calls.length, before, 'first press only asks')
    await page.clearThumbnail()
    assert.equal(wire(calls[before]!), 'DELETE /api/admin/media-portal/5/thumbnail')
    unmount()
  })

  it('a failed load keeps its own sentence (unchanged)', async () => {
    const { page, unmount } = await open<MediaDetailPage>(PAGE, mediaServer(call => call.url.pathname === '/api/admin/media-portal/5' ? h3Error(404, 'Mục media không tồn tại.') : undefined), VIDEO)
    assert.equal(page.loadError, 'Không tải được video. Video có thể đã bị xóa hoặc bạn không còn quyền truy cập.')
    unmount()
  })
})

// ─── pages/admin/media-portal/categories.vue ─────────────────────────────────

type CategoryRow = { id: number, name: string, slug: string, description: string | null, displayOrder: number, createdAt: string | null, usageCount: number }
type CategoriesPage = {
  categories: CategoryRow[]
  error: string
  form: { name: string, slug: string, description: string, displayOrder: number }
  fetchCategories: () => Promise<void>
  openCreate: () => void
  openEdit: (row: CategoryRow) => void
  handleSave: () => Promise<void>
  deleteCategory: (row: CategoryRow) => Promise<void>
}

const CATEGORY: CategoryRow = { id: 3, name: 'Phóng sự', slug: 'phong-su', description: null, displayOrder: 1, createdAt: '2026-10-01T00:00:00.000Z', usageCount: 4 }
const categoriesServer = (override?: Responder) => server({
  'GET /api/admin/media-portal/categories': () => json({ ok: true, items: [CATEGORY] }),
  'POST /api/admin/media-portal/categories': () => json({ ok: true, id: 4, slug: 'tu-lieu' }),
  'PUT /api/admin/media-portal/categories/3': () => json({ ok: true, slug: 'phong-su' }),
  'DELETE /api/admin/media-portal/categories/3': () => json({ ok: true }),
}, override)

describe('pages/admin/media-portal/categories.vue', () => {
  const PAGE = 'pages/admin/media-portal/categories.vue'

  it('mount lists the categories with their usage', async () => {
    const { page, calls } = await open<CategoriesPage>(PAGE, categoriesServer())
    assert.deepEqual(calls.map(wire), ['GET /api/admin/media-portal/categories'])
    assert.deepEqual(page.categories, [CATEGORY])
  })

  it('a failed list shows the server\'s sentence; a dropped one the page\'s own', async () => {
    let answer: () => Response | Error = () => h3Error(403, 'Forbidden: Insufficient permissions')
    const { page } = await open<CategoriesPage>(PAGE, categoriesServer(call => call.method === 'GET' ? answer() : undefined))
    assert.equal(page.error, 'Forbidden: Insufficient permissions')
    answer = dropped
    await page.fetchCategories()
    assert.equal(page.error, 'Không tải được danh sách danh mục.')
  })

  it('create posts, edit puts, delete deletes — each then reloads the list', async () => {
    const { page, calls } = await open<CategoriesPage>(PAGE, categoriesServer())
    page.openCreate()
    page.form.name = 'Tư liệu'
    await Vue.nextTick()
    await page.handleSave()
    assert.deepEqual(calls.slice(-2).map(wire), ['POST /api/admin/media-portal/categories', 'GET /api/admin/media-portal/categories'])
    assert.deepEqual(calls.at(-2)!.body, { name: 'Tư liệu', slug: 'tu-lieu', description: null, displayOrder: 0 })

    page.openEdit(CATEGORY)
    await page.handleSave()
    assert.deepEqual(calls.slice(-2).map(wire), ['PUT /api/admin/media-portal/categories/3', 'GET /api/admin/media-portal/categories'])

    await page.deleteCategory(CATEGORY)
    assert.deepEqual(calls.slice(-2).map(wire), ['DELETE /api/admin/media-portal/categories/3', 'GET /api/admin/media-portal/categories'])
  })

  it('a refused delete toasts the server\'s sentence', async () => {
    const { page, lastToast } = await open<CategoriesPage>(PAGE, categoriesServer(call => call.method === 'DELETE' ? h3Error(409, 'Danh mục đang có 4 video, không xoá được.') : undefined))
    await page.deleteCategory(CATEGORY)
    assert.equal(lastToast('error'), 'Danh mục đang có 4 video, không xoá được.')
  })
})

// ─── pages/admin/chatbot/settings.vue ────────────────────────────────────────

type ChatbotSettingsPage = {
  errorMessage: string
  form: Record<string, unknown>
  metadata: { hasApiKey: boolean, apiKeyMasked: string | null }
  activeProviders: Array<{ provider: string }>
  activeModels: Array<{ model: string }>
  systemPromptReplacement: string
  defaultSystemPrompt: string
  load: () => Promise<void>
  save: () => Promise<void>
}

const CHATBOT_SETTINGS = {
  id: 1, enabled: true, providerPolicy: 'openai-compatible', baseUrl: 'https://router.delify.vn/v1', model: 'old-model',
  systemPromptConfigured: true, systemPromptLength: 12, defaultSystemPrompt: 'Bạn là trợ lý C11.', providerPresets: {},
  allowedHosts: ['router.delify.vn'], mode: 'ai', outOfScopeBehavior: 'knowledge_only', knowledgeGreeting: 'Xin chào', fallbackMessage: '',
  leadCaptureEnabled: false, leadCaptureEmail: '', smallTalkEnabled: true, requestTimeoutMs: 15000, maxResponseBytes: 262144,
  maxInputChars: 2000, maxHistoryMessages: 8, retrievalTopK: 3, referenceCharBudget: 6000, rateLimitRequests: 10, rateLimitWindowSeconds: 60,
  hasApiKey: true, apiKeyStatus: 'configured', apiKeyMasked: '••••wxyz', createdAt: null, updatedAt: null,
}
const chatbotServer = (override?: Responder) => server({
  'GET /api/admin/chatbot/settings': () => json({ ok: true, settings: CHATBOT_SETTINGS, currentSystemPrompt: 'Lời dặn riêng.', currentProvider: 'delify', currentModel: 'glm-5.3' }),
  'GET /api/admin/ai/providers': () => json({ ok: true, providers: [
    { id: 1, provider: 'delify', label: 'Delify', baseUrl: null, isActive: true, apiKeyLastFour: null, updatedAt: null, totalModels: 1, activeModels: 1 },
    { id: 2, provider: 'openai', label: 'OpenAI', baseUrl: null, isActive: false, apiKeyLastFour: null, updatedAt: null, totalModels: 0, activeModels: 0 },
  ] }),
  'GET /api/admin/ai/pricing': () => json({ ok: true, pricing: [{ model: 'glm-5.3', provider: 'delify', label: null, isActive: true, promptCostPerMillion: 1, completionCostPerMillion: 2, updatedAt: null }] }),
  'PATCH /api/admin/chatbot/settings': () => json({ ok: true, settings: {} }),
}, override)

describe('pages/admin/chatbot/settings.vue', () => {
  const PAGE = 'pages/admin/chatbot/settings.vue'
  const LOADS = ['GET /api/admin/chatbot/settings', 'GET /api/admin/ai/providers', 'GET /api/admin/ai/pricing']

  it('mount reads the settings, the active providers and the models; the AI overlay wins', async () => {
    const { page, calls } = await open<ChatbotSettingsPage>(PAGE, chatbotServer())
    assert.deepEqual(calls.map(wire), LOADS)
    assert.equal(page.form.providerPolicy, 'delify', 'currentProvider overrides')
    assert.equal(page.form.model, 'glm-5.3', 'currentModel overrides')
    assert.equal(page.form.allowedHosts, 'router.delify.vn')
    assert.equal(page.form.leadCaptureEnabled, false)
    assert.equal(page.metadata.apiKeyMasked, '••••wxyz')
    assert.deepEqual(page.activeProviders.map(p => p.provider), ['delify'])
    assert.deepEqual(page.activeModels.map(m => m.model), ['glm-5.3'])
    assert.equal(page.defaultSystemPrompt, 'Bạn là trợ lý C11.')
    assert.equal(page.systemPromptReplacement, 'Lời dặn riêng.')
    assert.equal(page.errorMessage, '')
  })

  it('no AI permission: the provider and model lists come back empty, the page still loads', async () => {
    const { page } = await open<ChatbotSettingsPage>(PAGE, chatbotServer(call => call.url.pathname.startsWith('/api/admin/ai/') ? h3Error(403, 'Forbidden: Insufficient permissions') : undefined))
    assert.deepEqual(page.activeProviders, [])
    assert.deepEqual(page.activeModels, [])
    assert.equal(page.errorMessage, '')
    assert.equal(page.form.model, 'glm-5.3')
  })

  it('a failed settings load shows the server\'s sentence; a dropped one the page\'s own', async () => {
    let answer: () => Response | Error = () => h3Error(403, 'Bạn không có quyền xem cài đặt chatbot.')
    const { page } = await open<ChatbotSettingsPage>(PAGE, chatbotServer(call => wire(call) === 'GET /api/admin/chatbot/settings' ? answer() : undefined))
    assert.equal(page.errorMessage, 'Bạn không có quyền xem cài đặt chatbot.')
    answer = dropped
    await page.load()
    assert.equal(page.errorMessage, 'Không thể hoàn tất thao tác. Vui lòng kiểm tra lại.')
  })

  it('saving patches the editable fields (never the destination), then reloads', async () => {
    const { page, calls, lastToast } = await open<ChatbotSettingsPage>(PAGE, chatbotServer())
    const before = calls.length
    await page.save()
    assert.deepEqual(calls.slice(before).map(wire), ['PATCH /api/admin/chatbot/settings', ...LOADS])
    const body = calls[before]!.body as Record<string, unknown>
    assert.equal(body.provider, 'delify')
    assert.equal(body.providerPolicy, 'openai-compatible')
    assert.equal(body.model, 'glm-5.3')
    assert.equal(body.systemPrompt, 'Lời dặn riêng.')
    assert.ok(!('baseUrl' in body) && !('allowedHosts' in body), 'the destination is not sent')
    assert.equal(lastToast('success'), 'Đã lưu cấu hình chatbot.')
  })

  it('a refused save shows the server\'s sentence', async () => {
    const { page } = await open<ChatbotSettingsPage>(PAGE, chatbotServer(call => call.method === 'PATCH' ? h3Error(400, 'Số lượt tối đa phải từ 1 đến 100.') : undefined))
    await page.save()
    assert.equal(page.errorMessage, 'Số lượt tối đa phải từ 1 đến 100.')
  })
})

// ─── The source no longer casts, and still counts as fetching ────────────────

describe('batch A: no `$fetch` left, still seen by the error/skeleton gates', () => {
  for (const file of [
    'pages/admin/settings/social-links.vue', 'pages/admin/settings/general.vue', 'pages/admin/settings/backup.vue',
    'pages/admin/settings/media-portal.vue', 'pages/admin/media-portal/[id].vue', 'pages/admin/media-portal/categories.vue',
    'pages/admin/chatbot/settings.vue', 'composables/useBackupSettings.ts',
  ]) {
    it(file, () => {
      const source = readFileSync(new URL(`../app/${file}`, import.meta.url), 'utf8')
      const script = file.endsWith('.vue') ? parse(source).descriptor.scriptSetup?.content ?? '' : source
      // Comments may still say `$fetch` (backup.vue explains why the upload uses XHR); code may not.
      const code = script.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      assert.ok(!/\$fetch\b/.test(code), `${file} still calls $fetch`)
      assert.ok(ADMIN_FETCH_CALL.test(script), `${file} no longer counts as fetching for the error/skeleton gates`)
    })
  }
})
