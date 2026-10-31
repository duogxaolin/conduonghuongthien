import assert from 'node:assert/strict'
import test, { after, beforeEach } from 'node:test'

/**
 * Delify Router's usage API in the AI panel:
 *   - `POST /api/admin/ai/delify/sync` (server/api/admin/ai/delify/sync.post.ts) —
 *     calls `/api/usage/key/receipts` with the stored key and upserts the router's
 *     model prices into `ai_model_pricing`, with an audit row, in one transaction. Its
 *     request history is NOT written to `ai_usage_logs` (the table `checkBudget` sums:
 *     a row there IS spend) — every delify call is already a row there, written by the
 *     gateway; importing the router's copy counted each request twice (R5 PROBE-5);
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
 *   - one delify request is one usage row and one cost, whatever the router's history
 *     holds (the R5-8 dedupe of imported rows is gone with the import);
 *   - pricing and the audit row commit together (`meta` an object);
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
const { aiProviders, aiModelPricing, aiUsageLogs, activityLogs, aiServiceConfigs, aiBudgetSettings } = h.schema
const { callAi } = await import('../server/services/ai-gateway')
const { checkBudget } = await import('../server/utils/ai-budget')

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

test('sync: prices upserted, the router\'s history NOT written, one audit row with an object meta — and the dashboard figures it returns', async () => {
  await h.harness.db.insert(aiModelPricing).values({ model: 'gpt-4o-mini', provider: 'openai', label: 'cũ', promptCostPerMillion: '9', completionCostPerMillion: '9' })
  answers.receipts.body = {
    availableModels: [{ name: 'gpt-4o-mini', input: 0.15, output: 0.6 }, { name: 'claude-haiku', input: 0.8, output: 4 }],
    history: [HISTORY_ITEM, { ...HISTORY_ITEM, timestamp: '2026-10-28T04:00:00Z', status: '429', cost: 0 }],
  }
  const response = await sync()
  assert.equal(response.status, 200, JSON.stringify(response.body))
  assert.deepEqual(response.body, {
    ok: true, upserted: 2, skipped: 0, totalFromApi: 2,
    delifyUsage: { windowCostUsd: 1.5, windowRequests: 12, allowedModels: ['gpt-4o-mini'] },
  })
  assert.deepEqual(prices(), [['claude-haiku', 'delify', 0.8, 4], ['gpt-4o-mini', 'delify', 0.15, 0.6]])
  assert.deepEqual(h.harness.rows(aiUsageLogs), [])
  assert.deepEqual(audits().map(row => [row.userId, row.action, row.resource, row.resourceId, row.meta]), [
    [updater.id, 'update', 'ai', 7, { action: 'delify-pricing-sync', upserted: 2, skipped: 0, totalFromApi: 2 }],
  ])
  // The key goes to the router as the `key` query value only, on the configured host.
  assert.deepEqual(h.network.sent.map(sent => [sent.hostname, sent.path.split('?')[0], new URLSearchParams(sent.path.split('?')[1]).get('key')]), [
    ['router.delify.example', '/api/usage/key/receipts', SECRET],
    ['router.delify.example', '/api/usage/key', SECRET],
  ])
  assertKeyNowhere(response.body)
})

test('sync: prices and the audit row commit together — a failed audit insert leaves nothing behind', async () => {
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

test('FINDING-R5-7: model items of the wrong shape are skipped — not a 500 that drops the whole sync', async () => {
  answers.receipts.body = {
    availableModels: [{ name: 42, input: 1, output: 1 }, null, 'gpt', { name: 'gpt-4o-mini', input: 0.15, output: 0.6 }],
  }
  const response = await sync()
  assert.equal(response.status, 200, JSON.stringify(response.body))
  assert.deepEqual([response.body.upserted, response.body.skipped], [1, 3])
  assert.deepEqual(prices(), [['gpt-4o-mini', 'delify', 0.15, 0.6]])
})

test('the router\'s history, whatever it holds, writes no usage row and cannot fail the sync — synced twice, still none', async () => {
  // What R5-7/R5-8 guarded when the history was imported (shapes, INT columns, rounded
  // seconds and tokens, the dedupe key) has nothing left to guard: nothing is written.
  answers.receipts.body = {
    availableModels: [{ name: 'gpt-4o-mini', input: 0.15, output: 0.6 }],
    history: [
      HISTORY_ITEM, HISTORY_ITEM, null, { ...HISTORY_ITEM, model: 7 }, { ...HISTORY_ITEM, cost: -5 }, { ...HISTORY_ITEM, cost: 1e9 },
      { ...HISTORY_ITEM, tok: 1500, tokS: 0.0005 }, { ...HISTORY_ITEM, output: 3e9 }, { ...HISTORY_ITEM, input: 1.5 }, { ...HISTORY_ITEM, status: '429' },
    ],
  }
  for (let round = 0; round < 2; round += 1) {
    const response = await sync()
    assert.equal(response.status, 200, JSON.stringify(response.body))
    assert.deepEqual([response.body.upserted, response.body.skipped, response.body.totalFromApi], [1, 0, 1])
  }
  assert.deepEqual(h.harness.rows(aiUsageLogs), [])
  assert.equal(audits().length, 2)
})

test('one delify request is ONE usage row and ONE cost: the sync does not write the router\'s copy of a call the gateway already logged', async () => {
  // Root cause of the Delify double count (R5, verifier PROBE-5): `callAi` logs the call,
  // then "Đồng bộ" imported the same request from the router's history as a
  // `delify_router` row — `checkBudget`, the dashboard and the key card summed both.
  await h.harness.db.insert(aiServiceConfigs).values({ serviceKey: 'translation_article', serviceName: 'Dịch bài', provider: 'delify', model: 'gpt-4o-mini', isActive: true })
  await h.harness.db.insert(aiModelPricing).values({ model: 'gpt-4o-mini', provider: 'delify', promptCostPerMillion: '0.15', completionCostPerMillion: '0.6' })
  await h.harness.db.insert(aiBudgetSettings).values({ id: 1, monthlyBudgetVnd: 1_000_000, warningThresholdPct: 80 })
  const routerReply = h.network.reply
  // delify reports its 2000-token overhead on the completion; the gateway bills 1000 / 500.
  h.network.reply = sent => sent.path.startsWith('/v1/chat/completions')
    ? { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ choices: [{ message: { content: 'Bản dịch.' } }], usage: { prompt_tokens: 3000, completion_tokens: 500 } }) }
    : routerReply(sent)
  const call = await callAi('translation_article', { prompt: 'Dịch', userId: null })
  assert.equal(call.ok, true, JSON.stringify(call))
  const [gatewayRow] = h.harness.rows(aiUsageLogs)
  const oneCallVnd = Number(gatewayRow!.costVnd)
  assert.ok(oneCallVnd > 0)

  // The router lists that very request in its history; an officer presses "Đồng bộ".
  answers.receipts.body = {
    availableModels: [{ name: 'gpt-4o-mini', input: 0.15, output: 0.6 }],
    history: [{ ...HISTORY_ITEM, timestamp: (gatewayRow!.createdAt as Date).toISOString(), input: 1000, output: 500, tok: 1500, cost: 0.00045 }],
  }
  assert.equal((await sync()).status, 200)
  assert.deepEqual(h.harness.rows(aiUsageLogs).map(row => [row.serviceKey, row.promptTokens, row.completionTokens]), [['translation_article', 1000, 500]])
  assert.equal((await checkBudget(h.harness.db as never, 'translation_article')).monthlySpendVnd, oneCallVnd)
  const card = (await status()).body.keyInfo as Json
  assert.deepEqual([card.usedCostVnd, card.totalRequests], [oneCallVnd, 1])
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

test('FINDING-R5-9: the key card and the sync answer keep only plain values of the router\'s fields', async () => {
  answers.key.body = { name: { key: SECRET }, groupName: [SECRET], active: 'yes', budgetUsd: 10, allowedModels: ['gpt-4o-mini', { key: SECRET }, 7], rpm: { key: SECRET }, windowStartedAt: { key: SECRET }, windowCostUsd: { key: SECRET }, windowRequests: `${SECRET}` }
  const card = await status()
  assertKeyNowhere(card.body)
  const keyInfo = card.body.keyInfo as Json
  assert.deepEqual([keyInfo.name, keyInfo.groupName, keyInfo.active, keyInfo.allowedModels, keyInfo.rpm, keyInfo.windowStartedAt], ['Delify Key', 'Default', false, ['gpt-4o-mini'], null, null])
  const synced = await sync()
  assertKeyNowhere(synced.body)
  assert.deepEqual(synced.body.delifyUsage, { windowCostUsd: null, windowRequests: null, allowedModels: ['gpt-4o-mini'] })
})
