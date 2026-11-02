/**
 * "Lưu buổi phát thành mục media" (CHANGELOG § 67): `POST /api/admin/livestream/:id/recording`
 * had no caller in `app/`. It now has one: `components/admin/livestream/LivestreamRecordingCard.vue`,
 * shown by `pages/admin/livestream/index.vue` for the broadcast the page has just stopped.
 *
 * The REAL page and card over REAL ofetch on a fake network (tests/_admin-page-harness.ts).
 * Pinned — each against the route's own rules (`saveSessionAsRecording`), nothing guessed:
 *   - no card while a broadcast runs (the route refuses a running one, 409) and none before a stop;
 *   - after a stop: `POST /api/admin/livestream/<that id>/recording`, no body; the stop's own
 *     requests unchanged;
 *   - an HLS broadcast (`source: 'upload'` — always 409 `recording_required`) gets no button,
 *     only the route's advice;
 *   - the button needs BOTH `livestream/update` and `media_portal/create` (the route checks
 *     both); the link to the new item needs `media_portal/read`;
 *   - 201 → "bản nháp" with a link to `/admin/media-portal/<mediaItemId>`, and the button is
 *     gone (a second save would orphan the first draft — the route refuses it, 409);
 *   - a refusal shows the server's sentence in `role="alert"`, never ofetch's line, and the
 *     button is usable again; a double click sends one request.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import * as Vue from 'vue'

import { adminFetch } from '../app/composables/adminFetch.ts'
import { errorMessage } from '../app/utils/errorMessage.ts'
import { byText, click, findAll, fire, mountSfc, textOf } from './_sfc-mount.ts'
import {
  alertText, dropped, h3Error, json, mountAdminPage, OFETCH_LINE, routes, sent, settle, unmountAll,
  type MountedAdminPage, type NetCall,
} from './_admin-page-harness.ts'

afterEach(unmountAll)

type Route = (call: NetCall) => Response | Error | undefined
const LIVESTREAM = 'pages/admin/livestream/index.vue'
const RECORDING_URL = '/api/admin/livestream/9/recording'
const EMBED = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?modestbranding=1&rel=0&playsinline=1'
const youtubeSession = (overrides: Record<string, unknown> = {}) => ({
  id: 9, title: 'Hội nghị tổng kết', description: null, source: 'youtube', embedUrl: EMBED, streamUrl: '', thumbnailUrl: null, startedAt: null, ...overrides,
})
const hlsSession = () => youtubeSession({ source: 'upload', embedUrl: null, streamUrl: '/api/public/livestream/9/stream' })

function livestreamServer(state: { session: Record<string, unknown> | null }, overrides: Record<string, Route> = {}) {
  return routes({
    'GET /api/public/livestream/active': () => json(state.session ? { ok: true, active: true, session: state.session } : { ok: true, active: false, session: null }),
    'GET /api/public/livestream/chat/history': () => json(state.session ? { ok: true, sessionId: 9, messages: [] } : { ok: true, sessionId: null, messages: [] }),
    'POST /api/admin/livestream/stop': () => { state.session = null; return json({ ok: true, sessionId: 9 }) },
    [`POST ${RECORDING_URL}`]: () => json({ ok: true, mediaItemId: 77, slug: 'hoi-nghi-tong-ket' }, 201),
    ...overrides,
  })
}

/** Mount with a broadcast running, then stop it through the page's own button. */
async function stopped(session = youtubeSession(), overrides: Record<string, Route> = {}, can?: (r: string, a: string) => boolean) {
  const opened = await mountAdminPage(LIVESTREAM, livestreamServer({ session }, overrides), { can })
  await click(byText(opened.page.root, 'button', 'Dừng buổi phát'))
  await settle()
  return opened
}
const card = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'section' && el.props['aria-labelledby'] === 'ls-ended-title')[0]
const saveButtons = (opened: MountedAdminPage) => findAll(opened.page.root, el => el.tag === 'button' && /Lưu thành mục media|Đang lưu…/.test(textOf(el)))
const recordingCalls = (opened: MountedAdminPage) => opened.calls.filter(c => c.url.pathname.endsWith('/recording'))
function assertOnlyServerSentences(opened: MountedAdminPage) {
  for (const t of opened.toasts) assert.doesNotMatch(t.message, OFETCH_LINE, `toast "${t.message}"`)
  assert.doesNotMatch(alertText(opened.page), OFETCH_LINE)
}

