import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import type { IncomingMessage } from 'node:http'
import type { RequestOptions } from 'node:https'
import {
  ChatbotOutboundError,
  isPublicIpAddress,
  normalizeProviderUrl,
  redactOutboundError,
  resolvePublicProviderAddresses,
  safeProviderRequest,
  type ProviderRequest,
} from '../server/utils/chatbot/outbound.ts'

const ALLOWED_HOSTS = ['api.provider.example']
const PUBLIC_DNS = async () => [{ address: '8.8.8.8', family: 4 as const }]

function assertCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof ChatbotOutboundError && error.code === code
}

test('normalizes approved HTTPS base URLs and paths', () => {
  assert.equal(
    normalizeProviderUrl('https://API.Provider.Example:443/v1///', { allowedHosts: ALLOWED_HOSTS }).href,
    'https://api.provider.example/v1',
  )
  assert.equal(
    normalizeProviderUrl('https://api.provider.example/', { allowedHosts: ['API.PROVIDER.EXAMPLE.'] }).href,
    'https://api.provider.example/',
  )
})

test('rejects unsafe schemes, credentials, ports, fragments, queries, IP literals, and host suffix tricks', () => {
  const rejected = [
    'http://api.provider.example/v1',
    'https://user:secret@api.provider.example/v1',
    'https://api.provider.example:8443/v1',
    'https://api.provider.example/v1#internal',
    'https://api.provider.example/v1?target=secret',
    'https://127.0.0.1/v1',
    'https://api.provider.example.attacker.test/v1',
    'https://attacker.test/v1',
  ]
  for (const url of rejected) {
    assert.throws(() => normalizeProviderUrl(url, { allowedHosts: ALLOWED_HOSTS }))
  }
})

test('classifies only globally routable IPv4 addresses as public', () => {
  for (const address of [
    '0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.169.254',
    '172.16.0.1', '192.0.0.1', '192.0.2.1', '192.168.1.1', '198.18.0.1',
    '198.51.100.1', '203.0.113.1', '224.0.0.1', '240.0.0.1', '255.255.255.255',
  ]) assert.equal(isPublicIpAddress(address), false, address)

  for (const address of ['1.1.1.1', '8.8.8.8', '93.184.216.34']) {
    assert.equal(isPublicIpAddress(address), true, address)
  }
})

test('rejects private, special, mapped, and reserved IPv6 forms', () => {
  for (const address of [
    '::', '::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:192.0.2.1',
    '64:ff9b:1::1', '100::1', '2001::1', '2001:db8::1', '2002::1',
    'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1',
  ]) assert.equal(isPublicIpAddress(address), false, address)

  for (const address of ['::ffff:8.8.8.8', '2606:4700:4700::1111', '2001:4860:4860::8888']) {
    assert.equal(isPublicIpAddress(address), true, address)
  }
})

test('rejects every answer when DNS returns any unsafe target and resolves afresh per request', async () => {
  await assert.rejects(
    resolvePublicProviderAddresses('api.provider.example', async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]),
    assertCode('DESTINATION_UNSAFE'),
  )

  let calls = 0
  const rebindingResolver = async () => {
    calls += 1
    return calls === 1
      ? [{ address: '8.8.8.8', family: 4 as const }]
      : [{ address: '10.0.0.1', family: 4 as const }]
  }
  await safeProviderRequest({
    url: 'https://api.provider.example/v1', allowedHosts: ALLOWED_HOSTS,
    resolveHost: rebindingResolver, request: fakeRequest({ status: 200, chunks: ['ok'] }),
  })
  await assert.rejects(safeProviderRequest({
    url: 'https://api.provider.example/v1', allowedHosts: ALLOWED_HOSTS,
    resolveHost: rebindingResolver, request: fakeRequest({ status: 200, chunks: ['must not run'] }),
  }), assertCode('DESTINATION_UNSAFE'))
  assert.equal(calls, 2)
})

test('pins the connection lookup to validated DNS answers', async () => {
  let requestOptions: RequestOptions | undefined
  const response = await safeProviderRequest({
    url: 'https://api.provider.example/v1', allowedHosts: ALLOWED_HOSTS,
    resolveHost: async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ],
    request: fakeRequest({ status: 200, chunks: ['ok'], onOptions: options => { requestOptions = options } }),
  })
  assert.equal(Buffer.from(response.body).toString(), 'ok')
  assert.equal(requestOptions?.servername, 'api.provider.example')
  assert.equal(requestOptions?.agent, false)

  const lookup = requestOptions?.lookup
  assert.ok(lookup)
  const result = await new Promise<unknown[]>((resolve) => {
    ;(lookup as Function)('api.provider.example', { all: true }, (...args: unknown[]) => resolve(args))
  })
  assert.deepEqual(result, [null, [
    { address: '8.8.8.8', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ]])
})

