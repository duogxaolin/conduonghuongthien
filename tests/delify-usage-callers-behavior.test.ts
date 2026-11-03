import assert from 'node:assert/strict'
import test, { beforeEach, mock } from 'node:test'
import { getTableName } from 'drizzle-orm'

/**
 * The three callers of Delify Router's usage API — `POST /api/admin/ai/delify/sync`,
 * `GET /api/admin/ai/delify/status` and the budget guard's `loadDelifyQuota` — used a
 * bare `fetch` to a hard-coded `https://router.delify.vn/...?key=<API key>`: no URL
 * policy, no DNS→public-IP check, redirects followed, no byte cap, and the key went
 * to that host whatever `ai_providers.base_url` the key had been entered for
 * (CLAUDE.md: "Đừng gọi `fetch` trần tới nhà cung cấp").
 *
 * They now go through `server/utils/ai/delify-usage.ts`, which takes the host from the
 * stored base URL (checked by `checkProviderBaseUrl`) and sends through
 * `safeProviderRequest` (outbound.ts). Here outbound.ts is replaced by a recorder, so
 * what is pinned is what each caller hands to it — and that a refused base URL never
 * reaches it. outbound.ts itself (DNS, pinning, redirects, caps) runs for real in
 * tests/delify-usage-client.test.ts. A bare `fetch` is recorded too: RED on the base.
 */

const SECRET = 'sk-delify-secret-0123'
type Sent = { url: string, allowedHosts: readonly string[], query?: Record<string, string>, headers?: Record<string, string>, timeoutMs?: number, maxResponseBytes?: number }
const sent: Sent[] = []
const bareFetches: string[] = []
let answer: (url: string) => { status: number, body: unknown } = () => ({ status: 200, body: {} })

class FakeOutboundError extends Error {
  code: string
  constructor(code: string) { super('Provider request failed.'); this.code = code }
}
mock.module('../server/utils/chatbot/outbound', {
  namedExports: {
    ChatbotOutboundError: FakeOutboundError,
    safeProviderRequest: async (options: Sent) => {
      sent.push(options)
      const { status, body } = answer(options.url)
      if (status === 0) throw new FakeOutboundError('DESTINATION_UNSAFE')
      return { status, headers: {}, body: new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)) }
    },
  },
})
mock.module('../server/utils/ai/crypto', { namedExports: { decryptAiSecret: () => SECRET } })
mock.module('../server/utils/permissions', { namedExports: { requireResourcePermission: () => {} } })

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: string | URL | Request) => {
  bareFetches.push(String(input instanceof Request ? input.url : input))
  return new Response(JSON.stringify({ availableModels: [{ name: 'm', input: 1, output: 2 }], history: [] }), { status: 200 })
}) as typeof fetch
process.on('exit', () => { globalThis.fetch = realFetch })

let providerRow: Record<string, unknown> = {}
const writes: string[] = []
function fakeDb() {
  const rowsFor = (table: unknown) => (getTableName(table as never) === 'ai_providers' ? [providerRow] : [])
  const select = () => ({
    from: (table: unknown) => {
      const chain = {
        where: () => chain,
        limit: async () => rowsFor(table),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve([{ totalCostUsd: '0', totalCostVnd: '0', totalRequests: 0 }]).then(resolve),
      }
      return chain
    },
  })
  const write = (kind: string, table: unknown) => {
    writes.push(`${kind} ${getTableName(table as never)}`)
    const done = Promise.resolve([{ affectedRows: 1, insertId: 1 }])
    return Object.assign(done, { onDuplicateKeyUpdate: async () => [{ affectedRows: 1 }] })
  }
  const handle = {
    select,
    insert: (table: unknown) => ({ values: () => write('insert', table) }),
    update: (table: unknown) => ({ set: () => ({ where: () => write('update', table) }) }),
    transaction: async (run: (tx: unknown) => Promise<unknown>) => run(handle),
  }
  return handle
}
mock.module('../server/utils/db', { namedExports: { getDb: () => fakeDb() } })

const h3 = await import('h3')
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = h3.defineEventHandler
globals.createError = h3.createError
let query: Record<string, string> = {}
globals.getQuery = () => query

const syncHandler = (await import('../server/api/admin/ai/delify/sync.post')).default as unknown as (event: unknown) => Promise<Record<string, unknown>>
const statusHandler = (await import('../server/api/admin/ai/delify/status.get')).default as unknown as (event: unknown) => Promise<Record<string, unknown>>
const { loadDelifyQuota } = await import('../server/utils/ai-budget')

const event = () => ({ context: { adminUser: { id: 3, isSuperAdmin: true } } })
const provider = (baseUrl: string | null) => ({
  id: 4, provider: 'delify', baseUrl, isActive: true,
  apiKeyCiphertext: 'c', apiKeyNonce: 'n', apiKeyAuthTag: 't', apiKeyVersion: 1, apiKeyKeyId: 'k', apiKeyLastFour: '0123',
})
async function failure(run: () => Promise<unknown>) {
  try { await run() } catch (error) { return error as { statusCode?: number, statusMessage?: string } }
  return null
}

