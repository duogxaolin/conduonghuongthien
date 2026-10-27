/**
 * Behaviour across the seams of `ai-gateway.ts` (wave3-long-term 4.3, D-SPLIT).
 *
 * Written BEFORE the 732-line file was split, and green on it (25bc314). It must stay
 * green, unchanged, after the split. Everything goes through `server/services/ai-gateway`,
 * the one path the endpoints, the chatbot, translation and moderation use (ten test
 * files `mock.module` exactly that path).
 *
 * `ai-gateway-streaming-paths` already pins the four SSE readings, and `ai-gateway-provider-url`
 * pins the URL policy. This file pins what a split breaks without a type error:
 *   - the runtime export list, exactly (a re-export lost or a helper leaked);
 *   - the prelude's refusals, in order, and what each one does NOT do: no budget check
 *     before the config, no key load before the budget, no decrypt without a full
 *     envelope, no DNS and no request before the URL policy;
 *   - the two module-level caches (config per service key, provider per provider NAME,
 *     60 s, a missing row cached too) and the uncached pricing read;
 *   - the provider → wire-format mapping (anthropic vs OpenAI-compatible);
 *   - token accounting per path: delify's 2000-token overhead, the length/3.5 estimate
 *     that only the no-tool paths fall back to, estimated figures never billed in the
 *     tool loop, a total recomputed from the parts;
 *   - the epilogue: cost from the pricing row, ONE usage log, the success log line;
 *   - the tool loop's handling of a missing tool, a throwing tool, a string result, the
 *     query shown to the visitor, and the replay sent to the model.
 *
 * Pinned as-is, NOT endorsed (findings, see the split's report):
 *   - a failed call writes no usage log: every `provider_error`/`parse_error` returns
 *     before `logAiUsage`, so `ai_usage_logs` only ever sees `success: true`;
 *   - a final tool-loop answer that cleans to nothing returns the raw text minus
 *     `<|channel>` spans — a `<think>` span survives into `text` (never streamed).
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'
import type { RequestOptions } from 'node:https'
import { Readable } from 'node:stream'
import test, { mock } from 'node:test'
import type { ProviderRequest, ResolveProviderHost } from '../server/utils/chatbot/outbound'

type Row = Record<string, unknown>

const rec = {
  budget: { allowed: true } as Row,
  budgetCalls: [] as string[],
  decryptThrows: false,
  decryptCalls: [] as Row[],
  usage: [] as Row[],
  warns: [] as Row[],
  infos: [] as Row[],
}

mock.module('../server/utils/ai-budget', {
  namedExports: { checkBudget: async (_db: unknown, serviceKey: string) => { rec.budgetCalls.push(serviceKey); return rec.budget } },
})
mock.module('../server/utils/ai-usage', { namedExports: { logAiUsage: async (_db: unknown, entry: Row) => { rec.usage.push(entry) } } })
mock.module('../server/utils/ai/crypto', {
  namedExports: {
    decryptAiSecret: (envelope: Row) => {
      rec.decryptCalls.push(envelope)
      if (rec.decryptThrows) throw new Error('auth tag mismatch')
      return 'sk-seam-key'
    },
  },
})
const realLogger = await import('../server/utils/logger')
mock.module('../server/utils/logger', {
  namedExports: { ...realLogger, logWarn: (fields: Row) => { rec.warns.push(fields) }, logInfo: (fields: Row) => { rec.infos.push(fields) } },
})

const gateway = await import('../server/services/ai-gateway')
const { callAi } = gateway
const { aiServiceConfigs, aiProviders, aiModelPricing } = await import('../server/db/schema')
const { calculateAiCost } = await import('../server/utils/ai-cost')

// ─── Fakes ───────────────────────────────────────────────────────────────────

let serial = 0
const unique = (prefix: string) => `${prefix}-${++serial}`

const configRow = (provider: string, extra: Row = {}): Row => ({
  provider, model: 'seam-model', isActive: true, systemPrompt: 'Bạn là {{role}}, nói {{lang}}. {{unknown}}', maxTokens: 900, ...extra,
})
/** The four named providers are cached by NAME for 60 s: every test uses this exact row for them. */
const providerRow = (provider: string, extra: Row = {}): Row => ({
  provider, baseUrl: 'https://api.provider.example/v1',
  apiKeyCiphertext: 'c', apiKeyNonce: 'n', apiKeyAuthTag: 't', apiKeyVersion: 1, apiKeyKeyId: 'k', apiKeyLastFour: 'abcd', ...extra,
})
const PRICING = { model: 'seam-model', promptCostPerMillion: '3', completionCostPerMillion: '15' }

