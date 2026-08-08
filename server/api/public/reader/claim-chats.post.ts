/**
 * Attaching conversations held before signing in to the account that just signed in.
 *
 * The claim is proved, not asserted. `localStorage['cdkt_sessions_v1']` holds
 * `{id, token}` per conversation, and the token is `<uuid>.<hmac>` minted by the
 * server — a browser cannot forge one without the analytics secret. So this
 * endpoint never takes the caller's word for which sessions are theirs: it
 * verifies every ticket and ignores the id on any that fails.
 *
 * Without the signature check this route would be "tell me a uuid and I will hand
 * you the transcript", and `/profile` would display a stranger's conversation —
 * transcripts that can contain a phone number and a description of somebody's
 * criminal record.
 *
 * Only sessions with `reader_id IS NULL` are claimable. A conversation that already
 * belongs to somebody cannot be taken from them even if its ticket leaked, and
 * re-running the claim is harmless.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'

import { getDb } from '../../../utils/db'
import { chatSessions } from '../../../db/schema'
import { requireReader } from '../../../utils/reader-auth'
import { verifySessionToken } from '../../../utils/chatbot/session-token'
import { analyticsHmacSecret } from '../../../utils/runtime-config'

/**
 * At most 50 tickets per call.
 *
 * The widget keeps a bounded conversation list, so a real browser sends a handful.
 * The cap exists because each ticket costs one HMAC computation and the whole
 * batch costs one UPDATE — bounding the input is cheaper than discovering the
 * bound during an incident.
 */
const MAX_TICKETS = 50

export default defineEventHandler(async (event) => {
  const reader = await requireReader(event)

  const secret = analyticsHmacSecret(event)
  if (!secret) {
    // No secret means no ticket can be verified, and claiming on the client's word
    // is the one thing this endpoint exists not to do. Reported as "claimed
    // nothing" rather than as an error: the profile page has nothing to offer the
    // reader here, and a red banner would invite them to retry forever.
    return { ok: true, claimed: 0, verified: 0 }
  }

  const body = await readBody(event).catch(() => null)
  const rawSessions = body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>).sessions
    : null

  if (!Array.isArray(rawSessions)) {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  // Verified ids only, deduplicated: the same conversation appearing twice in the
  // payload must not make the count claim two.
  const verified = new Set<string>()
  for (const entry of rawSessions.slice(0, MAX_TICKETS)) {
    if (!entry || typeof entry !== 'object') continue
    const token = (entry as Record<string, unknown>).token
    const sessionId = verifySessionToken(token, secret)
    if (sessionId) verified.add(sessionId)
  }

  if (verified.size === 0) return { ok: true, claimed: 0, verified: 0 }

  const ids = [...verified]

  /**
   * One UPDATE with `reader_id IS NULL` in the WHERE clause, not read-then-write.
   *
   * The condition is what makes the "cannot be taken from someone" rule hold under
   * two calls arriving at once: checking ownership in a SELECT first would let both
   * see null and both write. Here the database decides, once.
   */
  await getDb()
    .update(chatSessions)
    .set({ readerId: reader.id })
    .where(and(inArray(chatSessions.id, ids), isNull(chatSessions.readerId)))

  /**
   * Count by asking what the reader now owns among the ids they proved, rather
   * than trusting `affectedRows`.
   *
   * `affectedRows` counts rows CHANGED, so a conversation this reader had already
   * claimed on a previous visit counts as zero — and the page would say "claimed
   * 0" while displaying the conversation immediately below. The reader's question
   * is "are my conversations here", not "did a row change on this request".
   */
  const owned = await getDb()
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(and(inArray(chatSessions.id, ids), eq(chatSessions.readerId, reader.id)))

  return { ok: true, claimed: owned.length, verified: verified.size }
})
