import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import * as h3 from 'h3'
import { z } from 'zod'
import { startH3TestServer, type H3TestServer } from './_h3-test-server'
import { finitePositive } from '../server/utils/query-number'
import {
  INVALID_BODY_MESSAGE,
  queryFinitePositive,
  readJsonBody,
  readValidated,
  readValidatedQuery,
} from '../server/utils/request-body'

/**
 * `server/utils/request-body.ts` — the one way NEW endpoints read their input
 * (wave2 5.2, design D5, spec request-validation).
 *
 * Every case goes through a real h3 app over `node:http`, because what breaks is
 * h3 turning bytes into a value: `readBody(event).catch(() => ({}))` (101 call
 * sites today) turns `{"name":` into `{}`, and a save "succeeds" with nothing in
 * it; with `Content-Type: application/json; charset=utf-8` h3 does not even throw —
 * the truncated text comes back as a STRING.
 *
 * Assertions read the JSON body's `statusMessage` (what `errorMessage()` shows),
 * never the HTTP status line: h3 strips non-ASCII from the status line.
 */

const ItemSchema = z.object({ id: z.number() })
const BodySchema = z.object({
  id: z.number(),
  title: z.string().optional(),
  nested: z.object({ items: z.array(ItemSchema) }).optional(),
})
const CustomMessageSchema = z.object({
  type: z.enum(['sql', 'files', 'all'], { error: 'Loại backup không hợp lệ (sql | files | all).' }),
})
const QuerySchema = z.object({
  page: queryFinitePositive(1, 50),
  id: z.coerce.number().int().positive(),
})

let server: H3TestServer
before(async () => {
  server = await startH3TestServer((router) => {
    router.post('/json', h3.defineEventHandler(async event => ({ body: await readJsonBody(event) })))
    router.post('/validated', h3.defineEventHandler(async event => ({ data: await readValidated(event, BodySchema) })))
    router.post('/strict', h3.defineEventHandler(async event => ({ data: await readValidated(event, z.strictObject({ a: z.string() })) })))
    router.post('/record', h3.defineEventHandler(async event => ({ data: await readValidated(event, z.record(z.string(), z.number())) })))
    router.post('/custom', h3.defineEventHandler(async event => ({ data: await readValidated(event, CustomMessageSchema) })))
    router.get('/query', h3.defineEventHandler(async event => ({ data: await readValidatedQuery(event, QuerySchema) })))
  })
})
after(() => server.close())

const JSON_TYPE = 'application/json'
const postJson = (path: string, body: string, contentType: string | undefined = JSON_TYPE) =>
  server.send('POST', path, { body, contentType })

/** A refusal that says nothing about zod: no `data`, no issue list, no English default. */
function assertCleanRefusal(response: { status: number, text: string, json: () => Record<string, unknown> }, message: string | RegExp) {
  assert.equal(response.status, 400, response.text)
  const body = response.json()
  if (typeof message === 'string') assert.equal(body.statusMessage, message)
  else assert.match(String(body.statusMessage), message)
  assert.equal(body.data, undefined, 'the validator error must not travel in `data`')
  assert.doesNotMatch(response.text, /issues|invalid_type|invalid_value|expected|received|Invalid input|Zod|Validation Error/i)
}

// ─── readJsonBody ─────────────────────────────────────────────────────────────

test('readJsonBody: truncated JSON is a 400 with the stable message, whatever the JSON Content-Type spelling', async () => {
  for (const contentType of [JSON_TYPE, 'application/json; charset=utf-8', 'Application/JSON;charset=UTF-8', undefined]) {
    assertCleanRefusal(await postJson('/json', '{"name":', contentType), INVALID_BODY_MESSAGE)
  }
  assert.equal(INVALID_BODY_MESSAGE, 'Dữ liệu gửi lên không hợp lệ')
})

test('readJsonBody: valid JSON that is not a plain object (array, null, string, number, boolean) is a 400', async () => {
  for (const body of ['[1,2]', '[]', 'null', '"text"', '42', 'true']) {
    assertCleanRefusal(await postJson('/json', body), INVALID_BODY_MESSAGE)
  }
})

test('readJsonBody: an empty body is a 400, not `undefined` handed to the endpoint', async () => {
  assertCleanRefusal(await server.send('POST', '/json', {}), INVALID_BODY_MESSAGE)
  assertCleanRefusal(await postJson('/json', ''), INVALID_BODY_MESSAGE)
})

test('readJsonBody: a form or text body is not JSON — urlencoded and text/plain are refused', async () => {
  // Both are "simple" content types a cross-site HTML form can send without a
  // preflight; h3 would parse the first into an object of strings.
  assertCleanRefusal(await postJson('/json', 'a=1&b=2', 'application/x-www-form-urlencoded'), INVALID_BODY_MESSAGE)
  assertCleanRefusal(await postJson('/json', '{"a":1}', 'text/plain;charset=UTF-8'), INVALID_BODY_MESSAGE)
  assertCleanRefusal(await postJson('/json', '{"a":1}', 'multipart/form-data; boundary=x'), INVALID_BODY_MESSAGE)
})

