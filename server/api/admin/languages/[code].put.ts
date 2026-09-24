import { createError } from 'h3'
import { requireResourcePermission } from '../../../utils/permissions'
import { updateLanguage } from '../../../services/languages'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  const code = getRouterParam(event, 'code')
  if (!code) throw createError({ statusCode: 400, statusMessage: 'Mã ngôn ngữ bắt buộc.' })

  const body = await readBody(event).catch(() => ({}))

  await updateLanguage(adminUser, code, {
    name: typeof body.name === 'string' ? body.name : undefined,
    nativeName: typeof body.nativeName === 'string' ? body.nativeName : undefined,
    isActive: typeof body.isActive === 'boolean' ? body.isActive : undefined,
    isDefault: typeof body.isDefault === 'boolean' ? body.isDefault : undefined,
    displayOrder: typeof body.displayOrder === 'number' ? body.displayOrder : undefined,
  })

  return { ok: true }
})
