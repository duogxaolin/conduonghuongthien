/**
 * Redaction by key name in `server/utils/logger.ts` — what must stay hidden, and the one thing
 * that no longer is.
 *
 * KNOWN-B of the `callAi` split (docs/decisions/refactor-large-files.md): `SECRET_KEY_PATTERN`
 * matches the substring "token", so the success line of every AI call, `ai_gateway.call_succeeded`
 * (server/services/ai-gateway-record.ts), printed `promptTokens`/`completionTokens`/`totalTokens`
 * as `[redacted]` — the log lost its usage numbers (`ai_usage_logs` kept them). Fixed with an
 * allowlist of those three exact names, honoured only while the value is a number — not by loosening
 * the pattern: this file's first table is every spelling of a credential a log could carry, and
 * each must still be redacted wherever it sits (top level, nested, in an array, deep), whatever
 * its value — a numeric OTP under `token` included.
 *
 * Only by key name: the logger does not look inside strings (a credential under an innocent key,
 * `note: "Bearer …"`, is written as is — truncated past 512 characters, tests/logging.test.ts).
 * Nothing here changes that; it is listed as KNOWN in the docs.
 */
import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import { REDACTED, buildLogRecord } from '../server/utils/logger'

const AT = new Date('2026-10-30T03:00:00.000Z')
const record = (fields: Record<string, unknown>) => buildLogRecord('info', { event: 'x', ...fields }, AT) as Record<string, unknown>

/** Every key that names a credential. Variants of case, separator and number; plurals; prefixes. */
const SECRET_KEYS = [
  // token
  'token', 'Token', 'TOKEN', 'tokens', 'accessToken', 'access_token', 'ACCESS_TOKEN', 'access-token', 'AccessToken',
  'accessTokens', 'refreshToken', 'refresh_token', 'refreshTokens', 'idToken', 'id_token', 'idTokens', 'authToken',
  'authTokens', 'csrfToken', 'csrfTokens', 'sessionToken', 'apiToken', 'apiTokens', 'bearerToken', 'x-auth-token',
  // near the allowed count names, but not them
  'PromptTokens', 'prompttokens', 'PROMPTTOKENS', 'prompt_tokens', 'prompt-tokens', 'PROMPT_TOKENS', 'completion_tokens',
  'total_tokens', 'totalToken', 'promptToken', 'promptTokensSecret', 'totalTokensHash', 'xpromptTokens', 'promptTokens ',
  // password
  'password', 'Password', 'PASSWORD', 'pass', 'passwd', 'passphrase', 'newPassword', 'password_hash', 'passwordHash',
  // secret, key, credential, hash
  'secret', 'clientSecret', 'client_secret', 'JWT_SECRET', 'webhookSecret', 'apiKey', 'api_key', 'api-key', 'APIKEY',
  'x-api-key', 'X-Api-Key', 'credential', 'credentials', 'dbCredential', 'hash', 'Hash',
  // headers
  'authorization', 'Authorization', 'proxy-authorization', 'cookie', 'Cookie', 'set-cookie', 'cookies',
] as const

/** The counts the AI gateway logs: never a credential, always a number. */
const COUNT_KEYS = ['promptTokens', 'completionTokens', 'totalTokens'] as const

/** Values a secret can take — a numeric one-time code is still a secret. */
const SECRET_VALUES: unknown[] = ['sk-live-Zq81', 482913, { nested: 'sk-obj' }, ['sk-arr'], true]

/** The same key in four places of one record; returns what each place came out as. */
function placed(key: string, value: unknown) {
  const line = record({
    [key]: value,
    headers: { [key]: value },
    items: [{ [key]: value }, { other: 1 }],
    a: { b: { [key]: value } },
  }) as { headers: Record<string, unknown>, items: Array<Record<string, unknown>>, a: { b: Record<string, unknown> } } & Record<string, unknown>
  return { line, at: [line[key], line.headers[key], line.items[0]![key], line.a.b[key]] }
}

