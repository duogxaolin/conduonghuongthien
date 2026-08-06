/**
 * Marking notifications read.
 *
 * A write, so it is a POST and it is rate limited — but the limit is loose. This
 * is triggered by opening a dropdown, not by publishing anything: the cost of a
 * burst is a few UPDATEs against an indexed column, and a reader who hits a wall
 * here sees a badge that will not clear, which reads as a broken portal.
 *
 * `readerId` is never accepted from the body. Every service call below is bounded
 * by the ticket's reader, so there is no request shape that touches somebody
 * else's rows.
 */
import { requireReader } from '../../../../utils/reader-auth'
import { markAllRead, markRead } from '../../../../services/notifications'
import { recordRateLimitHit, type RateLimitRule } from '../../../../utils/rate-limit-store'
import { rateLimitDeps } from '../../../../utils/rate-limit-deps'

/** Per account. No address key: this publishes nothing to anyone else, so an
 *  office behind one NAT has no shared cost to protect. */
const MARK_READ_RULE: RateLimitRule = { limit: 60, windowSeconds: 600 }

/** Bounded so a single request cannot name an unbounded id list. */
const MAX_IDS = 100

export default defineEventHandler(async (event) => {
  const reader = await requireReader(event)

  const body = await readBody(event).catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  const payload = body as Record<string, unknown>
  const all = payload.all === true
  const rawIds = Array.isArray(payload.ids) ? payload.ids : []

  const ids = rawIds
    .map(value => Number(value))
    .filter(value => Number.isSafeInteger(value) && value > 0)
    .slice(0, MAX_IDS)

  // Nothing to do is a refusal, not a silent success: a client sending neither
  // has a bug, and answering 200 hides it.
  if (!all && !ids.length) {
    throw createError({ statusCode: 400, statusMessage: 'Không có thông báo nào được chỉ định.' })
  }

  /**
   * Allowance spent HERE — after every reason to refuse, immediately before the
   * write. Charging at the top would let a client with a malformed body burn its
   * own allowance on calls that were always going to fail, which is the ordering
   * mistake the comment and rename paths both document.
   */
  const deps = rateLimitDeps()
  const state = await recordRateLimitHit(`notif:read:${reader.id}`, MARK_READ_RULE, deps)
  if (state.blocked) {
    throw createError({
      statusCode: 429,
      statusMessage: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.',
    })
  }

  if (all) await markAllRead(reader.id)
  else await markRead({ readerId: reader.id, ids })

  return { ok: true }
})
