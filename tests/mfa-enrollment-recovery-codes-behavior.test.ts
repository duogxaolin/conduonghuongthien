import assert from 'node:assert/strict'
import test, { beforeEach, mock } from 'node:test'
import type { SQL } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'

/**
 * Bật yếu tố đầu tiên dưới một chính sách MFA khác `off` phải phát mã dự phòng
 * trong CÙNG lượt (spec admin-mfa-policy, quyết định D1 — "mã dự phòng bắt buộc").
 *
 * Lý do: khi chính sách bắt buộc, mất điện thoại = mất quyền vào trang quản trị.
 * Mã dự phòng là lối về duy nhất không cần SuperAdmin can thiệp, và trước đây nó
 * là một bước tuỳ chọn mà người ta hay bỏ qua.
 *
 * Bật yếu tố và phát mã là MỘT việc (kiểm chứng độc lập 2A, W1): phát mã hỏng →
 * lượt xác nhận hỏng, yếu tố vẫn `pending` để thử lại; hai lượt xác nhận đồng thời
 * không bao giờ thay một lô đang dùng.
 *
 * Chạy THẬT `server/api/admin/profile/mfa/confirm.post.ts` + `utils/mfa/policy.ts`
 * + `utils/mfa/recovery-codes.ts` + `utils/mfa/codes.ts` (bcrypt thật), trên một
 * CSDL giả trong bộ nhớ: điều kiện WHERE được biên dịch bằng `MySqlDialect` để giả
 * lập đúng hàng; transaction hoàn tác khi ném; `SELECT … FOR UPDATE` trên `users`
 * giữ khoá theo tài khoản tới hết transaction (như InnoDB).
 */

process.env.JWT_SECRET = 'mfa-enrollment-recovery-test-secret-0123456789'
delete process.env.MFA_ENFORCEMENT

const schema = await import('../server/db/schema')
const { settings, users, userMfaFactors, userRecoveryCodes, activityLogs } = schema

type Factor = { id: number, userId: number, factorType: string, state: string, passwordHash: string | null, pendingExpiresAt: Date | null, [key: string]: unknown }
type CodeRow = { userId: number, codeHash: string, batchId: string, usedAt: Date | null }
let store = new Map<string, string>()
let factors: Factor[] = []
let recovery: CodeRow[] = []
let audit: Array<Record<string, unknown>> = []
let cookies: Array<Record<string, unknown>> = []
let tokenVersion = 0
/** Inject a failure into the next recovery-code INSERT. */
let failCodeInsert = false
/** Hold every recovery-code INSERT this long — lets two requests interleave. */
let pauseBeforeCodeInsert = 0

const dialect = new MySqlDialect()
const paramsOf = (condition?: SQL) => (condition ? dialect.sqlToQuery(condition).params : [])

/** Per-account row locks held by open transactions. */
const locks = new Map<number, Promise<void>>()
async function acquireLock(userId: number): Promise<() => void> {
  while (locks.has(userId)) await locks.get(userId)
  let release!: () => void
  locks.set(userId, new Promise<void>((resolve) => { release = resolve }))
  return () => { locks.delete(userId); release() }
}

type Context = { undo?: Array<() => void>, releases?: Array<() => void> }

