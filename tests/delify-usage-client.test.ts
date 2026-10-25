import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'
import type { RequestOptions } from 'node:https'
import { Readable } from 'node:stream'
import test from 'node:test'
import type { ProviderRequest, ResolveProviderHost } from '../server/utils/chatbot/outbound'
import { DelifyUsageError, fetchDelifyUsage } from '../server/utils/ai/delify-usage'

/**
 * `fetchDelifyUsage` — the one way to Delify Router's usage API
 * (`/api/usage/key`, `/api/usage/key/receipts`). Everything below `https.request` is
 * real: the provider URL policy, DNS → public-IP check, the pinned lookup, https/443,
 * no redirects, the deadline and the byte cap of `safeProviderRequest`. Only the
 * socket and the resolver are fake (the seams `callAi` uses too).
 *
 * The key travels as the `key` query value: that is the only form Delify's usage API
 * documents (its own usage page calls `/api/usage/key?key=…`); a header is unverified.
 * So the key must never be in a log line or an error, and the host it goes to must be
 * the one the key was entered for (`ai_providers.base_url`), checked like any provider.
 */

const SECRET = 'sk-usage-secret-9876'
const PUBLIC_DNS: ResolveProviderHost = async () => [{ address: '93.184.216.34', family: 4 }]

type Reply = { status: number, body?: string, headers?: Record<string, string> }
function transport(replies: Reply[]) {
  const sent: RequestOptions[] = []
  const resolved: string[] = []
  const resolveHost: ResolveProviderHost = async (host) => { resolved.push(host); return PUBLIC_DNS(host) }
  const request: ProviderRequest = (options, onResponse) => {
    const req = Object.assign(new EventEmitter(), {
      write: () => {},
      destroy: () => {},
      end: () => {
        sent.push(options)
        const reply = replies.shift() ?? { status: 500 }
        const incoming = Object.assign(Readable.from(reply.body === undefined ? [] : [Buffer.from(reply.body)]), {
          statusCode: reply.status, headers: reply.headers ?? { 'content-type': 'application/json' },
        }) as unknown as IncomingMessage
        queueMicrotask(() => onResponse(incoming))
      },
    })
    return req as never
  }
  return { sent, resolved, resolveHost, request }
}

/** Runs `fn` with console output captured, so a test can show the key never reached a log line. */
async function captured<T>(fn: () => Promise<T>): Promise<{ value?: T, error?: unknown, output: string }> {
  const lines: string[] = []
  const original = { log: console.log, error: console.error }
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')) }
  console.error = (...args: unknown[]) => { lines.push(args.join(' ')) }
  try {
    return { value: await fn(), output: lines.join('\n') }
  } catch (error) {
    return { error, output: lines.join('\n') }
  } finally {
    Object.assign(console, original)
  }
}

test('a refused base URL never reaches DNS or a socket: loopback, private, IP literals, internal names, http, odd ports', async () => {
  for (const baseUrl of [
    'https://127.0.0.1/v1', 'https://10.1.2.3/v1', 'https://169.254.169.254/latest', 'https://[::1]/v1', 'https://[fd00::1]/v1',
    'https://2130706433/v1', 'https://0x7f.1/v1', 'https://localhost/v1', 'https://router.local/v1', 'https://metadata.google.internal/v1',
    'https://router/v1', 'http://router.delify.vn/v1', 'https://router.delify.vn:8443/v1', 'https://user:pass@router.delify.vn/v1',
    'https://router.delify.vn/v1?x=1', null, '',
  ]) {
    const net = transport([{ status: 200, body: '{}' }])
    const { error } = await captured(() => fetchDelifyUsage({ baseUrl, secret: SECRET, path: '/api/usage/key', resolveHost: net.resolveHost, request: net.request }))
    assert.ok(error instanceof DelifyUsageError, `${baseUrl}: ${String(error)}`)
    assert.equal(error.reason, 'provider_url_rejected', String(baseUrl))
    assert.match(error.message, /Địa chỉ nhà cung cấp/)
    assert.deepEqual(net.resolved, [], `${baseUrl}: resolved`)
    assert.deepEqual(net.sent, [], `${baseUrl}: connected`)
  }
})

