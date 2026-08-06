/**
 * A reader turning reply emails on or off.
 *
 * Its own endpoint rather than a field on `profile.put`: that route validates a
 * display name and charges a rename allowance, neither of which means anything
 * for a boolean. Folding this in would either spend a rename on a toggle or make
 * both operations optional in one handler — the shape where "update nothing"
 * quietly becomes a valid request.
 *
 * Identity comes from the ticket. There is no `readerId` parameter and no way to
 * express one.
 */
import { requireReader, touchReader } from '../../../../utils/reader-auth'
import { setReaderEmailPreference } from '../../../../services/readers'
import { getPool } from '../../../../utils/db'
import { recordRateLimitHit, type RateLimitRule } from '../../../../utils/rate-limit-store'

/** Per account. A toggle publishes nothing to anyone else, so there is no
 *  address key — an office behind one NAT has no shared cost to protect. */
const PREFERENCE_RULE: RateLimitRule = { limit: 20, windowSeconds: 600 }

export default defineEventHandler(async (event) => {
  // 401 when signed out, 403 when banned. The UI needs those apart: it reopens
  // the Google flow for 401 and must not for 403.
  const reader = await requireReader(event)

  const body = await readBody(event).catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  /**
   * Strictly boolean — no truthiness coercion.
   *
   * `Boolean(payload.enabled)` would read a missing field, an empty string and
   * the string "false" all as a decision the reader did not make. Turning
   * somebody's notifications off because a field was absent is the wrong failure
   * for a setting whose whole job is consent.
   */
  const enabled = (body as Record<string, unknown>).enabled
  if (typeof enabled !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'Giá trị không hợp lệ.' })
  }

  // Allowance spent after every reason to refuse, immediately before the write —
  // the ordering the comment and rename paths both document.
  const pool = getPool()
  const deps = { execute: pool ? ((sql: string, params: unknown[]) => pool.query(sql, params)) : null }
  const limit = await recordRateLimitHit(`reader:emailpref:${reader.id}`, PREFERENCE_RULE, deps)
  if (limit.blocked) {
    setResponseHeader(event, 'retry-after', Math.max(1, limit.retryAfterSeconds))
    throw createError({
      statusCode: 429,
      statusMessage: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.',
    })
  }

  const result = await setReaderEmailPreference({ readerId: reader.id, enabled })
  if (!result.ok) throw createError({ statusCode: result.statusCode, statusMessage: result.message })

  // `last_seen_at` is the column the retention scope ages accounts against; a
  // 30-day ticket means the OAuth callback alone would let an active reader's
  // account age out under them.
  await touchReader(event, reader.id)

  return { ok: true, emailNotifications: result.emailNotifications }
})
