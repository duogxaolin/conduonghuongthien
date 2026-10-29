/**
 * `/admin/ai/moderation` — behaviour, through the page's own buttons.
 *
 * Wave 3 task 4.1 (split the 1155-line page along its tab seams) and 7.1 (its 12
 * `($fetch as …)` casts become `adminFetch<T>()`, the review queue moves to
 * `useAdminList`). These tests were written BEFORE the split and run the same way on
 * both versions: the REAL page — `<script setup>`, template, and after the split the
 * real panel components it imports — mounted on a minimal DOM (tests/_sfc-mount.ts),
 * with REAL ofetch over a fake network (the shape of tests/admin-fetch-rollout.test.ts).
 * Every action is a click on the rendered control, so a split that forgets to wire an
 * emit fails here exactly as a dead button would.
 *
 * Pinned (green on the base and after the split):
 *   - the mount loads settings, page 1 of the pending queue (`perPage=20`), the rules and
 *     the worker status — same requests, same order, same query string;
 *   - a failed load shows the SERVER's sentence in the `role="alert"` branch (ofetch's
 *     `[GET] "…"` line never), a dropped connection the page's fallback, and "Thử lại"
 *     re-runs the four loads; 401/403 are not branched on (same sentence, nothing more);
 *   - each tab's actions send the same method, path and body, toast the same text, and
 *     reload what they reloaded before — settings save, rules add/toggle/delete, queue
 *     approve/delete/ban-IP, filter and paging, worker refresh/restart/rescan (with the
 *     3-second progress poll) and the website restart;
 *   - the "chờ đối soát" badge is the server's total for `pending`, and falls back to
 *     the worker's count while another filter's total is loaded.
 *
 * Fixed by the split (RED on the base e1469a9 — each test says why):
 *   - an older queue answer landing last no longer replaces the newer filter's rows;
 *   - a failed filter or page change is shown — IN THE QUEUE TAB, with a "Thử lại" that
 *     re-reads the queue only (it was an unhandled rejection: the old rows stayed under
 *     the new filter and nothing said so). The page alert, whose "Thử lại" re-runs the
 *     whole page load over unsaved settings edits, is for the page load only;
 *   - a resolve, settings save, rule add or rule delete that succeeded is no longer
 *     followed by an error toast when only the re-read after it failed: that failure
 *     shows on its own tab;
 *   - leaving the page cancels the 4-second redirect after a website restart;
 *   - resolving the last row of the last page no longer shows the false "Không có mục
 *     nào … đang hoạt động tốt" empty state;
 *   - the skeleton's grey blocks carry `aria-hidden="true"` (the skeleton guard matched
 *     icons in other tabs, never these blocks).
 */
import assert from 'node:assert/strict'
import { describe, it, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createFetch } from 'ofetch'
import * as Vue from 'vue'

import { adminFetch } from '../app/composables/adminFetch.ts'
import { useAdminList } from '../app/composables/useAdminList.ts'
import { errorMessage, errorStatus } from '../app/utils/errorMessage.ts'
import { rescanAiNotice, rescanFinishedToast, rescanSummaryText } from '../app/utils/moderation-rescan-summary.ts'
import { ADMIN_FETCH_CALL } from './_admin-fetch-call.ts'
import {
  MODERATION_PANELS_DIR, moderationPageFiles, moderationPageSource, moderationPageSourceWith, moderationPanelFiles,
  readAppFile, readModerationPart,
} from './_moderation-page-parts.ts'
import { byText, click, findAll, fire, input, mountSfc, textOf, type MiniElement, type MountedSfc } from './_sfc-mount.ts'
import { COLOR_TOKENS } from '../shared/color-tokens.ts'

/** The active status filter is brand green — by token name, or by the token's hex value in an arbitrary class. */
const ACTIVE_FILTER = new RegExp(`bg-(?:brand-700|\\[${COLOR_TOKENS['brand-700']}\\]) text-white`, 'i')

const PAGE = fileURLToPath(new URL('../app/pages/admin/ai/moderation.vue', import.meta.url))

// ─── Fake network under real ofetch ──────────────────────────────────────────

type NetCall = {
  method: string
  url: URL
  body: unknown
  signal: AbortSignal | undefined
  respond: (response: Response) => void
}
type Responder = (call: NetCall) => Response | Error | undefined

function installNetwork(responder: Responder, { ignoreAbort = false } = {}): NetCall[] {
  const calls: NetCall[] = []
  const fetchImpl = (input: RequestInfo | URL, init: RequestInit = {}) => new Promise<Response>((resolve, reject) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const call: NetCall = {
      method: (init.method ?? 'GET').toUpperCase(),
      url: new URL(raw, 'http://admin.test'),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
      signal: init.signal ?? undefined,
      respond: resolve,
    }
    if (!ignoreAbort) init.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')))
    calls.push(call)
    const answer = responder(call)
    if (answer instanceof Error) reject(answer)
    else if (answer) resolve(answer)
  })
  ;(globalThis as Record<string, unknown>).$fetch = createFetch({ fetch: fetchImpl as typeof fetch })
  return calls
}

const STATUS_TEXT: Record<number, string> = { 200: 'OK', 202: 'Accepted', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict' }
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, statusText: STATUS_TEXT[status] ?? '', headers: { 'content-type': 'application/json' } })
/** What `throw createError({ statusCode, statusMessage })` sends from a Nitro handler. */
const h3Error = (statusCode: number, statusMessage: string) => json({ statusCode, statusMessage, message: statusMessage }, statusCode)
/** A connection that never got an answer. */
const dropped = () => new TypeError('fetch failed')

const wire = (call: NetCall) => `${call.method} ${call.url.pathname}${call.url.search}`
const API = '/api/admin/ai/moderation'

/** Let promise chains, ofetch and Vue's scheduler run (setImmediate: unaffected by mocked setTimeout). */
const settle = async () => {
  for (let i = 0; i < 10; i++) {
    await Vue.nextTick()
    await new Promise(resolve => setImmediate(resolve))
  }
}

// ─── The moderation API, as server/api/admin/ai/moderation/** answers it ─────

type QueueRow = Record<string, unknown> & { id: number, status: string, authorIp: string | null }

const queueRow = (id: number, status: string, overrides: Partial<QueueRow> = {}): QueueRow => ({
  id,
  targetType: 'comment',
  targetId: 1000 + id,
  authorName: `Bạn đọc ${id}`,
  authorIp: `203.0.113.${id}`,
  contextTitle: null,
  contextUrl: null,
  sessionId: null,
  contentSnippet: `Nội dung vi phạm số ${id}`,
  flaggedReason: 'Khớp từ khóa chống phá',
  matchedRules: ['phản động'],
  severity: 'critical',
  status,
  reviewedBy: null,
  reviewedAt: null,
  createdAt: '2026-10-20T02:00:00.000Z',
  isIpBanned: false,
  ...overrides,
})

const PENDING_FIRST_ROWS: Record<number, Partial<QueueRow>> = {
  1: { contextTitle: 'Bài viết: Hướng nghiệp sau mãn hạn', contextUrl: '/news/huong-nghiep' },
  2: { targetType: 'chat', sessionId: 'abcdef1234567890', contextTitle: 'Phiên chat trợ lý', severity: 'high' },
  3: { targetType: 'livestream_chat', isIpBanned: true, severity: 'medium' },
  4: { targetType: 'article', authorName: null, authorIp: null, severity: 'high' },
}

const RULES = [
  { id: 1, category: 'hostile_forces', ruleType: 'keyword', pattern: 'phản động', action: 'auto_hide', severity: 'critical', isEnabled: true, createdBy: 1, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: null },
  { id: 2, category: 'spam_fraud', ruleType: 'keyword', pattern: 'cờ bạc', action: 'flag_only', severity: 'high', isEnabled: false, createdBy: 1, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: null },
  { id: 3, category: 'legacy_group', ruleType: 'pattern', pattern: 'xyz', action: 'auto_hide', severity: 'medium', isEnabled: true, createdBy: null, createdAt: null, updatedAt: null },
]

const RESCAN_LIMITS = { batchSize: 100, maxComments: 1000, maxMessages: 5000 }
const rescanStatus = (overrides: Record<string, unknown> = {}) => ({
  state: 'idle', startedAt: null, finishedAt: null, startedBy: null, progress: null, summary: null, error: null, stopReason: null, limits: RESCAN_LIMITS, ...overrides,
})
const SUMMARY = {
  scannedComments: 40, hiddenComments: 3, failedComments: 0, scannedMessages: 9, deletedMessages: 1, failedMessages: 0,
  totalComments: 40, totalMessages: 9, truncated: false, nextCursor: { commentsBeforeId: null, messagesBeforeId: null }, aiUnavailable: false,
}

const HOLD = Symbol('hold')

