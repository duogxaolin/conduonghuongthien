import { z } from 'zod'
import { requireResourcePermission } from '../../../../../utils/permissions'
import { readValidatedQuery } from '../../../../../utils/request-body'
import { listTranslations, listTranslationGroups } from '../../../../../services/translation-list'

/**
 * Every translation of one language, plus the vi keys it has no row for (`id: null`) —
 * a deliberate full load (~630 rows; see `services/translation-list.ts`). It used to cap
 * at 200 (500 at most) and search in JS after the cut. `limit`/`offset` are no longer
 * read: a client still sending `?limit=500` gets every row. The search runs in SQL.
 *
 * A repeated `?search=`/`?group=` (h3 gives an array) takes the first value — the page
 * sends one; the handler before the schema ignored an array instead of failing.
 */
const firstValue = (value: unknown) => (Array.isArray(value) ? value[0] : value)
const querySchema = z.object({
  group: z.preprocess(firstValue, z.string().max(50)).optional(),
  // MAX_LIKE_QUERY_CHARS: `containsPattern` would cut a longer one silently.
  search: z.preprocess(firstValue, z.string().max(200)).optional(),
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
