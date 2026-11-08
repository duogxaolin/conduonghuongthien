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
import { requireReader } from '../../../utils/reader-auth'
import { claimChatSessionsForReader } from '../../../services/public-reader-queries'
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

  // One UPDATE guarded by `reader_id IS NULL` (the database decides who owns a
  // session, once), then a count of what the reader now owns among the ids they
  // proved — not `affectedRows`. Both explained in claimChatSessionsForReader.
  const owned = await claimChatSessionsForReader(reader.id, ids)

  return { ok: true, claimed: owned.length, verified: verified.size }
})