test('a public name that resolves to a private or loopback address is refused before any connection', async () => {
  for (const address of ['127.0.0.1', '10.0.0.8', '192.168.1.1', '169.254.169.254', '::1', 'fd00::5', '::ffff:10.0.0.1']) {
    const net = transport([{ status: 200, body: '{}' }])
    const resolveHost: ResolveProviderHost = async () => [{ address, family: address.includes(':') ? 6 : 4 }]
    const { error, output } = await captured(() => fetchDelifyUsage({ baseUrl: 'https://router.delify.vn/v1', secret: SECRET, path: '/api/usage/key', resolveHost, request: net.request }))
    assert.ok(error instanceof DelifyUsageError, address)
    assert.equal(error.reason, 'unreachable')
    assert.deepEqual(net.sent, [], `${address}: connected`)
    assert.match(output, /"code":"DESTINATION_UNSAFE"/)
    assert.ok(!output.includes(SECRET), 'the key is not in the log line')
  }
})

test('the request: the base URL\'s host, pinned to the checked IP, https/443, the key only as the `key` query value', async () => {
  const net = transport([{ status: 200, body: JSON.stringify({ budgetUsd: 3, active: true }) }])
  const result = await fetchDelifyUsage({
    baseUrl: 'https://Router.Delify.vn/v1/', secret: SECRET, path: '/api/usage/key/receipts',
    params: { period: '7d', page: '1', pageSize: '20' }, resolveHost: net.resolveHost, request: net.request,
  })
  assert.deepEqual(result, { status: 200, data: { budgetUsd: 3, active: true } })
  assert.deepEqual(net.resolved, ['router.delify.vn'])
  const [options] = net.sent
  assert.equal(net.sent.length, 1)
  assert.equal(options!.hostname, 'router.delify.vn')
  assert.equal(options!.servername, 'router.delify.vn')
  assert.equal(options!.port, 443)
  assert.equal(options!.protocol, 'https:')
  assert.equal(options!.method, 'GET')
  assert.equal(options!.agent, false)
  assert.equal(options!.path, `/api/usage/key/receipts?period=7d&page=1&pageSize=20&key=${SECRET}`)
  assert.ok(!JSON.stringify(options!.headers ?? {}).includes(SECRET), 'not in a header')
  // The connection goes to the address that was checked, whatever the system resolver says now.
  const pinned = await new Promise<unknown[]>(resolve => (options!.lookup as (h: string, o: object, cb: (...a: unknown[]) => void) => void)('router.delify.vn', {}, (...args) => resolve(args)))
  assert.deepEqual(pinned, [null, '93.184.216.34', 4])
})

test('a caller parameter cannot replace the key, and values are encoded', async () => {
  const net = transport([{ status: 200, body: '{}' }])
  await fetchDelifyUsage({ baseUrl: 'https://router.delify.vn/v1', secret: 'sk a&b', path: '/api/usage/key', params: { key: 'other', period: 'a b&c' }, resolveHost: net.resolveHost, request: net.request })
  assert.equal(net.sent[0]!.path, '/api/usage/key?key=sk+a%26b&period=a+b%26c')
})

test('a redirect is not followed, an oversize or non-JSON answer is refused — and the key is in no error or log line', async () => {
  const cases: Array<[string, Reply, DelifyUsageError['reason']]> = [
    ['redirect', { status: 302, headers: { location: 'https://127.0.0.1/' } }, 'unreachable'],
    ['oversize', { status: 200, body: 'x'.repeat(2 * 1024 * 1024) }, 'unreachable'],
    ['declared oversize', { status: 200, body: '{}', headers: { 'content-length': String(64 * 1024 * 1024) } }, 'unreachable'],
    ['not JSON', { status: 200, body: '<html>maintenance</html>' }, 'bad_response'],
  ]
  for (const [what, reply, reason] of cases) {
    const net = transport([reply])
    const { error, output } = await captured(() => fetchDelifyUsage({ baseUrl: 'https://router.delify.vn/v1', secret: SECRET, path: '/api/usage/key', resolveHost: net.resolveHost, request: net.request }))
    assert.ok(error instanceof DelifyUsageError, what)
    assert.equal(error.reason, reason, what)
    assert.equal(net.sent.length, 1, `${what}: exactly one request`)
    assert.ok(!error.message.includes(SECRET) && !String(error.stack).includes(SECRET), `${what}: key in the error`)
    assert.ok(!output.includes(SECRET), `${what}: key in a log line`)
    assert.ok(!output.includes('?key='), `${what}: query string in a log line`)
  }
})

test('a non-2xx answer is its status with no data — the body is not parsed', async () => {
  const net = transport([{ status: 404, body: '{"error":"Not Found"}' }])
  assert.deepEqual(await fetchDelifyUsage({ baseUrl: 'https://router.delify.vn/v1', secret: SECRET, path: '/api/usage/key', resolveHost: net.resolveHost, request: net.request }), { status: 404, data: null })
})
