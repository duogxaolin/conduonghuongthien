/**
 * `adminFetch` and the error body of a NON-JSON request (wave3 7.1 batch C, FINDING).
 *
 * ofetch reads the response body with the requested `responseType` whatever the status:
 * a download asked as `responseType: 'blob'` that the server refuses with
 * `createError({ statusCode: 403, statusMessage })` rejects with a `FetchError` whose
 * `data` is a Blob holding the JSON — not the parsed object. `errorMessage()` looks for
 * `data.statusMessage`, finds none, and the officer read the page's generic fallback
 * ("Không thể tải tệp mẫu.", "Lỗi tải ZIP bài viết") instead of the sentence the server
 * wrote ("Bạn không có quyền…"). `errorMessage()` is synchronous and cannot read a Blob,
 * so `adminFetch` — the one place every admin request goes through — parses a JSON error
 * body of a `blob`/`text`/`arrayBuffer` request into `data` before rethrowing.
 *
 * What does NOT change, pinned below: the error is the SAME object (a `FetchError`, its
 * status and `cause` intact — `errorStatus()` and abort detection still read them); a
 * non-JSON error body (an nginx HTML page) is left alone, so it still never reaches the
 * screen; JSON requests and successful downloads are untouched.
 *
 * REAL ofetch over a fake network (`createFetch({ fetch })`), the real `adminFetch`,
 * `errorMessage` and `errorStatus`.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createFetch, FetchError } from 'ofetch'

import { adminFetch, type AdminFetchOptions } from '../app/composables/adminFetch.ts'
import { errorMessage, errorStatus } from '../app/utils/errorMessage.ts'

const FALLBACK = 'Không thể tải tệp mẫu.'
const SENTENCE = 'Bạn không có quyền tạo mục kiến thức.'
const OFETCH_LINE = /\[(GET|POST|PUT|PATCH|DELETE)\]|<no response>|fetch failed/

function serve(answer: () => Response | Error) {
  const fetchImpl = async () => {
    const result = answer()
    if (result instanceof Error) throw result
    return result
  }
  ;(globalThis as Record<string, unknown>).$fetch = createFetch({ fetch: fetchImpl as typeof fetch })
}
/** What `throw createError({ statusCode, statusMessage })` sends from a Nitro handler. */
const h3Error = (statusCode: number, statusMessage: string) => new Response(
  JSON.stringify({ statusCode, statusMessage, message: statusMessage }),
  { status: statusCode, statusText: statusMessage.replace(/[^\t\x20-\x7E]/g, ''), headers: { 'content-type': 'application/json' } },
)

async function failure(options: AdminFetchOptions): Promise<unknown> {
  try {
    await adminFetch<unknown>('/api/admin/chatbot/knowledge/template', { retry: false, ...options })
  } catch (err: unknown) {
    return err
  }
  assert.fail('the request was expected to fail')
}

describe('adminFetch: the JSON error body of a non-JSON request', () => {
  for (const responseType of ['blob', 'text', 'arrayBuffer'] as const) {
    it(`responseType '${responseType}': the server's sentence reaches errorMessage, the status errorStatus`, async () => {
      serve(() => h3Error(403, SENTENCE))
      const err = await failure({ responseType })
      assert.ok(err instanceof FetchError, 'still the FetchError ofetch threw')
      assert.equal(errorMessage(err, FALLBACK), SENTENCE)
      assert.equal(errorStatus(err), 403)
      assert.deepEqual((err as FetchError).data, { statusCode: 403, statusMessage: SENTENCE, message: SENTENCE })
    })
  }

  it('a non-JSON error body (a proxy\'s HTML page) is left as it was: the fallback, never the page or ofetch\'s line', async () => {
    serve(() => new Response('<html><body>502 Bad Gateway</body></html>', { status: 502, statusText: 'Bad Gateway', headers: { 'content-type': 'text/html' } }))
    const err = await failure({ responseType: 'blob' })
    assert.ok(err instanceof FetchError)
    assert.ok((err as FetchError).data instanceof Blob, 'an HTML body is not parsed')
    assert.equal(errorMessage(err, FALLBACK), FALLBACK)
    assert.equal(errorStatus(err), 502)
  })

  // Batch D: the content-type check, not the parse, decides. A proxy page that happens to be
  // JSON-shaped but is not declared JSON is not the server's sentence.
  it('a JSON-shaped body NOT declared as JSON is left as it was: the fallback, not the body', async () => {
    serve(() => new Response(JSON.stringify({ statusCode: 403, statusMessage: 'Câu của proxy, không phải của máy chủ.' }), { status: 403, headers: { 'content-type': 'text/plain' } }))
    const err = await failure({ responseType: 'blob' })
    assert.ok((err as FetchError).data instanceof Blob, 'a text/plain body is not parsed')
    assert.equal(errorMessage(err, FALLBACK), FALLBACK)
    assert.equal(errorStatus(err), 403)
  })

  it('a JSON content type with a body that is not JSON is left as it was', async () => {
    serve(() => new Response('{"statusMessage": "cụt', { status: 500, headers: { 'content-type': 'application/json' } }))
    const err = await failure({ responseType: 'text' })
    assert.equal((err as FetchError).data, '{"statusMessage": "cụt')
    assert.equal(errorMessage(err, FALLBACK), FALLBACK)
  })

  it('a dropped connection is rethrown untouched: the fallback, never ofetch\'s line', async () => {
    serve(() => new TypeError('fetch failed'))
    const err = await failure({ responseType: 'blob' })
    assert.ok(err instanceof FetchError)
    assert.equal(errorMessage(err, FALLBACK), FALLBACK)
    assert.doesNotMatch(errorMessage(err, FALLBACK), OFETCH_LINE)
    assert.equal(errorStatus(err), null)
  })

  it('JSON requests are untouched: ofetch already parsed the body', async () => {
    serve(() => h3Error(409, 'Một lượt dọn khác đang chạy.'))
    const err = await failure({ method: 'POST' })
    assert.equal(errorMessage(err, FALLBACK), 'Một lượt dọn khác đang chạy.')
    assert.equal(errorStatus(err), 409)
  })

  it('a successful download is the Blob the server sent', async () => {
    serve(() => new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), { status: 200, headers: { 'content-type': 'application/zip' } }))
    const blob = await adminFetch<Blob>('/api/admin/articles/export-batch?ids=1', { responseType: 'blob' })
    assert.ok(blob instanceof Blob)
    assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [0x50, 0x4b, 0x03, 0x04])
  })
})
