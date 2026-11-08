/**
 * `tests/_h3-handler-server.ts`, the real-h3 harness 40-odd suites use: a handler that never answers fails
 * its request after a deadline, with an error that names the request — and `close()` still returns. Before,
 * such a request waited for undici's 300 s header timeout and failed as a bare "fetch failed"
 * (tests/favicon-lifecycle-behavior.test.ts hung that long on a CI runner, 2026-11-07, and the log could
 * not say which of its three calls it was); and `server.close()` waits for open connections, so the hung
 * one would then have held the suite's `after` hook.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as h3 from 'h3'

import { REQUEST_DEADLINE_MS, startHandlerServer } from './_h3-handler-server.ts'

/** Fails the test if `promise` has not settled within `ms` — so a regression here fails, never hangs. */
function within<T>(ms: number, promise: Promise<T>, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`${what} still pending after ${ms} ms`)), ms) })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}

test('a hung handler fails its request after the deadline, naming it; close() still returns', async () => {
  const server = await startHandlerServer([
    { method: 'post', path: '/hang', handler: h3.defineEventHandler(() => new Promise(() => {})) },
    { method: 'get', path: '/ok', handler: h3.defineEventHandler(() => ({ ok: true })) },
  ])
  try {
    const started = Date.now()
    await assert.rejects(
      within(5_000, server.request('POST', '/hang', { body: { a: 1 }, deadlineMs: 200 }), 'the hung request'),
      /^Error: POST \/hang: no answer within 200 ms — the handler hung$/,
    )
    assert.ok(Date.now() - started < 2_000, 'it failed at the deadline, not later')
    assert.deepEqual((await server.request('GET', '/ok')).body, { ok: true }, 'other requests are unaffected')
    // The hung request's connection is still open on the server side.
    void server.request('POST', '/hang', { deadlineMs: 60_000 }).catch(() => {})
    await new Promise(resolve => setTimeout(resolve, 50))
  } finally {
    await within(5_000, server.close(), 'close()')
  }
})

test('the default deadline ends a hang well before undici\'s 300 s, and leaves real handlers plenty of time', () => {
  assert.ok(REQUEST_DEADLINE_MS >= 10_000 && REQUEST_DEADLINE_MS <= 60_000, String(REQUEST_DEADLINE_MS))
})
