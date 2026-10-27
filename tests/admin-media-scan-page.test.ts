/**
 * `/admin/media/scan` ("Quét & Đồng bộ Media") — behaviour, through the page's own buttons.
 *
 * Wave 3 task 4.1 (split the 908-line page along its job/panel seams) and 7.1 (its 12
 * `($fetch as …)` casts become `adminFetch<T>()`). These tests were written BEFORE the
 * split and run the same way on both versions: the REAL page — `<script setup>`,
 * template, and after the split the real panels and composable it imports — mounted on
 * a minimal DOM (tests/_sfc-mount-media-scan.ts), with REAL ofetch over a fake network
 * (the shape of tests/admin-fetch-rollout.test.ts). Every action is a click on the
 * rendered control, found by its visible text, so a split that forgets to wire an emit
 * fails here exactly as a dead button would. Only `setInterval` is faked (node:test mock
 * timers), so the 3-second status polls run on `tick()`.
 *
 * The page drives the jobs of the "Đồng bộ media lên R2" rules (CLAUDE.md): scan of
 * orphaned files, local↔R2 sync, "Vá URL", "Đổi domain URL R2" and self-heal. It has no
 * list and no error branch (tests/admin-error-retry-ui.test.ts NO_CONTRACT_NEEDED): every
 * fetch is submit-time, the button is the retry and the result lands in a toast. So the
 * "error and retry" pinned here is: the server's own sentence reaches the toast (never
 * ofetch's `[POST] "…"` line), the button comes back, and pressing it again works.
 *
 * Pinned (green on the base 9905d0d and after the split):
 *   - the mount reads the counts, then the sync job, then the scan job, and follows a job
 *     left running by an earlier visit; a failed read leaves the page usable, silently;
 *   - each job sends the same method, path and body, toasts the same text, re-reads the
 *     counts when it should, and polls its status every 3 s until it stops;
 *   - a job that FAILS while polled — a restore in progress included — puts its message
 *     in the toast (`Quét lỗi: …`, `Sync lỗi: …` — the line an earlier verify located at
 *     scan.vue:~215); a 409 (job already running, or blocked by a restore for repair /
 *     repoint / self-heal) shows the server's sentence;
 *   - leaving the page stops both polls.
 *
 * Fixed by the split (RED on the base — each test says why):
 *   - leaving the page while the first status read, or a start request, is still in
 *     flight no longer starts a 3-second poll that outlives the page;
 *   - "Hủy quét"/"Hủy sync" pressed after the job ended between two polls shows the
 *     server's answer ("Không có job … đang chạy.") instead of claiming a cancel was sent.
 *
 * To re-run this file against another copy of the page (e.g. the pre-split original):
 *   MEDIA_SCAN_PAGE=/abs/path/scan.vue node --experimental-strip-types \
 *     --experimental-test-module-mocks --import ./scripts/ts-resolver.mjs --test tests/admin-media-scan-page.test.ts
 */
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, it, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createFetch } from 'ofetch'
import * as Vue from 'vue'

import { adminFetch } from '../app/composables/adminFetch.ts'
import { ADMIN_FETCH_CALL } from './_admin-fetch-call.ts'
import { allByText, byText, click, findAll, input, isDisabled, mountSfc, textOf, type MiniElement, type MountedSfc } from './_sfc-mount-media-scan.ts'

const PAGE = process.env.MEDIA_SCAN_PAGE ?? fileURLToPath(new URL('../app/pages/admin/media/scan.vue', import.meta.url))
const PANELS_DIR = fileURLToPath(new URL('../app/components/admin/media/scan/', import.meta.url))

// ─── Fake network under real ofetch ──────────────────────────────────────────

type NetCall = {
  method: string
  url: URL
  body: unknown
  respond: (response: Response) => void
  fail: (reason: unknown) => void
}
type Responder = (call: NetCall) => Response | Error | undefined

function installNetwork(responder: Responder): NetCall[] {
  const calls: NetCall[] = []
  const fetchImpl = (input: RequestInfo | URL, init: RequestInit = {}) => new Promise<Response>((resolve, reject) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const call: NetCall = {
      method: (init.method ?? 'GET').toUpperCase(),
      url: new URL(raw, 'http://admin.test'),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
      respond: resolve,
      fail: reject,
    }
    calls.push(call)
    const answer = responder(call)
    if (answer instanceof Error) reject(answer)
    else if (answer) resolve(answer)
  })
  ;(globalThis as Record<string, unknown>).$fetch = createFetch({ fetch: fetchImpl as typeof fetch })
  return calls
}

const STATUS_TEXT: Record<number, string> = { 200: 'OK', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 409: 'Conflict', 500: 'Internal Server Error' }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, statusText: STATUS_TEXT[status] ?? '', headers: { 'content-type': 'application/json' } })

/** What `throw createError({ statusCode, statusMessage })` sends from a Nitro handler. */
const h3Error = (statusCode: number, statusMessage: string) => json({ statusCode, statusMessage, message: statusMessage }, statusCode)

/** A connection that never got an answer (ofetch wraps it in a FetchError with no response). */
const dropped = () => new TypeError('fetch failed')

const wire = (call: NetCall) => `${call.method} ${call.url.pathname}${call.url.search}`

