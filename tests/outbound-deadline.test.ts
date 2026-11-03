import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { RequestOptions } from 'node:https'
import test from 'node:test'
import {
  ChatbotOutboundError,
  safeProviderRequest,
  safeProviderStream,
  type ProviderRequest,
  type ResolveProviderHost,
} from '../server/utils/chatbot/outbound.ts'

/**
 * `timeoutMs` of `safeProviderRequest`/`safeProviderStream` is the WHOLE call's
 * deadline, DNS included.
 *
 * Found in the Wave 3 verify: the resolver ran before the timer started, so the
 * budget check's `timeoutMs: 2500` took 6.5 s against a slow resolver — and that check
 * runs before every AI call, public chatbot turns included. Every caller of
 * outbound.ts (gateway, provider/chatbot tests, test-call, thumbnail export, Delify
 * usage) gets the same deadline now. The resolver and the socket are fakes; the
 * clock is real (the deadlines are short).
 */

const ALLOWED = ['api.provider.example']
const URL_OK = 'https://api.provider.example/v1/models'
const isCode = (code: string) => (error: unknown) => error instanceof ChatbotOutboundError && error.code === code

/** A resolver that answers a public address after `ms`. */
const slowDns = (ms: number): ResolveProviderHost => () =>
  new Promise(resolve => setTimeout(() => resolve([{ address: '93.184.216.34', family: 4 }]), ms))

/** A socket that connects and never answers; records what it was asked. */
function silentServer() {
  const sent: RequestOptions[] = []
  const request: ProviderRequest = (options) => {
    sent.push(options)
    return Object.assign(new EventEmitter(), { write() {}, end() {}, destroy() {} }) as never
  }
  return { sent, request }
}

async function timed(run: () => Promise<unknown>): Promise<{ ms: number, error: unknown }> {
  const started = performance.now()
  try {
    await run()
    return { ms: performance.now() - started, error: null }
  } catch (error) {
    return { ms: performance.now() - started, error }
  }
}

// Margins are wide on purpose (CI is slower, and `npm test` runs files in parallel):
// each bound sits far from both the fixed time and the old one.

test('a resolver slower than the deadline: the call fails at the deadline, and no connection is opened (RED before: DNS ran outside it)', async () => {
  const server = silentServer()
  const { ms, error } = await timed(() => safeProviderRequest({
    url: URL_OK, allowedHosts: ALLOWED, timeoutMs: 400, resolveHost: slowDns(1200), request: server.request,
  }))
  assert.ok(isCode('UPSTREAM_TIMEOUT')(error), String(error))
  // Fixed: ~400 ms. Old: 1200 ms of DNS + 400 ms.
  assert.ok(ms < 900, `took ${Math.round(ms)} ms against a 400 ms deadline`)
  await new Promise(resolve => setTimeout(resolve, 1000))
  assert.deepEqual(server.sent, [], 'the late DNS answer did not start a request')
})

test('DNS time counts against the deadline: what is left goes to the socket (RED before: a fresh full deadline after DNS)', async () => {
  const server = silentServer()
  const { ms, error } = await timed(() => safeProviderRequest({
    url: URL_OK, allowedHosts: ALLOWED, timeoutMs: 800, resolveHost: slowDns(500), request: server.request,
  }))
  assert.ok(isCode('UPSTREAM_TIMEOUT')(error), String(error))
  assert.equal(server.sent.length, 1)
  // Fixed: ~800 ms. Old: 500 + 800 ms.
  assert.ok(ms < 1150, `took ${Math.round(ms)} ms against an 800 ms deadline (500 ms of it in DNS)`)
  assert.ok((server.sent[0]!.timeout ?? Infinity) <= 800 - 250, `socket timeout ${server.sent[0]!.timeout} is the remainder, not the full deadline`)
})

test('the stream path keeps the same total deadline, DNS included', async () => {
  const server = silentServer()
  const { ms, error } = await timed(() => safeProviderStream({
    url: URL_OK, allowedHosts: ALLOWED, method: 'POST', body: '{}', timeoutMs: 400, resolveHost: slowDns(1200), request: server.request,
  }))
  assert.ok(isCode('UPSTREAM_TIMEOUT')(error), String(error))
  assert.ok(ms < 900, `took ${Math.round(ms)} ms against a 400 ms deadline`)
  await new Promise(resolve => setTimeout(resolve, 1000))
  assert.deepEqual(server.sent, [])
})

test('a resolver that fails is still DNS_UNAVAILABLE, not a timeout', async () => {
  const server = silentServer()
  await assert.rejects(safeProviderRequest({
    url: URL_OK, allowedHosts: ALLOWED, timeoutMs: 1000, resolveHost: async () => { throw new Error('SERVFAIL') }, request: server.request,
  }), isCode('DNS_UNAVAILABLE'))
})

test('an empty query object adds no trailing "?" (RED before: path "/v1/models?")', async () => {
  const sent: RequestOptions[] = []
  const request: ProviderRequest = (options, onResponse) => {
    sent.push(options)
    const req = Object.assign(new EventEmitter(), {
      write() {}, destroy() {},
      end() {
        queueMicrotask(() => {
          const response = Object.assign(new EventEmitter(), { statusCode: 204, headers: {}, resume() {}, destroy() {} })
          onResponse(response as never)
          queueMicrotask(() => response.emit('end'))
        })
      },
    })
    return req as never
  }
  await safeProviderRequest({ url: URL_OK, allowedHosts: ALLOWED, query: {}, resolveHost: slowDns(0), request })
  await safeProviderRequest({ url: URL_OK, allowedHosts: ALLOWED, query: { a: '1' }, resolveHost: slowDns(0), request })
  assert.deepEqual(sent.map(options => options.path), ['/v1/models', '/v1/models?a=1'])
})