function fakeDb(rows: { config?: Row | null, provider?: Row | null, pricing?: Row | null }) {
  const reads = { config: 0, provider: 0, pricing: 0 }
  const take = (table: unknown): unknown[] => {
    if (table === aiServiceConfigs) { reads.config++; return rows.config ? [rows.config] : [] }
    if (table === aiProviders) { reads.provider++; return rows.provider ? [rows.provider] : [] }
    if (table === aiModelPricing) { reads.pricing++; return rows.pricing ? [rows.pricing] : [] }
    throw new Error('unexpected table')
  }
  const db = {
    select: () => ({
      from: (table: unknown) => {
        const chain: { where: () => typeof chain, limit: () => Promise<unknown[]> } = { where: () => chain, limit: () => Promise.resolve(take(table)) }
        return chain
      },
    }),
  } as never
  return { db, reads }
}

const event = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`
const content = (text: string) => event({ choices: [{ delta: { content: text } }] })
const usage = (prompt: number, completion: number, estimated = false) => event({ usage: { prompt_tokens: prompt, completion_tokens: completion, estimated } })
const toolDelta = (delta: Row) => event({ choices: [{ delta: { tool_calls: [delta] } }] })
const DONE = 'data: [DONE]\n\n'
const sse = (text: string) => new Response(text, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

type Recorded = { body: Row, options: RequestOptions }
type Seen = { requests: Recorded[], lookups: string[] }

/** The socket below `outbound.ts` replays `responses` in order; everything above it is real. */
async function withProvider<T>(responses: Response[], run: (transport: { request: ProviderRequest, resolveHost: ResolveProviderHost }, seen: Seen) => Promise<T>): Promise<T> {
  const seen: Seen = { requests: [], lookups: [] }
  let next = 0
  const request: ProviderRequest = (options, onResponse) => {
    const written: string[] = []
    const req = Object.assign(new EventEmitter(), {
      write: (chunk: unknown) => { written.push(String(chunk)) },
      destroy: () => {},
      end: () => {
        seen.requests.push({ body: JSON.parse(written.join('') || '{}'), options })
        const response = responses[next++]
        if (!response) { queueMicrotask(() => req.emit('error', new Error(`unexpected request #${next}`))); return }
        const incoming = Object.assign(response.body ? Readable.fromWeb(response.body as never) : Readable.from([]),
          { statusCode: response.status, headers: Object.fromEntries(response.headers) }) as unknown as IncomingMessage
        queueMicrotask(() => onResponse(incoming))
      },
    })
    return req as never
  }
  const resolveHost: ResolveProviderHost = async (host) => { seen.lookups.push(host); return [{ address: '93.184.216.34', family: 4 }] }
  return run({ request, resolveHost }, seen)
}

function reset(budget: Row = { allowed: true }) {
  rec.budget = budget
  rec.budgetCalls.length = 0
  rec.decryptThrows = false
  rec.decryptCalls.length = 0
  rec.usage.length = 0
  rec.warns.length = 0
  rec.infos.length = 0
}

const VARIABLES = { role: 'trợ lý', lang: 'tiếng Việt' }
const SYSTEM = 'Bạn là trợ lý, nói tiếng Việt. {{unknown}}'

// ─── The surface ─────────────────────────────────────────────────────────────

test('the runtime export list is exactly the pre-split API: callAi, substituteVariables and three re-exported helpers', () => {
  assert.deepEqual(Object.keys(gateway).sort(),
    ['callAi', 'createStreamingCleaner', 'extractToolCallsFromMessage', 'parseToolArguments', 'substituteVariables'])
})

// ─── Prelude: refusals, in order, and what each one skips ────────────────────

const refusals: Array<{ label: string, rows: () => { config?: Row | null, provider?: Row | null }, budget?: Row, decryptThrows?: boolean,
  result: Row, budgetChecked: boolean, providerRead: boolean, decrypted: boolean, warn?: Row }> = [
  { label: 'no config row', rows: () => ({ config: null }), result: { ok: false, error: 'service_not_found' }, budgetChecked: false, providerRead: false, decrypted: false },
  { label: 'inactive service', rows: () => ({ config: configRow('delify', { isActive: false }) }),
    result: { ok: false, error: 'service_inactive' }, budgetChecked: false, providerRead: false, decrypted: false },
  { label: 'budget refused with its own reason', rows: () => ({ config: configRow('delify'), provider: providerRow('delify') }),
    budget: { allowed: false, reason: 'delify_quota_exhausted', errorMessage: 'Hết hạn mức Delify' },
    result: { ok: false, error: 'delify_quota_exhausted', errorMessage: 'Hết hạn mức Delify' }, budgetChecked: true, providerRead: false, decrypted: false },
  { label: 'budget refused bare', rows: () => ({ config: configRow('delify'), provider: providerRow('delify') }), budget: { allowed: false },
    result: { ok: false, error: 'budget_exceeded', errorMessage: 'Hệ thống hết ngân sách cho AI' }, budgetChecked: true, providerRead: false, decrypted: false },
  { label: 'no provider row', rows: () => { const name = unique('ghost'); return { config: configRow(name), provider: null } },
    result: { ok: false, error: 'no_api_key' }, budgetChecked: true, providerRead: true, decrypted: false, warn: { event: 'ai_gateway.key_unavailable', reason: 'provider_not_existent' } },
  ...(['apiKeyCiphertext', 'apiKeyNonce', 'apiKeyAuthTag', 'apiKeyVersion', 'apiKeyKeyId'] as const).map(field => ({
    label: `${field} missing`, rows: () => { const name = unique('partial'); return { config: configRow(name), provider: providerRow(name, { [field]: null }) } },
    result: { ok: false, error: 'no_api_key' }, budgetChecked: true, providerRead: true, decrypted: false, warn: { event: 'ai_gateway.key_unavailable', reason: 'no_key_stored' } })),
  { label: 'decrypt fails', rows: () => { const name = unique('rotated'); return { config: configRow(name), provider: providerRow(name) } }, decryptThrows: true,
    result: { ok: false, error: 'no_api_key' }, budgetChecked: true, providerRead: true, decrypted: true, warn: { event: 'ai_gateway.key_unavailable', reason: 'decrypt_failed' } },
  { label: 'no base URL', rows: () => { const name = unique('nourl'); return { config: configRow(name), provider: providerRow(name, { baseUrl: null }) } },
    result: { ok: false, error: 'service_inactive' }, budgetChecked: true, providerRead: true, decrypted: true },
  { label: 'no model', rows: () => { const name = unique('nomodel'); return { config: configRow(name, { model: null }), provider: providerRow(name) } },
    result: { ok: false, error: 'service_inactive' }, budgetChecked: true, providerRead: true, decrypted: true },
]

