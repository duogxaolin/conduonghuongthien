import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import test, { after, before } from 'node:test'
import { $fetch } from 'ofetch'
import { createError } from 'h3'
import { isAbortError } from '../app/utils/errorMessage'

/**
 * `isAbortError()` must recognise the abort a page asked for — as ofetch REALLY
 * reports it.
 *
 * ofetch does not rethrow the browser's `AbortError`: it wraps it in a `FetchError`
 * (`name: 'FetchError'`, message "[GET] …: <no response> This operation was aborted")
 * and keeps the original as `cause`; Nuxt's `useFetch`/`useAsyncData` wrap once more.
 * The old check read only the outer `name`, so a real ofetch abort was "not an abort"
 * and a page that aborts a stale request (analytics.vue) treated it as a failure. The
 * fix walks `cause`, bounded and cycle-safe. A TIMEOUT is not an abort the page chose —
 * it stays a failure the user must see.
 *
 * Real ofetch, real `fetch`, against a local server that never answers (or answers 500).
 */

let server: Server
let base = ''
before(async () => {
  server = createServer((req, res) => {
    if (req.url === '/fail') {
      res.statusCode = 500
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ statusMessage: 'boom' }))
    }
    // Any other path: never answer — only an abort or a timeout ends the request.
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(async () => {
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
})

async function caught(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
  } catch (error) {
    return error
  }
  return assert.fail('the request did not fail')
}

test('a real ofetch abort (AbortController.abort()) is an abort — through the FetchError wrapper', async () => {
  const controller = new AbortController()
  const pending = caught(() => $fetch(`${base}/hang`, { signal: controller.signal, retry: false }))
  setTimeout(() => controller.abort(), 20)
  const error = await pending
  // What the page receives: ofetch's wrapper, the abort only as its cause.
  assert.equal((error as { name?: unknown }).name, 'FetchError')
  assert.equal(((error as { cause?: { name?: unknown } }).cause)?.name, 'AbortError')
  assert.equal(isAbortError(error), true)
})

test('…and once more wrapped, as useFetch/useAsyncData hand it over (h3 createError — what Nuxt\'s builds on — keeps the FetchError as cause)', async () => {
  const controller = new AbortController()
  controller.abort()
  const fetchError = await caught(() => $fetch(`${base}/hang`, { signal: controller.signal, retry: false }))
  assert.equal(isAbortError(createError({ statusCode: 500, cause: fetchError })), true)
  assert.equal(isAbortError(new Error('wrapped', { cause: fetchError })), true)
})

test('an ofetch timeout is NOT an abort — it is a failure the user must see', async () => {
  const error = await caught(() => $fetch(`${base}/hang`, { timeout: 30, retry: false }))
  assert.equal((error as { name?: unknown }).name, 'FetchError')
  assert.equal(isAbortError(error), false)
})

test('a server error and a refused connection are not aborts', async () => {
  assert.equal(isAbortError(await caught(() => $fetch(`${base}/fail`, { retry: false }))), false)
  assert.equal(isAbortError(await caught(() => $fetch('http://127.0.0.1:1/x', { retry: false }))), false)
})

test('the plain shapes still read as before; the cause walk is bounded and cycle-safe', () => {
  assert.equal(isAbortError(new DOMException('aborted', 'AbortError')), true)
  assert.equal(isAbortError(Object.assign(new Error('canceled'), { name: 'CanceledError' })), true)
  for (const value of [null, undefined, 'AbortError', 42, new Error('x'), { name: 'TimeoutError' }]) {
    assert.equal(isAbortError(value), false, String(value))
  }
  const loop = new Error('loop') as Error & { cause?: unknown }
  loop.cause = loop
  assert.equal(isAbortError(loop), false, 'a cause cycle must end, not hang')
  const a = { name: 'Error', cause: undefined as unknown }
  const b = { name: 'Error', cause: a }
  a.cause = b
  assert.equal(isAbortError(a), false)
  // Bounded: an abort buried under more wrappers than any real stack produces is not looked for.
  let deep: unknown = new DOMException('aborted', 'AbortError')
  for (let i = 0; i < 10; i += 1) deep = { name: 'Error', cause: deep }
  assert.equal(isAbortError(deep), false)
})
