/**
 * The audit rows of three moderation operations whose action is not a row write — moved out of
 * their handlers verbatim, each with the try/catch that makes it best-effort:
 *   - `POST /api/admin/ai/moderation/rescan-all` starts a background job (a row at the start and
 *     one with the summary when it finishes);
 *   - `POST /api/admin/ai/moderation/restart-server` schedules a process exit (SuperAdmin);
 *   - `POST /api/admin/ai/moderation/restart-worker` resets in-memory counters and the rule cache.
 *
 * Each is the only database write of its request — there is no row to commit it with, so it is
 * written on the pool, outside any transaction (named in `SERVICE_POOL_AUDIT_EXEMPTIONS`,
 * tests/reader-audit-atomicity.test.ts). Where `getDb()` is called is kept as each handler had it:
 * inside the `try` for the rescan rows, before it for the two restarts. The permission checks (the
 * SuperAdmin gate included), the job itself, the resets, the log line and the timer stay in the
 * handlers.
 */
import { getDb } from '../utils/db'
import { activityLogs } from '../db/schema'
import { logError } from '../utils/logger'

/**
 * One audit row of the rescan job (`moderation_rescan_all_started` at the start,
 * `moderation_rescan_all` with the summary at the finish). A failed insert is logged, not silent.
 */
export async function writeModerationRescanAudit(actorId: number | null, meta: Record<string, unknown>) {
  try {
    await getDb().insert(activityLogs).values({
      userId: actorId,
      action: 'update',
      resource: 'ai',
      meta,
    })
  } catch (err: unknown) {
    logError({
      event: 'ai_moderation.rescan_audit_failed',
      operation: meta.operation,
      actorId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/** The audit row of a server restart, written before the exit is scheduled. A failed insert does not block it. */
export async function writeServerRestartAudit(adminUser: { id?: number | null } | null | undefined) {
  const db = getDb()
  try {
    await db.insert(activityLogs).values({
      userId: adminUser?.id ?? null,
      action: 'update',
      resource: 'ai',
      meta: { operation: 'restart_website_server' },
    })
  } catch {
    // Non-blocking
  }
}

/**
 * The audit row of a worker restart. Best-effort — the counters and the rule cache are already
 * reset when it is written, so a failed insert must not answer "nothing happened" — but never
 * silent: its failure is logged with the actor, the trace that remains when `activity_logs` has none.
 */
export async function writeWorkerRestartAudit(adminUser: { id?: number | null } | null | undefined) {
  const db = getDb()
  try {
    await db.insert(activityLogs).values({
      userId: adminUser?.id ?? null,
      action: 'update',
      resource: 'ai',
      meta: { operation: 'restart_moderation_worker' },
    })
  } catch (error) {
    logError({
      event: 'ai_moderation.restart_worker_audit_failed',
      actorId: adminUser?.id ?? null,
      operation: 'restart_moderation_worker',
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
