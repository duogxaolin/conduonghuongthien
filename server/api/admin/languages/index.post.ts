import { createError } from 'h3'
import { requireResourcePermission } from '../../../utils/permissions'
import { createLanguage } from '../../../services/languages'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  const body = await readBody(event).catch(() => ({}))
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Dữ liệu không hợp lệ.' })
  }

  if (!body.code || !body.name || !body.nativeName) {
    throw createError({ statusCode: 400, statusMessage: 'Thiếu mã, tên hoặc tên bản địa.' })
  }

  const result = await createLanguage(adminUser, {
    code: String(body.code),
    name: String(body.name),
    nativeName: String(body.nativeName),
    displayOrder: typeof body.displayOrder === 'number' ? body.displayOrder : 0,
  })

  return { ok: true, id: result.id }
})
