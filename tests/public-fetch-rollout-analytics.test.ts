/**
 * D-FETCH lot G — the page-view beacon of `app/plugins/analytics.client.ts` after its cast
 * became `publicFetch<T>()`. The REAL plugin (evaluated as the build would, with
 * `defineNuxtPlugin` and the browser globals it reads stood in), REAL ofetch on a fake network.
 *
 * What a visitor's browser does is pinned: one POST per page shown (`app:mounted`, then each
 * `page:finish` to a NEW path), body `{ path, sourceCategory, deviceClass }`, sent with
 * `keepalive` (it may outlive the page), posted once on a 503 (a POST: ofetch's default is no retry),
 * abandoned after 1.5 s, every failure swallowed (analytics never disturbs a page); a bot and
 * an admin path send nothing. Green on the base tree (5f1bb07d, cast) and on lot G alike.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { createFetch } from 'ofetch'

import { loadAppModule } from './_public-mount-harness.ts'

type Post = { wire: string, body: unknown, keepalive: boolean | undefined, signal: AbortSignal | null | undefined }
const HOLD = Symbol('hold')
const g = globalThis as Record<string, unknown>
const before = Object.getOwnPropertyDescriptor(g, '$fetch')
afterEach(() => {
  if (before) Object.defineProperty(g, '$fetch', before)
  else delete g.$fetch
})

function network(answer: () => Response | Error | typeof HOLD) {
  const posts: Post[] = []
  g.$fetch = createFetch({
    fetch: ((input: RequestInfo | URL, init: RequestInit = {}) => new Promise<Response>((resolve, reject) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://portal.test')
      posts.push({ wire: `${(init.method ?? 'GET').toUpperCase()} ${url.pathname}`, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body, keepalive: init.keepalive, signal: init.signal })
      init.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
      const result = answer()
      if (result === HOLD) return
      if (result instanceof Error) reject(result)
      else resolve(result)
    })) as typeof fetch,
  })
  return posts
}
const json = (body: unknown, status = 202) =>
  new Response(JSON.stringify(body), { status, statusText: status === 202 ? 'Accepted' : 'Service Unavailable', headers: { 'content-type': 'application/json' } })
const settle = () => new Promise(resolve => setImmediate(resolve)).then(() => new Promise(resolve => setImmediate(resolve)))

async function startPlugin(userAgent = 'Mozilla/5.0 (Windows NT 10.0) Chrome/130') {
  const hooks = new Map<string, () => void>()
  let path = '/news'
  const module = await loadAppModule('plugins/analytics.client.ts', {
    names: {
      defineNuxtPlugin: (setup: unknown) => setup,
      navigator: { userAgent },
      document: { referrer: 'https://www.google.com/' },
      window: { location: { hostname: 'conduonghuongthien.com.vn' } },
    },
  })
  // `export default defineNuxtPlugin(setup)` with `defineNuxtPlugin` = identity: the setup itself.
  const setup = module.default as (app: unknown) => void
  assert.ok(typeof setup === 'function', 'the plugin evaluated to its setup function')
  setup({ hook: (name: string, fn: () => void) => { hooks.set(name, fn) }, $router: { currentRoute: { get value() { return { fullPath: path } } } } })
  return {
    fire: (name: 'app:mounted' | 'page:finish', to?: string) => { if (to) path = to; hooks.get(name)!() },
  }
}

describe('analytics.client.ts — the page-view beacon over publicFetch', () => {
  it('one POST per page shown, JSON body, keepalive; the same path twice is not counted twice', async () => {
    const posts = network(() => json({ accepted: true }))
    const app = await startPlugin()
    app.fire('app:mounted')
    app.fire('page:finish', '/news')
    app.fire('page:finish', '/about')
    await settle()
    assert.deepEqual(posts.map(p => p.wire), ['POST /api/public/analytics/page-view', 'POST /api/public/analytics/page-view'])
    assert.deepEqual(posts[0]!.body, { path: '/news', sourceCategory: 'search', deviceClass: 'desktop' })
    assert.equal(posts[1]!.body && (posts[1]!.body as { path: string }).path, '/about')
    assert.ok(posts.every(p => p.keepalive === true), 'keepalive reaches fetch')
  })

  // `retry: 0` cannot be told apart here: ofetch never retries a POST by default (mutation
  // M18 of lot G survives as an EQUIVALENT mutant). What a visitor sees is pinned: one post.
  it('a 503 is posted once and swallowed', async () => {
    const posts = network(() => json({ statusCode: 503 }, 503))
    const app = await startPlugin()
    app.fire('app:mounted')
    await settle()
    await settle()
    assert.equal(posts.length, 1)
  })

  it('abandoned after 1.5 s (`timeout: 1500`), swallowed', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const posts = network(() => HOLD)
    const app = await startPlugin()
    app.fire('app:mounted')
    await settle()
    assert.equal(posts[0]!.signal?.aborted, false)
    t.mock.timers.tick(1499)
    assert.equal(posts[0]!.signal?.aborted, false)
    t.mock.timers.tick(1)
    assert.equal(posts[0]!.signal?.aborted, true)
    await settle()
  })

  it('a bot and an admin path send nothing', async () => {
    const posts = network(() => json({ accepted: true }))
    const bot = await startPlugin('Googlebot/2.1 (+http://www.google.com/bot.html)')
    bot.fire('app:mounted')
    const human = await startPlugin()
    human.fire('page:finish', '/admin/content/articles')
    await settle()
    assert.deepEqual(posts, [])
  })
})
