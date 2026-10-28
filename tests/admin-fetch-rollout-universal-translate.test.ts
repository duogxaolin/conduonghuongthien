/**
 * Wave 3 D-FETCH, batch D: the "Dịch toàn cục" tab of /admin/languages —
 * `components/admin/languages/UniversalTab.vue` (4 `$fetch` casts) — calls `adminFetch<T>()` with
 * response types derived from the handlers (app/types/admin-languages-api.ts).
 *
 * The REAL tab — `<script setup>` and template — is mounted (tests/_admin-page-harness.ts) over
 * REAL ofetch on a fake network, with `mock.timers` driving its 2 s status poll. Pinned, green
 * before and after the conversion: the mount's two reads, the start request's body, the cancel,
 * the poll, and that every failure toasts the server's sentence.
 *
 * FINDINGS, RED on the base (fb4751c1):
 *   - the four stat cards invented numbers: before the scan answered, and for good after it
 *     failed, they read "108" UI keys and "Kho CSDL có 1121 bài viết" (literals in the template),
 *     and a real 0 (no published article) read "Đang quét..." forever. They now show the
 *     scanned number, "Đang quét..." only while scanning, and "—" when the scan failed;
 *   - when the poll saw the task stop it toasted "Quá trình dịch toàn cục đã hoàn tất!" in green
 *     whatever the outcome — also after "Dừng tác vụ" and after a run that failed half-way. The
 *     task state tells them apart (`completedAt` is set only on success, `error` only on failure);
 *   - "Bắt đầu" while another officer's run was going: the server answered 200 `{ ok: false }`
 *     and the tab toasted the refusal as a SUCCESS. The endpoint now refuses with 409 and the
 *     service's sentence (tests/universal-translate-refusal-behavior.test.ts); the tab says it as an
 *     error and shows the run that is going;
 *   - leaving the tab while a status read was in flight: the answer "active" landed after
 *     `onUnmounted` had stopped the poll and started a new 2 s poll that nothing ever stopped —
 *     /admin kept polling the status endpoint until the browser tab was closed.
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'

import { byText, click, findAll, textOf } from './_sfc-mount.ts'
import {
  h3Error, json, mountAdminPage, OFETCH_LINE, routes, sent, settle, unmountAll, wire,
  type MountedAdminPage, type NetCall, type Responder,
} from './_admin-page-harness.ts'

beforeEach(() => mock.timers.enable({ apis: ['setInterval'] }))
afterEach(() => { unmountAll(); mock.timers.reset() })

type Route = (call: NetCall) => Response | Error | undefined

const TAB = 'components/admin/languages/UniversalTab.vue'
const COVERAGE = '/api/admin/system/translation-coverage'
const STATUS = '/api/admin/system/universal-translate-status'
const RUN = '/api/admin/system/universal-translate'
const CANCEL = '/api/admin/system/universal-translate-cancel'

const lang = (code: string, name: string, percent: number) => ({
  code, name, nativeName: name, uiMissing: 0, blocksMissing: 2, articlesMissing: 40, totalMissing: 42, percent,
})
const STATS = { totalArticles: 340, totalBlocks: 12, totalUiKeys: 581, languages: [lang('en', 'English', 95), lang('zh', '中文', 80)] }
const task = (over: Record<string, unknown> = {}) => ({
  active: false, phase: 'idle', currentItem: '', totalItems: 0, processedItems: 0, percent: 0, targetLangs: [],
  startedAt: null, completedAt: null, error: null, ...over,
})
const RUNNING = task({ active: true, phase: 'Dịch các bài viết...', totalItems: 10, processedItems: 3, percent: 30, targetLangs: ['en'] })

function server(overrides: Record<string, Route> = {}): Responder {
  return routes({
    [`GET ${COVERAGE}`]: () => json({ ok: true, stats: STATS }),
    [`GET ${STATUS}`]: () => json({ ok: true, task: task() }),
    [`POST ${RUN}`]: () => json({ ok: true, message: 'Đã bắt đầu tác vụ quét và dịch toàn cục trong nền!' }),
    [`POST ${CANCEL}`]: () => json({ ok: true, message: 'Đã yêu cầu dừng tác vụ dịch toàn cục.' }),
    ...overrides,
  })
}
const open = (responder = server()) => mountAdminPage(TAB, responder)
/** The four stat cards' big numbers, in order (UI, blocks, articles, then the scan card has none). */
const cardNumbers = (opened: MountedAdminPage) =>
  findAll(opened.page.root, el => typeof el.props.class === 'string' && el.props.class.startsWith('text-2xl font-black')).map(textOf)
const screen = (opened: MountedAdminPage) => textOf(opened.page.root)
const startButton = (opened: MountedAdminPage) => byText(opened.page.root, 'button', 'Dịch Toàn Cục Tự Động')
/** One 2 s tick of the tab's status poll. */
async function poll() {
  mock.timers.tick(2000)
  await settle()
}

