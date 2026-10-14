import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

/**
 * POST /api/admin/ai/moderation/restart-server ends the process (`process.exit`).
 * `ai.update` — the permission to tune moderation — used to be enough. It now also
 * needs a super admin, and the `ai.update` check stays. Runs the real handler and
 * the real permission helper; `process.exit` and the timer are faked.
 */

const logged: unknown[] = []
mock.module('../server/utils/db', {
  namedExports: { getDb: () => ({ insert: () => ({ values: async (row: unknown) => { logged.push(row) } }) }) },
})

type Event = { context: Record<string, unknown> }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.createError = (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input)

const handler = (await import('../server/api/admin/ai/moderation/restart-server.post')).default as unknown as (event: Event) => Promise<{ ok: boolean }>

const grant = (canUpdate: boolean) => [{ resource: 'ai', canCreate: false, canRead: true, canUpdate, canDelete: false }]

async function run(adminUser: Record<string, unknown> | undefined) {
  logged.length = 0
  const exits: unknown[] = []
  const realExit = process.exit
  process.exit = ((code?: number) => { exits.push(code) }) as typeof process.exit
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const outcome = await handler({ context: { adminUser } }).then(value => ({ value }), (error: unknown) => ({ error }))
    mock.timers.tick(5_000)
    return { ...outcome, exits }
  } finally {
    mock.timers.reset()
    process.exit = realExit
  }
}

test('an officer with ai.update but not super admin gets 403 and the process keeps running', async () => {
  const result = await run({ id: 5, isSuperAdmin: false, permissions: grant(true) })
  assert.equal((result as { error?: { statusCode?: number } }).error?.statusCode, 403)
  assert.deepEqual(result.exits, [], 'no exit scheduled')
  assert.equal(logged.length, 0, 'nothing logged as a restart')
})

test('only a strict boolean counts: a truthy non-boolean isSuperAdmin is refused', async () => {
  for (const odd of ['true', 1, {}]) {
    const result = await run({ id: 5, isSuperAdmin: odd, permissions: grant(true) })
    assert.equal((result as { error?: { statusCode?: number } }).error?.statusCode, 403, JSON.stringify(odd))
    assert.deepEqual(result.exits, [])
  }
})

test('no session context is refused', async () => {
  const result = await run(undefined)
  assert.equal((result as { error?: { statusCode?: number } }).error?.statusCode, 403)
  assert.deepEqual(result.exits, [])
})

test('a super admin restarts: audit row written, exit scheduled after the response', async () => {
  const result = await run({ id: 1, isSuperAdmin: true, permissions: [] })
  assert.equal((result as { value?: { ok: boolean } }).value?.ok, true)
  assert.deepEqual(result.exits, [0])
  assert.equal(logged.length, 1)
})
