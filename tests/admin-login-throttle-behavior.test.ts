import assert from 'node:assert/strict'
import test, { beforeEach, mock } from 'node:test'

/**
 * `POST /api/admin/auth/login`: what the password endpoint of a government portal must do under
 * guessing. The handler runs for real — real rate-limit store (in-process memory, as it runs when
 * the pool is unavailable), real client-address resolution, with a fake user
 * table, a stand-in password check, and the logger captured.
 *
 * It replaces regexes over `login.post.ts` that lived in `rate-limit-store.test.ts` (three
 * `recordRateLimitHit(ipBucket` calls, `limit: 5` / `limit: 15`, the two key templates,
 * `Retry-After`), `logging.test.ts` (three `loginFailed` events, `loginLocked`, `loginSucceeded`,
 * the three `reason`s, one 401 message) and `cms-core-auth-media.test.ts` (`getClientIp(event)`,
 * one 401 message). Each of those would have stayed green with the counter removed from a branch
 * whose literal was still present elsewhere; here the sixth wrong guess has to be a 429.
 */

process.env.LOGIN_CAPTCHA_ENABLED = '0' // the captcha gate (403 after 3 failures) is a separate layer; throttling is on its own
delete process.env.NUXT_LOGIN_CAPTCHA_ENABLED

type Row = Record<string, unknown>
const { users } = await import('../server/db/schema')
const realLogger = await import('../server/utils/logger')

const GOOD_PASSWORD = 'Mat-Khau-Dung-2026'
const accounts: Record<string, Row> = {
  canbo: { id: 7, username: 'canbo', email: null, passwordHash: `hash:${GOOD_PASSWORD}`, isActive: true, roleId: 2, roleName: 'Biên tập', isSystem: false, tokenVersion: 0 },
}
const logs: Array<{ level: string, record: Row }> = []
const completed: Array<{ username: unknown, ip: unknown }> = []

function paramsOf(condition: unknown): unknown[] {
  const found: unknown[] = []
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    if ((node as object).constructor?.name === 'Param') found.push((node as { value: unknown }).value)
    const chunks = (node as { queryChunks?: unknown[] }).queryChunks
    if (Array.isArray(chunks)) chunks.forEach(visit)
  }
  visit(condition)
  return found
}

mock.module('../server/utils/db', {
  namedExports: {
    getPool: () => null,
    getDb: () => ({
      select: () => {
        const builder = {
          from(table: unknown) { assert.equal(table, users); return builder },
          leftJoin() { return builder },
          where: (condition: unknown) => ({ limit: async () => { const row = accounts[String(paramsOf(condition)[0]).toLowerCase()]; return row ? [row] : [] } }),
        }
        return builder
      },
    }),
  },
})
mock.module('../server/utils/auth', { namedExports: { verifyPassword: async (password: string, hash: string) => hash === `hash:${password}` } })
mock.module('../server/utils/mfa/session', {
  namedExports: {
    setChallengeCookie: () => undefined,
    completeLogin: async (_event: unknown, user: Row, options: Row) => { completed.push({ username: user.username, ip: options.ip }); return { ok: true } },
  },
})
mock.module('../server/utils/mfa/factors', { namedExports: { factorAvailability: async () => ({ active: false, usable: [] }), countUnusedRecoveryCodes: async () => 0 } })
mock.module('../server/utils/logger', {
  namedExports: {
    ...realLogger,
    logInfo: (record: Row) => { logs.push({ level: 'info', record }) },
    logWarn: (record: Row) => { logs.push({ level: 'warn', record }) },
  },
})

type FakeEvent = { body: unknown, headers: Record<string, unknown>, context: Record<string, unknown>, node: { req: { headers: Record<string, string>, socket: { remoteAddress: string } } } }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: FakeEvent) => event.body
globals.createError = (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input)
globals.setResponseHeader = (event: FakeEvent, name: string, value: unknown) => { event.headers[name] = value }

const login = (await import('../server/api/admin/auth/login.post')).default as unknown as (event: FakeEvent) => Promise<Row>
const { SECURITY_EVENTS } = realLogger