for (const refusal of refusals) {
  test(`prelude: ${refusal.label} → ${String(refusal.result.error)}, no DNS, no request, no usage log`, async () => {
    reset(refusal.budget)
    rec.decryptThrows = refusal.decryptThrows ?? false
    const rows = refusal.rows()
    const { db, reads } = fakeDb(rows)
    const serviceKey = unique('svc')
    await withProvider([], async (transport, seen) => {
      const result = await callAi(serviceKey, { prompt: 'xin chào', db, transport })
      assert.deepEqual(result, refusal.result)
      assert.deepEqual(rec.budgetCalls, refusal.budgetChecked ? [serviceKey] : [])
      assert.equal(reads.provider, refusal.providerRead ? 1 : 0)
      assert.equal(rec.decryptCalls.length, refusal.decrypted ? 1 : 0)
      assert.equal(reads.pricing, 0)
      assert.deepEqual(seen, { requests: [], lookups: [] })
      assert.deepEqual(rec.usage, [])
      assert.deepEqual(rec.infos, [])
      const provider = (rows.config as Row | null)?.provider
      assert.deepEqual(rec.warns, refusal.warn ? [{ event: refusal.warn.event, serviceKey, provider, reason: refusal.warn.reason }] : [])
    })
  })
}

test('prelude: the decrypt envelope is the stored row, a missing lastFour sent as an empty string', async () => {
  reset()
  rec.decryptThrows = true
  const name = unique('envelope')
  const { db } = fakeDb({ config: configRow(name), provider: providerRow(name, { apiKeyLastFour: null }) })
  await callAi(unique('svc'), { prompt: 'x', db })
  assert.deepEqual(rec.decryptCalls, [{ ciphertext: 'c', nonce: 'n', authTag: 't', version: 1, keyId: 'k', lastFour: '' }])
})

test('prelude: a stored base URL outside the policy stops before DNS, with the policy message and a warning', async () => {
  reset()
  const name = unique('plainhttp')
  const { db } = fakeDb({ config: configRow(name), provider: providerRow(name, { baseUrl: 'http://api.provider.example/v1' }) })
  const serviceKey = unique('svc')
  await withProvider([], async (transport, seen) => {
    const result = await callAi(serviceKey, { prompt: 'x', db, transport })
    assert.equal(result.ok, false)
    assert.equal(result.error, 'provider_url_rejected')
    assert.equal(typeof result.errorMessage, 'string')
    assert.ok(result.errorMessage)
    assert.deepEqual(seen, { requests: [], lookups: [] })
    assert.equal(rec.warns.length, 1)
    assert.equal(rec.warns[0]!.event, 'ai_gateway.provider_url_rejected')
    assert.equal(rec.warns[0]!.serviceKey, serviceKey)
    assert.equal(rec.warns[0]!.provider, name)
    assert.equal(typeof rec.warns[0]!.violation, 'string')
    assert.deepEqual(rec.usage, [])
  })
})

// ─── Module-level caches ─────────────────────────────────────────────────────

test('cache: a config row (even a missing one) is read once per service key for 60 s', async () => {
  reset()
  mock.timers.enable({ apis: ['Date'], now: 5_000_000 })
  try {
    const { db, reads } = fakeDb({ config: null })
    const first = unique('svc')
    assert.equal((await callAi(first, { prompt: 'x', db })).error, 'service_not_found')
    mock.timers.tick(59_999)
    assert.equal((await callAi(first, { prompt: 'x', db })).error, 'service_not_found')
    assert.equal(reads.config, 1, 'within 60 s the cached (missing) row answers')
    await callAi(unique('svc'), { prompt: 'x', db })
    assert.equal(reads.config, 2, 'another service key is its own entry')
    mock.timers.tick(1)
    await callAi(first, { prompt: 'x', db })
    assert.equal(reads.config, 3, 'at 60 s the row is read again')
  } finally {
    mock.timers.reset()
  }
})

