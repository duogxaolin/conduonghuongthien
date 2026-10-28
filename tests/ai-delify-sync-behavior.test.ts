import assert from 'node:assert/strict'
import test, { after, beforeEach } from 'node:test'

/**
 * Delify Router's usage API in the AI panel:
 *   - `POST /api/admin/ai/delify/sync` (server/api/admin/ai/delify/sync.post.ts) —
 *     calls `/api/usage/key/receipts` with the stored key, upserts the router's
 *     model prices into `ai_model_pricing` and merges its request history into
 *     `ai_usage_logs` (the table `checkBudget` sums: a row there IS spend), with an
 *     audit row, all in one transaction;
 *   - `GET /api/admin/ai/delify/status` (`status.get.ts`) — the key card and the
 *     receipts breakdown of the dashboard.
 *
 * The transport (URL policy, outbound.ts, fixed error sentences) has its own suite
 * (`delify-usage-callers-behavior`, outbound faked there). This one runs the real
 * `fetchDelifyUsage` → `safeProviderRequest` down to a fake socket, and Drizzle's
 * SQL on SQLite, so what is pinned is what the routes WRITE and RETURN.
 *
 * The invariants:
 *   - sync needs `ai.update`, status `ai.read`; without them nothing is sent;
 *   - what Delify sends is data from outside, checked like an officer's entry
 *     before it is written: a model name the column cannot hold whole is not cut
 *     into another model's name (FINDING-R5-6, the R4-11 family); a price outside
 *     DECIMAL(8,4) or negative is skipped, not a failed sync / a negative cost
 *     (FINDING-R5-5, R4-6); an item of the wrong shape or a negative/absurd cost is
 *     skipped, not a 500 that drops the whole sync (FINDING-R5-7);
 *   - a history row is stored with the timestamp MySQL keeps (whole second,
 *     rounded), so the next sync recognises it; with the router's milliseconds the
 *     equality never matched on MySQL and every sync inserted the history again
 *     (FINDING-R5-8 — MySQL 8.0.46 evidence: `mysql-tz-evidence.log`);
 *   - pricing, history and the audit row commit together (`meta` an object);
 *   - status passes on only the fields the dashboard shows — never an extra field
 *     the router sends, such as the key (FINDING-R5-9); the key is nowhere in a
 *     response, a row or a log line.
 */

const { startAiRouteHarness, SECRET, containsSecret } = await import('./_ai-route-harness')
const h = await startAiRouteHarness({
  extraTables: schema => [schema.activityLogs],
  routes: async load => [
    { method: 'post', path: '/api/admin/ai/delify/sync', handler: await load('../server/api/admin/ai/delify/sync.post') },
    { method: 'get', path: '/api/admin/ai/delify/status', handler: await load('../server/api/admin/ai/delify/status.get') },
  ],
})
after(() => h.server.close())
const { aiProviders, aiModelPricing, aiUsageLogs, activityLogs } = h.schema

type Json = Record<string, unknown>
const answers = { key: { status: 200, body: {} as unknown }, receipts: { status: 200, body: {} as unknown } }
const HISTORY_ITEM = { timestamp: '2026-10-28T03:00:00.567Z', model: 'gpt-4o-mini', status: '200', cost: 0.001, input: 1000, output: 500, tok: 1500, tokS: 50 }

let updater: Awaited<ReturnType<typeof h.account>>
let reader: Awaited<ReturnType<typeof h.account>>
beforeEach(async () => {
  h.reset()
  updater = await h.account([{ resource: 'ai', canRead: true, canUpdate: true }], 'suaai')
  reader = await h.account([{ resource: 'ai', canRead: true }], 'xemai')
  await h.harness.db.insert(aiProviders).values({ id: 7, provider: 'delify', label: 'Delify Router', baseUrl: 'https://router.delify.example/v1', isActive: true, ...h.storedKey() })
  answers.key = { status: 200, body: { name: 'Khoá C11', groupName: 'Nhóm A', active: true, budgetUsd: 10, allowedModels: ['gpt-4o-mini'], rpm: 60, windowStartedAt: '2026-10-01T00:00:00Z', windowCostUsd: 1.5, windowRequests: 12 } }
  answers.receipts = { status: 200, body: { availableModels: [{ name: 'gpt-4o-mini', input: 0.15, output: 0.6 }], history: [] } }
  h.network.reply = (sent) => {
    const path = sent.path.split('?')[0]
    const answer = path === '/api/usage/key/receipts' ? answers.receipts : path === '/api/usage/key' ? answers.key : { status: 404, body: {} }
    return { status: answer.status, headers: { 'content-type': 'application/json' }, body: typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body) }
  }
})

