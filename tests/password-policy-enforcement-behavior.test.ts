import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import { SEED_USERNAME } from '../scripts/check-admin-password'
import { fakeNitroApp, loadPlugin, withEnv } from './_nitro-plugin-harness'

/**
 * Every place that SETS an administrator password applies `password-policy.ts`:
 * create user, reset another user's password (which also revokes that user's
 * sessions), the seed that makes the first admin, and the production boot guard.
 *
 * `password-policy.test.ts` already runs `validatePassword` itself; what it left to
 * regexes over source text was whether each of those four callers actually calls it
 * (`passwordRejectionMessage(password, { username })`, `tokenVersion = sql… + 1`,
 * `passwordRejectionMessage(adminPassword` + `process.exit(1)`, `ADMIN_PASSWORD` in
 * `require-secrets.ts`). Here the real handlers, the real seed module and the real
 * plugin run, with the real password hashing, against a fake database that records writes.
 */

type Row = Record<string, unknown>

const { users, roles, permissions, activityLogs } = await import('../server/db/schema')
const { verifyPassword } = await import('../server/utils/auth')

const account = { id: 20, username: 'bientap', roleId: 10, isSystem: false }
const writes = { inserts: [] as Array<{ table: unknown, values: Row }>, updates: [] as Row[] }

function select() {
  let table: unknown
  const builder = {
    from(t: unknown) { table = t; return builder },
    leftJoin() { return builder },
    where() {
      const rows: Row[] = table === users ? [account] : table === roles ? [{ isSystem: false }] : table === permissions ? [] : []
      return { limit: async () => rows, then: (resolve: (value: Row[]) => unknown) => resolve(rows) }
    },
  }
  return builder
}
const tx = {
  insert: (table: unknown) => ({ values: async (values: Row) => { writes.inserts.push({ table, values }); return [{ insertId: 77 }] } }),
  update: (table: unknown) => ({ set: (set: Row) => ({ where: async () => { assert.equal(table, users); writes.updates.push(set) } }) }),
}
// One mutable slot, so the seed tests below can swap in their own database without a second `mock.module`.
let currentDb: unknown = { select, transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) }
const handlerDb = currentDb
mock.module('../server/utils/db', { namedExports: { getDb: () => currentDb } })

type Event = { body: unknown, params: Record<string, string>, context: { adminUser: unknown } }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: Event) => event.body
globals.getRouterParam = (event: Event, key: string) => event.params[key]
globals.createError = (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input)

const createUser = (await import('../server/api/admin/users/index.post')).default as unknown as (event: Event) => Promise<Row>
const updateUser = (await import('../server/api/admin/users/[id].put')).default as unknown as (event: Event) => Promise<Row>

const superadmin = { id: 1, isSuperAdmin: true, permissions: [] }
const STRONG = 'Xy7#mQp2Lv8Ns'
const call = (handler: (event: Event) => Promise<Row>, body: Row, params: Record<string, string> = {}) =>
  handler({ body, params, context: { adminUser: superadmin } })
async function statusOf(run: () => Promise<unknown>): Promise<number | null> {
  try { await run(); return null } catch (error) { return (error as { statusCode?: number }).statusCode ?? -1 }
}
const dialect = new MySqlDialect()

beforeEach(() => {
  currentDb = handlerDb
  writes.inserts.length = 0
  writes.updates.length = 0
})

// ─── POST /api/admin/users ───────────────────────────────────────────────────

test('create user: a password the policy refuses is a 400 and nothing is written', async () => {
  const weak = ['abcdef', 'abcdefghijkl', 'Admin@123456', 'canbo9-Mat-Khau-2026!']
  for (const password of weak) {
    assert.equal(await statusOf(() => call(createUser, { username: 'canbo9', password, roleId: 10 })), 400, JSON.stringify(password))
  }
  assert.deepEqual(writes.inserts, [], 'a refused password never reaches the database')
})

test('create user: a policy-clean password is stored as a hash that verifies', async () => {
  const result = await call(createUser, { username: 'canbo9', password: STRONG, roleId: 10 })
  assert.equal(result.ok, true)
  const created = writes.inserts.find(entry => entry.table === users)!.values
  assert.notEqual(created.passwordHash, STRONG)
  assert.ok(await verifyPassword(STRONG, created.passwordHash as string))
  assert.ok(writes.inserts.some(entry => entry.table === activityLogs), 'and audited')
})

// ─── PUT /api/admin/users/:id ────────────────────────────────────────────────

test('reset password: a refused password is a 400 (never silently skipped) and nothing is written', async () => {
  const weak = ['short', 'abcdefghijkl', 'bientap-Mat-Khau-2026!', 'Admin@123456']
  for (const password of weak) {
    assert.equal(await statusOf(() => call(updateUser, { password }, { id: '20' })), 400, JSON.stringify(password))
  }
  assert.deepEqual(writes.updates, [])
  assert.deepEqual(writes.inserts, [], 'no audit row for a change that did not happen')
})

test('reset password: the new hash is stored and token_version is incremented, so old sessions die', async () => {
  await call(updateUser, { password: STRONG }, { id: '20' })
  assert.equal(writes.updates.length, 1)
  const set = writes.updates[0]!
  assert.ok(await verifyPassword(STRONG, set.passwordHash as string))
  const { sql: bump } = dialect.sqlToQuery(set.tokenVersion as never)
  assert.match(bump, /`token_version` \+ 1$/, 'the generation moves forward in SQL, atomically')
})