function moderationServer() {
  const state = {
    queue: {
      pending: Array.from({ length: 25 }, (_, i) => queueRow(i + 1, 'pending', PENDING_FIRST_ROWS[i + 1])),
      approved: [queueRow(31, 'approved'), queueRow(32, 'approved')],
      rejected: [queueRow(41, 'rejected')],
      banned: [queueRow(51, 'banned', { isIpBanned: true })],
    } as Record<string, QueueRow[]>,
    rules: RULES.map(rule => ({ ...rule })),
    worker: {
      status: 'active', startedAt: '2026-10-25T01:00:00.000Z', uptimeSeconds: 3725, totalScanned: 120, blockedInstant: 7, blockedAi: 3,
      allowedCount: 110, errorCount: 0, lastScannedAt: '2026-10-25T02:00:00.000Z', lastError: null, lastErrorAt: null, lastAiLatencyMs: 850,
      // Deliberately not the queue's pending total (25): shows which number the badge uses.
      pendingQueueCount: 99, cachedRulesCount: 3, aiServiceActive: true, aiProvider: 'delify', aiModel: 'delify-5.5',
      memoryUsageMb: { heapUsed: 50, heapTotal: 64, rss: 120, heapLimit: 2048, heapUsedPercent: 2.4 },
    } as Record<string, unknown>,
    rescan: rescanStatus() as Record<string, unknown>,
    /** Per-test answers, tried first. `HOLD` leaves the request out for the test to answer. */
    override: (() => undefined) as (call: NetCall) => Response | Error | typeof HOLD | undefined,
  }

  const respond: Responder = (call) => {
    const answer = state.override(call)
    if (answer === HOLD) return undefined
    if (answer) return answer
    const route = `${call.method} ${call.url.pathname}`
    const query = call.url.searchParams
    if (route === `GET ${API}/settings`) {
      return json({
        ok: true,
        settings: { enabled: true, mode: 'ai', provider: 'delify', model: 'delify-5.5', systemPrompt: 'Prompt đang dùng', defaultSystemPrompt: 'Prompt mặc định C11' },
        activeProviders: [{ id: 1, provider: 'delify', label: 'Delify Router', isActive: true }, { id: 2, provider: 'openai', label: 'OpenAI', isActive: true }],
        activeModels: [
          { model: 'delify-5.5', provider: 'delify', label: 'Delify 5.5', isActive: true, promptCostPerMillion: '1.0000', completionCostPerMillion: '4.0000', updatedAt: null },
          { model: 'delify-flash', provider: 'delify', label: null, isActive: true, promptCostPerMillion: '0.2000', completionCostPerMillion: '0.8000', updatedAt: null },
        ],
      })
    }
    if (route === `GET ${API}/queue`) {
      const status = query.get('status') ?? 'pending'
      const page = Number(query.get('page') ?? 1)
      const perPage = Number(query.get('perPage') ?? 20)
      const rows = status === 'all' ? Object.values(state.queue).flat() : state.queue[status] ?? []
      const items = rows.slice((page - 1) * perPage, page * perPage)
      // Like the real handler: the requested page is echoed, never clamped.
      return json({ ok: true, count: items.length, items, page, perPage, total: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / perPage)) })
    }
    if (route === `GET ${API}/rules`) return json({ ok: true, count: state.rules.length, rules: state.rules })
    if (route === `GET ${API}/worker-status`) return json({ ok: true, rescan: state.rescan, worker: state.worker })
    if (route === `PUT ${API}/settings`) return json({ ok: true })
    if (route === `POST ${API}/rules`) return json({ ok: true, id: 9 })
    if (/^PUT .*\/rules\/\d+$/.test(route)) return json({ ok: true })
    if (/^DELETE .*\/rules\/\d+$/.test(route)) return json({ ok: true })
    const resolve = /^POST .*\/queue\/(\d+)\/resolve$/.exec(route)
    if (resolve) {
      const id = Number(resolve[1])
      const action = (call.body as { action: string }).action
      const to = action === 'approve' ? 'approved' : action === 'ban_ip' ? 'banned' : 'rejected'
      for (const [status, rows] of Object.entries(state.queue)) {
        const at = rows.findIndex(row => row.id === id)
        if (at >= 0) state.queue[to]!.unshift({ ...rows.splice(at, 1)[0]!, status: to })
        if (at >= 0 && status === to) break
      }
      return json({ ok: true, action, id })
    }
    if (route === `POST ${API}/restart-worker`) return json({ ok: true, message: 'Đã khởi động lại Moderation Worker và làm mới bộ đệm quy tắc thành công.' })
    if (route === `POST ${API}/rescan-all`) {
      state.rescan = rescanStatus({ state: 'running', startedAt: '2026-10-25T03:00:00.000Z', startedBy: 1 })
      return json({ ok: true, started: true, rescan: state.rescan, message: 'Đã bắt đầu quét lại nội dung ở nền. Tiến độ cập nhật trên trang này.' }, 202)
    }
    if (route === `POST ${API}/restart-server`) return json({ ok: true, message: 'Máy chủ website đang được khởi động lại. Hệ thống sẽ sẵn sàng sau 3-5 giây.' })
    throw new Error(`unexpected request ${wire(call)}`)
  }
  return { state, respond }
}

// ─── Mounting the page ───────────────────────────────────────────────────────

type Toast = { type: string, message: string }
type ConfirmRequest = { title?: string, message?: string, confirmText?: string, tone?: string }

async function mountPage(server = moderationServer(), { ignoreAbort = false } = {}) {
  const calls = installNetwork(server.respond, { ignoreAbort })
  const toasts: Toast[] = []
  const confirms: ConfirmRequest[] = []
  const answers = { confirm: true }
  const toast = Object.fromEntries(['success', 'error', 'warning', 'info'].map(type =>
    [type, (message: string) => { toasts.push({ type, message }) }]))
  const page = await mountSfc(PAGE, {
    auto: {
      definePageMeta: () => {},
      useToast: () => toast,
      useConfirm: () => ({ confirm: async (options: ConfirmRequest) => { confirms.push(options); return answers.confirm } }),
      // Nuxt auto-imports from app/utils and app/composables — the real ones.
      errorMessage,
      errorStatus,
      adminFetch,
      useAdminList,
    },
  })
  return { page, calls, toasts, confirms, answers, server }
}

async function openPage(server = moderationServer(), options?: { ignoreAbort?: boolean }) {
  const opened = await mountPage(server, options)
  await settle()
  return opened
}

const TAB_LABELS = {
  settings: '⚙️ Cài đặt Kiểm duyệt AI',
  queue: '📥 Sổ đối soát nội dung bị ẩn',
  rules: '📋 Quy tắc & Từ khóa an ninh',
  worker: '⚡ Trạng thái Worker & Hệ thống',
} as const

const nav = (page: MountedSfc) => findAll(page.root, el => el.tag === 'nav')[0]!
const tabButton = (page: MountedSfc, tab: keyof typeof TAB_LABELS) => byText(nav(page), 'button', TAB_LABELS[tab])
async function openTab(page: MountedSfc, tab: keyof typeof TAB_LABELS) {
  await click(tabButton(page, tab))
  await settle()
}
/** The red count on the queue tab, or null when hidden. */
const pendingBadge = (page: MountedSfc) => {
  const badge = findAll(tabButton(page, 'queue'), el => String(el.props.class).includes('bg-red-500'))[0]
  return badge ? textOf(badge) : null
}
/** Every `role="alert"` on screen. */
const alerts = (page: MountedSfc) => findAll(page.root, el => el.props.role === 'alert')
/** The page-load alert: a direct child of the page, above the tab strip. */
const pageAlert = (page: MountedSfc) => {
  const shell = page.root.children.find((node): node is MiniElement => node.kind === 'element')
  return shell?.children.find((node): node is MiniElement => node.kind === 'element' && node.props.role === 'alert') ?? null
}
/** An alert inside the open tab (a re-read that failed after the page load). */
const tabAlert = (page: MountedSfc) => alerts(page).find(el => el !== pageAlert(page)) ?? null
/** Any alert at all (the first one), for "nothing failed" and "failed somewhere" checks. */
const alertBox = (page: MountedSfc) => alerts(page)[0] ?? null
const skeleton = (page: MountedSfc) => findAll(page.root, el => el.props.role === 'status' && el.props['aria-busy'] === 'true')[0] ?? null
const button = (from: MiniElement, text: string) => byText(from, 'button', text)
const tableRows = (page: MountedSfc) => findAll(page.root, el => el.tag === 'tbody').flatMap(body => body.children.filter((row): row is MiniElement => row.kind === 'element'))
const queueRowOf = (page: MountedSfc, id: number) => {
  const row = tableRows(page).find(tr => textOf(tr).includes(`Nội dung vi phạm số ${id}`))
  if (!row) throw new Error(`queue row ${id} is not on screen`)
  return row
}
const shownQueueIds = (page: MountedSfc) =>
  tableRows(page).map(tr => Number(/Nội dung vi phạm số (\d+)/.exec(textOf(tr))?.[1])).filter(Boolean)