const sync = (who = updater) => h.request('POST', '/api/admin/ai/delify/sync', who, {})
const status = (query = '', who = reader) => h.request('GET', `/api/admin/ai/delify/status${query}`, who)
const prices = () => h.harness.rows(aiModelPricing).map(row => [row.model, row.provider, Number(row.promptCostPerMillion), Number(row.completionCostPerMillion)]).sort()
const audits = () => h.harness.rows(activityLogs)
function assertKeyNowhere(body: unknown) {
  assert.ok(!containsSecret(JSON.stringify(body)), JSON.stringify(body).slice(0, 300))
  for (const table of [aiUsageLogs, aiModelPricing, activityLogs]) for (const row of h.harness.rows(table)) assert.ok(!containsSecret(JSON.stringify(row)), JSON.stringify(row))
  for (const line of h.logged) assert.ok(!containsSecret(line), line)
}

// ─── sync ────────────────────────────────────────────────────────────────────

test('sync needs ai.update: no session → 401, ai.read only → 403; nothing sent, nothing written', async () => {
  assert.equal((await h.request('POST', '/api/admin/ai/delify/sync', null, {})).status, 401)
  assert.equal((await sync(reader)).status, 403)
  assert.deepEqual(h.network.sent, [])
  assert.deepEqual([prices(), audits()], [[], []])
})

test('sync: prices upserted, history merged, one audit row with an object meta — and the dashboard figures it returns', async () => {
  await h.harness.db.insert(aiModelPricing).values({ model: 'gpt-4o-mini', provider: 'openai', label: 'cũ', promptCostPerMillion: '9', completionCostPerMillion: '9' })
  answers.receipts.body = {
    availableModels: [{ name: 'gpt-4o-mini', input: 0.15, output: 0.6 }, { name: 'claude-haiku', input: 0.8, output: 4 }],
    history: [HISTORY_ITEM, { ...HISTORY_ITEM, timestamp: '2026-10-28T04:00:00Z', status: '429', cost: 0 }],
  }
  const response = await sync()
  assert.equal(response.status, 200, JSON.stringify(response.body))
  assert.deepEqual(response.body, {
    ok: true, upserted: 2, skipped: 0, syncedLogs: 2, totalFromApi: 2,
    delifyUsage: { windowCostUsd: 1.5, windowRequests: 12, allowedModels: ['gpt-4o-mini'] },
  })
  assert.deepEqual(prices(), [['claude-haiku', 'delify', 0.8, 4], ['gpt-4o-mini', 'delify', 0.15, 0.6]])
  const logs = h.harness.rows(aiUsageLogs).map(row => [row.serviceKey, row.provider, row.model, row.promptTokens, row.completionTokens, row.totalTokens, Number(row.costUsd), Number(row.costVnd), row.executionMs, row.userId, row.success, row.errorMessage])
  assert.deepEqual(logs, [
    ['delify_router', 'delify', 'gpt-4o-mini', 1000, 500, 1500, 0.001, 25.5, 30000, updater.id, true, null],
    ['delify_router', 'delify', 'gpt-4o-mini', 1000, 500, 1500, 0, 0, 30000, updater.id, false, 'HTTP 429'],
  ])
  assert.deepEqual(audits().map(row => [row.userId, row.action, row.resource, row.resourceId, row.meta]), [
    [updater.id, 'update', 'ai', 7, { action: 'delify-pricing-and-logs-sync', upserted: 2, skipped: 0, syncedLogs: 2, totalFromApi: 2 }],
  ])
  // The key goes to the router as the `key` query value only, on the configured host.
  assert.deepEqual(h.network.sent.map(sent => [sent.hostname, sent.path.split('?')[0], new URLSearchParams(sent.path.split('?')[1]).get('key')]), [
    ['router.delify.example', '/api/usage/key/receipts', SECRET],
    ['router.delify.example', '/api/usage/key', SECRET],
  ])
  assertKeyNowhere(response.body)
})