test('cache: a provider row is read once per provider NAME for 60 s, shared across service keys', async () => {
  reset()
  mock.timers.enable({ apis: ['Date'], now: 9_000_000 })
  try {
    const name = unique('shared')
    const { db, reads } = fakeDb({ config: configRow(name), provider: providerRow(name, { apiKeyCiphertext: null }) })
    for (let i = 0; i < 3; i++) assert.equal((await callAi(unique('svc'), { prompt: 'x', db })).error, 'no_api_key')
    assert.equal(reads.provider, 1)
    mock.timers.tick(60_000)
    await callAi(unique('svc'), { prompt: 'x', db })
    assert.equal(reads.provider, 2)
  } finally {
    mock.timers.reset()
  }
})

test('cache: the pricing row is read on every successful call — never cached', async () => {
  reset()
  const serviceKey = unique('svc')
  const { db, reads } = fakeDb({ config: configRow('delify'), provider: providerRow('delify'), pricing: PRICING })
  const answer = () => json({ choices: [{ message: { content: 'Đáp.' } }], usage: { prompt_tokens: 2100, completion_tokens: 4 } })
  await withProvider([answer(), answer()], async (transport) => {
    await callAi(serviceKey, { prompt: 'x', db, transport })
    await callAi(serviceKey, { prompt: 'x', db, transport })
  })
  assert.equal(reads.config, 1)
  assert.equal(reads.pricing, 2)
})

// ─── Buffered path (no tools, no onChunk) and the epilogue ───────────────────

test('buffered: one OpenAI-compatible POST with the substituted system prompt, then ONE usage log and the success line', async () => {
  reset()
  const serviceKey = unique('svc')
  const { db } = fakeDb({ config: configRow('delify'), provider: providerRow('delify'), pricing: PRICING })
  await withProvider([json({ choices: [{ message: { content: '  Xin chào anh/chị.  ' } }], usage: { prompt_tokens: 2100, completion_tokens: 40, total_tokens: 2140 } })],
    async (transport, seen) => {
      const result = await callAi(serviceKey, { prompt: 'xin chào', variables: VARIABLES, userId: 42, db, transport })
      assert.equal(seen.requests.length, 1)
      const { body, options } = seen.requests[0]!
      assert.equal(options.method, 'POST')
      assert.equal(options.path, '/v1/chat/completions')
      assert.equal((options.headers as Row).Authorization, 'Bearer sk-seam-key')
      assert.deepEqual(body, { model: 'seam-model', messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: 'xin chào' }], stream: false, max_tokens: 900 })

      // delify's own 2000 prompt tokens come off; the total is recomputed from the parts.
      const { costUsd, costVnd } = calculateAiCost('seam-model', 100, 40, PRICING)
      assert.equal(costUsd, (100 * 3 + 40 * 15) / 1_000_000)
      assert.deepEqual(result, { ok: true, text: 'Xin chào anh/chị.', promptTokens: 100, completionTokens: 40, totalTokens: 140, costUsd, costVnd, toolCallsExecuted: undefined })
      assert.equal(rec.usage.length, 1)
      const { executionMs, ...entry } = rec.usage[0]!
      assert.ok(typeof executionMs === 'number' && executionMs >= 0)
      assert.deepEqual(entry, { serviceKey, provider: 'delify', model: 'seam-model', promptTokens: 100, completionTokens: 40, totalTokens: 140,
        costUsd, costVnd, userId: 42, success: true, errorMessage: null })
      assert.equal(rec.infos.length, 1)
      const { executionMs: infoMs, ...info } = rec.infos[0]!
      assert.equal(infoMs, executionMs)
      assert.deepEqual(info, { event: 'ai_gateway.call_succeeded', serviceKey, provider: 'delify', model: 'seam-model', promptTokens: 100, completionTokens: 40, totalTokens: 140, costVnd })
      assert.deepEqual(rec.warns, [])
    })
})

test('buffered: no pricing row → zero cost and a no_pricing warning; userId defaults to null', async () => {
  reset()
  const serviceKey = unique('svc')
  const { db } = fakeDb({ config: configRow('openai'), provider: providerRow('openai'), pricing: null })
  await withProvider([json({ choices: [{ message: { content: 'Đáp.' } }], usage: { prompt_tokens: 2100, completion_tokens: 40, total_tokens: 9999 } })],
    async (transport) => {
      const result = await callAi(serviceKey, { prompt: 'x', db, transport })
      // Not delify: nothing comes off, and the provider's own total is not trusted.
      assert.equal(result.promptTokens, 2100)
      assert.equal(result.totalTokens, 2140)
      assert.equal(result.costUsd, 0)
      assert.equal(result.costVnd, 0)
    })
  assert.deepEqual(rec.warns, [{ event: 'ai_usage.no_pricing', model: 'seam-model', serviceKey }])
  assert.equal(rec.usage[0]!.userId, null)
})

