/**
 * `POST /api/admin/comments/ai-moderate` — the read of the stored comments to moderate, moved
 * out of the handler verbatim (2026-11-08: no `server/api` file calls getDb() itself). The
 * handler keeps the `comments.read` gate, the input limits, the AI budget check (through
 * `checkAiBudget`, admin-ai-calls.ts), the fenced prompt, `callAi`, the "AI not configured → 503"
 * refusal and the verdict parsing.
 *
 * The author's name is read raw (Google name or the reader's own): it only goes into the
 * moderation prompt, fenced as user data, and back to the officer who asked — never to a reader
 * (`STAFF_ONLY_RAW_NAME_READS` in tests/reader-name-resolver-guard.test.ts).
 */
import { eq, inArray } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { articleComments, readerAccounts } from '../db/schema'

/** The body and the author's names of each comment in `commentIds` that exists (any order). */
export async function listCommentsForAiModeration(commentIds: number[]) {
  const db = getDb()
  const rows = await db
    .select({
      id: articleComments.id,
      body: articleComments.body,
      displayName: readerAccounts.displayName,
      customDisplayName: readerAccounts.customDisplayName,
    })
    .from(articleComments)
    .leftJoin(readerAccounts, eq(articleComments.readerId, readerAccounts.id))
    .where(inArray(articleComments.id, commentIds))
  return rows
}