const pagination = (page: MountedSfc) => findAll(page.root, el => el.tag === 'AdminPagination')[0] ?? null
const lastToast = (toasts: Toast[], type: string) => toasts.filter(t => t.type === type).at(-1)?.message
/** Submit a form the way the browser does (its listener is `@submit.prevent`). */
const submit = (form: MiniElement) => fire(form, 'submit')
/** The pager emits `update:page`; `<AdminPagination>` itself is not under test here. */
const goToPage = (pager: MiniElement, value: number) => fire(pager, 'update:page', value)
const sentFrom = (calls: NetCall[], from: number) => calls.slice(from).map(call => (call.body === undefined ? wire(call) : { wire: wire(call), body: call.body }))
const MOUNT_REQUESTS = [`GET ${API}/settings`, `GET ${API}/queue?status=pending&page=1&perPage=20`, `GET ${API}/rules`, `GET ${API}/worker-status`]
/** ofetch's own line — `[GET] "/api/…": 403 Forbidden` — must never reach a person. */
const OFETCH_LINE = /\[(GET|POST|PUT|DELETE)\]|<no response>|fetch failed/

function assertOnlyServerSentences(toasts: Toast[], page: MountedSfc) {
  for (const t of toasts) assert.doesNotMatch(t.message, OFETCH_LINE, `toast "${t.message}"`)
  for (const alert of alerts(page)) assert.doesNotMatch(textOf(alert), OFETCH_LINE)
}

/** All four tabs are still offered and the open tab's content is on screen (not hidden by the page alert). */
function assertTabsStillUsable(page: MountedSfc) {
  assert.equal(pageAlert(page), null, 'a failure after the page load must not raise the page alert (it hides every tab)')
  for (const tab of Object.keys(TAB_LABELS) as Array<keyof typeof TAB_LABELS>) assert.ok(tabButton(page, tab))
}

// ─── Loading, error and retry ────────────────────────────────────────────────

describe('moderation page — loading', () => {
  it('shows the skeleton, then loads settings, page 1 of the pending queue, the rules and the worker status', async () => {
    const { page, calls } = await mountPage()
    assert.ok(skeleton(page), 'role="status" aria-busy skeleton while loading')
    assert.equal(findAll(page.root, el => el.tag === 'form').length, 0)
    await settle()

    assert.deepEqual(calls.map(wire), MOUNT_REQUESTS)
    assert.equal(skeleton(page), null)
    assert.equal(alertBox(page), null)
    assert.deepEqual(page.errors, [])
    // Settings tab first, filled from the server.
    const form = findAll(page.root, el => el.tag === 'form')[0]!
    assert.equal(findAll(form, el => el.tag === 'input' && el.props.type === 'checkbox')[0]!.model?.value, true)
    assert.equal(findAll(form, el => el.tag === 'select')[0]!.model?.value, 'delify')
    assert.equal(findAll(form, el => el.tag === 'textarea')[0]!.model?.value, 'Prompt đang dùng')
    // The tab strip: the rule count, and the badge = the SERVER's pending total (25 rows
    // over two pages — not the 20 on screen, and not the worker's 99).
    assert.match(textOf(tabButton(page, 'rules')), /\(3\)/)
    assert.equal(pendingBadge(page), '25')
  })

  it('the skeleton\'s grey blocks are hidden from screen readers; its sr-only line says what is loading (blocks: RED on the base)', async () => {
    const { page } = await mountPage()
    const busy = skeleton(page)!
    const blocks = findAll(busy, el => String(el.props.class).includes('animate-pulse'))
    assert.equal(blocks.length, 3)
    // tests/skeleton-loading-ui.test.ts only looks for `aria-hidden="true"` ANYWHERE in the
    // template: on the base it matched icons in other tabs, never these blocks.
    for (const block of blocks) assert.equal(block.props['aria-hidden'], 'true')
    assert.equal(textOf(findAll(busy, el => String(el.props.class).includes('sr-only'))[0]!), 'Đang tải dữ liệu kiểm duyệt an ninh')
    await settle()
  })

  it('a failed load shows the server\'s sentence in the alert, hides the tabs, and "Thử lại" re-runs the four loads', async () => {
    const server = moderationServer()
    let failing = true
    server.state.override = call => (failing && call.url.pathname === `${API}/settings` ? h3Error(400, 'Cấu hình kiểm duyệt chưa được khởi tạo.') : undefined)
    const { page, calls, toasts } = await openPage(server)

    const alert = pageAlert(page)!
    assert.match(textOf(alert), /Lỗi: Cấu hình kiểm duyệt chưa được khởi tạo\./)
    assert.equal(findAll(page.root, el => el.tag === 'form').length, 0, 'no tab content under a failed load')
    assertOnlyServerSentences(toasts, page)

    failing = false
    const from = calls.length
    await click(button(alert, 'Thử lại'))
    await settle()
    assert.deepEqual(sentFrom(calls, from), MOUNT_REQUESTS)
    assert.equal(alertBox(page), null)
    assert.equal(findAll(page.root, el => el.tag === 'form').length, 1)
  })

  it('a dropped connection shows the page\'s own fallback, never ofetch\'s line', async () => {
    const server = moderationServer()
    server.state.override = call => (call.url.pathname === `${API}/rules` ? dropped() : undefined)
    const { page, toasts } = await openPage(server)
    assert.equal(textOf(pageAlert(page)!), 'Lỗi: Không thể tải cấu hình kiểm duyệt an ninh. Thử lại')
    assertOnlyServerSentences(toasts, page)
  })

  it('the QUEUE failing on the PAGE load lands in the page alert (tabs hidden), its "Thử lại" re-runs all four', async () => {
    const server = moderationServer()
    let answer: () => Response | Error = () => h3Error(400, 'Bộ lọc trạng thái không hợp lệ.')
    server.state.override = call => (call.url.pathname === `${API}/queue` ? answer() : undefined)
    const { page, calls, toasts } = await openPage(server)
    assert.match(textOf(pageAlert(page)!), /Lỗi: Bộ lọc trạng thái không hợp lệ\./)
    assert.equal(alerts(page).length, 1, 'one alert: the page\'s')
    assert.equal(findAll(page.root, el => el.tag === 'form').length, 0, 'no tab content under a failed page load')

    answer = () => h3Error(400, 'Trang hàng đợi không hợp lệ.')
    const from = calls.length
    await click(button(pageAlert(page)!, 'Thử lại'))
    await settle()
    assert.deepEqual(sentFrom(calls, from), MOUNT_REQUESTS)
    assert.match(textOf(pageAlert(page)!), /Lỗi: Trang hàng đợi không hợp lệ\./)

    // A dropped connection (ofetch retries a GET once on its own): the page's fallback.
    answer = dropped
    await click(button(pageAlert(page)!, 'Thử lại'))
    await settle()
    assert.equal(textOf(pageAlert(page)!), 'Lỗi: Không thể tải cấu hình kiểm duyệt an ninh. Thử lại')
    assertOnlyServerSentences(toasts, page)
  })

  for (const [status, sentence] of [[401, 'Unauthorized: Invalid token'], [403, 'Forbidden: Insufficient permissions']] as const) {
    it(`${status}: the server's sentence in the same alert, and nothing more is sent (no status branch)`, async () => {
      const server = moderationServer()
      server.state.override = call => (call.method === 'GET' && call.url.pathname !== `${API}/worker-status` ? h3Error(status, sentence) : undefined)
      const { page, calls } = await openPage(server)
      assert.match(textOf(pageAlert(page)!), new RegExp(`Lỗi: ${sentence}`))
      assert.deepEqual(calls.map(wire), MOUNT_REQUESTS)
    })
  }

  it('a failed worker-status read does not block the page: no alert, and the badge still shows the pending total', async () => {
    const server = moderationServer()
    server.state.override = call => (call.url.pathname === `${API}/worker-status` ? h3Error(400, 'Không đọc được trạng thái worker.') : undefined)
    const { page } = await openPage(server)
    assert.equal(alertBox(page), null)
    assert.equal(pendingBadge(page), '25')
    await openTab(page, 'worker')
    assert.match(textOf(page.root), /Moderation Worker: Có lỗi phát sinh/)
    assert.match(textOf(page.root), /DEGRADED/)
  })

  it('"Làm mới" in the tab strip reloads all four', async () => {
    const { page, calls } = await openPage()
    const from = calls.length
    await click(button(nav(page), 'Làm mới'))
    await settle()
    assert.deepEqual(sentFrom(calls, from), MOUNT_REQUESTS)
  })
})

// ─── Settings tab ────────────────────────────────────────────────────────────