test('sync: prices, history and the audit row commit together — a failed audit insert leaves nothing behind', async () => {
  answers.receipts.body = { availableModels: [{ name: 'gpt-4o-mini', input: 0.15, output: 0.6 }], history: [HISTORY_ITEM] }
  h.harness.failNext(/^insert into `activity_logs`/)
  assert.equal((await sync()).status, 500)
  assert.deepEqual([prices(), h.harness.rows(aiUsageLogs), audits()], [[], [], []])
})

test('sync: no delify provider → 404; no stored key → 400; a key that no longer decrypts → 500 with a fixed sentence; nothing sent', async () => {
  h.harness.sqlite.prepare('DELETE FROM ai_providers').run()
  assert.equal((await sync()).status, 404)
  await h.harness.db.insert(aiProviders).values({ id: 7, provider: 'delify', label: 'Delify', baseUrl: 'https://router.delify.example/v1', isActive: true })
  assert.equal((await sync()).status, 400)
  h.harness.sqlite.prepare('DELETE FROM ai_providers').run()
  await h.harness.db.insert(aiProviders).values({ id: 7, provider: 'delify', label: 'Delify', baseUrl: 'https://router.delify.example/v1', isActive: true, ...h.storedKey(SECRET, Buffer.alloc(32, 9).toString('base64')) })
  const undecryptable = await sync()
  assert.equal(undecryptable.status, 500)
  assert.equal(undecryptable.body.statusMessage, 'Không thể giải mã API key. Vui lòng cấu hình lại.')
  assert.deepEqual(h.network.sent, [])
})

test('sync: a refused base URL → 400 and nothing sent; a router error → 502 with the status only; an empty model list → 404; nothing written', async () => {
  h.harness.sqlite.prepare('UPDATE ai_providers SET base_url = \'http://10.0.0.5/v1\'').run()
  assert.equal((await sync()).status, 400)
  assert.deepEqual(h.network.sent, [])
  h.harness.sqlite.prepare('UPDATE ai_providers SET base_url = \'https://router.delify.example/v1\'').run()
  answers.receipts = { status: 503, body: `upstream down for key ${SECRET}` }
  const down = await sync()
  assert.equal(down.status, 502)
  assert.equal(down.body.statusMessage, 'Delify API trả lỗi HTTP 503.')
  answers.receipts = { status: 200, body: `not json ${SECRET}` }
  const garbage = await sync()
  assert.equal(garbage.status, 502)
  assert.equal(garbage.body.statusMessage, 'Delify Router API trả dữ liệu không hợp lệ.')
  answers.receipts = { status: 200, body: { availableModels: [] } }
  assert.equal((await sync()).status, 404)
  assert.deepEqual([prices(), audits()], [[], []])
  assertKeyNowhere([down.body, garbage.body])
})

test('FINDING-R5-5: a price outside DECIMAL(8,4) or negative is skipped, the rest of the sync still lands', async () => {
  answers.receipts.body = {
    availableModels: [
      { name: 'gpt-4o-mini', input: 0.15, output: 0.6 },
      { name: 'too-dear', input: 10_000, output: 1 },
      { name: 'negative', input: 1, output: -0.5 },
      { name: 'at-the-cap', input: 9999.9999, output: 0 },
    ],
  }
  const response = await sync()
  assert.equal(response.status, 200)
  assert.deepEqual([response.body.upserted, response.body.skipped], [2, 2])
  assert.deepEqual(prices(), [['at-the-cap', 'delify', 9999.9999, 0], ['gpt-4o-mini', 'delify', 0.15, 0.6]])
})

test('FINDING-R5-6: a model name longer than the column is skipped — never cut into another model\'s name and its price overwritten', async () => {
  const sixtyFour = 'm'.repeat(64)
  await h.harness.db.insert(aiModelPricing).values({ model: sixtyFour, provider: 'openai', label: 'giữ nguyên', promptCostPerMillion: '1', completionCostPerMillion: '2' })
  answers.receipts.body = { availableModels: [{ name: `${sixtyFour}-variant`, input: 50, output: 60 }, { name: 'gpt-4o-mini', input: 0.15, output: 0.6 }] }
  const response = await sync()
  assert.equal(response.status, 200)
  assert.deepEqual([response.body.upserted, response.body.skipped], [1, 1])
  assert.deepEqual(prices(), [['gpt-4o-mini', 'delify', 0.15, 0.6], [sixtyFour, 'openai', 1, 2]])
})

