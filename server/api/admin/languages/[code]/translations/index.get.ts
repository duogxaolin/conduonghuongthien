import { requireResourcePermission } from '../../../../../utils/permissions'
import { listTranslations, listTranslationGroups } from '../../../../../services/languages'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'read')

  const code = getRouterParam(event, 'code')
  if (!code) throw createError({ statusCode: 400, statusMessage: 'Mã ngôn ngữ bắt buộc.' })

  const query = getQuery(event)
  const group = typeof query.group === 'string' ? query.group : undefined
  const search = typeof query.search === 'string' ? query.search : undefined
  const limit = query.limit ? Math.max(1, Math.min(500, Number(query.limit) || 200)) : 200
  const offset = query.offset ? Math.max(0, Number(query.offset) || 0) : 0

  const [items, groups] = await Promise.all([
    listTranslations(code, { group, search, limit, offset }),
    listTranslationGroups(code),
  ])

  return { ok: true, items, groups }
})