describe(TAB, () => {
  it('mount: the coverage scan, then the task status; the cards and the language table show the scan', async () => {
    const opened = await open()
    assert.deepEqual(opened.calls.map(wire), [`GET ${COVERAGE}`, `GET ${STATUS}`])
    assert.deepEqual(cardNumbers(opened), ['581', '12', '340'])
    assert.match(screen(opened), /Kho CSDL có 340 bài viết/)
    assert.match(screen(opened), /Đã chọn 2 ngôn ngữ đích/)
    assert.match(screen(opened), /Thiếu 40 bài/)
  })

  it('FINDING: a failed scan leaves no invented number — the server\'s sentence, then "—"; a real 0 reads 0', async () => {
    const failed = await open(server({ [`GET ${COVERAGE}`]: () => h3Error(403, 'Bạn không có quyền xem thống kê dịch.') }))
    assert.equal(failed.lastToast('error'), 'Bạn không có quyền xem thống kê dịch.')
    assert.doesNotMatch(failed.lastToast('error') ?? '', OFETCH_LINE)
    assert.deepEqual(cardNumbers(failed), ['—', '—', '—'], 'numbers the database never said')
    assert.doesNotMatch(screen(failed), /1121|Đang quét\.\.\./)

    const zero = await open(server({ [`GET ${COVERAGE}`]: () => json({ ok: true, stats: { ...STATS, totalArticles: 0, totalBlocks: 0 } }) }))
    assert.deepEqual(cardNumbers(zero), ['581', '0', '0'])
    assert.match(screen(zero), /Kho CSDL có 0 bài viết/)

    const pending: NetCall[] = []
    const scanning = await open(server({ [`GET ${COVERAGE}`]: (call) => { pending.push(call); return undefined } }))
    assert.deepEqual(cardNumbers(scanning), ['Đang quét...', 'Đang quét...', 'Đang quét...'])
    pending[0]!.respond(json({ ok: true, stats: STATS }))
    await settle()
    assert.deepEqual(cardNumbers(scanning), ['581', '12', '340'])
  })

  it('start: POST the chosen languages and options; the server\'s sentence; the status, then the 2 s poll', async () => {
    const opened = await open()
    const before = opened.calls.length
    await click(startButton(opened))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [
      {
        wire: `POST ${RUN}`,
        body: { targetLangs: ['en', 'zh'], includeUi: true, includeBlocks: true, includeArticles: true, articlesLimit: 20, publishImmediately: false },
      },
      `GET ${STATUS}`,
    ])
    assert.equal(opened.lastToast('success'), 'Đã bắt đầu tác vụ quét và dịch toàn cục trong nền!')
  })

  it('FINDING: "Bắt đầu" while another run is going — the 409 is an error, and the running task is shown', async () => {
    let status = task()
    const opened = await open(server({
      [`GET ${STATUS}`]: () => json({ ok: true, task: status }),
      [`POST ${RUN}`]: () => { status = RUNNING; return h3Error(409, 'Một tác vụ quét và dịch toàn cục đang chạy.') },
    }))
    const before = opened.calls.length
    await click(startButton(opened))
    await settle()
    assert.equal(opened.lastToast('error'), 'Một tác vụ quét và dịch toàn cục đang chạy.')
    assert.equal(opened.lastToast('success'), undefined)
    assert.deepEqual(sent(opened.calls, before).slice(1), [`GET ${STATUS}`], 'the status is read again')
    assert.match(screen(opened), /Dịch các bài viết\.\.\./)
    assert.match(screen(opened), /30%/)
  })

  it('cancel: POST, the server\'s sentence as info, then the status', async () => {
    const opened = await open(server({ [`GET ${STATUS}`]: () => json({ ok: true, task: RUNNING }) }))
    const before = opened.calls.length
    await click(byText(opened.page.root, 'button', 'Dừng tác vụ'))
    await settle()
    assert.deepEqual(sent(opened.calls, before), [`POST ${CANCEL}`, `GET ${STATUS}`])
    assert.equal(opened.lastToast('info'), 'Đã yêu cầu dừng tác vụ dịch toàn cục.')

    const refused = await open(server({ [`GET ${STATUS}`]: () => json({ ok: true, task: RUNNING }), [`POST ${CANCEL}`]: () => h3Error(403, 'Forbidden: Insufficient permissions') }))
    await click(byText(refused.page.root, 'button', 'Dừng tác vụ'))
    await settle()
    assert.equal(refused.lastToast('error'), 'Forbidden: Insufficient permissions')
  })

  for (const [outcome, ended, type, sentence] of [
    ['completed', { phase: 'Hoàn tất', percent: 100, completedAt: '2026-10-28T03:00:00.000Z' }, 'success', 'Quá trình dịch toàn cục đã hoàn tất!'],
    ['cancelled', { phase: 'Đã dừng', currentItem: 'Tác vụ đã được dừng theo yêu cầu của quản trị viên.' }, 'info', 'Đã dừng tác vụ dịch toàn cục.'],
    ['failed', { phase: 'Dịch các bài viết...', error: 'ER_LOCK_WAIT_TIMEOUT' }, 'error', 'Tác vụ dịch toàn cục gặp lỗi và đã dừng giữa chừng.'],
  ] as const) {
    it(`${outcome === 'completed' ? '' : 'FINDING: '}the poll sees the task ${outcome} — says so (${type}), stops polling, rescans`, async () => {
      let status = RUNNING
      const opened = await open(server({ [`GET ${STATUS}`]: () => json({ ok: true, task: status }) }))
      await poll()
      assert.equal(opened.toasts.length, 0, 'still running: nothing said')
      status = task(ended)
      const before = opened.calls.length
      await poll()
      assert.deepEqual(opened.calls.slice(before).map(wire), [`GET ${STATUS}`, `GET ${COVERAGE}`, `GET ${STATUS}`])
      assert.deepEqual(opened.toasts, [{ type, message: sentence }])
      const after = opened.calls.length
      await poll()
      assert.equal(opened.calls.length, after, 'the poll stopped')
    })
  }

  it('FINDING: leaving the tab while a status read is in flight does not leave a poll running', async () => {
    const pending: NetCall[] = []
    const opened = await open(server({ [`GET ${STATUS}`]: (call) => { pending.push(call); return undefined } }))
    assert.equal(pending.length, 1)
    opened.page.unmount()
    pending[0]!.respond(json({ ok: true, task: RUNNING }))
    await settle()
    const before = opened.calls.length
    await poll()
    await poll()
    assert.equal(opened.calls.length, before, 'the unmounted tab keeps polling the status endpoint')
  })
})
