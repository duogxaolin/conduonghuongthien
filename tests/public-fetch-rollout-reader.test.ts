/**
 * D-FETCH lot G — the reader's composables after their casts became `publicFetch<T>()`:
 * `useReaderAuth` (who is signed in, claim-chats, sign-out) and `useReaderNotifications`
 * (the bell and the /profile list). The REAL modules, a fresh copy per test (their state is
 * module-level), over REAL ofetch on a fake network.
 *
 * What is pinned is what a reader can tell apart — the requests on the wire (method, path,
 * query, JSON body), what the composables hold afterwards, and which failures stay silent:
 *   - `load()` asks `/me` once; a failed lookup is "not signed in", never an error;
 *   - a confirmed reader triggers the one claim of this device's chat tickets;
 *   - `signOut()` posts the logout and forgets the reader even when the post fails;
 *   - a 401 of the notification list is rethrown AS THE SAME error (the page reads its
 *     status with `errorStatus()` and drops the identity); a 403 (ban) is not;
 *   - mark-read writes are optimistic and swallow failures.
 * These run green on the base tree (5f1bb07d, the casts) and on lot G alike: the move
 * changed the callee, nothing a reader can see. /profile itself is pinned by the mount
 * suites of tests/_reader-profile-harness.ts.
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createFetch } from 'ofetch'

import { errorStatus } from '../app/utils/errorMessage.ts'

type Call = { method: string, wire: string, body: unknown }
type Answer = Response | Error | undefined

const g = globalThis as Record<string, unknown>
const saved = new Map<string, PropertyDescriptor | undefined>()
function setGlobal(name: string, value: unknown) {
  if (!saved.has(name)) saved.set(name, Object.getOwnPropertyDescriptor(g, name))
  Object.defineProperty(g, name, { value, configurable: true, writable: true })
}
afterEach(() => {
  for (const [name, before] of saved) {
    if (before) Object.defineProperty(g, name, before)
    else delete g[name]
  }
  saved.clear()
})

const json = (body: unknown, status = 200, statusText = 'OK') =>
  new Response(JSON.stringify(body), { status, statusText, headers: { 'content-type': 'application/json' } })
const h3Error = (statusCode: number, statusMessage: string) =>
  json({ statusCode, statusMessage, message: statusMessage }, statusCode, statusMessage.replace(/[^\t\x20-\x7E]/g, ''))

function network(answer: (call: Call) => Answer) {
  const calls: Call[] = []
  const fetchImpl = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(raw, 'http://portal.test')
    const call = { method: (init.method ?? 'GET').toUpperCase(), wire: `${url.pathname}${url.search}`, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body }
    calls.push(call)
    const result = answer(call) ?? json({ statusCode: 404, statusMessage: 'Not Found' }, 404, 'Not Found')
    if (result instanceof Error) throw result
    return result
  }
  setGlobal('$fetch', createFetch({ fetch: fetchImpl as typeof fetch }))
  return calls
}

function storage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed))
  return {
    map,
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => { map.set(key, String(value)) },
    removeItem: (key: string) => { map.delete(key) },
  }
}

let copy = 0
async function fresh<T>(name: string): Promise<T> {
  const url = pathToFileURL(fileURLToPath(new URL(`../app/composables/${name}.ts`, import.meta.url)))
  url.search = `?lot-g=${++copy}`
  return await import(url.href) as T
}
type ReaderAuthModule = typeof import('../app/composables/useReaderAuth.ts')
type NotificationsModule = typeof import('../app/composables/useReaderNotifications.ts')

const ME = {
  ok: true,
  reader: { displayName: 'Nguyễn Văn A', email: 'a@example.com', customDisplayName: null, initials: 'NA', emailNotifications: true },
}
const settle = () => new Promise(resolve => setImmediate(resolve))

describe('useReaderAuth over publicFetch', () => {
  let local: ReturnType<typeof storage>
  let session: ReturnType<typeof storage>
  beforeEach(() => {
    local = storage({ cdkt_sessions_v1: JSON.stringify({ sessions: [{ id: 1, token: 'tok-a' }, { id: 2, token: null }, { id: 3, token: 'tok-b' }] }) })
    session = storage()
    setGlobal('window', { location: { pathname: '/news/x', search: '' } })
    setGlobal('localStorage', local)
    setGlobal('sessionStorage', session)
  })

  it('load(): GET /me once, holds the reader, then claims this device\'s tickets once', async () => {
    const calls = network(call => (call.wire === '/api/public/reader/me' ? json(ME) : call.wire === '/api/public/reader/claim-chats' ? json({ ok: true, claimed: 2, verified: 2 }) : undefined))
    const { useReaderAuth } = await fresh<ReaderAuthModule>('useReaderAuth')
    const auth = useReaderAuth()
    await auth.load()
    await settle()
    await auth.load()
    assert.deepEqual(calls.map(c => `${c.method} ${c.wire}`), ['GET /api/public/reader/me', 'POST /api/public/reader/claim-chats'])
    assert.deepEqual(calls[1]!.body, { sessions: [{ token: 'tok-a' }, { token: 'tok-b' }] })
    assert.equal(auth.reader.value?.displayName, 'Nguyễn Văn A')
    assert.equal(auth.isSignedIn.value, true)
    assert.equal(auth.loaded.value, true)
    assert.equal(auth.failed.value, false)
    assert.equal(session.map.get('cdkt_chats_claimed_v1'), '1')
  })

  it('load(): signed out (`reader: null`) — no claim is sent', async () => {
    const calls = network(call => (call.wire === '/api/public/reader/me' ? json({ ok: true, reader: null }) : undefined))
    const { useReaderAuth } = await fresh<ReaderAuthModule>('useReaderAuth')
    const auth = useReaderAuth()
    await auth.load()
    await settle()
    assert.deepEqual(calls.map(c => `${c.method} ${c.wire}`), ['GET /api/public/reader/me'])
    assert.equal(auth.isSignedIn.value, false)
    assert.equal(auth.loaded.value, true)
  })

  it('load(): a failed lookup is "not signed in" + failed, never a throw; force reloads', async () => {
    let up = false
    const calls = network(call => (call.wire === '/api/public/reader/me' ? (up ? json(ME) : h3Error(503, 'Dịch vụ tạm thời gián đoạn.')) : json({ ok: true, claimed: 0, verified: 0 })))
    const { useReaderAuth } = await fresh<ReaderAuthModule>('useReaderAuth')
    const auth = useReaderAuth()
    await auth.load()
    assert.equal(auth.reader.value, null)
    assert.equal(auth.failed.value, true)
    assert.equal(auth.loaded.value, false)
    up = true
    await auth.load(true)
    assert.equal(auth.reader.value?.initials, 'NA')
    assert.equal(auth.failed.value, false)
    // ofetch retries a GET once on 503: two lookups for the failed load, one for the forced one.
    assert.deepEqual(calls.filter(c => c.wire === '/api/public/reader/me').length, 3)
  })

  it('claimChats(): a refused claim reads "failed" (FINDING-R1 contract), no throw', async () => {
    network(call => (call.wire === '/api/public/reader/claim-chats' ? h3Error(401, 'Bạn cần đăng nhập.') : undefined))
    const { useReaderAuth } = await fresh<ReaderAuthModule>('useReaderAuth')
    assert.equal(await useReaderAuth().claimChats(), 'failed')
  })

  it('signOut(): POST /logout; forgets the reader and the claim flag — even when the post fails', async () => {
    for (const fails of [false, true]) {
      session.map.set('cdkt_chats_claimed_v1', '1')
      const calls = network((call) => {
        if (call.wire === '/api/public/reader/me') return json(ME)
        if (call.wire === '/api/public/reader/logout') return fails ? new TypeError('fetch failed') : json({ ok: true })
        return json({ ok: true, claimed: 0, verified: 0 })
      })
      const { useReaderAuth } = await fresh<ReaderAuthModule>('useReaderAuth')
      const auth = useReaderAuth()
      await auth.load()
      await settle()
      await auth.signOut()
      const logout = calls.filter(c => c.wire === '/api/public/reader/logout')
      assert.deepEqual(logout.map(c => c.method), ['POST'], `one POST (fails=${fails}); ofetch does not retry a POST`)
      assert.equal(logout[0]!.body, undefined, 'no body')
      assert.equal(auth.reader.value, null)
      assert.equal(auth.loaded.value, true)
      assert.equal(session.map.has('cdkt_chats_claimed_v1'), false)
    }
  })
})

describe('useReaderNotifications over publicFetch', () => {
  const PAGE = (page: number, unread = 2) => ({
    ok: true,
    items: [
      { id: page * 10 + 1, isRead: false, createdAt: '2026-10-20T03:00:00.000Z', authorName: 'Ban biên tập', isAdminReply: true, excerpt: 'Trả lời 1', target: { articleTitle: 'Bài 1', url: '/news/bai-1#comment-1' } },
      { id: page * 10 + 2, isRead: false, createdAt: null, authorName: 'B', isAdminReply: false, excerpt: 'Trả lời 2', target: null },
    ],
    total: 12,
    unreadCount: unread,
    page,
    perPage: 10,
    totalPages: 2,
  })

  it('load(page): GET ?page=N, holds the page as the server answered it', async () => {
    const calls = network(call => (call.wire.startsWith('/api/public/reader/notifications?') ? json(PAGE(Number(new URL(`http://x${call.wire}`).searchParams.get('page')))) : undefined))
    const { useReaderNotifications } = await fresh<NotificationsModule>('useReaderNotifications')
    const n = useReaderNotifications()
    await n.load(2)
    assert.deepEqual(calls.map(c => `${c.method} ${c.wire}`), ['GET /api/public/reader/notifications?page=2'])
    assert.deepEqual(n.items.value.map(i => i.id), [21, 22])
    assert.deepEqual([n.unreadCount.value, n.total.value, n.page.value, n.totalPages.value, n.loaded.value, n.failed.value], [2, 12, 2, 2, true, false])
  })

  it('a 401 is rethrown as the SAME error the network gave (errorStatus 401); a 403 is not; both set failed', async () => {
    let status = 401
    network(call => (call.wire.startsWith('/api/public/reader/notifications') ? h3Error(status, status === 401 ? 'Phiên đăng nhập đã hết hạn.' : 'Tài khoản đã bị khoá.') : undefined))
    const { useReaderNotifications } = await fresh<NotificationsModule>('useReaderNotifications')
    const n = useReaderNotifications()
    const err = await n.load(1).then(() => null, (e: unknown) => e)
    assert.ok(err, 'a 401 reaches the caller')
    assert.equal(errorStatus(err), 401)
    assert.equal(n.failed.value, true)
    status = 403
    await n.load(1)
    assert.equal(n.failed.value, true)
  })

  it('markRead / markAllRead: optimistic, POST the ids / all, failures swallowed', async () => {
    let writes = 'ok'
    const calls = network((call) => {
      if (call.wire.startsWith('/api/public/reader/notifications?')) return json(PAGE(1))
      if (call.wire === '/api/public/reader/notifications/read') return writes === 'ok' ? json({ ok: true }) : new TypeError('fetch failed')
      return undefined
    })
    const { useReaderNotifications } = await fresh<NotificationsModule>('useReaderNotifications')
    const n = useReaderNotifications()
    await n.load(1)
    await n.markRead([11, 0, -3])
    assert.deepEqual(calls.at(-1), { method: 'POST', wire: '/api/public/reader/notifications/read', body: { ids: [11] } })
    assert.equal(n.unreadCount.value, 1)
    writes = 'down'
    await n.markAllRead()
    assert.deepEqual(calls.at(-1), { method: 'POST', wire: '/api/public/reader/notifications/read', body: { all: true } })
    assert.equal(n.unreadCount.value, 0)
    assert.deepEqual(n.items.value.map(i => i.isRead), [true, true])
    assert.equal(calls.filter(c => c.wire === '/api/public/reader/notifications/read').length, 2, 'no retry of a failed POST')
  })
})