const REFUSED_BASE_URLS = [
  'https://127.0.0.1/v1', 'https://localhost/v1', 'https://10.0.0.5/v1', 'https://[::1]/v1',
  'https://2130706433/v1', 'https://metadata.google.internal/v1', 'http://router.delify.vn/v1', 'https://router.delify.vn:8443/v1',
]

beforeEach(() => {
  sent.length = 0
  bareFetches.length = 0
  writes.length = 0
  query = {}
  answer = () => ({ status: 200, body: {} })
})

test('sync: a private, loopback or otherwise refused base URL is a 400 and nothing leaves the server (RED before: bare fetch)', async () => {
  for (const baseUrl of REFUSED_BASE_URLS) {
    providerRow = provider(baseUrl)
    const error = await failure(() => syncHandler(event()))
    assert.equal(error?.statusCode, 400, `${baseUrl}: ${JSON.stringify(error)}`)
    assert.match(String(error?.statusMessage), /Địa chỉ nhà cung cấp/)
  }
  assert.deepEqual(bareFetches, [])
  assert.deepEqual(sent, [])
  assert.deepEqual(writes, [])
})

test('sync: the receipts call goes through outbound.ts to the base URL\'s host, the key only as the `key` query value (RED before)', async () => {
  providerRow = provider('https://router.delify.vn/v1')
  answer = url => (url.endsWith('/receipts')
    ? { status: 200, body: { availableModels: [{ name: 'flash', input: 1, output: 4 }], history: [{ timestamp: '2026-10-20T01:02:03Z', model: 'flash', status: '200', cost: 0.01, input: 10, output: 5, tok: 15 }] } }
    : { status: 200, body: { windowCostUsd: 0.5, windowRequests: 3, allowedModels: ['flash'] } })
  const result = await syncHandler(event())
  assert.deepEqual(bareFetches, [])
  assert.deepEqual(sent.map(s => [s.url, s.allowedHosts, s.query]), [
    ['https://router.delify.vn/api/usage/key/receipts', ['router.delify.vn'], { period: 'all', page: '1', pageSize: '100', key: SECRET }],
    ['https://router.delify.vn/api/usage/key', ['router.delify.vn'], { key: SECRET }],
  ])
  for (const s of sent) {
    assert.ok(!s.url.includes(SECRET), 'the key is never part of the URL handed to outbound.ts')
    assert.ok(!JSON.stringify(s.headers ?? {}).includes(SECRET))
    assert.ok(s.timeoutMs && s.timeoutMs <= 15_000, 'a deadline')
    assert.ok(s.maxResponseBytes && s.maxResponseBytes <= 1024 * 1024, 'a byte cap')
  }
  assert.equal(result.upserted, 1)
  // The history in the answer is not written: every delify call is logged by the gateway (no double count).
  assert.equal('syncedLogs' in result, false)
  assert.deepEqual(writes.filter(write => write.endsWith(' ai_usage_logs')), [])
  assert.ok(writes.includes('insert ai_model_pricing'), writes.join(', '))
  assert.deepEqual(result.delifyUsage, { windowCostUsd: 0.5, windowRequests: 3, allowedModels: ['flash'] })
})

test('sync: the API host follows the configured base URL — the key is never sent to a host it was not entered for (RED before)', async () => {
  providerRow = provider('https://llm-router.example.org/openai/v1')
  answer = () => ({ status: 200, body: { availableModels: [{ name: 'flash', input: 1, output: 4 }] } })
  await syncHandler(event())
  assert.deepEqual(sent.map(s => s.url), ['https://llm-router.example.org/api/usage/key/receipts', 'https://llm-router.example.org/api/usage/key'])
  assert.deepEqual(bareFetches, [])
})

test('sync: an unreachable or misbehaving API is a 502 with a fixed sentence — no key, no URL, no driver text', async () => {
  providerRow = provider('https://router.delify.vn/v1')
  for (const [reply, status] of [[{ status: 0, body: '' }, 502], [{ status: 503, body: '' }, 502], [{ status: 200, body: '<html>' }, 502]] as const) {
    answer = () => reply
    const error = await failure(() => syncHandler(event()))
    assert.equal(error?.statusCode, status, JSON.stringify(error))
    assert.ok(!JSON.stringify(error).includes(SECRET))
    assert.ok(!String(error?.statusMessage).includes('router.delify.vn'))
  }
  assert.deepEqual(writes, [])
})

test('status: a refused base URL is reported, not fetched (RED before)', async () => {
  for (const baseUrl of REFUSED_BASE_URLS) {
    providerRow = provider(baseUrl)
    const result = await statusHandler(event())
    assert.equal(result.ok, false)
    assert.equal(result.configured, true)
    assert.match(String(result.error), /Địa chỉ nhà cung cấp/, baseUrl)
  }
  assert.deepEqual(bareFetches, [])
  assert.deepEqual(sent, [])
})