test('buffered: no usage reported → both counts estimated from the PROMPT and the answer (length / 3.5), history sent instead of the prompt', async () => {
  reset()
  const prompt = 'Tôi cần hỏi về thủ tục cư trú.'
  const answer = 'Anh/chị đến Công an xã nơi cư trú để đăng ký.'
  const history = [{ role: 'user', content: 'câu trước, dài hơn nhiều so với câu hỏi hiện tại' }, { role: 'assistant', content: 'đáp trước' }, { role: 'user', content: prompt }]
  const { db } = fakeDb({ config: configRow('delify', { maxTokens: null }), provider: providerRow('delify'), pricing: PRICING })
  await withProvider([json({ choices: [{ message: { content: answer } }] })], async (transport, seen) => {
    const result = await callAi(unique('svc'), { prompt, history, systemPrompt: 'Ghi đè {{role}}', variables: VARIABLES, db, transport })
    assert.deepEqual(seen.requests[0]!.body.messages, [{ role: 'system', content: 'Ghi đè trợ lý' }, ...history])
    assert.equal(seen.requests[0]!.body.max_tokens, 1200, 'no configured max → the provider builder default')
    assert.equal(result.promptTokens, Math.ceil(prompt.length / 3.5))
    assert.equal(result.completionTokens, Math.ceil(answer.length / 3.5))
    assert.equal(result.totalTokens, Math.ceil(prompt.length / 3.5) + Math.ceil(answer.length / 3.5))
  })
})

test('buffered: bytes after the last "}" are ignored', async () => {
  reset()
  const { db } = fakeDb({ config: configRow('delify'), provider: providerRow('delify'), pricing: PRICING })
  await withProvider([new Response('{"choices":[{"message":{"content":"Đáp án."}}]}\n<!-- proxy trailer -->', { status: 200 })], async (transport) => {
    const result = await callAi(unique('svc'), { prompt: 'x', db, transport })
    assert.equal(result.ok, true)
    assert.equal(result.text, 'Đáp án.')
  })
})

test('provider mapping: anthropic speaks /messages with x-api-key; google and an unknown name speak OpenAI-compatible', async () => {
  reset()
  const { db: anthropicDb } = fakeDb({ config: configRow('anthropic'), provider: providerRow('anthropic'), pricing: PRICING })
  await withProvider([json({ content: [{ type: 'text', text: 'Chào.' }], usage: { input_tokens: 12, output_tokens: 3 } })], async (transport, seen) => {
    const result = await callAi(unique('svc'), { prompt: 'xin chào', variables: VARIABLES, db: anthropicDb, transport })
    const { body, options } = seen.requests[0]!
    assert.equal(options.path, '/v1/messages')
    assert.equal((options.headers as Row)['x-api-key'], 'sk-seam-key')
    assert.equal((options.headers as Row).Authorization, undefined)
    assert.deepEqual(body, { model: 'seam-model', max_tokens: 900, system: SYSTEM, messages: [{ role: 'user', content: 'xin chào' }] })
    assert.deepEqual([result.text, result.promptTokens, result.completionTokens], ['Chào.', 12, 3])
  })
  for (const name of ['google', unique('custom')]) {
    const { db } = fakeDb({ config: configRow(name), provider: providerRow(name), pricing: PRICING })
    await withProvider([json({ choices: [{ message: { content: 'Ok.' } }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2 } })], async (transport, seen) => {
      const result = await callAi(unique('svc'), { prompt: 'x', db, transport })
      assert.equal(seen.requests[0]!.options.path, '/v1/chat/completions', name)
      assert.equal((seen.requests[0]!.options.headers as Row).Authorization, 'Bearer sk-seam-key', name)
      // usageMetadata is read for 'google' only; any other name falls back to the estimate.
      assert.equal(result.promptTokens, name === 'google' ? 7 : 1, name)
    })
  }
})

test('buffered: an empty tool list is not the tool loop', async () => {
  reset()
  const { db } = fakeDb({ config: configRow('delify'), provider: providerRow('delify'), pricing: PRICING })
  await withProvider([json({ choices: [{ message: { content: 'Đáp.' } }] })], async (transport, seen) => {
    assert.equal((await callAi(unique('svc'), { prompt: 'x', tools: [], db, transport })).ok, true)
    assert.equal(seen.requests.length, 1)
    assert.equal(seen.requests[0]!.body.tools, undefined)
    assert.equal(seen.requests[0]!.body.stream, false)
  })
})

