/**
 * A reader renaming themselves.
 *
 * Identity comes from the ticket, never from the body: there is no `readerId`
 * parameter and no way to express one. An endpoint that accepted a target id
 * would need an authorisation rule to go with it, and the only correct rule
 * would be "must equal the caller" — which is what taking it from the ticket
 * already enforces without a rule to get wrong.
 *
 * The name is written to `custom_display_name`, never to `display_name`: the
 * OAuth callback refreshes the latter from Google on every sign-in, so a name
 * stored there would be erased by the reader's next sign-in. See
 * effectiveDisplayName in services/readers.ts.
 */
import { requireReader, touchReader } from '../../../utils/reader-auth'
import { renameReader, validateDisplayName } from '../../../services/readers'
import { initialsFrom } from '../../../services/comments'
import { recordRateLimitHit, type RateLimitRule } from '../../../utils/rate-limit-store'
import { rateLimitDeps } from '../../../utils/rate-limit-deps'

/**
 * Ten renames per ten minutes, per account.
 *
 * Looser than the comment rule (5/600s) because a rename is not published to
 * anyone else's feed — the cost of a burst is a few UPDATEs and a few audit
 * rows, not a thread nobody can read. Tight enough that a script cannot churn
 * the audit log.
 *
 * Keyed by account only, with no address key. The address key on the comment
 * path exists because posting is how you reach other readers; renaming touches
 * one row that only the renamer's own comments display, so an office behind one
 * NAT has no shared cost to protect.
 */
const RENAME_RULE: RateLimitRule = { limit: 10, windowSeconds: 600 }

export default defineEventHandler(async (event) => {
  // 401 when signed out, 403 when banned. The UI needs those apart: it reopens
  // the Google flow for 401 and must not for 403.
  const reader = await requireReader(event)

  const body = await readBody(event).catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  const validation = validateDisplayName((body as Record<string, unknown>).displayName)
  if (!validation.ok) throw createError({ statusCode: 400, statusMessage: validation.message })

  /**
   * Allowance is spent HERE — after every reason to refuse, immediately before
   * the write.
   *
   * Charging at the top of the handler is the mistake this ordering avoids, and
   * it is the same one the comment write path documents: a reader whose ten
   * attempts were all rejected names would be locked out for ten minutes without
   * having renamed anything, and anyone able to trigger rejected requests could
   * burn someone else's allowance with calls that were always going to fail.
   */
  const deps = rateLimitDeps()
  const limit = await recordRateLimitHit(`reader:rename:${reader.id}`, RENAME_RULE, deps)
  if (limit.blocked) {
    setResponseHeader(event, 'retry-after', Math.max(1, limit.retryAfterSeconds))
    throw createError({
      statusCode: 429,
      statusMessage: 'Bạn đã đổi tên quá nhiều lần. Vui lòng thử lại sau ít phút.',
    })
  }

  const result = await renameReader({ readerId: reader.id, name: validation.name })
  if (!result.ok) throw createError({ statusCode: result.statusCode, statusMessage: result.message })

  // Same reasoning as the comment write path: `last_seen_at` is the column the
  // retention scope ages accounts against, and a 30-day ticket means the OAuth
  // callback alone would let an active reader's account age out under them.
  await touchReader(event, reader.id)

  return {
    ok: true,
    reader: {
      displayName: result.displayName,
      // Recomputed server-side rather than left to the client so the header, the
      // profile page and the comment thread cannot render different initials for
      // the same name.
      initials:    initialsFrom(result.displayName),
    },
  }
})
