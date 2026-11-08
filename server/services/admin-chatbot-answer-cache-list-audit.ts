/**
 * The read-audit row of the cached-answer list (`GET /api/admin/chatbot/answer-cache`), moved out
 * of the handler verbatim (2026-11-08: no `server/api` file calls getDb() itself). The list itself
 * is `listAnswerCache` (`services/chatbot-answer-cache.ts`), unchanged.
 *
 * One row per READ, not per row shown (same pattern as `chatbot/sessions/index.get.ts`): the
 * viewer of the list, not someone changing data. Best-effort, as before: a failed insert is
 * swallowed and the list is still answered. The only write of this file
 * (`AUDIT_ONLY_FUNCTION_EXEMPTIONS` in `tests/reader-audit-atomicity.test.ts`).
 */
import { getDb } from '../utils/db'
import { activityLogs } from '../db/schema'

/** Record one read of the list (page, size, search, total) — best-effort. */
export async function auditAnswerCacheListRead(adminUser: { id?: number | null }, meta: { page: number, pageSize: number, search: string, total: number }) {
  const { page, pageSize, search, total } = meta
  await getDb().insert(activityLogs).values({
    userId: adminUser.id ?? null,
    action: 'read',
    resource: 'chatbot_knowledge',
    resourceId: null,
    meta: { type: 'answer_cache_list', page, pageSize, search, total },
  }).catch(() => undefined)
}
