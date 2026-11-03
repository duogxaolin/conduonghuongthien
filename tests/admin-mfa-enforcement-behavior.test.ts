import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import test, { beforeEach, mock } from 'node:test'

/**
 * Chính sách bắt buộc MFA (spec admin-mfa-policy, design D1), chạy THẬT:
 *
 *  - middleware `server/middleware/admin-auth.ts` (chốt cưỡng chế, sau khi nạp
 *    user + quyền), `server/api/admin/auth/me.get.ts` (hai trường báo giao diện),
 *  - endpoint SuperAdmin `server/api/admin/security/mfa-policy.{get,put}.ts` và
 *    service ghi chính sách + dòng audit trong CÙNG transaction,
 *  - `settings/index.put.ts` để chứng minh khoá chính sách không ghi được qua
 *    đường cài đặt chung.
 *
 * CSDL là bản giả trong bộ nhớ theo bảng; transaction chỉ áp ghi khi callback
 * xong, và mọi lượt ghi trên pool bị ném lỗi — nên "audit cùng transaction" là
 * điều được kiểm, không phải giả định.
 */

process.env.JWT_SECRET = 'admin-mfa-enforcement-test-secret-0123456789'
delete process.env.MFA_ENFORCEMENT

mock.module('../server/utils/logger', {
  namedExports: {
    logWarn: () => {},
    logInfo: () => {},
    logError: () => {},
    SECURITY_EVENTS: { mfaChallengeFailed: 'auth.mfa_challenge_failed', sessionRevoked: 'auth.session_revoked' },
  },
})

const schema = await import('../server/db/schema')
const { users, permissions, settings, userMfaFactors, activityLogs } = schema

type Perm = { resource: string, canCreate?: boolean, canRead?: boolean, canUpdate?: boolean, canDelete?: boolean }
type Account = { id: number, username: string, email: string, isActive: boolean, roleId: number, roleName: string, isSystem: boolean, tokenVersion: number }

const SUPERADMIN: Account = { id: 1, username: 'admin', email: 'a@example.vn', isActive: true, roleId: 1, roleName: 'Quản trị hệ thống', isSystem: true, tokenVersion: 0 }
const EDITOR: Account = { id: 7, username: 'editor', email: 'e@example.vn', isActive: true, roleId: 3, roleName: 'Biên tập viên', isSystem: false, tokenVersion: 0 }
const SETTINGS_EDITOR: Account = { id: 8, username: 'settings', email: 's@example.vn', isActive: true, roleId: 4, roleName: 'Cấu hình', isSystem: false, tokenVersion: 0 }

const ROLE_PERMS: Record<number, Perm[]> = {
  1: [],
  3: [{ resource: 'news', canRead: true, canUpdate: true }],
  4: [{ resource: 'settings', canRead: true, canUpdate: true }],
}

let accounts: Account[] = []
let current: Account | null = null
let store = new Map<string, string | null>()
let factors: Array<{ userId: number, state: 'active' | 'pending' }> = []
let audit: Array<Record<string, unknown>> = []

/**
 * `all` answers an unfiltered read, `filtered` a read with `where(...)` (the fake
 * cannot evaluate the condition, so each table says what the middleware's filter
 * means), `one` a `.limit(1)` lookup.
 */
