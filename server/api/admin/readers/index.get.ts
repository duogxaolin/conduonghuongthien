/**
 * Reader list for moderation.
 *
 * Requires `readers.read` — not an article permission. An officer who may write
 * news is not thereby authorized to read citizens' email addresses and posting
 * histories (design.md D13).
 *
 * Every call writes one audit row carrying the filters used, on the same path as
 * the read (design.md D14).
 */
import { requireResourcePermission } from '../../../utils/permissions'
import { auditReaderRead, isReaderBanFilter, listReaders, READER_MAX_PER_PAGE } from '../../../services/readers'

/** Finite before clamped — see the note in the public thread endpoint. NaN
 *  survives `Math.max` and serialises as `page: null`. */
function finitePositive(raw: unknown, fallback: number, max: number): number {
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(1, Math.floor(value)), max)
}

export default defineEventHandler(async (event) => {
  const actor = event.context.adminUser
  requireResourcePermission(actor, 'readers', 'read')

  const query = getQuery(event)

  const rawBanned = query.banned === undefined || query.banned === '' ? 'all' : query.banned
  if (!isReaderBanFilter(rawBanned)) {
    // Refused rather than coerced: `?banned=1` read as "banned" would show a
    // filtered list while the select on screen still said "Tất cả".
    throw createError({ statusCode: 400, statusMessage: 'Bộ lọc trạng thái không hợp lệ.' })
  }

  const search = typeof query.q === 'string' ? query.q.trim().slice(0, 100) : ''
  const page = finitePositive(query.page, 1, 100_000)
  const perPage = finitePositive(query.perPage, 25, READER_MAX_PER_PAGE)

  const result = await listReaders({ search, banned: rawBanned, page, perPage })

  await auditReaderRead({
    actorId: actor.id,
    meta:    { operation: 'list', search: search || null, banned: rawBanned, page, perPage, returned: result.readers.length },
  })

  return { ok: true, ...result }
})