const failures: Array<[string, () => Response, string]> = [
  ['HTTP 503', () => new Response('upstream down', { status: 503 }), 'provider_error'],
  ['a body that is not JSON', () => new Response('not json', { status: 200 }), 'provider_error'],
  ['an answer that is only reasoning', () => json({ choices: [{ message: { content: '<think>chỉ nghĩ</think>' } }] }), 'parse_error'],
]
for (const [label, response, error] of failures) {
  test(`buffered: ${label} → ${error}, and NO usage log (finding: failures are never logged)`, async () => {
    reset()
    const { db, reads } = fakeDb({ config: configRow('delify'), provider: providerRow('delify'), pricing: PRICING })
    await withProvider([response()], async (transport) => {
      assert.deepEqual(await callAi(unique('svc'), { prompt: 'x', db, transport }), { ok: false, error })
    })
    assert.deepEqual(rec.usage, [])
    assert.deepEqual(rec.infos, [])
    assert.equal(reads.pricing, 0)
  })
}

// ─── Streaming path (no tools, onChunk) ──────────────────────────────────────

test('streaming: HTTP 500 → provider_error, nothing relayed, no usage log', async () => {
  reset()
  const chunks: string[] = []
  const { db } = fakeDb({ config: configRow('delify'), provider: providerRow('delify'), pricing: PRICING })
  await withProvider([new Response('boom', { status: 500 })], async (transport, seen) => {
    assert.deepEqual(await callAi(unique('svc'), { prompt: 'x', onChunk: (c) => { chunks.push(c) }, db, transport }), { ok: false, error: 'provider_error' })
    assert.equal(seen.requests[0]!.body.stream, true)
  })
  assert.deepEqual(chunks, [])
  assert.deepEqual(rec.usage, [])
})

test('streaming: a non-delify provider keeps its prompt tokens; no usage at all → length/3.5 estimates', async () => {
  reset()
  const { db } = fakeDb({ config: configRow('openai'), provider: providerRow('openai'), pricing: PRICING })
  await withProvider([sse(content('Đáp án.') + usage(2100, 9) + DONE), sse(content('Một câu trả lời dài hơn.') + DONE)], async (transport) => {
    const billed = await callAi(unique('svc'), { prompt: 'x', onChunk: () => {}, db, transport })
    assert.deepEqual([billed.promptTokens, billed.completionTokens, billed.totalTokens], [2100, 9, 2109])
    const estimated = await callAi(unique('svc'), { prompt: 'câu hỏi', onChunk: () => {}, db, transport })
    assert.deepEqual([estimated.promptTokens, estimated.completionTokens], [Math.ceil('câu hỏi'.length / 3.5), Math.ceil('Một câu trả lời dài hơn.'.length / 3.5)])
  })
  assert.equal(rec.usage.length, 2)
})

test('streaming: an onChunk that throws on a streamed line does not fail the call — the answer is returned and logged', async () => {
  // `readChatSse` skips a line whose handling throws ("a broken line must not break
  // the whole answer"); the visitor-side failure stays the caller's business.
  reset()
  const { db } = fakeDb({ config: configRow('delify'), provider: providerRow('delify'), pricing: PRICING })
  await withProvider([sse(content('Đáp án.') + DONE)], async (transport) => {
    const result = await callAi(unique('svc'), { prompt: 'x', onChunk: () => { throw new Error('client gone') }, db, transport })
    assert.deepEqual([result.ok, result.text], [true, 'Đáp án.'])
  })
  assert.equal(rec.usage.length, 1)
})

// ─── Tool loop ───────────────────────────────────────────────────────────────

const toolCall = (id: string, name: string, args: string) => ({ id, type: 'function', function: { name, arguments: args } })

function seamTools() {
  const ran: string[] = []
  const tool = (name: string, execute: (args: Row) => unknown) => ({ name, description: `mô tả ${name}`, parameters: { type: 'object' }, execute: (args: Row) => { ran.push(name); return execute(args) } })
  return {
    ran,
    tools: [
      tool('search_c11_knowledge', () => [{ id: 1 }, { id: 2 }]),
      tool('search_c11_articles', () => 'Bài A; Bài B'),
      tool('list_topics', () => { throw new Error('kho trống') }),
      tool('throws_plain', () => { throw 'boom' }),
      tool('returns_null', () => null),
    ],
  }
}

