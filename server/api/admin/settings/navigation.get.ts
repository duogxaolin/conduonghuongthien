import { getDb } from '../../../utils/db'
import { settings } from '../../../db/schema'
import { checkPermission } from '../../../utils/auth'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'settings', 'read', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  const db = getDb()
  const row = await db.select().from(settings).where(eq(settings.key, 'nav_menu')).limit(1)
  const raw = row[0]?.value

  let menu = null
  if (raw) {
    try { menu = JSON.parse(raw) } catch { /* ignore */ }
  }

  return { ok: true, menu }
})
