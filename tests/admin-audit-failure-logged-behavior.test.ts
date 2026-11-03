import assert from 'node:assert/strict'
import test, { beforeEach, mock } from 'node:test'

/**
 * Three admin actions keep their audit row best-effort — the action has already happened
 * when the row is written (languages seeded into the database, keys synced, the moderation
 * worker's counters and rule cache reset), so a failed audit must not answer "nothing
 * happened". Each one swallowed that failure with an empty `catch {}`: no `activity_logs`
 * row AND no log line, so the action left no attributable trace anywhere.
 *
 *   - `POST /api/admin/languages/seed-default`
 *   - `POST /api/admin/languages/sync`
 *   - `POST /api/admin/ai/moderation/restart-worker`
 *
 * Pinned: a failed audit insert is logged with `logError` — who (actor id), what (the
 * operation and its counts) and the database error — and the response is still the
 * action's own result. A successful audit logs nothing. The real handlers; the services,
 * the database handle, the permission check and the logger are stand-ins.
 */

type Row = Record<string, unknown>
const state = { auditFails: false, inserted: [] as Row[], errors: [] as Row[], resets: 0, invalidations: 0 }

const fakeDb = {
  insert: () => ({
    values: async (row: Row) => {
      if (state.auditFails) throw new Error("ER_NO_REFERENCED_ROW_2: Cannot add or update a child row (activity_logs.user_id)")
      state.inserted.push(row)
      return [{ insertId: 1, affectedRows: 1 }]
    },
  }),
}

const url = (path: string) => new URL(path, import.meta.url).href
mock.module(url('../server/utils/db.ts'), { namedExports: { getDb: () => fakeDb, getPool: () => null } })
mock.module(url('../server/utils/permissions.ts'), { namedExports: { requireResourcePermission: () => {} } })
mock.module(url('../server/utils/logger.ts'), {
  namedExports: {
    log: () => {},
    logInfo: () => {},
    logWarn: () => {},
    logError: (entry: Row) => { state.errors.push(entry) },
    SECURITY_EVENTS: new Proxy({}, { get: (_target, key) => `event.${String(key)}` }),
  },
})
mock.module(url('../server/services/languages.ts'), {
  namedExports: {
    seedDefaultLanguagesAndTranslations: async () => ({ languagesSeeded: 2, translationsSeeded: 630 }),
    syncLanguageKeys: async () => ({ synced: 12, totalViKeys: 581 }),
  },
})
mock.module(url('../server/services/moderation-worker.ts'), {
  namedExports: {
    resetWorkerStats: () => { state.resets += 1 },
    invalidateModerationRulesCache: () => { state.invalidations += 1 },
  },
})

const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler

type Handler = (event: unknown) => Promise<Record<string, unknown>>
const load = async (path: string) => (await import(path)).default as Handler
const ACTOR = { id: 42, username: 'quantri' }
const call = (handler: Handler) => handler({ context: { adminUser: ACTOR } })

const CASES: Array<{ name: string, handler: Handler, event: string, operation: string, counts: Row }> = [
  {
    name: 'languages/seed-default',
    handler: await load('../server/api/admin/languages/seed-default.post.ts'),
    event: 'languages.seed_default_audit_failed',
    operation: 'seed_default_languages_and_translations',
    counts: { languagesSeeded: 2, translationsSeeded: 630 },
  },
  {
    name: 'languages/sync',
    handler: await load('../server/api/admin/languages/sync.post.ts'),
    event: 'languages.sync_audit_failed',
    operation: 'sync_language_keys',
    counts: { synced: 12, totalViKeys: 581 },
  },
  {
    name: 'ai/moderation/restart-worker',
    handler: await load('../server/api/admin/ai/moderation/restart-worker.post.ts'),
    event: 'ai_moderation.restart_worker_audit_failed',
    operation: 'restart_moderation_worker',
    counts: {},
  },
]

beforeEach(() => {
  state.auditFails = false
  state.inserted = []
  state.errors = []
  state.resets = 0
  state.invalidations = 0
})

for (const { name, handler, event, operation, counts } of CASES) {
  test(`${name}: the audit row names the actor and the operation; nothing is logged as an error`, async () => {
    const response = await call(handler)
    assert.equal(response.ok, true)
    assert.equal(state.inserted.length, 1)
    assert.equal(state.inserted[0]!.userId, ACTOR.id)
    assert.equal((state.inserted[0]!.meta as Row).operation, operation)
    assert.deepEqual(state.errors, [])
  })

  test(`${name}: a failed audit row is logged — actor, operation, counts, error — and the action's result still answers`, async () => {
    state.auditFails = true
    const response = await call(handler)
    assert.equal(response.ok, true, 'the action has already happened; a 500 would read "nothing happened"')
    assert.equal(state.inserted.length, 0)
    assert.equal(state.errors.length, 1, 'the failure left no trace at all')
    const [entry] = state.errors
    assert.equal(entry!.event, event)
    assert.equal(entry!.actorId, ACTOR.id)
    assert.equal(entry!.operation, operation)
    for (const [key, value] of Object.entries(counts)) assert.equal(entry![key], value, key)
    assert.match(String(entry!.error), /ER_NO_REFERENCED_ROW_2/)
  })
}

test('ai/moderation/restart-worker: the reset happens before the audit, so it stands when the audit fails', async () => {
  state.auditFails = true
  await call(CASES[2]!.handler)
  assert.equal(state.resets, 1)
  assert.equal(state.invalidations, 1)
})