test('tool loop (no onChunk): missing/throwing/string/null tools, the visitor-facing query, the replay, and summed tokens', async () => {
  reset()
  const { ran, tools } = seamTools()
  const events: Row[] = []
  const step1 = json({
    choices: [{ message: { role: 'assistant', content: null, tool_calls: [
      toolCall('c1', 'search_c11_knowledge', '{"query":"vay vốn"}'),
      toolCall('c2', 'search_c11_articles', '{"keyword":"hướng nghiệp"}'),
      toolCall('c3', 'list_topics', '{"type":"pháp luật"}'),
      toolCall('c4', 'missing_tool', '{}'),
      toolCall('c5', 'throws_plain', '{"query":"x"}'),
      toolCall('c6', 'returns_null', '{"query":""}'),
    ] } }],
    usage: { prompt_tokens: 2010, completion_tokens: 5 },
  })
  const step2 = json({ choices: [{ message: { content: ' Theo kho: được vay. ' } }], usage: { prompt_tokens: 2300, completion_tokens: 20 } })
  const { db } = fakeDb({ config: configRow('delify'), provider: providerRow('delify'), pricing: PRICING })
  await withProvider([step1, step2], async (transport, seen) => {
    const result = await callAi(unique('svc'), { prompt: 'xin chào', tools, onToolCall: (e) => { events.push(e) }, db, transport })
    assert.deepEqual(ran, ['search_c11_knowledge', 'search_c11_articles', 'list_topics', 'throws_plain', 'returns_null'])
    assert.equal(result.text, 'Theo kho: được vay.')
    assert.deepEqual([result.promptTokens, result.completionTokens, result.totalTokens], [10 + 300, 25, 335])
    assert.deepEqual(result.toolCallsExecuted, [
      { name: 'search_c11_knowledge', query: 'vay vốn', count: 2, data: [{ id: 1 }, { id: 2 }] },
      { name: 'search_c11_articles', query: 'hướng nghiệp', count: 1, data: 'Bài A; Bài B' },
      { name: 'list_topics', query: 'chủ đề: pháp luật', count: 1, data: { error: 'kho trống' } },
      { name: 'missing_tool', query: undefined, count: 1, data: { error: 'Tool missing_tool not found' } },
      { name: 'throws_plain', query: 'x', count: 1, data: { error: 'Tool execution error' } },
      { name: 'returns_null', query: undefined, count: 0, data: null },
    ])
    assert.deepEqual(events.map(e => [e.name, e.status, e.query, e.count]), result.toolCallsExecuted!.flatMap(t => [
      [t.name, 'calling', t.query, undefined], [t.name, 'done', t.query, t.count]]))

    const [first, second] = seen.requests.map(r => r.body)
    assert.deepEqual(first!.tools, tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })))
    assert.deepEqual([first!.tool_choice, first!.max_tokens, first!.stream], ['auto', 900, false])
    assert.deepEqual([second!.tools, second!.tool_choice, second!.max_tokens, second!.stream], [undefined, undefined, 900, false])
    const messages = second!.messages as Row[]
    assert.deepEqual(messages.slice(0, 2), [{ role: 'system', content: 'Bạn là {{role}}, nói {{lang}}. {{unknown}}' }, { role: 'user', content: 'xin chào' }])
    assert.deepEqual(messages[2], { role: 'assistant', content: null, tool_calls: [
      toolCall('c1', 'search_c11_knowledge', '{"query":"vay vốn"}'), toolCall('c2', 'search_c11_articles', '{"keyword":"hướng nghiệp"}'),
      toolCall('c3', 'list_topics', '{"type":"pháp luật"}'), toolCall('c4', 'missing_tool', '{}'),
      toolCall('c5', 'throws_plain', '{"query":"x"}'), toolCall('c6', 'returns_null', '{"query":""}')] })
    assert.deepEqual(messages.slice(3), [
      { role: 'tool', tool_call_id: 'c1', content: '[{"id":1},{"id":2}]' },
      { role: 'tool', tool_call_id: 'c2', content: 'Bài A; Bài B' },
      { role: 'tool', tool_call_id: 'c3', content: '{"error":"kho trống"}' },
      { role: 'tool', tool_call_id: 'c4', content: '{"error":"Tool missing_tool not found"}' },
      { role: 'tool', tool_call_id: 'c5', content: '{"error":"Tool execution error"}' },
      { role: 'tool', tool_call_id: 'c6', content: 'null' },
    ])
  })
  assert.equal(rec.usage.length, 1, 'one call, one usage log, whatever the number of steps')
  assert.deepEqual([rec.usage[0]!.promptTokens, rec.usage[0]!.completionTokens], [310, 25])
})

test('tool loop (no onChunk): no tool call → the step-1 message is the answer, in ONE request; empty → parse_error', async () => {
  reset()
  const { tools, ran } = seamTools()
  const { db } = fakeDb({ config: configRow('delify'), provider: providerRow('delify'), pricing: PRICING })
  await withProvider([
    json({ choices: [{ message: { content: '<think>x</think> Trả lời thẳng.' } }], usage: { prompt_tokens: 2001, completion_tokens: 3 } }),
    json({ choices: [{ message: { content: '' } }] }),
  ], async (transport, seen) => {
    const direct = await callAi(unique('svc'), { prompt: 'x', tools, db, transport })
    assert.deepEqual([direct.ok, direct.text, direct.promptTokens, direct.completionTokens], [true, 'Trả lời thẳng.', 1, 3])
    assert.equal(seen.requests.length, 1)
    assert.deepEqual(await callAi(unique('svc'), { prompt: 'x', tools, db, transport }), { ok: false, error: 'parse_error' })
  })
  assert.deepEqual(ran, [])
  assert.equal(rec.usage.length, 1)
})

