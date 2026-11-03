import assert from 'node:assert/strict'
import test, { after } from 'node:test'

/**
 * A failed AI call is one `ai_usage_logs` row (decided 2026-10-31): `success: false`, the
 * classified code, 0 tokens, 0 cost (`recordAiFailure`, server/services/ai-gateway-record.ts).
 * Until then a failed call wrote nothing, so the dashboard's success rate only ever saw the
 * router-imported and test-call failures.
 *
 * What every reader of the table does with such a row — the rows are written by the real
 * `callAi` (provider answering 200, then 503), not inserted by hand:
 *   - `checkBudget` (server/utils/ai-budget.ts): the spend is the answered call's, unchanged;
 *   - `GET /api/admin/ai/usage`: cost and tokens unchanged; the failed call counts as a
 *     request (total, by service, by day) and lowers the success rate — the very figure the
 *     dashboard shows next to the request count;
 *   - `GET /api/admin/ai/delify/status`: "used" unchanged, the request count includes it;
 *   - `GET /api/admin/ai/logs`: listed, and found by the "failed" filter.
 * `enforceAiQuota` (the chatbot's per-session/IP quota) counts in `rate_limit_counters`,
 * not in this table: unaffected by construction.
 *
 * Real h3 app + `admin-auth`, SQL on SQLite, the real gateway down to a fake socket
 * (`_ai-route-harness.ts`).
 */

const { startAiRouteHarness, containsSecret } = await import('./_ai-route-harness')
const h = await startAiRouteHarness({
  routes: async load => [
    { method: 'get', path: '/api/admin/ai/usage', handler: await load('../server/api/admin/ai/usage.get') },
    { method: 'get', path: '/api/admin/ai/delify/status', handler: await load('../server/api/admin/ai/delify/status.get') },
    { method: 'get', path: '/api/admin/ai/logs', handler: await load('../server/api/admin/ai/logs/index.get') },
  ],
})
after(() => h.server.close())
const { aiUsageLogs } = h.schema
const { callAi } = await import('../server/services/ai-gateway')
const { checkBudget } = await import('../server/utils/ai-budget')

type Json = Record<string, unknown>

// The daily breakdown's `CONVERT_TZ(created_at, '+00:00', '+07:00')` — the one form
// `usage.get.ts` uses, as `ai-usage-month-behavior` models it.
h.harness.sqlite.function('convert_tz', { deterministic: true }, (value, from, to) => {
  if (from !== '+00:00' || to !== '+07:00') throw new Error(`CONVERT_TZ(${String(from)}, ${String(to)}) is not modelled`)
  if (value === null) return null
  return new Date(Date.parse(`${String(value).replace(' ', 'T')}Z`) + 7 * 3600_000).toISOString().slice(0, 19).replace('T', ' ')
})

test('a failed call is one row of 0 tokens and 0 cost: spend and tokens unchanged everywhere, one more request, a lower success rate', async () => {
  h.reset()
  const reader = await h.account([{ resource: 'ai', canRead: true }], 'xemai')
  await h.seedAiService({ serviceKey: 'editorial_assistant', provider: 'delify', baseUrl: 'https://router.delify.example/v1', model: 'gpt-4o-mini' })
  let chat = { status: 200, body: JSON.stringify({ choices: [{ message: { content: 'Đáp.' } }], usage: { prompt_tokens: 2100, completion_tokens: 50 } }) }
  h.network.reply = (sent) => {
    const path = sent.path.split('?')[0]
    if (path === '/v1/chat/completions') return { status: chat.status, headers: { 'content-type': 'application/json' }, body: chat.body }
    const body = path === '/api/usage/key' ? { name: 'Khoá', active: true, budgetUsd: 10 } : { history: [] }
    return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  }

  const answered = await callAi('editorial_assistant', { prompt: 'Viết lại', userId: reader.id })
  assert.equal(answered.ok, true, JSON.stringify(answered))
  // The provider fails, echoing the key it was sent: the row keeps the code only.
  chat = { status: 503, body: `upstream down, key ${String(h.network.sent[0]!.headers.authorization)}` }
  const failed = await callAi('editorial_assistant', { prompt: 'Viết lại', userId: reader.id })
  assert.deepEqual(failed, { ok: false, error: 'provider_error' })

  const rows = h.harness.rows(aiUsageLogs)
  assert.deepEqual(rows.map(row => [row.serviceKey, row.provider, row.model, row.promptTokens, row.completionTokens, row.totalTokens, Number(row.costUsd), Number(row.costVnd), row.userId, row.success, row.errorMessage]), [
    ['editorial_assistant', 'delify', 'gpt-4o-mini', 100, 50, 150, Number(answered.costUsd!.toFixed(6)), Number(answered.costVnd!.toFixed(2)), reader.id, true, null],
    ['editorial_assistant', 'delify', 'gpt-4o-mini', 0, 0, 0, 0, 0, reader.id, false, 'provider_error'],
  ])
  for (const row of rows) assert.ok(!containsSecret(JSON.stringify(row)), JSON.stringify(row))
  const spend = Number(rows[0]!.costVnd)
  assert.ok(spend > 0)

  // Budget guard: the answered call's spend, nothing for the failure.
  assert.equal((await checkBudget(h.harness.db as never, 'editorial_assistant')).monthlySpendVnd, spend)

  // Dashboard.
  const usage = (await h.request('GET', '/api/admin/ai/usage', reader)).body as Json
  assert.deepEqual(usage.usage, { monthlyCostVnd: spend, totalPromptTokens: 100, totalCompletionTokens: 50, totalRequests: 2, successRate: 50 })
  assert.deepEqual(usage.byService, [{ serviceKey: 'editorial_assistant', costVnd: spend, promptTokens: 100, completionTokens: 50, requests: 2 }])
  assert.deepEqual((usage.daily as Json[]).map(day => [day.costVnd, day.requests]), [[spend, 2]])

  // The Delify key card: used = the spend recorded here; the failed call is a call.
  const card = ((await h.request('GET', '/api/admin/ai/delify/status', reader)).body as Json).keyInfo as Json
  assert.deepEqual([card.usedCostVnd, card.totalRequests], [spend, 2])

  // The log list shows it, and the "failed" filter finds exactly it.
  const failedOnly = (await h.request('GET', '/api/admin/ai/logs?success=false', reader)).body as Json
  assert.deepEqual((failedOnly.logs as Json[]).map(log => [log.success, log.errorMessage, log.totalTokens, log.costVnd]), [[false, 'provider_error', 0, 0]])
  const all = (await h.request('GET', '/api/admin/ai/logs', reader)).body as Json
  assert.equal((all.pagination as Json).total, 2)
})
