import assert from 'node:assert/strict'
import test, { beforeEach, mock } from 'node:test'

/**
 * Bật yếu tố đầu tiên dưới một chính sách MFA khác `off` phải phát mã dự phòng
 * trong CÙNG lượt (spec admin-mfa-policy, quyết định D1 — "mã dự phòng bắt buộc").
 *
 * Lý do: khi chính sách bắt buộc, mất điện thoại = mất quyền vào trang quản trị.
 * Mã dự phòng là lối về duy nhất không cần SuperAdmin can thiệp, và trước đây nó
 * là một bước tuỳ chọn mà người ta hay bỏ qua.
 *
 * Chạy THẬT `server/api/admin/profile/mfa/confirm.post.ts` + `utils/mfa/policy.ts`
 * + `utils/mfa/recovery-codes.ts` + `utils/mfa/codes.ts` (bcrypt thật), trên một
 * CSDL giả trong bộ nhớ theo bảng.
 */

process.env.JWT_SECRET = 'mfa-enrollment-recovery-test-secret-0123456789'
delete process.env.MFA_ENFORCEMENT

const schema = await import('../server/db/schema')
const { settings, users, userMfaFactors, userRecoveryCodes, activityLogs } = schema

type Factor = { id: number, userId: number, factorType: string, state: string, passwordHash: string | null, pendingExpiresAt: Date | null, [key: string]: unknown }
let store = new Map<string, string>()
let factors: Factor[] = []
let recovery: Array<{ userId: number, codeHash: string, batchId: string, usedAt: Date | null }> = []
let audit: Array<Record<string, unknown>> = []
let cookies: Array<Record<string, unknown>> = []
let tokenVersion = 0

function rowsOf(table: unknown, projection?: Record<string, unknown>): unknown[] {
  if (table === settings) return [...store].map(([key, value]) => ({ key, value }))
  if (table === userMfaFactors) return factors
  if (table === userRecoveryCodes) {
    const unused = recovery.filter(row => row.usedAt === null)
    return projection && 'total' in projection ? [{ total: unused.length }] : unused
  }
  if (table === users) return [{ tokenVersion }]
  return []
}

function chain(rows: () => unknown[], limited: () => unknown[] = rows) {
  const node = {
    where: () => node,
    leftJoin: () => node,
    limit: async () => limited(),
    then: (resolve: (value: unknown[]) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(rows()).then(resolve, reject),
  }
  return node
}

const db = {
  select: (projection?: Record<string, unknown>) => ({
    from: (table: unknown) => (table === userMfaFactors
      // The handler's `getFactor` (limit 1) asks for the factor being confirmed.
      ? chain(() => factors, () => factors.filter(row => row.state === 'pending'))
      : chain(() => rowsOf(table, projection))),
  }),
  update: (table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: async () => {
        if (table === userMfaFactors) {
          const pending = factors.find(row => row.state === 'pending')
          if (!pending) return [{ affectedRows: 0 }, []]
          Object.assign(pending, values)
          return [{ affectedRows: 1 }, []]
        }
        if (table === users) { tokenVersion += 1; return [{ affectedRows: 1 }, []] }
        return [{ affectedRows: 0 }, []]
      },
    }),
  }),
  insert: (table: unknown) => ({
    values: async (value: unknown) => {
      if (table === activityLogs) audit.push(value as Record<string, unknown>)
      if (table === userRecoveryCodes) recovery.push(...(value as typeof recovery).map(row => ({ ...row, usedAt: null })))
    },
  }),
  delete: (table: unknown) => ({
    where: async () => { if (table === userRecoveryCodes) recovery = [] },
  }),
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
}

mock.module('../server/utils/db', { namedExports: { getDb: () => db } })
mock.module('../server/utils/logger', { namedExports: { logInfo: () => {}, logWarn: () => {}, logError: () => {}, SECURITY_EVENTS: { mfaFactorEnabled: 'auth.mfa_factor_enabled' } } })
mock.module('../server/utils/client-ip', { namedExports: { getClientIp: () => '127.0.0.1' } })
mock.module('../server/utils/mfa/session', { namedExports: { setSessionCookie: (_event: unknown, user: Record<string, unknown>) => { cookies.push(user) } } })

Object.assign(globalThis, {
  defineEventHandler: (handler: unknown) => handler,
  readBody: async (event: { body?: unknown }) => event.body,
  createError: (options: { statusMessage: string }) => Object.assign(new Error(options.statusMessage), options),
})

const { hashPassword } = await import('../server/utils/auth')
const { verifyOneTimeCode, normalizeRecoveryCode, RECOVERY_CODE_COUNT } = await import('../server/utils/mfa/codes')
const policy = await import('../server/utils/mfa/policy')
const confirm = (await import('../server/api/admin/profile/mfa/confirm.post')).default as unknown as (event: unknown) => Promise<{ ok: boolean, recoveryCodes?: string[], message: string }>