test('rejects redirects without following their location', async () => {
  let requests = 0
  await assert.rejects(safeProviderRequest({
    url: 'https://api.provider.example/v1', allowedHosts: ALLOWED_HOSTS, resolveHost: PUBLIC_DNS,
    request: fakeRequest({
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data/private' },
      onOptions: () => { requests += 1 },
    }),
  }), assertCode('UPSTREAM_REDIRECT'))
  assert.equal(requests, 1)
})

test('enforces timeout and declared/streamed response size caps', async () => {
  await assert.rejects(safeProviderRequest({
    url: 'https://api.provider.example/v1', allowedHosts: ALLOWED_HOSTS, resolveHost: PUBLIC_DNS,
    timeoutMs: 5, request: fakeRequest({ timeout: true }),
  }), assertCode('UPSTREAM_TIMEOUT'))

  await assert.rejects(safeProviderRequest({
    url: 'https://api.provider.example/v1', allowedHosts: ALLOWED_HOSTS, resolveHost: PUBLIC_DNS,
    maxResponseBytes: 3, request: fakeRequest({ status: 200, headers: { 'content-length': '999' } }),
  }), assertCode('UPSTREAM_TOO_LARGE'))

  await assert.rejects(safeProviderRequest({
    url: 'https://api.provider.example/v1', allowedHosts: ALLOWED_HOSTS, resolveHost: PUBLIC_DNS,
    maxResponseBytes: 3, request: fakeRequest({ status: 200, chunks: ['ab', 'cd'] }),
  }), assertCode('UPSTREAM_TOO_LARGE'))
})

test('redacts upstream URLs, keys, raw bodies, and native errors', async () => {
  const marker = 'SUPER-SECRET-KEY'
  let caught: unknown
  try {
    await safeProviderRequest({
      url: 'https://api.provider.example/private/provider-path', allowedHosts: ALLOWED_HOSTS,
      headers: { authorization: `Bearer ${marker}` }, resolveHost: PUBLIC_DNS,
      request: fakeRequest({ requestError: new Error(`socket failed at private/provider-path: ${marker}`) }),
    })
  } catch (error) {
    caught = error
  }
  assert.ok(caught instanceof ChatbotOutboundError)
  assert.equal(caught.code, 'UPSTREAM_FAILURE')
  assert.deepEqual(JSON.parse(JSON.stringify(caught)), { name: 'ChatbotOutboundError', code: 'UPSTREAM_FAILURE' })
  assert.ok(!String(caught).includes(marker))
  assert.ok(!String(caught).includes('provider-path'))

  const redacted = redactOutboundError(new Error(`raw upstream body ${marker}`))
  assert.equal(redacted.code, 'UPSTREAM_FAILURE')
  assert.ok(!redacted.message.includes(marker))
})

interface FakeRequestBehavior {
  status?: number
  headers?: Record<string, string>
  chunks?: string[]
  timeout?: boolean
  requestError?: Error
  onOptions?: (options: RequestOptions) => void
}

function fakeRequest(behavior: FakeRequestBehavior): ProviderRequest {
  return ((options: RequestOptions, onResponse: (response: IncomingMessage) => void) => {
    behavior.onOptions?.(options)
    const request = new EventEmitter() as EventEmitter & {
      write: (chunk: unknown) => void
      end: () => void
      destroy: () => void
    }
    request.write = () => {}
    request.destroy = () => {}
    request.end = () => {
      queueMicrotask(() => {
        if (behavior.timeout) {
          request.emit('timeout')
          return
        }
        if (behavior.requestError) {
          request.emit('error', behavior.requestError)
          return
        }
        const response = new EventEmitter() as EventEmitter & {
          statusCode: number
          headers: Record<string, string>
          resume: () => void
          destroy: () => void
        }
        response.statusCode = behavior.status ?? 200
        response.headers = behavior.headers ?? {}
        response.resume = () => {}
        response.destroy = () => {}
        onResponse(response as unknown as IncomingMessage)
        for (const chunk of behavior.chunks ?? []) response.emit('data', Buffer.from(chunk))
        response.emit('end')
      })
    }
    return request
  }) as unknown as ProviderRequest
}