test('status: both calls go through outbound.ts with the period as a query value, and a failure never echoes the driver\'s message (RED before)', async () => {
  providerRow = provider('https://router.delify.vn/v1')
  query = { period: '30d' }
  answer = url => (url.endsWith('/receipts') ? { status: 200, body: { summary: { items: [] }, history: [], availableModels: [] } } : { status: 200, body: { name: 'Key', active: true, budgetUsd: 10 } })
  const result = await statusHandler(event())
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.deepEqual(bareFetches, [])
  assert.deepEqual(sent.map(s => [s.url, s.query]).sort(), [
    ['https://router.delify.vn/api/usage/key', { key: SECRET }],
    ['https://router.delify.vn/api/usage/key/receipts', { period: '30d', page: '1', pageSize: '20', key: SECRET }],
  ])

  answer = () => ({ status: 0, body: '' })
  const failed = await statusHandler(event())
  assert.equal(failed.ok, false)
  assert.equal(failed.error, 'Không thể kết nối tới Delify Router API.')
})

test('status: a bad receipts answer does not take the key card down with it, and the card names the configured host (RED before)', async () => {
  providerRow = provider('https://llm-router.example.org/openai/v1')
  answer = url => (url.endsWith('/receipts') ? { status: 200, body: '<html>maintenance</html>' } : { status: 200, body: { name: 'Key', active: true, budgetUsd: 10 } })
  const result = await statusHandler(event())
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal((result.keyInfo as { name: string }).name, 'Key')
  assert.equal(result.periodSummary, null)
  assert.deepEqual(result.recentHistory, [])
  assert.equal(result.host, 'llm-router.example.org', 'the dashboard shows the host it really asked, not a hard-coded router.delify.vn')

  answer = url => (url.endsWith('/receipts') ? { status: 200, body: { summary: null } } : { status: 0, body: '' })
  const keyDown = await statusHandler(event())
  assert.equal(keyDown.ok, false)
  assert.equal(keyDown.error, 'Không thể kết nối tới Delify Router API.')
})

/** The budget guard remembers any answer — quota or failure — this long (ai-budget.ts). */
const QUOTA_CACHE_MS = 60_000
/** The guard's cache and the log throttle are per process: each test starts its own hour. */
const HOUR = 3_600_000

test('budget guard: the quota lookup goes through outbound.ts, and a refused base URL makes no call at all (RED before)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + HOUR })
  providerRow = provider('https://127.0.0.1/v1')
  assert.equal(await loadDelifyQuota(fakeDb() as never), null)
  assert.deepEqual(bareFetches, [])
  assert.deepEqual(sent, [])

  t.mock.timers.tick(QUOTA_CACHE_MS)
  providerRow = provider('https://router.delify.vn/v1')
  answer = () => ({ status: 200, body: { budgetUsd: 12.5, active: true } })
  const quota = await loadDelifyQuota(fakeDb() as never)
  assert.equal(quota?.budgetUsd, 12.5)
  assert.deepEqual(sent.map(s => [s.url, s.query]), [['https://router.delify.vn/api/usage/key', { key: SECRET }]])
  assert.ok((sent[0]!.timeoutMs ?? Infinity) <= 2_500, 'the budget check sits in front of every AI call: a short deadline')
  assert.deepEqual(bareFetches, [])
})

test('budget guard: a failed lookup is remembered — the next calls within the window cost no network call and no log line (RED before)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 2 * HOUR })
  providerRow = provider('https://router.delify.vn/v1')
  answer = () => ({ status: 0, body: '' })
  const logged: string[] = []
  const original = console.error
  console.error = (...args: unknown[]) => { logged.push(args.join(' ')) }
  try {
    await loadDelifyQuota(fakeDb() as never)
    // Every chatbot turn calls checkBudget: ten more within the window.
    for (let i = 0; i < 5; i++) await loadDelifyQuota(fakeDb() as never)
    await Promise.all(Array.from({ length: 5 }, () => loadDelifyQuota(fakeDb() as never)))
    assert.equal(sent.length, 1, 'one lookup for eleven budget checks')
    assert.equal(logged.filter(line => line.includes('ai_panel.delify_usage_failed')).length, 1)

    t.mock.timers.tick(QUOTA_CACHE_MS)
    answer = () => ({ status: 200, body: { budgetUsd: 7, active: true } })
    assert.equal((await loadDelifyQuota(fakeDb() as never))?.budgetUsd, 7, 'after the window it asks again')
    assert.equal(sent.length, 2)
  } finally {
    console.error = original
  }
})

test('budget guard: concurrent checks share one lookup (RED before: one request each)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 3 * HOUR })
  providerRow = provider('https://router.delify.vn/v1')
  answer = () => ({ status: 200, body: { budgetUsd: 3, active: true } })
  const quotas = await Promise.all(Array.from({ length: 8 }, () => loadDelifyQuota(fakeDb() as never)))
  assert.deepEqual(quotas.map(quota => quota?.budgetUsd), Array(8).fill(3))
  assert.equal(sent.length, 1)
})
