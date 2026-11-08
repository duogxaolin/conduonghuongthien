/**
 * Deleting cached chatbot answers from `/admin/chatbot/answer-cache`
 * (`DELETE /api/admin/chatbot/answer-cache/:key`, `POST …/bulk-delete`) — the delete and its
 * audit row, moved out of the handlers verbatim, still in one transaction each (2026-11-08: no
 * `server/api` file calls getDb() itself). The handlers keep the permission, validating the
 * keys, the 64-hex rule, the cap, the admin's IP and the 404.
 *
 * Deliberately not in `services/chatbot-answer-cache.ts`: suites replace that module with a few
 * names (`tests/public-page-cache-write-paths.test.ts` with `bumpAnswerCacheVersion` alone), and
 * its own functions (`listAnswerCache`, `getAnswerCacheDetail`, `clearAnswerCache`,
 * `discardCachedAnswer`) stay where they are. Deleting a cached answer is never "deleting the
 * answer" — the next question calls the model again and stores a new row.
 */
import { eq, inArray } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { activityLogs, chatbotAnswerCache } from '../db/schema'
import { affectedRowsOrZero } from '../utils/affected-rows'

/** [key].delete: delete one cached answer and audit it (with its question and kind) in one transaction; null when no row was deleted. */
export async function deleteCachedAnswerWithAudit(adminUser: { id?: number | null }, key: string, ip: string) {
  const db = getDb()
  const removed = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ question: chatbotAnswerCache.question, kind: chatbotAnswerCache.kind })
      .from(chatbotAnswerCache)
      .where(eq(chatbotAnswerCache.cacheKey, key))
      .limit(1)
    const deleted = await tx.delete(chatbotAnswerCache).where(eq(chatbotAnswerCache.cacheKey, key))
    const count = affectedRowsOrZero(deleted)
    if (count === 0) return null
    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'delete',
      resource: 'chatbot_knowledge',
      resourceId: null,
      meta: { type: 'answer_cache_delete', cacheKey: key, question: row?.question ?? null, kind: row?.kind ?? null, ip },
    })
    return count
  })
  return removed
}

/**
 * bulk-delete.post: delete the cached answers with these keys and, when at least one row went,
 * write one audit row with the number actually deleted — one transaction. Only rows really
 * deleted count: a key sent twice or a key that does not exist is not a deletion.
 */
export async function bulkDeleteCachedAnswersWithAudit(adminUser: { id?: number | null }, keys: string[], ip: string) {
  const db = getDb()
  const removed = await db.transaction(async (tx) => {
    const deleted = await tx.delete(chatbotAnswerCache).where(inArray(chatbotAnswerCache.cacheKey, keys))
    const count = affectedRowsOrZero(deleted)
    if (count === 0) return 0
    await tx.insert(activityLogs).values({
      userId: adminUser.id ?? null,
      action: 'delete',
      resource: 'chatbot_knowledge',
      resourceId: null,
      meta: { type: 'answer_cache_bulk_delete', count, ip },
    })
    return count
  })
  return removed
}