describe('moderation page — settings tab', () => {
  const field = (page: MountedSfc, tag: string, nth = 0) => findAll(page.root, el => el.tag === tag)[nth]!
  const radio = (page: MountedSfc, value: string) => findAll(page.root, el => el.tag === 'input' && el.props.type === 'radio' && el.props.value === value)[0]!

  it('edits go out as one PUT, "Lưu" is disabled while it is in flight, then the settings are re-read', async () => {
    const server = moderationServer()
    let held: NetCall | null = null
    server.state.override = (call) => {
      if (call.method === 'PUT') { held = call; return HOLD }
      return undefined
    }
    const { page, calls, toasts } = await openPage(server)

    // Provider list, and the models of the selected provider only.
    const provider = field(page, 'select', 0)
    assert.deepEqual(findAll(provider, el => el.tag === 'option').map(textOf), ['Delify Router (delify)', 'OpenAI (openai)'])
    assert.deepEqual(findAll(field(page, 'select', 1), el => el.tag === 'option').map(o => o.props.value), ['delify-5.5', 'delify-flash'])

    await input(field(page, 'select', 1), 'delify-flash')
    await input(field(page, 'textarea'), 'Prompt mới')
    await settle()
    assert.match(textOf(page.root), /10 ký tự/)
    // A provider without priced models: the model becomes a free-text field.
    await input(provider, 'openai')
    await settle()
    assert.equal(findAll(page.root, el => el.tag === 'select').length, 1)
    const modelText = findAll(page.root, el => el.tag === 'input' && el.props.type === 'text')[0]!
    await input(modelText, 'gpt-x')
    await input(findAll(page.root, el => el.tag === 'input' && el.props.type === 'checkbox')[0]!, false)
    await settle()

    const from = calls.length
    const save = button(page.root, 'Lưu cấu hình kiểm duyệt')
    // Not awaited: the handler is waiting on the held PUT.
    const saving = submit(findAll(page.root, el => el.tag === 'form')[0]!)
    await settle()
    assert.equal(textOf(save), 'Đang lưu...')
    assert.equal(save.props.disabled, true)
    assert.deepEqual(sentFrom(calls, from), [{
      wire: `PUT ${API}/settings`,
      body: { enabled: false, mode: 'ai', provider: 'openai', model: 'gpt-x', systemPrompt: 'Prompt mới' },
    }])

    ;(held as NetCall | null)!.respond(json({ ok: true }))
    await saving
    await settle()
    assert.equal(lastToast(toasts, 'success'), 'Đã lưu cấu hình kiểm duyệt an ninh!')
    assert.deepEqual(sentFrom(calls, from + 1), [`GET ${API}/settings`])
    assert.equal(button(page.root, 'Lưu cấu hình kiểm duyệt').props.disabled, false)
  })

  // Only what the PAGE sends. The server does not honour it today: settings.put.ts uses
  // `enabled` whenever it is a boolean (always sent), and settings.get.ts derives both
  // `enabled` and `mode` from one `isActive` column — keyword-only with the box ticked is
  // saved as AI. Reported, not fixed here: it needs a product/schema decision.
  it('"Chỉ dùng bộ lọc từ khóa" hides the AI section and is what gets sent', async () => {
    const { page, calls } = await openPage()
    await input(radio(page, 'keyword_only'), 'keyword_only')
    await settle()
    assert.equal(findAll(page.root, el => el.tag === 'textarea').length, 0, 'no AI prompt section in keyword mode')
    const from = calls.length
    await submit(findAll(page.root, el => el.tag === 'form')[0]!)
    await settle()
    assert.deepEqual((calls[from]!.body as { mode: string }).mode, 'keyword_only')
  })

  it('"Khôi phục prompt kiểm duyệt mặc định C11" puts the default prompt back in the editor', async () => {
    const { page, calls } = await openPage()
    const before = calls.length
    await click(button(page.root, 'Khôi phục prompt kiểm duyệt mặc định C11'))
    await settle()
    assert.equal(field(page, 'textarea').model?.value, 'Prompt mặc định C11')
    assert.equal(calls.length, before, 'restoring is local until "Lưu"')
  })

  it('a failed save toasts the server\'s sentence (a dropped connection: the fallback) and re-enables "Lưu"', async () => {
    const server = moderationServer()
    let answer: () => Response | Error = () => h3Error(400, 'Dữ liệu không hợp lệ.')
    server.state.override = call => (call.method === 'PUT' ? answer() : undefined)
    const { page, calls, toasts } = await openPage(server)
    const from = calls.length
    await submit(findAll(page.root, el => el.tag === 'form')[0]!)
    await settle()
    assert.equal(lastToast(toasts, 'error'), 'Dữ liệu không hợp lệ.')
    assert.deepEqual(sentFrom(calls, from).map(c => (typeof c === 'string' ? c : c.wire)), [`PUT ${API}/settings`], 'no re-read after a failed save')
    assert.equal(button(page.root, 'Lưu cấu hình kiểm duyệt').props.disabled, false)

    answer = dropped
    await submit(findAll(page.root, el => el.tag === 'form')[0]!)
    await settle()
    assert.equal(lastToast(toasts, 'error'), 'Không thể lưu cấu hình.')
    assertOnlyServerSentences(toasts, page)
  })

  it('a save that succeeded keeps its success toast when only the re-read fails: the failure shows on the settings tab, the fields keep what was saved, "Thử lại" re-reads the settings only (base: an error toast under the success)', async () => {
    const server = moderationServer()
    const { page, calls, toasts } = await openPage(server)
    let failing = true
    server.state.override = call => (failing && call.method === 'GET' && call.url.pathname === `${API}/settings` ? h3Error(403, 'Forbidden: Insufficient permissions') : undefined)
    await input(field(page, 'textarea'), 'Prompt mới')
    await submit(findAll(page.root, el => el.tag === 'form')[0]!)
    await settle()

    assert.deepEqual(toasts, [{ type: 'success', message: 'Đã lưu cấu hình kiểm duyệt an ninh!' }])
    assert.match(textOf(tabAlert(page)!), /Lỗi: Forbidden: Insufficient permissions/)
    assertTabsStillUsable(page)
    assert.equal(field(page, 'textarea').model?.value, 'Prompt mới', 'the fields keep what was just saved')
    assert.equal(button(page.root, 'Lưu cấu hình kiểm duyệt').props.disabled, false)

    failing = false
    const from = calls.length
    await click(button(tabAlert(page)!, 'Thử lại'))
    await settle()
    assert.deepEqual(sentFrom(calls, from), [`GET ${API}/settings`])
    assert.equal(alertBox(page), null)
  })
})

// ─── Queue tab ───────────────────────────────────────────────────────────────

