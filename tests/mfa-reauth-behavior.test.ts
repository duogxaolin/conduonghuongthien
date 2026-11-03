import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'
import bcrypt from 'bcryptjs'

/**
 * `requireCurrentPassword` (server/utils/mfa/reauth.ts) is the re-proof every MFA
 * change asks for before touching authentication material: enrolling a factor,
 * turning one off, dropping recovery codes. A borrowed session must not be able
 * to do any of those, and a stolen session must not be able to guess its way in.
 *
 * Pinned here, running the real helper inside a real h3 request:
 *   - a wrong password is refused AND counted;
 *   - after five wrong passwords the account is locked for 15 minutes — even the
 *     CORRECT password is then refused, with `Retry-After`;
 *   - the lock is per account, and a correct password clears the count;
 *   - an empty password is a 400 that costs nothing.
 *
 * The account row is read with the real Drizzle query on SQLite
 * (`_sqlite-mysql-db.ts`); the limiter is the real `rate-limit-store` on its
 * in-memory backend, a fresh map per test (the MySQL backend is the same
 * arithmetic, covered by `rate-limit-store` tests).
 */

process.env.JWT_SECRET = 'mfa-reauth-behavior-test-secret-0123456789'

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { users } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([users])

const warnings: Array<Record<string, unknown>> = []
mock.module('../server/utils/logger', {
  namedExports: {
    log: () => {},
    logInfo: () => {},
    logWarn: (entry: Record<string, unknown>) => { warnings.push(entry) },
    logError: () => {},
    SECURITY_EVENTS: new Proxy({}, { get: (_target, key) => `event.${String(key)}` }),
  },
})
mock.module('../server/utils/db', { namedExports: { getDb: () => harness.db, getPool: () => null } })
let memory = new Map<string, { count: number, expiresAt: number }>()
mock.module('../server/utils/rate-limit-deps', { namedExports: { rateLimitDeps: () => ({ execute: null, memory }) } })

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const { requireCurrentPassword } = await import('../server/utils/mfa/reauth')
const h3 = await import('h3')

const PASSWORD = { alice: 'Alice-correct-horse-1', bob: 'Bob-battery-staple-2' }
const HASHES = { alice: await bcrypt.hash(PASSWORD.alice, 4), bob: await bcrypt.hash(PASSWORD.bob, 4) }

const server = await startHandlerServer([{
  method: 'post',
  path: '/reauth/:userId',
  handler: h3.defineEventHandler(async (event) => {
    const body = await h3.readBody<{ password?: string }>(event)
    const account = await requireCurrentPassword(event, Number(h3.getRouterParam(event, 'userId')), body?.password ?? '')
    return { username: account.username }
  }),
}])
after(() => server.close())

const reauth = (userId: number, password: string) => server.request('POST', `/reauth/${userId}`, { body: { password } })

beforeEach(async () => {
  harness.reset()
  memory = new Map()
  warnings.length = 0
  await harness.db.insert(users).values([
    { id: 1, username: 'alice', passwordHash: HASHES.alice },
    { id: 2, username: 'bob', passwordHash: HASHES.bob },
  ])
})

test('the correct password passes and names the account it proved', async () => {
  const response = await reauth(1, PASSWORD.alice)
  assert.equal(response.status, 200)
  assert.equal(response.body.username, 'alice')
})

test('a wrong password is refused with 401 — including another account\'s correct password', async () => {
  assert.equal((await reauth(1, 'not-the-password')).status, 401)
  assert.equal((await reauth(1, PASSWORD.bob)).status, 401, 'Bob\'s password must not re-prove Alice')
  assert.ok(warnings.some(entry => entry.reason === 'profile_reauth_failed' && entry.userId === 1), 'the failure is logged as a security event')
})

test('after five wrong passwords even the correct one is refused, with Retry-After', async () => {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    assert.equal((await reauth(1, `wrong-${attempt}`)).status, 401, `attempt ${attempt}`)
  }
  const locked = await reauth(1, PASSWORD.alice)
  assert.equal(locked.status, 429, 'the correct password got through a locked account')
  const retryAfter = Number(locked.headers.get('retry-after'))
  assert.ok(retryAfter > 14 * 60 && retryAfter <= 15 * 60, `Retry-After ${retryAfter}s is not the 15-minute window`)
})

test('the lock is per account: Bob is not locked out by guesses against Alice', async () => {
  for (let attempt = 1; attempt <= 5; attempt += 1) await reauth(1, `wrong-${attempt}`)
  assert.equal((await reauth(1, PASSWORD.alice)).status, 429)
  assert.equal((await reauth(2, PASSWORD.bob)).status, 200)
})

test('the lock lifts when the 15-minute window has passed', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  for (let attempt = 1; attempt <= 5; attempt += 1) await reauth(1, `wrong-${attempt}`)
  assert.equal((await reauth(1, PASSWORD.alice)).status, 429)
  t.mock.timers.tick(14 * 60 * 1000)
  assert.equal((await reauth(1, PASSWORD.alice)).status, 429, 'lifted before the window ended')
  t.mock.timers.tick(60 * 1000 + 1)
  assert.equal((await reauth(1, PASSWORD.alice)).status, 200)
})

test('a correct password clears the count, so one typo does not linger', async () => {
  for (let attempt = 1; attempt <= 4; attempt += 1) await reauth(1, `wrong-${attempt}`)
  assert.equal((await reauth(1, PASSWORD.alice)).status, 200)
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    assert.equal((await reauth(1, `again-${attempt}`)).status, 401, `attempt ${attempt} after the reset`)
  }
  assert.equal((await reauth(1, PASSWORD.alice)).status, 200, 'the earlier failures still counted after a success')
})

test('an empty password is a 400 that neither reads the account nor counts as a guess', async () => {
  harness.statements.length = 0
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    assert.equal((await reauth(1, '')).status, 400)
  }
  assert.equal(harness.statements.length, 0, 'an empty password reached the database')
  assert.equal((await reauth(1, PASSWORD.alice)).status, 200, 'empty submissions were counted as guesses')
})

test('an account that does not exist is refused, not waved through', async () => {
  assert.equal((await reauth(99, PASSWORD.alice)).status, 401)
})
