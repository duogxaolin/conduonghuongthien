import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'
import test, { mock } from 'node:test'
import type { ProviderRequest, ResolveProviderHost } from '../server/utils/chatbot/outbound'

/**
 * Kiểm lúc GỌI: `callAi` gửi `Authorization: Bearer <khoá API>` tới `ai_providers.base_url`.
 * Một hàng lưu trước khi có kiểm lúc ghi — hay một hàng bị sửa thẳng trong DB —
 * không được làm lộ khoá. Socket và DNS là giả (`input.transport`), nên test chứng
 * minh được điều quan trọng: với địa chỉ xấu thì KHÔNG có lệnh mạng nào, kể cả
 * tra DNS, ở cả ba đường (stream, vòng công cụ, không stream).
 *
 * `loadProvider` đệm theo TÊN nhà cung cấp 60 s, nên mỗi lần gọi ở đây dùng một
 * tên riêng — nếu không, hàng tốt của lần trước sẽ được dùng lại và test nói dối.
 */

mock.module('../server/utils/ai-budget', { namedExports: { checkBudget: async () => ({ allowed: true }) } })
mock.module('../server/utils/ai-usage', { namedExports: { logAiUsage: async () => {} } })
mock.module('../server/utils/ai/crypto', { namedExports: { decryptAiSecret: () => 'sk-live-secret' } })

const { callAi } = await import('../server/services/ai-gateway')
const { aiServiceConfigs, aiProviders } = await import('../server/db/schema')

let serial = 0
function fakeDb(baseUrl: string) {
  const id = ++serial
  const provider = `prov-${id}`
  const serviceKey = `svc-url-${id}`
  const rowsFor = (table: unknown): unknown[] => {
    if (table === aiServiceConfigs) return [{ serviceKey, provider, model: 'm', isActive: true, systemPrompt: '', maxTokens: 256 }]
    if (table === aiProviders) return [{ provider, baseUrl, apiKeyCiphertext: 'c', apiKeyNonce: 'n', apiKeyAuthTag: 't', apiKeyVersion: 1, apiKeyKeyId: 'k', apiKeyLastFour: 'cret' }]
    return []
  }
  const db = {
    select: () => ({
      from: (table: unknown) => {
        const chain: { where: () => typeof chain, limit: () => Promise<unknown[]> } = { where: () => chain, limit: () => Promise.resolve(rowsFor(table)) }
        return chain
      },
    }),
  }
  return { db: db as never, serviceKey }
}

function recordingTransport(dns: ResolveProviderHost, reply: () => { status: number, headers?: Record<string, string>, body: string }) {
  const seen = { requests: 0, lookups: 0, authorization: [] as string[] }
  const request: ProviderRequest = (options, onResponse) => {
    seen.requests += 1
    seen.authorization.push(String((options.headers as Record<string, string> | undefined)?.Authorization ?? (options.headers as Record<string, string> | undefined)?.authorization ?? ''))
    const req = Object.assign(new EventEmitter(), {
      write: () => {},
      destroy: () => {},
      end: () => {
        const { status, headers, body } = reply()
        const incoming = Object.assign(Readable.from([Buffer.from(body)]), { statusCode: status, headers: headers ?? {} })
        queueMicrotask(() => onResponse(incoming as unknown as IncomingMessage))
      },
    })
    return req as never
  }
  const resolveHost: ResolveProviderHost = async (host) => { seen.lookups += 1; return dns(host) }
  return { seen, transport: { request, resolveHost } }
}

