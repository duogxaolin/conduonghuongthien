import assert from 'node:assert/strict'
import test, { after, before, mock } from 'node:test'
import { startH3TestServer, type H3TestServer } from './_h3-test-server'

/**
 * `POST /api/admin/system/universal-translate` — how "a run is already going" reaches the admin.
 *
 * The service refuses a second run with `{ ok: false, message }` (`startUniversalAutoTranslate`,
 * server/services/universal-translation.ts). The handler passed that through as a 200, and the
 * "Dịch toàn cục" tab, which reads a 200 as "started", toasted the refusal in green
 * (tests/admin-fetch-rollout-universal-translate.test.ts). A refusal that means "not now" is a 409
 * with the service's sentence — the shape of `backup/run.post.ts` and `ai/moderation/rescan-all`.
 *
 * FINDING, RED on the base (fb4751c1): the refusal was `200 { ok: false }`.
 *
 * Real h3 app; the service and the permission check are replaced (authorization of this route is
 * pinned by tests/admin-handler-authorization.test.ts).
 */

let answer: { ok: boolean, message: string } = { ok: true, message: 'Đã bắt đầu tác vụ quét và dịch toàn cục trong nền!' }
const calls: unknown[][] = []
mock.module('../server/services/universal-translation', {
  namedExports: { startUniversalAutoTranslate: async (...args: unknown[]) => { calls.push(args); return answer } },
})
mock.module('../server/utils/permissions', { namedExports: { requireResourcePermission: () => {} } })

const h3 = await import('h3')
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = h3.defineEventHandler
globals.createError = h3.createError
globals.readBody = h3.readBody
const handler = (await import('../server/api/admin/system/universal-translate.post')).default

const PATH = '/api/admin/system/universal-translate'
let server: H3TestServer
before(async () => {
  server = await startH3TestServer((router) => {
    router.post(PATH, h3.defineEventHandler((event) => {
      event.context.adminUser = { id: 7, isSuperAdmin: true }
      return handler(event)
    }))
  })
})
after(() => server.close())

const start = (body: unknown = { targetLangs: ['EN', ' zh '], articlesLimit: 50, publishImmediately: true }) =>
  server.send('POST', PATH, { body: JSON.stringify(body), contentType: 'application/json' })

test('a run that starts answers the service\'s sentence; the options reach the service as read', async () => {
  answer = { ok: true, message: 'Đã bắt đầu tác vụ quét và dịch toàn cục trong nền!' }
  calls.length = 0
  const response = await start()
  assert.equal(response.status, 200)
  assert.deepEqual(response.json(), { ok: true, message: 'Đã bắt đầu tác vụ quét và dịch toàn cục trong nền!' })
  assert.deepEqual(calls[0]?.slice(1), [['en', 'zh'], { includeUi: true, includeBlocks: true, includeArticles: true, articlesLimit: 50, publishImmediately: true }])
})

test('FINDING: a run already going is a 409 with the service\'s sentence, not 200 { ok: false }', async () => {
  answer = { ok: false, message: 'Một tác vụ quét và dịch toàn cục đang chạy.' }
  const response = await start()
  assert.equal(response.status, 409)
  assert.equal(response.json().statusMessage, 'Một tác vụ quét và dịch toàn cục đang chạy.')
})

test('no language chosen is still a 400 before the service is asked', async () => {
  calls.length = 0
  const response = await start({ targetLangs: [] })
  assert.equal(response.status, 400)
  assert.equal(response.json().statusMessage, 'Vui lòng chọn ít nhất một ngôn ngữ đích.')
  assert.equal(calls.length, 0)
})