function query(all: () => unknown[], one: () => unknown[] = all, filtered: () => unknown[] = all) {
  let rows = all
  const chain = {
    leftJoin: () => chain,
    innerJoin: () => chain,
    where: () => { rows = filtered; return chain },
    orderBy: () => chain,
    limit: () => Promise.resolve(one()),
    then: (resolve: (value: unknown[]) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(rows()).then(resolve, reject),
  }
  return chain
}

const grantsOf = (roleId: number) => (ROLE_PERMS[roleId] ?? []).map(p => ({ roleId, ...p }))

function selectFrom(table: unknown) {
  if (table === users) return query(() => accounts, () => (current ? [current] : []))
  if (table === permissions) {
    return query(() => Object.keys(ROLE_PERMS).flatMap(roleId => grantsOf(Number(roleId))), undefined, () => (current ? grantsOf(current.roleId) : []))
  }
  if (table === settings) return query(() => [...store].map(([key, value]) => ({ key, value })))
  if (table === userMfaFactors) return query(() => factors.filter(row => row.userId === current?.id))
  return query(() => [])
}

function makeTx(pending: Array<() => void>) {
  return {
    select: () => ({ from: selectFrom }),
    insert: (table: unknown) => ({
      values: (value: Record<string, unknown>) => {
        if (table === activityLogs) {
          pending.push(() => audit.push(value))
          return Promise.resolve()
        }
        const apply = () => store.set(String(value.key), value.value === null ? null : String(value.value))
        return { onDuplicateKeyUpdate: async () => { pending.push(apply) } }
      },
    }),
    delete: () => ({ where: async () => {} }),
  }
}

mock.module('../server/utils/db', {
  namedExports: {
    getDb: () => ({
      select: () => ({ from: selectFrom }),
      insert: () => { throw new Error('write on the pool, outside the transaction') },
      update: () => { throw new Error('write on the pool, outside the transaction') },
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const pending: Array<() => void> = []
        const result = await fn(makeTx(pending))
        for (const apply of pending) apply()
        return result
      },
    }),
  },
})

type Event = { url: string, path: string, method: string, cookies: Record<string, string>, body?: unknown, context: Record<string, unknown> }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.getRequestURL = (event: Event) => new URL(event.url, 'http://localhost')
globals.getCookie = (event: Event, name: string) => event.cookies[name]
globals.readBody = async (event: Event) => event.body
globals.createError = (input: { statusCode: number, statusMessage: string, data?: unknown }) => Object.assign(new Error(input.statusMessage), input)
// `mfa-policy.put.ts` reads its body through `readValidated` (wave2 5.2). Its real
// byte-level reading runs in a real h3 app in tests/mfa-policy-endpoint-body.test.ts;
// here the fake event carries the parsed body, checked by the endpoint's own schema.
mock.module('../server/utils/request-body', {
  namedExports: {
    readValidated: async (event: Event, schema: { safeParse: (input: unknown) => { success: boolean, data?: unknown, error?: { issues: Array<{ message?: string }> } } }) => {
      const result = schema.safeParse(event.body)
      if (result.success) return result.data
      throw Object.assign(new Error('invalid body'), { statusCode: 400, statusMessage: result.error?.issues[0]?.message ?? 'Dữ liệu gửi lên không hợp lệ' })
    },
  },
})

const { signToken } = await import('../server/utils/auth')
const middleware = (await import('../server/middleware/admin-auth')).default as unknown as (event: Event) => Promise<void>
const me = (await import('../server/api/admin/auth/me.get')).default as unknown as (event: Event) => Promise<{ user: Record<string, unknown> }>
const policyPut = (await import('../server/api/admin/security/mfa-policy.put')).default as unknown as (event: Event) => Promise<Record<string, unknown>>
const policyGet = (await import('../server/api/admin/security/mfa-policy.get')).default as unknown as (event: Event) => Promise<Record<string, unknown>>
const settingsPut = (await import('../server/api/admin/settings/index.put')).default as unknown as (event: Event) => Promise<unknown>
const { SETTINGS_READ_KEYS } = await import('../server/api/admin/settings/index.get')
const policy = await import('../server/utils/mfa/policy')

const tokenFor = (account: Account) => signToken({ userId: account.id, username: account.username, roleId: account.roleId, roleName: account.roleName, tokenVersion: account.tokenVersion })
const eventFor = (account: Account, url: string, method = 'GET', body?: unknown): Event => ({ url, path: url, method, body, cookies: { cdkt_admin: tokenFor(account) }, context: {} })

async function run(account: Account, url: string, method = 'GET'): Promise<{ status: number | null, code?: unknown, event: Event }> {
  current = account
  const event = eventFor(account, url, method)
  try {
    await middleware(event)
    return { status: null, event }
  } catch (error) {
    const failure = error as { statusCode?: number, data?: { code?: unknown } }
    return { status: failure.statusCode ?? -1, code: failure.data?.code, event }
  }
}

