import assert from 'node:assert/strict'
import test from 'node:test'
import { createFetchError } from 'ofetch'
import { createError } from 'h3'
import { errorMessage, errorStatus } from '../app/utils/errorMessage'

/**
 * `errorMessage` decides what a citizen or officer reads when something fails.
 *
 * A failed `$fetch` used to surface ofetch's generated text — on a dropped
 * connection `[POST] "/api/submissions": <no response> Failed to fetch`, on an
 * nginx 502 the status text "Bad Gateway" — instead of the caller's Vietnamese
 * fallback (rà soát 2026-10-22). Errors are built with ofetch's own
 * `createFetchError`, so the shape is the real one, not a hand-made imitation.
 */

const FALLBACK = 'Không gửi được, vui lòng thử lại.'
const request = '/api/submissions'
const options = { method: 'POST' } as never

function response(status: number, statusText: string, body: unknown) {
  return { status, statusText, _data: body } as never
}

test('a server createError message wins', () => {
  const error = createFetchError({ request, options, response: response(400, 'Bad Request', { statusCode: 400, statusMessage: 'Vui lòng nhập họ tên.' }) } as never)
  assert.equal(errorMessage(error, FALLBACK), 'Vui lòng nhập họ tên.')
  assert.equal(errorStatus(error), 400, 'errorStatus is unaffected')
})

test('a network failure falls back — the ofetch request line never reaches the screen', () => {
  const error = createFetchError({ request, options, error: new TypeError('Failed to fetch') } as never)
  assert.match(error.message, /<no response>/, 'precondition: the raw message really is technical')
  assert.equal(errorMessage(error, FALLBACK), FALLBACK)
})

test('a proxy error page falls back — not "Bad Gateway", not the HTML', () => {
  const error = createFetchError({ request, options, response: response(502, 'Bad Gateway', '<html><body>502 Bad Gateway</body></html>') } as never)
  assert.equal(errorMessage(error, FALLBACK), FALLBACK)
  assert.equal(errorStatus(error), 502)
})

test('the same holds once Nuxt wraps the FetchError (what useFetch/useAsyncData put in `error`)', () => {
  const network = createError(createFetchError({ request, options, error: new TypeError('Failed to fetch') } as never) as never)
  assert.equal(errorMessage(network, FALLBACK), FALLBACK)
  const server = createError(createFetchError({ request, options, response: response(403, 'Forbidden', { statusMessage: 'Bạn không có quyền.' }) } as never) as never)
  assert.equal(errorMessage(server, FALLBACK), 'Bạn không có quyền.')
})

test('errors that are not fetch failures keep their message', () => {
  assert.equal(errorMessage(new Error('Tệp vượt quá 25 MB.'), FALLBACK), 'Tệp vượt quá 25 MB.')
  assert.equal(errorMessage(createError({ statusCode: 409, statusMessage: 'Đang có job chạy.' }), FALLBACK), 'Đang có job chạy.')
  assert.equal(errorMessage('Hết phiên làm việc.', FALLBACK), 'Hết phiên làm việc.')
})

test('nothing readable → the fallback, never an empty string', () => {
  for (const value of [null, undefined, '', '   ', {}, { message: '  ' }, 42]) {
    assert.equal(errorMessage(value, FALLBACK), FALLBACK, JSON.stringify(value))
  }
})
