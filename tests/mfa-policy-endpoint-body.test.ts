import assert from 'node:assert/strict'
import test, { after, before, beforeEach, mock } from 'node:test'
import { startH3TestServer, type H3TestServer } from './_h3-test-server'

/**
 * `PUT /api/admin/security/mfa-policy` (wave2 2A) — how its body is read, in a REAL
 * h3 app with real bytes (wave2 5.2, `server/utils/request-body.ts`).
 *
 * 2A wrote it with the legacy `readBody(event).catch(() => null)`: the 5.2 ratchet
 * (`tests/request-body-baseline.test.ts`) refuses a NEW file reading that way, and
 * the legacy list may only shrink — so on the integration branch the endpoint moves
 * to `readValidated` instead of joining the list (CHANGELOG § 39/§ 38). Measured
 * against the 2A handler: a body a cross-site page can send without a preflight — a
 * urlencoded form `policy=all`, or `{"policy":"all"}` with no Content-Type — reached
 * `setMfaPolicy`, and a truncated JSON body was swallowed into "invalid policy".
 *
 * The permission checks still come first (a non-SuperAdmin is refused before the
 * body is read — tests/admin-mfa-enforcement-behavior.test.ts); here they pass.
 */

const calls: unknown[] = []
mock.module('../server/services/mfa-policy', {
  namedExports: {
    setMfaPolicy: async (_actor: unknown, input: unknown) => {
      calls.push(input)
      return { policy: input, enforceAfter: null, changed: true }
    },
  },
})
mock.module('../server/utils/permissions', { namedExports: { requireResourcePermission: () => {}, requireSuperAdmin: () => {} } })

const h3 = await import('h3')
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = h3.defineEventHandler
globals.createError = h3.createError
// Nitro's auto-import of the legacy reader, so the same test also runs (red) against
// the 2A handler that called `readBody` bare.
globals.readBody = h3.readBody
const handler = (await import('../server/api/admin/security/mfa-policy.put')).default

const PATH = '/api/admin/security/mfa-policy'
let server: H3TestServer
before(async () => {
  server = await startH3TestServer((router) => {
    router.put(PATH, h3.defineEventHandler((event) => {
      event.context.adminUser = { id: 1, isSuperAdmin: true }
      return handler(event)
    }))
  })
})
after(() => server.close())
beforeEach(() => { calls.length = 0 })

// `null` = send no Content-Type at all (a default parameter would turn `undefined`
// back into JSON — the trap tests/backup-run-endpoint.test.ts documents).
const put = (body: string, contentType: string | null = 'application/json') =>
  server.send('PUT', PATH, { body, ...(contentType === null ? {} : { contentType }) })

test('a JSON object reaches the policy service as sent (what /admin/settings/security posts)', async () => {
  for (const policy of ['off', 'privileged', 'all']) {
    const response = await put(JSON.stringify({ policy }))
    assert.equal(response.status, 200, response.text)
    assert.equal(response.json().policy, policy)
  }
  assert.deepEqual(calls, ['off', 'privileged', 'all'])
})

test('bodies a cross-site page can send without a preflight are 400 and never reach the service', async () => {
  for (const [body, contentType] of [
    ['policy=all', 'application/x-www-form-urlencoded'],
    ['{"policy":"all"}', null],
    ['{"policy":"all"}', 'text/plain'],
  ] as const) {
    const response = await put(body, contentType)
    assert.equal(response.status, 400, `${contentType ?? 'no Content-Type'}: ${response.text}`)
    assert.equal(response.json().statusMessage, 'Dữ liệu gửi lên không hợp lệ')
  }
  assert.deepEqual(calls, [])
})

test('a truncated JSON body is the shared 400, not "invalid policy"', async () => {
  const response = await put('{"policy":"al')
  assert.equal(response.status, 400)
  assert.equal(response.json().statusMessage, 'Dữ liệu gửi lên không hợp lệ')
  assert.deepEqual(calls, [])
})

test('an unknown or missing policy is 400 with the endpoint\'s own message, and the service is not called', async () => {
  for (const body of ['{"policy":"everyone"}', '{}', '{"policy":null}']) {
    const response = await put(body)
    assert.equal(response.status, 400, body)
    assert.equal(response.json().statusMessage, 'Chính sách MFA không hợp lệ (off, privileged hoặc all).')
  }
  assert.deepEqual(calls, [])
})
