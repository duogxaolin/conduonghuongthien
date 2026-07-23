import { getDb } from '../../../../utils/db'
import { settings } from '../../../../db/schema'
import { checkPermission } from '../../../../utils/auth'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const adminUser = event.context.adminUser
  if (!checkPermission(adminUser.permissions, 'settings', 'read', adminUser.isSuperAdmin)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  const db = getDb()

  // Try navbar-specific key first, fallback to shared nav_menu
  const navbarRow = await db.select().from(settings).where(eq(settings.key, 'nav_menu_navbar')).limit(1)
  const fallbackRow = navbarRow.length ? null : await db.select().from(settings).where(eq(settings.key, 'nav_menu')).limit(1)

  const raw = navbarRow[0]?.value ?? fallbackRow?.[0]?.value ?? null
  let menu = null
  if (raw) {
    try { menu = JSON.parse(raw) } catch { /* ignore */ }
  }

  return { ok: true, menu }
})