describe('moderation page — review queue tab', () => {
  it('shows page 1 of the pending queue with the pager, each row with its own actions', async () => {
    const { page } = await openPage()
    await openTab(page, 'queue')
    assert.deepEqual(shownQueueIds(page), Array.from({ length: 20 }, (_, i) => i + 1))
    const pager = pagination(page)!
    assert.deepEqual([pager.props.page, pager.props['total-pages'], pager.props.total], [1, 2, 25])

    const first = queueRowOf(page, 1)
    assert.ok(findAll(first, el => el.tag === 'a' && el.props.href === '/news/huong-nghiep' && el.props.target === '_blank').length === 1)
    assert.deepEqual(findAll(first, el => el.tag === 'button').map(textOf), ['Bỏ ẩn', 'Xóa', 'Cấm IP'])
    const chat = queueRowOf(page, 2)
    const session = findAll(chat, el => el.tag === 'nuxt-link')[0]!
    assert.equal(session.props.to, '/admin/chatbot/sessions?search=abcdef1234567890')
    assert.match(textOf(session), /Session: abcdef12\.\.\./)
    // An IP already banned: the ban button says so and cannot be pressed.
    const banned = button(queueRowOf(page, 3), 'Đã cấm IP')
    assert.equal(banned.props.disabled, true)
    // No IP, no ban button.
    assert.deepEqual(findAll(queueRowOf(page, 4), el => el.tag === 'button').map(textOf), ['Bỏ ẩn', 'Xóa'])
  })

  for (const [label, action, message, confirmText, tone] of [
    ['Bỏ ẩn', 'approve', 'Xác nhận nội dung này an toàn và hiển thị công khai lại?', 'Duyệt an toàn', 'primary'],
    ['Xóa', 'reject_delete', 'Xác nhận nội dung vi phạm và xóa vĩnh viễn?', 'Xóa vĩnh viễn', 'danger'],
    ['Cấm IP', 'ban_ip', 'Xác nhận xóa nội dung và CẤM vĩnh viễn địa chỉ IP 203.0.113.5?', 'Cấm IP', 'danger'],
  ] as const) {
    it(`"${label}": confirms, POSTs action=${action}, then reloads the same queue page and the worker count`, async () => {
      const { page, calls, toasts, confirms } = await openPage()
      await openTab(page, 'queue')
      const from = calls.length
      await click(button(queueRowOf(page, 5), label))
      await settle()
      assert.deepEqual(confirms.at(-1), { title: 'Xử lý đối soát an ninh', message, confirmText, tone })
      assert.deepEqual(sentFrom(calls, from), [
        { wire: `POST ${API}/queue/5/resolve`, body: { action } },
        `GET ${API}/queue?status=pending&page=1&perPage=20`,
        `GET ${API}/worker-status`,
      ])
      assert.deepEqual(toasts, [{ type: 'success', message: 'Đã xử lý đối soát thành công!' }])
      assert.ok(!shownQueueIds(page).includes(5), 'the resolved row left the pending page')
      assert.equal(pendingBadge(page), '24')
    })
  }

  it('a cancelled confirmation sends nothing', async () => {
    const { page, calls, answers } = await openPage()
    await openTab(page, 'queue')
    answers.confirm = false
    const from = calls.length
    await click(button(queueRowOf(page, 1), 'Xóa'))
    await settle()
    assert.equal(calls.length, from)
  })

  it('a failed resolve toasts the server\'s sentence (dropped: the fallback); only a 409 or 404 — the row on screen is stale — re-reads the queue and the worker count', async () => {
    const server = moderationServer()
    let answer: () => Response | Error = () => h3Error(500, 'Lỗi máy chủ.')
    server.state.override = call => (call.url.pathname.endsWith('/resolve') ? answer() : undefined)
    const { page, calls, toasts } = await openPage(server)
    await openTab(page, 'queue')
    const wires = (from: number) => sentFrom(calls, from).map(c => (typeof c === 'string' ? c : c.wire))
    let from = calls.length
    await click(button(queueRowOf(page, 1), 'Bỏ ẩn'))
    await settle()
    assert.equal(lastToast(toasts, 'error'), 'Lỗi máy chủ.')
    assert.deepEqual(wires(from), [`POST ${API}/queue/1/resolve`])

    // Another officer resolved the row first (server FINDING-R7-1), or it is gone: before, the
    // stale row kept offering a decision already made until a manual reload (R7, as R6 L3).
    for (const [status, sentence] of [[409, 'Mục đối soát vừa được người khác xử lý. Vui lòng tải lại danh sách.'], [404, 'Mục đối soát không tồn tại.']] as const) {
      answer = () => h3Error(status, sentence)
      from = calls.length
      await click(button(queueRowOf(page, 1), 'Bỏ ẩn'))
      await settle()
      assert.equal(lastToast(toasts, 'error'), sentence)
      assert.deepEqual(wires(from), [`POST ${API}/queue/1/resolve`, `GET ${API}/queue?status=pending&page=1&perPage=20`, `GET ${API}/worker-status`], String(status))
      assert.equal(toasts.filter(t => t.type === 'success').length, 0)
    }

    answer = dropped
    from = calls.length
    await click(button(queueRowOf(page, 1), 'Bỏ ẩn'))
    await settle()
    assert.equal(lastToast(toasts, 'error'), 'Không thể xử lý đối soát.')
    assert.deepEqual(wires(from), [`POST ${API}/queue/1/resolve`])
    assertOnlyServerSentences(toasts, page)
  })

  it('a status filter asks for page 1 of that status; the badge keeps the pending total until another total is loaded, then uses the worker\'s', async () => {
    const server = moderationServer()
    let held: NetCall | null = null
    const { page, calls } = await openPage(server)
    await openTab(page, 'queue')
    // Page 2 first, so the filter visibly goes back to page 1.
    await goToPage(pagination(page)!, 2)
    await settle()
    assert.deepEqual(shownQueueIds(page), [21, 22, 23, 24, 25])

    server.state.override = (call) => {
      if (call.url.searchParams.get('status') === 'approved') { held = call; return HOLD }
      return undefined
    }
    const from = calls.length
    await click(button(page.root, 'Đã duyệt an toàn'))
    await settle()
    assert.deepEqual(sentFrom(calls, from), [`GET ${API}/queue?status=approved&page=1&perPage=20`])
    assert.match(String(button(page.root, 'Đã duyệt an toàn').props.class), ACTIVE_FILTER, 'the clicked filter is the active one')
    assert.equal(pendingBadge(page), '25', 'the loaded total is still the pending one')

    held!.respond(json({ ok: true, count: 2, items: server.state.queue.approved, page: 1, perPage: 20, total: 2, totalPages: 1 }))
    await settle()
    assert.deepEqual(shownQueueIds(page), [31, 32])
    assert.equal(pagination(page), null, 'one page: no pager')
    assert.equal(pendingBadge(page), '99', 'another status is loaded: the worker\'s pending count')
  })

  it('the pager asks for the page it was given, and ignores the current page or one out of range', async () => {
    const { page, calls } = await openPage()
    await openTab(page, 'queue')
    const from = calls.length
    for (const p of [1, 0, 3]) await goToPage(pagination(page)!, p)
    await settle()
    assert.equal(calls.length, from)
    await goToPage(pagination(page)!, 2)
    await settle()
    assert.deepEqual(sentFrom(calls, from), [`GET ${API}/queue?status=pending&page=2&perPage=20`])
    assert.equal(pagination(page)!.props.page, 2)
  })

  it('an empty status shows the empty state, not a table', async () => {
    const server = moderationServer()
    server.state.queue.pending = []
    const { page } = await openPage(server)
    await openTab(page, 'queue')
    assert.match(textOf(page.root), /Không có mục nào trong danh sách đối soát\. Hệ thống an ninh đang hoạt động tốt\./)
    assert.equal(tableRows(page).length, 0)
  })
})

// ─── Rules tab ───────────────────────────────────────────────────────────────

