import { createError } from 'h3'
import { requireResourcePermission } from '../../../../../utils/permissions'
import { upsertTranslations } from '../../../../../services/languages'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  const code = getRouterParam(event, 'code')
  if (!code) throw createError({ statusCode: 400, statusMessage: 'Mã ngôn ngữ bắt buộc.' })

  const body = await readBody(event).catch(() => ({}))
  if (!body || !Array.isArray(body.items)) {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  interface TranslationItem { group: string; key: string; value: string }
  const items: TranslationItem[] = (body.items as unknown[])
    .filter((i: unknown): i is Record<string, unknown> =>
      typeof i === 'object' && i !== null && 'key' in i && 'value' in i)
    .map((i) => ({
      group: String(i.group ?? 'general'),
      key: String(i.key),
      value: String(i.value),
    }))

  await upsertTranslations(adminUser, code, items, false)

  return { ok: true, count: items.length }
})