/** Let promise chains (ofetch's internal awaits, Vue's flushes) run to completion. */
async function settle() {
  for (let i = 0; i < 10; i++) {
    await Vue.nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

// ─── The media job API, as the handlers under server/api/admin/media/** answer it ──

/** `JobBlockedByRestoreError` (server/services/pre-job-backup.ts) — the 409 / `failed` sentence of a job refused during a restore. */
const restoreBlocked = (action: string) => `Đang khôi phục từ bản sao lưu — chưa ${action}, chưa ghi gì. Thử lại sau khi khôi phục xong.`

type ScanStatus = {
  jobId: string, running: boolean, cancelling: boolean, total: number, done: number, imported: number, skipped: number
  conflicts: number, conflictFiles: string[], legacyMatched: number, errors: string[]
  phase: 'scanning' | 'done' | 'failed' | 'cancelled', message: string, startedAt: number, finishedAt: number | null, truncated: boolean
}
type SyncStatus = {
  jobId: string, direction: 'to-r2' | 'to-local', running: boolean, cancelling: boolean, total: number, done: number
  synced: number, skipped: number, errors: string[], articlesRewritten: number, urlsRepaired: number
  phase: 'backup' | 'sync' | 'rewrite' | 'done' | 'failed' | 'cancelled', message: string, startedAt: number
  finishedAt: number | null, preBackupStamp: string | null
}

const scanStatus = (over: Partial<ScanStatus> = {}): ScanStatus => ({
  jobId: 'scan_1', running: true, cancelling: false, total: 120, done: 40, imported: 30, skipped: 10,
  conflicts: 0, conflictFiles: [], legacyMatched: 0, errors: [], phase: 'scanning', message: 'Đang quét batch 1/3',
  startedAt: Date.now(), finishedAt: null, truncated: false, ...over,
})
const syncStatus = (over: Partial<SyncStatus> = {}): SyncStatus => ({
  jobId: 'sync_1', direction: 'to-r2', running: true, cancelling: false, total: 50, done: 10, synced: 9, skipped: 1,
  errors: [], articlesRewritten: 0, urlsRepaired: 0, phase: 'sync', message: 'Đang sync 10/50',
  startedAt: Date.now(), finishedAt: null, preBackupStamp: null, ...over,
})
/** Running for 100 s without a single file done: what the page calls stalled (> 90 s, `done === 0`). */
const STALLED = { done: 0, startedAt: Date.now() - 100_000 }

type ServerState = { counts: { local: number, r2: number }, scan: ScanStatus | null, sync: SyncStatus | null }

const REPAIR_OK = {
  ok: true, mediaFixed: 4, articlesFixed: 12, thumbnailsFixed: 3, syncUrlsRepaired: 0, syncRepairError: null,
  backupStamp: '2026-10-25_09-00-00',
  message: 'Đã vá: 4 URL media + 12 lượt thay trong bài viết + 3 thumbnail bài + 0 URL dở dang từ lượt đồng bộ trước. Snapshot: 2026-10-25_09-00-00.',
}
const REPOINT_OK = {
  ok: true, mediaUpdated: 210, contentRowsUpdated: 57, byTarget: { 'media.url': 210, 'articles.content': 57 },
  backupStamp: '2026-10-25_09-10-00',
  message: 'Đã đổi URL: 210 ảnh + 57 hàng nội dung. Snapshot: 2026-10-25_09-10-00.',
}
const selfHealOk = (dryRun: boolean) => ({
  ok: true, r2Checked: 300, r2Ok: 290, r2Missing: 10, r2Reuploaded: dryRun ? 0 : 8, r2Lost: 2,
  thumbnailsRepointed: 5, thumbnailsDefaulted: dryRun ? 0 : 4, mediaUrlsDefaulted: dryRun ? 0 : 2,
  missingSamples: ['a.jpg', 'b.jpg'], backupStamp: dryRun ? null : '2026-10-25_09-20-00',
  message: dryRun
    ? 'Xem trước: 10 R2 thiếu (đã upload lại 0, mất gốc 2) · 5 thumbnail bài viết'
    : 'Đã vá: 10 R2 thiếu (đã upload lại 8, mất gốc 2) · 5 thumbnail bài viết. Snapshot: 2026-10-25_09-20-00.',
})

/** The happy-path server. `override` answers first (a Response, an Error, or `undefined` to fall through). */
function mediaServer(state: ServerState, override: (call: NetCall) => Response | Error | 'hold' | undefined = () => undefined): Responder {
  return (call) => {
    const answer = override(call)
    if (answer === 'hold') return undefined
    if (answer) return answer
    const route = `${call.method} ${call.url.pathname}`
    const body = (call.body ?? {}) as Record<string, unknown>
    switch (route) {
      case 'GET /api/admin/media/counts': return json({ ok: true, ...state.counts })
      case 'GET /api/admin/media/scan-status': return json({ ok: true, status: state.scan })
      case 'GET /api/admin/media/sync-status': return json({ ok: true, status: state.sync })
      case 'POST /api/admin/media/scan':
        state.scan = scanStatus({ total: 0, done: 0, imported: 0, skipped: 0, message: 'Đang quét' })
        return json({ ok: true, jobId: 'scan_1', message: 'Đã khởi tạo job quét. Theo dõi tiến độ qua /api/admin/media/scan-status.' })
      case 'POST /api/admin/media/scan-cancel':
        if (!state.scan?.running) return json({ ok: false, message: 'Không có job quét nào đang chạy.' })
        state.scan = { ...state.scan, cancelling: true }
        return json({ ok: true, message: 'Đã yêu cầu hủy. Worker sẽ dừng ở batch tiếp theo.' })
      case 'POST /api/admin/media/scan-force-reset': {
        if (!state.scan?.running) return h3Error(409, 'Không có job quét nào đang chạy để gỡ kẹt.')
        const message = 'Đã buộc dừng (treo ở scanning 100s) — có thể chạy lại ngay.'
        state.scan = { ...state.scan, running: false, phase: 'cancelled', message, finishedAt: Date.now() }
        return json({ ok: true, message })
      }
      case 'POST /api/admin/media/sync-storage': {
        const direction = body.direction
        if (direction !== 'to-r2' && direction !== 'to-local') return h3Error(400, 'Hướng đồng bộ không hợp lệ (chỉ nhận "to-r2" hoặc "to-local").')
        state.sync = syncStatus({ direction, phase: 'backup', total: 0, done: 0, synced: 0, skipped: 0, message: 'Đang backup trước sync' })
        return json({ ok: true, jobId: 'sync_1', message: 'Đã khởi tạo job sync. Theo dõi tiến độ qua /api/admin/media/sync-status.' })
      }
      case 'POST /api/admin/media/sync-cancel':
        if (!state.sync?.running) return json({ ok: false, message: 'Không có job sync nào đang chạy.' })
        state.sync = { ...state.sync, cancelling: true }
        return json({ ok: true, message: 'Đã yêu cầu hủy. Worker sẽ dừng ở batch tiếp theo.' })
      case 'POST /api/admin/media/sync-force-reset': {
        if (!state.sync?.running) return h3Error(409, 'Không có job sync nào đang chạy để gỡ kẹt.')
        const message = 'Đã buộc dừng (treo ở backup 100s) — có thể chạy lại ngay.'
        state.sync = { ...state.sync, running: false, phase: 'cancelled', message, finishedAt: Date.now() }
        return json({ ok: true, message })
      }
      case 'POST /api/admin/media/repair-urls': return json(REPAIR_OK)
      case 'POST /api/admin/media/repoint-r2-urls': return json(REPOINT_OK)
      case 'POST /api/admin/media/self-heal': return json(selfHealOk(body.dryRun === true))
    }
    return h3Error(404, `no route ${route}`)
  }
}

// ─── Mounting the page ───────────────────────────────────────────────────────

type Toast = { type: string, message: string }

interface OpenPage {
  page: MountedSfc
  calls: NetCall[]
  toasts: Toast[]
  confirms: string[]
  /** What the next confirm dialog answers. */
  answerConfirm: (accept: boolean) => void
  /** Advance the faked `setInterval` clock and let the polls it fires finish. */
  tick: (ms?: number) => Promise<void>
  close: () => void
}

async function openPage(t: TestContext, state: ServerState, override?: Parameters<typeof mediaServer>[1]): Promise<OpenPage> {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const calls = installNetwork(mediaServer(state, override))
  const toasts: Toast[] = []
  const confirms: string[] = []
  let accept = true
  const toast = Object.fromEntries(['success', 'error', 'warning', 'info'].map(type =>
    [type, (message: string) => { toasts.push({ type, message }) }]))
  const page = await mountSfc(PAGE, {
    auto: {
      definePageMeta: () => {},
      useToast: () => toast,
      useConfirm: () => ({ confirm: async (options: { message: string }) => { confirms.push(options.message); return accept } }),
      ref: Vue.ref, computed: Vue.computed, reactive: Vue.reactive, watch: Vue.watch, nextTick: Vue.nextTick,
      onMounted: Vue.onMounted, onUnmounted: Vue.onUnmounted, onBeforeUnmount: Vue.onBeforeUnmount,
      // The real one: it calls the `$fetch` global installed by installNetwork().
      adminFetch,
    },
  })
  await settle()
  let open = true
  const close = () => {
    if (!open) return
    open = false
    page.unmount()
  }
  t.after(close)
  return {
    page,
    calls,
    toasts,
    confirms,
    answerConfirm: (value) => { accept = value },
    tick: async (ms = 3000) => { t.mock.timers.tick(ms); await settle() },
    close,
  }
}

const emptyServer = (over: Partial<ServerState> = {}): ServerState => ({ counts: { local: 3, r2: 5 }, scan: null, sync: null, ...over })

const SCAN_HEADING = 'Quét thư mục ảnh mồ côi'
const SYNC_HEADING = 'Đồng bộ storage ảnh'
const REPAIR_HEADING = 'Vá URL ảnh hỏng hàng loạt'
const REPOINT_HEADING = 'Đổi domain URL R2'
const SELF_HEAL_HEADING = 'Check chéo local ↔ R2 + tự vá'

const section = (open: OpenPage, heading: string) => byText(open.page.root, 'section', heading)
const button = (open: OpenPage, heading: string, label: string) => byText(section(open, heading), 'button', label)
const buttons = (open: OpenPage, heading: string, label: string) => allByText(section(open, heading), 'button', label)
const sectionText = (open: OpenPage, heading: string) => textOf(section(open, heading))

/** Click without awaiting the handler (it may wait on a held response), then let the page settle. */
async function press(el: MiniElement) {
  void click(el)
  await settle()
}

const wiresSince = (calls: NetCall[], from: number) => calls.slice(from).map(wire)
const lastToast = (open: OpenPage) => open.toasts.at(-1)
const noErrors = (open: OpenPage) => assert.deepEqual(open.page.errors, [], 'no handler threw or rejected')

// ─── Load ────────────────────────────────────────────────────────────────────

describe('/admin/media/scan — load', () => {
  it('reads the counts, then the sync job, then the scan job, and shows the counts', async (t) => {
    const open = await openPage(t, emptyServer())
    assert.deepEqual(open.calls.map(wire), [
      'GET /api/admin/media/counts',
      'GET /api/admin/media/sync-status',
      'GET /api/admin/media/scan-status',
    ])
    assert.match(sectionText(open, SYNC_HEADING), /Local 3 R2 5/)
    assert.equal(isDisabled(button(open, SYNC_HEADING, 'Đồng bộ lên R2')), false)
    assert.equal(isDisabled(button(open, SYNC_HEADING, 'Đồng bộ về local')), false)
    assert.equal(findAll(open.page.root, el => el.props.role === 'progressbar').length, 0, 'no job → no progress card')
    assert.deepEqual(open.toasts, [])

    // Nothing runs, so nothing polls.
    await open.tick()
    await open.tick()
    assert.equal(open.calls.length, 3)
    noErrors(open)
  })

  it('a side with no images cannot be synced away from', async (t) => {
    const open = await openPage(t, emptyServer({ counts: { local: 0, r2: 7 } }))
    assert.equal(isDisabled(button(open, SYNC_HEADING, 'Đồng bộ lên R2')), true)
    assert.equal(isDisabled(button(open, SYNC_HEADING, 'Đồng bộ về local')), false)
  })

  it('a failed read on load leaves the page usable and says nothing', async (t) => {
    const open = await openPage(t, emptyServer(), (call) => {
      if (call.url.pathname === '/api/admin/media/counts') return h3Error(500, 'Lỗi CSDL')
      if (call.url.pathname.endsWith('-status')) return dropped()
      return undefined
    })
    // ofetch retries a failed GET once — the same on the wire before and after the split.
    assert.deepEqual(open.calls.map(wire).sort(), [
      'GET /api/admin/media/counts', 'GET /api/admin/media/counts',
      'GET /api/admin/media/scan-status', 'GET /api/admin/media/scan-status',
      'GET /api/admin/media/sync-status', 'GET /api/admin/media/sync-status',
    ])
    assert.match(sectionText(open, SYNC_HEADING), /Local 0 R2 0/)
    assert.deepEqual(open.toasts, [])
    assert.equal(isDisabled(button(open, SCAN_HEADING, 'Bắt đầu quét')), false)
    noErrors(open)
  })

  it('a scan and a sync left running by an earlier visit are followed every 3 s until each ends', async (t) => {
    const state = emptyServer({ scan: scanStatus(), sync: syncStatus() })
    const open = await openPage(t, state)

    assert.match(sectionText(open, SCAN_HEADING), /Đang quét\.\.\./)
    assert.match(sectionText(open, SCAN_HEADING), /40 \/ 120 file · 33%/)
    assert.equal(buttons(open, SCAN_HEADING, 'Hủy quét').length, 1)
    assert.match(sectionText(open, SYNC_HEADING), /Đang chuyển lên R2\.\.\./)
    assert.match(sectionText(open, SYNC_HEADING), /Đang sync 10 \/ 50 file · 20%/)
    assert.equal(isDisabled(button(open, SYNC_HEADING, 'Đồng bộ về local')), true)

    let from = open.calls.length
    await open.tick()
    assert.deepEqual(wiresSince(open.calls, from).sort(), ['GET /api/admin/media/scan-status', 'GET /api/admin/media/sync-status'])

    state.sync = syncStatus({ running: false, phase: 'done', done: 50, synced: 48, skipped: 2, articlesRewritten: 7, preBackupStamp: 'pre-sync-2026-10-25', message: 'Xong' })
    from = open.calls.length
    await open.tick()
    // Two independent intervals fire in the same tick; their order is not the point.
    assert.deepEqual(wiresSince(open.calls, from).sort(), ['GET /api/admin/media/counts', 'GET /api/admin/media/scan-status', 'GET /api/admin/media/sync-status'])
    assert.deepEqual(lastToast(open), { type: 'success', message: 'Đã chuyển 48 ảnh sang R2, bỏ qua 2. Đã sửa URL trong 7 bài viết. Snapshot: pre-sync-2026-10-25.' })

    from = open.calls.length
    await open.tick()
    assert.deepEqual(wiresSince(open.calls, from), ['GET /api/admin/media/scan-status'], 'the sync poll stopped, the scan poll goes on')
    noErrors(open)
  })
})

// ─── Scan ────────────────────────────────────────────────────────────────────

describe('/admin/media/scan — scan of orphaned files', () => {
  it('starts with "Tự đẩy lên R2", follows the job, and reports the result when it is done', async (t) => {
    const state = emptyServer()
    const open = await openPage(t, state)
    const checkbox = findAll(section(open, SCAN_HEADING), el => el.tag === 'input' && el.props.type === 'checkbox')[0]!
    await input(checkbox, true)
    await settle()

    let from = open.calls.length
    await press(button(open, SCAN_HEADING, 'Bắt đầu quét'))
    assert.deepEqual(wiresSince(open.calls, from), ['POST /api/admin/media/scan', 'GET /api/admin/media/scan-status'])
    assert.deepEqual(open.calls[from]!.body, { autoRepointToR2: true })
    assert.deepEqual(open.toasts, [{ type: 'info', message: 'Đã khởi tạo job quét + tự đẩy R2. Đang chạy nền...' }])
    assert.equal(isDisabled(button(open, SCAN_HEADING, 'Đang quét...')), true)
    assert.equal(isDisabled(findAll(section(open, SCAN_HEADING), el => el.tag === 'input')[0]!), true, 'the option is locked while the job runs')
    assert.match(sectionText(open, SCAN_HEADING), /Đang chạy nền\. Có thể đóng trang/)

    state.scan = scanStatus()
    await open.tick()
    assert.match(sectionText(open, SCAN_HEADING), /30 đã nhập 10 bỏ qua Đang quét batch 1\/3/)

    state.scan = scanStatus({ running: false, phase: 'done', done: 120, imported: 30, skipped: 2, truncated: true, message: 'Xong' })
    from = open.calls.length
    await open.tick()
    assert.deepEqual(wiresSince(open.calls, from), ['GET /api/admin/media/scan-status', 'GET /api/admin/media/counts'])
    assert.deepEqual(open.toasts.slice(1), [
      { type: 'success', message: 'Đã nhập 30 tệp ảnh, bỏ qua 2 tệp.' },
      { type: 'warning', message: 'Đạt giới hạn 5000 tệp. Chạy lại để quét tiếp.' },
    ])
    const text = sectionText(open, SCAN_HEADING)
    assert.match(text, /Đã nhập 30 Bỏ qua 2 Cắt ngang Đạt 5000 tệp — chạy lại để quét tiếp/)
    assert.match(text, /Xem thư viện →/)
    assert.equal(isDisabled(button(open, SCAN_HEADING, 'Bắt đầu quét')), false)

    from = open.calls.length
    await open.tick()
    await open.tick()
    assert.deepEqual(wiresSince(open.calls, from), [], 'polling stopped with the job')
    noErrors(open)
  })

  it('without the option the body says so; "nothing new" and "only skipped" have their own sentences', async (t) => {
    for (const [done, expected] of [
      [{ imported: 0, skipped: 0 }, 'Không có tệp mới để nhập.'],
      [{ imported: 0, skipped: 5 }, 'Không có tệp mới. Bỏ qua 5 tệp.'],
      [{ imported: 4, skipped: 0 }, 'Đã nhập 4 tệp ảnh.'],
    ] as const) {
      const state = emptyServer()
      const open = await openPage(t, state, (call) => {
        if (wire(call) === 'GET /api/admin/media/scan-status' && state.scan) {
          return json({ ok: true, status: scanStatus({ running: false, phase: 'done', ...done }) })
        }
        return undefined
      })
      const from = open.calls.length
      await press(button(open, SCAN_HEADING, 'Bắt đầu quét'))
      assert.deepEqual(open.calls[from]!.body, { autoRepointToR2: false })
      assert.deepEqual(open.toasts, [
        { type: 'info', message: 'Đã khởi tạo job quét. Đang chạy nền...' },
        { type: done.imported > 0 ? 'success' : 'info', message: expected },
      ])
      open.close()
      t.mock.timers.reset()
    }
  })

  it('a scan refused by a restore in progress fails while polled, and its sentence reaches the toast', async (t) => {
    const state = emptyServer()
    const open = await openPage(t, state)
    await press(button(open, SCAN_HEADING, 'Bắt đầu quét'))
    state.scan = scanStatus({ running: false, phase: 'failed', done: 0, imported: 0, skipped: 0, message: restoreBlocked('quét thư mục ảnh') })
    await open.tick()
    assert.deepEqual(lastToast(open), { type: 'error', message: `Quét lỗi: ${restoreBlocked('quét thư mục ảnh')}` })
    assert.match(sectionText(open, SCAN_HEADING), /Lỗi/)
    assert.equal(isDisabled(button(open, SCAN_HEADING, 'Bắt đầu quét')), false)
    noErrors(open)
  })

  it('409 "already running": the server sentence, the button comes back, nothing polls — and pressing again is the retry', async (t) => {
    let busy = true
    const state = emptyServer()
    const open = await openPage(t, state, (call) => {
      if (wire(call) === 'POST /api/admin/media/scan' && busy) return h3Error(409, 'Một lượt quét khác đang chạy. Thử lại sau.')
      return undefined
    })
    let from = open.calls.length
    await press(button(open, SCAN_HEADING, 'Bắt đầu quét'))
    assert.deepEqual(wiresSince(open.calls, from), ['POST /api/admin/media/scan'], 'a POST is never retried by ofetch')
    assert.deepEqual(open.toasts, [{ type: 'error', message: 'Một lượt quét khác đang chạy. Thử lại sau.' }])
    assert.equal(isDisabled(button(open, SCAN_HEADING, 'Bắt đầu quét')), false)
    await open.tick()
    assert.equal(open.calls.length, from + 1, 'no poll was started')

    busy = false
    from = open.calls.length
    await press(button(open, SCAN_HEADING, 'Bắt đầu quét'))
    assert.deepEqual(wiresSince(open.calls, from), ['POST /api/admin/media/scan', 'GET /api/admin/media/scan-status'])
    assert.equal(lastToast(open)?.message, 'Đã khởi tạo job quét. Đang chạy nền...')
    noErrors(open)
  })

  it('a dropped connection shows the page fallback, 403 the server sentence — never ofetch\'s request line', async (t) => {
    let answer: () => Response | Error = dropped
    const open = await openPage(t, emptyServer(), call => (wire(call) === 'POST /api/admin/media/scan' ? answer() : undefined))
    await press(button(open, SCAN_HEADING, 'Bắt đầu quét'))
    assert.deepEqual(lastToast(open), { type: 'error', message: 'Lỗi khởi tạo quét' })
    answer = () => h3Error(403, 'Bạn không có quyền tạo media.')
    await press(button(open, SCAN_HEADING, 'Bắt đầu quét'))
    assert.deepEqual(lastToast(open), { type: 'error', message: 'Bạn không có quyền tạo media.' })
    assert.ok(open.toasts.every(toast => !toast.message.includes('[POST]')))
    noErrors(open)
  })

  it('"Hủy quét" asks the worker to stop; the poll then reports the cancellation', async (t) => {
    const state = emptyServer({ scan: scanStatus() })
    const open = await openPage(t, state)
    const from = open.calls.length
    await press(button(open, SCAN_HEADING, 'Hủy quét'))
    assert.deepEqual(wiresSince(open.calls, from), ['POST /api/admin/media/scan-cancel'])
    assert.deepEqual(open.toasts, [{ type: 'info', message: 'Đã yêu cầu hủy. Worker dừng ở batch tiếp theo.' }])

    await open.tick()
    assert.equal(isDisabled(button(open, SCAN_HEADING, 'Đang dừng...')), true)
    assert.match(sectionText(open, SCAN_HEADING), /\(đang dừng\)/)

    state.scan = scanStatus({ running: false, cancelling: false, phase: 'cancelled', message: 'Đã hủy ở 40/120' })
    await open.tick()
    assert.deepEqual(lastToast(open), { type: 'info', message: 'Đã hủy: Đã hủy ở 40/120' })
    noErrors(open)
  })

  it('a failed cancel shows the server sentence', async (t) => {
    const open = await openPage(t, emptyServer({ scan: scanStatus() }), call =>
      (wire(call) === 'POST /api/admin/media/scan-cancel' ? h3Error(403, 'Bạn không có quyền tạo media.') : undefined))
    await press(button(open, SCAN_HEADING, 'Hủy quét'))
    assert.deepEqual(open.toasts, [{ type: 'error', message: 'Bạn không có quyền tạo media.' }])
  })

  it('[fixed by the split] "Hủy quét" after the job ended between two polls shows the server\'s answer, not "Đã yêu cầu hủy"', async (t) => {
    // RED on the base: the page ignored `{ ok: false }` (HTTP 200) and claimed a cancel was sent.
    const state = emptyServer({ scan: scanStatus() })
    const open = await openPage(t, state)
    state.scan = scanStatus({ running: false, phase: 'done', message: 'Xong' })
    await press(button(open, SCAN_HEADING, 'Hủy quét'))
    assert.deepEqual(open.toasts, [{ type: 'info', message: 'Không có job quét nào đang chạy.' }])
  })

  it('a stalled scan can be force-reset, only after confirming', async (t) => {
    const state = emptyServer({ scan: scanStatus(STALLED) })
    const open = await openPage(t, state)
    open.answerConfirm(false)
    let from = open.calls.length
    await press(button(open, SCAN_HEADING, 'Buộc gỡ kẹt'))
    assert.equal(open.confirms.length, 1)
    assert.match(open.confirms[0]!, /^Buộc gỡ kẹt job quét đang treo\?/)
    assert.deepEqual(wiresSince(open.calls, from), [], 'declined → nothing sent')

    open.answerConfirm(true)
    from = open.calls.length
    await press(button(open, SCAN_HEADING, 'Buộc gỡ kẹt'))
    assert.deepEqual(wiresSince(open.calls, from), ['POST /api/admin/media/scan-force-reset', 'GET /api/admin/media/scan-status', 'GET /api/admin/media/counts'])
    assert.deepEqual(open.toasts, [
      { type: 'success', message: 'Đã buộc dừng (treo ở scanning 100s) — có thể chạy lại ngay.' },
      { type: 'info', message: 'Đã hủy: Đã buộc dừng (treo ở scanning 100s) — có thể chạy lại ngay.' },
    ])
    assert.equal(buttons(open, SCAN_HEADING, 'Buộc gỡ kẹt').length, 0)
    from = open.calls.length
    await open.tick()
    assert.deepEqual(wiresSince(open.calls, from), [], 'polling stopped')
    noErrors(open)
  })

  it('a scan that is merely running (or started < 90 s ago) offers no force-reset', async (t) => {
    const open = await openPage(t, emptyServer({ scan: scanStatus({ done: 0 }) }))
    assert.equal(buttons(open, SCAN_HEADING, 'Buộc gỡ kẹt').length, 0)
  })

  it('a refused force-reset shows the server sentence', async (t) => {
    const open = await openPage(t, emptyServer({ scan: scanStatus(STALLED) }), call =>
      (wire(call) === 'POST /api/admin/media/scan-force-reset' ? h3Error(409, 'Job quét đã dừng rồi.') : undefined))
    await press(button(open, SCAN_HEADING, 'Buộc gỡ kẹt'))
    assert.deepEqual(open.toasts, [{ type: 'error', message: 'Job quét đã dừng rồi.' }])
    assert.equal(isDisabled(button(open, SCAN_HEADING, 'Buộc gỡ kẹt')), false)
  })

  it('shows errors, conflicts and files matched to an earlier scan', async (t) => {
    const open = await openPage(t, emptyServer({
      scan: scanStatus({
        errors: ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg', 'f.jpg'], legacyMatched: 3,
        conflicts: 2, conflictFiles: ['2026/10/x.jpg', '2026/10/y.jpg'], truncated: true,
      }),
    }))
    const text = sectionText(open, SCAN_HEADING)
    assert.match(text, /6 file lỗi: a\.jpg, b\.jpg, c\.jpg, d\.jpg, e\.jpg\.\.\./)
    assert.match(text, /3 tệp đã được lượt quét trước nhập lên R2 — không nhập lại\./)
    assert.match(text, /2 tệp trùng tên với ảnh đã có trên R2 — bỏ qua, không ghi đè: 2026\/10\/x\.jpg, 2026\/10\/y\.jpg/)
    assert.match(text, /Đạt giới hạn 5000 tệp — chạy lại để quét tiếp\./)
  })
})

// ─── Sync ────────────────────────────────────────────────────────────────────

describe('/admin/media/scan — local ↔ R2 sync', () => {
  it('"Đồng bộ lên R2" starts the job, follows it, and reports the result when it is done', async (t) => {
    const state = emptyServer()
    const open = await openPage(t, state)
    let from = open.calls.length
    await press(button(open, SYNC_HEADING, 'Đồng bộ lên R2'))
    assert.deepEqual(wiresSince(open.calls, from), ['POST /api/admin/media/sync-storage', 'GET /api/admin/media/sync-status'])
    assert.deepEqual(open.calls[from]!.body, { direction: 'to-r2' })
    assert.deepEqual(open.toasts, [{ type: 'info', message: 'Đã khởi tạo job sync. Đang chạy nền...' }])
    assert.equal(isDisabled(button(open, SYNC_HEADING, 'Đang chuyển lên R2...')), true)
    assert.equal(isDisabled(button(open, SYNC_HEADING, 'Đồng bộ về local')), true)
    assert.match(sectionText(open, SYNC_HEADING), /Đang backup trước sync/)
    assert.match(sectionText(open, SYNC_HEADING), /Đang chạy nền\. Có thể đóng trang — worker tiếp tục\. Mở lại sẽ thấy tiến độ\./)

    state.sync = syncStatus({ running: false, phase: 'done', done: 50, synced: 48, skipped: 2, articlesRewritten: 7, preBackupStamp: 'pre-sync-1', message: 'Xong' })
    from = open.calls.length
    await open.tick()
    assert.deepEqual(wiresSince(open.calls, from), ['GET /api/admin/media/sync-status', 'GET /api/admin/media/counts'])
    assert.deepEqual(lastToast(open), { type: 'success', message: 'Đã chuyển 48 ảnh sang R2, bỏ qua 2. Đã sửa URL trong 7 bài viết. Snapshot: pre-sync-1.' })
    const text = sectionText(open, SYNC_HEADING)
    assert.match(text, /Đã chuyển 48 Bỏ qua 2 Bài viết sửa URL 7/)
    assert.match(text, /Snapshot trước sync: pre-sync-1 \(giữ để recover thủ công\)/)
    assert.equal(isDisabled(button(open, SYNC_HEADING, 'Đồng bộ lên R2')), false)

    from = open.calls.length
    await open.tick()
    assert.deepEqual(wiresSince(open.calls, from), [], 'polling stopped with the job')
    noErrors(open)
  })

  it('"Đồng bộ về local" sends the other direction and says "local" when done', async (t) => {
    const state = emptyServer()
    const open = await openPage(t, state)
    const from = open.calls.length
    await press(button(open, SYNC_HEADING, 'Đồng bộ về local'))
    assert.deepEqual(open.calls[from]!.body, { direction: 'to-local' })
    assert.equal(isDisabled(button(open, SYNC_HEADING, 'Đang chuyển về local...')), true)
    state.sync = syncStatus({ direction: 'to-local', running: false, phase: 'done', synced: 5, skipped: 0, message: 'Xong' })
    await open.tick()
    assert.deepEqual(lastToast(open), { type: 'success', message: 'Đã chuyển 5 ảnh sang local.' })
    noErrors(open)
  })

  it('a sync refused by a restore in progress fails while polled, and its sentence reaches the toast', async (t) => {
    const state = emptyServer()
    const open = await openPage(t, state)
    await press(button(open, SYNC_HEADING, 'Đồng bộ lên R2'))
    state.sync = syncStatus({ running: false, phase: 'failed', done: 0, synced: 0, skipped: 0, message: restoreBlocked('đồng bộ ảnh') })
    await open.tick()
    assert.deepEqual(lastToast(open), { type: 'error', message: `Sync lỗi: ${restoreBlocked('đồng bộ ảnh')}` })
    assert.match(sectionText(open, SYNC_HEADING), /Lỗi/)
    assert.equal(isDisabled(button(open, SYNC_HEADING, 'Đồng bộ lên R2')), false)
    noErrors(open)
  })

  it('409 "already running" and 400 "R2 not configured": the server sentence, both buttons come back', async (t) => {
    let answer = () => h3Error(409, 'Một lượt đồng bộ khác đang chạy. Thử lại sau.')
    const open = await openPage(t, emptyServer(), call => (wire(call) === 'POST /api/admin/media/sync-storage' ? answer() : undefined))
    const from = open.calls.length
    await press(button(open, SYNC_HEADING, 'Đồng bộ lên R2'))
    assert.deepEqual(wiresSince(open.calls, from), ['POST /api/admin/media/sync-storage'])
    assert.deepEqual(open.toasts, [{ type: 'error', message: 'Một lượt đồng bộ khác đang chạy. Thử lại sau.' }])
    assert.equal(isDisabled(button(open, SYNC_HEADING, 'Đồng bộ lên R2')), false)
    assert.equal(isDisabled(button(open, SYNC_HEADING, 'Đồng bộ về local')), false)

    answer = () => h3Error(400, 'Cấu hình Cloudflare R2 chưa đầy đủ. Hãy kiểm tra /admin/settings/media-storage.')
    await press(button(open, SYNC_HEADING, 'Đồng bộ lên R2'))
    assert.deepEqual(lastToast(open), { type: 'error', message: 'Cấu hình Cloudflare R2 chưa đầy đủ. Hãy kiểm tra /admin/settings/media-storage.' })
    answer = () => dropped()
    await press(button(open, SYNC_HEADING, 'Đồng bộ lên R2'))
    assert.deepEqual(lastToast(open), { type: 'error', message: 'Lỗi khởi tạo sync' })
    noErrors(open)
  })

  it('"Hủy sync" asks the worker to stop; the poll then reports the cancellation', async (t) => {
    const state = emptyServer({ sync: syncStatus() })
    const open = await openPage(t, state)
    await press(button(open, SYNC_HEADING, 'Hủy sync'))
    assert.deepEqual(open.toasts, [{ type: 'info', message: 'Đã yêu cầu hủy. Worker sẽ dừng ở batch tiếp theo.' }])
    await open.tick()
    assert.equal(isDisabled(button(open, SYNC_HEADING, 'Đang dừng...')), true)
    state.sync = syncStatus({ running: false, phase: 'cancelled', message: 'Đã hủy ở 10/50' })
    await open.tick()
    assert.deepEqual(lastToast(open), { type: 'info', message: 'Đã hủy: Đã hủy ở 10/50' })
    assert.match(sectionText(open, SYNC_HEADING), /Đã chuyển 9 Bỏ qua 1 Bài viết sửa URL 0/)
    noErrors(open)
  })

  it('a failed sync cancel shows the server sentence', async (t) => {
    const open = await openPage(t, emptyServer({ sync: syncStatus() }), call =>
      (wire(call) === 'POST /api/admin/media/sync-cancel' ? dropped() : undefined))
    await press(button(open, SYNC_HEADING, 'Hủy sync'))
    assert.deepEqual(open.toasts, [{ type: 'error', message: 'Lỗi hủy sync' }])
  })

  it('[fixed by the split] "Hủy sync" after the job ended between two polls shows the server\'s answer, not "Đã yêu cầu hủy"', async (t) => {
    // RED on the base: the page ignored `{ ok: false }` (HTTP 200) and claimed a cancel was sent.
    const state = emptyServer({ sync: syncStatus() })
    const open = await openPage(t, state)
    state.sync = syncStatus({ running: false, phase: 'done', message: 'Xong' })
    await press(button(open, SYNC_HEADING, 'Hủy sync'))
    assert.deepEqual(open.toasts, [{ type: 'info', message: 'Không có job sync nào đang chạy.' }])
  })

  it('a stalled sync shows the hint and can be force-reset, only after confirming', async (t) => {
    const state = emptyServer({ sync: syncStatus({ ...STALLED, phase: 'backup' }) })
    const open = await openPage(t, state)
    assert.match(sectionText(open, SYNC_HEADING), /— Treo quá 90s ở backup, bấm "Buộc gỡ kẹt" để chạy lại ngay/)
    open.answerConfirm(false)
    let from = open.calls.length
    await press(button(open, SYNC_HEADING, 'Buộc gỡ kẹt'))
    assert.match(open.confirms[0]!, /^Buộc gỡ kẹt job sync đang treo\?/)
    assert.deepEqual(wiresSince(open.calls, from), [])

    open.answerConfirm(true)
    from = open.calls.length
    await press(button(open, SYNC_HEADING, 'Buộc gỡ kẹt'))
    assert.deepEqual(wiresSince(open.calls, from), ['POST /api/admin/media/sync-force-reset', 'GET /api/admin/media/sync-status', 'GET /api/admin/media/counts'])
    assert.deepEqual(open.toasts, [
      { type: 'success', message: 'Đã buộc dừng (treo ở backup 100s) — có thể chạy lại ngay.' },
      { type: 'info', message: 'Đã hủy: Đã buộc dừng (treo ở backup 100s) — có thể chạy lại ngay.' },
    ])
    noErrors(open)
  })

  it('a refused sync force-reset shows the server sentence', async (t) => {
    const open = await openPage(t, emptyServer({ sync: syncStatus(STALLED) }), call =>
      (wire(call) === 'POST /api/admin/media/sync-force-reset' ? h3Error(409, 'Job sync đã dừng rồi.') : undefined))
    await press(button(open, SYNC_HEADING, 'Buộc gỡ kẹt'))
    assert.deepEqual(open.toasts, [{ type: 'error', message: 'Job sync đã dừng rồi.' }])
  })
})

// ─── Repair, repoint, self-heal ──────────────────────────────────────────────

describe('/admin/media/scan — "Vá URL", "Đổi domain URL R2" and self-heal', () => {
  it('"Vá URL" asks first, shows progress, then the result and the snapshot, and re-reads the counts', async (t) => {
    let held: NetCall | undefined
    const open = await openPage(t, emptyServer(), (call) => {
      if (wire(call) === 'POST /api/admin/media/repair-urls') { held = call; return 'hold' }
      return undefined
    })
    open.answerConfirm(false)
    await press(button(open, REPAIR_HEADING, 'Vá URL all bài viết'))
    assert.match(open.confirms[0]!, /^Vá URL ảnh hỏng hàng loạt\?/)
    assert.equal(held, undefined, 'declined → nothing sent')

    open.answerConfirm(true)
    const from = open.calls.length
    await press(button(open, REPAIR_HEADING, 'Vá URL all bài viết'))
    assert.ok(held)
    assert.equal(held.body, undefined, 'no body')
    assert.equal(isDisabled(button(open, REPAIR_HEADING, 'Đang vá...')), true)
    assert.match(sectionText(open, REPAIR_HEADING), /Đang backup SQL \+ UPDATE\.\.\. \(< vài giây\)/)

    held.respond(json(REPAIR_OK))
    await settle()
    assert.deepEqual(wiresSince(open.calls, from), ['POST /api/admin/media/repair-urls', 'GET /api/admin/media/counts'])
    assert.deepEqual(open.toasts, [{ type: 'success', message: REPAIR_OK.message }])
    assert.match(sectionText(open, REPAIR_HEADING), /Media vá 4 Bài viết vá 12 Thumbnail vá 3 Snapshot 2026-10-25_09-00-00/)
    assert.equal(isDisabled(button(open, REPAIR_HEADING, 'Vá URL all bài viết')), false)
    noErrors(open)
  })

  it('"Vá URL" during a restore: the 409 sentence, no counts re-read, the button comes back', async (t) => {
    const open = await openPage(t, emptyServer(), call =>
      (wire(call) === 'POST /api/admin/media/repair-urls' ? h3Error(409, restoreBlocked('vá URL ảnh')) : undefined))
    const from = open.calls.length
    await press(button(open, REPAIR_HEADING, 'Vá URL all bài viết'))
    assert.deepEqual(wiresSince(open.calls, from), ['POST /api/admin/media/repair-urls'])
    assert.deepEqual(open.toasts, [{ type: 'error', message: restoreBlocked('vá URL ảnh') }])
    assert.equal(isDisabled(button(open, REPAIR_HEADING, 'Vá URL all bài viết')), false)
    noErrors(open)
  })

  it('"Đổi URL R2" needs both domains, refuses the same domain, asks with the typed text, sends it trimmed', async (t) => {
    const open = await openPage(t, emptyServer())
    const [oldInput, newInput] = findAll(section(open, REPOINT_HEADING), el => el.tag === 'input')
    assert.equal(isDisabled(button(open, REPOINT_HEADING, 'Đổi URL R2')), true, 'empty → disabled')

    await input(oldInput!, 'cdn.old.vn')
    await input(newInput!, '  cdn.old.vn ')
    await settle()
    await press(button(open, REPOINT_HEADING, 'Đổi URL R2'))
    assert.deepEqual(open.toasts, [{ type: 'error', message: 'Domain cũ và domain mới giống nhau.' }])
    assert.equal(open.confirms.length, 0)

    await input(newInput!, ' media.new.vn ')
    await settle()
    const from = open.calls.length
    await press(button(open, REPOINT_HEADING, 'Đổi URL R2'))
    assert.match(open.confirms[0]!, /^Đổi URL R2 từ "cdn\.old\.vn" sang " media\.new\.vn "\?\n\nSẽ đổi URL ảnh trong thư viện/)
    assert.deepEqual(wiresSince(open.calls, from), ['POST /api/admin/media/repoint-r2-urls'])
    assert.deepEqual(open.calls[from]!.body, { oldDomain: 'cdn.old.vn', newDomain: 'media.new.vn' })
    assert.deepEqual(lastToast(open), { type: 'success', message: REPOINT_OK.message })
    assert.match(sectionText(open, REPOINT_HEADING), /Ảnh sửa URL 210 Nội dung sửa URL 57 Snapshot 2026-10-25_09-10-00/)
    noErrors(open)
  })

  it('"Đổi URL R2" during a restore (409) or a busy job (409): the server sentence', async (t) => {
    let answer = () => h3Error(409, restoreBlocked('đổi domain'))
    const open = await openPage(t, emptyServer(), call => (wire(call) === 'POST /api/admin/media/repoint-r2-urls' ? answer() : undefined))
    const [oldInput, newInput] = findAll(section(open, REPOINT_HEADING), el => el.tag === 'input')
    await input(oldInput!, 'cdn.old.vn')
    await input(newInput!, 'media.new.vn')
    await settle()
    await press(button(open, REPOINT_HEADING, 'Đổi URL R2'))
    assert.deepEqual(lastToast(open), { type: 'error', message: restoreBlocked('đổi domain') })
    answer = () => h3Error(409, 'Đang có lượt đồng bộ ảnh, sửa URL, quét thư mục hoặc đổi domain khác chạy. Thử lại sau khi lượt đó xong.')
    await press(button(open, REPOINT_HEADING, 'Đổi URL R2'))
    assert.deepEqual(lastToast(open), { type: 'error', message: 'Đang có lượt đồng bộ ảnh, sửa URL, quét thư mục hoặc đổi domain khác chạy. Thử lại sau khi lượt đó xong.' })
    assert.equal(isDisabled(button(open, REPOINT_HEADING, 'Đổi URL R2')), false)
    noErrors(open)
  })

  it('self-heal "Xem trước" sends dryRun without asking and re-reads nothing; "Chạy sửa" asks, then re-reads the counts', async (t) => {
    const open = await openPage(t, emptyServer())
    let from = open.calls.length
    await press(button(open, SELF_HEAL_HEADING, 'Xem trước'))
    assert.equal(open.confirms.length, 0)
    assert.deepEqual(wiresSince(open.calls, from), ['POST /api/admin/media/self-heal'])
    assert.deepEqual(open.calls[from]!.body, { dryRun: true })
    assert.deepEqual(open.toasts, [{ type: 'success', message: selfHealOk(true).message }])
    let text = sectionText(open, SELF_HEAL_HEADING)
    assert.match(text, /Đã kiểm tra 300 ảnh R2 R2 OK 290 R2 thiếu 10 Đã upload lại 0 Mất gốc 2/)
    assert.match(text, /Mẫu thiếu \(2\): a\.jpg, b\.jpg/)

    open.answerConfirm(false)
    from = open.calls.length
    await press(button(open, SELF_HEAL_HEADING, 'Chạy sửa'))
    assert.match(open.confirms[0]!, /^Tự vá ảnh R2 thiếu \+ repoint thumbnail\?/)
    assert.deepEqual(wiresSince(open.calls, from), [], 'declined → nothing sent')

    open.answerConfirm(true)
    from = open.calls.length
    await press(button(open, SELF_HEAL_HEADING, 'Chạy sửa'))
    assert.deepEqual(wiresSince(open.calls, from), ['POST /api/admin/media/self-heal', 'GET /api/admin/media/counts'])
    assert.deepEqual(open.calls[from]!.body, { dryRun: false })
    text = sectionText(open, SELF_HEAL_HEADING)
    assert.match(text, /Thumbnail đổi sang ảnh mặc định 4 Snapshot 2026-10-25_09-20-00/)
    assert.match(text, /2 ảnh R2 thiếu object VÀ file local cũng không còn\. Đã đổi 4 thumbnail bài viết \+ 2 URL media sang ảnh mặc định/)
    noErrors(open)
  })

  it('self-heal during a restore (409): the server sentence, both buttons come back', async (t) => {
    const open = await openPage(t, emptyServer(), call =>
      (wire(call) === 'POST /api/admin/media/self-heal' ? h3Error(409, restoreBlocked('tự vá ảnh')) : undefined))
    await press(button(open, SELF_HEAL_HEADING, 'Chạy sửa'))
    assert.deepEqual(open.toasts, [{ type: 'error', message: restoreBlocked('tự vá ảnh') }])
    assert.equal(isDisabled(button(open, SELF_HEAL_HEADING, 'Xem trước')), false)
    assert.equal(isDisabled(button(open, SELF_HEAL_HEADING, 'Chạy sửa')), false)
    noErrors(open)
  })
})

// ─── Leaving the page ────────────────────────────────────────────────────────

describe('/admin/media/scan — leaving the page', () => {
  it('stops both polls', async (t) => {
    const open = await openPage(t, emptyServer({ scan: scanStatus(), sync: syncStatus() }))
    await open.tick()
    open.close()
    const from = open.calls.length
    await open.tick()
    await open.tick()
    await open.tick()
    assert.deepEqual(wiresSince(open.calls, from), [])
  })

  it('[fixed by the split] leaving while the first status reads are in flight starts no poll afterwards', async (t) => {
    // RED on the base: `onMounted` ran `pollStatus().then(() => { if (running) startPolling() })`;
    // an answer landing after `onUnmounted` started a 3-second interval nothing ever stopped.
    const held: NetCall[] = []
    const open = await openPage(t, emptyServer(), (call) => {
      if (call.url.pathname.endsWith('-status') && held.length < 2) { held.push(call); return 'hold' }
      return undefined
    })
    assert.equal(held.length, 2)
    open.close()
    held.find(call => call.url.pathname.endsWith('/sync-status'))!.respond(json({ ok: true, status: syncStatus() }))
    held.find(call => call.url.pathname.endsWith('/scan-status'))!.respond(json({ ok: true, status: scanStatus() }))
    await settle()
    const from = open.calls.length
    await open.tick()
    await open.tick()
    assert.deepEqual(wiresSince(open.calls, from), [])
  })

  it('[fixed by the split] leaving while "Bắt đầu quét" / "Đồng bộ lên R2" is in flight starts no poll afterwards', async (t) => {
    // RED on the base: `scanFolder`/`syncStorage` called `startPolling()` after the awaited POST.
    const held: NetCall[] = []
    const state = emptyServer()
    const open = await openPage(t, state, (call) => {
      if (call.method === 'POST') { held.push(call); return 'hold' }
      return undefined
    })
    await press(button(open, SCAN_HEADING, 'Bắt đầu quét'))
    await press(button(open, SYNC_HEADING, 'Đồng bộ lên R2'))
    assert.equal(held.length, 2)
    open.close()
    state.scan = scanStatus()
    state.sync = syncStatus()
    for (const call of held) call.respond(json({ ok: true, jobId: 'x', message: 'ok' }))
    await settle()
    const from = open.calls.length
    await open.tick()
    await open.tick()
    assert.deepEqual(wiresSince(open.calls, from), [])
  })

  it('leaving while "Bắt đầu quét" / "Đồng bộ lên R2" is in flight: the late answer reads no status and toasts nothing', async (t) => {
    // RED before the follow-up to the split (wave3 verify S1): the poll LOOP no longer starts
    // after leaving, but the answer still toasted "Đã khởi tạo job…" and read the status once
    // directly — on whatever page the officer had moved to, and that read can toast a job result.
    const held: NetCall[] = []
    const state = emptyServer()
    const open = await openPage(t, state, (call) => {
      if (call.method === 'POST') { held.push(call); return 'hold' }
      return undefined
    })
    await press(button(open, SCAN_HEADING, 'Bắt đầu quét'))
    await press(button(open, SYNC_HEADING, 'Đồng bộ lên R2'))
    assert.equal(held.length, 2)
    open.close()
    // Both jobs already finished by the time the answers land: a status read would toast them.
    state.scan = scanStatus({ running: false, phase: 'done', imported: 4, skipped: 0 })
    state.sync = syncStatus({ running: false, phase: 'done', synced: 7, skipped: 0 })
    const from = open.calls.length
    const toastsBefore = open.toasts.length
    for (const call of held) call.respond(json({ ok: true, jobId: 'x', message: 'ok' }))
    await settle()
    await open.tick()
    assert.deepEqual(wiresSince(open.calls, from), [], 'no status read after leaving')
    assert.deepEqual(open.toasts.slice(toastsBefore), [], 'no toast after leaving')
    noErrors(open)
  })
})

// ─── Shape ───────────────────────────────────────────────────────────────────

describe('/admin/media/scan — shape', () => {
  it('the page itself still fetches, so the error/skeleton coverage gates keep checking it', () => {
    assert.match(readFileSync(PAGE, 'utf8'), ADMIN_FETCH_CALL)
  })

  it('the panels under components/admin/media/scan are display-only: no fetch of their own', () => {
    // A scan over nothing is not a pass: a renamed/moved panels directory must turn this red.
    assert.ok(existsSync(PANELS_DIR), `${PANELS_DIR} does not exist — the panels moved; point this guard at them`)
    const files = readdirSync(PANELS_DIR).filter(name => name.endsWith('.vue'))
    assert.ok(files.length > 0, `${PANELS_DIR} holds no .vue panel — the scan below would check nothing`)
    for (const name of files) {
      assert.doesNotMatch(readFileSync(new URL(name, `file://${PANELS_DIR}`), 'utf8'), ADMIN_FETCH_CALL, `${name} fetches — keep requests in the page or its composable`)
    }
  })
})