function executor(context: Context) {
  const remember = (undo: () => void) => { context.undo?.push(undo) }
  return {
    select: (projection?: Record<string, unknown>) => ({
      from: (table: unknown) => {
        let condition: SQL | undefined
        let forUpdate = false
        const rows = (): unknown[] => {
          const params = paramsOf(condition)
          if (table === settings) return [...store].map(([key, value]) => ({ key, value }))
          if (table === userMfaFactors) {
            return factors.filter(row => row.userId === params[0] && (typeof params[1] !== 'string' || row.factorType === params[1]))
          }
          if (table === userRecoveryCodes) {
            const unused = recovery.filter(row => row.userId === params[0] && row.usedAt === null)
            return projection && 'total' in projection ? [{ total: unused.length }] : unused
          }
          if (table === users) return [{ id: params[0], tokenVersion }]
          return []
        }
        const node = {
          where: (next?: SQL) => { condition = next; return node },
          leftJoin: () => node,
          limit: () => node,
          for: () => { forUpdate = true; return node },
          then: (resolve: (value: unknown[]) => unknown, reject?: (error: unknown) => unknown) => (async () => {
            if (forUpdate && table === users && context.releases) {
              context.releases.push(await acquireLock(Number(paramsOf(condition)[0])))
            }
            return rows()
          })().then(resolve, reject),
        }
        return node
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async (condition?: SQL) => {
          if (table === userMfaFactors) {
            // `pendingSnapshot` opens with `eq(id, row.id)`.
            const id = paramsOf(condition)[0]
            const row = factors.find(candidate => candidate.id === id && candidate.state === 'pending')
            if (!row) return [{ affectedRows: 0 }, []]
            const before = { ...row }
            Object.assign(row, values)
            remember(() => { Object.assign(row, before) })
            return [{ affectedRows: 1 }, []]
          }
          if (table === users) {
            tokenVersion += 1
            remember(() => { tokenVersion -= 1 })
            return [{ affectedRows: 1 }, []]
          }
          return [{ affectedRows: 0 }, []]
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: async (value: unknown) => {
        if (table === activityLogs) audit.push(value as Record<string, unknown>)
        if (table === userRecoveryCodes) {
          if (pauseBeforeCodeInsert) await new Promise(resolve => setTimeout(resolve, pauseBeforeCodeInsert))
          if (failCodeInsert) { failCodeInsert = false; throw new Error('simulated recovery-code insert failure') }
          const added = (value as CodeRow[]).map(row => ({ ...row, usedAt: null }))
          recovery.push(...added)
          remember(() => { recovery = recovery.filter(row => !added.includes(row)) })
        }
      },
    }),
    delete: (table: unknown) => ({
      where: async (condition?: SQL) => {
        if (table !== userRecoveryCodes) return
        const userId = paramsOf(condition)[0]
        const before = recovery
        recovery = recovery.filter(row => row.userId !== userId)
        remember(() => { recovery = before })
      },
    }),
  }
}

const db = {
  ...executor({}),
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const context: Required<Context> = { undo: [], releases: [] }
    try {
      return await fn(executor(context))
    } catch (error) {
      for (const undo of context.undo.reverse()) undo()
      throw error
    } finally {
      for (const release of context.releases) release()
    }
  },
}

mock.module('../server/utils/db', { namedExports: { getDb: () => db } })
mock.module('../server/utils/logger', { namedExports: { logInfo: () => {}, logWarn: () => {}, logError: () => {}, SECURITY_EVENTS: { mfaFactorEnabled: 'auth.mfa_factor_enabled' } } })
mock.module('../server/utils/client-ip', { namedExports: { getClientIp: () => '127.0.0.1' } })
mock.module('../server/utils/mfa/session', { namedExports: { setSessionCookie: (_event: unknown, user: Record<string, unknown>) => { cookies.push(user) } } })
// The regeneration endpoint re-asks for the password; that check has its own tests.
mock.module('../server/utils/mfa/reauth', { namedExports: { requireCurrentPassword: async () => ({ username: 'admin' }) } })

Object.assign(globalThis, {
  defineEventHandler: (handler: unknown) => handler,
  readBody: async (event: { body?: unknown }) => event.body,
  createError: (options: { statusMessage: string }) => Object.assign(new Error(options.statusMessage), options),
})

const { hashPassword } = await import('../server/utils/auth')
const { verifyOneTimeCode, normalizeRecoveryCode, hashOneTimeCode, RECOVERY_CODE_COUNT } = await import('../server/utils/mfa/codes')
const policy = await import('../server/utils/mfa/policy')
type ConfirmResponse = { ok: boolean, recoveryCodes?: string[], message: string }
const confirm = (await import('../server/api/admin/profile/mfa/confirm.post')).default as unknown as (event: unknown) => Promise<ConfirmResponse>
const recoveryCodesPost = (await import('../server/api/admin/profile/mfa/recovery-codes.post')).default as unknown as (event: unknown) => Promise<{ codes: string[] }>

const SECOND_PASSWORD = 'Mat-khau-cap-2-rat-dai!'
const secondPasswordHash = await hashPassword(SECOND_PASSWORD)
const EMAIL_CODE = '123456'
const emailCodeHash = await hashOneTimeCode(EMAIL_CODE)
const SUPERADMIN = { id: 1, username: 'admin', email: 'a@example.vn', roleId: 1, roleName: 'Quản trị', isSystem: true, isSuperAdmin: true, permissions: [] }
const EDITOR = { id: 7, username: 'editor', email: 'e@example.vn', roleId: 3, roleName: 'Biên tập', isSystem: false, isSuperAdmin: false, permissions: [{ resource: 'news', canUpdate: true }] }

const DAY = 24 * 60 * 60 * 1000
function setPolicy(value: string, enforceAfter: Date | null) {
  store.set('mfa_policy', value)
  store.set('mfa_enforce_after', enforceAfter ? enforceAfter.toISOString() : '')
  policy.clearMfaPolicyCache()
}

const inTenMinutes = () => new Date(Date.now() + 10 * 60 * 1000)
const pendingSecondPassword = (userId: number): Factor => ({ id: 99, userId, factorType: 'second_password', state: 'pending', passwordHash: secondPasswordHash, pendingExpiresAt: inTenMinutes() })
const pendingEmail = (userId: number): Factor => ({ id: 98, userId, factorType: 'email_otp', state: 'pending', passwordHash: null, pendingExpiresAt: inTenMinutes(), pendingCodeHash: emailCodeHash, pendingCodeExpiresAt: inTenMinutes(), pendingCodeAttempts: 0 })

function plantPending(userId: number, extra: Factor[] = []) {
  factors = [...extra, pendingSecondPassword(userId)]
}

const confirmAs = (adminUser: unknown, factorType = 'second_password', code = SECOND_PASSWORD) => confirm({ context: { adminUser }, body: { factorType, code } })

beforeEach(() => {
  store = new Map()
  factors = []
  recovery = []
  audit = []
  cookies = []
  tokenVersion = 0
  failCodeInsert = false
  pauseBeforeCodeInsert = 0
  locks.clear()
  policy.clearMfaPolicyCache()
  policy.clearMfaFactorCache()
})

/** Every code a response showed must still redeem. */
async function assertAllRedeemable(codes: string[]) {
  for (const code of codes) {
    const normalized = normalizeRecoveryCode(code)
    let found = false
    for (const row of recovery) {
      if (row.usedAt === null && await verifyOneTimeCode(normalized, row.codeHash)) { found = true; break }
    }
    assert.ok(found, 'a recovery code shown to the admin no longer redeems — the batch was replaced')
  }
}

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

// ─── W1: activation and issuance are one unit ─────────────────────────────────

test('issuing the codes fails → the confirm fails, the factor stays pending, and a retry succeeds', async () => {
  setPolicy('privileged', new Date(Date.now() + DAY))
  plantPending(SUPERADMIN.id)
  failCodeInsert = true

  await assert.rejects(confirmAs(SUPERADMIN), /simulated recovery-code insert failure/)
  assert.equal(factors.find(row => row.id === 99)!.state, 'pending', 'the factor went live without its recovery codes')
  assert.equal(recovery.length, 0)
  assert.equal(cookies.length, 0, 'a session was re-issued for a failed confirm')
  assert.equal(audit.length, 0, 'a failed confirm was audited as an enabled factor')

  const retry = await confirmAs(SUPERADMIN)
  assert.equal(retry.ok, true)
  assert.equal(retry.recoveryCodes?.length, RECOVERY_CODE_COUNT)
  assert.equal(factors.find(row => row.id === 99)!.state, 'active')
  await assertAllRedeemable(retry.recoveryCodes!)
})

test('two first factors confirmed at the same time: one batch, and every code shown still redeems', async () => {
  setPolicy('all', new Date(Date.now() + DAY))
  factors = [pendingSecondPassword(SUPERADMIN.id), pendingEmail(SUPERADMIN.id)]
  pauseBeforeCodeInsert = 60

  const responses = await Promise.all([
    confirmAs(SUPERADMIN, 'second_password', SECOND_PASSWORD),
    confirmAs(SUPERADMIN, 'email_otp', EMAIL_CODE),
  ])
  assert.ok(responses.every(response => response.ok))
  const withCodes = responses.filter(response => response.recoveryCodes)
  assert.equal(withCodes.length, 1, `expected exactly one response to carry codes, got ${withCodes.length}`)
  assert.equal(recovery.length, RECOVERY_CODE_COUNT, 'two batches were stored')
  await assertAllRedeemable(withCodes[0]!.recoveryCodes!)
  assert.ok(factors.every(row => row.state === 'active'))
})

test('a regeneration racing a first-factor confirm never leaves a shown sheet unredeemable', async () => {
  setPolicy('all', new Date(Date.now() + DAY))
  factors = [{ id: 5, userId: SUPERADMIN.id, factorType: 'totp', state: 'active', passwordHash: null, pendingExpiresAt: null }, pendingSecondPassword(SUPERADMIN.id)]
  pauseBeforeCodeInsert = 60

  const [confirmed, regenerated] = await Promise.all([
    confirmAs(SUPERADMIN),
    recoveryCodesPost({ context: { adminUser: SUPERADMIN }, body: { currentPassword: 'x' } }),
  ])
  // Whichever ran second sees the other's work: the regeneration's sheet is the live
  // one, and the confirm either issued nothing or issued the batch the regeneration
  // then replaced on purpose (an explicit regeneration revokes the old sheet).
  await assertAllRedeemable(regenerated.codes)
  assert.equal(recovery.length, RECOVERY_CODE_COUNT)
  if (confirmed.recoveryCodes) {
    const regeneratedSet = new Set(regenerated.codes)
    assert.ok(confirmed.recoveryCodes.every(code => !regeneratedSet.has(code)))
  }
})