test('readJsonBody: a JSON object is returned as parsed, for application/json and +json types', async () => {
  for (const contentType of [JSON_TYPE, 'application/json; charset=utf-8', 'application/vnd.api+json', undefined]) {
    const response = await postJson('/json', '{"name":"Nguyễn","n":2,"tags":["a"]}', contentType)
    assert.equal(response.status, 200, `${contentType}: ${response.text}`)
    assert.deepEqual(response.json().body, { name: 'Nguyễn', n: 2, tags: ['a'] })
  }
})

test('readJsonBody: a body with a `__proto__` or `constructor.prototype` key is refused (destr strict), never parsed', async () => {
  // A plain `JSON.parse` would hand the endpoint an own `__proto__` property, and
  // one `Object.assign` later the prototype is the request's.
  for (const body of ['{"__proto__":{"polluted":true},"a":1}', '{"constructor":{"prototype":{"polluted":true}}}']) {
    assertCleanRefusal(await postJson('/json', body), INVALID_BODY_MESSAGE)
  }
  assert.equal(({} as Record<string, unknown>).polluted, undefined)
})

// ─── readValidated ────────────────────────────────────────────────────────────

test('readValidated: a wrong type is a 400 naming the field (spec: `{ id: "x" }` names `id`)', async () => {
  assertCleanRefusal(await postJson('/validated', '{"id":"x"}'), 'Trường "id" không hợp lệ.')
})

test('readValidated: a missing required field is named', async () => {
  assertCleanRefusal(await postJson('/validated', '{"title":"t"}'), 'Trường "id" không hợp lệ.')
})

test('readValidated: a nested failure names the full path, array indexes in brackets', async () => {
  const response = await postJson('/validated', '{"id":1,"nested":{"items":[{"id":1},{"id":"a"}]}}')
  assertCleanRefusal(response, 'Trường "nested.items[1].id" không hợp lệ.')
})

test('readValidated: only the FIRST invalid field is named', async () => {
  assertCleanRefusal(await postJson('/validated', '{"id":"x","nested":{"items":"no"}}'), 'Trường "id" không hợp lệ.')
})

test('readValidated: malformed JSON is the readJsonBody 400, before any schema runs', async () => {
  assertCleanRefusal(await postJson('/validated', '{"id":'), INVALID_BODY_MESSAGE)
  assertCleanRefusal(await postJson('/validated', '[{"id":1}]'), INVALID_BODY_MESSAGE)
})

test('readValidated: a message written on the schema is used as is; zod\'s English default never is', async () => {
  assertCleanRefusal(await postJson('/custom', '{"type":"x"}'), 'Loại backup không hợp lệ (sql | files | all).')
  assertCleanRefusal(await postJson('/custom', '{}'), 'Loại backup không hợp lệ (sql | files | all).')
})

test('readValidated: an unexpected key on a strict object names that key', async () => {
  assertCleanRefusal(await postJson('/strict', '{"a":"x","evil":1}'), 'Trường "evil" không hợp lệ.')
})

test('readValidated: a field name taken from the request is cut short, not echoed in full', async () => {
  const key = 'k'.repeat(5000)
  const response = await postJson('/record', JSON.stringify({ [key]: 'x' }))
  assertCleanRefusal(response, /^Trường "k+…" không hợp lệ\.$/)
  assert.ok(String(response.json().statusMessage).length < 200)
})

test('readValidated: valid input returns the parsed value; keys the schema does not declare are dropped', async () => {
  const response = await postJson('/validated', '{"id":3,"title":"Tin","extra":"x","nested":{"items":[{"id":1}]}}')
  assert.equal(response.status, 200, response.text)
  assert.deepEqual(response.json().data, { id: 3, title: 'Tin', nested: { items: [{ id: 1 }] } })
})

// ─── readValidatedQuery + queryFinitePositive ─────────────────────────────────

test('readValidatedQuery: a strict number field that is not a number is a 400 naming it', async () => {
  assertCleanRefusal(await server.send('GET', '/query?id=x'), 'Trường "id" không hợp lệ.')
  assertCleanRefusal(await server.send('GET', '/query'), 'Trường "id" không hợp lệ.')
  assertCleanRefusal(await server.send('GET', '/query?id=1e999'), 'Trường "id" không hợp lệ.')
})

test('queryFinitePositive: is finitePositive, not a second copy of it — garbage falls back, never a 400', async () => {
  // Raw query spellings and what getQuery hands the schema for each.
  const spellings: Array<[string, unknown]> = [
    ['page=abc', 'abc'],
    ['page=1e999', '1e999'],
    ['page=', ''],
    ['page=0', '0'],
    ['page=-5', '-5'],
    ['page=7.9', '7.9'],
    ['page=50', '50'],
    ['page=51', '51'],
    ['page=2&page=3', ['2', '3']],
    ['', undefined],
  ]
  for (const [query, raw] of spellings) {
    const response = await server.send('GET', `/query?id=4${query ? `&${query}` : ''}`)
    assert.equal(response.status, 200, `${query}: ${response.text}`)
    const data = response.json().data as { page: number, id: number }
    assert.equal(data.page, finitePositive(raw, 1, 50), `?${query}`)
    assert.equal(data.id, 4)
  }
})
