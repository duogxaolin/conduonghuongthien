import assert from 'node:assert/strict'
import test, { afterEach, mock } from 'node:test'
import { readFileSync } from 'node:fs'

/**
 * GET /api/public/health — what the post-deploy smoke test and an external uptime
 * monitor read through the public URL.
 *
 * It must say two things truthfully: whether this process can reach its database
 * (a cheap `SELECT 1` on the shared pool, bounded to 2 s so a hung database is
 * reported instead of hanging the monitor), and which build is answering (the
 * short SHA baked into the image as APP_VERSION). A health answer served from a
 * cache is worse than none: the smoke test would compare a version the new
 * container never sent. So every answer carries `Cache-Control: no-store`.
 *
 * Real handler, fake pool, fake h3 event — the harness pattern of
 * tests/media-portal-settings-get.test.ts.
 */

type FakeEvent = { status: number; headers: Record<string, string> }
type FakePool = { query: (options: { sql: string; timeout?: number }) => Promise<unknown> } | null

let pool: FakePool = null
const queries: Array<{ sql: string; timeout?: number }> = []

mock.module('../server/utils/db', {
  namedExports: {
    getPool: () => pool,
    getDb: () => {
      throw new Error('the health check must not build a query')
    },
  },
})
mock.module('../server/utils/logger', {
  namedExports: { logError: () => {}, logWarn: () => {}, logInfo: () => {} },
})
mock.module('h3', {
  namedExports: {
    defineEventHandler: (handler: unknown) => handler,
    setResponseHeader: (event: FakeEvent, name: string, value: string) => {
      event.headers[name.toLowerCase()] = value
    },
    setResponseStatus: (event: FakeEvent, status: number) => {
      event.status = status
    },
  },
})

const handler = (await import('../server/api/public/health.get')).default as unknown as (
  event: FakeEvent,
) => Promise<{ ok: boolean; version: string }>
const call = async () => {
  const event: FakeEvent = { status: 200, headers: {} }
  const body = await handler(event)
  return { event, body }
}

const savedVersion = process.env.APP_VERSION
afterEach(() => {
  pool = null
  queries.length = 0
  if (savedVersion === undefined) delete process.env.APP_VERSION
  else process.env.APP_VERSION = savedVersion
  mock.timers.reset()
})

test('database answers: 200 { ok: true, version } and never cached', async () => {
  process.env.APP_VERSION = '0123456789ab'
  pool = {
    query: async (options) => {
      queries.push(options)
      return [[{ 1: 1 }], []]
    },
  }
  const { event, body } = await call()
  assert.deepEqual(body, { ok: true, version: '0123456789ab' })
  assert.equal(event.status, 200)
  assert.equal(event.headers['cache-control'], 'no-store')
  assert.equal(queries.length, 1)
  assert.match(queries[0]!.sql, /^SELECT 1$/)
  assert.equal(queries[0]!.timeout, 2000, 'the query itself is bounded too')
})

test('no APP_VERSION baked in (a local build): the version reads "dev"', async () => {
  delete process.env.APP_VERSION
  pool = { query: async () => [[], []] }
  const { body } = await call()
  assert.deepEqual(body, { ok: true, version: 'dev' })
})

test('database refuses: 503, no-store, ok:false', async () => {
  process.env.APP_VERSION = 'abc'
  pool = {
    query: async () => {
      throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    },
  }
  const { event, body } = await call()
  assert.equal(event.status, 503)
  assert.equal(event.headers['cache-control'], 'no-store')
  assert.equal(body.ok, false)
})

test('no pool at all: 503, not a crash', async () => {
  pool = null
  const { event, body } = await call()
  assert.equal(event.status, 503)
  assert.equal(body.ok, false)
})

test('database hangs: answered 503 after 2 s, not when the driver gives up', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  // Never settles — what a pool waiting for a connection to a frozen server does.
  pool = { query: () => new Promise(() => {}) }
  const event: FakeEvent = { status: 200, headers: {} }
  const pending = handler(event)
  mock.timers.tick(1999)
  await Promise.resolve()
  assert.equal(event.status, 200, 'answered before the 2 s budget ran out')
  mock.timers.tick(1)
  const body = await pending
  assert.equal(event.status, 503)
  assert.equal(event.headers['cache-control'], 'no-store')
  assert.equal(body.ok, false)
})

test('no route rule caches the health endpoint', () => {
  const config = readFileSync(new URL('../nuxt.config.ts', import.meta.url), 'utf8')
  // `/api/**` is `cache: false`; a more specific rule for health would win over it.
  assert.match(config, /'\/api\/\*\*': \{ cache: false \}/)
  assert.doesNotMatch(config, /'\/api\/public\/health/)
})