test('tool loop (no onChunk): step 1 HTTP 502 → provider_error before any tool runs', async () => {
  reset()
  const { tools, ran } = seamTools()
  const { db } = fakeDb({ config: configRow('delify'), provider: providerRow('delify'), pricing: PRICING })
  await withProvider([new Response('bad gateway', { status: 502 })], async (transport) => {
    assert.deepEqual(await callAi(unique('svc'), { prompt: 'x', tools, db, transport }), { ok: false, error: 'provider_error' })
  })
  assert.deepEqual(ran, [])
  assert.deepEqual(rec.usage, [])
})

test('tool loop: a final answer that cleans to nothing returns the raw text minus <|channel> spans (finding: <think> survives into text)', async () => {
  reset()
  const { tools } = seamTools()
  const { db } = fakeDb({ config: configRow('delify'), provider: providerRow('delify'), pricing: PRICING })
  const callStep = () => json({ choices: [{ message: { tool_calls: [toolCall('c1', 'search_c11_knowledge', '{"query":"q"}')] } }] })
  const raw = '<|channel>analysis<channel|><think>nghĩ thầm</think>'
  await withProvider([callStep(), json({ choices: [{ message: { content: raw } }] })], async (transport) => {
    const result = await callAi(unique('svc'), { prompt: 'x', tools, db, transport })
    assert.deepEqual([result.ok, result.text], [true, '<think>nghĩ thầm</think>'])
  })
  const chunks: string[] = []
  const step1 = sse(toolDelta({ index: 0, id: 'c1', type: 'function', function: { name: 'search_c11_knowledge', arguments: '{"query":"q"}' } }) + DONE)
  await withProvider([step1, sse(content(raw) + DONE)], async (transport) => {
    const result = await callAi(unique('svc'), { prompt: 'x', tools, onChunk: (c) => { chunks.push(c) }, db, transport })
    assert.deepEqual([result.ok, result.text], [true, '<think>nghĩ thầm</think>'])
  })
  assert.deepEqual(chunks, [], 'never streamed to the visitor')
})

test('tool loop (onChunk): estimated step usage is never billed, and the loop has NO length estimate — zero tokens stay zero', async () => {
  reset()
  const { tools } = seamTools()
  const { db } = fakeDb({ config: configRow('delify'), provider: providerRow('delify'), pricing: PRICING })
  const step1 = sse(toolDelta({ index: 0, id: 'c1', type: 'function', function: { name: 'search_c11_knowledge', arguments: '{"query":"q"}' } }) + usage(2100, 12, true) + DONE)
  await withProvider([step1, sse(content('Đáp án cuối.') + DONE)], async (transport) => {
    const result = await callAi(unique('svc'), { prompt: 'một câu hỏi khá dài', tools, onChunk: () => {}, db, transport })
    assert.deepEqual([result.ok, result.text, result.promptTokens, result.completionTokens, result.totalTokens], [true, 'Đáp án cuối.', 0, 0, 0])
  })
  assert.deepEqual([rec.usage[0]!.promptTokens, rec.usage[0]!.completionTokens], [0, 0])
})

test('tool loop (onChunk): a non-delify provider adds every step in full', async () => {
  reset()
  const { tools } = seamTools()
  const { db } = fakeDb({ config: configRow('openai'), provider: providerRow('openai'), pricing: PRICING })
  const step1 = sse(toolDelta({ index: 0, id: 'c1', type: 'function', function: { name: 'search_c11_knowledge', arguments: '{"query":"q"}' } }) + usage(2100, 12) + DONE)
  await withProvider([step1, sse(content('Đáp.') + usage(2300, 20) + DONE)], async (transport) => {
    const result = await callAi(unique('svc'), { prompt: 'x', tools, onChunk: () => {}, db, transport })
    assert.deepEqual([result.promptTokens, result.completionTokens, result.totalTokens], [4400, 32, 4432])
  })
})

test('tool loop (onChunk): step 1 HTTP 500 → provider_error; a failed follow-up after a reasoning-only step 1 → parse_error', async () => {
  reset()
  const { tools, ran } = seamTools()
  const { db } = fakeDb({ config: configRow('delify'), provider: providerRow('delify'), pricing: PRICING })
  await withProvider([new Response('x', { status: 500 })], async (transport, seen) => {
    assert.deepEqual(await callAi(unique('svc'), { prompt: 'x', tools, onChunk: () => {}, db, transport }), { ok: false, error: 'provider_error' })
    assert.equal(seen.requests.length, 1)
  })
  await withProvider([sse(content('<think>chỉ nghĩ</think>') + DONE), new Response('x', { status: 500 })], async (transport, seen) => {
    assert.deepEqual(await callAi(unique('svc'), { prompt: 'x', tools, onChunk: () => {}, db, transport }), { ok: false, error: 'parse_error' })
    assert.equal(seen.requests.length, 2)
    assert.equal(seen.requests[1]!.body.tools, undefined)
  })
  assert.deepEqual(ran, [])
  assert.deepEqual(rec.usage, [])
})
