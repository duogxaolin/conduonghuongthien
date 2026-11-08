import { optionalReader } from '../../../utils/reader-auth'
import { listOwnCommentVisibility } from '../../../services/public-comment-checkpoint-queries'

/**
 * Moderation checkpoint for the comments a reader has just posted.
 *
 * Lets the thread drop a comment that background AI moderation hid a few seconds
 * after it was posted, without a page reload.
 *
 * Answers only for the signed-in reader's OWN comments, and only `isHidden`. It
 * used to take any ids from anyone and return `flagReason` — the officer's
 * free-text hide note, the AI's reasoning and the literal blocklist pattern that
 * matched — so walking ids 1..N harvested the moderation rules themselves
 * (rà soát 2026-10-22). The author is shown a generic reason instead.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const rawIds = String(query.ids || '').trim()
  if (!rawIds) return { ok: true, items: [] }

  const ids = rawIds
    .split(',')
    .map(Number)
    .filter((n) => Number.isSafeInteger(n) && n > 0)
    .slice(0, 50)

  if (ids.length === 0) return { ok: true, items: [] }

  // Posting a comment requires a reader session, so its author always has one.
  const reader = await optionalReader(event)
  if (!reader) return { ok: true, items: [] }

  const rows = await listOwnCommentVisibility(ids, reader.id)

  return {
    ok: true,
    items: rows,
  }
})
