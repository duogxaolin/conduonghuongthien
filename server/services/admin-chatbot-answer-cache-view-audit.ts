/**
 * The read-audit row of one cached answer (`GET /api/admin/chatbot/answer-cache/:key`), moved out
 * of the handler verbatim (2026-11-08: no `server/api` file calls getDb() itself). The answer
 * itself is `getAnswerCacheDetail` (`services/chatbot-answer-cache.ts`), unchanged.
 *
 * Same pattern as the list: one audit row for the READ; the log does not hold the answer's full
 * text. Best-effort, as before: a failed insert is swallowed and the answer is still returned.
 * The only write of this file (`AUDIT_ONLY_FUNCTION_EXEMPTIONS` in
 * `tests/reader-audit-atomicity.test.ts`).
 */
import { getDb } from '../utils/db'
import { activityLogs } from '../db/schema'

/** Record one view of the cached answer `cacheKey` — best-effort. */
export async function auditAnswerCacheView(adminUser: { id?: number | null }, cacheKey: string) {
  await getDb().insert(activityLogs).values({
    userId: adminUser.id ?? null,
    action: 'read',
    resource: 'chatbot_knowledge',
    resourceId: null,
    meta: { type: 'answer_cache_view', cacheKey },
  }).catch(() => undefined)
}
