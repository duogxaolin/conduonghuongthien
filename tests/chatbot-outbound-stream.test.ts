import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'
import type { RequestOptions } from 'node:https'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import {
  ChatbotOutboundError,
  safeProviderStream,
  type ProviderRequest,
  type ResolveProviderHost,
} from '../server/utils/chatbot/outbound.ts'

/**
 * `safeProviderStream` — đường SSE của `callAi`. Trước đây các lệnh gọi stream và
 * vòng gọi công cụ dùng `fetch` trần: không đòi https, không chặn IP nội bộ, không
 * hạn giờ, không trần dung lượng — trong khi mỗi lệnh mang `Authorization: Bearer
 * <khoá API>`. Các test dưới đây chạy hàm thật với `https.request` giả.
 */

const ALLOWED = ['api.provider.example']
const PUBLIC_DNS: ResolveProviderHost = async () => [{ address: '8.8.8.8', family: 4 }]
const assertCode = (code: string) => (error: unknown) => error instanceof ChatbotOutboundError && error.code === code

interface StreamBehavior {
  status?: number
  headers?: Record<string, string>
  /** Chunks pushed one per tick; `null` = never end (hangs). */
  chunks?: string[] | null
  timeout?: boolean
  onOptions?: (options: RequestOptions) => void
  onDestroy?: () => void
}

function streamRequest(behavior: StreamBehavior, calls = { count: 0 }): ProviderRequest {
  return ((options: RequestOptions, onResponse: (response: IncomingMessage) => void) => {
    calls.count += 1
    behavior.onOptions?.(options)
    const req = Object.assign(new EventEmitter(), {
      write: () => {},
      destroy: () => { behavior.onDestroy?.() },
      end: () => {
        queueMicrotask(() => {
          if (behavior.timeout) { req.emit('timeout'); return }
          const source = behavior.chunks === null
            ? new Readable({ read() {} })
            : Readable.from((behavior.chunks ?? []).map(chunk => Buffer.from(chunk)))
          const response = Object.assign(source, { statusCode: behavior.status ?? 200, headers: behavior.headers ?? {} })
          const destroy = response.destroy.bind(response)
          response.destroy = ((error?: Error) => { behavior.onDestroy?.(); return destroy(error) }) as typeof response.destroy
          onResponse(response as unknown as IncomingMessage)
        })
      },
    })
    return req
  }) as unknown as ProviderRequest
}

async function readAll(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) return text + decoder.decode()
    text += decoder.decode(value, { stream: true })
  }
}

test('streams a 2xx body chunk by chunk over a connection pinned to the checked address', async () => {
  let options: RequestOptions | undefined
  const response = await safeProviderStream({
    url: 'https://api.provider.example/v1/chat/completions', allowedHosts: ALLOWED, method: 'POST', body: '{}',
    resolveHost: PUBLIC_DNS, request: streamRequest({ chunks: ['data: a\n', 'data: b\n'], onOptions: (o) => { options = o } }),
  })
  assert.equal(response.status, 200)
  assert.ok(response.body)
  assert.equal(await readAll(response.body), 'data: a\ndata: b\n')
  assert.equal(options?.servername, 'api.provider.example')
  assert.equal(options?.port, 443)
  assert.equal(options?.agent, false)
  const pinned = await new Promise<unknown[]>((resolve) => {
    ;(options?.lookup as unknown as (h: string, o: object, cb: (...args: unknown[]) => void) => void)('api.provider.example', { all: true }, (...args) => resolve(args))
  })
  assert.deepEqual(pinned, [null, [{ address: '8.8.8.8', family: 4 }]])
})