describe('pages/admin/livestream/index.vue — save the stopped broadcast as a media item', () => {
  it('no card while a broadcast is running, nor with none at all', async () => {
    const running = await mountAdminPage(LIVESTREAM, livestreamServer({ session: youtubeSession() }))
    // A tag, not the node: a failing message must not have to print the whole cyclic tree.
    assert.equal(card(running)?.tag, undefined)
    assert.equal(saveButtons(running).length, 0)
    const idle = await mountAdminPage(LIVESTREAM, livestreamServer({ session: null }))
    assert.equal(card(idle)?.tag, undefined)
  })

  it('after a stop: the card names the broadcast; the stop sent only what it sent before (no recording request on its own)', async () => {
    const opened = await stopped()
    assert.deepEqual(sent(opened.calls, 2), [
      { wire: 'POST /api/admin/livestream/stop', body: { sessionId: 9 } },
      'GET /api/public/livestream/active',
    ])
    assert.match(textOf(card(opened)!), /Buổi phát vừa kết thúc/)
    assert.match(textOf(card(opened)!), /Hội nghị tổng kết/)
    assert.equal(saveButtons(opened).length, 1)
    assert.equal(recordingCalls(opened).length, 0)
  })

  it('save: POST /api/admin/livestream/<id>/recording with no body → "bản nháp" + a link to the new item; the button is gone', async () => {
    const opened = await stopped()
    const before = opened.calls.length
    await click(saveButtons(opened)[0]!)
    await settle()
    assert.deepEqual(sent(opened.calls, before), [`POST ${RECORDING_URL}`])
    assert.equal(opened.calls.at(-1)!.body, undefined, 'the route reads the id from the path; nothing in the body')
    const status = findAll(card(opened)!, el => el.props.role === 'status')[0]!
    assert.match(textOf(status), /Đã lưu thành mục media ở trạng thái bản nháp\./)
    const link = findAll(status, el => el.tag === 'NuxtLink')[0]!
    assert.equal(link.props.to, '/admin/media-portal/77')
    assert.equal(saveButtons(opened).length, 0, 'a second save would orphan the first draft')
    assert.equal(alertText(opened.page), '')
  })

  it('HLS broadcast: no button — the route always refuses it — and its advice instead', async () => {
    const opened = await stopped(hlsSession())
    assert.ok(card(opened))
    assert.equal(saveButtons(opened).length, 0)
    assert.match(textOf(card(opened)!), /Luồng HLS trực tiếp không phải bản ghi/)
    assert.match(textOf(card(opened)!), /tải lên Thư viện Media/)
  })

  it('both permissions the route checks gate the button: without media_portal/create, or without livestream/update, none', async () => {
    const noMedia = await stopped(youtubeSession(), {}, (r, a) => !(r === 'media_portal' && a === 'create'))
    assert.ok(card(noMedia))
    assert.equal(saveButtons(noMedia).length, 0)
    assert.match(textOf(card(noMedia)!), /cần quyền sửa buổi phát trực tiếp và quyền thêm mục vào Thư viện Media/)

    // Without livestream/update the page shows no "Dừng" (its own gate), so the card is
    // mounted alone: the second half of the route's pair must gate it too.
    const alone = await mountSfc(new URL('../app/components/admin/livestream/LivestreamRecordingCard.vue', import.meta.url).pathname, {
      auto: {
        ref: Vue.ref, computed: Vue.computed, adminFetch, errorMessage,
        useAdminAuth: () => ({ hasPermission: (r: string, a: string) => !(r === 'livestream' && a === 'update') }),
      },
    }, { session: { id: 9, title: 'Hội nghị', source: 'youtube' } })
    assert.equal(findAll(alone.root, el => el.tag === 'button').length, 0)
    assert.match(textOf(alone.root), /cần quyền sửa buổi phát trực tiếp/)
    alone.unmount()
  })

  it('saved without media_portal/read: the note, but no link to a page the officer cannot open', async () => {
    const opened = await stopped(youtubeSession(), {}, (r, a) => !(r === 'media_portal' && a === 'read'))
    await click(saveButtons(opened)[0]!)
    await settle()
    assert.match(textOf(card(opened)!), /bản nháp/)
    assert.equal(findAll(card(opened)!, el => el.tag === 'NuxtLink').length, 0)
  })

  it('refused (409: saved meanwhile by another officer): the server\'s sentence in role="alert", the button usable again; dropped → the fallback', async () => {
    const opened = await stopped(youtubeSession(), { [`POST ${RECORDING_URL}`]: () => h3Error(409, 'Buổi phát này đã được lưu thành bản ghi.') })
    await click(saveButtons(opened)[0]!)
    await settle()
    assert.equal(alertText(opened.page), 'Buổi phát này đã được lưu thành bản ghi.')
    assert.equal(findAll(card(opened)!, el => el.props.role === 'status').length, 0)
    assert.notEqual(saveButtons(opened)[0]!.props.disabled, true)
    assertOnlyServerSentences(opened)

    const dead = await stopped(youtubeSession(), { [`POST ${RECORDING_URL}`]: () => dropped() })
    await click(saveButtons(dead)[0]!)
    await settle()
    assert.equal(alertText(dead.page), 'Không thể lưu buổi phát thành mục media.')
    assertOnlyServerSentences(dead)
  })

  it('a retry after a refusal clears the old alert as it starts, not only when it succeeds', async () => {
    let pending: NetCall | undefined
    let refuse = true
    const opened = await stopped(youtubeSession(), {
      [`POST ${RECORDING_URL}`]: (call) => {
        if (refuse) return h3Error(409, 'Buổi phát này đã được lưu thành bản ghi.')
        pending = call
        return undefined
      },
    })
    await click(saveButtons(opened)[0]!)
    await settle()
    assert.notEqual(alertText(opened.page), '')
    refuse = false
    const retry = fire(saveButtons(opened)[0]!, 'click')
    await settle()
    assert.equal(alertText(opened.page), '', 'the old refusal stays on screen while the retry is out')
    pending!.respond(json({ ok: true, mediaItemId: 78, slug: 'x' }, 201))
    await retry
    await settle()
    assert.equal(alertText(opened.page), '')
    assert.equal(findAll(card(opened)!, el => el.tag === 'NuxtLink')[0]!.props.to, '/admin/media-portal/78')
  })

  it('a double click sends one request: disabled and "Đang lưu…" while it is out', async () => {
    let pending: NetCall | undefined
    const opened = await stopped(youtubeSession(), { [`POST ${RECORDING_URL}`]: (call) => { pending = call; return undefined } })
    const button = saveButtons(opened)[0]!
    const first = fire(button, 'click')
    await settle()
    assert.equal(button.props.disabled, true)
    assert.match(textOf(button), /Đang lưu…/)
    // `fire`, not `click`: past the disabled attribute, to reach the handler's own guard.
    // Not awaited: a second request would stay pending, and the test must fail, not hang.
    void fire(button, 'click')
    await settle()
    assert.equal(recordingCalls(opened).length, 1)
    pending!.respond(json({ ok: true, mediaItemId: 77, slug: 'x' }, 201))
    await first
    await settle()
    assert.equal(recordingCalls(opened).length, 1)
    assert.equal(saveButtons(opened).length, 0)
  })
})
