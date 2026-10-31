/**
 * `publicFetch<T>()` — the typed `$fetch` of the public site (wave3 D-FETCH, lot G).
 *
 * What it must be, pinned by RUNNING it (the real module, the real ofetch over a fake
 * network) — not by reading its text:
 *   - a call of the GLOBAL `$fetch`, looked up at call time (a test, and Nuxt, install
 *     theirs after the module loaded), with the url and the options object passed through
 *     as they are (same object), nothing added: no headers, no credentials, no cookie
 *     forwarding — the SWR cache invariant (the server renders anonymous Vietnamese HTML
 *     because Nuxt's global `$fetch` does not forward the visitor's `cookie` during SSR);
 *   - the answer, and the error, are the global's own: the SAME error object (status,
 *     `data.statusMessage`) so `errorMessage()` / `errorStatus()` read it, and ofetch's
 *     `[GET] "/api/…"` line never reaches a reader;
 *   - `params` is ofetch's alias of `query`: a call site moved from the cast kept its
 *     `params` and must send the same wire.
 * And, read from the source because it is about what the module may IMPORT: no `#imports`
 * and none of the Nuxt helpers that forward request headers (`useRequestFetch`,
 * `useRequestHeaders`, `useFetch`, `useNuxtApp`).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterEach, describe, it } from 'node:test'
import { createFetch } from 'ofetch'

import { publicFetch } from '../app/composables/publicFetch.ts'
import { errorMessage, errorStatus } from '../app/utils/errorMessage.ts'

const g = globalThis as Record<string, unknown>
const before = Object.getOwnPropertyDescriptor(g, '$fetch')
afterEach(() => {
  if (before) Object.defineProperty(g, '$fetch', before)
  else delete g.$fetch
})

type Seen = { method: string, url: URL, headers: Headers, body: unknown }
function network(answer: (seen: Seen) => Response | Error) {
  const seen: Seen[] = []
  const fetchImpl = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const call = {
      method: (init.method ?? 'GET').toUpperCase(),
      url: new URL(raw, 'http://portal.test'),
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
    }
    seen.push(call)
    const result = answer(call)
    if (result instanceof Error) throw result
    return result
  }
  g.$fetch = createFetch({ fetch: fetchImpl as typeof fetch })
  return seen
}
const json = (body: unknown, status = 200, statusText = 'OK') =>
  new Response(JSON.stringify(body), { status, statusText, headers: { 'content-type': 'application/json' } })
const OFETCH_LINE = /\[(GET|POST|PUT|PATCH|DELETE)\]|<no response>|fetch failed/

describe('publicFetch: a bare call of the global $fetch', () => {
  it('calls the global installed AFTER the module loaded, with the same url and the same options object', async () => {
    const calls: unknown[][] = []
    const answer = { ok: true, items: [] }
    g.$fetch = (...args: unknown[]) => { calls.push(args); return Promise.resolve(answer) }
    const options = { query: { type: 'news', lang: 'en' }, retry: 0 as const }
    const result = await publicFetch<typeof answer>('/api/public/categories', options)
    assert.equal(result, answer, 'the answer is the global\'s own')
    assert.equal(calls.length, 1)
    assert.equal(calls[0]![0], '/api/public/categories')
    assert.equal(calls[0]![1], options, 'the options object is handed over as is — nothing merged in')
    assert.equal(calls[0]!.length, 2, 'no third argument')
  })

  it('without options: exactly one argument reaches the global (no `{}` invented)', async () => {
    const calls: unknown[][] = []
    g.$fetch = (...args: unknown[]) => { calls.push(args); return Promise.resolve(null) }
    await publicFetch<null>('/api/public/settings')
    assert.deepEqual(calls, [['/api/public/settings', undefined]])
  })

  it('rejects with the SAME error object; errorMessage reads the server sentence, errorStatus the status', async () => {
    const sentence = 'Bạn cần đăng nhập để bình luận.'
    network(() => json({ statusCode: 401, statusMessage: sentence, message: sentence }, 401, 'Unauthorized'))
    let rejectedWith: unknown
    const realFetch = g.$fetch as (...args: unknown[]) => Promise<unknown>
    g.$fetch = (...args: unknown[]) => realFetch(...args).catch((err: unknown) => { rejectedWith = err; throw err })
    let caught: unknown
    try {
      await publicFetch('/api/public/comments', { method: 'POST', body: { content: 'x' } })
    } catch (err: unknown) {
      caught = err
    }
    assert.ok(caught !== undefined && caught === rejectedWith, 'the error is the very object the global rejected with')
    assert.equal(errorStatus(caught), 401)
    assert.equal(errorMessage(caught, 'Không gửi được bình luận.'), sentence)
    // The same object the global rejected with: a FetchError carrying ofetch's line in `message`,
    // which errorMessage never shows.
    assert.match(String((caught as Error).message), OFETCH_LINE)
  })

  it('a dropped connection: errorMessage falls back, ofetch\'s line never reaches the reader', async () => {
    network(() => new TypeError('fetch failed'))
    const err = await publicFetch('/api/public/reader/me', { retry: 0 }).then(() => null, (e: unknown) => e)
    assert.ok(err)
    assert.equal(errorMessage(err, 'Không tải được.'), 'Không tải được.')
    assert.doesNotMatch(errorMessage(err, 'Không tải được.'), OFETCH_LINE)
  })

  it('a synchronous throw of the global stays synchronous (the call site saw it the same way)', () => {
    const boom = new Error('no $fetch')
    g.$fetch = () => { throw boom }
    assert.throws(() => publicFetch('/api/public/settings'), (err: unknown) => err === boom)
  })

  it('`params` and `query` put the same query string on the wire; POST body is JSON; no cookie/credentials added', async () => {
    const seen = network(() => json({ ok: true }))
    await publicFetch('/api/public/articles', { params: { type: 'news', limit: 5, lang: 'vi', categorySlug: undefined } })
    await publicFetch('/api/public/articles', { query: { type: 'news', limit: 5, lang: 'vi', categorySlug: undefined } })
    await publicFetch('/api/public/reader/notifications/read', { method: 'POST', body: { ids: [3, 4] } })
    assert.equal(`${seen[0]!.url.pathname}${seen[0]!.url.search}`, '/api/public/articles?type=news&limit=5&lang=vi')
    assert.equal(`${seen[1]!.url.pathname}${seen[1]!.url.search}`, `${seen[0]!.url.pathname}${seen[0]!.url.search}`)
    assert.equal(seen[2]!.method, 'POST')
    assert.deepEqual(seen[2]!.body, { ids: [3, 4] })
    for (const call of seen) {
      assert.equal(call.headers.get('cookie'), null, 'publicFetch never adds a cookie header')
    }
  })
})

describe('publicFetch: the module imports nothing that forwards the visitor\'s headers', () => {
  const source = readFileSync(new URL('../app/composables/publicFetch.ts', import.meta.url), 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('no import at all, no Nuxt request helper, the global looked up at call time', () => {
    assert.doesNotMatch(code, /^\s*import\s/m, 'publicFetch.ts imports nothing (tests import() the composables into plain Node)')
    assert.doesNotMatch(code, /#imports|useRequestFetch|useRequestHeaders?|useRequestEvent|useFetch|useNuxtApp|credentials|headers\s*:/)
    assert.match(code, /return \(\$fetch as TypedFetch\)<T>\(url, options\)/, 'one expression: the global, url, options')
  })
})