const DAY = 24 * 60 * 60 * 1000
function setPolicy(value: string, enforceAfter: Date | null) {
  store.set('mfa_policy', value)
  store.set('mfa_enforce_after', enforceAfter ? enforceAfter.toISOString() : '')
  policy.clearMfaPolicyCache()
}

beforeEach(() => {
  accounts = [SUPERADMIN, EDITOR, SETTINGS_EDITOR].map(account => ({ ...account }))
  current = null
  store = new Map()
  factors = []
  audit = []
  delete process.env.MFA_ENFORCEMENT
  policy.clearMfaPolicyCache()
  policy.clearMfaFactorCache()
})

// ─── Default: off ─────────────────────────────────────────────────────────────

test('policy off (the default, no rows): nothing changes for anyone, me reports nothing', async () => {
  for (const account of [SUPERADMIN, EDITOR]) {
    const result = await run(account, '/api/admin/users')
    assert.equal(result.status, null)
    const { user } = await me(result.event)
    assert.equal(user.mfaEnrollmentRequired, false)
    assert.equal(user.mfaEnforceAfter, null)
  }
})

// ─── Grace period ─────────────────────────────────────────────────────────────

test('before grace ends: a covered account without a factor is allowed and told the date', async () => {
  const start = new Date(Date.now() + 3 * DAY)
  setPolicy('privileged', start)
  const result = await run(SUPERADMIN, '/api/admin/users')
  assert.equal(result.status, null)
  const { user } = await me(result.event)
  assert.equal(user.mfaEnrollmentRequired, false)
  assert.equal(user.mfaEnforceAfter, start.toISOString())
})

// ─── After grace ──────────────────────────────────────────────────────────────

test('spec: after grace, a SuperAdmin without a factor gets 403 mfa_enrollment_required on GET /api/admin/users', async () => {
  setPolicy('privileged', new Date(Date.now() - DAY))
  const result = await run(SUPERADMIN, '/api/admin/users')
  assert.equal(result.status, 403)
  assert.equal(result.code, 'mfa_enrollment_required')
})

test('spec: enrollment stays reachable — session, logout, password and every MFA enrollment endpoint', async () => {
  setPolicy('privileged', new Date(Date.now() - DAY))
  for (const url of [
    '/api/admin/auth/me',
    '/api/admin/auth/logout',
    '/api/admin/profile/password',
    '/api/admin/profile/mfa',
    '/api/admin/profile/mfa/enroll',
    '/api/admin/profile/mfa/confirm',
    '/api/admin/profile/mfa/recovery-codes',
    '/api/admin/profile/mfa?x=1',
  ]) {
    const result = await run(SUPERADMIN, url, url.endsWith('/me') || url.includes('/mfa?') ? 'GET' : 'POST')
    assert.equal(result.status, null, `${url} was refused`)
  }
  const { user } = await me((await run(SUPERADMIN, '/api/admin/auth/me')).event)
  assert.equal(user.mfaEnrollmentRequired, true)
})

test('every endpoint file under profile/mfa/ is on the allowlist (a new enrollment step cannot be locked out by accident)', async () => {
  setPolicy('all', new Date(Date.now() - DAY))
  const files = readdirSync(new URL('../server/api/admin/profile/mfa/', import.meta.url)).filter(name => name.endsWith('.ts'))
  assert.ok(files.length >= 5)
  for (const file of files) {
    const route = file.replace(/\.(get|post|put|delete|patch)\.ts$/, '').replace(/^index$/, '')
    const url = `/api/admin/profile/mfa${route ? `/${route}` : ''}`
    assert.equal((await run(SUPERADMIN, url, 'POST')).status, null, `${url} (${file}) is not reachable during enforcement`)
  }
})