const PROXY = '127.0.0.1' // loopback is always a listed proxy
const STRANGER = '203.0.113.9' // reached the app directly

interface Outcome { status: number, statusMessage: string, data: unknown, retryAfter: unknown, result: Row | null, event: FakeEvent }
async function attempt(username: string, password: string, from: { peer?: string, forwardedFor?: string } = {}): Promise<Outcome> {
  const headers: Record<string, string> = {}
  if (from.forwardedFor) headers['x-forwarded-for'] = from.forwardedFor
  const event: FakeEvent = { body: { username, password }, headers: {}, context: {}, node: { req: { headers, socket: { remoteAddress: from.peer ?? PROXY } } } }
  try {
    const result = await login(event)
    return { status: 200, statusMessage: '', data: undefined, retryAfter: undefined, result, event }
  } catch (error) {
    const e = error as { statusCode: number, statusMessage: string, data?: unknown }
    return { status: e.statusCode, statusMessage: e.statusMessage, data: e.data, retryAfter: event.headers['Retry-After'], result: null, event }
  }
}
const visitor = (n: number) => ({ forwardedFor: `192.0.2.${n}` })
// Each test names its own accounts, so the process-wide in-memory counters never carry over.
let sequence = 0
const fresh = (kind: 'good' | 'disabled' | 'unknown') => {
  const username = `${kind}${++sequence}`
  if (kind === 'good') accounts[username] = { ...accounts.canbo, username, passwordHash: `hash:${GOOD_PASSWORD}` }
  if (kind === 'disabled') accounts[username] = { ...accounts.canbo, username, isActive: false }
  return username
}

beforeEach(() => {
  logs.length = 0
  completed.length = 0
})

test('the three 401 branches (no such user, disabled account, wrong password) answer byte for byte alike', async () => {
  const answers = [
    await attempt(fresh('unknown'), 'whatever-password'),
    await attempt(fresh('disabled'), GOOD_PASSWORD),
    await attempt(fresh('good'), 'sai-mat-khau-roi'),
  ]
  for (const answer of answers) assert.equal(answer.status, 401)
  assert.equal(new Set(answers.map(a => JSON.stringify({ message: a.statusMessage, data: a.data }))).size, 1, 'the response must not tell the caller which branch it was')
})

test('every failure branch counts: five wrong guesses and the sixth is 429 with Retry-After, whichever branch it was', async () => {
  for (const kind of ['unknown', 'disabled', 'good'] as const) {
    const username = fresh(kind)
    for (let n = 0; n < 5; n++) {
      assert.equal((await attempt(username, 'sai-mat-khau-roi', visitor(10))).status, 401, `${kind} guess ${n + 1}`)
    }
    // even the right password is refused once the source is locked out for this account
    const locked = await attempt(username, GOOD_PASSWORD, visitor(10))
    assert.equal(locked.status, 429, `${kind}: sixth attempt`)
    assert.ok(Number.isInteger(locked.retryAfter) && (locked.retryAfter as number) >= 1 && (locked.retryAfter as number) <= 15 * 60, `${kind}: Retry-After is a delay in seconds, got ${String(locked.retryAfter)}`)
    assert.deepEqual(completed, [], `${kind}: no session was issued to a locked-out source`)
  }
})

test('the per-source bucket is per address AND account; the per-account bucket (15) catches a spread-out guesser', async () => {
  const username = fresh('good')
  for (let n = 0; n < 5; n++) await attempt(username, 'sai-1', visitor(21))
  assert.equal((await attempt(username, 'sai-1', visitor(21))).status, 429, 'address 21 is locked out for this account')
  assert.equal((await attempt(fresh('good'), 'sai-1', visitor(21))).status, 401, 'but not for another account')
  assert.equal((await attempt(username, 'sai-1', visitor(22))).status, 401, 'and another address is not locked by it')

  // addresses 22 and 23 take the account's total to 15 (5 + 5 + 5, the first 5 already counted from 21)
  for (let n = 0; n < 4; n++) await attempt(username, 'sai-1', visitor(22))
  for (let n = 0; n < 5; n++) await attempt(username, 'sai-1', visitor(23))
  const spread = await attempt(username, GOOD_PASSWORD, visitor(24))
  assert.equal(spread.status, 429, 'a fresh address is refused once the account has taken 15 wrong guesses')
  assert.equal(logs.filter(l => l.record.event === SECURITY_EVENTS.loginLocked).at(-1)?.record.scope, 'account')
})