const SECOND_PASSWORD = 'Mat-khau-cap-2-rat-dai!'
const secondPasswordHash = await hashPassword(SECOND_PASSWORD)
const SUPERADMIN = { id: 1, username: 'admin', email: 'a@example.vn', roleId: 1, roleName: 'Quản trị', isSystem: true, isSuperAdmin: true, permissions: [] }
const EDITOR = { id: 7, username: 'editor', email: 'e@example.vn', roleId: 3, roleName: 'Biên tập', isSystem: false, isSuperAdmin: false, permissions: [{ resource: 'news', canUpdate: true }] }

const DAY = 24 * 60 * 60 * 1000
function setPolicy(value: string, enforceAfter: Date | null) {
  store.set('mfa_policy', value)
  store.set('mfa_enforce_after', enforceAfter ? enforceAfter.toISOString() : '')
  policy.clearMfaPolicyCache()
}

function plantPending(userId: number, extra: Factor[] = []) {
  factors = [
    ...extra,
    { id: 99, userId, factorType: 'second_password', state: 'pending', passwordHash: secondPasswordHash, pendingExpiresAt: new Date(Date.now() + 10 * 60 * 1000) },
  ]
}

const confirmAs = (adminUser: unknown) => confirm({ context: { adminUser }, body: { factorType: 'second_password', code: SECOND_PASSWORD } })

beforeEach(() => {
  store = new Map()
  factors = []
  recovery = []
  audit = []
  cookies = []
  tokenVersion = 0
  policy.clearMfaPolicyCache()
  policy.clearMfaFactorCache()
})

test('spec: a covered account confirming its first factor under a policy gets recovery codes in the same response', async () => {
  setPolicy('privileged', new Date(Date.now() + 14 * DAY))
  plantPending(SUPERADMIN.id)
  const response = await confirmAs(SUPERADMIN)

  assert.equal(response.ok, true)
  assert.ok(Array.isArray(response.recoveryCodes), 'no recovery codes in the confirm response')
  assert.equal(response.recoveryCodes!.length, RECOVERY_CODE_COUNT)
  assert.equal(new Set(response.recoveryCodes).size, RECOVERY_CODE_COUNT)

  // Stored hashed, each one redeemable, none stored as itself.
  assert.equal(recovery.length, RECOVERY_CODE_COUNT)
  for (const [index, code] of response.recoveryCodes!.entries()) {
    assert.ok(!recovery.some(row => row.codeHash.includes(normalizeRecoveryCode(code))), 'a code is stored in the clear')
    assert.equal(await verifyOneTimeCode(normalizeRecoveryCode(code), recovery[index]!.codeHash), true)
  }

  // The factor is active, the session was re-issued once (after the bump), and the
  // audit row records only the COUNT of codes.
  assert.equal(factors.find(row => row.id === 99)!.state, 'active')
  assert.equal(cookies.length, 1)
  assert.equal(cookies[0]!.tokenVersion, 1)
  const meta = audit.at(-1)!.meta as Record<string, unknown>
  assert.equal(meta.recoveryCodesGenerated, RECOVERY_CODE_COUNT)
  const auditText = JSON.stringify(audit)
  for (const code of response.recoveryCodes!) assert.ok(!auditText.includes(code), 'a recovery code reached the audit row')
})

test('codes are generated during the grace period too (the policy is on, enforcement has not started)', async () => {
  setPolicy('all', new Date(Date.now() + 3 * DAY))
  plantPending(EDITOR.id)
  const response = await confirmAs(EDITOR)
  assert.equal(response.recoveryCodes?.length, RECOVERY_CODE_COUNT)
})

test('policy off: confirming a factor behaves exactly as before — no codes are minted', async () => {
  plantPending(SUPERADMIN.id)
  const response = await confirmAs(SUPERADMIN)
  assert.equal(response.ok, true)
  assert.equal(response.recoveryCodes, undefined)
  assert.equal(recovery.length, 0)
})

test('an account the policy does not cover gets no codes it did not ask for', async () => {
  setPolicy('privileged', new Date(Date.now() + DAY))
  plantPending(EDITOR.id)
  const response = await confirmAs(EDITOR)
  assert.equal(response.recoveryCodes, undefined)
  assert.equal(recovery.length, 0)
})

test('an existing unused batch is never silently replaced by a later enrollment', async () => {
  setPolicy('all', new Date(Date.now() - DAY))
  plantPending(SUPERADMIN.id, [{ id: 5, userId: SUPERADMIN.id, factorType: 'totp', state: 'active', passwordHash: null, pendingExpiresAt: null }])
  recovery = [{ userId: SUPERADMIN.id, codeHash: 'existing-hash', batchId: 'old', usedAt: null }]
  const response = await confirmAs(SUPERADMIN)
  assert.equal(response.recoveryCodes, undefined)
  assert.deepEqual(recovery.map(row => row.batchId), ['old'], 'the sheet the admin already printed was revoked')
})