const PUBLIC: ResolveProviderHost = async () => [{ address: '93.184.216.34', family: 4 }]
const SSE_OK = () => ({ status: 200, body: 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n' })
const JSON_OK = () => ({ status: 200, body: JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) })
const tool = { name: 't', description: 'd', parameters: { type: 'object', properties: {} }, execute: async () => [] }

type Mode = 'stream' | 'tools-stream' | 'tools-buffered' | 'buffered'
const MODES: Mode[] = ['stream', 'tools-stream', 'tools-buffered', 'buffered']

async function call(baseUrl: string, mode: Mode, dns: ResolveProviderHost = PUBLIC) {
  const { db, serviceKey } = fakeDb(baseUrl)
  const { seen, transport } = recordingTransport(dns, mode === 'stream' || mode === 'tools-stream' ? SSE_OK : JSON_OK)
  const result = await callAi(serviceKey, {
    prompt: 'xin chào',
    db,
    transport,
    ...(mode === 'stream' || mode === 'tools-stream' ? { onChunk: () => {} } : {}),
    ...(mode === 'tools-stream' || mode === 'tools-buffered' ? { tools: [tool] } : {}),
  })
  return { result, seen }
}

const BAD_URLS = [
  'http://api.provider.example/v1',
  'https://user:pw@api.provider.example/v1',
  'https://api.provider.example:8443/v1',
  'https://127.0.0.1/v1',
  'https://10.0.0.8/v1',
  'https://169.254.169.254/latest',
  'https://[::1]/v1',
  'https://2130706433/v1',
  'https://0x7f.0.0.1/v1',
  'https://localhost/v1',
  'https://LOCALHOST./v1',
  'https://metadata.google.internal/v1',
  'https://printer.local/v1',
  'https://mysql/v1',
  'https://api.provider.example/v1?x=1',
]

test('a stored base URL outside the policy makes no network call on any path — not even DNS', async () => {
  for (const url of BAD_URLS) {
    for (const mode of MODES) {
      const { result, seen } = await call(url, mode)
      assert.equal(result.ok, false, `${mode} ${url}`)
      assert.equal(result.error, 'provider_url_rejected', `${mode} ${url}`)
      assert.ok(result.errorMessage && /Địa chỉ nhà cung cấp/.test(result.errorMessage), `${mode} ${url}: Vietnamese reason`)
      assert.equal(seen.requests, 0, `${mode} ${url}: a connection was opened`)
      assert.equal(seen.lookups, 0, `${mode} ${url}: DNS was queried`)
    }
  }
})

test('a public-looking name that resolves to a private address never receives the key', async () => {
  for (const address of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '192.168.1.10']) {
    for (const mode of MODES) {
      const { result, seen } = await call('https://api.provider.example/v1', mode, async () => [{ address, family: 4 }])
      assert.equal(result.ok, false, `${mode} → ${address}`)
      assert.equal(result.error, 'provider_error', `${mode} → ${address}`)
      assert.equal(seen.lookups, 1, `${mode} → ${address}: DNS checked once`)
      assert.equal(seen.requests, 0, `${mode} → ${address}: the key went out`)
    }
  }
})

test('a valid provider still answers on every path, with the key sent only to it', async () => {
  for (const mode of MODES) {
    const { result, seen } = await call('https://API.Provider.Example/v1/', mode)
    assert.equal(result.ok, true, mode)
    assert.ok(seen.requests >= 1, mode)
    assert.ok(seen.authorization.every(value => value === 'Bearer sk-live-secret'), mode)
  }
})

test('a redirect from the provider is refused, never followed with the key', async () => {
  for (const mode of MODES) {
    const { db, serviceKey } = fakeDb('https://api.provider.example/v1')
    const { seen, transport } = recordingTransport(PUBLIC, () => ({ status: 302, headers: { location: 'http://169.254.169.254/' }, body: '' }))
    const result = await callAi(serviceKey, {
      prompt: 'x', db, transport,
      ...(mode === 'stream' || mode === 'tools-stream' ? { onChunk: () => {} } : {}),
      ...(mode === 'tools-stream' || mode === 'tools-buffered' ? { tools: [tool] } : {}),
    })
    assert.equal(result.ok, false, mode)
    assert.equal(seen.requests, 1, `${mode}: exactly one request, the redirect is not followed`)
  }
})