test('a URL outside the policy never resolves DNS nor opens a connection', async () => {
  for (const url of [
    'http://api.provider.example/v1',
    'https://api.provider.example:8443/v1',
    'https://user:pw@api.provider.example/v1',
    'https://127.0.0.1/v1',
    'https://localhost/v1',
    'https://other.example/v1',
  ]) {
    const calls = { count: 0 }
    let resolved = 0
    await assert.rejects(safeProviderStream({
      // `localhost` is listed on purpose: the shared hostname policy still refuses it.
      url, allowedHosts: [...ALLOWED, 'localhost'],
      resolveHost: async () => { resolved += 1; return [{ address: '8.8.8.8', family: 4 }] },
      request: streamRequest({ chunks: ['x'] }, calls),
    }), (error: unknown) => error instanceof ChatbotOutboundError, url)
    assert.equal(calls.count, 0, `${url}: no connection`)
    assert.equal(resolved, 0, `${url}: no DNS lookup`)
  }
})

test('a host resolving to a private address is refused before connecting', async () => {
  const calls = { count: 0 }
  await assert.rejects(safeProviderStream({
    url: 'https://api.provider.example/v1', allowedHosts: ALLOWED,
    resolveHost: async () => [{ address: '169.254.169.254', family: 4 }],
    request: streamRequest({ chunks: ['x'] }, calls),
  }), assertCode('DESTINATION_UNSAFE'))
  assert.equal(calls.count, 0)
})

test('redirects are rejected, not followed', async () => {
  const calls = { count: 0 }
  await assert.rejects(safeProviderStream({
    url: 'https://api.provider.example/v1', allowedHosts: ALLOWED, resolveHost: PUBLIC_DNS,
    request: streamRequest({ status: 307, headers: { location: 'http://169.254.169.254/' } }, calls),
  }), assertCode('UPSTREAM_REDIRECT'))
  assert.equal(calls.count, 1)
})

test('a non-2xx answer returns the status with no body, and the body is discarded', async () => {
  let destroyed = 0
  const response = await safeProviderStream({
    url: 'https://api.provider.example/v1', allowedHosts: ALLOWED, resolveHost: PUBLIC_DNS,
    request: streamRequest({ status: 502, chunks: ['provider internals'], onDestroy: () => { destroyed += 1 } }),
  })
  assert.equal(response.status, 502)
  assert.equal(response.body, null)
  assert.ok(destroyed > 0)
})

test('the byte cap applies to the declared length and to the streamed total', async () => {
  await assert.rejects(safeProviderStream({
    url: 'https://api.provider.example/v1', allowedHosts: ALLOWED, resolveHost: PUBLIC_DNS, maxResponseBytes: 8,
    request: streamRequest({ headers: { 'content-length': '999' }, chunks: [] }),
  }), assertCode('UPSTREAM_TOO_LARGE'))

  const response = await safeProviderStream({
    url: 'https://api.provider.example/v1', allowedHosts: ALLOWED, resolveHost: PUBLIC_DNS, maxResponseBytes: 8,
    request: streamRequest({ chunks: ['12345', '67890', 'never read'] }),
  })
  assert.ok(response.body)
  await assert.rejects(readAll(response.body), assertCode('UPSTREAM_TOO_LARGE'))
})

test('a silent socket and an over-long stream both time out', async () => {
  await assert.rejects(safeProviderStream({
    url: 'https://api.provider.example/v1', allowedHosts: ALLOWED, resolveHost: PUBLIC_DNS,
    request: streamRequest({ timeout: true }),
  }), assertCode('UPSTREAM_TIMEOUT'))

  // Headers arrive, then the body never ends: the overall deadline errors the stream.
  const response = await safeProviderStream({
    url: 'https://api.provider.example/v1', allowedHosts: ALLOWED, resolveHost: PUBLIC_DNS, timeoutMs: 20,
    request: streamRequest({ chunks: null }),
  })
  assert.ok(response.body)
  await assert.rejects(readAll(response.body), assertCode('UPSTREAM_TIMEOUT'))
})

test('cancelling the body tears the connection down', async () => {
  let destroyed = 0
  const response = await safeProviderStream({
    url: 'https://api.provider.example/v1', allowedHosts: ALLOWED, resolveHost: PUBLIC_DNS,
    request: streamRequest({ chunks: null, onDestroy: () => { destroyed += 1 } }),
  })
  assert.ok(response.body)
  await response.body.cancel()
  assert.ok(destroyed > 0)
})
