import { z } from 'zod'
import { requireResourcePermission } from '../../../../../utils/permissions'
import { readValidatedQuery } from '../../../../../utils/request-body'
import { listTranslations, listTranslationGroups } from '../../../../../services/languages'

/**
 * Every translation of one language — a deliberate full load (~630 rows). It used to
 * cap at 200 (500 at most) and search in JS after the cut, so rows past the cap could
 * not be seen or found in the tab, and the two "every key" callers (vi source map, AI
 * batch scan) got an incomplete list. `limit`/`offset` are no longer read: a client
 * still sending `?limit=500` gets every row. The search runs in SQL over all rows.
 */
const querySchema = z.object({
  group: z.string().max(50).optional(),
  search: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'read')

  const code = getRouterParam(event, 'code')
  if (!code) throw createError({ statusCode: 400, statusMessage: 'Mã ngôn ngữ bắt buộc.' })

  const { group, search } = await readValidatedQuery(event, querySchema)
  const [items, groups] = await Promise.all([
    listTranslations(code, { group, search }),
    listTranslationGroups(code),
  ])

  return { ok: true, items, groups }
})
