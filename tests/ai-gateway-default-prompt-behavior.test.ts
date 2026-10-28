/**
 * `callAi` (server/services/ai-gateway-call.ts) — WHICH system prompt goes to the model
 * when the stored one is empty.
 *
 * `prompt-defaults.ts` promises that the gateway "falls back to [the default] when a
 * service is enabled without a stored prompt". It did not: `input.systemPrompt ??
 * config.systemPrompt ?? ''` sent NO system prompt for a stored `null`, `''` or blank
 * one. For moderation that drops every rule the default carries — among them the
 * sovereignty one ("tôn vinh, bênh vực Trung Quốc … = VI PHẠM"), which no seeded keyword
 * rule covers — while `/admin/ai/moderation` showed the default in the box, so the
 * officer believed it was running. Emptying the box became reachable from the page in
 * this slice (FINDING-R4-8: the form's `null` is no longer ignored), so it is fixed here
 * at the gateway, for every caller at once (FINDING-R4-9).
 *
 * The invariants:
 *   - a stored prompt that is null, empty or only whitespace → the service's built-in
 *     default (`AI_SERVICE_DEFAULT_PROMPTS[serviceKey]`), variables substituted;
 *   - a stored prompt with text → that prompt, as before;
 *   - a service with no built-in default keeps the old behaviour (no system prompt);
 *   - a caller that passes its own `systemPrompt` (the chatbot's grounded prompt) is
 *     unaffected, whatever is stored.
 *
 * Real `callAi`, real request building and the real `safeProviderRequest` down to a
 * fake socket (the `ai-gateway-seams-behavior` harness); budget, usage log, key
 * decryption and logger are fakes. Each test uses its own service key, so the 60 s
 * config cache never answers for another test.
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'
import test, { mock } from 'node:test'
import type { ProviderRequest, ResolveProviderHost } from '../server/utils/chatbot/outbound'

type Row = Record<string, unknown>

mock.module('../server/utils/ai-budget', { namedExports: { checkBudget: async () => ({ allowed: true }) } })
mock.module('../server/utils/ai-usage', { namedExports: { logAiUsage: async () => {} } })
mock.module('../server/utils/ai/crypto', { namedExports: { decryptAiSecret: () => 'sk-default-prompt-key' } })
const realLogger = await import('../server/utils/logger')
mock.module('../server/utils/logger', { namedExports: { ...realLogger, logWarn: () => {}, logInfo: () => {} } })

const { callAi } = await import('../server/services/ai-gateway')
const { aiServiceConfigs, aiProviders, aiModelPricing } = await import('../server/db/schema')
const defaults = await import('../server/utils/ai/prompt-defaults')

function fakeDb(config: Row) {
  const take = (table: unknown): unknown[] => {
    if (table === aiServiceConfigs) return [config]
    if (table === aiProviders) {
      return [{ provider: config.provider, baseUrl: 'https://api.provider.example/v1', apiKeyCiphertext: 'c', apiKeyNonce: 'n', apiKeyAuthTag: 't', apiKeyVersion: 1, apiKeyKeyId: 'k', apiKeyLastFour: 'abcd' }]
    }
    if (table === aiModelPricing) return []
    throw new Error('unexpected table')
  }
  return {
    select: () => ({
      from: (table: unknown) => {
        const chain: { where: () => typeof chain, limit: () => Promise<unknown[]> } = { where: () => chain, limit: () => Promise.resolve(take(table)) }
        return chain
      },
    }),
  } as never
}

/** One call through the real gateway; returns the JSON body the provider received. */
async function sentBody(serviceKey: string, config: Row, input: Row = {}): Promise<Row> {
  const bodies: Row[] = []
  const request: ProviderRequest = (_options, onResponse) => {
    const written: string[] = []
    const req = Object.assign(new EventEmitter(), {
      write: (chunk: unknown) => { written.push(String(chunk)) },
      destroy: () => {},
      end: () => {
        bodies.push(JSON.parse(written.join('')))
        // Both wire formats in one answer: OpenAI-compatible `choices`, Anthropic `content`.
        const response = new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], content: [{ type: 'text', text: 'ok' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }))
        const incoming = Object.assign(Readable.fromWeb(response.body as never), { statusCode: 200, headers: {} }) as unknown as IncomingMessage
        queueMicrotask(() => onResponse(incoming))
      },
    })
    return req as never
  }
  const resolveHost: ResolveProviderHost = async () => [{ address: '93.184.216.34', family: 4 }]
  const result = await callAi(serviceKey, { prompt: 'Nội dung cần xử lý', variables: { lang: 'en' }, db: fakeDb({ isActive: true, model: 'm', maxTokens: 100, ...config }), transport: { request, resolveHost }, ...input })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(bodies.length, 1)
  return bodies[0]!
}
const systemOf = (body: Row) => (body.messages as Array<{ role: string, content: string }>)[0]!
const anthropicSystemOf = (body: Row) => body.system

test('FINDING-R4-9: moderation with no stored prompt runs on its built-in default — sovereignty rule included', async () => {
  const body = await sentBody('moderation', { provider: 'delify', systemPrompt: null })
  assert.deepEqual(systemOf(body), { role: 'system', content: defaults.DEFAULT_MODERATION_SYSTEM_PROMPT })
  assert.match(systemOf(body).content, /tranh chấp chủ quyền/)
})

test('FINDING-R4-9: an empty or whitespace-only stored prompt also means the default, on both wire formats', async () => {
  assert.equal(systemOf(await sentBody('translation_article', { provider: 'delify', systemPrompt: '' })).content, defaults.DEFAULT_TRANSLATION_ARTICLE_SYSTEM_PROMPT)
  assert.equal(anthropicSystemOf(await sentBody('translation_ui', { provider: 'anthropic', systemPrompt: '  \n\t ' })), defaults.DEFAULT_TRANSLATION_UI_SYSTEM_PROMPT)
})

test('a stored prompt with text is used as written, variables substituted', async () => {
  const body = await sentBody('editorial_assistant', { provider: 'delify', systemPrompt: '  Biên tập sang {{lang}}.  ' })
  assert.equal(systemOf(body).content, '  Biên tập sang en.  ')
})

test('a service with no built-in default keeps sending what is stored (nothing)', async () => {
  assert.equal(systemOf(await sentBody('custom_service', { provider: 'delify', systemPrompt: null })).content, '')
})

test('a caller\'s own system prompt wins over the stored one and over the default (the chatbot is unchanged)', async () => {
  const body = await sentBody('chatbot', { provider: 'delify', systemPrompt: null }, { systemPrompt: 'Prompt có căn cứ của lượt chat' })
  assert.equal(systemOf(body).content, 'Prompt có căn cứ của lượt chat')
})

test('FINDING-R4-9: effectiveSystemPrompt is the one rule the gateway and the moderation settings page share', () => {
  const { effectiveSystemPrompt, AI_SERVICE_DEFAULT_PROMPTS } = defaults
  for (const stored of [null, undefined, '', ' ', '\n\t']) {
    assert.equal(effectiveSystemPrompt('moderation', stored), AI_SERVICE_DEFAULT_PROMPTS.moderation, JSON.stringify(stored))
  }
  assert.equal(effectiveSystemPrompt('moderation', ' x '), ' x ')
  assert.equal(effectiveSystemPrompt('custom_service', null), '')
  assert.equal(effectiveSystemPrompt('custom_service', '  '), '  ')
  // Not an own key of the table: no default.
  assert.equal(effectiveSystemPrompt('toString', null), '')
})