describe('moderation page — rules tab', () => {
  const addForm = (page: MountedSfc) => findAll(page.root, el => el.tag === 'form')[0]!
  const patternInput = (page: MountedSfc) => findAll(addForm(page), el => el.tag === 'input')[0]!
  const ruleRow = (page: MountedSfc, pattern: string) => tableRows(page).find(tr => textOf(tr).includes(`"${pattern}"`))!

  it('lists the rules with their labels (an unknown category shows as stored)', async () => {
    const { page } = await openPage()
    await openTab(page, 'rules')
    assert.deepEqual(tableRows(page).map(tr => findAll(tr, el => el.tag === 'td').map(textOf)), [
      ['Thế lực thù địch / Phản động', '"phản động"', 'Tự động ẩn ngay', 'critical', 'Đang bật', 'Xóa'],
      ['Spam / Cờ bạc / Lừa đảo', '"cờ bạc"', 'Chỉ cảnh báo', 'high', 'Đã tắt', 'Xóa'],
      ['legacy_group', '"xyz"', 'Tự động ẩn ngay', 'medium', 'Đang bật', 'Xóa'],
    ])
  })

  it('"Thêm quy tắc" POSTs the form, clears the pattern and re-reads the rules', async () => {
    const { page, calls, toasts } = await openPage()
    await openTab(page, 'rules')
    const [category, action] = findAll(addForm(page), el => el.tag === 'select')
    await input(category!, 'spam_fraud')
    await input(action!, 'flag_only')
    await input(patternInput(page), 'lô đề')
    await settle()
    const from = calls.length
    await submit(addForm(page))
    await settle()
    assert.deepEqual(sentFrom(calls, from), [
      { wire: `POST ${API}/rules`, body: { category: 'spam_fraud', ruleType: 'keyword', pattern: 'lô đề', action: 'flag_only', severity: 'critical' } },
      `GET ${API}/rules`,
    ])
    assert.equal(lastToast(toasts, 'success'), 'Đã thêm quy tắc an ninh mới!')
    assert.equal(patternInput(page).model?.value, '')
    assert.equal(findAll(addForm(page), el => el.tag === 'select')[0]!.model?.value, 'spam_fraud', 'the category stays for the next rule')
  })

  it('a blank pattern is refused before any request', async () => {
    const { page, calls, toasts } = await openPage()
    await openTab(page, 'rules')
    await input(patternInput(page), '   ')
    const from = calls.length
    await submit(addForm(page))
    await settle()
    assert.equal(calls.length, from)
    assert.equal(lastToast(toasts, 'warning'), 'Vui lòng nhập từ khóa hoặc mẫu nhận diện.')
  })

  it('a refused rule toasts the server\'s sentence and keeps what was typed', async () => {
    const server = moderationServer()
    server.state.override = call => (call.method === 'POST' && call.url.pathname === `${API}/rules` ? h3Error(400, 'Từ khóa hoặc mẫu nhận diện phải từ 2 ký tự trở lên.') : undefined)
    const { page, calls, toasts } = await openPage(server)
    await openTab(page, 'rules')
    await input(patternInput(page), 'x')
    const from = calls.length
    await submit(addForm(page))
    await settle()
    assert.equal(lastToast(toasts, 'error'), 'Từ khóa hoặc mẫu nhận diện phải từ 2 ký tự trở lên.')
    assert.equal(patternInput(page).model?.value, 'x')
    assert.equal(calls.length, from + 1, 'no re-read after a refused add')
  })

  it('the on/off button PUTs the opposite state and flips the row in place', async () => {
    const { page, calls, toasts } = await openPage()
    await openTab(page, 'rules')
    const from = calls.length
    await click(button(ruleRow(page, 'phản động'), 'Đang bật'))
    await settle()
    assert.deepEqual(sentFrom(calls, from), [{ wire: `PUT ${API}/rules/1`, body: { isEnabled: false } }])
    assert.equal(lastToast(toasts, 'success'), 'Đã tắt quy tắc.')
    assert.ok(textOf(ruleRow(page, 'phản động')).includes('Đã tắt'))

    await click(button(ruleRow(page, 'cờ bạc'), 'Đã tắt'))
    await settle()
    assert.deepEqual(sentFrom(calls, from + 1), [{ wire: `PUT ${API}/rules/2`, body: { isEnabled: true } }])
    assert.equal(lastToast(toasts, 'success'), 'Đã bật quy tắc.')
  })

  it('a refused toggle toasts the server\'s sentence and leaves the row as it was', async () => {
    const server = moderationServer()
    server.state.override = call => (call.method === 'PUT' ? h3Error(404, 'Quy tắc không tồn tại.') : undefined)
    const { page, toasts } = await openPage(server)
    await openTab(page, 'rules')
    await click(button(ruleRow(page, 'phản động'), 'Đang bật'))
    await settle()
    assert.equal(lastToast(toasts, 'error'), 'Quy tắc không tồn tại.')
    assert.ok(textOf(ruleRow(page, 'phản động')).includes('Đang bật'))
  })

  it('"Xóa" confirms with the pattern, DELETEs and re-reads; cancelled, it sends nothing', async () => {
    const { page, calls, toasts, confirms, answers } = await openPage()
    await openTab(page, 'rules')
    answers.confirm = false
    const from = calls.length
    await click(button(ruleRow(page, 'cờ bạc'), 'Xóa'))
    await settle()
    assert.equal(calls.length, from)

    answers.confirm = true
    await click(button(ruleRow(page, 'cờ bạc'), 'Xóa'))
    await settle()
    assert.deepEqual(confirms.at(-1), { title: 'Xóa quy tắc kiểm duyệt', message: 'Bạn có chắc muốn xóa quy tắc "cờ bạc"?', confirmText: 'Xóa', tone: 'danger' })
    assert.deepEqual(sentFrom(calls, from), [`DELETE ${API}/rules/2`, `GET ${API}/rules`])
    assert.equal(lastToast(toasts, 'success'), 'Đã xóa quy tắc.')
  })

  it('a refused delete toasts the server\'s sentence', async () => {
    const server = moderationServer()
    server.state.override = call => (call.method === 'DELETE' ? h3Error(403, 'Forbidden: Insufficient permissions') : undefined)
    const { page, toasts } = await openPage(server)
    await openTab(page, 'rules')
    await click(button(ruleRow(page, 'xyz'), 'Xóa'))
    await settle()
    assert.equal(lastToast(toasts, 'error'), 'Forbidden: Insufficient permissions')
    assertOnlyServerSentences(toasts, page)
  })

  for (const [what, act, success] of [
    ['an add', async (page: MountedSfc) => { await input(patternInput(page), 'lô đề'); await submit(addForm(page)) }, 'Đã thêm quy tắc an ninh mới!'],
    ['a delete', async (page: MountedSfc) => { await click(button(ruleRow(page, 'xyz'), 'Xóa')) }, 'Đã xóa quy tắc.'],
  ] as const) {
    it(`${what} that succeeded keeps its success toast when only the re-read fails: shown on the rules tab in place of the stale list, "Thử lại" re-reads the rules only (base: an error toast under the success)`, async () => {
      const server = moderationServer()
      const { page, calls, toasts } = await openPage(server)
      await openTab(page, 'rules')
      let failing = true
      server.state.override = call => (failing && call.method === 'GET' && call.url.pathname === `${API}/rules` ? dropped() : undefined)
      await act(page)
      await settle()

      assert.deepEqual(toasts, [{ type: 'success', message: success }])
      assert.equal(textOf(tabAlert(page)!), 'Lỗi: Không thể tải lại danh sách quy tắc. Thử lại')
      assertTabsStillUsable(page)
      assert.equal(tableRows(page).length, 0, 'the stale list is not shown as if it were current')
      assert.equal(findAll(addForm(page), el => el.tag === 'button').length, 1, 'the add form stays usable')

      failing = false
      const from = calls.length
      await click(button(tabAlert(page)!, 'Thử lại'))
      await settle()
      assert.deepEqual(sentFrom(calls, from), [`GET ${API}/rules`])
      assert.equal(alertBox(page), null)
      assert.equal(tableRows(page).length, 3)
    })
  }
})

// ─── Worker tab ──────────────────────────────────────────────────────────────

