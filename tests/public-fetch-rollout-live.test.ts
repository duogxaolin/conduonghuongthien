/**
 * D-FETCH lot G — the livestream reads/writes after their casts became `publicFetch<T>()`:
 * the "on air" status of `LiveHero` (the /media hero) and `LiveTickerBar` (the layout
 * ticker), and the live chat's history read and send (`useLiveChat`).
 *
 * All of them run in the BROWSER only (after mount / on a click): `/media` is an `swr` route
 * and a broadcast starts and ends inside its 60 s window. Pinned with the real components
 * (tests/_public-mount-harness.ts) / the real composable over REAL ofetch:
 *   - the wire, and that the status poll is made outside `useAsyncData` (`via: 'direct'`);
 *   - the poll's own options reach ofetch: `retry: 0` (a 503 is asked ONCE, not twice) and
 *     `timeout: 4000` (a hung request is dropped at 4 s and reads as "not live");
 *   - every failure falls back silently (no alert), as the components document;
 *   - the chat send's error reasons by status (401/409/429), its JSON body, the history's
 *     `?limit=50`.
 * Green on the base tree (5f1bb07d, casts) and on lot G alike.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createFetch } from 'ofetch'

import { dropped, h3Error, HOLD, json, mountPublic, routes, sent, settle, words, type NetCall } from './_public-mount-harness.ts'

const ON_AIR = {
  ok: true,
  active: true,
  session: {
    id: 7, title: 'Buổi phát thử', description: null, source: 'youtube', embedUrl: 'https://www.youtube-nocookie.com/embed/abc',
    streamUrl: '', thumbnailUrl: null, startedAt: '2026-10-29T02:00:00.000Z',
  },
}
const OFF_AIR = { ok: true, active: false, session: null }

/** The visibility-aware poller, reduced to "poll once now when enabled" — the timing is its own suite's (live-status-polling). */
const POLLER = {
  browserPollerEnv: () => ({}),
  createVisiblePoller: (fn: () => void) => ({ start: (enabled: boolean) => { if (enabled) fn() }, setEnabled: (enabled: boolean) => { if (enabled) fn() }, stop: () => {} }),
}
const HLS = { attachHlsStream: async () => ({ ok: true }), detachHlsStream: () => {} }

async function openLive(t: Parameters<typeof mountPublic>[0], file: 'components/LiveHero.vue' | 'components/LiveTickerBar.vue', active: (call: NetCall) => Response | Error | typeof HOLD, path = '/') {
  const ctx = await mountPublic(t, {
    file,
    route: { path },
    responder: routes({ 'GET /api/public/livestream/active': active }),
    modules: { '~/utils/visible-poller': POLLER, '~/composables/useHlsVideo': HLS },
  })
  await settle()
  return ctx
}

for (const file of ['components/LiveHero.vue', 'components/LiveTickerBar.vue'] as const) {
  describe(`${file} — the on-air status over publicFetch`, () => {
    it('asks once after mount (not in useAsyncData), shows the broadcast title', async (t) => {
      const ctx = await openLive(t, file, () => json(ON_AIR))
      assert.deepEqual(ctx.registrations, [], 'no useAsyncData: the status never enters the cached HTML')
      assert.deepEqual(sent(ctx.calls), ['direct: GET /api/public/livestream/active'])
      assert.match(words(ctx.page), /Buổi phát thử/)
    })

    it('a 503 is asked ONCE (`retry: 0` reaches ofetch) and reads as "not live", silently', async (t) => {
      const ctx = await openLive(t, file, () => h3Error(503, 'Service Unavailable'))
      assert.equal(ctx.calls.length, 1)
      assert.doesNotMatch(words(ctx.page), /Buổi phát thử/)
      assert.equal(ctx.page.root.children.some(child => child.kind === 'element' && child.props.role === 'alert'), false)
      assert.deepEqual(ctx.page.errors, [])
    })

    it('off air, `ok: false`, a dropped connection: nothing about a broadcast', async (t) => {
      for (const answer of [() => json(OFF_AIR), () => json({ ok: false, active: false, session: null }, 503), () => dropped()]) {
        const ctx = await openLive(t, file, answer)
        assert.doesNotMatch(words(ctx.page), /Buổi phát thử/)
        assert.deepEqual(ctx.page.errors, [])
        ctx.close()
      }
    })

    it('`timeout: 4000` reaches ofetch: a hung status request is dropped at 4 s', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] })
      const ctx = await openLive(t, file, () => HOLD)
      assert.equal(ctx.calls.length, 1)
      t.mock.timers.tick(3999)
      await settle()
      const call = ctx.calls[0]!
      let aborted = false
      // The request is still open at 3.999 s: answering it now would still be read.
      t.mock.timers.tick(1)
      await settle()
      call.respond(json(ON_AIR))
      await settle()
      aborted = !/Buổi phát thử/.test(words(ctx.page))
      assert.equal(aborted, true, 'the answer that came after 4 s was not read')
    })

    it('… and an answer at 3.999 s is still read (the timeout is 4 s, not less)', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] })
      const ctx = await openLive(t, file, () => HOLD)
      t.mock.timers.tick(3999)
      await settle()
      ctx.calls[0]!.respond(json(ON_AIR))
      await settle()
      assert.match(words(ctx.page), /Buổi phát thử/)
    })
  })
}