test('FINDING-R5-7: items of the wrong shape and absurd costs are skipped — not a 500 that drops the whole sync', async () => {
  answers.receipts.body = {
    availableModels: [{ name: 42, input: 1, output: 1 }, null, 'gpt', { name: 'gpt-4o-mini', input: 0.15, output: 0.6 }],
    history: [
      { ...HISTORY_ITEM, model: 7 },
      null,
      { ...HISTORY_ITEM, timestamp: 1730000000 },
      { ...HISTORY_ITEM, timestamp: '2026-10-28T05:00:00Z', cost: -5 },
      { ...HISTORY_ITEM, timestamp: '2026-10-28T06:00:00Z', cost: 1e9 },
      { ...HISTORY_ITEM, timestamp: '2026-10-28T07:00:00Z' },
    ],
  }
  const response = await sync()
  assert.equal(response.status, 200, JSON.stringify(response.body))
  assert.deepEqual([response.body.upserted, response.body.skipped, response.body.syncedLogs], [1, 3, 1])
  assert.deepEqual(prices(), [['gpt-4o-mini', 'delify', 0.15, 0.6]])
  assert.deepEqual(h.harness.rows(aiUsageLogs).map(row => [Number(row.costVnd), (row.createdAt as Date).toISOString()]), [[25.5, '2026-10-28T07:00:00.000Z']])
})

test('FINDING-R5-8: a history row is stored at the whole second MySQL keeps (rounded), so the next sync finds it instead of inserting it again', async () => {
  answers.receipts.body = {
    availableModels: [{ name: 'gpt-4o-mini', input: 0.15, output: 0.6 }],
    history: [HISTORY_ITEM, { ...HISTORY_ITEM, timestamp: '2026-10-28T03:10:00.499Z' }],
  }
  assert.equal((await sync()).body.syncedLogs, 2)
  // TIMESTAMP(0): .567 → :01 and .499 → :00, as MySQL 8.0.46 stores them (mysql-tz-evidence.log).
  assert.deepEqual(h.harness.sqlite.prepare('SELECT created_at FROM ai_usage_logs ORDER BY id').all().map(row => row.created_at), ['2026-10-28 03:00:01.000', '2026-10-28 03:10:00.000'])
  const again = await sync()
  assert.equal(again.body.syncedLogs, 0)
  assert.equal(h.harness.rows(aiUsageLogs).length, 2)
})

// ─── status ──────────────────────────────────────────────────────────────────

test('status needs ai.read: no session → 401, another resource → 403; nothing sent', async () => {
  const editor = await h.account([{ resource: 'news', canRead: true }], 'bientap')
  assert.equal((await h.request('GET', '/api/admin/ai/delify/status', null)).status, 401)
  assert.equal((await status('', editor)).status, 403)
  assert.deepEqual(h.network.sent, [])
})

test('status: the key card from the router\'s budget minus the spend recorded here; the period is one of five, 7d otherwise', async () => {
  await h.harness.db.insert(aiUsageLogs).values([
    { serviceKey: 'chatbot', provider: 'delify', model: 'gpt-4o-mini', costUsd: '1.500000', costVnd: '38250.00', success: true },
    { serviceKey: 'moderation', provider: 'openai', model: 'gpt-4o-mini', costUsd: '0.500000', costVnd: '12750.00', success: true },
  ])
  answers.receipts.body = {
    period: '30d',
    summary: { items: [{ model: 'gpt-4o-mini', input: 10, output: 5, requests: 2, cost: 0.2 }], totals: { input: 10, output: 5, requests: 2, cost: 0.2 }, peakTpm: 100, peakRpm: 3, peakTokS: 40 },
    history: Array.from({ length: 12 }, (_, index) => ({ ...HISTORY_ITEM, timestamp: `2026-10-${String(index + 10)}T00:00:00Z` })),
    availableModels: [{ name: 'gpt-4o-mini', input: 0.15, output: 0.6, cached: 0.07 }],
  }
  const response = await status('?period=30D')
  assert.equal(response.status, 200)
  const body = response.body as Json
  assert.equal(body.period, '30d')
  assert.equal(body.host, 'router.delify.example')
  assert.deepEqual(body.keyInfo, {
    name: 'Khoá C11', groupName: 'Nhóm A', active: true,
    budgetUsd: 10, budgetVnd: 255_000, usedCostUsd: 2, usedCostVnd: 51_000, remainingBudgetUsd: 8, remainingBudgetVnd: 204_000,
    totalRequests: 2, allowedModels: ['gpt-4o-mini'], rpm: 60, windowStartedAt: '2026-10-01T00:00:00Z',
  })
  assert.deepEqual(body.periodSummary, (answers.receipts.body as Json).summary)
  assert.equal((body.recentHistory as unknown[]).length, 10)
  assert.deepEqual((body.recentHistory as unknown[])[0], { ...HISTORY_ITEM, timestamp: '2026-10-10T00:00:00Z' })
  assert.deepEqual(body.availableModels, [{ name: 'gpt-4o-mini', input: 0.15, output: 0.6, cached: 0.07 }])
  assert.equal(new URLSearchParams(h.network.sent[1]!.path.split('?')[1]).get('period'), '30d')

  await status('?period=999d')
  assert.equal(new URLSearchParams(h.network.sent[3]!.path.split('?')[1]).get('period'), '7d')
})