describe('moderation page — worker tab', () => {
  it('shows the worker\'s numbers; "Cập nhật số liệu" re-reads the worker status only', async () => {
    const { page, calls } = await openPage()
    await openTab(page, 'worker')
    const text = textOf(page.root)
    assert.match(text, /Moderation Worker: Đang hoạt động bình thường\s*HEALTHY/)
    assert.match(text, /Thời gian hoạt động liên tục: 1 giờ 2 phút/)
    assert.match(text, /delify \/ delify-5\.5 \(Đang hoạt động\)/)
    assert.match(text, /50 MB \/ 2048 MB/)
    const from = calls.length
    await click(button(page.root, 'Cập nhật số liệu'))
    await settle()
    assert.deepEqual(sentFrom(calls, from), [`GET ${API}/worker-status`])
  })

  it('"Khởi động lại Worker" confirms, POSTs, toasts the server\'s message and re-reads the status', async () => {
    const { page, calls, toasts, confirms } = await openPage()
    await openTab(page, 'worker')
    const from = calls.length
    await click(button(page.root, 'Khởi động lại Worker'))
    await settle()
    assert.equal(confirms.at(-1)?.title, 'Khởi động lại Moderation Worker')
    assert.deepEqual(sentFrom(calls, from), [`POST ${API}/restart-worker`, `GET ${API}/worker-status`])
    assert.equal(lastToast(toasts, 'success'), 'Đã khởi động lại Moderation Worker và làm mới bộ đệm quy tắc thành công.')
  })

  it('a refused worker restart toasts the server\'s sentence and re-enables the button', async () => {
    const server = moderationServer()
    server.state.override = call => (call.url.pathname.endsWith('/restart-worker') ? h3Error(403, 'Forbidden: Insufficient permissions') : undefined)
    const { page, toasts } = await openPage(server)
    await openTab(page, 'worker')
    await click(button(page.root, 'Khởi động lại Worker'))
    await settle()
    assert.equal(lastToast(toasts, 'error'), 'Forbidden: Insufficient permissions')
    assert.equal(button(page.root, 'Khởi động lại Worker').props.disabled, false)
  })

  it('"Quét & Dọn ngay" starts the background rescan, polls every 3 s while it runs, and reports and reloads the queue when it ends', async (t: TestContext) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const server = moderationServer()
    const { page, calls, toasts, confirms } = await openPage(server)
    await openTab(page, 'worker')

    const from = calls.length
    await click(button(page.root, 'Quét & Dọn ngay'))
    await settle()
    assert.match(String(confirms.at(-1)?.message), /tối đa 1000 bình luận mỗi lượt/)
    assert.deepEqual(sentFrom(calls, from), [`POST ${API}/rescan-all`])
    assert.equal(lastToast(toasts, 'info'), 'Đã bắt đầu quét lại nội dung ở nền. Tiến độ cập nhật trên trang này.')
    const rescanButton = () => findAll(page.root, el => el.tag === 'button' && /Quét & Dọn ngay|Đang quét\.\.\./.test(textOf(el)))[0]!
    assert.equal(textOf(rescanButton()), 'Đang quét...')
    assert.equal(rescanButton().props.disabled, true)
    assert.match(textOf(page.root), /Đang chuẩn bị quét\.\.\./)

    // Running, comments phase.
    server.state.rescan = rescanStatus({ state: 'running', progress: { phase: 'comments', totalComments: 40, totalMessages: 9, scannedComments: 10, hiddenComments: 2, failedComments: 1, scannedMessages: 0, deletedMessages: 0, failedMessages: 0 } })
    t.mock.timers.tick(3000)
    await settle()
    assert.deepEqual(sentFrom(calls, from + 1), [`GET ${API}/worker-status`])
    assert.match(textOf(page.root), /Đang quét bình luận 10\/40 · đã ẩn 2 · lỗi 1/)

    // Running, messages phase.
    server.state.rescan = rescanStatus({ state: 'running', progress: { phase: 'messages', totalComments: 40, totalMessages: 9, scannedComments: 40, hiddenComments: 3, failedComments: 0, scannedMessages: 5, deletedMessages: 1, failedMessages: 0 } })
    t.mock.timers.tick(3000)
    await settle()
    assert.match(textOf(page.root), /Đang quét tin chat trực tiếp 5\/9 · đã xóa 1/)

    // Done, with AI unavailable: a warning toast, the summary line, the AI notice, and the queue re-read.
    const summary = { ...SUMMARY, aiUnavailable: true }
    server.state.rescan = rescanStatus({ state: 'completed', finishedAt: '2026-10-25T03:05:00.000Z', summary })
    const beforeDone = calls.length
    t.mock.timers.tick(3000)
    await settle()
    assert.deepEqual(sentFrom(calls, beforeDone), [`GET ${API}/worker-status`, `GET ${API}/queue?status=pending&page=1&perPage=20`])
    const done = rescanFinishedToast(summary)
    assert.equal(done.type, 'warning')
    assert.equal(lastToast(toasts, 'warning'), done.message)
    assert.ok(textOf(page.root).includes(rescanSummaryText(summary)))
    const notice = findAll(page.root, el => el.tag === 'p' && el.props.role === 'status' && textOf(el) === rescanAiNotice(summary))
    assert.equal(notice.length, 1, 'the AI-unavailable line is its own role="status"')
    assert.equal(textOf(rescanButton()), 'Quét & Dọn ngay')

    // Not running any more: no further polling.
    const settled = calls.length
    t.mock.timers.tick(9000)
    await settle()
    assert.equal(calls.length, settled)
  })

  for (const [state, toastType, toastText, line] of [
    ['failed', 'error', 'Lượt quét lại bị dừng do lỗi. Vui lòng thử lại.', 'Lượt quét gần nhất bị dừng do lỗi. Có thể chạy lại.'],
    ['stopped', 'warning', 'Lượt quét gần nhất đã tạm dừng vì máy chủ mất kết nối giữa chừng. Chạy lại để quét tiếp phần còn lại.', 'Lượt quét gần nhất đã tạm dừng vì máy chủ mất kết nối giữa chừng. Chạy lại để quét tiếp phần còn lại.'],
  ] as const) {
    it(`a rescan that ends "${state}" says so in a toast and under the button, and re-reads the queue`, async (t: TestContext) => {
      t.mock.timers.enable({ apis: ['setTimeout'] })
      const server = moderationServer()
      // Already running when the page opens (e.g. after a reload): the poll starts on its own.
      server.state.rescan = rescanStatus({ state: 'running' })
      const { page, calls, toasts } = await openPage(server)
      await openTab(page, 'worker')
      server.state.rescan = rescanStatus({ state, error: state === 'failed' ? 'DB timeout' : null, stopReason: state === 'stopped' ? 'lock_lost' : null })
      const from = calls.length
      t.mock.timers.tick(3000)
      await settle()
      assert.deepEqual(sentFrom(calls, from), [`GET ${API}/worker-status`, `GET ${API}/queue?status=pending&page=1&perPage=20`])
      assert.equal(lastToast(toasts, toastType), toastText)
      assert.ok(textOf(page.root).includes(line))
    })
  }

  it('a rescan already running elsewhere (409): the server\'s sentence as a warning, then that run\'s progress', async (t: TestContext) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const server = moderationServer()
    server.state.override = (call) => {
      if (!call.url.pathname.endsWith('/rescan-all')) return undefined
      server.state.rescan = rescanStatus({ state: 'running' })
      return json({ statusCode: 409, statusMessage: 'Đang có một lượt quét lại chạy trên máy chủ khác. Vui lòng đợi lượt đó hoàn tất.', data: { rescan: server.state.rescan } }, 409)
    }
    const { page, calls, toasts } = await openPage(server)
    await openTab(page, 'worker')
    const from = calls.length
    await click(button(page.root, 'Quét & Dọn ngay'))
    await settle()
    assert.deepEqual(sentFrom(calls, from), [`POST ${API}/rescan-all`, `GET ${API}/worker-status`])
    assert.equal(lastToast(toasts, 'warning'), 'Đang có một lượt quét lại chạy trên máy chủ khác. Vui lòng đợi lượt đó hoàn tất.')
    assert.equal(toasts.filter(t => t.type === 'error').length, 0)
    assert.match(textOf(page.root), /Đang chuẩn bị quét\.\.\./)
  })

  it('leaving the page while a rescan runs stops the polling', async (t: TestContext) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const server = moderationServer()
    server.state.rescan = rescanStatus({ state: 'running' })
    const { page, calls } = await openPage(server)
    page.unmount()
    const from = calls.length
    t.mock.timers.tick(9000)
    await settle()
    assert.equal(calls.length, from)
  })

  it('"Khởi động lại Website" confirms, POSTs, toasts and sends the browser back to the page after 4 s; refused, the button comes back', async (t: TestContext) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const replaced: string[] = []
    const global = globalThis as Record<string, unknown>
    global.window = { location: { replace: (url: string) => { replaced.push(url) } } }
    try {
      const server = moderationServer()
      let refuse = true
      server.state.override = call => (refuse && call.url.pathname.endsWith('/restart-server')
        ? h3Error(403, 'Chỉ quản trị viên tối cao mới được khởi động lại máy chủ website.')
        : undefined)
      const { page, calls, toasts, confirms } = await openPage(server)
      await openTab(page, 'worker')
      await click(button(page.root, 'Khởi động lại Website'))
      await settle()
      assert.equal(confirms.at(-1)?.title, 'Khởi động lại máy chủ Website')
      assert.equal(lastToast(toasts, 'error'), 'Chỉ quản trị viên tối cao mới được khởi động lại máy chủ website.')
      assert.equal(button(page.root, 'Khởi động lại Website').props.disabled, false)

      refuse = false
      const from = calls.length
      await click(button(page.root, 'Khởi động lại Website'))
      await settle()
      assert.deepEqual(sentFrom(calls, from), [`POST ${API}/restart-server`])
      assert.equal(lastToast(toasts, 'success'), 'Máy chủ website đang được khởi động lại. Hệ thống sẽ sẵn sàng sau 3-5 giây.')
      assert.equal(button(page.root, 'Đang khởi động lại...').props.disabled, true)
      t.mock.timers.tick(3999)
      assert.deepEqual(replaced, [])
      t.mock.timers.tick(1)
      assert.deepEqual(replaced, ['/admin/ai/moderation'])
    } finally {
      delete global.window
    }
  })

  it('leaving the page cancels the redirect back to it — whether the restart answered before or after the officer left (base: the timer still fired and pulled them back)', async (t: TestContext) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const replaced: string[] = []
    const global = globalThis as Record<string, unknown>
    global.window = { location: { replace: (url: string) => { replaced.push(url) } } }
    try {
      // Answered, then the officer leaves within the 4 s.
      const first = await openPage()
      await openTab(first.page, 'worker')
      await click(button(first.page.root, 'Khởi động lại Website'))
      await settle()
      assert.equal(lastToast(first.toasts, 'success'), 'Máy chủ website đang được khởi động lại. Hệ thống sẽ sẵn sàng sau 3-5 giây.')
      t.mock.timers.tick(1000)
      first.page.unmount()
      t.mock.timers.tick(9000)
      assert.deepEqual(replaced, [], 'cleared in onBeforeUnmount')

      // The officer leaves while the request is still out; it answers afterwards.
      const server = moderationServer()
      let held: NetCall | null = null
      server.state.override = call => (call.url.pathname.endsWith('/restart-server') ? ((held = call), HOLD) : undefined)
      const second = await openPage(server)
      await openTab(second.page, 'worker')
      const pressed = click(button(second.page.root, 'Khởi động lại Website'))
      await settle()
      second.page.unmount()
      ;(held as NetCall | null)!.respond(json({ ok: true, message: 'Máy chủ website đang được khởi động lại. Hệ thống sẽ sẵn sàng sau 3-5 giây.' }))
      await pressed
      await settle()
      t.mock.timers.tick(9000)
      assert.deepEqual(replaced, [], 'nothing scheduled after the page is gone')
    } finally {
      delete global.window
    }
  })
})

// ─── Fixed by the split (RED on the base e1469a9) ────────────────────────────