describe('LiveTickerBar on /media', () => {
  it('does not poll where LiveHero already shows the broadcast', async (t) => {
    const ctx = await openLive(t, 'components/LiveTickerBar.vue', () => json(ON_AIR), '/media')
    assert.equal(ctx.calls.length, 0)
  })
})

// ─── useLiveChat ─────────────────────────────────────────────────────────────

type Listener = (ev: { data: string }) => void
class FakeEventSource {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2
  static instances: FakeEventSource[] = []
  readyState = FakeEventSource.CONNECTING
  onerror: (() => void) | null = null
  private listeners = new Map<string, Listener[]>()
  url: string
  constructor(url: string) { this.url = url; FakeEventSource.instances.push(this) }
  addEventListener(name: string, fn: Listener) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]) }
  close() { this.readyState = FakeEventSource.CLOSED }
  emit(name: string, data: unknown) { for (const fn of this.listeners.get(name) ?? []) fn({ data: JSON.stringify(data) }) }
}

type ChatCall = { method: string, wire: string, body: unknown }
function chatNetwork(answer: (call: ChatCall) => Response | Error) {
  const calls: ChatCall[] = []
  const g = globalThis as Record<string, unknown>
  const before = { fetch: g.$fetch, es: g.EventSource }
  g.EventSource = FakeEventSource
  g.$fetch = createFetch({
    fetch: (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://portal.test')
      const call = { method: (init.method ?? 'GET').toUpperCase(), wire: `${url.pathname}${url.search}`, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined }
      calls.push(call)
      const result = answer(call)
      if (result instanceof Error) throw result
      return result
    }) as typeof fetch,
  })
  return { calls, restore: () => { g.$fetch = before.fetch; g.EventSource = before.es } }
}

async function openRoom(answer: (call: ChatCall) => Response | Error) {
  const net = chatNetwork(answer)
  const { useLiveChat } = await import('../app/composables/useLiveChat.ts')
  const chat = useLiveChat()
  FakeEventSource.instances.length = 0
  const connecting = chat.connect()
  const source = FakeEventSource.instances.at(-1)!
  source.readyState = FakeEventSource.OPEN
  source.emit('ready', { sessionId: 7, title: 'Buổi phát' })
  await connecting
  return { chat, net, source }
}

const HISTORY = { ok: true, sessionId: 7, messages: [{ id: 1, displayName: 'Khách', content: 'Xin chào', createdAt: '2026-10-29T02:01:00.000Z' }] }

describe('useLiveChat over publicFetch', () => {
  it('history: GET ?limit=50 after `ready`; the messages join the room', async (t) => {
    const room = await openRoom(call => (call.wire.startsWith('/api/public/livestream/chat/history') ? json(HISTORY) : json({}, 404)))
    t.after(room.net.restore)
    assert.deepEqual(room.net.calls.map(c => `${c.method} ${c.wire}`), ['GET /api/public/livestream/chat/history?limit=50'])
    assert.deepEqual(room.chat.messages.value.map(m => m.content), ['Xin chào'])
    assert.equal(room.chat.historyError.value, '')
  })

  it('send: POST { content, sessionId }; accepted → the optimistic line goes (the stream brings the real one)', async (t) => {
    const room = await openRoom(call => (call.method === 'POST' ? json({ ok: true, id: 99 }) : json(HISTORY)))
    t.after(room.net.restore)
    const result = await room.chat.sendMessage('  Chào buổi phát  ')
    assert.deepEqual(result, { ok: true })
    assert.deepEqual(room.net.calls.at(-1), { method: 'POST', wire: '/api/public/livestream/chat/send', body: { content: 'Chào buổi phát', sessionId: 7 } })
    assert.deepEqual(room.chat.messages.value.map(m => m.content), ['Xin chào'])
  })

  for (const [status, reason] of [
    [401, 'Vui lòng đăng nhập để gửi tin nhắn.'],
    [409, 'Không có buổi phát nào đang chạy.'],
    [429, 'Bạn gửi quá nhanh. Vui lòng đợi một chút rồi gửi lại.'],
    [500, 'Không gửi được tin nhắn. Vui lòng thử lại sau.'],
  ] as const) {
    it(`send refused ${status}: the reason is read from the status of the SAME error, on the line itself`, async (t) => {
      const room = await openRoom(call => (call.method === 'POST' ? h3Error(status, 'x') : json(HISTORY)))
      t.after(room.net.restore)
      const result = await room.chat.sendMessage('Tin nhắn')
      assert.deepEqual(result, { ok: false, reason })
      const line = room.chat.messages.value.at(-1)!
      assert.equal(line.content, 'Tin nhắn')
      assert.equal(line.error, reason)
      assert.equal(room.net.calls.filter(c => c.method === 'POST').length, 1, 'a refused POST is not retried')
    })
  }

  it('send: a dropped connection and an `ok: false` answer each say so on the line', async (t) => {
    let post: () => Response | Error = () => dropped()
    const room = await openRoom(call => (call.method === 'POST' ? post() : json(HISTORY)))
    t.after(room.net.restore)
    assert.deepEqual(await room.chat.sendMessage('Một'), { ok: false, reason: 'Không gửi được tin nhắn. Vui lòng thử lại sau.' })
    post = () => json({ ok: false })
    assert.deepEqual(await room.chat.sendMessage('Hai'), { ok: false, reason: 'Không gửi được tin nhắn.' })
  })
})