test('status: not set up, no key, a key that no longer decrypts, a router that is down — a 200 with ok:false and a fixed sentence', async () => {
  answers.key = { status: 503, body: `down ${SECRET}` }
  const down = await status()
  assert.deepEqual(down.body, { ok: false, configured: true, error: 'Key API trả HTTP 503' })
  answers.key = { status: 200, body: `not json ${SECRET}` }
  assert.deepEqual((await status()).body, { ok: false, configured: true, error: 'Delify Router API trả dữ liệu không hợp lệ.' })

  h.harness.sqlite.prepare('DELETE FROM ai_providers').run()
  await h.harness.db.insert(aiProviders).values({ id: 7, provider: 'delify', label: 'Delify', baseUrl: 'https://router.delify.example/v1', isActive: true, ...h.storedKey(SECRET, Buffer.alloc(32, 9).toString('base64')) })
  assert.deepEqual((await status()).body, { ok: false, configured: true, error: 'Không thể giải mã API key.' })
  h.harness.sqlite.prepare('UPDATE ai_providers SET api_key_ciphertext = NULL').run()
  assert.deepEqual((await status()).body, { ok: false, configured: false, error: 'Chưa cấu hình API key cho Delify Router.' })
  h.harness.sqlite.prepare('DELETE FROM ai_providers').run()
  assert.deepEqual((await status()).body, { ok: false, configured: false, error: 'Chưa tạo nhà cung cấp Delify Router.' })
  assertKeyNowhere(down.body)
})

test('status: a receipts answer that fails leaves the key card standing, the breakdown empty', async () => {
  answers.receipts = { status: 500, body: 'oops' }
  const response = await status()
  assert.equal(response.body.ok, true)
  assert.deepEqual([response.body.periodSummary, response.body.recentHistory, response.body.availableModels], [null, [], []])
})

test('FINDING-R5-9: status passes on only the fields the dashboard shows — an extra field from the router (the key) never reaches the browser', async () => {
  answers.key.body = { ...(answers.key.body as Json), key: SECRET }
  answers.receipts.body = {
    summary: { apiKey: SECRET, items: [{ model: 'gpt-4o-mini', input: 1, output: 1, requests: 1, cost: 0.1, key: SECRET }], totals: { input: 1, output: 1, requests: 1, cost: 0.1, key: SECRET }, peakTpm: 1, debug: { key: SECRET } },
    history: [{ ...HISTORY_ITEM, request: { url: `/v1/chat?key=${SECRET}` } }],
    availableModels: [{ name: 'gpt-4o-mini', input: 0.15, output: 0.6, owner: SECRET }],
  }
  const response = await status()
  assert.equal(response.body.ok, true)
  assertKeyNowhere(response.body)
  assert.deepEqual(response.body.periodSummary, { items: [{ model: 'gpt-4o-mini', input: 1, output: 1, requests: 1, cost: 0.1 }], totals: { input: 1, output: 1, requests: 1, cost: 0.1 }, peakTpm: 1 })
  assert.deepEqual(response.body.recentHistory, [HISTORY_ITEM])
  assert.deepEqual(response.body.availableModels, [{ name: 'gpt-4o-mini', input: 0.15, output: 0.6 }])
})
