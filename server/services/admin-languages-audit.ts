/**
 * The audit rows of `POST /api/admin/languages/seed-default` and `POST /api/admin/languages/sync` —
 * moved out of the handlers verbatim (2026-11-08: no `server/api` file calls getDb() itself). The
 * handlers keep the `settings.update` gate, the call to the languages service (which has already
 * written the languages / keys when these rows are written), and the best-effort policy: a failed
 * insert is caught there and logged with the actor and the counts (`languages.*_audit_failed`) —
 * the trace that remains when `activity_logs` has none — and the response is still the action's
 * own result.
 *
 * Deliberately not `services/languages.ts`: `tests/admin-audit-failure-logged-behavior.test.ts`
 * replaces that module with exactly two names.
 */
import { getDb } from '../utils/db'
import { activityLogs } from '../db/schema'

/** The audit row of one "seed the default languages and translations" run, with its counts. */
export async function writeLanguagesSeedDefaultAudit(actorId: number | null, result: Record<string, unknown>) {
  const db = getDb()
  await db.insert(activityLogs).values({
    userId: actorId,
    action: 'create',
    resource: 'settings',
    meta: {
      operation: 'seed_default_languages_and_translations',
      ...result,
    },
  })
}

/** The audit row of one "sync the missing language keys" run, with its counts. */
export async function writeLanguageKeysSyncAudit(actorId: number | null, result: Record<string, unknown>) {
  const db = getDb()
  await db.insert(activityLogs).values({
    userId: actorId,
    action: 'update',
    resource: 'settings',
    meta: {
      operation: 'sync_language_keys',
      ...result,
    },
  })
}