describe('moderation page — the review queue follows the latest request (RED on the base)', () => {
  const answerFor = (server: ReturnType<typeof moderationServer>, status: string) => {
    const rows = server.state.queue[status]!
    return json({ ok: true, count: rows.length, items: rows, page: 1, perPage: 20, total: rows.length, totalPages: 1 })
  }

  /** On the queue tab, click "approved" then "rejected" while the first answer is still out. */
  async function switchFilterMidFlight(options?: { ignoreAbort?: boolean }) {
    const server = moderationServer()
    const held: NetCall[] = []
    const opened = await openPage(server, options)
    await openTab(opened.page, 'queue')
    server.state.override = (call) => {
      if (call.method === 'GET' && call.url.pathname === `${API}/queue`) { held.push(call); return HOLD }
      return undefined
    }
    await click(button(opened.page.root, 'Đã duyệt an toàn'))
    await click(button(opened.page.root, 'Đã xóa'))
    await settle()
    assert.deepEqual(held.map(wire), [`GET ${API}/queue?status=approved&page=1&perPage=20`, `GET ${API}/queue?status=rejected&page=1&perPage=20`])
    return { ...opened, server, approved: held[0]!, rejected: held[1]! }
  }

  it('the older filter\'s answer landing LAST does not replace the newer filter\'s rows (base: it did)', async () => {
    const { page, server, approved, rejected } = await switchFilterMidFlight({ ignoreAbort: true })
    rejected.respond(answerFor(server, 'rejected'))
    await settle()
    approved.respond(answerFor(server, 'approved'))
    await settle()
    assert.deepEqual(shownQueueIds(page), [41], 'the rows of "Đã xóa", the filter shown as active')
    assert.match(String(button(page.root, 'Đã xóa').props.class), ACTIVE_FILTER)
  })

  it('an older answer arriving FIRST does not paint its rows under the newer filter (base: it did)', async () => {
    const { page, server, approved, rejected } = await switchFilterMidFlight({ ignoreAbort: true })
    approved.respond(answerFor(server, 'approved'))
    await settle()
    assert.ok(!shownQueueIds(page).includes(31), 'no "Đã duyệt an toàn" rows under the "Đã xóa" filter')
    rejected.respond(answerFor(server, 'rejected'))
    await settle()
    assert.deepEqual(shownQueueIds(page), [41])
  })

  it('the superseded request is cancelled on the wire', async () => {
    const { approved, rejected, server } = await switchFilterMidFlight()
    rejected.respond(answerFor(server, 'rejected'))
    await settle()
    assert.equal(approved.signal?.aborted, true)
  })

  it('a failed filter change shows the server\'s sentence in the queue tab, in place of the stale rows; the page alert stays down (base: an unhandled rejection; the old rows stayed under the new filter)', async () => {
    const server = moderationServer()
    const { page, toasts } = await openPage(server)
    await openTab(page, 'queue')
    server.state.override = call => (call.url.searchParams.get('status') === 'approved' ? h3Error(403, 'Forbidden: Insufficient permissions') : undefined)
    await click(button(page.root, 'Đã duyệt an toàn'))
    await settle()
    assert.ok(tabAlert(page), 'the failure is on screen, in the queue tab')
    assert.match(textOf(tabAlert(page)!), /Lỗi: Forbidden: Insufficient permissions/)
    assertTabsStillUsable(page)
    assert.deepEqual(shownQueueIds(page), [], 'the previous filter\'s rows are not shown under the new filter')
    assert.equal(pagination(page), null, 'nor its page count')
    assertOnlyServerSentences(toasts, page)
  })

  it('a queue failure after the page load keeps unsaved settings edits and every tab; its "Thử lại" re-reads the queue only (base: no message at all)', async () => {
    const server = moderationServer()
    const { page, calls } = await openPage(server)
    // An unsaved edit on the settings tab.
    await input(findAll(page.root, el => el.tag === 'textarea')[0]!, 'Prompt đang sửa, chưa lưu')
    await settle()

    await openTab(page, 'queue')
    let failing = true
    server.state.override = call => (failing && call.url.searchParams.get('status') === 'approved' ? h3Error(403, 'Forbidden: Insufficient permissions') : undefined)
    await click(button(page.root, 'Đã duyệt an toàn'))
    await settle()
    assert.match(textOf(tabAlert(page)!), /Lỗi: Forbidden: Insufficient permissions/)
    assertTabsStillUsable(page)

    // The other tabs still open, with the edit in place, while the queue tab holds its error.
    await openTab(page, 'settings')
    assert.equal(findAll(page.root, el => el.tag === 'textarea')[0]!.model?.value, 'Prompt đang sửa, chưa lưu')
    assert.equal(alertBox(page), null, 'the queue\'s error is shown on the queue tab only')
    await openTab(page, 'rules')
    assert.equal(tableRows(page).length, 3)
    await openTab(page, 'queue')

    failing = false
    const from = calls.length
    await click(button(tabAlert(page)!, 'Thử lại'))
    await settle()
    assert.deepEqual(sentFrom(calls, from), [`GET ${API}/queue?status=approved&page=1&perPage=20`], 'the queue only — not the page load (which re-reads the settings over the edit)')
    assert.equal(alertBox(page), null)
    assert.deepEqual(shownQueueIds(page), [31, 32])
    await openTab(page, 'settings')
    assert.equal(findAll(page.root, el => el.tag === 'textarea')[0]!.model?.value, 'Prompt đang sửa, chưa lưu', 'the unsaved edit survived the retry')
  })

  it('a failed page change shows the server\'s sentence in the queue tab (base: nothing on screen)', async () => {
    const server = moderationServer()
    const { page } = await openPage(server)
    await openTab(page, 'queue')
    server.state.override = call => (call.url.searchParams.get('page') === '2' ? h3Error(400, 'Trang không hợp lệ.') : undefined)
    await goToPage(pagination(page)!, 2)
    await settle()
    assert.ok(tabAlert(page), 'the failure is on screen, in the queue tab')
    assert.match(textOf(tabAlert(page)!), /Lỗi: Trang không hợp lệ\./)
    assertTabsStillUsable(page)
    assert.deepEqual(page.errors, [], 'nothing was thrown past the page')
  })

  it('a resolve that succeeded is not followed by an error toast when only the reload after it failed — the reload failure shows in the queue tab (base: "success" then an error toast)', async () => {
    const server = moderationServer()
    const { page, toasts } = await openPage(server)
    await openTab(page, 'queue')
    server.state.override = call => (call.method === 'GET' && call.url.pathname === `${API}/queue` ? h3Error(403, 'Forbidden: Insufficient permissions') : undefined)
    await click(button(queueRowOf(page, 1), 'Bỏ ẩn'))
    await settle()
    assert.deepEqual(toasts, [{ type: 'success', message: 'Đã xử lý đối soát thành công!' }])
    assert.match(textOf(tabAlert(page)!), /Lỗi: Forbidden: Insufficient permissions/, 'the failed reload is on screen instead')
    assertTabsStillUsable(page)
  })

  it('resolving the only row of the last page shows the last page that still has rows, not the "nothing to review" state (base: it claimed the queue was clean)', async () => {
    const server = moderationServer()
    server.state.queue.pending = server.state.queue.pending.slice(0, 21)
    const { page, calls } = await openPage(server)
    await openTab(page, 'queue')
    await goToPage(pagination(page)!, 2)
    await settle()
    assert.deepEqual(shownQueueIds(page), [21])

    const from = calls.length
    await click(button(queueRowOf(page, 21), 'Bỏ ẩn'))
    await settle()
    assert.doesNotMatch(textOf(page.root), /Không có mục nào trong danh sách đối soát/)
    assert.deepEqual(shownQueueIds(page), Array.from({ length: 20 }, (_, i) => i + 1))
    assert.ok(sentFrom(calls, from).includes(`GET ${API}/queue?status=pending&page=1&perPage=20`), 'asked again for the last page that exists')
  })
})

// ─── Source ──────────────────────────────────────────────────────────────────

describe('moderation page — source (RED on the base)', () => {
  it('no part calls or casts $fetch; the page still counts as fetching for the error/skeleton coverage gates', () => {
    assert.doesNotMatch(moderationPageSource(), /\$fetch\b/, 'a part still uses $fetch — go through adminFetch<T>()')
    assert.match(readModerationPart('page'), ADMIN_FETCH_CALL)
    assert.match(readModerationPart('page'), /\buseAdminList\s*</, 'the review queue is a useAdminList list')
  })

  // Every `.vue` in the panels directory, read on disk (tests/_moderation-page-parts.ts) —
  // not a fixed list: a panel added later is held to the same rule.
  it('the panels do not fetch: every request, and the error/retry branch, stay in the page (split-guard rule)', () => {
    const panels = moderationPanelFiles()
    assert.ok(panels.length >= 4, `panels: ${JSON.stringify(panels)}`)
    for (const panel of panels) {
      assert.doesNotMatch(readAppFile(panel), ADMIN_FETCH_CALL, `${panel} fetches — the coverage gates would need it listed`)
      assert.doesNotMatch(readAppFile(panel), /role="alert"/, `${panel}: the error branch belongs to the page`)
    }
  })

  it('injection proof: "must appear nowhere" scans read every panel on disk and the modules split out of the page', () => {
    const planted = '\nfunction rescanSummaryText() { return "" }\n'
    const NOWHERE = /function rescanSummaryText/
    assert.doesNotMatch(moderationPageSource(), NOWHERE)
    // A panel nobody listed yet, and the two modules the split pulled out of the page.
    assert.match(moderationPageSourceWith({ [`${MODERATION_PANELS_DIR}/ModerationExtraPanel.vue`]: planted }), NOWHERE)
    assert.match(moderationPageSourceWith({ 'utils/moderation-format.ts': readAppFile('utils/moderation-format.ts') + planted }), NOWHERE)
    assert.match(moderationPageSourceWith({ 'types/moderation.ts': readAppFile('types/moderation.ts') + planted }), NOWHERE)
    // Only what the real scan would read joins: a file outside the family does not.
    assert.equal(moderationPageSourceWith({ 'components/admin/ai/AiModerationTab.vue': planted }), moderationPageSource())
    assert.ok(moderationPageFiles().includes('utils/moderation-format.ts') && moderationPageFiles().includes('types/moderation.ts'))
  })
})
