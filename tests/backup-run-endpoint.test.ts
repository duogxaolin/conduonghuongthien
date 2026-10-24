import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

/**
 * `POST /api/admin/backup/run` — how a refused run reaches the admin.
 *
 * Both refusals that mean "not now, try again" are 409, decided by the error's
 * TYPE: another backup holds the run lock (`BackupLockBusyError`), or this run's
 * file name is already taken because a backup of the same trigger ran in the same
 * second (`BackupNameCollisionError`, wave1 1B). The collision used to fall through
 * to 500, which reads as "the server broke". Anything else is still 500.
 */

mock.module('../server/utils/db', { namedExports: { getDb: () => ({}), getPool: () => null } })
mock.module('../server/utils/logger', { namedExports: { logInfo: () => {}, logWarn: () => {}, logError: () => {} } })
// The real error classes, loaded before `runBackup` is replaced for the handler.
const real = await import('../server/services/backup')

let outcome: () => Promise<unknown> = async () => ({ stamp: 's', files: [], driveUploaded: false })
const calls: unknown[][] = []
mock.module('../server/services/backup', {
  namedExports: {
    runBackup: async (...args: unknown[]) => { calls.push(args); return outcome() },
    BackupLockBusyError: real.BackupLockBusyError,
    BackupNameCollisionError: real.BackupNameCollisionError,
  },
})
mock.module('../server/utils/permissions', { namedExports: { requireResourcePermission: () => {} } })

const h3 = await import('h3')
type Event = { body: unknown, context: { adminUser: unknown } }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: Event) => event.body
globals.createError = h3.createError
const handler = (await import('../server/api/admin/backup/run.post')).default as unknown as (event: Event) => Promise<{ ok: boolean }>

const request = (): Event => ({ body: { type: 'all' }, context: { adminUser: { id: 7, isSuperAdmin: true } } })
async function failure(): Promise<{ statusCode?: number, statusMessage?: string }> {
  try {
    await handler(request())
  } catch (error) {
    return error as { statusCode?: number, statusMessage?: string }
  }
  assert.fail('the handler should have thrown')
}

test('a name already taken in the same second is a 409 with the service\'s message, not a 500', async () => {
  outcome = async () => { throw new real.BackupNameCollisionError('cdkt-20261024T030000Z-manual.sql.gz') }
  const error = await failure()
  assert.equal(error.statusCode, 409)
  assert.match(String(error.statusMessage), /cdkt-20261024T030000Z-manual\.sql\.gz đã tồn tại/)
})

test('another backup holding the lock is a 409', async () => {
  outcome = async () => { throw new real.BackupLockBusyError() }
  assert.equal((await failure()).statusCode, 409)
})

test('any other failure is still a 500', async () => {
  outcome = async () => { throw new Error('mysqldump died') }
  const error = await failure()
  assert.equal(error.statusCode, 500)
  assert.equal(error.statusMessage, 'mysqldump died')
})

test('a successful run returns its result for the requesting admin', async () => {
  outcome = async () => ({ stamp: '20261024T030000Z', files: [], driveUploaded: false })
  calls.length = 0
  const result = await handler(request())
  assert.equal(result.ok, true)
  assert.deepEqual(calls, [['all', 'manual', 7]])
})
