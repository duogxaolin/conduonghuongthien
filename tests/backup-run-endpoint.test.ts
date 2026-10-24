import assert from 'node:assert/strict'
import test, { after, before, mock } from 'node:test'
import { startH3TestServer, type H3TestServer } from './_h3-test-server'

/**
 * `POST /api/admin/backup/run` — how a refused run reaches the admin.
 *
 * Both refusals that mean "not now, try again" are 409, decided by the error's
 * TYPE: another backup holds the run lock (`BackupLockBusyError`), or this run's
 * file name is already taken because a backup of the same trigger ran in the same
 * second (`BackupNameCollisionError`, wave1 1B). The collision used to fall through
 * to 500, which reads as "the server broke". Anything else is still 500.
 *
 * And how its body is read (wave2 5.2): through `readValidated`
 * (`server/utils/request-body.ts`), so the handler runs inside a REAL h3 app and
 * gets real bytes — a fake event with a `readBody` global would skip exactly the
 * parsing under test. Before, a bare `readBody<{ type?: string }>(event)` answered
 * a truncated body with h3's English "Invalid JSON body", handed this code the
 * truncated TEXT when the client wrote `; charset=utf-8`, and took a urlencoded
 * form `type=all` — what a plain HTML form sends — as a valid request.
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
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = h3.defineEventHandler
globals.createError = h3.createError
const handler = (await import('../server/api/admin/backup/run.post')).default

const PATH = '/api/admin/backup/run'
let server: H3TestServer
before(async () => {
  server = await startH3TestServer((router) => {
    router.post(PATH, h3.defineEventHandler((event) => {
      // What `server/middleware/admin-auth.ts` sets for a signed-in admin.
      event.context.adminUser = { id: 7, isSuperAdmin: true }
      return handler(event)
    }))
  })
})
after(() => server.close())

const run = (body = '{"type":"all"}', contentType = 'application/json') => server.send('POST', PATH, { body, contentType })

async function failure(): Promise<{ statusCode?: number, statusMessage?: string }> {
  const response = await run()
  assert.notEqual(response.status, 200, 'the handler should have refused')
  return response.json() as { statusCode?: number, statusMessage?: string }
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
  const response = await run()
  assert.equal(response.status, 200, response.text)
  assert.equal(response.json().ok, true)
  assert.deepEqual(calls, [['all', 'manual', 7]])
})

test('each of the three types reaches runBackup as sent (what backup.vue posts: `{ type }`)', async () => {
  outcome = async () => ({ stamp: 's', files: [], driveUploaded: false })
  calls.length = 0
  for (const type of ['sql', 'files', 'all']) {
    assert.equal((await run(JSON.stringify({ type }), 'application/json; charset=utf-8')).status, 200)
  }
  assert.deepEqual(calls.map(args => args[0]), ['sql', 'files', 'all'])
})

/** A refusal before any backup starts: 400, the given message, nothing in `data`. */
async function assertRefused(response: Awaited<ReturnType<typeof run>>, message: string) {
  assert.equal(response.status, 400, response.text)
  const body = response.json()
  assert.equal(body.statusMessage, message)
  assert.equal(body.data, undefined)
  assert.deepEqual(calls, [], 'no backup may start on a refused request')
}

test('a body that is not a JSON object is a 400 with the shared message, and no backup starts', async () => {
  for (const [body, contentType] of [
    ['{"type":', 'application/json'],
    ['{"type":', 'application/json; charset=utf-8'],
    ['[{"type":"all"}]', 'application/json'],
    ['null', 'application/json'],
    ['type=all', 'application/x-www-form-urlencoded'],
    ['{"type":"all"}', 'text/plain;charset=UTF-8'],
  ]) {
    calls.length = 0
    await assertRefused(await run(body, contentType), 'Dữ liệu gửi lên không hợp lệ')
  }
})

test('an unknown or missing type is a 400 with the endpoint\'s own message, and no backup starts', async () => {
  for (const body of ['{"type":"everything"}', '{}', '{"type":1}']) {
    calls.length = 0
    await assertRefused(await run(body), 'Loại backup không hợp lệ (sql | files | all).')
  }
})
