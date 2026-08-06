/**
 * The caller's own notifications, for the header bell and the profile page.
 *
 * Identity comes from the ticket. There is no `readerId` parameter and no way to
 * express one — this is a list of who answered one citizen, which is precisely
 * the shape of query that must not be aimable at somebody else.
 *
 * NOT audited, deliberately. The rule that every read of reader data writes an
 * `activity_logs` row (design.md D14) targets OFFICERS reading citizens' data: a
 * log of personal data that can be browsed without leaving a trace is a
 * surveillance tool. A reader opening their own notifications is not that, and
 * logging it would bury the rows the table exists for under one line per page
 * view — the same reasoning that keeps `checkPermission` off /admin/profile and
 * auditing off GET /api/public/reader/comments.
 *
 * Never SSR-rendered: article routes are SWR-cached and /profile is not in
 * routeRules at all, so this is fetched after mount like every other
 * reader-specific response.
 */
import { finitePositive } from '../../../utils/query-number'
import { requireReader } from '../../../utils/reader-auth'
import { listNotifications } from '../../../services/notifications'

/** Server-enforced ceiling. A client-supplied page size is a request. */
const MAX_PER_PAGE = 30
const DEFAULT_PER_PAGE = 10

export default defineEventHandler(async (event) => {
  const reader = await requireReader(event)
  const query = getQuery(event)

  return {
    ok: true,
    ...await listNotifications({
      readerId: reader.id,
      page:     finitePositive(query.page, 1, 100_000),
      perPage:  finitePositive(query.perPage, DEFAULT_PER_PAGE, MAX_PER_PAGE),
    }),
  }
})