test('an edit that does not change the password does not touch the hash or the session generation', async () => {
  await call(updateUser, { email: 'bientap@example.com' }, { id: '20' })
  assert.deepEqual(Object.keys(writes.updates[0]!), ['email'])
})

// ─── production boot guard (server/plugins/require-secrets.ts) ───────────────

const plugin = await loadPlugin('server/plugins/require-secrets.ts')
const BOOT_ENV = { NODE_ENV: 'production', JWT_SECRET: 'a-unique-jwt-secret-of-sufficient-length-1' }
const boot = (env: Record<string, string | undefined>) => withEnv({ ...BOOT_ENV, ...env }, () => plugin(fakeNitroApp().app))

test('production refuses to boot on a weak ADMIN_PASSWORD, and names the variable', async () => {
  for (const weak of ['Admin@123456', 'Admin@conduonghuongthien2026', 'abcdefghijkl']) {
    await assert.rejects(async () => boot({ ADMIN_PASSWORD: weak }), /ADMIN_PASSWORD does not meet the password policy/, weak)
  }
})

test('production boots with a policy-clean or an absent ADMIN_PASSWORD; development never blocks', async () => {
  await boot({ ADMIN_PASSWORD: STRONG })
  await boot({ ADMIN_PASSWORD: undefined })
  await boot({ NODE_ENV: 'development', ADMIN_PASSWORD: 'Admin@123456', JWT_SECRET: undefined })
})

// ─── the seed (server/db/seed.ts) ────────────────────────────────────────────

/**
 * The seed runs `seed()` at import time and ends in `process.exit`. `exit` is replaced with a
 * function that throws on its first call (unwinding `seed()` as the real exit would) and returns
 * on the second (the `.catch` handler's own `exit(1)`); the fake database stops the run right
 * at the insert of the administrator account, which is as far as this test needs to see.
 */
class StopAtAdminInsert extends Error {}
async function runSeed(adminPassword: string | undefined, tag: string) {
  const outcome = { exitCodes: [] as number[], errors: [] as string[], adminInsert: null as Row | null }
  currentDb = {
    insert: (table: unknown) => ({
      values: (values: Row) => {
        if (table === users) { outcome.adminInsert = values; throw new StopAtAdminInsert('stop') }
        return { onDuplicateKeyUpdate: async () => undefined }
      },
    }),
    select: () => ({ from: async (table: unknown) => (table === roles ? [{ id: 1, name: 'superadmin' }, { id: 2, name: 'editor' }, { id: 3, name: 'moderator' }, { id: 4, name: 'viewer' }] : []) }),
  }

  const realExit = process.exit
  const realError = console.error
  const realLog = console.log
  process.exit = ((code?: number) => {
    outcome.exitCodes.push(code ?? 0)
    // Unwind `seed()` like a real exit would — but not when the run was stopped on purpose at the
    // administrator insert: then this call IS the `.catch` handler and nothing is left to unwind.
    if (outcome.exitCodes.length === 1 && !outcome.adminInsert) throw new Error(`process.exit(${code})`)
  }) as typeof process.exit
  console.error = (...args: unknown[]) => { outcome.errors.push(args.map(String).join(' ')) }
  console.log = () => {}
  try {
    await withEnv({ ADMIN_PASSWORD: adminPassword }, async () => {
      await import(`../server/db/seed.ts?${tag}`)
      // `seed()` is started by the import and not awaited by it: let it reach its end.
      for (let turn = 0; turn < 200 && outcome.exitCodes.length === 0; turn++) await new Promise(resolve => setImmediate(resolve))
    })
  } finally {
    process.exit = realExit
    console.error = realError
    console.log = realLog
  }
  return outcome
}

test('the seed refuses a weak ADMIN_PASSWORD with exit code 1 before it creates the administrator', async () => {
  for (const [index, weak] of ['', undefined, 'Admin@123456', 'admin-Mat-Khau-2026!'].entries()) {
    const outcome = await runSeed(weak, `weak${index}`)
    assert.equal(outcome.exitCodes[0], 1, `exit code for ${JSON.stringify(weak)}`)
    assert.ok(outcome.errors.some(line => line.includes('ADMIN_PASSWORD chưa đạt yêu cầu')), 'the policy message, not some other failure')
    assert.equal(outcome.adminInsert, null, 'no administrator row was attempted')
  }
})

test('the seed creates the administrator from a policy-clean ADMIN_PASSWORD, storing a hash', async () => {
  const outcome = await runSeed(STRONG, 'strong')
  assert.ok(outcome.adminInsert, 'the run reached the administrator insert')
  // The build guard checks the password against SEED_USERNAME; the seed must create exactly that account.
  assert.equal(outcome.adminInsert!.username, SEED_USERNAME)
  assert.notEqual(outcome.adminInsert!.passwordHash, STRONG)
  assert.ok(await verifyPassword(STRONG, outcome.adminInsert!.passwordHash as string))
  assert.ok(!outcome.errors.some(line => line.includes('ADMIN_PASSWORD chưa đạt yêu cầu')))
})

after(() => mock.reset())
