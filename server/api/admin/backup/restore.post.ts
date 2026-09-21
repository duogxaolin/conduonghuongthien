import { requireResourcePermission } from '../../../utils/permissions'
import { runRestore } from '../../../services/backup'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  requireResourcePermission(adminUser, 'settings', 'update')

  const body = await readBody<{ filename?: string }>(event)
  const filename = body?.filename
  if (!filename || typeof filename !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Thiếu tên file backup.' })
  }

  try {
    await runRestore(filename, adminUser.id ?? null)
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('Một lượt khôi phục khác')) {
      throw createError({ statusCode: 409, statusMessage: msg })
    }
    if (msg.includes('không tồn tại') || msg.includes('không hợp lệ')) {
      throw createError({ statusCode: 400, statusMessage: msg })
    }
    throw createError({ statusCode: 500, statusMessage: msg })
  }
})