describe('logger redaction: every credential key stays hidden', () => {
  it(`the table is ${SECRET_KEYS.length} keys (at least 25)`, () => {
    assert.ok(SECRET_KEYS.length >= 25)
    assert.equal(new Set(SECRET_KEYS).size, SECRET_KEYS.length)
  })

  for (const key of SECRET_KEYS) {
    it(`"${key}" is redacted at the top level, nested, in an array and deep — whatever its value`, () => {
      for (const value of SECRET_VALUES) {
        const { line, at } = placed(key, value)
        assert.deepEqual(at, [REDACTED, REDACTED, REDACTED, REDACTED], `${key} = ${JSON.stringify(value)}`)
        const text = JSON.stringify(line)
        for (const leak of ['sk-live-Zq81', '482913', 'sk-obj', 'sk-arr']) assert.ok(!text.includes(leak), `${leak} reached the log under "${key}"`)
      }
    })
  }

  it('a count under a credential is hidden with it', () => {
    const line = record({ apiKey: { totalTokens: 5 }, authorization: [{ promptTokens: 3 }], token: { completionTokens: 1 } })
    assert.deepEqual([line.apiKey, line.authorization, line.token], [REDACTED, REDACTED, REDACTED])
  })
})

describe('logger redaction: the AI token counts are written', () => {
  for (const key of COUNT_KEYS) {
    it(`"${key}" with a number is written as the number, wherever it sits`, () => {
      for (const value of [0, 1, 120, 1_000_000, 2.5]) {
        assert.deepEqual(placed(key, value).at, [value, value, value, value], `${key} = ${value}`)
      }
    })

    it(`"${key}" with anything but a number is still redacted (a count is never text)`, () => {
      for (const value of ['sk-live-Zq81', '120', '', { n: 1 }, [1], true, null, undefined]) {
        assert.deepEqual(placed(key, value).at, [REDACTED, REDACTED, REDACTED, REDACTED], `${key} = ${JSON.stringify(value)}`)
      }
    })
  }

  it('the rest of the record is untouched', () => {
    const line = record({ serviceKey: 'chatbot', provider: 'delify', model: 'm', costVnd: 12, executionMs: 30, promptTokens: 7 })
    assert.deepEqual(line, { level: 'info', time: AT.toISOString(), event: 'x', serviceKey: 'chatbot', provider: 'delify', model: 'm', costVnd: 12, executionMs: 30, promptTokens: 7 })
  })
})

describe('ai_gateway.call_succeeded through the real logger', () => {
  it('the line written to stdout carries the three counts as numbers, and no key', async () => {
    const usage: unknown[] = []
    mock.module('../server/utils/ai-usage', { namedExports: { logAiUsage: async (_db: unknown, row: unknown) => { usage.push(row) } } })
    const config = await import('../server/services/ai-gateway-config')
    mock.module('../server/services/ai-gateway-config', {
      namedExports: { ...config, loadPricing: async () => ({ model: 'gpt-x', promptCostPerMillion: '3', completionCostPerMillion: '15' }) },
    })
    const { recordAiCall } = await import('../server/services/ai-gateway-record')
    const lines: string[] = []
    const out = mock.method(console, 'log', (line: string) => { lines.push(line) })
    const before = process.env.LOG_LEVEL
    process.env.LOG_LEVEL = 'info'
    try {
      const call = { provider: 'openai', model: 'gpt-x', policy: 'openai', providerCall: { url: 'https://api.example/v1/chat/completions', headers: { authorization: 'Bearer sk-live-KEY-9f2' }, body: {} } }
      const answer = { ok: true as const, answerText: 'Xin chào', promptTokens: 120, completionTokens: 40, totalTokens: 160 }
      await recordAiCall({} as never, 'chatbot', call as never, answer, 25, 7)
    } finally {
      out.mock.restore()
      if (before === undefined) delete process.env.LOG_LEVEL
      else process.env.LOG_LEVEL = before
    }
    const succeeded = lines.map(line => JSON.parse(line) as Record<string, unknown>).filter(line => line.event === 'ai_gateway.call_succeeded')
    assert.equal(succeeded.length, 1, lines.join('\n'))
    assert.deepEqual([succeeded[0]!.promptTokens, succeeded[0]!.completionTokens, succeeded[0]!.totalTokens], [120, 40, 160])
    assert.ok(!lines.join('\n').includes('sk-live-KEY-9f2'))
    assert.ok(!lines.join('\n').includes(REDACTED), lines.join('\n'))
    assert.equal(usage.length, 1)
  })
})
