import assert from 'node:assert/strict'
import test, { beforeEach, mock } from 'node:test'

/**
 * `PUT /api/admin/profile/password` — changing your own admin password.
 *
 * Until now this endpoint was covered only by regexes over its source
 * (`mfa-codes-endpoints.test.ts`): the literal `limit: 5`, the presence of
 * `tokenVersion + 1`, the call to `setSessionCookie`. None of that shows the
 * handler actually refuses a wrong current password, rate-limits the guessing,
 * revokes the old sessions or keeps the caller signed in (rà soát 2026-10-22).
 * These run the real handler with the real password hashing and the real
 * rate-limit store (in-memory, as it runs when the pool is unavailable), against
 * a fake database.
 */

const { hashPassword, verifyPassword } = await import('../server/utils/auth')
const { users, activityLogs } = await import('../server/db/schema')

const CURRENT = 'Mat-Khau-Hien-Tai-2026'
const NEXT = 'Mat-Khau-Moi-An-Toan-2027'
const account = { id: 7, username: 'canbo7', passwordHash: '', tokenVersion: 3 }
account.passwordHash = await hashPassword(CURRENT)

const written = { updates: [] as Array<Record<string, unknown>>, audits: [] as Array<Record<string, unknown>> }
const cookies: Array<Record<string, unknown>> = []
const headers: Record<string, unknown> = {}

mock.module('../server/utils/db', {
  namedExports: {
    getPool: () => null, // rate limiter falls back to its in-process memory store
    getDb: () => ({
      select: (projection: Record<string, unknown>) => ({
        from: () => ({
          where: () => ({
            limit: async () => ('passwordHash' in projection
              ? [{ passwordHash: account.passwordHash, username: account.username }]
              : [{ tokenVersion: account.tokenVersion }]),
          }),
        }),
      }),
      update: (table: unknown) => ({
        set: (set: Record<string, unknown>) => ({
          where: async () => {
            assert.equal(table, users)
            written.updates.push(set)
            // What the database does with `token_version + 1` and the new hash.
            account.passwordHash = set.passwordHash as string
            account.tokenVersion += 1
          },
        }),
      }),
      insert: (table: unknown) => ({ values: async (values: Record<string, unknown>) => { assert.equal(table, activityLogs); written.audits.push(values) } }),
    }),
  },
})
mock.module('../server/utils/mfa/session', { namedExports: { setSessionCookie: (_event: unknown, user: Record<string, unknown>) => { cookies.push(user) } } })
mock.module('../server/utils/client-ip', { namedExports: { getClientIp: () => '203.0.113.9' } })

type Event = { body: unknown, context: { adminUser: unknown } }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: Event) => event.body
globals.createError = (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input)
globals.setResponseHeader = (_event: Event, name: string, value: unknown) => { headers[name] = value }
globals.getRequestHeader = () => 'test-agent'

const changePassword = (await import('../server/api/admin/profile/password.put')).default as unknown as (event: Event) => Promise<Record<string, unknown>>
const { clearRateLimit } = await import('../server/utils/rate-limit-store')

const admin = { id: 7, username: 'canbo7', email: null, roleId: 2, roleName: 'Biên tập', isSystem: false }
const call = (body: unknown, adminUser: unknown = admin) => changePassword({ body, context: { adminUser } })
async function statusOf(run: () => Promise<unknown>): Promise<number | null> {
  try { await run(); return null } catch (error) { return (error as { statusCode?: number }).statusCode ?? -1 }
}

beforeEach(async () => {
  account.passwordHash = await hashPassword(CURRENT)
  account.tokenVersion = 3
  written.updates.length = 0
  written.audits.length = 0
  cookies.length = 0
  for (const key of Object.keys(headers)) delete headers[key]
  await clearRateLimit('profile:password:user:7', {})
})

test('no session → 401; missing fields → 400; nothing is written', async () => {
  assert.equal(await statusOf(() => call({ currentPassword: CURRENT, newPassword: NEXT }, null)), 401)
  assert.equal(await statusOf(() => call({ currentPassword: CURRENT })), 400)
  assert.equal(await statusOf(() => call({ newPassword: NEXT })), 400)
  assert.deepEqual(written.updates, [])
})

test('a wrong current password is refused and the password stays as it was', async () => {
  assert.equal(await statusOf(() => call({ currentPassword: 'sai-mat-khau-roi', newPassword: NEXT })), 401)
  assert.deepEqual(written.updates, [])
  assert.ok(await verifyPassword(CURRENT, account.passwordHash))
})

test('a weak new password, or the same password again, is refused', async () => {
  assert.equal(await statusOf(() => call({ currentPassword: CURRENT, newPassword: 'ngan' })), 400)
  assert.equal(await statusOf(() => call({ currentPassword: CURRENT, newPassword: 'canbo7-Mat-Khau-2026' })), 400, 'contains the username')
  assert.equal(await statusOf(() => call({ currentPassword: CURRENT, newPassword: CURRENT })), 400)
  assert.deepEqual(written.updates, [])
})

test('success: new hash stored, every old session revoked, this session kept, audited', async () => {
  const result = await call({ currentPassword: CURRENT, newPassword: NEXT })
  assert.equal(result.ok, true)
  assert.equal(written.updates.length, 1)
  assert.ok(await verifyPassword(NEXT, account.passwordHash), 'the new password now verifies')
  assert.ok(!(await verifyPassword(CURRENT, account.passwordHash)), 'the old one no longer does')
  assert.ok(written.updates[0]!.tokenVersion, 'token_version is bumped, so sessions minted before are rejected')
  assert.equal(cookies.length, 1, 'the caller gets a fresh cookie instead of being logged out')
  assert.equal(cookies[0]!.tokenVersion, 4, 'and it carries the NEW generation')
  assert.equal(written.audits.length, 1)
  assert.equal(written.audits[0]!.resource, 'profile_password')
  assert.equal(written.audits[0]!.userId, 7)
})

test('five wrong guesses in the window → the sixth attempt is 429 even with the right password', async () => {
  for (let i = 0; i < 5; i++) {
    assert.equal(await statusOf(() => call({ currentPassword: `sai-${i}-mat-khau`, newPassword: NEXT })), 401)
  }
  assert.equal(await statusOf(() => call({ currentPassword: CURRENT, newPassword: NEXT })), 429)
  assert.ok(Number(headers['Retry-After']) > 0, 'Retry-After is set')
  assert.deepEqual(written.updates, [])
})

test('a successful change clears the counter: earlier wrong guesses do not count against the next change', async () => {
  for (let i = 0; i < 4; i++) await statusOf(() => call({ currentPassword: `sai-${i}-mat-khau`, newPassword: NEXT }))
  await call({ currentPassword: CURRENT, newPassword: NEXT })
  assert.equal(await statusOf(() => call({ currentPassword: 'sai-lan-nua-roi', newPassword: CURRENT })), 401)
  assert.equal(await statusOf(() => call({ currentPassword: NEXT, newPassword: 'Mat-Khau-Thu-Ba-2028' })), null, 'not 429')
})