test('the allowlist is matched on every decoded spelling — traversal and fragments do not ride it', async () => {
  setPolicy('privileged', new Date(Date.now() - DAY))
  for (const url of [
    '/api/admin/profile/mfa/../../users',
    '/api/admin/profile/mfa/enroll/%2e%2e/%2e%2e/%2e%2e/users',
    '/api/admin/auth/me#/../users',
    '/api/admin/auth/me%23x',
    '/api/admin/profile/mfa/enrollx',
    '/api/admin/profile/passwords',
  ]) {
    assert.equal((await run(SUPERADMIN, url, 'POST')).status, 403, `${url} rode the enrollment allowlist`)
  }
})

test('an account with an active factor is not affected', async () => {
  setPolicy('all', new Date(Date.now() - DAY))
  factors = [{ userId: SUPERADMIN.id, state: 'active' }]
  assert.equal((await run(SUPERADMIN, '/api/admin/users')).status, null)
  const { user } = await me((await run(SUPERADMIN, '/api/admin/auth/me')).event)
  assert.equal(user.mfaEnrollmentRequired, false)
  assert.equal(user.mfaEnforceAfter, null)
})

test('a pending (unconfirmed) factor does not count', async () => {
  setPolicy('all', new Date(Date.now() - DAY))
  factors = [{ userId: SUPERADMIN.id, state: 'pending' }]
  assert.equal((await run(SUPERADMIN, '/api/admin/users')).status, 403)
})

test('enrolling takes effect on the very next request (the factor cache is keyed on tokenVersion)', async () => {
  setPolicy('all', new Date(Date.now() - DAY))
  assert.equal((await run(SUPERADMIN, '/api/admin/users')).status, 403)
  // confirm.post.ts activates the factor and bumps tokenVersion, re-issuing the cookie.
  factors = [{ userId: SUPERADMIN.id, state: 'active' }]
  const enrolled = { ...SUPERADMIN, tokenVersion: 1 }
  accounts = accounts.map(account => (account.id === enrolled.id ? enrolled : account))
  assert.equal((await run(enrolled, '/api/admin/users')).status, null)
})

test('spec: kill switch MFA_ENFORCEMENT=0 lets the same request through', async () => {
  setPolicy('privileged', new Date(Date.now() - DAY))
  for (const value of ['0', 'false', 'off']) {
    process.env.MFA_ENFORCEMENT = value
    const result = await run(SUPERADMIN, '/api/admin/users')
    assert.equal(result.status, null, `MFA_ENFORCEMENT=${value} did not switch enforcement off`)
    const { user } = await me(result.event)
    assert.equal(user.mfaEnrollmentRequired, false)
  }
  process.env.MFA_ENFORCEMENT = '1'
  assert.equal((await run(SUPERADMIN, '/api/admin/users')).status, 403)
})

// ─── Coverage ─────────────────────────────────────────────────────────────────

test('privileged covers SuperAdmin and update/delete on users, roles or settings — not a news editor', async () => {
  setPolicy('privileged', new Date(Date.now() - DAY))
  assert.equal((await run(SUPERADMIN, '/api/admin/news')).status, 403)
  assert.equal((await run(SETTINGS_EDITOR, '/api/admin/news')).status, 403)
  assert.equal((await run(EDITOR, '/api/admin/news')).status, null)
  setPolicy('all', new Date(Date.now() - DAY))
  assert.equal((await run(EDITOR, '/api/admin/news')).status, 403)
})

test('isPrivilegedAccount reads update/delete only — read access is not privileged', () => {
  assert.equal(policy.isPrivilegedAccount({ permissions: [{ resource: 'users', canUpdate: false, canDelete: false }] }), false)
  assert.equal(policy.isPrivilegedAccount({ permissions: [{ resource: 'roles', canDelete: true }] }), true)
  assert.equal(policy.isPrivilegedAccount({ permissions: [{ resource: 'news', canUpdate: true, canDelete: true }] }), false)
  assert.equal(policy.isPrivilegedAccount({ isSuperAdmin: true, permissions: [] }), true)
})

// ─── The SuperAdmin endpoint ──────────────────────────────────────────────────

