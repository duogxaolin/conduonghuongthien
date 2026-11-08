/**
 * The public contact/support form (`POST /api/submissions`) — its database statements, moved out
 * of the handler verbatim (2026-11-08: no `server/api` file calls getDb() itself). The handler
 * keeps, in the same order: the rate limit (before anything else), reading and validating the
 * answers, the recipient allow-list rule (`getConfiguredRecipients`: visible nodes of a page's
 * PUBLISHED tree, else its visible flat rows — `draft_blocks` is never read) and
 * `resolveSubmissionRecipient`, the mail and every log line.
 *
 * NOT one transaction, as before: the row is inserted first (a submission is never lost to a mail
 * failure), the mail is sent, then `notified_at` is stamped in a separate statement whose failure
 * is only logged.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '../utils/db'
import { submissions, pages, pageBlocks, settings } from '../db/schema'

/** Step 1: ALWAYS persist the submission first. Returns the driver's result header (`insertId`). */
export async function insertSubmission(values: typeof submissions.$inferInsert) {
  const db = getDb()
  const [result] = await db.insert(submissions).values(values)
  return result
}

/** Every page's id and PUBLISHED tree — one JSON column per page, not two: the draft tree is never needed. */
export async function listPagePublishedTrees() {
  const db = getDb()
  const pageRows = await db
    .select({ id: pages.id, published: pages.publishedBlocks })
    .from(pages)
  return pageRows
}

/** The `data` of the VISIBLE flat rows of type `blockTypes` on pages `pageIds` (non-empty). */
export async function listVisibleFlatFormBlocks(pageIds: number[], blockTypes: string[]) {
  const db = getDb()
  const flat = await db
    .select({ data: pageBlocks.data })
    .from(pageBlocks)
    .where(and(
      inArray(pageBlocks.pageId, pageIds),
      inArray(pageBlocks.blockType, blockTypes),
      eq(pageBlocks.isVisible, true),
    ))
  return flat
}

/** Email liên hệ của cổng (`settings.email`) — nhánh dự phòng cuối. */
export async function getSiteEmail(): Promise<string> {
  const db = getDb()
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, 'email'))
    .limit(1)
  return (row?.value || '').trim()
}

/** Stamp the moment the notification mail was sent on the submission's own row. */
export async function stampSubmissionNotified(id: number, notifiedAt: Date) {
  const db = getDb()
  await db.update(submissions).set({ notifiedAt }).where(eq(submissions.id, id))
}