test('user names are folded: changing the case does not open a fresh bucket', async () => {
  const username = fresh('good')
  for (let n = 0; n < 5; n++) await attempt(n % 2 ? username.toUpperCase() : username, 'sai-1', visitor(31))
  assert.equal((await attempt(username.toUpperCase(), 'sai-1', visitor(31))).status, 429)
})

test('the bucket belongs to the resolved address: a stranger cannot rotate x-forwarded-for, visitors behind the proxy do not share', async () => {
  const username = fresh('good')
  for (let n = 0; n < 5; n++) assert.equal((await attempt(username, 'sai-1', { peer: STRANGER, forwardedFor: `198.51.100.${n}` })).status, 401)
  assert.equal((await attempt(username, 'sai-1', { peer: STRANGER, forwardedFor: '198.51.100.99' })).status, 429, 'forged header rotation bought nothing')

  const other = fresh('good')
  for (let n = 0; n < 5; n++) await attempt(other, 'sai-1', visitor(41))
  assert.equal((await attempt(other, 'sai-1', visitor(41))).status, 429)
  assert.equal((await attempt(other, 'sai-1', visitor(42))).status, 401, 'a second visitor through the same proxy has their own bucket')
})

test('a successful login clears the counters, and the session is issued for the resolved address', async () => {
  const username = fresh('good')
  for (let n = 0; n < 4; n++) await attempt(username, 'sai-1', visitor(51))
  const ok = await attempt(username, GOOD_PASSWORD, visitor(51))
  assert.equal(ok.status, 200)
  assert.deepEqual(completed, [{ username, ip: '192.0.2.51' }])
  for (let n = 0; n < 5; n++) assert.equal((await attempt(username, 'sai-1', visitor(51))).status, 401, `guess ${n + 1} after the reset`)
})

test('every branch leaves a structured log line the operator can tell apart, and none of them holds the password', async () => {
  await attempt(fresh('unknown'), 'mat-khau-bi-lo-1', visitor(61))
  await attempt(fresh('disabled'), 'mat-khau-bi-lo-2', visitor(61))
  const bad = fresh('good')
  await attempt(bad, 'mat-khau-bi-lo-3', visitor(61))
  const failed = logs.filter(l => l.record.event === SECURITY_EVENTS.loginFailed)
  assert.deepEqual(failed.map(l => l.record.reason), ['unknown_user', 'account_disabled', 'bad_password'])
  assert.ok(failed.every(l => l.level === 'warn' && l.record.ip === '192.0.2.61'))

  for (let n = 0; n < 4; n++) await attempt(bad, 'sai-1', visitor(61))
  await attempt(bad, GOOD_PASSWORD, visitor(61))
  const locked = logs.filter(l => l.record.event === SECURITY_EVENTS.loginLocked)
  assert.equal(locked.length, 1)
  assert.equal(locked[0]!.record.scope, 'source')

  const success = fresh('good')
  await attempt(success, GOOD_PASSWORD, visitor(62))
  const succeeded = logs.filter(l => l.record.event === SECURITY_EVENTS.loginSucceeded)
  assert.equal(succeeded.length, 1)
  assert.equal(succeeded[0]!.level, 'info')
  assert.equal(succeeded[0]!.record.username, success)

  assert.ok(!JSON.stringify(logs).includes('mat-khau-bi-lo'), 'a guessed password never reaches the log')
  assert.ok(!JSON.stringify(logs).includes(GOOD_PASSWORD))
})