test('spec: a non-SuperAdmin with settings.update gets 403 and the policy is unchanged', async () => {
  current = SETTINGS_EDITOR
  const event = eventFor(SETTINGS_EDITOR, '/api/admin/security/mfa-policy', 'PUT', { policy: 'all' })
  await middleware(event)
  await assert.rejects(policyPut(event), (error: { statusCode?: number }) => error.statusCode === 403)
  await assert.rejects(policyGet(eventFor(SETTINGS_EDITOR, '/api/admin/security/mfa-policy')), (error: { statusCode?: number }) => error.statusCode !== undefined)
  assert.equal(store.has('mfa_policy'), false)
  assert.equal(audit.length, 0)
})

test('a SuperAdmin turns the policy on: enforcement starts 14 days later, audited in the same transaction', async () => {
  current = SUPERADMIN
  const event = eventFor(SUPERADMIN, '/api/admin/security/mfa-policy', 'PUT', { policy: 'privileged' })
  await middleware(event)
  const before = Date.now()
  const response = await policyPut(event)
  assert.equal(response.policy, 'privileged')
  assert.equal(store.get('mfa_policy'), 'privileged')
  const start = new Date(String(store.get('mfa_enforce_after'))).getTime()
  assert.ok(start >= before + 14 * DAY - 1000 && start <= Date.now() + 14 * DAY + 1000, 'enforcement start is not now + 14 days')
  assert.equal(audit.length, 1)
  assert.deepEqual((audit[0]!.meta as Record<string, unknown>).mfaPolicy, { from: 'off', to: 'privileged' })
  assert.equal(audit[0]!.userId, SUPERADMIN.id)

  // The next admin request sees the new policy at once (cache cleared after commit).
  const next = await run(SUPERADMIN, '/api/admin/auth/me')
  assert.equal((await me(next.event)).user.mfaEnforceAfter, new Date(start).toISOString())
})

test('turning the policy off clears the enforcement start; an unknown value is 400 and writes nothing', async () => {
  setPolicy('all', new Date(Date.now() - DAY))
  factors = [{ userId: SUPERADMIN.id, state: 'active' }]
  current = SUPERADMIN
  const off = eventFor(SUPERADMIN, '/api/admin/security/mfa-policy', 'PUT', { policy: 'off' })
  await middleware(off)
  await policyPut(off)
  assert.equal(store.get('mfa_policy'), 'off')
  assert.equal(store.get('mfa_enforce_after'), '')

  const bad = eventFor(SUPERADMIN, '/api/admin/security/mfa-policy', 'PUT', { policy: 'everyone' })
  await middleware(bad)
  const auditBefore = audit.length
  await assert.rejects(policyPut(bad), (error: { statusCode?: number }) => error.statusCode === 400)
  assert.equal(audit.length, auditBefore)
  assert.equal(store.get('mfa_policy'), 'off')
})

test('GET reports the policy, the grace length, the kill switch and who would be locked out', async () => {
  setPolicy('privileged', new Date(Date.now() + DAY))
  factors = []
  current = SUPERADMIN
  const event = eventFor(SUPERADMIN, '/api/admin/security/mfa-policy')
  await middleware(event)
  const response = await policyGet(event)
  assert.equal(response.policy, 'privileged')
  assert.equal(response.graceDays, 14)
  assert.equal(response.killSwitch, false)
  const without = response.withoutFactor as { privileged: Array<{ username: string }>, all: Array<{ username: string }> }
  assert.deepEqual(without.privileged.map(row => row.username).sort(), ['admin', 'settings'])
  assert.deepEqual(without.all.map(row => row.username).sort(), ['admin', 'editor', 'settings'])
})

test('spec: the policy keys are not writable through the general settings update, nor readable through it', async () => {
  current = SUPERADMIN
  const event = eventFor(SUPERADMIN, '/api/admin/settings', 'PUT', { settings: { mfa_policy: 'off', mfa_enforce_after: '' } })
  await middleware(event)
  setPolicy('all', new Date(Date.now() + DAY))
  await assert.rejects(settingsPut(event), (error: { statusCode?: number }) => error.statusCode === 400)
  assert.equal(store.get('mfa_policy'), 'all')
  assert.ok(!SETTINGS_READ_KEYS.includes('mfa_policy') && !SETTINGS_READ_KEYS.includes('mfa_enforce_after'))
})
